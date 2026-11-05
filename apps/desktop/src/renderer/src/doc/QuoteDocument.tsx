// 업체별 통일 견적서 (전통형 견적서 양식)
import type { Requirements } from '@shared/types';
import { koreanAmount, type QuoteDoc } from '@shared/quote';

const n = (v: number | null) => (v === null ? '' : v.toLocaleString('ko-KR'));
const CH = { web: '웹', mail: '메일', file: '파일' } as const;

export function QuoteDocument({ doc, req, channel }: { doc: QuoteDoc; req: Requirements; channel: 'web' | 'mail' | 'file' }) {
  const s = doc.supplier;
  const counted = doc.lines.filter((l) => l.counted);
  const options = doc.lines.filter((l) => !l.counted);
  return (
    <div className="dl-paper">
      <h1 className="dl-title">견적서</h1>
      <div className="dl-sub">돌다리 통일 양식 · 원본: {CH[channel]} 견적</div>
      <div className="dl-head">
        <div>
          <div className="dl-meta">No. {doc.no} · {doc.date}</div>
          <div className="dl-to">
            고객님 <small>귀중</small>
          </div>
          <div className="dl-meta">품목: {req.item}</div>
        </div>
      </div>
      <table className="dl-table">
        <tbody>
          <tr>
            <td rowSpan={5} className="dl-vert">공급자</td>
            <th>등록번호</th>
            <td colSpan={3}>{s.bizNo ?? <span className="dl-q">확인 필요</span>}</td>
          </tr>
          <tr>
            <th>상호</th>
            <td>{s.name}</td>
            <th>대표자</th>
            <td>{s.ceo ?? '—'}</td>
          </tr>
          <tr>
            <th>사업장</th>
            <td colSpan={3}>{s.address ?? '—'}</td>
          </tr>
          <tr>
            <th>연락처</th>
            <td>{s.phone ?? '—'}</td>
            <th>메일</th>
            <td>{s.email ?? '—'}</td>
          </tr>
          <tr>
            <th>출처</th>
            <td colSpan={3} style={{ wordBreak: 'break-all' }}>{s.url ?? '—'}</td>
          </tr>
        </tbody>
      </table>

      <div className="dl-lead">아래와 같이 견적합니다.</div>
      <div className="dl-amount">
        <span>
          견적금액 <b>금 {koreanAmount(doc.total)}원정</b> <span style={{ color: '#6b7280' }}>(부가세 포함)</span>
        </span>
        <span className="won">₩ {doc.total.toLocaleString('ko-KR')}{!doc.complete && <span className="dl-q"> ?</span>}</span>
      </div>

      <table className="dl-table">
        <tbody>
          <tr>
            <th>유효기간</th>
            <td>{doc.terms.validity ?? '—'}</td>
            <th>납　기</th>
            <td>{doc.terms.delivery ?? <span className="dl-q">확인 필요</span>}</td>
          </tr>
          <tr>
            <th>결제조건</th>
            <td>{doc.terms.payment ?? '—'}</td>
            <th>인도장소</th>
            <td>{doc.terms.place ?? '—'}</td>
          </tr>
        </tbody>
      </table>

      <table className="dl-table dl-items">
        <thead>
          <tr>
            <th style={{ width: 34 }}>No</th>
            <th>품 명</th>
            <th>규격</th>
            <th style={{ width: 44 }}>수량</th>
            <th style={{ width: 90 }}>단가</th>
            <th style={{ width: 100 }}>금액</th>
            <th style={{ width: 120 }}>비고</th>
          </tr>
        </thead>
        <tbody>
          {[...counted, ...options].map((l, i) => (
            <tr key={i} className={l.counted ? '' : 'opt'}>
              <td className="c">{i + 1}</td>
              <td>
                {l.name}
                {l.source && <span className="dl-src">{CH[l.source.channel]}</span>}
              </td>
              <td>{l.spec ?? ''}</td>
              <td className="c">{l.qty}</td>
              <td className="n">{l.unitPrice === null ? <span className="dl-q">?</span> : n(l.unitPrice)}</td>
              <td className="n">{l.amount === null ? <span className="dl-q">?</span> : n(l.amount)}</td>
              <td>{l.note ?? ''}</td>
            </tr>
          ))}
          <tr className="sum">
            <td colSpan={5} className="c">공 급 가 액</td>
            <td className="n">{n(doc.supply)}</td>
            <td />
          </tr>
          <tr className="sum">
            <td colSpan={5} className="c">부 가 세 (10%)</td>
            <td className="n">{n(doc.vat)}</td>
            <td />
          </tr>
          <tr className="total">
            <td colSpan={5} className="c">합 계</td>
            <td className="n">{n(doc.total)}</td>
            <td>{doc.complete ? '' : <span className="dl-q">확인 중</span>}</td>
          </tr>
        </tbody>
      </table>

      {doc.missing.length > 0 && (
        <div className="dl-warn">
          <b>확인이 필요한 항목:</b> {doc.missing.join(', ')} — 원본 견적에 없어 합계에 반영하지 못했습니다.
        </div>
      )}
      <div className="dl-notes">
        <h4>특기사항</h4>
        <ul>
          {doc.notes.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </div>
      <div className="dl-foot">돌다리가 업체의 {CH[channel]} 견적을 같은 양식으로 정리한 문서입니다. 금액·조건은 업체 원본과 함께 확인하세요.</div>
    </div>
  );
}
