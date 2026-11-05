// 통합 견적서: 업체별 견적을 한 장으로 비교
import type { Quote, Requirements, VendorId } from '@shared/types';
import { buildDoc, won } from '@shared/quote';
import { buildCompareTable, type CompareCell, type CompareRow } from '@shared/compare-table';
import { localIsoDate } from '@shared/parse';

const n = (v: number | string | null | undefined) => (v === null || v === undefined ? '?' : typeof v === 'number' ? v.toLocaleString('ko-KR') : v);
const CH = { web: '웹', mail: '메일', file: '파일' } as const;
// 비교표에는 안 그리는 행 (아래 "업체 정보" 표에 있음)
const HIDDEN_ROWS = ['payment', 'validity'];

function show(r: CompareRow, c: CompareCell): React.ReactNode {
  if (r.key === 'channel') return CH[c.value as keyof typeof CH];
  if (c.kind === 'won') {
    if (r.zeroLabel && c.value === 0) return r.zeroLabel;
    return r.total ? <>{n(c.value)}{c.missing && <span className="dl-q"> ?</span>}</> : n(c.value);
  }
  if (c.kind === 'month') return `${c.value === null ? '?' : `${c.value}개월`}${c.addon ? ` (+${n(c.addon)})` : ''}`;
  if (c.kind === 'day') return c.value === null ? '?' : `${c.value}일`;
  if (c.tone) return <span className={c.tone === 'ok' ? 'dl-ok' : c.tone === 'bad' ? 'dl-bad' : 'dl-q'}>{c.value}</span>;
  return c.value;
}

export function IntegratedDocument({ quotes, req, urls }: { quotes: Partial<Record<VendorId, Quote>>; req: Requirements; urls: Partial<Record<VendorId, string>> }) {
  const table = buildCompareTable(quotes, req, urls);
  const { vendors, recommendation: rec } = table;
  const best = rec.vendorId;
  const docs = vendors.map((v) => ({ q: quotes[v.id]!, d: buildDoc(quotes[v.id]!, req, urls[v.id]) }));
  const today = localIsoDate();

  return (
    <div className="dl-paper">
      <h1 className="dl-title">통합 견적서</h1>
      <div className="dl-sub">{req.item} · 업체 {docs.length}곳 비교 · {today}</div>
      <table className="dl-table">
        <tbody>
          <tr>
            <th>요구 조건</th>
            <td>
              수량 {req.quantity}개 · 예산 {won(req.budgetMax)} 이하 · {req.deadline}까지 · 설치 {req.needInstall ? '필요' : '불필요'} · A/S {req.minWarrantyMonths > 0 ? `${req.minWarrantyMonths}개월 이상` : '불필요'}{req.needDelivery === false ? ' · 배송 불필요' : ''}{req.region ? ` · ${req.region}` : ''}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="dl-rec">
        <b>추천: {best ? quotes[best]!.vendorName : '조건을 모두 만족하는 업체 없음'}</b>
        {rec.tentative && best ? ' (확인 필요 항목 있음)' : ''}
        <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
          {rec.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>

      <table className="dl-table dl-cmp">
        <thead>
          <tr>
            <th style={{ width: 110 }}>항목</th>
            {vendors.map((v) => (
              <th key={v.id} className="v">
                {v.rank}위 · {v.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows
            .filter((r) => !HIDDEN_ROWS.includes(r.key))
            .map((r) => (
              <tr key={r.key} className={r.total ? 'total' : undefined}>
                <th>{r.label}</th>
                {r.cells.map((c, i) => (
                  <td key={vendors[i].id} className={`${c.kind === 'won' || c.kind === 'day' ? 'n' : ''} ${vendors[i].id === best ? 'best' : ''}`}>
                    {show(r, c)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>

      <div className="dl-h3">업체 정보</div>
      <table className="dl-table">
        <tbody>
          {docs.map(({ q, d }) => (
            <tr key={q.vendorId}>
              <th style={{ width: 110 }}>{q.vendorName}</th>
              <td>
                {[d.supplier.bizNo && `사업자 ${d.supplier.bizNo}`, d.supplier.phone, d.supplier.email, d.terms.payment && `결제 ${d.terms.payment}`, d.terms.validity && `유효 ${d.terms.validity}`]
                  .filter(Boolean)
                  .join(' · ') || '—'}
                <div style={{ color: '#6b7280', fontSize: 10, wordBreak: 'break-all' }}>{d.supplier.url}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dl-foot">모든 금액은 부가세 포함 기준으로 통일했습니다. 합계 = 제품가 + 설치비 + 배송비 + A/S 연장비 + 필수 추가 비용. 업체별 상세 견적서와 원본은 돌다리에서 볼 수 있습니다.</div>
    </div>
  );
}
