import { useState } from 'react';
import { ChevronDown, History, Paperclip, Mail, Search, Send } from 'lucide-react';
import type { MailDraft, Requirements, RunSummary, VendorId } from '@shared/types';
import { FIELD_LABELS } from '@shared/types';
import { won } from '@shared/quote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { clock, useStore, VENDOR_DOT, VENDOR_TEXT } from '@/store';
import { cn } from '@/lib/utils';

type EditKey = 'item' | 'quantity' | 'budgetMax' | 'deadline' | 'minWarrantyMonths' | 'region';
const NUM_KEYS: EditKey[] = ['quantity', 'budgetMax', 'minWarrantyMonths'];
const toNum = (s: string) => Number(s.replace(/[,\s원개월]/g, ''));
const validNum = (k: EditKey, s: string) => Number.isInteger(toNum(s)) && toNum(s) >= (k === 'minWarrantyMonths' ? 0 : 1);

export function RequirementsCard() {
  const { requirements, stage, reqReady, busy } = useStore();
  const r = requirements ?? {};
  if (stage === 'interview') return <RequirementsEditor r={r} ready={reqReady} busy={busy} />;
  const items: [string, string | undefined][] = [
    ['품목', r.item],
    ['수량', r.quantity !== undefined ? `${r.quantity}개` : undefined],
    ['예산', r.budgetMax !== undefined ? `${won(r.budgetMax)} 이하` : undefined],
    ['납기', r.deadline ? `${r.deadline}까지` : undefined],
    ['설치', r.needInstall === undefined ? undefined : r.needInstall ? '필요' : '불필요'],
    ['A/S', r.minWarrantyMonths !== undefined ? (r.minWarrantyMonths > 0 ? `${r.minWarrantyMonths}개월 이상` : '불필요') : undefined],
    ['지역', r.region]
  ];
  return (
    <Card className="gap-2 py-3">
      <CardContent className="px-4">
        <div className="mb-2 text-[11px] font-semibold tracking-wider text-primary">요구 조건</div>
        <div className="grid grid-cols-4 gap-x-4 gap-y-1.5 text-[13px]">
          {items.map(([k, v]) => (
            <div key={k} className="flex gap-1.5">
              <span className="text-muted-foreground">{k}</span>
              <span className={v ? 'font-semibold' : 'text-muted-foreground/40'}>{v ?? '…'}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** 검색 전 확인: 값을 직접 고치고 사용자가 눌러야 검색 시작 */
function RequirementsEditor({ r, ready, busy }: { r: Partial<Requirements>; ready: boolean; busy: boolean }) {
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
      await window.doldari.startSearch(patch);
    } finally {
      setStarting(false);
    }
  }

  const field = (k: EditKey, label: string, unit?: string, type = 'text') => (
    <label key={k} className="flex items-center gap-1.5">
      <span className="w-8 shrink-0 text-muted-foreground">{label}</span>
      <Input
        type={type}
        value={shown(k)}
        placeholder="…"
        onChange={(e) => setText({ ...text, [k]: e.target.value })}
        className={cn('h-7 px-2 text-[13px] font-semibold', invalid.includes(k) && 'border-destructive')}
      />
      {unit && <span className="shrink-0 text-muted-foreground">{unit}</span>}
    </label>
  );

  return (
    <Card className="gap-2 py-3 ring-1 ring-primary/40">
      <CardContent className="space-y-3 px-4">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold tracking-wider text-primary">요구 조건 확인</span>
          <span className="text-[11px] text-muted-foreground">대화로 채운 값이에요. 다르면 바로 고쳐 주세요.</span>
        </div>
        <div className="grid grid-cols-4 gap-x-4 gap-y-2 text-[13px]">
          {field('item', '품목')}
          {field('quantity', '수량', '개')}
          {field('budgetMax', '예산', '원 이하')}
          {field('deadline', '납기', '까지', 'date')}
          <div className="flex items-center gap-1.5">
            <span className="w-8 shrink-0 text-muted-foreground">설치</span>
            {[true, false].map((on) => (
              <Button key={String(on)} type="button" size="sm" variant={needInstall === on ? 'default' : 'outline'} className="h-7 px-2.5 text-[12px]" onClick={() => setInstall(on)}>
                {on ? '필요' : '불필요'}
              </Button>
            ))}
          </div>
          {field('minWarrantyMonths', 'A/S', '개월 이상 (0=불필요)')}
          {field('region', '지역')}
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" disabled={!canStart} onClick={() => void start()}>
            <Search className="size-4" /> {starting ? '시작하는 중…' : '이대로 검색 시작'}
          </Button>
          <span className="text-[12px] text-muted-foreground">
            {!item ? '어떤 품목인지 알려 주시면 시작할 수 있어요.' : invalid.length ? '숫자 칸을 확인해 주세요.' : ready ? '남은 질문에 답하지 않아도 지금 바로 시작할 수 있어요.' : '조건을 조금 더 알려 주시면 시작할 수 있어요.'}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/** 조건 변경 전 검색 결과 요약 (화면 대신 기록만) */
export function HistoryCard({ summary }: { summary: RunSummary }) {
  const req = summary.requirements;
  const rows = [...summary.rows].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  return (
    <Collapsible className="rounded-xl border bg-card/60 text-[13px]">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
        <History className="size-4 text-muted-foreground" />
        <span className="font-semibold">이전 검색 · {clock(summary.at)}</span>
        <span className="truncate text-muted-foreground">
          {req.item} {req.quantity}개 · {won(req.budgetMax)} 이하 · {req.deadline}까지
          {summary.recommended ? ` · 추천 ${rows.find((x) => x.id === summary.recommended)?.name ?? summary.recommended}` : ''}
        </span>
        <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-1.5 border-t px-4 py-3">
        {rows.length === 0 && <div className="text-muted-foreground">모은 견적이 없었어요.</div>}
        {rows.map((x) => (
          <div key={x.id} className="flex items-center gap-2">
            <span className="w-6 text-muted-foreground">{x.rank ? `${x.rank}위` : '-'}</span>
            <span className={cn('inline-block size-2 rounded-full', VENDOR_DOT[x.id])} />
            <span className="font-semibold">{x.name}</span>
            {x.id === summary.recommended && <Badge variant="secondary" className="text-primary">추천</Badge>}
            <span className="ml-auto font-semibold tabular-nums">{x.total !== null ? won(x.total) : '가격 없음'}</span>
          </div>
        ))}
        {summary.reasons.length > 0 && (
          <div className="whitespace-pre-line pt-1 text-[12px] text-muted-foreground">{summary.reasons.map((s) => `· ${s}`).join('\n')}</div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

const KIND_LABEL = { request: '견적 요청', question: '확인 질문', order: '주문 문의' } as const;

export function MailCard({ draft }: { draft: MailDraft }) {
  const { config, vendors, set } = useStore();
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
      setError(r.error ?? '실패');
    }
  };
  return (
    <Card className={cn('gap-3 py-4', state !== 'sent' && 'ring-1 ring-primary/40')}>
      <CardContent className="space-y-2 px-4">
        <div className="flex items-center gap-2 text-sm">
          <Mail className="size-4 text-primary" />
          <span className="font-semibold">{KIND_LABEL[draft.kind]} 메일</span>
          <span className="text-muted-foreground">· {vendor?.name}</span>
          <Badge variant="outline" className="ml-auto">{state === 'sent' ? '보냄' : '보내기를 눌러야만 발송'}</Badge>
        </div>
        <Input disabled={state !== 'draft'} value={edit.to} placeholder="받는 사람 메일 주소" onChange={(e) => setEdit({ ...edit, to: e.target.value })} />
        <Input disabled={state !== 'draft'} value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} className="font-semibold" />
        <Textarea disabled={state !== 'draft'} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} className="h-44 leading-relaxed" />
        {draft.evidence && draft.evidence.length > 0 && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-2 text-[12px]">
            <div className="mb-1 font-semibold text-primary">협상 근거</div>
            {draft.evidence.map((e, i) => (
              <div key={i}>· {e.vendorId} {FIELD_LABELS[e.field]}: “{e.snippet}”</div>
            ))}
          </div>
        )}
        {error && <div className="text-xs text-destructive">{error}</div>}
        {state !== 'sent' ? (
          <div className="flex items-center gap-2 pt-1">
            {config?.smtpConfigured && (
              <Button size="sm" disabled={state === 'sending'} onClick={async () => { setState('sending'); setError(''); done(await window.doldari.sendMail(edit)); }}>
                <Send className="size-4" /> {state === 'sending' ? '보내는 중…' : `${config.smtpUser}로 보내기`}
              </Button>
            )}
            <Button size="sm" variant={config?.smtpConfigured ? 'outline' : 'default'} onClick={async () => done(await window.doldari.openMailApp(edit))}>
              메일 앱으로 열기
            </Button>
            {!config?.smtpConfigured && (
              <button onClick={() => set({ settingsOpen: true })} className="text-[11px] text-muted-foreground hover:text-foreground">
                Gmail을 연결하면 앱에서 바로 발송돼요
              </button>
            )}
          </div>
        ) : draft.kind !== 'order' && !replied ? (
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
            <div className="text-[12px] text-muted-foreground">{imap ? '회신이 오면 자동으로 가져와 견적서에 반영해요. 다른 경로로 받았다면 붙여 넣어도 돼요.' : '업체 회신을 받으면 아래에 붙여 넣어 주세요.'}</div>
            <Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="받은 회신 내용 붙여넣기" className="h-20" />
            <Button size="sm" disabled={!reply.trim()} onClick={async () => { setReplied(true); await window.doldari.pasteReply(draft.vendorId, draft.kind, reply); }}>
              회신 반영
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function UploadCard({ vendorId }: { vendorId: VendorId }) {
  const { vendors, vendorStatus } = useStore();
  const [drag, setDrag] = useState(false);
  const [name, setName] = useState('');
  const vendor = vendors.find((v) => v.id === vendorId);
  const status = vendorStatus[vendorId];
  const upload = async (f: File) => {
    setName(f.name);
    await window.doldari.uploadFile(vendorId, { name: f.name, mime: f.type, data: new Uint8Array(await f.arrayBuffer()) });
  };
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void upload(f); }}
      className={cn('flex cursor-pointer items-center gap-4 rounded-xl border-2 border-dashed p-4 transition', drag ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/60')}
    >
      <input type="file" accept=".pdf,image/*,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <Paperclip className="size-5" />
      </div>
      <div className="min-w-0 text-[13px]">
        <div className="font-semibold">
          <span className={cn('mr-1 inline-block size-2 rounded-full', VENDOR_DOT[vendorId])} />
          <span className={VENDOR_TEXT[vendorId]}>{vendorId}</span> {vendor?.name} 견적서 올리기
        </div>
        <div className="text-muted-foreground">{status === 'parsing' ? `“${name}” 정리 중…` : status === 'done' && name ? `“${name}” → 통일 양식으로 정리 완료` : 'PDF·이미지·텍스트를 끌어다 놓거나 클릭해서 선택'}</div>
      </div>
    </label>
  );
}
