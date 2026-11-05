import { useState } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, ChevronDown, ChevronRight, ExternalLink, FileText, SlidersHorizontal, Table2, X } from 'lucide-react';
import type { Field, FieldKey, Quote, Requirements, VendorId } from '@shared/types';
import { buildDoc, confirmedSum, confirmQuestions, evaluateConditions, extraSum, lowestListed, priceQty, productAmount, rankQuotes, recommend, won, type Check } from '@shared/quote';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { STATUS_LABEL, useStore, VENDOR_DOT, type SourceEntry } from '@/store';
import { cn } from '@/lib/utils';
import CountUp from '../CountUp';
import docIcon from '@/assets/figma/doc.svg';
import cartIcon from '@/assets/figma/cart.svg';
import { Pill, SectionHead } from './Section';
import { useRunStore, useApi } from '@/runScope';
import { Source, Sources, SourcesContent, SourcesTrigger } from '@/components/ai-elements/sources';
import { CompareChart } from './CompareChart';

const CH = { web: '웹', mail: '메일', file: '파일' } as const;

type View = 'table' | 'chart';
const VIEW_KEY = 'doldari.compareView';
// 마지막으로 고른 보기 방식은 이 컴퓨터에만 기억한다
const readView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'chart' ? 'chart' : 'table';
  } catch {
    return 'table';
  }
};
const saveView = (v: View) => {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    /* 저장 못 해도 화면은 그대로 */
  }
};

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const items: [View, string, typeof Table2][] = [['table', '표', Table2], ['chart', '그래프', BarChart3]];
  return (
    <div role="radiogroup" aria-label="보기 방식" className="flex rounded-lg bg-muted p-1">
      {items.map(([id, label, Icon]) => (
        <button
          key={id}
          role="radio"
          aria-checked={view === id}
          onClick={() => onChange(id)}
          className={cn('flex items-center gap-1.5 rounded-lg px-4 py-2 text-[14px] font-medium transition-colors', view === id ? 'bg-card text-ink dark:bg-input' : 'text-muted-foreground hover:text-ink')}
        >
          <Icon className="size-3.5" /> {label}
        </button>
      ))}
    </div>
  );
}

