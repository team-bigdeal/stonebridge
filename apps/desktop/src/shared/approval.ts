// 구매 품의서 데이터 (템플릿 방식). 숫자·순위·조건·추천은 quote.ts의 기존 함수 결과만 쓰고 새로 계산하지 않는다.
// 모든 숫자와 사실에는 근거 번호를 붙이고, 붙임(evidence)에 출처를 모은다.
import type { Channel, FieldKey, Quote, Requirements, Source, VendorId } from './types';
import { FIELD_LABELS } from './types';
import { buildDoc, confirmQuestions, evaluateConditions, koreanAmount, missingKeys, priceQty, rankQuotes, recommend, won, type Check } from './quote';

/** 문서를 만들 때 바깥에서 받는 값 (순수 함수 유지를 위해 날짜는 받는다) */
export interface ApprovalMeta {
  /** 기안일 (YYYY-MM-DD) */
  date: string;
}

/** 붙임 한 줄: 값 하나의 출처 */
export interface Evidence {
  id: number;
  /** requirement = 사용자가 입력한 요구 조건, source = 업체에서 수집한 값 */
  kind: 'requirement' | 'source';
  vendorName?: string;
  /** 항목 이름 (표시가, 납기, 결제조건 …) */
  item: string;
  /** 문서에 적은 값 */
  valueText: string;
  /** 없으면 "출처 없음" */
  source?: Source;
}

/** 문장 + 근거 번호 (2단계에서 AI 문장도 같은 모양으로 받는다) */
export interface ApprovalSentence {
  text: string;
  evidenceIds: number[];
}

export interface ApprovalItem {
  name: string;
  spec?: string;
  qty: number;
  unitPrice: number | null;
  amount: number | null;
  note?: string;
  counted: boolean;
  evidenceIds: number[];
}

export interface ApprovalVendorRow {
  vendorId: VendorId;
  vendorName: string;
  channel: Channel;
  url?: string;
  recommended: boolean;
  /** 확인된 금액 합계 (부가세 포함) */
  total: number;
  /** 금액 항목이 모두 확인돼 합계가 확정됐는지 */
  complete: boolean;
  leadTime: string;
  warranty: string;
  overall: Check;
  violations: string[];
  evidenceIds: number[];
}

export interface ApprovalBudget {
  supply: number;
  vat: number;
  total: number;
  totalKorean: string;
  budgetMax: number;
  /** 예산 - 합계 (음수면 초과) */
  remaining: number;
  complete: boolean;
  evidenceIds: number[];
}

export interface ApprovalTerm {
  label: string;
  /** 값이 없으면 null */
  value: string | null;
  evidenceIds: number[];
}

export interface ApprovalDoc {
  title: string;
  date: string;
  /** 선정 보류 품의서인지 */
  hold: boolean;
  tentative: boolean;
  vendorId: VendorId | null;
  vendorName: string | null;
  /** 1. 목적 */
  purpose: ApprovalSentence[];
  /** 2. 구매 내역 (추천 업체의 통일 견적서 품목) */
  items: ApprovalItem[];
  /** 3. 업체 비교 */
  vendors: ApprovalVendorRow[];
  /** 3. 선정 사유 (recommend().reasons) */
  reasons: ApprovalSentence[];
  /** 4. 소요 예산 (선정 보류면 null) */
  budget: ApprovalBudget | null;
  /** 5. 납기·결제·인도 조건 */
  terms: ApprovalTerm[];
  /** 6. 확인 필요 사항 */
  checks: ApprovalSentence[];
  /** 붙임 */
  evidence: Evidence[];
  /** AI가 다듬은 문장 수 (0이면 템플릿 문장 그대로) */
  polishedCount?: number;
}

const n = (v: number) => v.toLocaleString('ko-KR');

