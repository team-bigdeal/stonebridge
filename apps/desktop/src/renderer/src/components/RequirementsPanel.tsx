// 오른쪽 요구 조건 패널: 대화로 채운 조건을 항상 보이는 자리에서 확인·수정하고 검색을 시작한다
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { Requirements, ReqSpec } from '@shared/types';
import { deadlineIssue, itemIssue, parseAmountInput, valueIssue } from '@shared/limits';
import { localIsoDate } from '@shared/parse';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useApi } from '@/runScope';
import { cn } from '@/lib/utils';
import { PANEL_WIDTH, saveWidth, useStore } from '@/store';
import { ResizeHandle } from './ResizeHandle';

const WARRANTY = [
  { months: 0, label: '필요 없음' },
  { months: 6, label: '6개월' },
  { months: 12, label: '1년' },
  { months: 24, label: '2년' }
];

export function RequirementsPanel() {
  const { requirements, stage, reqReady, reqAsking, busy, timeline, replay, panelWidth, set } = useStore();
  // 대화가 시작돼 요구 조건이 생긴 뒤부터 보인다 (늘 열려 있고, 너비만 조절)
  // (화면을 새로 그려 대화 기록이 비어도 조건 값이 있으면 보인다)
  if (!timeline.some((t) => t.kind === 'requirements') && !requirements?.item) return null;
  const r = requirements ?? {};
  const editing = stage === 'interview' && !replay;

  return (
    <aside className="relative flex shrink-0 flex-col border-l bg-card" style={{ width: panelWidth }}>
      <ResizeHandle side="left" label="요구 조건 너비 조절" width={panelWidth} range={PANEL_WIDTH} onResize={(w) => set({ panelWidth: w })} onDone={(w) => saveWidth('doldari.panelWidth', w)} />
      <div className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
        <h2 className="px-5 pb-2 pt-5 text-[15px] font-semibold text-ink">요구 조건</h2>
        {editing ? <Editor r={r} ready={reqReady} asking={reqAsking} busy={busy} /> : <Summary r={r} />}
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
      <dl className="flex flex-col">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 border-b border-line/60 py-2.5 text-[14px]">
            <dt className="shrink-0 text-muted-foreground">{k}</dt>
            <dd className={cn('min-w-0 truncate text-right font-medium', v ? 'text-ink' : 'text-muted-foreground/60')} title={v}>
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
  const [refitting, setRefitting] = useState(false);
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

  // 고친 값은 바로 main에도 보낸다: 채팅으로 "시작"하거나 다음 질문에 답해도 고친 값이 쓰인다 (품목은 다 쓴 뒤 changeItem으로)
  useEffect(() => {
    const { item: _item, ...rest } = edit;
    const patch: Partial<Requirements> = { ...rest, ...(Object.keys(specEdit).length ? { specs: (r.specs ?? []).map((s) => ({ ...s, value: specEdit[s.label] ?? s.value })) } : {}) };
    if (Object.keys(patch).length) void api.editRequirements(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit, specEdit]);

  const v = { ...r, ...edit };
  const shown = r.shown ?? { install: true, warranty: true, region: true };
  const item = (v.item ?? '').trim();
  // 수량·예산이 범위를 벗어나거나 납기가 지났으면 시작을 막고 그 칸 아래에 이유를 보여 준다
  const qtyIssue = v.quantity !== undefined ? valueIssue('quantity', v.quantity) : null;
  const budgetIssue = v.budgetMax !== undefined ? valueIssue('budgetMax', v.budgetMax) : null;
  const dateIssue = deadlineIssue(v.deadline);
  const issue = qtyIssue ?? budgetIssue ?? dateIssue;
  const canStart = ready && Boolean(item) && !busy && !starting && !issue;
  // 품목 이름에 이미 들어 있는 값(예: "지름 50mm" 품목의 지름 50 mm)은 다시 묻지 않는다
  const allSpecs = (r.specs ?? []).map((s) => ({ ...s, value: specEdit[s.label] ?? s.value }));
  const specs = allSpecs.filter((s) => specEdit[s.label] !== undefined || !inItem(s, item));
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
      await api.startSearch({ ...edit, ...(Object.keys(specEdit).length ? { specs: allSpecs } : {}) });
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 px-5 pb-6">
      <div className="flex items-center gap-3">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${(filled / Math.max(1, fields)) * 100}%` }} />
        </div>
        <span className="shrink-0 text-[13px] tabular-nums text-primary">
          {filled}/{fields}
        </span>
      </div>

      <Field label="품목" value={refitting ? '조건 맞추는 중…' : undefined}>
        <TextBox
          value={v.item ?? ''}
          placeholder="어떤 걸 찾으세요?"
          onChange={(t) => setEdit({ ...edit, item: t })}
          // 다 쓰고 나면 새 품목에 맞는 조건으로 다시 정한다 (글자마다 부르지 않게)
          onCommit={async (t) => {
            if (!t.trim() || t.trim() === (r.item ?? '')) return;
            setRefitting(true);
            setSpecEdit({});
            try {
              await api.changeItem(t.trim());
            } finally {
              setRefitting(false);
            }
          }}
        />
        {itemIssue(v.item ?? '') && <Hint text={itemIssue(v.item ?? '')!} />}
      </Field>

      <Field label="수량">
        <Slider value={v.quantity} base={r.quantity ?? 1} kind="qty" issue={qtyIssue} onChange={(n) => setEdit({ ...edit, quantity: n })} />
      </Field>

      <Field label="예산">
        <Slider value={v.budgetMax} base={r.budgetMax ?? 1_000_000} kind="won" issue={budgetIssue} onChange={(n) => setEdit({ ...edit, budgetMax: n })} />
      </Field>

      <Field label="납기">
        <TextBox type="date" value={v.deadline ?? ''} min={localIsoDate()} onChange={(t) => setEdit({ ...edit, deadline: t })} suffix="까지" />
        {dateIssue && <Hint text={dateIssue} />}
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

      {specs.length > 0 && <div className="-mb-2 border-t border-line/60" />}
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
          {!item ? '어떤 품목인지 알려 주시면 시작할 수 있어요.' : issue ? '위에 표시한 값을 고치면 시작할 수 있어요.' : ready ? '질문에 다 답하지 않아도 시작할 수 있어요.' : '조건을 조금 더 알려 주시면 시작할 수 있어요.'}
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
        {value && <span className="text-[13px] text-muted-foreground">{value}</span>}
      </div>
      {children}
    </div>
  );
}

/** 입력 칸 아래 빨간 안내 (잘못된 값) */
function Hint({ text }: { text: string }) {
  return (
    <p role="alert" className="-mt-1 text-[12px] leading-snug text-destructive">
      {text}
    </p>
  );
}

function TextBox({
  value,
  onChange,
  onCommit,
  placeholder,
  type = 'text',
  min,
  suffix
}: {
  value: string;
  onChange: (v: string) => void;
  /** 다 썼을 때(포커스 이동·Enter) */
  onCommit?: (v: string) => void;
  placeholder?: string;
  type?: string;
  min?: string;
  suffix?: string;
}) {
  return (
    <label className={cn('flex items-center gap-2 rounded-lg px-4 py-2.5 focus-within:ring-2 focus-within:ring-primary/30', value ? 'bg-tint' : 'bg-muted')}>
      <Input
        type={type}
        value={value}
        min={min}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit ? (e) => onCommit(e.target.value) : undefined}
        onKeyDown={onCommit ? (e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur() : undefined}
        className="h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent dark:bg-transparent p-0 text-[14px] font-medium text-ink shadow-none placeholder:text-muted-foreground focus-visible:ring-0 md:text-[14px]"
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
          className={cn('flex-1 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors', value === o.value ? 'bg-card text-ink shadow-sm dark:bg-input' : 'text-muted-foreground hover:text-ink')}
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

/** 값(숫자+단위 또는 글자)이 품목 이름에 이미 들어 있는지. 띄어쓰기·대소문자는 무시한다 */
function inItem(s: ReqSpec, item: string) {
  const norm = (t: string) => t.replace(/\s+/g, '').toLowerCase();
  const name = norm(item);
  const val = norm(s.value ?? '');
  if (!name || !val) return false;
  if (/^[\d.,]+$/.test(val)) {
    // 숫자는 단위까지 붙어 있어야 같은 값으로 본다 (50 ≠ 150, 50m ≠ 50mm)
    const num = val.replace(/,/g, '');
    const unit = norm(s.unit ?? '');
    const plain = name.replace(/,/g, '');
    return new RegExp(`(^|[^\\d.])${num.replace(/\./g, '\\.')}${unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z\\d.])`).test(plain);
  }
  return val.length >= 2 && name.includes(val);
}
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
function Slider({ value, base, kind, issue, onChange }: { value?: number; base: number; kind: 'qty' | 'won'; issue?: string | null; onChange: (n: number) => void }) {
  const stops = useMemo(() => stopsFor(base, kind), [base, kind]);
  const pos = value === undefined ? 0 : valueToPos(value, stops);
  const [typing, setTyping] = useState<string | null>(null);
  // 직접 쓴 값을 쓸 수 없을 때의 안내 (값은 바꾸지 않고 그대로 둔다)
  const [hint, setHint] = useState<string | null>(null);
  const pick = (n: number) => {
    setHint(null);
    onChange(n);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={1000}
          value={pos}
          aria-label={kind === 'won' ? '예산' : '수량'}
          onChange={(e) => pick(posToValue(Number(e.target.value), stops))}
          className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full outline-none [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgba(0,0,0,0.25),0_0_0_1px_rgba(0,0,0,0.08)] focus-visible:[&::-webkit-slider-thumb]:ring-4 focus-visible:[&::-webkit-slider-thumb]:ring-primary/25"
          style={{ background: `linear-gradient(to right, var(--primary) ${pos / 10}%, var(--muted) ${pos / 10}%)` }}
        />
        <label className="flex w-[104px] shrink-0 items-center gap-1 rounded-md bg-muted px-2 py-1 focus-within:ring-2 focus-within:ring-primary/30">
        <input
          inputMode="numeric"
          aria-label={kind === 'won' ? '예산 직접 입력(원, 예: 20만)' : '수량 직접 입력'}
          aria-invalid={Boolean(hint ?? issue)}
          value={typing ?? (value !== undefined ? value.toLocaleString('ko-KR') : '')}
          placeholder="직접"
          onFocus={() => setTyping(value !== undefined ? String(value) : '')}
          onChange={(e) => setTyping(e.target.value)}
          onBlur={() => {
            // "20만" → 200000. 음수·소수·범위 밖 값은 받지 않고 이유를 보여 준다
            const { value: n, error } = parseAmountInput(typing ?? '', kind === 'won' ? 'budgetMax' : 'quantity');
            if (n !== undefined) pick(n);
            else setHint(error ?? null);
            setTyping(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="min-w-0 flex-1 bg-transparent text-right text-[13px] font-medium tabular-nums text-ink outline-none"
        />
        <span className="shrink-0 text-[12px] text-muted-foreground">{kind === 'won' ? '원' : '개'}</span>
        </label>
      </div>
      {/* 아래 예시 값: 누르면 그 값으로 */}
      <div className="relative mr-[116px] h-4 text-[11px] text-muted-foreground">
        {stops.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => pick(s)}
            className={cn('absolute -translate-x-1/2 whitespace-nowrap tabular-nums hover:text-ink', value === s && 'font-semibold text-primary')}
            // 손잡이(20px)가 움직이는 범위에 맞춰 눈금을 둔다
            style={{ left: `calc(10px + (100% - 20px) * ${i / (stops.length - 1)})` }}
          >
            {shortLabel(s, kind)}
          </button>
        ))}
      </div>
      {(hint ?? issue) && <Hint text={(hint ?? issue)!} />}
    </div>
  );
}
