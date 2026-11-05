// 요구 조건 값의 범위: 오른쪽 패널 입력과 main의 시작 검증이 같은 기준을 쓴다
import type { Requirements } from './types';
import { localIsoDate, parseKrw } from './parse';

export const LIMITS = {
  quantity: { min: 1, max: 10_000_000 },
  budgetMax: { min: 1_000, max: 10_000_000_000 }
} as const;

/** 품목 이름 최대 글자 수 (넘는 부분은 잘라서 쓴다) */
export const ITEM_MAX = 200;

/** 품목이 너무 길 때 안내 문구. 괜찮으면 null */
export function itemIssue(item: string): string | null {
  const n = item.trim().length;
  return n > ITEM_MAX ? `품목은 ${ITEM_MAX}자까지만 써요 (지금 ${n.toLocaleString('ko-KR')}자). 넘는 부분은 잘리니 자세한 조건은 채팅으로 알려 주세요.` : null;
}

/** 수량·예산 값이 쓸 수 있는지. 문제가 있으면 안내 문구 */
export function valueIssue(kind: 'quantity' | 'budgetMax', n: number): string | null {
  const { min, max } = LIMITS[kind];
  if (kind === 'quantity') {
    if (!Number.isInteger(n) || n < min) return '수량은 1개 이상 정수로 적어 주세요.';
    if (n > max) return `수량은 ${max.toLocaleString('ko-KR')}개까지 적을 수 있어요.`;
    return null;
  }
  if (!Number.isInteger(n) || n <= 0) return '예산은 0보다 큰 금액(원)으로 적어 주세요.';
  if (n < min) return `예산이 너무 적어요. ${min.toLocaleString('ko-KR')}원 이상으로 적어 주세요.`;
  if (n > max) return '예산은 100억 원까지 적을 수 있어요.';
  return null;
}

/** 납기(YYYY-MM-DD)가 쓸 수 있는지. 오늘(한국 시간)보다 앞이면 안내 문구 */
export function deadlineIssue(iso: string | undefined, today = localIsoDate()): string | null {
  if (!iso) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(new Date(`${iso}T00:00:00`).getTime())) return '납기 날짜를 다시 골라 주세요.';
  if (iso < today) return '납기가 이미 지난 날짜예요. 오늘 이후로 골라 주세요.';
  return null;
}

/** 검색을 시작하기 전에 확인: 수량·예산·납기 중 처음 걸리는 문제 */
export function requirementIssue(r: Partial<Requirements>, today = localIsoDate()): string | null {
  if (r.quantity !== undefined) {
    const e = valueIssue('quantity', r.quantity);
    if (e) return e;
  }
  if (r.budgetMax !== undefined) {
    const e = valueIssue('budgetMax', r.budgetMax);
    if (e) return e;
  }
  return deadlineIssue(r.deadline, today);
}

/** 패널 숫자 칸에 쓴 글자 → 값. "20만" → 200000, "1,500" → 1500. 음수·단위 없는 소수·숫자가 아닌 글자는 안내 문구 */
export function parseAmountInput(text: string, kind: 'quantity' | 'budgetMax'): { value?: number; error?: string } {
  const s = text.normalize('NFKC').replace(/[\s,]/g, '').replace(kind === 'budgetMax' ? /원$/ : /(개|장|매|부|대)$/, '');
  if (!s) return {};
  if (/^-/.test(s)) return { error: kind === 'quantity' ? '수량은 1개 이상 정수로 적어 주세요.' : '예산은 0보다 큰 금액(원)으로 적어 주세요.' };
  const tooBig = valueIssue(kind, Number.MAX_SAFE_INTEGER) ?? '값이 너무 커요.';
  if (s.length > 24) return { error: tooBig };
  // 숫자와 억·만·천·백만 쓴다 ("1e3" 같은 표기는 받지 않음)
  if (!/^(?=\d)(?:\d*(?:\.\d+)?[억만천백])*(?:\d+(?:\.\d+)?)?$/.test(s)) return { error: kind === 'quantity' ? '숫자로 적어 주세요. (예: 3000, 1만)' : '숫자로 적어 주세요. (예: 200000, 20만)' };
  // 단위 없는 소수("2.5")는 개수·원으로 나눌 수 없다
  if (/\d\.\d+(?!\d*[억만천백])/.test(s)) return { error: kind === 'quantity' ? '수량은 정수로 적어 주세요.' : '예산은 원 단위 정수로 적어 주세요.' };
  // 값은 견적 금액과 같은 해석기로 읽는다 ("1억 2천만" → 120000000)
  const value = parseKrw(s) ?? NaN;
  if (!Number.isSafeInteger(value)) return { error: tooBig };
  const error = valueIssue(kind, value);
  return error ? { error } : { value };
}
