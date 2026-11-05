// 회사 품의서 양식: 올린 파일을 이 컴퓨터에 보관하고, 채울 자리를 찾아 품의서 값을 넣어 저장한다.
// 위치: <userData>/approval-template/current.bin(원본), current.json(이름·형식·매핑)
import fs from 'node:fs';
import path from 'node:path';
import { app, dialog, type BrowserWindow } from 'electron';
import JSZip from 'jszip';
import type { FieldDef, TemplateFillResult, TemplateInfo, TemplateKind, TemplateResult, TemplateSlot } from '@shared/template';
import { DOCX_NAMES, HWPX_NAMES, PLACEHOLDER, fillEntry, parseXml, scanXml, serializeXml, type XmlEntry, type XmlNames } from './xml';
import { fillCell, scanSheet, sharedStrings, type SheetEntry } from './xlsx';
import { fillPdf, scanPdf } from './pdf';
import { mapSlots } from './map';

const MAX_BYTES = 20 * 1024 * 1024;
const dir = () => path.join(app.getPath('userData'), 'approval-template');
const binPath = () => path.join(dir(), 'current.bin');
const metaPath = () => path.join(dir(), 'current.json');

interface Meta {
  name: string;
  kind: TemplateKind;
  mapping: Record<string, string | null>;
  mappedBy: TemplateInfo['mappedBy'];
}

/** 찾은 자리 + 값을 채워 파일 바이트를 돌려주는 함수 */
interface Scanned {
  slots: TemplateSlot[];
  apply: (values: Record<string, string>) => Promise<Uint8Array>;
}

const withIds = (list: Omit<TemplateSlot, 'id'>[]): TemplateSlot[] => list.map((s, i) => ({ id: `s${i + 1}`, ...s }));

async function scanZip(bytes: Uint8Array, kind: Exclude<TemplateKind, 'pdf'>): Promise<Scanned> {
  const zip = await JSZip.loadAsync(bytes);
  const parts = Object.keys(zip.files)
    .filter((f) => (kind === 'docx' ? f === 'word/document.xml' : kind === 'hwpx' ? /^Contents\/section\d+\.xml$/.test(f) : /^xl\/worksheets\/sheet\d+\.xml$/.test(f)))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  if (parts.length === 0) throw new Error('양식 안에서 문서 내용을 찾지 못했어요.');
  const strings = kind === 'xlsx' ? sharedStrings((await zip.file('xl/sharedStrings.xml')?.async('string')) ?? null) : [];
  const names: XmlNames = kind === 'hwpx' ? HWPX_NAMES : DOCX_NAMES;

  type Part = { name: string; doc: Document; xml: XmlEntry[]; sheet: SheetEntry[] };
  const scanned: Part[] = [];
  for (const [i, name] of parts.entries()) {
    const doc = parseXml((await zip.file(name)!.async('string')).replace(/^﻿/, ''));
    scanned.push({ name, doc, xml: kind === 'xlsx' ? [] : scanXml(doc, names), sheet: kind === 'xlsx' ? scanSheet(doc, strings, i + 1) : [] });
  }
  const flat = scanned.flatMap((p) => [...p.xml.map((e) => ({ p, e, s: e.slot })), ...p.sheet.map((e) => ({ p, e, s: e.slot }))]);
  const slots = withIds(flat.map((x) => x.s));

  return {
    slots,
    apply: async (values) => {
      flat.forEach((x, i) => {
        const v = values[slots[i].id];
        if (v === undefined) return;
        if (kind === 'xlsx') {
          const se = x.e as SheetEntry;
          fillCell(x.p.doc, se.ref, se.placeholderOf ? se.placeholderOf.replace(PLACEHOLDER, () => v) : v);
        } else fillEntry(x.p.doc, x.e as XmlEntry, v, names);
      });
      for (const p of scanned) zip.file(p.name, serializeXml(p.doc));
      // hwpx는 mimetype을 압축하지 않고 맨 앞에 둬야 한다
      const mime = zip.file('mimetype');
      if (kind === 'hwpx' && mime) zip.file('mimetype', await mime.async('string'), { compression: 'STORE' });
      return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    }
  };
}

async function scanFile(bytes: Uint8Array, kind: TemplateKind): Promise<Scanned> {
  if (kind === 'pdf') {
    const slots = withIds(await scanPdf(bytes));
    return {
      slots,
      apply: (values) => fillPdf(bytes, new Map(slots.flatMap((s, i) => (values[s.id] !== undefined ? [[i, values[s.id]] as [number, string]] : []))))
    };
  }
  return scanZip(bytes, kind);
}

