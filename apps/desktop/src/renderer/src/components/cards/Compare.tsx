import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BarChart3, Check as CheckIcon, ChevronRight, ExternalLink, FileText, HelpCircle, ImageOff, Info, LayoutGrid, Package, Pause, Play, RotateCcw, SkipBack, SkipForward, Table2, X } from 'lucide-react';
import type { Field, FieldKey, Quote, QuoteOriginal, Requirements, VendorId } from '@shared/types';
import { FIELD_LABELS } from '@shared/types';
import { buildDoc, confirmedSum, confirmQuestions, evaluateConditions, extraSum, lowestListed, orderUrl, priceQty, productAmount, rankQuotes, recommend, won, daysUntil, type Check, type ConditionResult } from '@shared/quote';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Card, CardContent } from '@/components/ui/card';
import { STATUS_LABEL, useStore, VENDOR_DOT, type SourceEntry } from '@/store';
import { cn } from '@/lib/utils';
import CountUp from '../CountUp';
import docIcon from '@/assets/figma/doc.svg';
import cartIcon from '@/assets/figma/cart.svg';
import { Pill, SectionHead } from './Section';
import { useRunStore, useApi } from '@/runScope';
import { CompareChart } from './CompareChart';
import { hasRankChange, stepView, useLiveRankFx, type StepView } from './rankFx';

const CH = { web: '웹', mail: '메일', file: '파일' } as const;
const TOTAL_HINT = '합계 = 제품가×수량 + 설치비 + 배송비 + A/S 연장비 + 필수 추가 비용. 값이 확인될 때마다 순위를 다시 매겨요. 금액을 누르면 출처가 보여요.';

