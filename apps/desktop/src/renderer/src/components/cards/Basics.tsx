import { useState } from 'react';
import { Check, ChevronDown, History, Mail, Paperclip, Search, Send } from 'lucide-react';
import type { MailDraft, Requirements, RunSummary, VendorId } from '@shared/types';
import { FIELD_LABELS } from '@shared/types';
import { won } from '@shared/quote';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { clock, useStore, VENDOR_DOT } from '@/store';
import { cn } from '@/lib/utils';
import { Pill, SectionHead } from './Section';
import { useRunStore, useApi } from '@/runScope';

type EditKey = 'item' | 'quantity' | 'budgetMax' | 'deadline' | 'minWarrantyMonths' | 'region';
const NUM_KEYS: EditKey[] = ['quantity', 'budgetMax', 'minWarrantyMonths'];
const toNum = (s: string) => Number(s.replace(/[,\s원개월]/g, ''));
const validNum = (k: EditKey, s: string) => Number.isInteger(toNum(s)) && toNum(s) >= (k === 'minWarrantyMonths' ? 0 : 1);

export function RequirementsCard() {
  const { requirements, stage, reqReady, reqAsking, busy } = useRunStore();
  const r = requirements ?? {};
  if (stage === 'interview') return <RequirementsEditor r={r} ready={reqReady} asking={reqAsking} busy={busy} />;
  const items: [string, string | undefined][] = [
    ['품목', r.item],
    ['수량', r.quantity !== undefined ? `${r.quantity.toLocaleString('ko-KR')}개` : undefined],
    ['예산', r.budgetMax !== undefined ? `${won(r.budgetMax)} 이하` : undefined],
    ['납기', r.deadline ? `${r.deadline}까지` : undefined],
    ['설치', r.needInstall === undefined ? undefined : r.needInstall ? '필요' : '필요 없음'],
    ['A/S', r.minWarrantyMonths !== undefined ? (r.minWarrantyMonths > 0 ? `${r.minWarrantyMonths}개월 이상` : '필요 없음') : undefined],
    ['지역', r.region]
  ];
  const filled = items.filter(([, v]) => v).length;
  return (
    <Card className="gap-4 py-4">
      <CardContent className="space-y-4 px-5">
        <SectionHead
          title="요구 조건"
          hint={filled < items.length ? '대화로 채워지고 있어요. 빈 칸은 이어서 물어볼게요.' : '이 조건으로 업체를 찾아요.'}
          right={<span className="text-[12px] tabular-nums text-muted-foreground">{filled}/{items.length}</span>}
        />
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 xl:grid-cols-7">
          {items.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[12px] text-muted-foreground">{k}</dt>
              <dd className={cn('mt-0.5 truncate text-[14px]', v ? 'font-medium' : 'text-muted-foreground/50')} title={v}>
                {v ?? '—'}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

/** 검색 전 확인: 값을 직접 고치고 사용자가 눌러야 검색 시작 */
function RequirementsEditor({ r, ready, asking, busy }: { r: Partial<Requirements>; ready: boolean; asking: boolean; busy: boolean }) {
  const api = useApi();
  // 입력 중인 문자열만 따로 들고 있다가 시작할 때 숫자로 바꾼다 (지운 칸이 원래 값으로 되돌아가지 않게)
  const [text, setText] = useState<Partial<Record<EditKey, string>>>({});
  const [install, setInstall] = useState<boolean | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const shown = (k: EditKey) => text[k] ?? (r[k] === undefined ? '' : String(r[k]));
  const invalid = NUM_KEYS.filter((k) => text[k] !== undefined && !validNum(k, text[k]!));
  const item = shown('item').trim();
  const needInstall = install ?? r.needInstall;
  const canStart = ready && Boolean(item) && invalid.length === 0 && !busy && !starting;

  async function start() {
    const patch: Partial<Requirements> = {};
    if (text.item !== undefined) patch.item = text.item.trim();
    if (text.quantity !== undefined) patch.quantity = toNum(text.quantity);
    if (text.budgetMax !== undefined) patch.budgetMax = toNum(text.budgetMax);
    if (text.minWarrantyMonths !== undefined) patch.minWarrantyMonths = toNum(text.minWarrantyMonths);
    if (text.deadline !== undefined) patch.deadline = text.deadline;
    if (text.region !== undefined) patch.region = text.region;
    if (install !== undefined) patch.needInstall = install;
    setStarting(true);
    try {
      await api.startSearch(patch);
    } finally {
      setStarting(false);
    }
  }

  const field = (k: EditKey, label: string, unit?: string, type = 'text') => (
    <label key={k} className="block min-w-0">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <div className="mt-1 flex items-center gap-1.5">
        <Input
          type={type}
          value={shown(k)}
          placeholder="—"
          onChange={(e) => setText({ ...text, [k]: e.target.value })}
          aria-invalid={invalid.includes(k) || undefined}
          className="h-8 min-w-0 px-2 text-[13px]"
        />
        {unit && <span className="shrink-0 text-[12px] text-muted-foreground">{unit}</span>}
      </div>
    </label>
  );

  const help = !item ? '어떤 품목인지 알려 주시면 시작할 수 있어요.' : invalid.length ? '숫자 칸을 확인해 주세요.' : ready ? '남은 질문에 답하지 않아도 지금 바로 시작할 수 있어요.' : '조건을 조금 더 알려 주시면 시작할 수 있어요.';

  return (
    <Card className="gap-4 border-primary/40 py-4">
      <CardContent className="space-y-4 px-5">
        <SectionHead title="요구 조건 확인" hint="대화로 채운 값이에요. 다르면 바로 고쳐 주세요." />
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          {field('item', '품목')}
          {field('quantity', '수량', '개')}
          {field('budgetMax', '예산', '원 이하')}
          {field('deadline', '납기', '까지', 'date')}
          <div className="min-w-0">
            <span className="text-[12px] text-muted-foreground">설치</span>
            <div className="mt-1 flex gap-1">
              {[true, false].map((on) => (
                <Button key={String(on)} type="button" size="sm" variant={needInstall === on ? 'secondary' : 'outline'} className={cn('h-8 flex-1 text-[13px]', needInstall === on && 'ring-1 ring-muted-foreground/40')} onClick={() => setInstall(on)}>
                  {on ? '필요' : '필요 없음'}
                </Button>
              ))}
            </div>
          </div>
          {field('minWarrantyMonths', 'A/S (0이면 필요 없음)', '개월 이상')}
          {field('region', '지역')}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button size="sm" disabled={!canStart} onClick={() => void start()}>
            <Search className="size-3.5" /> {starting ? '시작하는 중…' : asking ? '지금 바로 시작' : '이 조건으로 찾기 시작'}
          </Button>
          <span className={cn('text-[12px]', invalid.length ? 'text-destructive' : 'text-muted-foreground')}>{help}</span>
        </div>
      </CardContent>
    </Card>
  );
}

/** 조건 변경 전 검색 결과 요약 (화면 대신 기록만) */
export function HistoryCard({ summary }: { summary: RunSummary }) {
  const req = summary.requirements;
  const rows = [...summary.rows].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const picked = summary.recommended ? rows.find((x) => x.id === summary.recommended)?.name ?? summary.recommended : null;
  return (
    <Collapsible className="group rounded-xl border bg-card/60 text-[13px]">
      <CollapsibleTrigger className="flex w-full items-center gap-2.5 px-4 py-3 text-left">
        <History className="size-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium">이전 검색</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{clock(summary.at)}</span>
        <span className="truncate text-muted-foreground">
          {req.item} {req.quantity.toLocaleString('ko-KR')}개 · {won(req.budgetMax)} 이하 · {req.deadline}까지{picked ? ` · 추천 ${picked}` : ''}
        </span>
        <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-4 py-3">
        {rows.length === 0 && <div className="text-muted-foreground">모은 견적이 없었어요.</div>}
        <div className="divide-y">
          {rows.map((x) => (
            <div key={x.id} className="flex items-center gap-2 py-1.5">
              <span className="w-8 tabular-nums text-muted-foreground">{x.rank ? `${x.rank}위` : '–'}</span>
              <span className={cn('size-2 shrink-0 rounded-full', VENDOR_DOT[x.id])} />
              <span className="truncate font-medium">{x.name}</span>
              {x.id === summary.recommended && <Pill tone="primary">추천</Pill>}
              <span className="ml-auto tabular-nums">{x.total !== null ? won(x.total) : <span className="text-muted-foreground">가격 없음</span>}</span>
            </div>
          ))}
        </div>
        {summary.reasons.length > 0 && (
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[12px] text-muted-foreground marker:text-muted-foreground/50">
            {summary.reasons.map((x) => <li key={x}>{x}</li>)}
          </ul>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

const KIND_LABEL = { request: '견적 요청', question: '확인 질문', order: '주문 문의' } as const;

export function MailCard({ draft }: { draft: MailDraft }) {
  const api = useApi();
  const { config, vendors, set } = useRunStore();
  const [edit, setEdit] = useState(draft);
  const [state, setState] = useState<'draft' | 'sending' | 'sent'>('draft');
  const [error, setError] = useState('');
  const [imap, setImap] = useState(false);
  const [reply, setReply] = useState('');
  const [replied, setReplied] = useState(false);
  const vendor = vendors.find((v) => v.id === draft.vendorId);
  const done = (r: { ok: boolean; error?: string; imap?: boolean }) => {
    if (r.ok) {
      setState('sent');
      setImap(Boolean(r.imap));
    } else {
      setState('draft');
      setError(r.error ?? '보내지 못했어요');
    }
  };
  const locked = state !== 'draft';
  return (
    <Card className={cn('gap-4 py-4', !locked && 'border-primary/40')}>
      <CardContent className="space-y-4 px-5">
        <SectionHead
          title={
            <span className="flex items-center gap-2">
              <Mail className="size-4 text-muted-foreground" />
              {KIND_LABEL[draft.kind]} 메일
              {vendor && <span className="font-normal text-muted-foreground">· {vendor.name}</span>}
            </span>
          }
          hint={state === 'sent' ? undefined : '내용을 확인하고 직접 보내 주세요. 누르기 전에는 발송되지 않아요.'}
          right={state === 'sent' ? <Pill tone="ok"><Check className="size-3" /> 보냄</Pill> : <Pill tone="warn">보내기 전</Pill>}
        />

        <div className="space-y-2">
          <Field label="받는 사람">
            <Input disabled={locked} value={edit.to} placeholder="메일 주소" onChange={(e) => setEdit({ ...edit, to: e.target.value })} />
          </Field>
          <Field label="제목">
            <Input disabled={locked} value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} />
          </Field>
          <Textarea disabled={locked} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} className="h-48 text-[13px] leading-relaxed" />
        </div>

        {draft.evidence && draft.evidence.length > 0 && (
          <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-[12px] leading-relaxed">
            <div className="mb-1 font-medium text-foreground">근거로 쓴 내용</div>
            <ul className="space-y-0.5 text-muted-foreground">
              {draft.evidence.map((e, i) => (
                <li key={i}>{e.vendorId} 업체 {FIELD_LABELS[e.field]}: “{e.snippet}”</li>
              ))}
            </ul>
          </div>
        )}

        {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{error}</div>}

        {state !== 'sent' ? (
          <div className="flex flex-wrap items-center gap-2">
            {config?.smtpConfigured && (
              <Button size="sm" disabled={state === 'sending'} onClick={async () => { setState('sending'); setError(''); done(await api.sendMail(edit)); }}>
                <Send className="size-3.5" /> {state === 'sending' ? '보내는 중…' : '보내기'}
              </Button>
            )}
            <Button size="sm" variant={config?.smtpConfigured ? 'outline' : 'default'} disabled={state === 'sending'} onClick={async () => done(await api.openMailApp(edit))}>
              메일 앱으로 열기
            </Button>
            {config?.smtpConfigured ? (
              <span className="text-[12px] text-muted-foreground">{config.smtpUser}에서 보내요</span>
            ) : (
              <button onClick={() => set({ settingsOpen: true })} className="text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                Gmail을 연결하면 앱에서 바로 보낼 수 있어요
              </button>
            )}
          </div>
        ) : draft.kind !== 'order' && !replied ? (
          <div className="space-y-2 border-t pt-4">
            <div className="text-[13px] font-medium">업체 회신</div>
            <p className="text-[12px] text-muted-foreground">
              {imap ? '회신이 오면 자동으로 가져와 견적서에 반영해요. 다른 경로로 받았다면 여기에 붙여 넣어도 돼요.' : '업체에서 회신을 받으면 여기에 붙여 넣어 주세요.'}
            </p>
            <Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="받은 회신 내용" className="h-24 text-[13px]" />
            <Button size="sm" disabled={!reply.trim()} onClick={async () => { setReplied(true); await api.pasteReply(draft.vendorId, draft.kind, reply); }}>
              견적에 반영
            </Button>
          </div>
        ) : replied ? (
          <p className="text-[12px] text-muted-foreground">회신을 견적에 반영했어요.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[72px_1fr] items-center gap-2">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function UploadCard({ vendorId }: { vendorId: VendorId }) {
  const api = useApi();
  const { vendors, vendorStatus } = useRunStore();
  const [drag, setDrag] = useState(false);
  const [name, setName] = useState('');
  const vendor = vendors.find((v) => v.id === vendorId);
  const status = vendorStatus[vendorId];
  const upload = async (f: File) => {
    setName(f.name);
    await api.uploadFile(vendorId, { name: f.name, mime: f.type, data: new Uint8Array(await f.arrayBuffer()) });
  };
  const doneUp = status === 'done' && name;
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void upload(f); }}
      className={cn(
        'flex cursor-pointer items-center gap-4 rounded-xl border border-dashed px-5 py-4 transition-colors',
        drag ? 'border-primary bg-primary/5' : 'bg-card hover:border-muted-foreground/50'
      )}
    >
      <input type="file" accept=".pdf,image/*,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
      <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', doneUp ? 'bg-ok/12 text-ok' : 'bg-secondary text-muted-foreground')}>
        {doneUp ? <Check className="size-5" /> : <Paperclip className="size-5" />}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[14px] font-medium">
          <span className={cn('size-2 rounded-full', VENDOR_DOT[vendorId])} />
          {vendor?.name ?? `${vendorId} 업체`} 견적서 올리기
        </div>
        <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
          {status === 'parsing' ? `“${name}” 읽는 중…` : doneUp ? `“${name}”을 같은 양식으로 정리했어요` : 'PDF, 이미지, 텍스트 파일을 끌어다 놓거나 눌러서 고르세요'}
        </div>
      </div>
    </label>
  );
}
