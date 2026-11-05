import { useState } from 'react';
import { motion } from 'framer-motion';
import type { Field, FieldKey, Quote, Requirements, VendorId, VendorStatus } from '@shared/types';
import { confirmedSum, daysUntil, extraSum, productAmount } from '@shared/quote';
import { VENDOR_DOT } from '@/store';
import { useRunStore } from '@/runScope';
import { cn } from '@/lib/utils';
import { Pill } from './Section';

type CatId = 'total' | 'product' | 'install' | 'shipping' | 'warranty' | 'extra' | 'lead';
type Unit = 'won' | 'day' | 'month';
interface Cat { id: CatId; label: string; unit: Unit; better: 'low' | 'high'; hint: string }

const CATS: Cat[] = [
  { id: 'total', label: '합계', unit: 'won', better: 'low', hint: '제품가×수량 + 설치비 + 배송비 + A/S 연장비 + 필수 추가 비용' },
  { id: 'product', label: '제품가', unit: 'won', better: 'low', hint: '요청 수량 기준 제품 금액' },
  { id: 'install', label: '설치비', unit: 'won', better: 'low', hint: '설치·시공 비용' },
  { id: 'shipping', label: '배송비', unit: 'won', better: 'low', hint: '배송·운송 비용' },
  { id: 'warranty', label: 'A/S 기간', unit: 'month', better: 'high', hint: '무상 A/S 기간 (길수록 좋아요)' },
  { id: 'extra', label: '추가 비용', unit: 'won', better: 'low', hint: '출장비 등 꼭 내야 하는 추가 비용' },
  { id: 'lead', label: '납기', unit: 'day', better: 'low', hint: '주문부터 받기까지 걸리는 날' }
];

const SETTLED: VendorStatus[] = ['done', 'failed', 'waiting_reply', 'needs_mail', 'needs_file'];

type Point =
  | { state: 'known'; v: number; partial?: boolean }
  | { state: 'asked' | 'unknown' | 'pending' };

const fmt = (v: number, unit: Unit) => (unit === 'won' ? `${v.toLocaleString('ko-KR')}원` : unit === 'day' ? `${v}일` : v % 12 === 0 && v >= 12 ? `${v / 12}년` : `${v}개월`);
/** 축 눈금: 만 단위로 짧게 */
const tick = (v: number, unit: Unit) => {
  if (unit !== 'won') return unit === 'day' ? `${v}일` : `${v}개월`;
  if (v === 0) return '0';
  if (v >= 100_000_000) return `${+(v / 100_000_000).toFixed(1)}억`;
  if (v >= 10_000) return `${+(v / 10_000).toFixed(1)}만`;
  return v.toLocaleString('ko-KR');
};
/** 0에서 시작하는 깔끔한 최댓값 (눈금 4칸) */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const raw = v / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  return step * 4;
}

function pointOf(cat: CatId, q: Quote, req: Requirements | null, settled: boolean): Point {
  const field = (f: Field<number>): Point => (f.value !== null ? { state: 'known', v: f.value } : f.status === 'asked' ? { state: 'asked' } : { state: settled ? 'unknown' : 'pending' });
  const priced = q.listedPrice.value !== null;
  const none: Point = { state: settled ? 'unknown' : 'pending' };
  switch (cat) {
    case 'total':
      return priced ? { state: 'known', v: confirmedSum(q, req), partial: q.missing.length > 0 } : none;
    case 'product':
      return priced ? { state: 'known', v: productAmount(q, req)! } : field(q.listedPrice);
    case 'install':
      return field(q.installFee);
    case 'shipping':
      return field(q.shippingFee);
    case 'warranty':
      return field(q.warrantyMonths);
    case 'extra':
      return priced ? { state: 'known', v: extraSum(q) } : none;
    case 'lead':
      return field(q.leadTimeDays);
  }
}

/** 기준선: 합계=예산, 납기=남은 날, A/S=최소 기간 */
function refOf(cat: CatId, req: Requirements | null): { v: number; label: string; over: string } | null {
  if (!req) return null;
  if (cat === 'total' && req.budgetMax !== undefined) return { v: req.budgetMax, label: `예산 ${tick(req.budgetMax, 'won')}원`, over: '예산 초과' };
  if (cat === 'lead' && req.deadline) {
    const d = daysUntil(req.deadline);
    return d > 0 ? { v: d, label: `기한까지 ${d}일`, over: '기한 넘김' } : null;
  }
  if (cat === 'warranty' && req.minWarrantyMonths > 0) return { v: req.minWarrantyMonths, label: `최소 ${req.minWarrantyMonths}개월`, over: '기준 미달' };
  return null;
}

/** 견적 비교 그래프: 카테고리를 골라 업체별 막대로 본다 */
/** 순위 변동 강조: 이동 폭, 깜빡일 칸 (다시 보기 중엔 그 단계 값). key가 바뀌면 강조 애니메이션을 다시 시작 */
export type Fx = { delta?: number; key: number; flash?: { vendorId: VendorId; field: FieldKey; at: number } };

