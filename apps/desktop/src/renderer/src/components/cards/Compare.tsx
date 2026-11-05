import { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight, ExternalLink, FileText, ShoppingCart, SlidersHorizontal, X } from 'lucide-react';
import type { Field, FieldKey, Quote, Requirements } from '@shared/types';
import { buildDoc, confirmedSum, confirmQuestions, evaluateConditions, extraSum, lowestListed, priceQty, productAmount, rankQuotes, recommend, type Check } from '@shared/quote';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { STATUS_LABEL, useStore, VENDOR_DOT, type SourceEntry } from '@/store';
import { cn } from '@/lib/utils';
import CountUp from '../CountUp';
import { Pill, SectionHead } from './Section';

const CH = { web: '웹', mail: '메일', file: '파일' } as const;

export function CompareCard() {
  const { quotes, requirements, stage } = useStore();
  const [pop, setPop] = useState<SourceEntry | null>(null);
  const req = (requirements?.deadline ? requirements : null) as Requirements | null;
  const order = rankQuotes(quotes, req);
  const leader = lowestListed(quotes);
  const heads = ['', '업체', '제품가', '설치비', '배송비', 'A/S', '추가 비용', '납기', '합계', '조건', ''];
  return (
    <Card className="relative gap-4 py-4">
      <CardContent className="space-y-4 px-5">
        <SectionHead
          title="견적 비교"
          hint="합계 = 제품가×수량 + 설치비 + 배송비 + A/S 연장비 + 필수 추가 비용. 값이 확인될 때마다 순위를 다시 매겨요."
          right={<span className="text-[12px] text-muted-foreground">금액을 누르면 출처가 보여요</span>}
        />
        <div className="overflow-x-auto" onClick={() => setPop(null)}>
          <table className="w-full whitespace-nowrap text-[13px]">
            <thead>
              <tr className="border-b text-left text-[12px] text-muted-foreground">
                {heads.map((h, i) => (
                  <th key={i} className={cn('px-2.5 pb-2 font-normal', i >= 2 && i <= 8 && 'text-right', i === 9 && 'text-center')}>{h}</th>
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
        {pop && <SourcePop pop={pop} onClose={() => setPop(null)} />}
        {['questions', 'draft'].includes(stage) && <Recommend />}
      </CardContent>
    </Card>
  );
}

function SourcePop({ pop, onClose }: { pop: SourceEntry; onClose: () => void }) {
  return (
    <div className="absolute left-1/2 top-16 z-10 w-[460px] -translate-x-1/2 rounded-lg border bg-popover p-4 shadow-xl">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-medium">
        출처 <Pill>{CH[pop.channel]}</Pill>
        <button onClick={onClose} aria-label="닫기" className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
      <blockquote className="border-l-2 border-muted-foreground/40 pl-3 text-[13px] leading-relaxed text-muted-foreground">{pop.snippet}</blockquote>
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
  const { flash, vendorStatus, set } = useStore();
  const status = vendorStatus[q.vendorId] ?? 'idle';
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
        className={cn('px-2.5 py-3 text-right tabular-nums', isFlash(keys) && 'flash', src && 'cursor-pointer decoration-muted-foreground/40 underline-offset-4 hover:underline', danger && 'text-destructive')}
      >
        {known ? content : f.status === 'asked' ? <Pill tone="warn">질문함</Pill> : settled ? <Pill tone="warn">미확인</Pill> : <Pending />}
      </td>
    );
  };
  const n = (v: number | null, zero?: string) => (v === null ? '' : v === 0 && zero ? zero : v.toLocaleString('ko-KR'));
  const wm = q.warrantyMonths.value;
  const ex = extraSum(q);
  const off = <td className="px-2.5 py-3 text-right text-muted-foreground/40">해당 없음</td>;
  return (
    <motion.tr layout transition={{ type: 'spring', stiffness: 260, damping: 28 }} className={cn('border-b last:border-b-0', top && 'bg-primary/[0.06]')}>
      <td className={cn('w-8 py-3 pl-2.5 text-center text-[15px] font-semibold tabular-nums', top ? 'text-primary' : 'text-muted-foreground')}>{has ? rank : '–'}</td>
      <td className="px-2.5 py-3">
        <div className="flex items-center gap-2">
          <span className={cn('size-2 shrink-0 rounded-full', VENDOR_DOT[q.vendorId])} />
          <span className="max-w-[200px] truncate font-medium" title={q.vendorName}>{q.vendorName}</span>
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
      <td className="px-2.5 py-3 text-right tabular-nums">{ex ? `+${ex.toLocaleString('ko-KR')}` : <span className="text-muted-foreground/40">없음</span>}</td>
      {td(['leadTimeDays'], q.leadTimeDays.value !== null ? `${q.leadTimeDays.value}일` : '', cond?.deadline === 'violate')}
      <td className={cn('px-2.5 py-3 text-right tabular-nums', cond?.budget === 'violate' && 'text-destructive')}>
        {has ? (
          <div className="flex flex-col items-end gap-1">
            <span className="text-[15px] font-semibold"><CountUp value={confirmedSum(q, req)} /></span>
            {q.missing.length > 0 && <Pill tone="warn" title={q.missing.join(', ')}>일부 미확인</Pill>}
          </div>
        ) : settled ? <Pill tone="warn">미확인</Pill> : <Pending />}
      </td>
      <td className="px-2.5 py-3 text-center">{cond ? <CheckPill c={cond.overall} title={cond.violations.join(', ')} /> : <span className="text-muted-foreground/40">–</span>}</td>
      <td className="py-3 pl-2.5 pr-1 text-right">
        {has && (
          <div className="flex justify-end gap-0.5">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[12px]" onClick={() => set({ viewer: { kind: 'vendor', id: q.vendorId } })}>
              <FileText className="size-3.5" /> 견적서
            </Button>
            {canAct && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-[12px]" onClick={() => window.doldari.draftOrder(q.vendorId)}>
                <ShoppingCart className="size-3.5" /> 주문 문의
              </Button>
            )}
          </div>
        )}
      </td>
    </motion.tr>
  );
}

const Pending = () => <span className="text-[12px] text-muted-foreground/50">확인 중</span>;

function CheckPill({ c, title }: { c: Check; title: string }) {
  const map = { ok: ['충족', 'ok'], violate: ['안 맞음', 'bad'], unknown: ['확인 필요', 'warn'] } as const;
  return <Pill tone={map[c][1]} title={title || undefined}>{map[c][0]}</Pill>;
}

export function Recommend() {
  const { quotes, requirements, vendorStatus } = useStore();
  if (!requirements?.deadline || requirements.budgetMax === undefined) return null;
  const req = requirements as Requirements;
  const rec = recommend(quotes, req);
  const questions = confirmQuestions(quotes, req);
  const pick = rec.vendorId ? quotes[rec.vendorId] : null;
  return (
    <div className="grid gap-3 pt-1 lg:grid-cols-[1fr_minmax(0,420px)]">
      <div className="rounded-lg border border-l-[3px] border-l-primary bg-background/40 px-4 py-3.5">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-muted-foreground">추천</span>
          {pick && <span className={cn('size-2 rounded-full', VENDOR_DOT[pick.vendorId])} />}
          <span className="text-[15px] font-semibold">{pick ? pick.vendorName : '조건을 모두 만족하는 업체가 없어요'}</span>
          {rec.tentative && pick && <Pill tone="warn">확인 후 확정</Pill>}
          {pick && (
            <Button size="sm" className="ml-auto" onClick={() => window.doldari.draftOrder(pick.vendorId)}>
              주문 문의 작성 <ChevronRight className="size-3.5" />
            </Button>
          )}
        </div>
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[13px] leading-relaxed text-muted-foreground marker:text-muted-foreground/50">
          {rec.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </div>
      {questions.length > 0 && (
        <div className="rounded-lg border px-4 py-3.5">
          <div className="text-[13px] font-medium">아직 모르는 항목</div>
          <p className="mt-0.5 text-[12px] text-muted-foreground">업체에 물어보면 합계를 확정할 수 있어요.</p>
          <div className="mt-2 divide-y">
            {questions.map((q) => {
              const waiting = vendorStatus[q.vendorId] === 'waiting_reply';
              return (
                <div key={q.vendorId} className="flex items-center gap-2 py-2 text-[13px]">
                  <span className={cn('size-2 shrink-0 rounded-full', VENDOR_DOT[q.vendorId])} />
                  <span className="min-w-0 flex-1">{q.lines.join(' ')}</span>
                  <Button size="sm" variant="outline" className="h-7 shrink-0 text-[12px]" disabled={waiting} onClick={() => window.doldari.draftQuestion(q.vendorId)}>
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
  const { quotes, requirements, vendors, set } = useStore();
  if (!requirements?.deadline) return null;
  const req = requirements as Requirements;
  const list = rankQuotes(quotes, req).filter((id) => quotes[id]?.listedPrice.value !== null);
  return (
    <div className="space-y-3">
      <SectionHead title="업체별 견적서" hint="업체마다 다른 견적을 같은 양식으로 정리했어요. 누르면 원본과 함께 볼 수 있어요." />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {list.map((id, i) => {
          const doc = buildDoc(quotes[id]!, req, vendors.find((v) => v.id === id)?.url);
          return (
            <button
              key={id}
              onClick={() => set({ viewer: { kind: 'vendor', id } })}
              className="group flex flex-col rounded-xl border bg-card p-4 text-left transition-colors hover:border-muted-foreground/40"
            >
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <span className={cn('tabular-nums', i === 0 && 'font-semibold text-primary')}>{i + 1}위</span>
                <span className="text-muted-foreground/40">·</span>
                {CH[quotes[id]!.channel]} 견적
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className={cn('size-2 shrink-0 rounded-full', VENDOR_DOT[id])} />
                <span className="truncate text-[15px] font-semibold">{doc.supplier.name}</span>
              </div>
              <div className="mt-3 flex items-baseline gap-1 tabular-nums">
                <span className="text-2xl font-semibold tracking-tight">{doc.total.toLocaleString('ko-KR')}</span>
                <span className="text-[13px] text-muted-foreground">원</span>
                {!doc.complete && <Pill tone="warn" className="ml-1 self-center">일부 미확인</Pill>}
              </div>
              <div className="text-[12px] text-muted-foreground">공급가 {doc.supply.toLocaleString('ko-KR')} + 부가세 {doc.vat.toLocaleString('ko-KR')}</div>
              <div className="mt-3 space-y-1 border-t pt-3 text-[12px]">
                {doc.lines.filter((l) => l.counted).map((l, k) => (
                  <div key={k} className="flex justify-between gap-2">
                    <span className="truncate text-muted-foreground">{l.name}</span>
                    <span className="shrink-0 tabular-nums">{l.amount === null ? <span className="text-warn">미확인</span> : l.amount === 0 ? l.note ?? '0' : l.amount.toLocaleString('ko-KR')}</span>
                  </div>
                ))}
              </div>
              {doc.missing.length > 0 && <div className="mt-2 text-[12px] text-warn">확인 필요: {doc.missing.join(', ')}</div>}
              <div className="mt-auto flex items-center gap-1 pt-3 text-[12px] font-medium text-muted-foreground group-hover:text-foreground">
                견적서 보기 <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ReportCard() {
  const { set, quotes, busy } = useStore();
  const count = Object.values(quotes).filter((q) => q && q.listedPrice.value !== null).length;
  return (
    <Card className="flex-row items-center gap-4 px-5 py-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
        <FileText className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold">통합 견적서가 준비됐어요</div>
        <div className="mt-0.5 text-[12px] text-muted-foreground">업체 {count}곳의 공급가액·부가세·합계·조건과 추천 이유를 한 장에 정리했어요. PDF로 저장할 수 있어요.</div>
      </div>
      <Button variant="ghost" disabled={busy} onClick={() => void window.doldari.revise()}>
        <SlidersHorizontal className="size-4" /> 조건 바꾸기
      </Button>
      <Button onClick={() => set({ viewer: { kind: 'integrated' } })}>통합 견적서 보기</Button>
    </Card>
  );
}
