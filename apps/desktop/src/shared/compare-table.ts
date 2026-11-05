// 통합 견적서 비교표 데이터: 화면(IntegratedDocument)과 엑셀 내보내기가 같이 쓴다.
// 표시용 문자열은 만들지 않고, 값과 종류만 돌려준다.
import type { Channel, Quote, Requirements, VendorId } from './types';
import { buildDoc, evaluateConditions, rankQuotes, recommend, type QuoteDoc } from './quote';

export type CellKind = 'won' | 'day' | 'month' | 'text';

export interface CompareCell {
  value: number | string | null;
  kind: CellKind;
  /** 값을 확인하지 못함 (합계는 일부만 반영된 경우도 포함) */
  missing?: boolean;
  /** A/S 연장비처럼 값 옆에 덧붙는 금액 */
  addon?: number;
  /** 강조 색: 충족 / 위반 / 확인 필요 */
  tone?: 'ok' | 'bad' | 'warn';
}

export interface CompareRow {
  key: string;
  label: string;
  /** vendors와 같은 순서 */
  cells: CompareCell[];
  /** 값이 0일 때 숫자 대신 보일 말 (예: 설치비 0 → "포함") */
  zeroLabel?: string;
  /** 합계 행 */
  total?: boolean;
}

export interface CompareVendor {
  id: VendorId;
  name: string;
  channel: Channel;
  rank: number;
  recommended: boolean;
}

export interface CompareTable {
  vendors: CompareVendor[];
  rows: CompareRow[];
  recommendation: { vendorId: VendorId | null; vendorName: string | null; tentative: boolean; reasons: string[] };
}

export function buildCompareTable(quotes: Partial<Record<VendorId, Quote>>, req: Requirements, urls: Partial<Record<VendorId, string>>): CompareTable {
  const order = rankQuotes(quotes, req).filter((id) => quotes[id]?.listedPrice.value !== null);
  const docs = order.map((id) => ({ q: quotes[id]!, d: buildDoc(quotes[id]!, req, urls[id]), c: evaluateConditions(quotes[id]!, req) }));
  const rec = recommend(quotes, req);
  const best = rec.vendorId;

  const sumKind = (d: QuoteDoc, kinds: string[]) => {
    const ls = d.lines.filter((l) => kinds.includes(l.kind) && l.counted);
    if (ls.length === 0) return 0;
    return ls.some((l) => l.amount === null) ? null : ls.reduce((s, l) => s + (l.amount ?? 0), 0);
  };
  const won = (v: number | null): CompareCell => ({ value: v, kind: 'won', missing: v === null });
  const text = (v: string): CompareCell => ({ value: v, kind: 'text' });
  const row = (key: string, label: string, cells: CompareCell[], extra?: Partial<CompareRow>): CompareRow => ({ key, label, cells, ...extra });

  const rows: CompareRow[] = [];
  rows.push(row('channel', '견적 경로', docs.map(({ q }) => text(q.channel))));
  rows.push(
    row(
      'product-name',
      '품명·규격',
      docs.map(({ d }) => {
        const p = d.lines.filter((l) => l.kind === 'product' && l.counted)[0];
        return text(`${p?.name ?? ''}${p?.spec ? ` (${p.spec})` : ''}`);
      })
    )
  );
  rows.push(row('product', `제품가 (${req.quantity}개)`, docs.map(({ d }) => won(sumKind(d, ['product'])))));
  if (req.needInstall) rows.push(row('install', '설치비', docs.map(({ d }) => won(sumKind(d, ['install']))), { zeroLabel: '포함' }));
  if (req.needDelivery !== false) rows.push(row('shipping', '배송비', docs.map(({ d }) => won(sumKind(d, ['shipping']))), { zeroLabel: '무료' }));
  // A/S가 필요 없는 품목(인쇄물·소모품 등)은 행을 빼서 "?"가 남지 않게
  if (req.minWarrantyMonths > 0)
    rows.push(
      row(
        'warranty',
        'A/S',
        docs.map(({ q }) => ({
          value: q.warrantyMonths.value,
          kind: 'month' as const,
          missing: q.warrantyMonths.value === null,
          ...(q.warrantyExtraFee.value ? { addon: q.warrantyExtraFee.value } : {})
        }))
      )
    );
  rows.push(row('extra', '추가 비용', docs.map(({ d }) => ({ value: sumKind(d, ['extra']) ?? 0, kind: 'won' as const })), { zeroLabel: '—' }));
  rows.push(row('supply', '공급가액', docs.map(({ d }) => won(d.supply))));
  rows.push(row('vat', '부가세', docs.map(({ d }) => won(d.vat))));
  rows.push(row('total', '합계', docs.map(({ d }) => ({ value: d.total, kind: 'won' as const, missing: !d.complete })), { total: true }));
  rows.push(row('lead', '납기', docs.map(({ q }) => ({ value: q.leadTimeDays.value, kind: 'day' as const, missing: q.leadTimeDays.value === null }))));
  rows.push(
    row(
      'conditions',
      '조건 충족',
      docs.map(({ c }) =>
        c.overall === 'ok'
          ? { value: '충족', kind: 'text' as const, tone: 'ok' as const }
          : c.overall === 'violate'
            ? { value: c.violations.join(', '), kind: 'text' as const, tone: 'bad' as const }
            : text('확인 필요')
      )
    )
  );
  rows.push(row('missing', '확인 필요', docs.map(({ d }) => (d.missing.length ? { value: d.missing.join(', '), kind: 'text' as const, tone: 'warn' as const } : text('없음')))));
  // 화면에서는 "업체 정보" 표에 있어서 비교표에는 안 그리지만, 엑셀에는 넣는다
  rows.push(row('payment', '결제 조건', docs.map(({ d }) => (d.terms.payment ? text(d.terms.payment) : { value: null, kind: 'text' as const, missing: true }))));
  rows.push(row('validity', '유효기간', docs.map(({ d }) => (d.terms.validity ? text(d.terms.validity) : { value: null, kind: 'text' as const, missing: true }))));

  return {
    vendors: docs.map(({ q }, i) => ({ id: q.vendorId, name: q.vendorName, channel: q.channel, rank: i + 1, recommended: q.vendorId === best })),
    rows,
    recommendation: { vendorId: best, vendorName: best ? quotes[best]!.vendorName : null, tentative: rec.tentative, reasons: rec.reasons }
  };
}