export function buildApproval(quotes: Partial<Record<VendorId, Quote>>, req: Requirements, urls: Partial<Record<VendorId, string>>, meta: ApprovalMeta): ApprovalDoc {
  // ─── 근거 등록 (같은 값은 같은 번호) ───
  const evidence: Evidence[] = [];
  const byKey = new Map<string, number>();
  const reg = (key: string, e: Omit<Evidence, 'id'>) => {
    const hit = byKey.get(key);
    if (hit !== undefined) return hit;
    const id = evidence.length + 1;
    evidence.push({ id, ...e });
    byKey.set(key, id);
    return id;
  };
  const reqEv = () =>
    reg('req', {
      kind: 'requirement',
      item: '요구 조건',
      valueText: `${req.item} ${req.quantity}개 · 예산 ${won(req.budgetMax)} 이하 · ${req.deadline}까지 · 설치 ${req.needInstall ? '필요' : '불필요'} · A/S ${req.minWarrantyMonths > 0 ? `${req.minWarrantyMonths}개월 이상` : '불필요'}`
    });
  const fieldText = (q: Quote, k: FieldKey) => {
    const v = q[k].value as number;
    if (k === 'warrantyMonths') return `${v}개월`;
    if (k === 'leadTimeDays') return `${v}일`;
    if (k === 'listedPrice') return priceQty(q) > 1 ? `${won(v)} (${n(priceQty(q))}개 기준)` : won(v);
    return won(v);
  };
  /** 값이 있는 필드만 번호를 받는다. 값이 없으면 undefined (6번 섹션에서 확인 필요로 다룸) */
  const fieldEv = (q: Quote, k: FieldKey) => (q[k].value === null ? undefined : reg(`${q.vendorId}:${k}`, { kind: 'source', vendorName: q.vendorName, item: FIELD_LABELS[k], valueText: fieldText(q, k), source: q[k].source }));
  const ids = (...list: (number | undefined)[]) => list.filter((x): x is number => x !== undefined);

  const rec = recommend(quotes, req);
  const hold = rec.vendorId === null;
  const priced = rankQuotes(quotes, req).filter((id) => quotes[id]?.listedPrice.value !== null);
  const pick = rec.vendorId ? quotes[rec.vendorId]! : null;
  const doc = pick ? buildDoc(pick, req, urls[pick.vendorId]) : null;

  // ─── 1. 목적 ───
  const purpose: ApprovalSentence[] = [];
  const extraReq = [req.needInstall ? '설치 포함' : '', req.minWarrantyMonths > 0 ? `A/S ${req.minWarrantyMonths}개월 이상` : '', req.needDelivery === false ? '배송 불필요' : '', req.region ?? ''].filter(Boolean);
  purpose.push({
    text: `${req.item} ${req.quantity}개를 ${req.deadline}까지 구매하고자 합니다. (예산 ${won(req.budgetMax)} 이하${extraReq.length ? `, ${extraReq.join(', ')}` : ''})`,
    evidenceIds: [reqEv()]
  });
  if (priced.length > 0)
    purpose.push({
      text: `웹·메일·파일로 받은 업체 ${priced.length}곳의 견적을 같은 기준(부가세 포함)으로 비교했습니다.`,
      evidenceIds: priced.flatMap((id) => ids(fieldEv(quotes[id]!, 'listedPrice')))
    });
  purpose.push(
    pick
      ? { text: `비교 결과 ${pick.vendorName}을(를) 구매 업체로 선정하고자 합니다.${rec.tentative ? ' (확인 필요 항목이 있어 잠정 선정)' : ''}`, evidenceIds: ids(fieldEv(pick, 'listedPrice')) }
      : { text: '조건을 모두 만족하는 업체를 정하지 못해 선정을 보류합니다.', evidenceIds: [reqEv()] }
  );

  // ─── 2. 구매 내역 ───
  const items: ApprovalItem[] = [];
  if (pick && doc) {
    for (const l of doc.lines) {
      let eid: number | undefined;
      if (l.kind === 'product') eid = fieldEv(pick, 'listedPrice');
      else if (l.kind === 'install') eid = fieldEv(pick, 'installFee');
      else if (l.kind === 'shipping') eid = fieldEv(pick, 'shippingFee');
      else if (l.kind === 'warranty') eid = fieldEv(pick, 'warrantyExtraFee');
      else {
        const ex = (pick.meta?.extras ?? []).find((e) => e.name === l.name);
        if (ex) eid = reg(`${pick.vendorId}:extra:${ex.name}`, { kind: 'source', vendorName: pick.vendorName, item: ex.name, valueText: won(ex.amount), source: ex.source });
      }
      items.push({ name: l.name, spec: l.spec, qty: l.qty, unitPrice: l.unitPrice, amount: l.amount, note: l.note, counted: l.counted, evidenceIds: ids(eid) });
    }
  }

  // ─── 3. 업체 비교 ───
  const vendors: ApprovalVendorRow[] = priced.map((id) => {
    const q = quotes[id]!;
    const d = buildDoc(q, req, urls[id]);
    const c = evaluateConditions(q, req);
    const wm = q.warrantyMonths.value;
    return {
      vendorId: id,
      vendorName: q.vendorName,
      channel: q.channel,
      url: urls[id],
      recommended: id === rec.vendorId,
      total: d.total,
      complete: d.complete,
      leadTime: q.leadTimeDays.value === null ? '?' : `${q.leadTimeDays.value}일`,
      warranty: `${wm === null ? '?' : `${wm}개월`}${q.warrantyExtraFee.value ? ` (+${n(q.warrantyExtraFee.value)})` : ''}`,
      overall: c.overall,
      violations: c.violations,
      evidenceIds: ids(fieldEv(q, 'listedPrice'), fieldEv(q, 'installFee'), fieldEv(q, 'shippingFee'), fieldEv(q, 'warrantyMonths'), fieldEv(q, 'warrantyExtraFee'), fieldEv(q, 'leadTimeDays'))
    };
  });
  // recommend().reasons는 "{업체명}…"로 시작하므로 그 업체의 표시가·납기를 근거로 붙인다
  const reasons: ApprovalSentence[] = rec.reasons.map((text) => {
    const q = priced.map((id) => quotes[id]!).find((x) => text.startsWith(x.vendorName));
    return { text, evidenceIds: q ? ids(fieldEv(q, 'listedPrice'), fieldEv(q, 'leadTimeDays')) : [] };
  });

  // ─── 4. 소요 예산 ───
  let budget: ApprovalBudget | null = null;
  if (pick && doc) {
    budget = {
      supply: doc.supply,
      vat: doc.vat,
      total: doc.total,
      totalKorean: koreanAmount(doc.total),
      budgetMax: req.budgetMax,
      remaining: req.budgetMax - doc.total,
      complete: doc.complete,
      evidenceIds: ids(...items.flatMap((i) => i.evidenceIds), reqEv())
    };
  }

  // ─── 5. 납기·결제·인도 조건 ───
  const terms: ApprovalTerm[] = [];
  if (pick && doc) {
    const t = pick.meta?.terms;
    const own = (key: string, item: string, text: string) => reg(`${pick.vendorId}:term:${key}`, { kind: 'source', vendorName: pick.vendorName, item, valueText: text });
    const delivery = doc.terms.delivery ?? null;
    terms.push({
      label: '납기',
      value: delivery,
      // 원문을 그대로 쓴 경우만 원문 근거, "주문 후 N일"로 적었으면 납기 값의 근거
      evidenceIds: delivery === null ? [] : delivery === t?.delivery || delivery === t?.leadTimeText ? [own('delivery', '납기', delivery)] : ids(fieldEv(pick, 'leadTimeDays'))
    });
    const payment = doc.terms.payment ?? null;
    terms.push({ label: '결제조건', value: payment, evidenceIds: payment === null ? [] : [own('payment', '결제조건', payment)] });
    const place = doc.terms.place ?? null;
    terms.push({ label: '인도 장소', value: place, evidenceIds: place === null ? [] : t?.place ? [own('place', '인도 장소', place)] : [reqEv()] });
  }

  // ─── 6. 확인 필요 사항 (숨기지 않고 전부) ───
  const checks: ApprovalSentence[] = [];
  if (pick && rec.tentative) checks.push({ text: `${pick.vendorName}은(는) 확인 필요 항목이 남은 잠정 선정입니다. 확인 뒤 금액이 달라질 수 있습니다.`, evidenceIds: ids(fieldEv(pick, 'listedPrice')) });
  if (hold) checks.push({ text: '선정 보류: 아래 사유와 확인 사항을 해결한 뒤 다시 상신해야 합니다.', evidenceIds: [] });
  for (const q of confirmQuestions(quotes, req)) {
    const labels = missingKeys(quotes[q.vendorId]!, req).map((k) => FIELD_LABELS[k]);
    checks.push({ text: `${q.text} (누락: ${labels.join(', ')})`, evidenceIds: ids(fieldEv(quotes[q.vendorId]!, 'listedPrice')) });
  }
  for (const q of Object.values(quotes) as Quote[]) {
    if (q && q.listedPrice.value === null) checks.push({ text: `${q.vendorName}: 표시가를 확인하지 못해 비교에서 제외했습니다.`, evidenceIds: [] });
  }
  for (const t of terms) if (t.value === null) checks.push({ text: `${pick!.vendorName}: ${t.label} — 견적에 없음`, evidenceIds: [] });
  // 출처가 없는 값은 근거를 댈 수 없으므로 반드시 올린다
  for (const e of evidence) {
    if (e.kind === 'source' && !e.source) checks.push({ text: `${e.vendorName ?? ''} ${e.item}(${e.valueText}): 출처 없음 — 업체 원본으로 확인`.trim(), evidenceIds: [e.id] });
  }

  return {
    title: hold ? `${req.item} 구매의 건 (선정 보류)` : `${req.item} 구매의 건`,
    date: meta.date,
    hold,
    tentative: rec.tentative,
    vendorId: rec.vendorId,
    vendorName: pick?.vendorName ?? null,
    purpose,
    items,
    vendors,
    reasons,
    budget,
    terms,
    checks,
    evidence
  };
}