export function CompareCard() {
  const { quotes, requirements, stage } = useRunStore();
  const [pop, setPop] = useState<SourceEntry | null>(null);
  const [view, setView] = useState<View>(readView);
  const req = (requirements?.deadline ? requirements : null) as Requirements | null;
  const order = rankQuotes(quotes, req);
  const leader = lowestListed(quotes);
  const heads = ['', '업체', '제품가', '설치비', '배송비', 'A/S', '추가 비용', '납기', '합계', '조건', ''];
  return (
    <Card className="relative gap-4 py-4">
      <CardContent className="space-y-4 px-5">
        <SectionHead
          title="견적 비교"
          hint={view === 'table' ? '합계 = 제품가×수량 + 설치비 + 배송비 + A/S 연장비 + 필수 추가 비용. 값이 확인될 때마다 순위를 다시 매겨요. 금액을 누르면 출처가 보여요.' : '항목을 골라 업체별로 비교해 보세요. 막대에 마우스를 올리면 세부 내역이 보여요.'}
          right={<ViewToggle view={view} onChange={(v) => { setView(v); saveView(v); setPop(null); }} />}
        />
        {view === 'chart' ? (
          <CompareChart order={order} />
        ) : (
        <div className="overflow-x-auto" onClick={() => setPop(null)}>
          <table className="w-full border-separate border-spacing-x-0 border-spacing-y-3 whitespace-nowrap text-[13px] font-medium text-ink">
            <thead>
              <tr className="text-left text-[13px] text-muted-foreground">
                {heads.map((h, i) => (
                  <th key={i} className={cn('px-2 font-medium', i >= 2 && i <= 8 && 'text-right', i === 9 && 'text-center')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {order.map((id, i) => (
                <Row key={id} q={quotes[id]!} rank={i + 1} req={req} leader={leader === id} onSource={setPop} canAct={['compare', 'questions', 'draft'].includes(stage)} />
              ))}
            </tbody>
          </table>
        </div>
        )}
        {pop && <SourcePop pop={pop} onClose={() => setPop(null)} />}
        {['questions', 'draft'].includes(stage) && <Recommend />}
      </CardContent>
    </Card>
  );
}

function SourcePop({ pop, onClose }: { pop: SourceEntry; onClose: () => void }) {
  return (
    <div className="absolute left-1/2 top-16 z-10 w-[460px] -translate-x-1/2 rounded-lg border bg-popover p-4 shadow-xl">
      <div className="mb-2 flex items-center gap-2 text-[12px] font-medium">
        출처 <Pill>{CH[pop.channel]}</Pill>
        <button onClick={onClose} aria-label="닫기" className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
      <blockquote className="border-l-2 border-muted-foreground/40 pl-3 text-[12px] leading-relaxed text-muted-foreground">{pop.snippet}</blockquote>
      {/^https?:/.test(pop.ref) && (
        <button onClick={() => window.doldari.openExternal(pop.ref)} className="mt-3 flex max-w-full items-center gap-1 text-left text-[12px] text-primary hover:underline">
          <ExternalLink className="size-3 shrink-0" />
          <span className="truncate">{pop.ref}</span>
        </button>
      )}
    </div>
  );
}

function Row({ q, rank, req, leader, onSource, canAct }: { q: Quote; rank: number; req: Requirements | null; leader: boolean; onSource: (s: SourceEntry) => void; canAct: boolean }) {
  const api = useApi();
  const { flash, vendorStatus, set, scoped, backend } = useRunStore();
  const [opening, setOpening] = useState(false);
  const status = vendorStatus[q.vendorId] ?? 'idle';
  // 주문 페이지를 내장 브라우저로 열고 크게 띄움 (OrderActions의 주문 페이지 열기와 같음)
  const openHere = async () => {
    setOpening(true);
    try {
      const r = await api.openOrder(q.vendorId);
      if (r?.ok && backend === 'electron') set({ expanded: q.vendorId });
    } finally {
      setOpening(false);
    }
  };
  const has = q.listedPrice.value !== null;
  const cond = req && has ? evaluateConditions(q, req) : null;
  const settled = ['done', 'failed', 'waiting_reply', 'needs_mail', 'needs_file'].includes(status);
  const top = rank === 1 && has;
  const isFlash = (keys: FieldKey[]) => Boolean(flash && flash.vendorId === q.vendorId && keys.includes(flash.field) && Date.now() - flash.at < 1500);
  const td = (keys: FieldKey[], content: React.ReactNode, danger = false) => {
    const f = q[keys[0]] as Field<number>;
    const src = keys.map((k) => (q[k].source ? { ...q[k].source!, vendorId: q.vendorId, field: k } : null)).find(Boolean) as SourceEntry | undefined;
    const known = keys.some((k) => q[k].value !== null);
    return (
      <td
        key={`${keys[0]}-${isFlash(keys) ? flash!.at : 0}`}
        onClick={(e) => { e.stopPropagation(); if (src) onSource(src); }}
        className={cn('px-2 py-2 text-right tabular-nums', isFlash(keys) && 'flash', src && 'cursor-pointer decoration-muted-foreground/40 underline-offset-4 hover:underline', danger && 'text-destructive')}
      >
        {known ? content : f.status === 'asked' ? <Pill tone="warn">질문함</Pill> : settled ? <Pill tone="warn">미확인</Pill> : <Pending />}
      </td>
    );
  };
  const n = (v: number | null, zero?: string) => (v === null ? '' : v === 0 && zero ? zero : v.toLocaleString('ko-KR'));
  const wm = q.warrantyMonths.value;
  const ex = extraSum(q);
  const off = <td className="px-2 py-2 text-right text-muted-foreground/40">해당 없음</td>;
  return (
    <motion.tr layout transition={{ type: 'spring', stiffness: 260, damping: 28 }} className={cn('[&>td:first-child]:rounded-l-lg [&>td:last-child]:rounded-r-lg', top ? '[&>td]:bg-row' : '[&>td]:bg-row-alt')}>
      <td className={cn('w-8 py-2 pl-4 text-center text-[14px] font-semibold tabular-nums', top ? 'text-primary' : 'text-muted-foreground')}>{has ? rank : '–'}</td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-2">
          <span className={cn('size-2 shrink-0 rounded-full', VENDOR_DOT[q.vendorId])} />
          <span className="max-w-[200px] truncate text-[14px] font-semibold" title={q.vendorName}>{q.vendorName}</span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 pl-4 text-[11px] text-muted-foreground">
          <span>{CH[q.channel]} 견적</span>
          <span className="text-muted-foreground/40">·</span>
          <span>{STATUS_LABEL[status]}</span>
          {leader && <Pill tone="primary" className="ml-1">표시가 최저</Pill>}
        </div>
      </td>
      {td(['listedPrice'], (
        <span>
          {n(productAmount(q, req))}
          {priceQty(q) > 1 && <span className="block text-[11px] text-muted-foreground">{priceQty(q).toLocaleString('ko-KR')}개당 {q.listedPrice.value?.toLocaleString('ko-KR')}원</span>}
        </span>
      ))}
      {req?.needInstall === false ? off : td(['installFee'], n(q.installFee.value, '포함'))}
      {td(['shippingFee'], n(q.shippingFee.value, '무료'))}
      {req && req.minWarrantyMonths <= 0 ? off : td(['warrantyMonths', 'warrantyExtraFee'], (
        <span>
          {wm !== null ? (wm % 12 === 0 && wm >= 12 ? `${wm / 12}년` : `${wm}개월`) : '?'}
          {q.warrantyExtraFee.value ? <span className="block text-[11px] text-muted-foreground">연장 +{q.warrantyExtraFee.value.toLocaleString('ko-KR')}</span> : null}
        </span>
      ))}
      <td className="px-2 py-2 text-right tabular-nums">{ex ? `+${ex.toLocaleString('ko-KR')}` : <span className="text-muted-foreground/40">없음</span>}</td>
      {td(['leadTimeDays'], q.leadTimeDays.value !== null ? `${q.leadTimeDays.value}일` : '', cond?.deadline === 'violate')}
      <td className={cn('px-2 py-2 text-right tabular-nums', cond?.budget === 'violate' && 'text-destructive')}>
        {has ? (
          <div className="flex flex-col items-end gap-1">
            <span className="text-[14px] font-semibold"><CountUp value={confirmedSum(q, req)} /></span>
            {q.missing.length > 0 && <Pill tone="warn" title={q.missing.join(', ')}>일부 미확인</Pill>}
          </div>
        ) : settled ? <Pill tone="warn">미확인</Pill> : <Pending />}
      </td>
      <td className="px-2 py-2 text-center">{cond ? <CheckPill c={cond.overall} title={cond.violations.join(', ')} /> : <span className="text-muted-foreground/40">–</span>}</td>
      <td className="py-2 pl-2 pr-4 text-right">
        {has && (
          <div className="flex justify-end gap-1">
            <Button variant="outline" className={ROW_BTN} onClick={() => set({ viewer: { kind: 'vendor', id: q.vendorId } })}>
              <img src={docIcon} alt="" width={16} height={16} className="max-w-none shrink-0" /> 견적서
            </Button>
            {canAct && q.channel === 'web' && !scoped && (
              <Button variant="outline" className={ROW_BTN} disabled={opening} onClick={() => void openHere()} title="이 업체 주문 페이지를 앱 안 브라우저로 열기">
                <ExternalLink className="size-4" /> 열기
              </Button>
            )}
            {canAct && (
              <Button variant="outline" className={ROW_BTN} onClick={() => api.draftOrder(q.vendorId)}>
                <img src={cartIcon} alt="" width={16} height={16} className="max-w-none shrink-0" /> 주문 문의
              </Button>
            )}
          </div>
        )}
      </td>
    </motion.tr>
  );
}

/** 표 안 작은 외곽선 버튼 (디자인 30:1066) */
const ROW_BTN = 'h-auto gap-1 border-muted-foreground px-2 py-1.5 text-[12px] font-medium';

const Pending = () => <span className="text-[12px] text-muted-foreground/50">확인 중</span>;

function CheckPill({ c, title }: { c: Check; title: string }) {
  const map = { ok: ['충족', 'ok'], violate: ['안 맞음', 'bad'], unknown: ['확인 필요', 'warn'] } as const;
  return <Pill tone={map[c][1]} title={title || undefined}>{map[c][0]}</Pill>;
}

export function Recommend() {
  const api = useApi();
  const { quotes, requirements, vendorStatus } = useRunStore();
  if (!requirements?.deadline || requirements.budgetMax === undefined) return null;
  const req = requirements as Requirements;
  const rec = recommend(quotes, req);
  const questions = confirmQuestions(quotes, req);
  const pick = rec.vendorId ? quotes[rec.vendorId] : null;
  return (
    <div className="grid gap-4 pt-1 lg:grid-cols-[minmax(0,548px)_minmax(0,1fr)]">
      {/* 디자인 30:1184: 추천 칩 + 업체 이름 + 합계·납기 + 이유 번호 목록 */}
      <div className="flex flex-col gap-6 rounded-lg bg-row-alt p-6">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Pill tone="primary" className="text-[13px]">추천</Pill>
            {rec.tentative && pick && <Pill tone="warn" className="text-[13px]">확인 후 확정</Pill>}
          </div>
          <div className="flex flex-col gap-3 leading-normal">
            <p className="flex items-center gap-2 text-[21px] font-semibold text-ink">
              {pick && <span className={cn('size-2.5 shrink-0 rounded-full', VENDOR_DOT[pick.vendorId])} />}
              {pick ? pick.vendorName : '조건을 모두 만족하는 업체가 없어요'}
            </p>
            {pick && (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 font-medium">
                <span className="flex items-center gap-2">
                  <span className="text-[17px] text-muted-foreground">합계</span>
                  <span className="text-[21px] tabular-nums text-ink">{won(confirmedSum(pick, req))}</span>
                </span>
                {pick.leadTimeDays.value !== null && (
                  <span className="flex items-center gap-2">
                    <span className="text-[17px] text-muted-foreground">납기</span>
                    <span className="text-[21px] tabular-nums text-ink">{pick.leadTimeDays.value}일</span>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <ol className="list-decimal space-y-3 pl-6 text-[16px] font-medium leading-normal text-ink">
          {rec.reasons.map((r) => <li key={r}>{r}</li>)}
        </ol>
        {pick && <OrderPicker defaultVendorId={pick.vendorId} req={req} />}
      </div>
      {questions.length > 0 && (
        <div className="rounded-lg bg-row-alt p-6">
          <div className="text-[16px] font-semibold text-ink">아직 모르는 항목</div>
          <p className="mt-1 text-[13px] text-muted-foreground">업체에 물어보면 합계를 확정할 수 있어요.</p>
          <div className="mt-3 divide-y divide-line">
            {questions.map((q) => {
              const waiting = vendorStatus[q.vendorId] === 'waiting_reply';
              return (
                <div key={q.vendorId} className="flex items-center gap-3 py-3 text-[14px] font-medium">
                  <span className={cn('size-2 shrink-0 rounded-full', VENDOR_DOT[q.vendorId])} />
                  <span className="min-w-0 flex-1">{q.lines.join(' ')}</span>
                  <Button variant="outline" className="h-auto shrink-0 px-4 py-2 text-[13px]" disabled={waiting} onClick={() => api.draftQuestion(q.vendorId)}>
                    {waiting ? '회신 기다리는 중' : '질문 메일 쓰기'}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** 업체별 통일 견적서 요약 타일 */
export function DocsCard() {
  const { quotes, requirements, vendors, set } = useRunStore();
  if (!requirements?.deadline) return null;
  const req = requirements as Requirements;
  const list = rankQuotes(quotes, req).filter((id) => quotes[id]?.listedPrice.value !== null);
  return (
    <div className="space-y-3">
      <SectionHead title="업체별 견적서" hint="업체마다 다른 견적을 같은 양식으로 정리했어요. 누르면 원본과 함께 볼 수 있어요." />
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3 xl:gap-10">
        {list.map((id, i) => {
          const doc = buildDoc(quotes[id]!, req, vendors.find((v) => v.id === id)?.url);
          return (
            <div key={id} className="group flex flex-col rounded-lg rounded-tl-none bg-card p-6 transition-shadow hover:shadow-[0_0_0_1px_var(--line)]">
            <button type="button" onClick={() => set({ viewer: { kind: 'vendor', id } })} className="flex flex-1 flex-col gap-6 text-left">
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone="primary" className="text-[13px]">추천 {i + 1}위</Pill>
                  <span className="text-[13px] font-medium text-muted-foreground">{CH[quotes[id]!.channel]} 견적</span>
                  {!doc.complete && <Pill tone="warn" className="text-[13px]">일부 미확인</Pill>}
                </div>
                <div className="flex flex-col gap-3 text-[21px] font-semibold leading-normal text-ink">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={cn('size-2.5 shrink-0 rounded-full', VENDOR_DOT[id])} />
                    <span className="truncate">{doc.supplier.name}</span>
                  </span>
                  <span className="tabular-nums">{doc.total.toLocaleString('ko-KR')}원</span>
                </div>
                <div className="-mt-2 text-[13px] font-medium text-muted-foreground">공급가 {doc.supply.toLocaleString('ko-KR')} + 부가세 {doc.vat.toLocaleString('ko-KR')}</div>
              </div>
              <div className="flex flex-col gap-4 text-[16px] font-medium leading-normal">
                {doc.lines.filter((l) => l.counted).map((l, k) => (
                  <div key={k} className="flex justify-between gap-3">
                    <span className="truncate text-muted-foreground">{l.name}</span>
                    <span className="shrink-0 tabular-nums text-primary">{l.amount === null ? <span className="text-warn">미확인</span> : l.amount === 0 ? l.note ?? '0' : `${l.amount.toLocaleString('ko-KR')}원`}</span>
                  </div>
                ))}
              </div>
              {doc.missing.length > 0 && <div className="text-[13px] font-medium text-warn">확인 필요: {doc.missing.join(', ')}</div>}
              <div className="mt-auto flex items-center justify-center gap-1 rounded-lg bg-secondary px-4 py-2.5 text-[14px] font-medium text-primary">
                견적서 보기 <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </div>
            </button>
            <QuoteSources q={quotes[id]!} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ReportCard() {
  const api = useApi();
  const { set, quotes, busy, requirements } = useRunStore();
  const count = Object.values(quotes).filter((q) => q && q.listedPrice.value !== null).length;
  const rec = requirements?.deadline && requirements.budgetMax !== undefined ? recommend(quotes, requirements as Requirements) : null;
  const pick = rec?.vendorId ? quotes[rec.vendorId] : null;
  return (
    <Card className="gap-5 p-6">
    <div className="flex flex-row flex-wrap items-center gap-4">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
        <FileText className="size-6" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[17px] font-semibold text-ink">통합 견적서가 준비됐어요</div>
        <div className="mt-1 text-[14px] font-medium text-muted-foreground">업체 {count}곳의 공급가액·부가세·합계·조건과 추천 이유를 한 장에 정리했어요. PDF로 저장할 수 있어요.</div>
      </div>
      <Button variant="outline" className="h-auto px-4 py-2.5 text-[14px]" disabled={busy} onClick={() => void api.revise()}>
        <SlidersHorizontal className="size-4" /> 조건 바꾸기
      </Button>
      <Button variant="outline" className="h-auto px-4 py-2.5 text-[14px]" onClick={() => set({ viewer: { kind: 'approval' } })}>품의서 초안</Button>
      <Button variant="secondary" className="h-auto px-4 py-2.5 text-[14px]" onClick={() => set({ viewer: { kind: 'integrated' } })}>통합 견적서 보기</Button>
    </div>
      {/* 견적에서 끝내지 않고 실제 주문까지: 추천 업체의 주문 페이지 또는 주문 메일 */}
      {pick && (
        <div className="border-t pt-5">
          <OrderPicker defaultVendorId={pick.vendorId} req={requirements as Requirements} />
        </div>
      )}
    </Card>
  );
}

/** 이 견적의 값들이 어느 페이지에서 왔는지 (AI Elements Sources). 웹 출처가 있을 때만 */
function QuoteSources({ q }: { q: Quote }) {
  const refs = new Map<string, string>();
  for (const k of ['listedPrice', 'installFee', 'shippingFee', 'warrantyMonths', 'warrantyExtraFee', 'leadTimeDays'] as const) {
    const src = q[k].source;
    if (src?.channel === 'web' && /^https?:/.test(src.ref) && !refs.has(src.ref)) refs.set(src.ref, src.snippet);
  }
  if (refs.size === 0) return null;
  const host = (u: string) => {
    try {
      return new URL(u).host.replace(/^www\./, '');
    } catch {
      return u;
    }
  };
  return (
    <Sources className="group/src mb-0 mt-3 border-t pt-3 text-muted-foreground">
      <SourcesTrigger count={refs.size} className="text-[12px] hover:text-foreground">
        <span>출처 {refs.size}곳</span>
        <ChevronDown className="size-3.5 transition-transform duration-200 group-data-[state=open]/src:rotate-180" />
      </SourcesTrigger>
      <SourcesContent className="mt-2 w-full gap-1.5">
        {[...refs].map(([ref, snippet]) => (
          <Source key={ref} href={ref} title={host(ref)} className="block rounded-md px-2 py-1.5 text-[12px] hover:bg-muted">
            <span className="block font-medium text-foreground">{host(ref)}</span>
            {snippet && <span className="line-clamp-1 text-muted-foreground">“{snippet}”</span>}
          </Source>
        ))}
      </SourcesContent>
    </Sources>
  );
}

/** 주문할 업체 고르기: 추천 업체가 기본 선택, 견적이 있는 다른 업체로도 바꿔서 주문할 수 있게 */
function OrderPicker({ defaultVendorId, req }: { defaultVendorId: VendorId; req: Requirements }) {
  const { quotes } = useRunStore();
  const [sel, setSel] = useState<VendorId | null>(null);
  // 표시가가 있거나 메일·파일로 받은 견적
  const ids = rankQuotes(quotes, req).filter((id) => {
    const q = quotes[id];
    return q && (q.listedPrice.value !== null || q.channel === 'mail' || q.channel === 'file');
  });
  // 고른 업체가 목록에서 빠지면 추천으로 돌아감
  const cur = sel && ids.includes(sel) ? sel : defaultVendorId;
  const q = quotes[cur];
  if (!q) return null;
  const has = (id: VendorId) => quotes[id]!.listedPrice.value !== null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[16px] font-semibold text-ink">
        <img src={cartIcon} alt="" className="size-5" />
        {q.vendorName}에 주문하기
        <span className="text-[14px] font-medium text-muted-foreground">합계 {has(cur) ? won(confirmedSum(q, req)) : '미확인'}</span>
      </div>
      {ids.length > 1 && (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="주문할 업체">
          {ids.map((id) => {
            const v = quotes[id]!;
            const on = id === cur;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setSel(id)}
                className={cn(
                  'flex h-auto items-center gap-2 rounded-lg border px-4 py-2.5 text-[14px] font-medium transition-colors',
                  on ? 'border-primary bg-tint text-primary' : 'border-line bg-card text-ink hover:bg-muted/50',
                )}
              >
                <span className={cn('size-2 shrink-0 rounded-full', VENDOR_DOT[id])} />
                <span className="max-w-[160px] truncate">{v.vendorName}</span>
                <span className={cn('tabular-nums', on ? 'text-primary' : 'text-muted-foreground')}>{has(id) ? won(confirmedSum(v, req)) : '합계 미확인'}</span>
                {id === defaultVendorId && <Pill tone="primary">추천</Pill>}
              </button>
            );
          })}
        </div>
      )}
      {/* 업체가 바뀌면 안내 문구 등 상태를 새로 */}
      <OrderActions key={cur} vendorId={cur} />
    </div>
  );
}

/** 주문 버튼 묶음: 웹 견적이면 주문 페이지(앱 안 브라우저·내 브라우저), 메일·파일 견적이면 주문 메일.
 *  주문·결제 버튼은 사용자가 직접 누르고, 메일도 사용자가 확인하고 보낸다 */
export function OrderActions({ vendorId }: { vendorId: VendorId }) {
  const api = useApi();
  const { quotes, vendors, backend, set, scoped } = useRunStore();
  const [opening, setOpening] = useState(false);
  const [msg, setMsg] = useState('');
  const q = quotes[vendorId];
  if (!q) return null;
  const src = q.listedPrice.source;
  const url = src?.channel === 'web' && /^https?:\/\//.test(src.ref) ? src.ref : vendors.find((v) => v.id === vendorId)?.url;
  const web = q.channel === 'web' && Boolean(url);
  const openHere = async () => {
    setOpening(true);
    try {
      const r = await api.openOrder(vendorId);
      if (r) {
        setMsg(r.message);
        // 내장 브라우저면 크게 띄워 바로 확인하고 주문할 수 있게
        if (r.ok && backend === 'electron') set({ expanded: vendorId });
      }
    } finally {
      setOpening(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {web && !scoped && (
          <Button className="h-auto w-fit px-4 py-2.5 text-[14px]" disabled={opening} onClick={() => void openHere()}>
            <img src={cartIcon} alt="" className="size-4 brightness-0 invert" /> 주문 페이지 열기
          </Button>
        )}
        {url && (
          <Button variant="outline" className="h-auto w-fit px-4 py-2.5 text-[14px]" onClick={() => void window.doldari.openExternal(url)} title="로그인·결제 정보가 있는 내 브라우저에서 주문">
            <ExternalLink className="size-4" /> 내 브라우저로 열기
          </Button>
        )}
        {!scoped && (
          <Button variant={web ? 'secondary' : 'default'} className="h-auto w-fit px-4 py-2.5 text-[14px]" onClick={() => api.draftOrder(vendorId)}>
            {web ? '주문 문의 폼·메일' : '주문 메일 쓰기'} <ChevronRight className="size-4" />
          </Button>
        )}
      </div>
      <p className="text-[13px] text-muted-foreground">
        {msg ? `${msg} ` : ''}
        {web ? '옵션·수량이 견적과 같은지 확인하고 주문·결제는 직접 해 주세요. 돌다리는 주문 버튼을 누르지 않아요.' : '견적 내용으로 주문 메일을 써 둘게요. 확인하고 보내기를 누르면 발송돼요.'}
      </p>
    </div>
  );
}
