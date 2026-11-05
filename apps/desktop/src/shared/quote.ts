// 총액·순위·조건 판정·추천·확인 질문 (순수 함수, main과 renderer가 같은 규칙을 쓴다)
import type { Field, FieldKey, Quote, Requirements, VendorId } from './types';
import { FIELD_KEYS } from './types';
import { localIsoDate } from './parse';

export const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

const val = (f: Field<number>) => f.value ?? 0;

/** 총액에 들어가야 하는 필드 (설치·A/S가 필요 없으면 제외) */
/** 이 요구 조건에서 필요한 항목만. 설치·A/S·배송이 필요 없으면 빼서 "확인 필요"로 남지 않게 한다 */
export function requiredKeys(req: Requirements | null): FieldKey[] {
  const noWarranty = req !== null && req.minWarrantyMonths <= 0;
  const noDelivery = req?.needDelivery === false;
  return FIELD_KEYS.filter(
    (k) =>
      (k !== 'installFee' || (req?.needInstall ?? true)) &&
      !(noWarranty && (k === 'warrantyMonths' || k === 'warrantyExtraFee')) &&
      !(noDelivery && k === 'shippingFee')
  );
}

/** 합계에 들어가는 금액 항목 (납기·A/S 기간은 금액이 아니라 비어 있어도 합계는 낼 수 있다) */
export const COST_KEYS: FieldKey[] = ['listedPrice', 'installFee', 'shippingFee', 'warrantyExtraFee'];

/** 누락 필드: A/S는 기간이나 연장비 중 하나로 요구 기간 충족을 판정할 수 있으면 누락 아님 */
export function missingKeys(q: Quote, req: Requirements | null): FieldKey[] {
  return requiredKeys(req).filter((k) => {
    if (q[k].value !== null) return false;
    if (k === 'warrantyMonths' && q.warrantyExtraFee.value !== null) return false;
    if (k === 'warrantyExtraFee' && q.warrantyMonths.value !== null && req && q.warrantyMonths.value >= req.minWarrantyMonths) return false;
    return true;
  });
}

/** 필수 추가 비용 (출장비·철거비 등) */
export const extraSum = (q: Quote) => (q.meta?.extras ?? []).filter((e) => e.required).reduce((s, e) => s + e.amount, 0);

/** 표시가의 기준 수량 (1개 가격이면 1, "1000매 12,430원"이면 1000) */
export const priceQty = (q: Quote) => Math.max(1, q.meta?.priceQty ?? 1);

/** 요구 수량만큼의 제품 금액: 표시가 × (요구 수량 ÷ 기준 수량) */
export function productAmount(q: Quote, req: Requirements | null): number | null {
  if (q.listedPrice.value === null) return null;
  return Math.round(q.listedPrice.value * ((req?.quantity ?? 1) / priceQty(q)));
}

/** 현재 확인된 금액 합계: 제품 금액 + 설치비(필요 시) + 배송비 + A/S 연장비 + 필수 추가 비용 */
export function confirmedSum(q: Quote, req: Requirements | null): number {
  const install = req?.needInstall ?? true ? val(q.installFee) : 0;
  return (productAmount(q, req) ?? 0) + install + val(q.shippingFee) + val(q.warrantyExtraFee) + extraSum(q);
}

export function recompute(q: Quote, req: Requirements | null): Quote {
  const missing = missingKeys(q, req);
  const costMissing = missing.filter((k) => COST_KEYS.includes(k));
  return { ...q, missing, totalPrice: costMissing.length === 0 ? confirmedSum(q, req) : null };
}

/** 정렬: 표시가가 있는 업체만 확인된 합계 오름차순, 나머지는 뒤로 */
export function rankQuotes(quotes: Partial<Record<VendorId, Quote>>, req: Requirements | null): VendorId[] {
  const list = Object.values(quotes).filter(Boolean) as Quote[];
  return list
    .sort((a, b) => {
      const ak = a.listedPrice.value === null ? Infinity : confirmedSum(a, req);
      const bk = b.listedPrice.value === null ? Infinity : confirmedSum(b, req);
      return ak - bk || a.vendorId.localeCompare(b.vendorId);
    })
    .map((q) => q.vendorId);
}