export function RankDelta({ d }: { d?: number }) {
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

/** quotes: 순위 변동 다시 보기 중이면 그 단계 견적 (아직 확인 전인 값은 "확인 중"). fx: 순위 이동 강조 */
export function CompareChart({ order, quotes: step, fx }: { order: VendorId[]; quotes?: Partial<Record<VendorId, Quote>>; fx?: (id: VendorId) => Fx | undefined }) {
  // 이전 검색 카드 안이면 그 검색의 값으로 그린다
  const { quotes: runQuotes, requirements, vendorStatus } = useRunStore();
  const quotes = step ?? runQuotes;
  const req = (requirements?.deadline ? requirements : null) as Requirements | null;
  const cats = CATS.filter((c) => !(c.id === 'install' && req?.needInstall === false) && !(c.id === 'warranty' && req && req.minWarrantyMonths <= 0));
  const [catId, setCatId] = useState<CatId>('total');
  const [hover, setHover] = useState<VendorId | null>(null);
  const cat = cats.find((c) => c.id === catId) ?? cats[0];

  const rows = order.map((id) => {
    const q = quotes[id]!;
    return { id, q, p: pointOf(cat.id, q, req, !step && SETTLED.includes(vendorStatus[id] ?? 'idle')) };
  });
  const known = rows.filter((r) => r.p.state === 'known') as (typeof rows[number] & { p: { state: 'known'; v: number; partial?: boolean } })[];
  // 이 카테고리 기준으로 정렬 (모르는 값은 뒤로). 색은 순위가 아니라 업체를 따라간다
  const sorted = [...known].sort((a, b) => (cat.better === 'low' ? a.p.v - b.p.v : b.p.v - a.p.v));
  const ordered = [...sorted, ...rows.filter((r) => r.p.state !== 'known')];
  const ref = refOf(cat.id, req);
  const max = niceMax(Math.max(0, ...known.map((r) => r.p.v), ref?.v ?? 0));
  const ticks = [0, 1, 2, 3, 4].map((i) => (max / 4) * i);
  // '가장 저렴' 같은 표시는 값이 다 확인된 업체끼리만 비교해서 준다
  const sure = sorted.filter((r) => !r.p.partial);
  const best = sure.length >= 2 && sure[0].p.v !== sure[1].p.v ? sure[0].id : null;
  const pct = (v: number) => `${(v / max) * 100}%`;
  const isOver = (v: number) => (ref ? (cat.better === 'high' ? v < ref.v : v > ref.v) : false);

  return (
    <div className="space-y-4">
      {/* 카테고리 선택 */}
      <div role="tablist" aria-label="비교할 항목" className="flex flex-wrap gap-1.5">
        {cats.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={c.id === cat.id}
            onClick={() => setCatId(c.id)}
            className={cn(
              'rounded-md border px-2.5 py-1 text-[12px] transition-colors',
              c.id === cat.id ? 'border-foreground/30 bg-secondary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      <p className="text-[12px] text-muted-foreground">
        {cat.hint} · {cat.better === 'low' ? '짧은 막대가 유리해요' : '긴 막대가 유리해요'}
      </p>

      {/* 막대 그래프: 왼쪽 업체 이름 / 오른쪽 그림 영역 (끝에 값 표시할 자리 120px) */}
      <div className="grid grid-cols-[200px_1fr] gap-x-4">
        {/* 눈금 */}
        <div />
        <div className="relative mr-[120px] h-5 text-[11px] tabular-nums text-muted-foreground">
          {ticks.map((t, i) => (
            <span key={i} className={cn('absolute top-0', i === 0 ? '' : i === 4 ? '-translate-x-full' : '-translate-x-1/2')} style={{ left: pct(t) }}>
              {tick(t, cat.unit)}
            </span>
          ))}
        </div>

        {ordered.map((r) => {
          const p = r.p;
          const f = fx?.(r.id);
          const moved = f?.delta ? (f.delta > 0 ? 'rank-up' : 'rank-down') : '';
          const over = p.state === 'known' && isOver(p.v);
          return (
            <motion.div
              layout
              key={r.id}
              transition={{ type: 'spring', stiffness: 260, damping: 30 }}
              className="relative col-span-2 grid grid-cols-subgrid"
              onMouseEnter={() => setHover(r.id)}
              onMouseLeave={() => setHover((h) => (h === r.id ? null : h))}
            >
              {moved && <span key={'fx-' + f!.key} aria-hidden className={cn('pointer-events-none absolute inset-0 z-20 rounded-lg', moved)} />}
              <div className={cn('flex h-11 min-w-0 items-center gap-2 text-[13px]', hover && hover !== r.id && 'opacity-60')}>
                <span className={cn('size-2 shrink-0 rounded-full', VENDOR_DOT[r.id])} />
                <span className="truncate font-medium" title={r.q.vendorName}>{r.q.vendorName}</span>
                {f?.delta ? <RankDelta key={'d-' + f.key} d={f.delta} /> : null}
                {best === r.id && <Pill tone="primary">{cat.better === 'low' ? (cat.unit === 'won' ? '가장 저렴' : '가장 빠름') : '가장 길어요'}</Pill>}
              </div>
              <div className="relative mr-[120px] h-11">
                {/* 세로 눈금선 */}
                {ticks.map((t, i) => (
                  <span key={i} className="absolute inset-y-0 w-px bg-border/60" style={{ left: pct(t) }} />
                ))}
                {p.state === 'known' ? (
                  <>
                    <motion.div
                      className={cn('absolute left-0 top-1/2 h-5 -translate-y-1/2 rounded-r-[4px]', VENDOR_DOT[r.id], hover && hover !== r.id && 'opacity-50', f?.flash && 'animate-pulse')}
                      initial={false}
                      animate={{ width: pct(p.v) }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                    />
                    <motion.div
                      className="absolute top-1/2 z-10 ml-1 flex -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded bg-card px-1 text-[13px] tabular-nums"
                      initial={false}
                      animate={{ left: pct(p.v) }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                    >
                      <span className="font-semibold">{p.v === 0 ? zeroLabel(cat.id) : fmt(p.v, cat.unit)}</span>
                      {p.partial && <Pill tone="warn" title={r.q.missing.join(', ')}>일부 미확인</Pill>}
                      {over && ref && <Pill tone="bad">{ref.over}</Pill>}
                    </motion.div>
                  </>
                ) : (
                  <div className="absolute inset-y-0 left-0 flex items-center">
                    {p.state === 'pending' ? <span className="text-[12px] text-muted-foreground/60">확인 중</span> : <Pill tone="warn">{p.state === 'asked' ? '질문함' : '미확인'}</Pill>}
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}

        {/* 기준선 (예산·기한·최소 A/S) */}
        {ref && (
          <>
            <div />
            <div className="relative mr-[120px] h-0">
              <span
                className="pointer-events-none absolute w-px bg-muted-foreground/70"
                style={{ left: pct(ref.v), bottom: 0, height: `${ordered.length * 44}px` }}
              />
              <span className="absolute top-1 -translate-x-1/2 whitespace-nowrap text-[11px] text-muted-foreground" style={{ left: pct(ref.v) }}>
                {ref.label}
              </span>
            </div>
          </>
        )}
      </div>
      {ref && <div className="h-3" />}

      {/* 세부 내역: 막대를 가리지 않게 그래프 아래 고정 자리에 */}
      {(() => {
        const h = hover ? ordered.find((r) => r.id === hover && r.p.state === 'known') : null;
        return (
          <div className="min-h-[44px] rounded-lg border border-dashed px-3 py-2.5 text-[12px]">
            {h ? <Tip q={h.q} req={req} cat={cat} /> : <span className="text-muted-foreground">막대에 마우스를 올리면 세부 내역과 출처가 여기에 보여요.</span>}
          </div>
        );
      })()}
    </div>
  );
}

const zeroLabel = (cat: CatId) => (cat === 'install' ? '포함 (0원)' : cat === 'shipping' ? '무료 (0원)' : cat === 'extra' ? '없음' : '0');

/** 마우스를 올리면 그 업체의 세부 내역 */
function Tip({ q, req, cat }: { q: Quote; req: Requirements | null; cat: Cat }) {
  const won = (v: number | null, zero?: string) => (v === null ? '미확인' : v === 0 && zero ? zero : `${v.toLocaleString('ko-KR')}원`);
  const lines: [string, string][] =
    cat.id === 'total'
      ? [
          ['제품가', won(productAmount(q, req))],
          ...(req?.needInstall === false ? [] : [['설치비', won(q.installFee.value, '포함')] as [string, string]]),
          ['배송비', won(q.shippingFee.value, '무료')],
          ...(req && req.minWarrantyMonths <= 0 ? [] : [['A/S 연장비', won(q.warrantyExtraFee.value, '없음')] as [string, string]]),
          ['추가 비용', won(extraSum(q), '없음')]
        ]
      : cat.id === 'extra'
        ? (q.meta?.extras ?? []).filter((e) => e.required).map((e) => [e.name, `${e.amount.toLocaleString('ko-KR')}원`] as [string, string])
        : [];
  const src = cat.id === 'install' ? q.installFee.source : cat.id === 'shipping' ? q.shippingFee.source : cat.id === 'warranty' ? q.warrantyMonths.source : cat.id === 'lead' ? q.leadTimeDays.source : cat.id === 'product' ? q.listedPrice.source : undefined;
  if (lines.length === 0 && !src) return <span className="text-muted-foreground">{q.vendorName} · 따로 확인된 세부 내역이 없어요.</span>;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
      <span className="flex items-center gap-1.5 font-medium">
        <span className={cn('size-2 rounded-full', VENDOR_DOT[q.vendorId])} />
        {q.vendorName}
      </span>
      {lines.map(([k, v]) => (
        <span key={k} className="flex gap-1.5">
          <span className="text-muted-foreground">{k}</span>
          <span className={cn('tabular-nums', v === '미확인' && 'text-warn')}>{v}</span>
        </span>
      ))}
      {src && <span className="text-muted-foreground">출처 “{src.snippet}”</span>}
    </div>
  );
}
