// docx / hwpx 공통: 표 칸과 문단을 훑어 채울 자리를 찾고 글자를 넣는다 (XML 구조가 비슷해 이름만 바꿔 쓴다)
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { TemplateSlot } from '@shared/template';

export interface XmlNames {
  table: string;
  row: string;
  cell: string;
  para: string;
  run: string;
  text: string;
}
export const DOCX_NAMES: XmlNames = { table: 'tbl', row: 'tr', cell: 'tc', para: 'p', run: 'r', text: 't' };
export const HWPX_NAMES: XmlNames = { table: 'tbl', row: 'tr', cell: 'tc', para: 'p', run: 'run', text: 't' };

/** 자리표시 문구: {{ }}, ____, ○○○, □, [ ], (   ), ...... */
export const PLACEHOLDER = /\{\{[^}]*\}\}|[_＿]{3,}|[○◯]{2,}|□+|\[\s*\]|\(\s{2,}\)|【\s*】|\.{5,}/;

const MAX_SLOTS = 120;

export interface XmlEntry {
  slot: Omit<TemplateSlot, 'id'>;
  el: Element;
  /** cell = 비어 있는 표 칸, para = 자리표시 문구가 든 문단 */
  kind: 'cell' | 'para';
}

type El = Element;
const kids = (e: El) => Array.from(e.childNodes as unknown as ArrayLike<Node>).filter((n): n is El => n.nodeType === 1);
const local = (e: El) => e.localName || e.nodeName.split(':').pop() || '';

function descendants(e: El, name: string, out: El[] = []): El[] {
  for (const c of kids(e)) {
    if (local(c) === name) out.push(c);
    descendants(c, name, out);
  }
  return out;
}
const textOf = (e: El, n: XmlNames) =>
  descendants(e, n.text)
    .map((t) => t.textContent ?? '')
    .join('');

export function parseXml(xml: string) {
  return new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document;
}
export const serializeXml = (doc: Document) => new XMLSerializer().serializeToString(doc as never);

/** 문서 순서대로 채울 자리를 모은다 (같은 파일이면 항상 같은 순서) */
export function scanXml(doc: Document, n: XmlNames): XmlEntry[] {
  const out: XmlEntry[] = [];
  const walk = (e: El, tableNo: number) => {
    const name = local(e);
    if (out.length >= MAX_SLOTS) return;
    if (name === n.cell) {
      const nested = descendants(e, n.table).length > 0;
      if (!nested && textOf(e, n).trim() === '') {
        const row = e.parentNode as El;
        const cells = kids(row).filter((c) => local(c) === n.cell);
        const idx = cells.indexOf(e);
        const tbl = row.parentNode as El;
        const rows = kids(tbl).filter((r) => local(r) === n.row);
        const rIdx = rows.indexOf(row);
        const header = rows[0]
          ? kids(rows[0])
              .filter((c) => local(c) === n.cell)
              .map((c) => textOf(c, n).trim())
          : [];
        const left = cells
          .slice(0, idx)
          .reverse()
          .map((c) => textOf(c, n).trim())
          .find(Boolean);
        const head = header[idx] ?? '';
        const tableLike = rIdx > 0 && header.filter(Boolean).length >= 3 && rows.length >= 3;
        const label = tableLike && head ? `${head} (${rIdx}행)` : left || head || '(이름 없는 칸)';
        out.push({ slot: { label, context: `표 ${tableNo}, ${rIdx + 1}행 ${idx + 1}열` }, el: e, kind: 'cell' });
        return;
      }
    }
    if (name === n.para) {
      const t = textOf(e, n);
      if (PLACEHOLDER.test(t)) {
        out.push({ slot: { label: t.trim().slice(0, 60), current: t.trim().slice(0, 80) }, el: e, kind: 'para' });
        return;
      }
    }
    let tNo = tableNo;
    if (name === n.table) tNo += 1;
    for (const c of kids(e)) walk(c, tNo);
  };
  walk(doc.documentElement, 0);
  return out;
}

/** 문단 하나의 글자를 통째로 바꾼다 (첫 런의 서식을 유지) */
function setParaText(doc: Document, p: El, text: string, n: XmlNames) {
  const ns = p.namespaceURI;
  const prefix = p.prefix ? `${p.prefix}:` : '';
  let runs = kids(p).filter((c) => local(c) === n.run);
  if (runs.length === 0) {
    const r = doc.createElementNS(ns, `${prefix}${n.run}`);
    if (n.run === 'run') r.setAttribute('charPrIDRef', '0');
    p.appendChild(r);
    runs = [r];
  }
  for (const r of runs) for (const t of kids(r).filter((c) => local(c) === n.text)) r.removeChild(t);
  const t = doc.createElementNS(runs[0].namespaceURI, `${runs[0].prefix ? `${runs[0].prefix}:` : ''}${n.text}`);
  t.setAttribute('xml:space', 'preserve');
  t.appendChild(doc.createTextNode(text));
  runs[0].appendChild(t);
  // hwpx: 줄 배치 캐시는 한/글이 다시 계산한다
  for (const c of kids(p).filter((x) => local(x) === 'linesegarray')) p.removeChild(c);
}

/** 여러 줄이면 문단을 복제해 줄마다 넣는다 */
function setLines(doc: Document, p: El, text: string, n: XmlNames) {
  const lines = text.split('\n');
  setParaText(doc, p, lines[0], n);
  let prev = p;
  for (const line of lines.slice(1)) {
    const copy = p.cloneNode(true) as El;
    setParaText(doc, copy, line, n);
    prev.parentNode!.insertBefore(copy, prev.nextSibling);
    prev = copy;
  }
}

/** inline=true면 여러 줄도 문단 하나에 줄바꿈 글자로 둔다 (미리보기에서 칸을 한 덩어리로 고치기 위해) */
export function fillEntry(doc: Document, entry: XmlEntry, value: string, n: XmlNames, inline = false) {
  const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const put = (p: Element, text: string) => (inline ? setParaText(doc, p, text, n) : setLines(doc, p, text, n));
  if (entry.kind === 'para') {
    const current = textOf(entry.el, n);
    put(entry.el, current.replace(PLACEHOLDER, () => clean));
    return;
  }
  const p = descendants(entry.el, n.para)[0];
  if (p) put(p, clean);
}