// ─── 회사 양식에 채울 항목 ─────────────────────────────────────

/** 기안 정보 (화면 위 입력칸) */
export interface ApprovalHeader {
  dept: string;
  author: string;
  /** 결재선 역할 (왼쪽부터) */
  roles: string[];
}

export interface ApprovalField {
  key: string;
  label: string;
  /** 양식에 그대로 들어갈 글자 (숫자·근거 번호 모두 ApprovalDoc에서 가져옴) */
  value: string;
}

const refText = (ids: number[]) => (ids.length ? `[${[...new Set(ids)].sort((a, b) => a - b).join(',')}]` : '');
const sentences = (list: ApprovalSentence[]) => list.map((s, i) => `${i + 1}. ${s.text}${refText(s.evidenceIds)}`).join('\n');
const CHN = { web: '웹', mail: '메일', file: '파일' } as const;

/** 양식 칸에 넣을 수 있는 품의서 항목 전체 (값은 ApprovalDoc에서만 가져온다) */
export function approvalFields(doc: ApprovalDoc, header: ApprovalHeader): ApprovalField[] {
  const f: ApprovalField[] = [];
  const add = (key: string, label: string, value: string) => f.push({ key, label, value });
  add('docNo', '문서번호', '');
  add('title', '제목', doc.title);
  add('date', '기안일', doc.date);
  add('dept', '기안부서', header.dept);
  add('author', '기안자', header.author);
  add('purpose', '목적', sentences(doc.purpose));
  add('reasons', '선정 사유', sentences(doc.reasons));
  add('vendorName', '선정 업체', doc.vendorName ?? '선정 보류');
  const b = doc.budget;
  add('supply', '공급가액', b ? won(b.supply) : '');
  add('vat', '부가세', b ? won(b.vat) : '');
  add('total', '합계 금액', b ? `${won(b.total)}${refText(b.evidenceIds)}` : '');
  add('totalKorean', '합계 금액(한글)', b ? `금 ${b.totalKorean}원정` : '');
  add('budgetMax', '예산', b ? won(b.budgetMax) : '');
  add('remaining', '예산 대비 잔액', b ? (b.remaining >= 0 ? won(b.remaining) : `초과 ${won(-b.remaining)}`) : '');
  for (const t of doc.terms) {
    const key = t.label === '납기' ? 'delivery' : t.label === '결제조건' ? 'payment' : 'place';
    add(key, t.label, t.value ? `${t.value}${refText(t.evidenceIds)}` : '확인 필요');
  }
  doc.items.forEach((it, i) => {
    const p = `item${i + 1}_`;
    add(`${p}name`, `${i + 1}행 품명`, `${it.name}${refText(it.evidenceIds)}`);
    add(`${p}spec`, `${i + 1}행 규격`, it.spec ?? '');
    add(`${p}qty`, `${i + 1}행 수량`, String(it.qty));
    add(`${p}unit`, `${i + 1}행 단가`, it.unitPrice === null ? '?' : it.unitPrice.toLocaleString('ko-KR'));
    add(`${p}amount`, `${i + 1}행 금액`, it.amount === null ? '?' : it.amount.toLocaleString('ko-KR'));
    add(`${p}note`, `${i + 1}행 비고`, it.note ?? '');
  });
  add('items_text', '구매 내역(전체)', doc.items.map((it, i) => `${i + 1}. ${it.name}${it.spec ? ` (${it.spec})` : ''} ${it.qty}개 × ${it.unitPrice === null ? '?' : it.unitPrice.toLocaleString('ko-KR')} = ${it.amount === null ? '?' : it.amount.toLocaleString('ko-KR')}원${refText(it.evidenceIds)}`).join('\n'));
  add(
    'vendors_text',
    '업체 비교(전체)',
    doc.vendors.map((v) => `${v.vendorName}${v.recommended ? '(선정)' : ''} · ${CHN[v.channel]} · ${won(v.total)}${v.complete ? '' : '?'} · 납기 ${v.leadTime} · A/S ${v.warranty}${refText(v.evidenceIds)}`).join('\n')
  );
  add('checks', '확인 필요 사항', doc.checks.length ? sentences(doc.checks) : '없음');
  add(
    'evidence_text',
    '붙임 근거 자료',
    doc.evidence
      .map((e) => `[${e.id}] ${e.vendorName ? `${e.vendorName} ` : ''}${e.item} ${e.valueText} — ${e.kind === 'requirement' ? '사용자 입력' : e.source ? `${CHN[e.source.channel]} ${e.source.ref} “${e.source.snippet}” (${e.source.capturedAt.replace('T', ' ').slice(0, 16)})` : '출처 없음'}`)
      .join('\n')
  );
  return f;
}

