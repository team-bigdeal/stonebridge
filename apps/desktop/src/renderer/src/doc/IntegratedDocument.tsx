// 통합 견적서: 업체별 견적을 한 장으로 비교
import type { Quote, Requirements, VendorId } from '@shared/types';
import { buildDoc, evaluateConditions, rankQuotes, recommend, won } from '@shared/quote';

const n = (v: number | null | undefined) => (v === null || v === undefined ? '?' : v.toLocaleString('ko-KR'));
const CH = { web: '웹', mail: '메일', file: '파일' } as const;

export function IntegratedDocument({ quotes, req, urls }: { quotes: Partial<Record<VendorId, Quote>>; req: Requirements; urls: Partial<Record<VendorId, string>> }) {
  const order = rankQuotes(quotes, req).filter((id) => quotes[id]?.listedPrice.value !== null);
  const docs = order.map((id) => ({ q: quotes[id]!, d: buildDoc(quotes[id]!, req, urls[id]), c: evaluateConditions(quotes[id]!, req) }));
  const rec = recommend(quotes, req);
  const best = rec.vendorId;
  const line = (d: (typeof docs)[number]['d'], kind: string) => d.lines.filter((l) => l.kind === kind && l.counted);
  const sumKind = (d: (typeof docs)[number]['d'], kinds: string[]) => {
    const ls = d.lines.filter((l) => kinds.includes(l.kind) && l.counted);
    if (ls.length === 0) return 0;
    return ls.some((l) => l.amount === null) ? null : ls.reduce((s, l) => s + (l.amount ?? 0), 0);
  };
  const today = new Date().toISOString().slice(0, 10);
  const cell = (id: VendorId, v: React.ReactNode, num = true) => (
    <td key={id} className={`${num ? 'n' : ''} ${id === best ? 'best' : ''}`}>{v}</td>
  );

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
            {docs.map(({ q }, i) => (
              <th key={q.vendorId} className="v">
                {i + 1}위 · {q.vendorName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>견적 경로</th>
            {docs.map(({ q }) => cell(q.vendorId, CH[q.channel], false))}
          </tr>
          <tr>
            <th>품명·규격</th>
            {docs.map(({ q, d }) => cell(q.vendorId, `${line(d, 'product')[0]?.name ?? ''}${line(d, 'product')[0]?.spec ? ` (${line(d, 'product')[0]?.spec})` : ''}`, false))}
          </tr>
          <tr>
            <th>제품가 ({req.quantity}개)</th>
            {docs.map(({ q, d }) => cell(q.vendorId, n(sumKind(d, ['product']))))}
          </tr>
          {req.needInstall && (
            <tr>
              <th>설치비</th>
              {docs.map(({ q, d }) => cell(q.vendorId, sumKind(d, ['install']) === 0 ? '포함' : n(sumKind(d, ['install']))))}
            </tr>
          )}
          {req.needDelivery !== false && (
            <tr>
              <th>배송비</th>
              {docs.map(({ q, d }) => cell(q.vendorId, sumKind(d, ['shipping']) === 0 ? '무료' : n(sumKind(d, ['shipping']))))}
            </tr>
          )}
          {/* A/S가 필요 없는 품목(인쇄물·소모품 등)은 행을 빼서 "?"가 남지 않게 */}
          {req.minWarrantyMonths > 0 && (
            <tr>
              <th>A/S</th>
              {docs.map(({ q }) =>
                cell(q.vendorId, `${q.warrantyMonths.value === null ? '?' : `${q.warrantyMonths.value}개월`}${q.warrantyExtraFee.value ? ` (+${n(q.warrantyExtraFee.value)})` : ''}`, false)
              )}
            </tr>
          )}
          <tr>
            <th>추가 비용</th>
            {docs.map(({ q, d }) => cell(q.vendorId, sumKind(d, ['extra']) ? n(sumKind(d, ['extra'])) : '—'))}
          </tr>
          <tr>
            <th>공급가액</th>
            {docs.map(({ q, d }) => cell(q.vendorId, n(d.supply)))}
          </tr>
          <tr>
            <th>부가세</th>
            {docs.map(({ q, d }) => cell(q.vendorId, n(d.vat)))}
          </tr>
          <tr className="total">
            <th>합계</th>
            {docs.map(({ q, d }) => cell(q.vendorId, <>{n(d.total)}{!d.complete && <span className="dl-q"> ?</span>}</>))}
          </tr>
          <tr>
            <th>납기</th>
            {docs.map(({ q }) => cell(q.vendorId, q.leadTimeDays.value === null ? '?' : `${q.leadTimeDays.value}일`))}
          </tr>
          <tr>
            <th>조건 충족</th>
            {docs.map(({ q, c }) =>
              cell(q.vendorId, c.overall === 'ok' ? <span className="dl-ok">충족</span> : c.overall === 'violate' ? <span className="dl-bad">{c.violations.join(', ')}</span> : '확인 필요', false)
            )}
          </tr>
          <tr>
            <th>확인 필요</th>
            {docs.map(({ q, d }) => cell(q.vendorId, d.missing.length ? <span className="dl-q">{d.missing.join(', ')}</span> : '없음', false))}
          </tr>
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
