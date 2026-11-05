// 순위 변동 계산: 기록(rankLog)의 한 단계에서 순위·이동 폭·설명 한 줄을 만든다 (실시간 강조와 다시 보기가 같이 씀)
import { useEffect, useState } from 'react';
import type { FieldKey, Quote, RankStep, Requirements, VendorId } from '@shared/types';
import { FIELD_LABELS } from '@shared/types';
import { extraSum, rankQuotes, won } from '@shared/quote';

export interface StepView {
  quotes: Partial<Record<VendorId, Quote>>;
  order: VendorId[];
  /** 앞 단계보다 올라간 칸 수 (+는 상승, -는 하락). 가격이 막 들어온 업체는 없음 */
  deltas: Partial<Record<VendorId, number>>;
  changed: { vendorId: VendorId; field?: FieldKey };
  caption: string;
}

const priced = (quotes: Partial<Record<VendorId, Quote>>, req: Requirements | null) =>
  rankQuotes(quotes, req).filter((id) => quotes[id]?.listedPrice.value !== null);

function valueText(q: Quote, field: FieldKey) {
  const v = q[field].value;
  if (v === null) return '';
  if (field === 'leadTimeDays') return `${v}일`;
  if (field === 'warrantyMonths') return `${v}개월`;
  return won(v);
}

export function stepView(log: RankStep[], i: number, req: Requirements | null): StepView {
  const step = log[i];
  const prevQuotes = i > 0 ? log[i - 1].quotes : {};
  const before = priced(prevQuotes, req);
  const after = priced(step.quotes, req);
  const deltas: Partial<Record<VendorId, number>> = {};
  for (const id of after) {
    const b = before.indexOf(id);
    const d = b < 0 ? 0 : b - after.indexOf(id);
    if (d) deltas[id] = d;
  }
  const q = step.quotes[step.vendorId]!;
  const prev = prevQuotes[step.vendorId];
  const what = step.field
    ? `${FIELD_LABELS[step.field]} ${valueText(q, step.field)} 확인`
    : `추가 비용 ${prev && extraSum(q) > extraSum(prev) ? '+' : ''}${won(extraSum(q) - (prev ? extraSum(prev) : 0))} 반영`;
  const moves = after
    .filter((id) => deltas[id])
    .sort((a, b) => (deltas[a] ?? 0) - (deltas[b] ?? 0))
    .map((id) => `${step.quotes[id]!.vendorName} ${before.indexOf(id) + 1}위 ${deltas[id]! > 0 ? '▲' : '▼'} ${after.indexOf(id) + 1}위`);
  const joined = !before.includes(step.vendorId) && after.includes(step.vendorId) ? [`${after.indexOf(step.vendorId) + 1}위로 등장`] : [];
  return {
    quotes: step.quotes,
    order: rankQuotes(step.quotes, req),
    deltas,
    changed: { vendorId: step.vendorId, field: step.field },
    caption: `${q.vendorName} · ${what}${joined.length + moves.length ? ` → ${[...joined, ...moves].join(', ')}` : ''}`
  };
}

/** 순위가 한 번이라도 바뀐 기록인지 (다시 보기 버튼을 보일지) */
export function hasRankChange(log: RankStep[], req: Requirements | null) {
  return log.some((_, i) => i > 0 && Object.keys(stepView(log, i, req).deltas).length > 0);
}

/** 실시간 강조: 마지막 단계가 ms 안이면 그 단계를 돌려준다 */
export function useLiveRankFx(log: RankStep[], req: Requirements | null, ms = 3000): StepView | null {
  const last = log.length - 1;
  const fresh = last >= 0 && Date.now() - log[last].at < ms;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => tick((n) => n + 1), ms - (Date.now() - log[last].at) + 50);
    return () => clearTimeout(t);
  }, [fresh, last, log, ms]);
  return fresh ? stepView(log, last, req) : null;
}
