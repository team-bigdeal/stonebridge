// 오른쪽 요구 조건 패널: 대화로 채운 조건을 항상 보이는 자리에서 확인·수정하고 검색을 시작한다
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, PanelRight, Search } from 'lucide-react';
import type { Requirements, ReqSpec } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useApi } from '@/runScope';
import { cn } from '@/lib/utils';
import { PANEL_WIDTH, savePanel, saveWidth, useStore } from '@/store';
import { ResizeHandle } from './ResizeHandle';

const WARRANTY = [
  { months: 0, label: '필요 없음' },
  { months: 6, label: '6개월' },
  { months: 12, label: '1년' },
  { months: 24, label: '2년' }
];

export function RequirementsPanel() {
  const { requirements, stage, reqReady, reqAsking, busy, timeline, replay, panelWidth, panelOpen, set } = useStore();
  const [open, setOpen] = useState(true);
  const [closing, setClosing] = useState(false);
  // 대화가 시작돼 요구 조건이 생긴 뒤부터 보인다
  if (!timeline.some((t) => t.kind === 'requirements')) return null;
  const r = requirements ?? {};
  const editing = stage === 'interview' && !replay;
  const toggle = (v: boolean) => {
    savePanel(v);
    set({ panelOpen: v });
  };
  // 닫혀 있으면 오른쪽 끝에 다시 여는 탭만
  if (!panelOpen) {
    return (
      <button
        type="button"
        onClick={() => toggle(true)}
        title="요구 조건 열기"
        className="flex w-10 shrink-0 flex-col items-center gap-2 border-l bg-white pt-4 text-[13px] font-medium text-muted-foreground hover:text-ink"
      >
        <PanelRight className="size-4" />
        <span className="[writing-mode:vertical-rl]">요구 조건</span>
      </button>
    );
  }

  return (
    <aside className={cn('relative flex shrink-0 flex-col border-l bg-white transition-opacity', closing && 'opacity-40')} style={{ width: panelWidth }}>
      <ResizeHandle
        side="left"
        label="요구 조건 너비 조절"
        width={panelWidth}
        range={PANEL_WIDTH}
        onResize={(w) => set({ panelWidth: w })}
        onDone={(w) => saveWidth('doldari.panelWidth', w)}
        onClosing={setClosing}
        onClose={() => toggle(false)}
      />
      <div className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between pl-5 pr-3 pb-2 pt-4">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-left text-[15px] font-semibold text-ink" aria-expanded={open}>
          요구 조건
          <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', !open && '-rotate-90')} />
        </button>
        <button type="button" onClick={() => toggle(false)} title="요구 조건 닫기" aria-label="요구 조건 닫기" className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-ink">
          <PanelRight className="size-4" />
        </button>
      </div>
      {open && (editing ? <Editor r={r} ready={reqReady} asking={reqAsking} busy={busy} /> : <Summary r={r} />)}
      </div>
    </aside>
  );
}

/** 검색을 시작한 뒤: 정한 조건을 읽기 전용으로 */
function Summary({ r }: { r: Partial<Requirements> }) {
  const api = useApi();
  const shown = r.shown ?? { install: true, warranty: true, region: true };
  const rows: [string, string | undefined][] = [
    ['품목', r.item],
    ['수량', r.quantity !== undefined ? `${r.quantity.toLocaleString('ko-KR')}개` : undefined],
    ['예산', r.budgetMax !== undefined ? `${r.budgetMax.toLocaleString('ko-KR')}원 이하` : undefined],
    ['납기', r.deadline ? `${r.deadline}까지` : undefined],
    ...(shown.install ? [['설치', r.needInstall === undefined ? undefined : r.needInstall ? '필요' : '필요 없음'] as [string, string | undefined]] : []),
    ...(shown.warranty ? [['A/S', r.minWarrantyMonths ? `${r.minWarrantyMonths}개월 이상` : '필요 없음'] as [string, string | undefined]] : []),
    ...(shown.region ? [['지역', r.region] as [string, string | undefined]] : []),
    ...(r.specs ?? []).map((s) => [s.label, s.value ? `${s.value}${s.unit ?? ''}` : undefined] as [string, string | undefined])
  ];
  return (
    <div className="flex flex-col gap-1 px-5 pb-6">
      <p className="pb-2 text-[13px] text-muted-foreground">이 조건으로 업체를 찾고 있어요.</p>
      <dl className="flex flex-col">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 border-b border-line/60 py-2.5 text-[14px]">
            <dt className="shrink-0 text-muted-foreground">{k}</dt>
            <dd className={cn('min-w-0 truncate text-right font-medium', v ? 'text-black' : 'text-muted-foreground/60')} title={v}>
              {v ?? '—'}
            </dd>
          </div>
        ))}
      </dl>
      <Button variant="outline" className="mt-3 h-auto w-full py-2.5 text-[14px]" onClick={() => void api.revise()}>
        조건 바꾸기
      </Button>
    </div>
  );
}

