import { useState } from 'react';
import { motion } from 'framer-motion';
import { FileText, ShoppingCart, SlidersHorizontal } from 'lucide-react';
import type { Field, FieldKey, Quote, Requirements } from '@shared/types';
import { buildDoc, confirmedSum, confirmQuestions, evaluateConditions, extraSum, lowestListed, priceQty, productAmount, rankQuotes, recommend, type Check } from '@shared/quote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { STATUS_LABEL, useStore, VENDOR_DOT, type SourceEntry } from '@/store';
import { cn } from '@/lib/utils';
import CountUp from '../CountUp';
import { api } from '@/lib/api';

const CH = { web: '웹', mail: '메일', file: '파일' } as const;

export function CompareCard() {
  const { quotes, requirements, stage } = useStore();
  const [pop, setPop] = useState<SourceEntry | null>(null);
  const req = (requirements?.deadline ? requirements : null) as Requirements | null;
  const order = rankQuotes(quotes, req);
  const leader = lowestListed(quotes);
  return (
    <Card className="relative gap-3 py-4">
      <CardContent className="space-y-3 px-4">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold tracking-wider text-primary">견적 비교</span>
          <span className="text-[11px] text-muted-foreground">합계 = 제품가×수량 + 설치비 + 배송비 + A/S 연장비 + 필수 추가 비용 · 값이 확정될 때마다 다시 정렬</span>
        </div>
        <div className="overflow-x-auto" onClick={() => setPop(null)}>
          <table className="w-full border-separate border-spacing-y-1 whitespace-nowrap text-[13px]">
            <thead>
              <tr className="text-left text-[11px] text-muted-foreground">
                {['#', '업체', '제품가', '설치비', '배송비', 'A/S', '추가', '납기', '합계', '조건', ''].map((h, i) => (
                  <th key={i} className={cn('px-2 font-medium', i >= 2 && i <= 8 && 'text-right')}>{h}</th>
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
        {pop && (
          <div className="absolute left-1/2 top-14 z-10 w-[440px] -translate-x-1/2 rounded-xl border bg-popover p-3 shadow-2xl">
            <div className="mb-1.5 flex items-center justify-between text-[12px] font-semibold">
              <span>출처 · {CH[pop.channel]}</span>
              <button onClick={() => setPop(null)} className="text-muted-foreground">✕</button>
            </div>
            <blockquote className="rounded-lg bg-muted p-2 text-[13px] leading-relaxed">“{pop.snippet}”</blockquote>
            {/^https?:/.test(pop.ref) && (
              <button onClick={() => window.doldari.openExternal(pop.ref)} className="mt-1.5 break-all text-left text-[11px] text-primary hover:underline">{pop.ref}</button>
            )}
          </div>
        )}
        {['questions', 'draft'].includes(stage) && <Recommend />}
      </CardContent>
    </Card>
  );
}

function Row({ q, rank, req, leader, onSource, canAct }: { q: Quote; rank: number; req: Requirements | null; leader: boolean; onSource: (s: SourceEntry) => void; canAct: boolean }) {
  const { flash, vendorStatus, set } = useStore();
  const status = vendorStatus[q.vendorId] ?? 'idle';
  const has = q.listedPrice.value !== null;
  const cond = req && has ? evaluateConditions(q, req) : null;
  const settled = ['done', 'failed', 'waiting_reply', 'needs_mail', 'needs_file'].includes(status);
  const isFlash = (keys: FieldKey[]) => Boolean(flash && flash.vendorId === q.vendorId && keys.includes(flash.field) && Date.now() - flash.at < 1500);
  const td = (keys: FieldKey[], content: React.ReactNode, danger = false) => {
    const f = q[keys[0]] as Field<number>;
    const src = keys.map((k) => (q[k].source ? { ...q[k].source!, vendorId: q.vendorId, field: k } : null)).find(Boolean) as SourceEntry | undefined;
    const known = keys.some((k) => q[k].value !== null);
    return (
      <td
        key={`${keys[0]}-${isFlash(keys) ? flash!.at : 0}`}
        onClick={(e) => { e.stopPropagation(); if (src) onSource(src); }}
        className={cn('px-2 py-2.5 text-right tabular-nums', isFlash(keys) && 'flash', src && 'cursor-pointer hover:text-primary', danger && 'text-destructive')}
      >
        {known ? content : f.status === 'asked' ? <span className="text-[11px] text-amber-400">질문함</span> : settled ? <span className="font-bold text-orange-400">?</span> : <span className="text-muted-foreground/40">…</span>}
      </td>
    );
  };
  const n = (v: number | null, zero?: string) => (v === null ? '' : v === 0 && zero ? zero : v.toLocaleString('ko-KR'));
  const wm = q.warrantyMonths.value;
  const ex = extraSum(q);
  return (
    <motion.tr layout transition={{ type: 'spring', stiffness: 260, damping: 28 }} className={rank === 1 && has ? 'bg-primary/15' : 'bg-muted/40'}>
      <td className="rounded-l-lg px-2 py-2.5 text-center text-base font-black">{has ? rank : '–'}</td>
      <td className="px-2 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className={cn('size-2 rounded-full', VENDOR_DOT[q.vendorId])} />
          <span className="max-w-[180px] truncate font-semibold">{q.vendorName}</span>
          <Badge variant="secondary" className="px-1 py-0 text-[10px]">{CH[q.channel]}</Badge>
        </div>
        <div className="mt-0.5 flex gap-1 text-[10px] text-muted-foreground">
          {leader && <span className="rounded bg-primary/20 px-1 font-semibold text-primary">표시가 최저</span>}
          <span>{STATUS_LABEL[status]}</span>
        </div>
      </td>
      {td(['listedPrice'], (
        <span>
          {n(productAmount(q, req))}
          {priceQty(q) > 1 && <span className="block text-[10px] text-muted-foreground">{priceQty(q).toLocaleString('ko-KR')}개 {q.listedPrice.value?.toLocaleString('ko-KR')}원</span>}
        </span>
      ))}
      {req?.needInstall === false ? <td className="px-2 text-right text-muted-foreground/40">—</td> : td(['installFee'], n(q.installFee.value, '포함'))}
      {td(['shippingFee'], n(q.shippingFee.value, '무료'))}
      {req && req.minWarrantyMonths <= 0 ? <td className="px-2 text-right text-muted-foreground/40">—</td> : td(['warrantyMonths', 'warrantyExtraFee'], (
        <span>
          {wm !== null ? (wm % 12 === 0 && wm >= 12 ? `${wm / 12}년` : `${wm}개월`) : '?'}
          {q.warrantyExtraFee.value ? <span className="block text-[10px] text-muted-foreground">연장 +{q.warrantyExtraFee.value.toLocaleString('ko-KR')}</span> : null}
        </span>
      ))}
      <td className="px-2 text-right tabular-nums">{ex ? `+${ex.toLocaleString('ko-KR')}` : <span className="text-muted-foreground/40">—</span>}</td>
      {td(['leadTimeDays'], q.leadTimeDays.value !== null ? `${q.leadTimeDays.value}일` : '', cond?.deadline === 'violate')}
      <td className={cn('px-2 py-2.5 text-right text-[15px] font-black tabular-nums', cond?.budget === 'violate' && 'text-destructive')}>
        {has ? (
          <span className="inline-flex items-center gap-1">
            <CountUp value={confirmedSum(q, req)} />
            {q.missing.length > 0 && <span className="rounded-full bg-orange-500 px-1.5 text-[10px] text-white">?</span>}
          </span>
        ) : settled ? <span className="text-orange-400">?</span> : <span className="text-muted-foreground/40">…</span>}
      </td>
      <td className="px-2 text-center">{cond ? <CheckBadge c={cond.overall} title={cond.violations.join(', ')} /> : '–'}</td>
      <td className="rounded-r-lg px-2 text-right">
        {has && (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => set({ viewer: { kind: 'vendor', id: q.vendorId } })}>
              <FileText className="size-3.5" /> 견적서
            </Button>
            {canAct && (
              <>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => api.draftOrder(q.vendorId)}>
                  <ShoppingCart className="size-3.5" /> 주문
                </Button>
              </>
            )}
          </div>
        )}
      </td>
    </motion.tr>
  );
}

function CheckBadge({ c, title }: { c: Check; title: string }) {
  const map = { ok: ['충족', 'bg-emerald-500/15 text-emerald-400'], violate: ['위반', 'bg-destructive/15 text-destructive'], unknown: ['확인', 'bg-orange-500/15 text-orange-400'] };
  return <span title={title} className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', map[c][1])}>{map[c][0]}</span>;
}

export function Recommend() {
  const { quotes, requirements, vendorStatus } = useStore();
  if (!requirements?.deadline || requirements.budgetMax === undefined) return null;
  const req = requirements as Requirements;
  const rec = recommend(quotes, req);
  const questions = confirmQuestions(quotes, req);
  const pick = rec.vendorId ? quotes[rec.vendorId] : null;
  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-primary/50 bg-gradient-to-br from-primary/20 to-transparent p-4">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[11px] font-semibold tracking-wider text-primary">추천</span>
          <span className="text-base font-bold">{pick ? pick.vendorName : '조건을 만족하는 업체 없음'}</span>
          {rec.tentative && pick && <Badge variant="outline" className="border-amber-500/50 text-amber-400">확인 필요</Badge>}
          {pick && (
            <div className="ml-auto flex gap-1.5">
              <Button size="sm" onClick={() => api.draftOrder(pick.vendorId)}>주문 문의 작성</Button>
            </div>
          )}
        </div>
        <ul className="space-y-0.5 text-[13px] text-muted-foreground">
          {rec.reasons.map((r) => <li key={r}>· {r}</li>)}
        </ul>
      </div>
      {questions.length > 0 && (
        <div className="rounded-xl border bg-muted/30 p-3">
          <div className="mb-1.5 text-[12px] font-semibold text-amber-400">견적서에 빠진 항목</div>
          {questions.map((q) => (
            <div key={q.vendorId} className="flex items-center gap-2 py-1 text-[13px]">
              <span className={cn('size-1.5 shrink-0 rounded-full', VENDOR_DOT[q.vendorId])} />
              <span>{q.lines.join(' ')}</span>
              <Button size="sm" variant="outline" className="ml-auto h-7 shrink-0" disabled={vendorStatus[q.vendorId] === 'waiting_reply'} onClick={() => api.draftQuestion(q.vendorId)}>
                {vendorStatus[q.vendorId] === 'waiting_reply' ? '회신 대기' : '질문 메일'}
              </Button>
            </div>
          ))}
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
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {list.map((id, i) => {
        const doc = buildDoc(quotes[id]!, req, vendors.find((v) => v.id === id)?.url);
        return (
          <button key={id} onClick={() => set({ viewer: { kind: 'vendor', id } })} className="group rounded-xl border bg-card p-4 text-left transition hover:border-primary/60 hover:shadow-lg hover:shadow-primary/10">
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <span className={cn('size-2 rounded-full', VENDOR_DOT[id])} />
              {i + 1}위 · {CH[quotes[id]!.channel]} 견적
              <FileText className="ml-auto size-4 text-primary opacity-60 group-hover:opacity-100" />
            </div>
            <div className="mt-1 truncate text-[15px] font-bold">{doc.supplier.name}</div>
            <div className="mt-2 text-2xl font-black tabular-nums">
              {doc.total.toLocaleString('ko-KR')}
              <span className="ml-0.5 text-sm font-semibold text-muted-foreground">원</span>
              {!doc.complete && <span className="ml-1 text-base text-orange-400">?</span>}
            </div>
            <div className="text-[11px] text-muted-foreground">공급가 {doc.supply.toLocaleString('ko-KR')} + 부가세 {doc.vat.toLocaleString('ko-KR')}</div>
            <div className="mt-2 space-y-0.5 text-[12px]">
              {doc.lines.filter((l) => l.counted).map((l, k) => (
                <div key={k} className="flex justify-between gap-2">
                  <span className="truncate text-muted-foreground">{l.name}</span>
                  <span className="shrink-0 tabular-nums">{l.amount === null ? <span className="text-orange-400">?</span> : l.amount === 0 ? l.note ?? '0' : l.amount.toLocaleString('ko-KR')}</span>
                </div>
              ))}
            </div>
            {doc.missing.length > 0 && <div className="mt-2 text-[11px] text-orange-400">확인 필요: {doc.missing.join(', ')}</div>}
            <div className="mt-3 text-[12px] font-semibold text-primary">{id} 업체 견적서 보기 →</div>
          </button>
        );
      })}
    </div>
  );
}

export function ReportCard() {
  const { set, quotes, busy } = useStore();
  const count = Object.values(quotes).filter((q) => q && q.listedPrice.value !== null).length;
  return (
    <Card className="flex-row items-center gap-4 border-primary/40 bg-gradient-to-r from-primary/15 to-card px-5 py-4">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <FileText className="size-6" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">통합 견적서</div>
        <div className="text-[12px] text-muted-foreground">업체 {count}곳의 견적을 한 장으로 — 공급가액·부가세·합계·조건·추천 이유를 같은 기준으로 정리했어요.</div>
      </div>
      <Button variant="outline" disabled={busy} onClick={() => void api.revise()}>
        <SlidersHorizontal className="size-4" /> 조건 변경
      </Button>
      <Button onClick={() => set({ viewer: { kind: 'integrated' } })}>통합 견적서 보기</Button>
    </Card>
  );
}
