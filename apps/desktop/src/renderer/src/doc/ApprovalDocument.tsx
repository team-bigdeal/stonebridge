// 구매 품의서 (회사 결재용 A4 양식)
import type { ApprovalDoc, ApprovalSentence } from '@shared/approval';
import { won } from '@shared/quote';

const CH = { web: '웹', mail: '메일', file: '파일' } as const;
const n = (v: number | null) => (v === null ? '' : v.toLocaleString('ko-KR'));

export interface ApprovalHeader {
  dept: string;
  author: string;
  /** 결재선 역할 (왼쪽부터) */
  roles: string[];
}

/** 문장 끝에 근거 번호를 붙인다 */
const Refs = ({ ids }: { ids: number[] }) => (ids.length ? <sup className="dl-ref">[{[...new Set(ids)].sort((a, b) => a - b).join(',')}]</sup> : null);
const Sentences = ({ list }: { list: ApprovalSentence[] }) => (
  <ol className="dl-sent">
    {list.map((s, i) => (
      <li key={i}>
        {s.text}
        <Refs ids={s.evidenceIds} />
      </li>
    ))}
  </ol>
);

export function ApprovalDocument({ doc, header }: { doc: ApprovalDoc; header: ApprovalHeader }) {
  const b = doc.budget;
  return (
    <div className="dl-paper">
      <h1 className="dl-title" style={{ letterSpacing: 10 }}>구매 품의서</h1>
      <div className="dl-head" style={{ alignItems: 'flex-start' }}>
        <table className="dl-table" style={{ width: 360 }}>
          <tbody>
            <tr>
              <th style={{ width: 80 }}>문서번호</th>
              <td>&nbsp;</td>
            </tr>
            <tr>
              <th>기안일</th>
              <td>{doc.date}</td>
            </tr>
            <tr>
              <th>기안부서</th>
              <td>{header.dept || <span className="dl-q">&nbsp;</span>}</td>
            </tr>
            <tr>
              <th>기안자</th>
              <td>{header.author || <span className="dl-q">&nbsp;</span>}</td>
            </tr>
          </tbody>
        </table>
        <table className="dl-table dl-sign">
          <tbody>
            <tr>
              <td rowSpan={2} className="dl-vert">결재</td>
              {header.roles.map((r, i) => (
                <th key={i}>{r}</th>
              ))}
            </tr>
            <tr>
              {header.roles.map((_, i) => (
                <td key={i} className="box" />
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <table className="dl-table">
        <tbody>
          <tr>
            <th style={{ width: 80 }}>제 목</th>
            <td style={{ fontWeight: 700 }}>{doc.title}</td>
          </tr>
        </tbody>
      </table>

      <div className="dl-h3">1. 목적</div>
      <Sentences list={doc.purpose} />

      <div className="dl-h3">2. 구매 내역</div>
      {doc.items.length === 0 ? (
        <div className="dl-notes">선정 보류로 구매 내역이 없습니다.</div>
      ) : (
        <table className="dl-table dl-items">
          <thead>
            <tr>
              <th style={{ width: 30 }}>No</th>
              <th>품 명</th>
              <th>규격</th>
              <th style={{ width: 40 }}>수량</th>
              <th style={{ width: 84 }}>단가</th>
              <th style={{ width: 92 }}>금액</th>
              <th style={{ width: 110 }}>비고</th>
            </tr>
          </thead>
          <tbody>
            {doc.items.map((l, i) => (
              <tr key={i} className={l.counted ? '' : 'opt'}>
                <td className="c">{i + 1}</td>
                <td>
                  {l.name}
                  <Refs ids={l.evidenceIds} />
                </td>
                <td>{l.spec ?? ''}</td>
                <td className="c">{l.qty}</td>
                <td className="n">{l.unitPrice === null ? <span className="dl-q">?</span> : n(l.unitPrice)}</td>
                <td className="n">{l.amount === null ? <span className="dl-q">?</span> : n(l.amount)}</td>
                <td>{l.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="dl-h3">3. 업체 비교</div>
      <table className="dl-table dl-cmp">
        <thead>
          <tr>
            <th>업체</th>
            <th>경로</th>
            <th style={{ width: 90 }}>총액(VAT 포함)</th>
            <th style={{ width: 50 }}>납기</th>
            <th style={{ width: 80 }}>A/S</th>
            <th>조건 충족</th>
          </tr>
        </thead>
        <tbody>
          {doc.vendors.map((v) => (
            <tr key={v.vendorId}>
              <td style={v.recommended ? { fontWeight: 800, background: '#eff6ff' } : undefined}>
                {v.vendorName}
                {v.recommended ? ' (선정)' : ''}
                <Refs ids={v.evidenceIds} />
              </td>
              <td>{CH[v.channel]}</td>
              <td className="n">
                {n(v.total)}
                {!v.complete && <span className="dl-q"> ?</span>}
              </td>
              <td>{v.leadTime}</td>
              <td>{v.warranty}</td>
              <td>{v.overall === 'ok' ? <span className="dl-ok">충족</span> : v.overall === 'violate' ? <span className="dl-bad">{v.violations.join(', ')}</span> : '확인 필요'}</td>
            </tr>
          ))}
          {doc.vendors.length === 0 && (
            <tr>
              <td colSpan={6}>비교할 견적이 없습니다.</td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="dl-notes">
        <h4>선정 사유</h4>
        <Sentences list={doc.reasons} />
      </div>

      <div className="dl-h3">4. 소요 예산</div>
      {b ? (
        <table className="dl-table">
          <tbody>
            <tr>
              <th style={{ width: 110 }}>공급가액</th>
              <td className="n">{won(b.supply)}</td>
              <th style={{ width: 110 }}>부가세</th>
              <td className="n">{won(b.vat)}</td>
            </tr>
            <tr>
              <th>합 계</th>
              <td colSpan={3}>
                <b>금 {b.totalKorean}원정 (₩ {n(b.total)})</b>
                {!b.complete && <span className="dl-q"> 확인 중</span>}
                <Refs ids={b.evidenceIds} />
              </td>
            </tr>
            <tr>
              <th>예산</th>
              <td className="n">{won(b.budgetMax)}</td>
              <th>예산 대비</th>
              <td className="n">{b.remaining >= 0 ? `잔액 ${won(b.remaining)}` : <span className="dl-bad">초과 {won(-b.remaining)}</span>}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <div className="dl-notes">선정 보류로 소요 예산을 확정하지 않았습니다.</div>
      )}

      <div className="dl-h3">5. 납기·결제·인도 조건</div>
      {doc.terms.length === 0 ? (
        <div className="dl-notes">선정 보류로 해당 없음.</div>
      ) : (
        <table className="dl-table">
          <tbody>
            {doc.terms.map((t) => (
              <tr key={t.label}>
                <th style={{ width: 110 }}>{t.label}</th>
                <td>
                  {t.value ?? <span className="dl-q">확인 필요</span>}
                  <Refs ids={t.evidenceIds} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="dl-h3">6. 확인 필요 사항</div>
      {doc.checks.length === 0 ? (
        <div className="dl-notes">확인이 필요한 사항이 없습니다.</div>
      ) : (
        <div className="dl-warn">
          <Sentences list={doc.checks} />
        </div>
      )}

      <div className="dl-h3">붙임. 근거 자료</div>
      <table className="dl-table dl-ev">
        <thead>
          <tr>
            <th style={{ width: 28 }}>번호</th>
            <th>업체·항목</th>
            <th style={{ width: 62 }}>채널</th>
            <th>출처 · 발췌</th>
            <th style={{ width: 92 }}>수집 시각</th>
          </tr>
        </thead>
        <tbody>
          {doc.evidence.map((e) => (
            <tr key={e.id}>
              <td className="c">[{e.id}]</td>
              <td>
                {e.vendorName ? `${e.vendorName} · ` : ''}
                {e.item}: {e.valueText}
              </td>
              {e.kind === 'requirement' ? (
                <>
                  <td>사용자 입력</td>
                  <td>요구 조건</td>
                  <td />
                </>
              ) : e.source ? (
                <>
                  <td>{CH[e.source.channel]}</td>
                  <td style={{ wordBreak: 'break-all' }}>
                    {e.source.ref}
                    <div style={{ color: '#6b7280' }}>“{e.source.snippet}”</div>
                  </td>
                  <td>{e.source.capturedAt.replace('T', ' ').slice(0, 16)}</td>
                </>
              ) : (
                <>
                  <td />
                  <td>
                    <span className="dl-q">출처 없음</span>
                  </td>
                  <td />
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dl-foot">돌다리가 업체 견적을 같은 기준(부가세 포함)으로 정리해 만든 초안입니다. 금액·조건은 붙임의 출처로 확인한 뒤 결재하세요.</div>
    </div>
  );
}