/** 검색 전: 값을 바로 고치고 사용자가 눌러야 검색 시작 */
function Editor({ r, ready, asking, busy }: { r: Partial<Requirements>; ready: boolean; asking: boolean; busy: boolean }) {
  const api = useApi();
  // 고친 값만 따로 들고 있다가 시작할 때 넘긴다. 대화로 같은 칸이 새로 정해지면 대화 값을 보여 준다
  const [edit, setEdit] = useState<Partial<Requirements>>({});
  const [specEdit, setSpecEdit] = useState<Record<string, string>>({});
  const [starting, setStarting] = useState(false);
  const prev = useRef(r);
  useEffect(() => {
    const before = prev.current;
    prev.current = r;
    setEdit((e) => {
      const next = { ...e };
      for (const k of Object.keys(next) as (keyof Requirements)[]) if (r[k] !== before[k] && r[k] !== undefined) delete next[k];
      return next;
    });
  }, [r]);

  const v = { ...r, ...edit };
  const shown = r.shown ?? { install: true, warranty: true, region: true };
  const item = (v.item ?? '').trim();
  const canStart = ready && Boolean(item) && !busy && !starting;
  const specs = (r.specs ?? []).map((s) => ({ ...s, value: specEdit[s.label] ?? s.value }));
  const fields = 4 + (shown.install ? 1 : 0) + (shown.warranty ? 1 : 0) + (shown.region ? 1 : 0) + specs.length;
  const filled =
    [v.item, v.quantity, v.budgetMax, v.deadline].filter((x) => x !== undefined && x !== '').length +
    (shown.install && v.needInstall !== undefined ? 1 : 0) +
    (shown.warranty && v.minWarrantyMonths !== undefined ? 1 : 0) +
    (shown.region && v.region ? 1 : 0) +
    specs.filter((s) => s.value).length;

  async function start() {
    setStarting(true);
    try {
      await api.startSearch({ ...edit, ...(Object.keys(specEdit).length ? { specs } : {}) });
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 px-5 pb-6">
      <div className="flex items-center justify-between text-[13px] text-muted-foreground">
        <span>대화로 채운 값이에요. 다르면 바로 고쳐 주세요.</span>
        <span className="shrink-0 tabular-nums text-primary">
          {filled}/{fields}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${(filled / Math.max(1, fields)) * 100}%` }} />
      </div>

      <Field label="품목">
        <TextBox value={v.item ?? ''} placeholder="어떤 걸 찾으세요?" onChange={(t) => setEdit({ ...edit, item: t })} />
      </Field>

      <Field label="수량" value={v.quantity !== undefined ? `${v.quantity.toLocaleString('ko-KR')}개` : undefined}>
        <Slider value={v.quantity} base={r.quantity ?? 1} kind="qty" onChange={(n) => setEdit({ ...edit, quantity: n })} />
      </Field>

      <Field label="예산" value={v.budgetMax !== undefined ? `${shortWon(v.budgetMax)} 이하` : undefined}>
        <Slider value={v.budgetMax} base={r.budgetMax ?? 1_000_000} kind="won" onChange={(n) => setEdit({ ...edit, budgetMax: n })} />
      </Field>

      <Field label="납기">
        <TextBox type="date" value={v.deadline ?? ''} onChange={(t) => setEdit({ ...edit, deadline: t })} suffix="까지" />
      </Field>

      {shown.install && (
        <Field label="설치">
          <Toggle
            value={v.needInstall === undefined ? undefined : v.needInstall ? 'y' : 'n'}
            options={[
              { value: 'y', label: '필요' },
              { value: 'n', label: '필요 없음' }
            ]}
            onChange={(x) => setEdit({ ...edit, needInstall: x === 'y' })}
          />
        </Field>
      )}

      {shown.warranty && (
        <Field label="A/S">
          <Toggle
            value={v.minWarrantyMonths === undefined ? undefined : String(WARRANTY.find((w) => w.months === v.minWarrantyMonths)?.months ?? '')}
            options={WARRANTY.map((w) => ({ value: String(w.months), label: w.label }))}
            onChange={(x) => setEdit({ ...edit, minWarrantyMonths: Number(x) })}
          />
        </Field>
      )}

      {shown.region && (
        <Field label="지역">
          <TextBox value={v.region ?? ''} placeholder="예: 대구 수성구" onChange={(t) => setEdit({ ...edit, region: t })} />
        </Field>
      )}

      {specs.length > 0 && <div className="-mb-1 border-t border-line/60 pt-4 text-[13px] font-medium text-muted-foreground">{item || '품목'}에 맞는 조건</div>}
      {specs.map((s) => (
        <Field key={s.label} label={s.label}>
          <SpecInput spec={s} onChange={(t) => setSpecEdit({ ...specEdit, [s.label]: t })} />
        </Field>
      ))}

      <div className="flex flex-col gap-2 pt-1">
        <Button className="h-auto w-full py-3 text-[14px]" disabled={!canStart} onClick={() => void start()}>
          <Search className="size-4" /> {starting ? '시작하는 중…' : asking ? '지금 바로 시작' : '이 조건으로 찾기 시작'}
        </Button>
        <p className="text-center text-[12px] text-muted-foreground">
          {!item ? '어떤 품목인지 알려 주시면 시작할 수 있어요.' : ready ? '남은 질문에 답하지 않아도 바로 시작할 수 있어요.' : '조건을 조금 더 알려 주시면 시작할 수 있어요.'}
        </p>
      </div>
    </div>
  );
}

// ─── 조각 ─────────────────────────────────────────────────────

function Field({ label, value, children }: { label: string; value?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        {value && <span className="text-[15px] font-semibold tabular-nums text-black">{value}</span>}
      </div>
      {children}
    </div>
  );
}

function TextBox({ value, onChange, placeholder, type = 'text', suffix }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; suffix?: string }) {
  return (
    <label className={cn('flex items-center gap-2 rounded-lg px-4 py-2.5 focus-within:ring-2 focus-within:ring-primary/30', value ? 'bg-tint' : 'bg-muted')}>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-[14px] font-medium text-black shadow-none placeholder:text-muted-foreground focus-visible:ring-0 md:text-[14px]"
      />
      {suffix && value && <span className="shrink-0 text-[13px] text-muted-foreground">{suffix}</span>}
    </label>
  );
}

/** 메인 화면의 회색 토글 ("나란히 / 크게 보기"와 같은 모양) */
function Toggle({ value, options, onChange }: { value?: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="flex rounded-lg bg-muted p-1" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('flex-1 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors', value === o.value ? 'bg-white text-black shadow-sm' : 'text-muted-foreground hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SpecInput({ spec, onChange }: { spec: ReqSpec; onChange: (v: string) => void }) {
  if (spec.options?.length) {
    return <Toggle value={spec.value ?? undefined} options={spec.options.map((o) => ({ value: o, label: o }))} onChange={onChange} />;
  }
  return <TextBox value={spec.value ?? ''} placeholder={spec.unit ? `단위: ${spec.unit}` : '...'} onChange={onChange} suffix={spec.unit} />;
}

const shortWon = (n: number) => (n >= 10_000 && n % 10_000 === 0 ? `${(n / 10_000).toLocaleString('ko-KR')}만원` : `${n.toLocaleString('ko-KR')}원`);
const shortLabel = (n: number, kind: 'qty' | 'won') =>
  kind === 'won' ? (n >= 100_000_000 ? `${n / 100_000_000}억` : n >= 10_000 ? `${(n / 10_000).toLocaleString('ko-KR')}만` : n.toLocaleString('ko-KR')) : n >= 10_000 ? `${n / 10_000}만` : n.toLocaleString('ko-KR');

/** 대화로 정한 값(base) 크기에 맞춘 눈금. 끌어도 눈금이 바뀌지 않게 base로만 정한다 */
function stopsFor(base: number, kind: 'qty' | 'won'): number[] {
  if (kind === 'won') {
    const unit = base >= 1_000_000 ? 100_000 : 10_000;
    const nice = (x: number) => Math.max(unit, Math.round(x / unit) * unit);
    return [...new Set([0.5, 1, 1.5, 2, 3].map((m) => nice(base * m)))];
  }
  if (base <= 30) return [1, 5, 10, 30, 50];
  if (base <= 300) return [10, 50, 100, 300, 500];
  if (base <= 3000) return [100, 500, 1000, 3000, 5000];
  return [1000, 5000, 10000, 50000, 100000];
}

/** 눈금 사이를 고르게 나눈 위치(0~1000) ↔ 값. 눈금 사이 값은 보기 좋은 단위로 반올림 */
function posToValue(pos: number, stops: number[]) {
  const seg = (stops.length - 1) * (pos / 1000);
  const i = Math.min(stops.length - 2, Math.floor(seg));
  const t = seg - i;
  const raw = stops[i] + (stops[i + 1] - stops[i]) * t;
  const step = Math.max(1, Math.pow(10, Math.floor(Math.log10(Math.max(1, stops[i + 1] - stops[i]))) - 1));
  return Math.max(stops[0], Math.round(raw / step) * step);
}
function valueToPos(v: number, stops: number[]) {
  if (v <= stops[0]) return 0;
  if (v >= stops[stops.length - 1]) return 1000;
  const i = stops.findIndex((s, k) => v >= s && v <= stops[k + 1]);
  return ((i + (v - stops[i]) / (stops[i + 1] - stops[i])) / (stops.length - 1)) * 1000;
}

/** 볼륨 조절기처럼 끌어서 정하는 막대 + 아래 예시 값. 눈금 밖 값은 숫자 칸에 직접 */
function Slider({ value, base, kind, onChange }: { value?: number; base: number; kind: 'qty' | 'won'; onChange: (n: number) => void }) {
  const stops = useMemo(() => stopsFor(base, kind), [base, kind]);
  const pos = value === undefined ? 0 : valueToPos(value, stops);
  const [typing, setTyping] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={1000}
          value={pos}
          aria-label={kind === 'won' ? '예산' : '수량'}
          onChange={(e) => onChange(posToValue(Number(e.target.value), stops))}
          className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full outline-none [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgba(0,0,0,0.25),0_0_0_1px_rgba(0,0,0,0.08)] focus-visible:[&::-webkit-slider-thumb]:ring-4 focus-visible:[&::-webkit-slider-thumb]:ring-primary/25"
          style={{ background: `linear-gradient(to right, var(--primary) ${pos / 10}%, var(--muted) ${pos / 10}%)` }}
        />
        <input
          inputMode="numeric"
          aria-label={kind === 'won' ? '예산 직접 입력(원)' : '수량 직접 입력'}
          value={typing ?? (value !== undefined ? value.toLocaleString('ko-KR') : '')}
          placeholder="직접"
          onFocus={() => setTyping(value !== undefined ? String(value) : '')}
          onChange={(e) => setTyping(e.target.value)}
          onBlur={() => {
            const n = Number((typing ?? '').replace(/[^\d]/g, ''));
            if (n > 0) onChange(n);
            setTyping(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="w-[88px] shrink-0 rounded-md bg-muted px-2 py-1 text-right text-[13px] font-medium tabular-nums text-black outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>
      {/* 아래 예시 값: 누르면 그 값으로 */}
      <div className="relative mr-[100px] h-4 text-[11px] text-muted-foreground">
        {stops.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            className={cn('absolute -translate-x-1/2 whitespace-nowrap tabular-nums hover:text-ink', value === s && 'font-semibold text-primary')}
            // 손잡이(20px)가 움직이는 범위에 맞춰 눈금을 둔다
            style={{ left: `calc(10px + (100% - 20px) * ${i / (stops.length - 1)})` }}
          >
            {shortLabel(s, kind)}
          </button>
        ))}
      </div>
    </div>
  );
}
