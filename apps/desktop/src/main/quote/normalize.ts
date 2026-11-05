// 추출 결과 정규화: 원 단위 정수, VAT 포함, 일/개월 단위
import type { FieldKey, QuoteMeta, ReportedField, ReportedFields, Source } from '@shared/types';
import { FIELD_KEYS } from '@shared/types';
import { parseDays, parseKrw, parseMonths } from '@shared/parse';

const MONEY: FieldKey[] = ['listedPrice', 'installFee', 'shippingFee', 'warrantyExtraFee'];

export interface NormalizedField {
  value: number;
  snippet: string;
}

export function normalizeField(key: FieldKey, f: ReportedField): NormalizedField | null {
  if (f.value === null || f.value === undefined) return null;
  let value: number | null;
  if (MONEY.includes(key)) {
    value = parseKrw(f.value);
    // "VAT 별도" 금액은 부가세 포함으로 통일
    const vatExcluded = f.vatIncluded === false || (typeof f.snippet === 'string' && /(VAT|부가세)\s*별도/.test(f.snippet));
    if (value !== null && vatExcluded && value > 0) value = Math.round(value * 1.1);
  } else if (key === 'leadTimeDays') {
    value = parseDays(f.value);
  } else {
    value = parseMonths(f.value);
  }
  if (value === null || Number.isNaN(value)) return null;
  return { value, snippet: String(f.snippet ?? '').slice(0, 200) };
}

/** 도구 입력({value, snippet, vat_included})이나 구조화 출력을 ReportedFields로 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toReported(raw: any): ReportedFields {
  const out: ReportedFields = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of FIELD_KEYS) {
    const f = raw[k];
    if (f && typeof f === 'object' && f.value !== null && f.value !== undefined) {
      out[k] = { value: f.value, snippet: String(f.snippet ?? ''), vatIncluded: f.vat_included ?? f.vatIncluded };
    }
  }
  return out;
}

/** 도구 입력이나 구조화 출력의 부가 정보 → QuoteMeta */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toMeta(raw: any, src: { channel: Source['channel']; ref: string }): QuoteMeta {
  if (!raw || typeof raw !== 'object') return {};
  const clean = (o: Record<string, unknown> | null | undefined) =>
    Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, String(v).trim().slice(0, 120)]));
  const now = new Date().toISOString();
  const pq = Number(raw.fields?.listedPrice?.price_qty ?? raw.price_qty) || inferPriceQty(raw.fields?.listedPrice?.snippet ?? raw.listedPrice?.snippet);
  return {
    // 1도 그대로 둔다: 재확인에서 "1개 가격이 맞다"로 바로잡을 수 있게
    priceQty: Number.isFinite(pq) && pq >= 1 ? Math.round(pq) : undefined,
    productName: raw.product?.name || undefined,
    spec: raw.product?.spec || undefined,
    supplier: clean(raw.supplier),
    terms: clean(raw.terms),
    extras: Array.isArray(raw.extras)
      ? raw.extras
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((e: any) => e && e.name && Number.isFinite(parseKrw(e.amount)))
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((e: any) => ({
            name: String(e.name).slice(0, 40),
            amount: parseKrw(e.amount) ?? 0,
            required: Boolean(e.required),
            note: e.note || undefined,
            source: { ...src, snippet: String(e.snippet ?? '').slice(0, 200), capturedAt: now }
          }))
      : [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    notes: Array.isArray(raw.notes) ? raw.notes.filter((n: any) => typeof n === 'string' && n.trim()).map((n: string) => n.trim().slice(0, 120)).slice(0, 6) : []
  };
}

/** "500매 9,000원", "3000장 기준 85,000원" 같은 근거에서 기준 수량을 읽는다 (가격 바로 앞뒤의 수량만) */
export function inferPriceQty(snippet: unknown): number {
  if (typeof snippet !== 'string') return 0;
  const m =
    snippet.match(/([\d,]{2,})\s*(?:매|장|개|ea|EA|부|pcs)\s*(?:기준|당|에)?\s*[:：]?\s*[₩]?\s*[\d,]{3,}\s*원/) ??
    snippet.match(/[\d,]{3,}\s*원\s*[(/]\s*([\d,]{2,})\s*(?:매|장|개|ea|EA|부|pcs)/);
  const n = m ? Number(m[1].replace(/,/g, '')) : 0;
  return n > 1 && n < 1_000_000 ? n : 0;
}

/** 원문에서 납기 추정에 쓰는 패턴: "제작 기간 7일", "출고까지 3영업일", "발송 소요 2일", "작업일 5일" */
const LEAD_TIME_RE = /(제작|출고|발송|작업)[^0-9]{0,6}(\d+)\s*(영업)?일/;

/**
 * 안전망: 에이전트가 납기(leadTimeDays)를 빠뜨렸을 때 원문에서 채운다.
 * 근거에는 "원문 추정"을 붙여 사람이 확인할 수 있게 한다.
 */
export function fillLeadTimeFromText(fields: ReportedFields, text: string | null | undefined): ReportedFields {
  if (fields.leadTimeDays || !text) return fields;
  const m = text.replace(/\s+/g, ' ').match(LEAD_TIME_RE);
  if (!m) return fields;
  const days = Number(m[2]);
  if (!Number.isFinite(days) || days <= 0 || days > 365) return fields;
  return { ...fields, leadTimeDays: { value: days, snippet: `원문 추정 · ${m[0].trim()}` } };
}