/** 파일 앞부분으로 형식을 알아낸다. 지원하지 않으면 이유를 돌려준다 */
async function detect(name: string, bytes: Uint8Array): Promise<{ kind: TemplateKind } | { error: string }> {
  const head = String.fromCharCode(...bytes.slice(0, 4));
  if (head === '%PDF') return { kind: 'pdf' };
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0)
    return { error: '예전 형식(.hwp / .doc / .xls)은 열 수 없어요. 한/글은 .hwpx로, Word는 .docx로, Excel은 .xlsx로 다시 저장해서 올려 주세요.' };
  if (head.startsWith('PK')) {
    const zip = await JSZip.loadAsync(bytes).catch(() => null);
    if (zip?.file('word/document.xml')) return { kind: 'docx' };
    if (zip?.file('xl/workbook.xml')) return { kind: 'xlsx' };
    if (zip && Object.keys(zip.files).some((f) => /^Contents\/section\d+\.xml$/.test(f))) return { kind: 'hwpx' };
    return { error: 'docx, xlsx, hwpx 파일이 아니에요.' };
  }
  return { error: `${path.extname(name) || '이'} 형식은 아직 지원하지 않아요. docx, xlsx, hwpx, 입력란이 있는 PDF를 올려 주세요.` };
}

function readMeta(): Meta | null {
  try {
    return JSON.parse(fs.readFileSync(metaPath(), 'utf8')) as Meta;
  } catch {
    return null;
  }
}

export async function analyzeTemplate(file: { name: string; data: Uint8Array }, fields: FieldDef[]): Promise<TemplateResult> {
  try {
    const bytes = new Uint8Array(file.data);
    if (bytes.length > MAX_BYTES) return { ok: false, error: '파일이 너무 커요 (20MB 이하).' };
    const d = await detect(file.name, bytes);
    if ('error' in d) return { ok: false, error: d.error };
    const { slots } = await scanFile(bytes, d.kind);
    if (slots.length === 0)
      return {
        ok: false,
        error: d.kind === 'pdf' ? '이 PDF에는 채울 수 있는 입력란이 없어요. 스캔·평면 PDF는 아직 지원하지 않으니 Word·한글 원본을 올려 주세요.' : '채울 빈 칸이나 {{표시}}를 찾지 못했어요. 양식의 빈 칸이 비어 있는지 확인해 주세요.'
      };
    const { mapping, by } = await mapSlots(slots, fields);
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(binPath(), bytes);
    const meta: Meta = { name: file.name, kind: d.kind, mapping, mappedBy: by };
    fs.writeFileSync(metaPath(), JSON.stringify(meta));
    return { ok: true, template: { ...meta, slots } };
  } catch (e) {
    return { ok: false, error: `양식을 읽지 못했어요: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 저장해 둔 양식 (없으면 null) */
export async function loadTemplate(): Promise<TemplateInfo | null> {
  const meta = readMeta();
  if (!meta || !fs.existsSync(binPath())) return null;
  try {
    const { slots } = await scanFile(new Uint8Array(fs.readFileSync(binPath())), meta.kind);
    return { ...meta, slots };
  } catch {
    return null;
  }
}

export function saveMapping(mapping: Record<string, string | null>) {
  const meta = readMeta();
  if (!meta) return false;
  fs.writeFileSync(metaPath(), JSON.stringify({ ...meta, mapping, mappedBy: 'saved' }));
  return true;
}

export function clearTemplate() {
  fs.rmSync(dir(), { recursive: true, force: true });
  return true;
}

/** values: 품의서 항목 key → 글자. 매핑된 자리에 넣어 저장 위치를 물어 저장한다 */
export async function fillTemplate(win: BrowserWindow, values: Record<string, string>): Promise<TemplateFillResult> {
  const meta = readMeta();
  if (!meta || !fs.existsSync(binPath())) return { ok: false, error: '저장된 양식이 없어요.' };
  try {
    const scanned = await scanFile(new Uint8Array(fs.readFileSync(binPath())), meta.kind);
    const bySlot: Record<string, string> = {};
    const skipped: string[] = [];
    for (const s of scanned.slots) {
      const key = meta.mapping[s.id];
      const v = key ? values[key] : undefined;
      if (key && v) bySlot[s.id] = v;
      else if (key) skipped.push(s.label);
    }
    const out = await scanned.apply(bySlot);
    const ext = meta.kind;
    const base = path.basename(meta.name, path.extname(meta.name));
    const pick = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), `${base}_작성.${ext}`), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (pick.canceled || !pick.filePath) return { ok: false };
    fs.writeFileSync(pick.filePath, out);
    return { ok: true, path: pick.filePath, skipped };
  } catch (e) {
    return { ok: false, error: `양식을 채우지 못했어요: ${e instanceof Error ? e.message : String(e)}` };
  }
}