type View = 'cards' | 'table' | 'chart';
// 기본을 카드로 바꾸면서 키를 새로 씀 (예전에 저장된 '표'가 남지 않도록)
const VIEW_KEY = 'doldari.compareView.v2';
// 마지막으로 고른 보기 방식은 이 컴퓨터에만 기억한다
const readView = (): View => {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'table' || v === 'chart' ? v : 'cards';
  } catch {
    return 'cards';
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
  const items: [View, string, typeof Table2][] = [['cards', '카드', LayoutGrid], ['table', '표', Table2], ['chart', '그래프', BarChart3]];
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
  const { quotes: liveQuotes, requirements, stage, rankLog } = useRunStore();
  const [pop, setPop] = useState<SourceEntry | null>(null);
  const [view, setView] = useState<View>(readView);
  const req = (requirements?.deadline ? requirements : null) as Requirements | null;
  // 순위 변동 다시 보기: i번째 기록 단계를 그린다 (at = 그 단계를 띄운 시각, 바뀐 칸 깜빡임용)
  const [rp, setRp] = useState<{ i: number; playing: boolean; at: number } | null>(null);
  const [speed, setSpeed] = useState(1);
  const canReplay = useMemo(() => hasRankChange(rankLog, req), [rankLog, req]);
  const live = useLiveRankFx(rankLog, req);
  const sv: StepView | null = rp ? stepView(rankLog, Math.min(rp.i, rankLog.length - 1), req) : live;
  useEffect(() => {
    if (!rp?.playing) return;
    const t = setTimeout(() => setRp((p) => (p ? (p.i < rankLog.length - 1 ? { i: p.i + 1, playing: true, at: Date.now() } : { ...p, playing: false }) : p)), 1600 / speed);
    return () => clearTimeout(t);
  }, [rp, rankLog.length, speed]);
  const quotes = rp && sv ? sv.quotes : liveQuotes;
  const order = rankQuotes(quotes, req);
  const leader = lowestListed(quotes);
  const hide = hiddenItems(quotes, order, req);
  const shown: View = rp && view === 'chart' ? 'cards' : view;
  const fx = (id: VendorId): Fx | undefined =>
    sv ? { delta: sv.deltas[id], key: rp ? rp.i : rankLog.length, flash: rp && sv.changed.vendorId === id && sv.changed.field ? { vendorId: id, field: sv.changed.field, at: rp.at } : undefined } : undefined;
  // 해당 없는 항목(설치 불필요, A/S 불필요, 모든 업체 추가 비용 없음)은 열을 뺀다
  const heads: [string, string][] = [
    ['', ''], ['업체', ''], ['제품가', 'text-right'],
    ...(hide.install ? [] : [['설치비', 'text-right']] as [string, string][]),
    ['배송비', 'text-right'],
    ...(hide.warranty ? [] : [['A/S', 'text-right']] as [string, string][]),
    ...(hide.extra ? [] : [['추가 비용', 'text-right']] as [string, string][]),
    ['납기', 'text-right'], ['합계', 'text-right'], ['조건', 'text-center'], ['', '']
  ];
  return (
    <Card className="relative gap-4 py-4">
      <CardContent className="space-y-4 px-5">
        <SectionHead
          title={
            <span className="flex items-center gap-1.5">
              견적 비교
              {/* 합계 계산 방법은 아이콘에 마우스를 올리면 보임 */}
              <Hint text={TOTAL_HINT}>
                <span aria-label="합계 계산 방법" className="inline-flex cursor-help"><Info className="size-3.5 text-muted-foreground" /></span>
              </Hint>
            </span>
          }
          hint={view === 'chart' ? '항목을 골라 업체별로 비교해 보세요. 막대에 마우스를 올리면 세부 내역이 보여요.' : undefined}
          right={
            <div className="flex items-center gap-2">
              {canReplay && !rp && (
                <Button variant="outline" className="gap-1.5 rounded-lg px-3 py-2 text-[14px]" onClick={() => { setPop(null); setRp({ i: 0, playing: true, at: Date.now() }); }}>
                  <Play className="size-3.5" /> 순위 변동 다시 보기
                </Button>
              )}
              <ViewToggle view={view} onChange={(v) => { setView(v); saveView(v); setPop(null); }} />
            </div>
          }
        />
        {rp && <ReplayBar i={Math.min(rp.i, rankLog.length - 1)} n={rankLog.length} playing={rp.playing} speed={speed} onSpeed={setSpeed} onChange={(i, playing) => setRp({ i, playing, at: Date.now() })} onClose={() => setRp(null)} />}
        <AnimatePresence mode="wait">
          {sv && (
            <motion.div
              key={rp ? `rp-${rp.i}` : `live-${rankLog.length}`}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className={cn('rounded-lg px-4 py-3 text-[16px] font-semibold leading-snug', Object.keys(sv.deltas).length ? 'bg-amber-300 text-amber-950 shadow-sm' : 'bg-muted text-ink')}
            >
              {!rp && <span className="mr-2 text-[13px] font-medium text-muted-foreground">방금</span>}
              {sv.caption}
            </motion.div>
          )}
        </AnimatePresence>
        {shown === 'chart' ? (
          <CompareChart order={order} />
        ) : shown === 'cards' ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" onClick={() => setPop(null)}>
            {order.map((id, i) => (
              <VendorCard key={id} q={quotes[id]!} rank={i + 1} req={req} hide={hide} onSource={setPop} canAct={!rp && ['compare', 'questions', 'draft'].includes(stage)} fx={fx(id)} />
            ))}
          </div>
        ) : (
        <div className="overflow-x-auto" onClick={() => setPop(null)}>
          <table className="w-full border-separate border-spacing-x-0 border-spacing-y-3 whitespace-nowrap text-[13px] font-medium text-ink">
            <thead>
              <tr className="text-left text-[13px] text-muted-foreground">
                {heads.map(([h, align], i) => (
                  <th key={i} className={cn('px-2 font-medium', align)}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {order.map((id, i) => (
                <Row key={id} q={quotes[id]!} rank={i + 1} req={req} hide={hide} leader={leader === id} onSource={setPop} canAct={!rp && ['compare', 'questions', 'draft'].includes(stage)} fx={fx(id)} />
              ))}
            </tbody>
          </table>
        </div>
        )}
        {pop && <SourcePop pop={pop} onClose={() => setPop(null)} />}
        {!rp && ['questions', 'draft'].includes(stage) && <Recommend />}
      </CardContent>
    </Card>
  );
}

/** 순위 변동 강조: 이동 폭, 깜빡일 칸 (다시 보기 중엔 그 단계 값). key가 바뀌면 강조 애니메이션을 다시 시작 */
type Fx = { delta?: number; key: number; flash?: { vendorId: VendorId; field: FieldKey; at: number } };

function RankDelta({ d }: { d?: number }) {
  if (!d) return null;
  return (
    <motion.span
      initial={{ scale: 0.4, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 18 }}
      className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 text-[12px] font-bold tabular-nums text-white shadow-sm', d > 0 ? 'bg-emerald-600' : 'bg-rose-600')}
      aria-label={d > 0 ? `${d}계단 상승` : `${-d}계단 하락`}
    >
      {d > 0 ? '▲' : '▼'}{Math.abs(d)}
    </motion.span>
  );
}

const SPEEDS = [0.5, 1, 2, 4, 8, 16];

/** 다시 보기 조작: 처음부터·이전·재생/멈춤·다음, 단계 막대, 배속, 닫기 */
function ReplayBar({ i, n, playing, speed, onSpeed, onChange, onClose }: { i: number; n: number; playing: boolean; speed: number; onSpeed: (s: number) => void; onChange: (i: number, playing: boolean) => void; onClose: () => void }) {
  const btn = 'flex size-8 items-center justify-center rounded-md text-ink hover:bg-card disabled:opacity-40';
  const end = i >= n - 1;
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
      <button type="button" className={btn} aria-label="처음부터" onClick={() => onChange(0, true)}><RotateCcw className="size-4" /></button>
      <button type="button" className={btn} aria-label="이전 단계" disabled={i <= 0} onClick={() => onChange(i - 1, false)}><SkipBack className="size-4" /></button>
      <button type="button" className={btn} aria-label={playing ? '멈춤' : '재생'} onClick={() => onChange(end && !playing ? 0 : i, !playing)}>
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </button>
      <button type="button" className={btn} aria-label="다음 단계" disabled={end} onClick={() => onChange(i + 1, false)}><SkipForward className="size-4" /></button>
      <input
        type="range"
        min={0}
        max={Math.max(0, n - 1)}
        value={i}
        aria-label="단계"
        onChange={(e) => onChange(Number(e.target.value), false)}
        className="mx-2 h-1.5 flex-1 cursor-pointer accent-primary"
      />
      <span className="w-20 text-right text-[13px] font-medium tabular-nums text-muted-foreground">{i + 1} / {n}단계</span>
      <Select value={String(speed)} onValueChange={(v) => onSpeed(Number(v))}>
        <SelectTrigger size="sm" aria-label="재생 속도" className="w-[84px] bg-card text-[13px] font-semibold tabular-nums">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SPEEDS.map((s) => (
            <SelectItem key={s} value={String(s)} className="tabular-nums">{s}배속</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button type="button" className={btn} aria-label="다시 보기 닫기" onClick={onClose}><X className="size-4" /></button>
    </div>
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

function Row({ q, rank, req, hide, leader, onSource, canAct, fx }: { q: Quote; rank: number; req: Requirements | null; hide: Hidden; leader: boolean; onSource: (s: SourceEntry) => void; canAct: boolean; fx?: Fx }) {
  const api = useApi();
  const { flash: liveFlash, vendorStatus, set, scoped } = useRunStore();
  const flash = fx?.flash ?? liveFlash;
  const [opening, setOpening] = useState(false);
  const status = vendorStatus[q.vendorId] ?? 'idle';
  // 주문 페이지를 내장 브라우저로 열고 크게 띄움 (OrderActions의 주문 페이지 열기와 같음)
  const openHere = async () => {
    setOpening(true);
    try {
      const r = await api.openOrder(q.vendorId);
      if (r?.ok) set({ expanded: q.vendorId });
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
  return (
    <motion.tr layout transition={{ type: 'spring', stiffness: 260, damping: 28 }} className={cn('[&>td:first-child]:rounded-l-lg [&>td:last-child]:rounded-r-lg', top ? '[&>td]:bg-row' : '[&>td]:bg-row-alt')}>
      <td key={'rank-' + (fx?.key ?? 0)} className={cn('w-8 py-2 pl-4 text-center text-[14px] font-semibold tabular-nums', top ? 'text-primary' : 'text-muted-foreground', fx?.delta && (fx.delta > 0 ? 'rank-up' : 'rank-down'))}>
        <span className="flex flex-col items-center gap-1">{has ? rank : '–'}<RankDelta d={fx?.delta} /></span>
      </td>
      <td key={'name-' + (fx?.key ?? 0)} className={cn('px-2 py-2', fx?.delta && (fx.delta > 0 ? 'rank-up' : 'rank-down'))}>
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
      {!hide.install && td(['installFee'], n(q.installFee.value, '포함'))}
      {td(['shippingFee'], n(q.shippingFee.value, '무료'))}
      {!hide.warranty && td(['warrantyMonths', 'warrantyExtraFee'], (
        <span>
          {wm !== null ? (wm % 12 === 0 && wm >= 12 ? `${wm / 12}년` : `${wm}개월`) : <Hint text="기본 A/S 기간을 업체 자료에서 찾지 못했어요. 확인 질문 메일로 물어볼 수 있어요."><span className="cursor-help">?</span></Hint>}
          {q.warrantyExtraFee.value ? <span className="block text-[11px] text-muted-foreground">연장 +{q.warrantyExtraFee.value.toLocaleString('ko-KR')}</span> : null}
        </span>
      ))}
      {!hide.extra && <td className="px-2 py-2 text-right tabular-nums">{ex ? `+${ex.toLocaleString('ko-KR')}` : <span className="text-muted-foreground/40">없음</span>}</td>}
      {td(['leadTimeDays'], q.leadTimeDays.value !== null ? `${q.leadTimeDays.value}일` : '', cond?.deadline === 'violate')}
      <td className={cn('px-2 py-2 text-right tabular-nums', cond?.budget === 'violate' && 'text-destructive')}>
        {has ? (
          <div className="flex flex-col items-end gap-1">
            <span className="text-[14px] font-semibold"><CountUp value={confirmedSum(q, req)} /></span>
            {q.missing.length > 0 && <Unsettled q={q} />}
          </div>
        ) : settled ? <Pill tone="warn">미확인</Pill> : <Pending />}
      </td>
      <td className="px-2 py-2 text-center">{cond ? <CheckPill c={cond.overall} title={cond.violations.join(', ')} /> : <span className="text-muted-foreground/40">–</span>}</td>
      <td className="py-2 pl-2 pr-4 text-right">
        {has && (
          <div className="flex justify-end gap-1">
            <Button variant="outline" className={ROW_BTN} onClick={() => set({ viewer: { kind: 'vendor', id: q.vendorId } })}>
              <img src={docIcon} alt="" width={16} height={16} className="max-w-none shrink-0 dark:invert" /> 견적서
            </Button>
            {canAct && q.channel === 'web' && !scoped && (
              <Button variant="outline" className={ROW_BTN} disabled={opening} onClick={() => void openHere()} title="이 업체 주문 페이지를 앱 안 브라우저로 열기">
                <ExternalLink className="size-4" /> 열기
              </Button>
            )}
            {canAct && (
              <Button variant="outline" className={ROW_BTN} onClick={() => api.draftOrder(q.vendorId)}>
                <img src={cartIcon} alt="" width={16} height={16} className="max-w-none shrink-0 dark:invert" /> 주문 문의
              </Button>
            )}
          </div>
        )}
      </td>
    </motion.tr>
  );
}

/** 비교에서 뺄 항목: 설치가 필요 없음 · A/S가 필요 없음 · 어느 업체에도 추가 비용이 없음 */
type Hidden = { install: boolean; warranty: boolean; extra: boolean };
function hiddenItems(quotes: Partial<Record<VendorId, Quote>>, order: VendorId[], req: Requirements | null): Hidden {
  return {
    install: req?.needInstall === false,
    warranty: Boolean(req && req.minWarrantyMonths <= 0),
    extra: order.every((id) => !quotes[id] || !extraSum(quotes[id]!))
  };
}

/** 카드에 보여 줄 제품 사진 (견적서·견적 화면 캡처는 쓰지 않는다) */
function useProductPhoto(id: VendorId): string | null {
  const { originals } = useRunStore();
  const list: QuoteOriginal[] = [...(originals[id] ?? [])].reverse();
  return list.find((o) => o.productImage)?.productImage ?? null;
}

const fmtWarranty = (m: number) => (m % 12 === 0 && m >= 12 ? `${m / 12}년` : `${m}개월`);

/** 카드형 비교: 제품 사진 + 업체 이름 + 합계 + 항목 목록 + 버튼만 (군더더기 글씨 없이) */
function VendorCard({ q, rank, req, hide, onSource, canAct, fx }: { q: Quote; rank: number; req: Requirements | null; hide: Hidden; onSource: (s: SourceEntry) => void; canAct: boolean; fx?: Fx }) {
  const api = useApi();
  const { flash: liveFlash, vendorStatus, set, scoped } = useRunStore();
  const flash = fx?.flash ?? liveFlash;
  const photo = useProductPhoto(q.vendorId);
  const [opening, setOpening] = useState(false);
  const status = vendorStatus[q.vendorId] ?? 'idle';
  // 주문 페이지를 내장 브라우저로 열고 크게 띄움 (표의 열기와 같음)
  const openHere = async () => {
    setOpening(true);
    try {
      const r = await api.openOrder(q.vendorId);
      if (r?.ok) set({ expanded: q.vendorId });
    } finally {
      setOpening(false);
    }
  };
  const has = q.listedPrice.value !== null;
  const cond = req && has ? evaluateConditions(q, req) : null;
  const settled = ['done', 'failed', 'waiting_reply', 'needs_mail', 'needs_file'].includes(status);
  const top = rank === 1 && has;
  const total = has ? confirmedSum(q, req) : null;
  const isFlash = (keys: FieldKey[]) => Boolean(flash && flash.vendorId === q.vendorId && keys.includes(flash.field) && Date.now() - flash.at < 1500);
  const n = (v: number | null, zero?: string) => (v === null ? '' : v === 0 && zero ? zero : `${v.toLocaleString('ko-KR')}원`);
  const wm = q.warrantyMonths.value;
  const ex = extraSum(q);

  // 항목 한 줄: 이름 ··· 값. 값을 누르면 출처
  const line = (label: string, keys: FieldKey[], content: React.ReactNode, danger = false) => {
    const f = q[keys[0]] as Field<number>;
    const src = keys.map((k) => (q[k].source ? { ...q[k].source!, vendorId: q.vendorId, field: k } : null)).find(Boolean) as SourceEntry | undefined;
    const known = keys.some((k) => q[k].value !== null);
    return (
      <button
        key={`${keys[0]}-${isFlash(keys) ? flash!.at : 0}`}
        type="button"
        disabled={!src}
        onClick={(e) => { e.stopPropagation(); if (src) onSource(src); }}
        title={src ? '출처 보기' : undefined}
        className={cn('flex items-center justify-between gap-3 rounded-md px-1 py-1 text-left', src && 'hover:bg-card', isFlash(keys) && 'flash')}
      >
        <span className="text-muted-foreground">{label}</span>
        <span className={cn('truncate font-semibold tabular-nums text-ink', danger && 'text-destructive')}>
          {known ? content : f.status === 'asked' ? <Pill tone="warn">질문함</Pill> : settled ? <Pill tone="warn">미확인</Pill> : <Pending />}
        </span>
      </button>
    );
  };

  return (
    <motion.div
      layout
      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
      className={cn('relative flex min-w-0 flex-col overflow-hidden rounded-lg', top ? 'bg-row ring-2 ring-primary/40' : 'bg-row-alt')}
    >
      {/* 순위가 바뀐 카드는 테두리가 초록(상승)·빨강(하락)으로 번쩍인다 */}
      {fx?.delta ? <span key={'fx-' + fx.key} aria-hidden className={cn('pointer-events-none absolute inset-0 z-10 rounded-lg', fx.delta > 0 ? 'rank-up' : 'rank-down')} /> : null}
      {/* 제품 사진 + 순위 + 조건 */}
      <div className="relative aspect-[16/10] overflow-hidden bg-white">
        {photo ? (
          <img src={photo} alt={`${q.vendorName} 제품 사진`} className="size-full object-contain p-3" draggable={false} />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground/40">
            {settled || has ? <ImageOff className="size-8" /> : <Package className="size-8 animate-pulse" />}
          </div>
        )}
        <span className={cn('absolute left-3 top-3 rounded-lg px-2.5 py-1 text-[13px] font-semibold tabular-nums shadow-sm', top ? 'bg-primary text-white' : 'bg-card/95 text-ink')}>
          {has ? `${rank}위` : '–'}
        </span>
        {fx?.delta ? <span key={'d-' + fx.key} className="absolute left-3 top-11"><RankDelta d={fx.delta} /></span> : null}
        {cond && (
          <span className="absolute right-3 top-3 rounded-lg bg-card shadow-sm">
            <CheckPill c={cond.overall} title={cond.violations.join(', ')} />
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        {/* 업체 + 합계 */}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn('size-2.5 shrink-0 rounded-full', VENDOR_DOT[q.vendorId])} />
            <span className="truncate text-[16px] font-semibold text-ink" title={q.vendorName}>{q.vendorName}</span>
          </div>
          <div className={cn('mt-1 text-[26px] font-bold leading-tight tabular-nums', cond?.budget === 'violate' ? 'text-destructive' : top ? 'text-primary' : 'text-ink')}>
            {total !== null ? <CountUp value={total} /> : settled ? <Pill tone="warn">미확인</Pill> : <Pending />}
          </div>
          {total !== null && q.missing.length > 0 && <Unsettled q={q} className="mt-1.5" />}
        </div>

        {/* 항목 */}
        <div className="flex flex-col text-[14px]">
          {line('제품가', ['listedPrice'], n(productAmount(q, req)))}
          {!hide.install && line('설치비', ['installFee'], n(q.installFee.value, '포함'))}
          {line('배송비', ['shippingFee'], n(q.shippingFee.value, '무료'))}
          {!hide.warranty && line('A/S', ['warrantyMonths', 'warrantyExtraFee'], wm !== null ? fmtWarranty(wm) : <Hint text="기본 A/S 기간을 업체 자료에서 찾지 못했어요. 확인 질문 메일로 물어볼 수 있어요."><span className="cursor-help">?</span></Hint>)}
          {!hide.extra && (
            <div className="flex items-center justify-between gap-3 px-1 py-1">
              <span className="text-muted-foreground">추가 비용</span>
              <span className="font-semibold tabular-nums text-ink">{ex ? `+${ex.toLocaleString('ko-KR')}원` : '없음'}</span>
            </div>
          )}
          {line('납기', ['leadTimeDays'], q.leadTimeDays.value !== null ? `${q.leadTimeDays.value}일` : '', cond?.deadline === 'violate')}
        </div>

        {/* 요구 조건 충족 여부 (앱이 판정할 수 있는 예산·납기·A/S만) */}
        {cond && req && <Conditions q={q} req={req} cond={cond} showWarranty={!hide.warranty} />}

        {/* 버튼 */}
        {has && (
          <div className="mt-auto flex flex-wrap gap-2">
            <Button variant="outline" className={cn(ROW_BTN, 'flex-1 py-2')} onClick={() => set({ viewer: { kind: 'vendor', id: q.vendorId } })}>
              <img src={docIcon} alt="" width={16} height={16} className="max-w-none shrink-0 dark:invert" /> 견적서
            </Button>
            {canAct && q.channel === 'web' && !scoped && (
              <Button variant="outline" className={cn(ROW_BTN, 'flex-1 py-2')} disabled={opening} onClick={() => void openHere()} title="이 업체 주문 페이지를 앱 안 브라우저로 열기">
                <ExternalLink className="size-4" /> 열기
              </Button>
            )}
            {canAct && (
              <Button variant="outline" className={cn(ROW_BTN, 'flex-1 py-2')} onClick={() => api.draftOrder(q.vendorId)}>
                <img src={cartIcon} alt="" width={16} height={16} className="max-w-none shrink-0 dark:invert" /> 주문 문의
              </Button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/** 표 안 작은 외곽선 버튼 (디자인 30:1066) */
const ROW_BTN = 'h-auto gap-1 border-muted-foreground px-2 py-1.5 text-[12px] font-medium';

const Pending = () => <span className="text-[12px] text-muted-foreground/50">확인 중</span>;

/** 아직 다 확인되지 않은 견적의 합계 표시: 무엇을 몰라서인지 적는다 (배송비·납기를 모르는 업체가 다 확인된 업체보다 위에 올 수 있어서) */
function Unsettled({ q, className }: { q: Quote; className?: string }) {
  const labels = [...new Set(q.missing.map((k) => FIELD_LABELS[k as FieldKey] ?? k))].join('·');
  return (
    <Hint text={`${labels}을(를) 아직 몰라서 합계·순위가 바뀔 수 있어요. 확인 질문 메일로 채울 수 있어요.`}>
      <span className="inline-flex cursor-help">
        <Pill tone="warn" className={className}>
          미확정 — {labels} 확인 필요
        </Pill>
      </span>
    </Hint>
  );
}

/** 카드 좁은 칸용 금액: 만원 단위로 떨어지면 "20만원" */
const manWon = (n: number) => (n >= 10000 && n % 10000 === 0 ? `${(n / 10000).toLocaleString('ko-KR')}만원` : won(n));

/** 카드 속 요구 조건 체크리스트: 처음에 말한 조건을 업체마다 충족·안 맞음·확인 필요로 보여 준다 */
function Conditions({ q, req, cond, showWarranty }: { q: Quote; req: Requirements; cond: ConditionResult; showWarranty: boolean }) {
  const limit = req.deadline ? daysUntil(req.deadline) : NaN;
  const lead = q.leadTimeDays.value;
  const wm = q.warrantyMonths.value;
  const rows: { key: string; label: string; c: Check; detail: string }[] = [];
  if (req.budgetMax > 0) {
    rows.push({ key: 'budget', label: `예산 ${manWon(req.budgetMax)} 이내`, c: cond.budget, detail: cond.budget === 'unknown' ? '일부 미확인' : '' });
  }
  if (!Number.isNaN(limit)) {
    rows.push({ key: 'deadline', label: `납기 ${limit}일 이내`, c: cond.deadline, detail: lead !== null ? `${lead}일` : '미확인' });
  }
  if (showWarranty && req.minWarrantyMonths > 0) {
    rows.push({ key: 'warranty', label: `A/S ${fmtWarranty(req.minWarrantyMonths)} 이상`, c: cond.warranty, detail: wm !== null ? fmtWarranty(wm) : q.warrantyExtraFee.value !== null ? '연장 가능' : '미확인' });
  }
  if (q.meta?.priceDoubt) rows.push({ key: 'price', label: '가격 기준 확인', c: 'violate', detail: q.meta.priceDoubt });
  if (rows.length === 0) return null;
  const icon = { ok: <CheckIcon className="size-3.5" />, violate: <X className="size-3.5" />, unknown: <HelpCircle className="size-3.5" /> } as const;
  const tone = { ok: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', violate: 'bg-destructive/15 text-destructive', unknown: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' } as const;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-line bg-card/60 px-2.5 py-2 text-[13px]">
      <span className="text-[12px] font-medium text-muted-foreground">요구 조건</span>
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-2">
          <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full', tone[r.c])} aria-label={{ ok: '충족', violate: '안 맞음', unknown: '확인 필요' }[r.c]}>
            {icon[r.c]}
          </span>
          <span className="min-w-0 flex-1 truncate text-ink">{r.label}</span>
          <span className={cn('shrink-0 truncate tabular-nums', r.c === 'violate' ? 'font-semibold text-destructive' : 'text-muted-foreground')} title={r.detail}>
            {r.detail}
          </span>
        </div>
      ))}
    </div>
  );
}

function CheckPill({ c, title }: { c: Check; title: string }) {
  const map = { ok: ['충족', 'ok'], violate: ['안 맞음', 'bad'], unknown: ['확인 필요', 'warn'] } as const;
  const pill = <Pill tone={map[c][1]}>{map[c][0]}</Pill>;
  return title ? (
    <Hint text={title}>
      <span className="inline-flex cursor-help">{pill}</span>
    </Hint>
  ) : (
    pill
  );
}

/** 마우스를 올리면 설명이 뜨는 말풍선 (앱 창에서는 기본 title 말풍선이 잘 안 떠서 직접 그린다) */
function Hint({ text, children }: { text: string; children: React.ReactElement }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent className="max-w-[320px] text-[12px] leading-snug">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
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
                  {pick.missing.length > 0 && <Unsettled q={pick} />}
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
          {/* 이유는 앞의 3개만 */}
          {rec.reasons.slice(0, 3).map((r) => <li key={r}>{r}</li>)}
        </ol>
      </div>
      {questions.length > 0 && (
        <div className="rounded-lg bg-row-alt p-6">
          <div className="text-[16px] font-semibold text-ink">아직 모르는 항목</div>
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
      <SectionHead title="업체별 견적서" />
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
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ReportCard() {
  const { set, quotes, requirements } = useRunStore();
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
      </div>
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
        <img src={cartIcon} alt="" className="size-5 dark:invert" />
        {q.vendorName}에 주문하기
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

// 주문 버튼 안내는 마우스를 올리면 보이게
const WEB_ORDER_NOTE = '옵션·수량이 견적과 같은지 확인하고 주문·결제는 직접 해 주세요. 돌다리는 주문 버튼을 누르지 않아요.';
const MAIL_ORDER_NOTE = '견적 내용으로 주문 메일을 써 둘게요. 확인하고 보내기를 누르면 발송돼요.';

/** 주문 버튼 묶음: 웹 견적이면 주문 페이지(앱 안 브라우저·내 브라우저), 메일·파일 견적이면 주문 메일.
 *  주문·결제 버튼은 사용자가 직접 누르고, 메일도 사용자가 확인하고 보낸다 */
export function OrderActions({ vendorId }: { vendorId: VendorId }) {
  const api = useApi();
  const { quotes, vendors, set, scoped } = useRunStore();
  const [opening, setOpening] = useState(false);
  const [msg, setMsg] = useState('');
  const q = quotes[vendorId];
  if (!q) return null;
  const url = orderUrl(q, vendors.find((v) => v.id === vendorId)?.url);
  const web = q.channel === 'web' && Boolean(url);
  const openHere = async () => {
    setOpening(true);
    try {
      const r = await api.openOrder(vendorId);
      if (r) {
        setMsg(r.message);
        // 내장 브라우저면 크게 띄워 바로 확인하고 주문할 수 있게
        if (r.ok) set({ expanded: vendorId });
      }
    } finally {
      setOpening(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {web && !scoped && (
          <Button className="h-auto w-fit px-4 py-2.5 text-[14px]" disabled={opening} onClick={() => void openHere()} title={WEB_ORDER_NOTE}>
            <img src={cartIcon} alt="" className="size-4 brightness-0 invert" /> 주문 페이지 열기
          </Button>
        )}
        {url && (
          <Button variant="outline" className="h-auto w-fit px-4 py-2.5 text-[14px]" onClick={() => void window.doldari.openExternal(url)} title="로그인·결제 정보가 있는 내 브라우저에서 주문">
            <ExternalLink className="size-4" /> 내 브라우저로 열기
          </Button>
        )}
        {!scoped && (
          <Button variant={web ? 'secondary' : 'default'} className="h-auto w-fit px-4 py-2.5 text-[14px]" onClick={() => api.draftOrder(vendorId)} title={web ? undefined : MAIL_ORDER_NOTE}>
            {web ? '주문 문의 폼·메일' : '주문 메일 쓰기'} <ChevronRight className="size-4" />
          </Button>
        )}
      </div>
      {msg && <p className="text-[12px] text-muted-foreground">{msg}</p>}
    </div>
  );
}