/** 표시가 기준 최저 업체 (순위 역전 연출의 주인공) */
export function lowestListed(quotes: Partial<Record<VendorId, Quote>>): VendorId | null {
  const list = (Object.values(quotes).filter(Boolean) as Quote[]).filter((q) => q.listedPrice.value !== null);
  if (list.length === 0) return null;
  return list.sort((a, b) => a.listedPrice.value! - b.listedPrice.value!)[0].vendorId;
}

export function daysUntil(deadlineIso: string, from = new Date()): number {
  const d = new Date(`${deadlineIso}T23:59:59`);
  return Math.max(0, Math.ceil((d.getTime() - from.getTime()) / 86_400_000) - 1);
}

export type Check = 'ok' | 'violate' | 'unknown';
export interface ConditionResult {
  budget: Check;
  deadline: Check;
  warranty: Check;
  overall: Check;
  violations: string[];
}

export function evaluateConditions(q: Quote, req: Requirements): ConditionResult {
  const missing = missingKeys(q, req);
  const sum = confirmedSum(q, req);
  const costMissing = missing.some((k) => k !== 'leadTimeDays' && k !== 'warrantyMonths');
  const budget: Check = sum > req.budgetMax ? 'violate' : costMissing ? 'unknown' : 'ok';
  const limit = daysUntil(req.deadline);
  const lead = q.leadTimeDays.value;
  const deadline: Check = lead === null ? 'unknown' : lead > limit ? 'violate' : 'ok';
  let warranty: Check = req.minWarrantyMonths <= 0 ? 'ok' : 'unknown';
  if (q.warrantyMonths.value !== null && q.warrantyMonths.value >= req.minWarrantyMonths) warranty = 'ok';
  else if (q.warrantyExtraFee.value !== null) warranty = 'ok';
  const violations: string[] = [];
  if (q.meta?.priceDoubt) violations.push('가격 기준(1개·묶음) 확인 필요');
  if (budget === 'violate') violations.push(`총액 ${won(sum)}로 예산 ${won(req.budgetMax)} 초과`);
  if (deadline === 'violate') violations.push(`납기 ${lead}일로 요청 기한(${limit}일) 초과`);
  // 가격 기준을 확인하지 못한 견적은 금액 비교 자체를 믿을 수 없으니 조건 위반처럼 추천에서 뺀다
  const checks = [budget, deadline, warranty, q.meta?.priceDoubt ? ('violate' as Check) : ('ok' as Check)];
  const overall: Check = checks.includes('violate') ? 'violate' : checks.includes('unknown') ? 'unknown' : 'ok';
  return { budget, deadline, warranty, overall, violations };
}

export interface Recommendation {
  vendorId: VendorId | null;
  tentative: boolean;
  reasons: string[];
}

/** 추천 = 조건 충족 업체 중 총액 최저. 이유 3줄 */
export function recommend(quotes: Partial<Record<VendorId, Quote>>, req: Requirements): Recommendation {
  const list = (Object.values(quotes).filter(Boolean) as Quote[]).filter((q) => q.listedPrice.value !== null);
  if (list.length === 0) return { vendorId: null, tentative: true, reasons: ['아직 비교할 견적이 없습니다.'] };
  const evaluated = list.map((q) => ({ q, c: evaluateConditions(q, req), sum: confirmedSum(q, req) }));
  const candidates = evaluated.filter((e) => e.c.overall !== 'violate').sort((a, b) => a.sum - b.sum);
  const reasons: string[] = [];
  const pick = candidates[0];
  if (pick) {
    const unknown = missingKeys(pick.q, req).map((k) => labelOf(k));
    reasons.push(
      pick.c.overall === 'ok'
        ? `${pick.q.vendorName}: 총액 ${won(pick.sum)}, 납기 ${pick.q.leadTimeDays.value}일로 모든 조건 충족`
        : `${pick.q.vendorName}: 확인된 총액 ${won(pick.sum)} (${unknown.join(', ')} 확인 필요)`
    );
  } else {
    reasons.push('모든 조건을 만족하는 업체가 없습니다. 조건 완화나 협상이 필요합니다.');
  }
  const cheapest = [...evaluated].sort((a, b) => a.sum - b.sum)[0];
  for (const e of evaluated.sort((a, b) => a.sum - b.sum)) {
    if (e === pick || reasons.length >= 3) continue;
    if (e.c.violations.length > 0) {
      const lead = e === cheapest ? `총액 최저(${won(e.sum)})지만 ` : '';
      reasons.push(`${e.q.vendorName}는 ${lead}${e.c.violations.join(', ')}`);
    } else {
      reasons.push(`${e.q.vendorName}는 총액 ${won(e.sum)}로 더 비쌈`);
    }
  }
  return { vendorId: pick?.q.vendorId ?? null, tentative: pick ? pick.c.overall !== 'ok' : true, reasons };
}