// ─── AI 문장 다듬기 (2단계) ────────────────────────────────────
// AI는 1.목적과 3.선정 사유 문장만 다듬는다. 입력은 근거 번호가 붙은 사실 목록뿐이고,
// 결과는 숫자·근거 번호를 검증해 통과한 문장만 쓴다(못 쓰면 1단계 템플릿 문장 그대로).

export interface PolishFact {
  id: number;
  text: string;
}
export interface PolishInput {
  facts: PolishFact[];
  purpose: ApprovalSentence[];
  reasons: ApprovalSentence[];
}
/** 문장 하나의 다듬은 결과 (검증 실패·없음은 null → 템플릿 문장 유지) */
export interface PolishResult {
  purpose: (ApprovalSentence | null)[];
  reasons: (ApprovalSentence | null)[];
}

/** AI에 줄 입력: 근거(붙임)의 값과 템플릿 문장 */
export function buildPolishInput(doc: ApprovalDoc): PolishInput {
  return {
    facts: doc.evidence.map((e) => ({ id: e.id, text: `${e.vendorName ? `${e.vendorName} ` : ''}${e.item}: ${e.valueText}` })),
    purpose: doc.purpose,
    reasons: doc.reasons
  };
}

const NUM = /\d[\d,]*(?:\.\d+)?/g;
const nums = (s: string) => (s.match(NUM) ?? []).map((x) => x.replace(/,/g, ''));

