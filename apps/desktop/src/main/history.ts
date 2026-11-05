// 견적 히스토리: 견적 한 건(요구 조건·업체·견적·원본·추천)을 이 컴퓨터에 JSON으로 보관한다.
// 위치: <userData>/history/<id>.json — 비교가 갱신될 때마다 같은 파일을 덮어쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import type { HistoryEventPayload, HistoryRecord, HistorySummary, Quote, QuoteOriginal, Requirements, SessionSnapshot, VendorId, VendorInfo } from '@shared/types';
import { confirmedSum, recommend } from '@shared/quote';
import { emit } from './events';

const MAX_ORIGINALS = 4;
const dir = () => path.join(app.getPath('userData'), 'history');

let current: { id: string; createdAt: string } | null = null;
const originals: Partial<Record<VendorId, QuoteOriginal[]>> = {};

/** 지금 견적의 기록 id (아직 저장 전이면 null) */
export const currentRecordId = () => current?.id ?? null;

/** 새 견적을 시작할 때 (다음 저장부터 새 기록) */
export function startRecord() {
  current = null;
  for (const k of Object.keys(originals)) delete originals[k as VendorId];
}

export function addOriginal(vendorId: VendorId, o: QuoteOriginal) {
  originals[vendorId] = [...(originals[vendorId] ?? []), o].slice(-MAX_ORIGINALS);
}

/** 다른 업체로 바뀐 자리의 원본은 버린다 */
export function clearOriginals(vendorId: VendorId) {
  delete originals[vendorId];
}

export function saveRecord(requirements: Requirements, vendors: VendorInfo[], quotes: Partial<Record<VendorId, Quote>>) {
  const now = new Date().toISOString();
  current ??= { id: `${now.slice(0, 10)}-${randomUUID().slice(0, 8)}`, createdAt: now };
  const ids = new Set(vendors.map((v) => v.id));
  const rec = recommend(quotes, requirements);
  const record: HistoryRecord = {
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: now,
    requirements,
    vendors,
    quotes: Object.fromEntries(Object.entries(quotes).filter(([id]) => ids.has(id as VendorId))),
    originals: Object.fromEntries(Object.entries(originals).filter(([id]) => ids.has(id as VendorId))),
    recommendation: rec.vendorId
      ? { vendorId: rec.vendorId, vendorName: quotes[rec.vendorId]?.vendorName ?? rec.vendorId, total: confirmedSum(quotes[rec.vendorId]!, requirements), reasons: rec.reasons, tentative: rec.tentative }
      : { reasons: rec.reasons, tentative: rec.tentative }
  };
  try {
    fs.mkdirSync(dir(), { recursive: true });
    const file = path.join(dir(), `${record.id}.json`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(record));
    fs.renameSync(`${file}.tmp`, file);
    emit('history', { payload: { id: record.id, kind: 'saved' } satisfies HistoryEventPayload });
  } catch (e) {
    console.error('견적 히스토리 저장 실패', e);
  }
}

const safeId = (id: string) => /^[\w-]+$/.test(id);

function readRecord(id: string): HistoryRecord | null {
  if (!safeId(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(dir(), `${id}.json`), 'utf8')) as HistoryRecord;
  } catch {
    return null;
  }
}

export function listRecords(): HistorySummary[] {
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir()).filter((f) => f.endsWith('.json') && !f.endsWith('.session.json'));
  } catch {
    return [];
  }
  const out: HistorySummary[] = [];
  for (const f of files) {
    const r = readRecord(f.replace(/\.json$/, ''));
    if (!r) continue;
    const priced = Object.values(r.quotes).filter((q) => q && q.listedPrice.value !== null).length;
    out.push({
      id: r.id,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      item: r.requirements.item,
      quantity: r.requirements.quantity,
      vendorCount: r.vendors.length,
      pricedCount: priced,
      best: r.recommendation?.vendorName && r.recommendation.total !== undefined ? { name: r.recommendation.vendorName, total: r.recommendation.total } : undefined
    });
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export const getRecord = (id: string) => readRecord(id);

export function deleteRecord(id: string) {
  if (!safeId(id)) return false;
  try {
    fs.unlinkSync(path.join(dir(), `${id}.json`));
    fs.rmSync(path.join(dir(), `${id}.session.json`), { force: true });
    if (current?.id === id) current = null;
    emit('history', { payload: { id, kind: 'deleted' } satisfies HistoryEventPayload });
    return true;
  } catch {
    return false;
  }
}

/** renderer가 보낸 세션 화면을 기록 옆에 저장 (<id>.session.json). 기록이 있는 견적만 */
export function saveSession(id: string, snap: SessionSnapshot) {
  if (!safeId(id) || !fs.existsSync(path.join(dir(), `${id}.json`))) return false;
  try {
    const file = path.join(dir(), `${id}.session.json`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(snap));
    fs.renameSync(`${file}.tmp`, file);
    return true;
  } catch (e) {
    console.error('세션 저장 실패', e);
    return false;
  }
}

export function getSession(id: string): SessionSnapshot | null {
  if (!safeId(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(dir(), `${id}.session.json`), 'utf8')) as SessionSnapshot;
  } catch {
    return null;
  }
}