function labelOf(k: FieldKey) {
  return { listedPrice: '단가', installFee: '설치비', shippingFee: '배송비', warrantyMonths: 'A/S', warrantyExtraFee: 'A/S', leadTimeDays: '납기' }[k];
}

const QUESTION_TEXT: Record<FieldKey, string> = {
  listedPrice: '제품 단가가 얼마인가요? (부가세 포함 여부도 알려 주세요)',
  installFee: '설치비가 포함인가요? 별도라면 얼마인가요?',
  shippingFee: '배송비가 있나요?',
  warrantyMonths: 'A/S 기간과 연장 비용이 어떻게 되나요?',
  warrantyExtraFee: 'A/S 기간과 연장 비용이 어떻게 되나요?',
  leadTimeDays: '주문 후 받기까지 며칠 걸리나요?'
};

export interface ConfirmQuestion {
  vendorId: VendorId;
  fields: FieldKey[];
  lines: string[];
  text: string;
}

/** 누락 필드마다 업체별 확인 질문 */
export function confirmQuestions(quotes: Partial<Record<VendorId, Quote>>, req: Requirements): ConfirmQuestion[] {
  const out: ConfirmQuestion[] = [];
  for (const q of Object.values(quotes).filter(Boolean) as Quote[]) {
    if (q.listedPrice.value === null) continue;
    const fields = missingKeys(q, req);
    if (fields.length === 0) continue;
    const lines = [...new Set(fields.map((k) => QUESTION_TEXT[k]))];
    out.push({ vendorId: q.vendorId, fields, lines, text: `${q.vendorName}: ${lines.join(' ')}` });
  }
  return out;
}

// ─── 통일 견적서 ──────────────────────────────────────────────

const KOR_DIGIT = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const KOR_SMALL = ['', '십', '백', '천'];
const KOR_BIG = ['', '만', '억', '조'];

/** 495000 → "사십구만오천" */
export function koreanAmount(n: number): string {
  if (n <= 0) return '영';
  let out = '';
  let group = 0;
  while (n > 0) {
    const chunk = n % 10000;
    if (chunk > 0) {
      let s = '';
      const digits = String(chunk).padStart(4, '0').split('').map(Number);
      digits.forEach((d, i) => {
        if (d === 0) return;
        const pos = 3 - i;
        s += (d === 1 && pos > 0 ? '' : KOR_DIGIT[d]) + KOR_SMALL[pos];
      });
      out = s + KOR_BIG[group] + out;
    }
    n = Math.floor(n / 10000);
    group++;
  }
  return out;
}

export interface QuoteDoc {
  vendorId: Quote['vendorId'];
  no: string;
  date: string;
  supplier: { name: string; url?: string; bizNo?: string; ceo?: string; phone?: string; email?: string; address?: string };
  terms: { validity?: string; delivery?: string; payment?: string; place?: string };
  lines: import('./types').QuoteLine[];
  total: number;
  supply: number;
  vat: number;
  notes: string[];
  /** 비어 있는 항목 전체 */
  missing: string[];
  /** 비어 있는 금액 항목 (합계에 반영 못 함) */
  missingCost: string[];
  /** 비어 있는 금액 외 항목 (납기·A/S 기간 — 업체 확인 필요) */
  missingInfo: string[];
  /** 금액 항목이 모두 있어 합계가 확정됨 */
  complete: boolean;
}