/** 다듬은 문장이 써도 되는지: 근거 번호가 있고 모두 실제 번호이며, 문장 안 모든 숫자가 사실 목록·원래 문장에 있는 값이어야 한다 */
export function acceptPolished(candidate: ApprovalSentence, input: PolishInput): boolean {
  if (!candidate.text.trim() || candidate.evidenceIds.length === 0) return false;
  const ids = new Set(input.facts.map((f) => f.id));
  if (!candidate.evidenceIds.every((id) => ids.has(id))) return false;
  const allowed = new Set([...input.facts.flatMap((f) => nums(f.text)), ...input.purpose.flatMap((s) => nums(s.text)), ...input.reasons.flatMap((s) => nums(s.text))]);
  return nums(candidate.text).every((n) => allowed.has(n));
}

/** 다듬은 문장으로 바꾼 문서. 사용한 문장이 하나도 없으면 원본 그대로 */
export function applyPolished(doc: ApprovalDoc, r: PolishResult): ApprovalDoc {
  const pick = (base: ApprovalSentence[], got: (ApprovalSentence | null)[]) => base.map((s, i) => got[i] ?? s);
  const purpose = pick(doc.purpose, r.purpose);
  const reasons = pick(doc.reasons, r.reasons);
  const used = [...r.purpose, ...r.reasons].filter(Boolean).length;
  return used === 0 ? doc : { ...doc, purpose, reasons, polishedCount: used };
}