/** 서로 다른 형태(웹·메일·파일)의 견적을 하나의 양식으로 */
export function buildDoc(q: Quote, req: Requirements, url?: string): QuoteDoc {
  const qty = req.quantity || 1;
  const m = q.meta ?? {};
  const lines: QuoteDoc['lines'] = [];
  const pq = priceQty(q);
  lines.push({
    kind: 'product',
    name: m.productName || req.item,
    spec: m.spec,
    qty,
    // 묶음 가격이면 1개(매)당 단가로 환산해 보여 준다
    unitPrice: q.listedPrice.value === null ? null : pq > 1 ? Math.round((q.listedPrice.value / pq) * 10) / 10 : q.listedPrice.value,
    amount: productAmount(q, req),
    note: pq > 1 && q.listedPrice.value !== null ? `${pq.toLocaleString('ko-KR')}개 기준 ${q.listedPrice.value.toLocaleString('ko-KR')}원` : undefined,
    counted: true,
    source: q.listedPrice.source
  });
  if (req.needInstall)
    lines.push({ kind: 'install', name: '설치비', qty: 1, unitPrice: q.installFee.value, amount: q.installFee.value, note: q.installFee.value === 0 ? '포함' : undefined, counted: true, source: q.installFee.source });
  if (req.needDelivery !== false) lines.push({ kind: 'shipping', name: '배송비', qty: 1, unitPrice: q.shippingFee.value, amount: q.shippingFee.value, note: q.shippingFee.value === 0 ? '무료' : undefined, counted: true, source: q.shippingFee.source });
  const wm = q.warrantyMonths.value;
  const wx = q.warrantyExtraFee.value;
  if (req.minWarrantyMonths > 0 && (wx ? true : wx === null ? !(wm !== null && wm >= req.minWarrantyMonths) : false))
    lines.push({
      kind: 'warranty',
      name: `A/S 연장 (${req.minWarrantyMonths}개월 맞춤)`,
      qty: 1,
      unitPrice: q.warrantyExtraFee.value,
      amount: q.warrantyExtraFee.value,
      note: q.warrantyExtraFee.value === 0 ? '기본 A/S로 충족' : undefined,
      counted: true,
      source: q.warrantyExtraFee.source
    });
  for (const e of m.extras ?? [])
    lines.push({ kind: e.required ? 'extra' : 'option', name: e.name, qty: 1, unitPrice: e.amount, amount: e.amount, note: e.required ? e.note : `선택 · 총액 제외${e.note ? ` · ${e.note}` : ''}`, counted: e.required, source: e.source });

  const total = confirmedSum(q, req);
  const supply = Math.round(total / 1.1);
  const LABEL: Record<FieldKey, string> = { listedPrice: '단가', installFee: '설치비', shippingFee: '배송비', warrantyMonths: 'A/S 기간', warrantyExtraFee: 'A/S 연장비', leadTimeDays: '납기' };
  const missingAll = missingKeys(q, req);
  const missing = missingAll.map((k) => LABEL[k]);
  const missingCost = missingAll.filter((k) => COST_KEYS.includes(k)).map((k) => LABEL[k]);
  const missingInfo = missingAll.filter((k) => !COST_KEYS.includes(k)).map((k) => LABEL[k]);
  const notes = [
    '금액은 모두 부가세 포함 기준으로 통일했습니다.',
    wm !== null ? `기본 A/S ${wm % 12 === 0 && wm >= 12 ? `${wm / 12}년` : `${wm}개월`}` : '',
    ...(m.notes ?? [])
  ].filter(Boolean);
  const today = localIsoDate();
  return {
    vendorId: q.vendorId,
    no: `DL-${today.replace(/-/g, '')}-${q.vendorId}`,
    date: today,
    supplier: { name: q.vendorName, url, ...(m.supplier ?? {}) },
    terms: {
      validity: m.terms?.validity,
      delivery: m.terms?.delivery ?? m.terms?.leadTimeText ?? (q.leadTimeDays.value !== null ? `주문 후 ${q.leadTimeDays.value}일` : undefined),
      payment: m.terms?.payment,
      place: m.terms?.place ?? req.region
    },
    lines,
    total,
    supply,
    vat: total - supply,
    notes,
    missing: [...new Set(missing)],
    missingCost: [...new Set(missingCost)],
    missingInfo: [...new Set(missingInfo)],
    complete: missingCost.length === 0
  };
}
