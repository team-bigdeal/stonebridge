import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, ExternalLink, Eye, EyeOff, FlaskConical, History, Mail, MessageCircle, Paperclip, Search, Send, Smartphone } from 'lucide-react';
import type { MailDraft, MessageDraft, Requirements, RunSummary, VendorId } from '@shared/types';
import { FIELD_LABELS } from '@shared/types';
import { isDemoAddress } from '@shared/mail';
import { won } from '@shared/quote';
import { maskEmail, maskPhone, maskText } from '@shared/privacy';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { clock, useStore, VENDOR_DOT } from '@/store';
import { cn } from '@/lib/utils';
import { Pill } from './Section';
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
  // 디자인 30:1039: 흰 띠 안에 "요구 조건" 탭 + 항목별 칸
  return (
    <div className="w-fit max-w-full rounded-lg bg-white p-2" title={filled < items.length ? '대화로 채워지고 있어요. 빈 칸은 이어서 물어볼게요.' : '이 조건으로 업체를 찾아요.'}>
      <dl className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] font-medium leading-normal xl:text-[16px]">
        <div className="flex items-center gap-2 rounded-lg bg-secondary px-4 py-2.5 text-primary">
          요구 조건 <span className="text-[13px] tabular-nums opacity-70">{filled}/{items.length}</span>
        </div>
        {items.map(([k, v]) => (
          <div key={k} className="flex min-w-0 items-center gap-2.5 rounded-lg px-4 py-2.5">
            <dt className="shrink-0 text-muted-foreground">{k}</dt>
            <dd className={cn('max-w-[260px] truncate', v ? 'text-black' : 'text-muted-foreground/60')} title={v}>
              {v ?? '…'}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** 검색 전 확인: 값을 직접 고치고 사용자가 눌러야 검색 시작 */
function RequirementsEditor({ r, ready, asking, busy }: { r: Partial<Requirements>; ready: boolean; asking: boolean; busy: boolean }) {
  const api = useApi();
  // 입력 중인 문자열만 따로 들고 있다가 시작할 때 숫자로 바꾼다 (지운 칸이 원래 값으로 되돌아가지 않게)
  const [text, setText] = useState<Partial<Record<EditKey, string>>>({});
  const [install, setInstall] = useState<boolean | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  // 대화로 값이 새로 정해지면(예: "예산 30만원") 그 칸에 직접 입력해 둔 글자보다 대화 값을 보여 준다
  const prevReq = useRef(r);
  useEffect(() => {
    const before = prevReq.current;
    prevReq.current = r;
    const changed = (['item', 'quantity', 'budgetMax', 'deadline', 'minWarrantyMonths', 'region'] as EditKey[]).filter((k) => r[k] !== before[k] && r[k] !== undefined);
    if (changed.length) {
      setText((t) => {
        const next = { ...t };
        for (const k of changed) delete next[k];
        return next;
      });
    }
    if (r.needInstall !== before.needInstall && r.needInstall !== undefined) setInstall(undefined);
  }, [r]);
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

  // 디자인 29:345: 값이 있는 칸은 연한 파랑, 빈 칸은 회색. 칸 안에서 바로 고칠 수 있다
  const field = (k: EditKey, label: string, unit?: string, type = 'text') => {
    const has = shown(k).trim() !== '';
    const bad = invalid.includes(k);
    return (
      <label
        key={k}
        className={cn(
          'flex min-w-0 cursor-text items-center gap-4 rounded-lg px-4 py-2 transition-shadow focus-within:ring-2 focus-within:ring-primary/30',
          has ? 'bg-tint' : 'bg-muted',
          bad && 'ring-2 ring-destructive/50'
        )}
      >
        <span className="shrink-0 text-[13px] font-medium text-muted-foreground">{label}</span>
        <span className="flex min-w-0 items-center gap-1">
          <Input
            type={type}
            value={shown(k)}
            placeholder="..."
            onChange={(e) => setText({ ...text, [k]: e.target.value })}
            aria-invalid={bad || undefined}
            className={cn(
              'h-auto min-w-[3ch] max-w-[220px] rounded-none border-0 bg-transparent p-0 text-[14px] font-medium shadow-none [field-sizing:content] focus-visible:ring-0 md:text-[14px]',
              has ? 'text-black' : 'text-muted-foreground'
            )}
          />
          {unit && has && <span className="shrink-0 text-[13px] text-muted-foreground">{unit}</span>}
        </span>
      </label>
    );
  };

  const help = !item ? '어떤 품목인지 알려 주시면 시작할 수 있어요.' : invalid.length ? '숫자 칸을 확인해 주세요.' : ready ? '남은 질문에 답하지 않아도 지금 바로 시작할 수 있어요.' : '조건을 조금 더 알려 주시면 시작할 수 있어요.';
  const keys: EditKey[] = ['item', 'quantity', 'budgetMax', 'deadline', 'minWarrantyMonths', 'region'];
  const filled = keys.filter((k) => shown(k).trim() !== '').length + (needInstall === undefined ? 0 : 1);

  return (
    <div className="w-fit max-w-full rounded-lg bg-white px-5 py-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <h3 className="text-[16px] font-semibold text-black">요구조건</h3>
          <Pill tone="primary" className="text-[13px]">{filled}/{keys.length + 1} 확인</Pill>
          <span className="text-[13px] text-muted-foreground">대화로 채운 값이에요. 다르면 바로 고쳐 주세요.</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {field('item', '품목')}
          {field('quantity', '수량', '개')}
          {field('budgetMax', '예산', '원 이하')}
          {field('deadline', '납기', '까지', 'date')}
          <div className={cn('flex items-center gap-4 rounded-lg px-4 py-2', needInstall === undefined ? 'bg-muted' : 'bg-tint')}>
            <span className="shrink-0 text-[13px] font-medium text-muted-foreground">설치</span>
            <div className="flex gap-1">
              {[true, false].map((on) => (
                <button
                  key={String(on)}
                  type="button"
                  aria-pressed={needInstall === on}
                  className={cn(
                    'rounded-md px-2 py-0.5 text-[14px] font-medium transition-colors',
                    needInstall === on ? 'bg-white text-black shadow-[0_0_0_1px_var(--line)]' : 'text-muted-foreground hover:text-ink'
                  )}
                  onClick={() => setInstall(on)}
                >
                  {on ? '필요' : '필요 없음'}
                </button>
              ))}
            </div>
          </div>
          {field('minWarrantyMonths', 'A/S', '개월 이상')}
          {field('region', '지역')}
        </div>
        <p className="-mt-2 text-[12px] text-muted-foreground">A/S에 0을 넣으면 필요 없음으로 봐요.</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button className="h-auto px-4 py-2.5 text-[14px]" disabled={!canStart} onClick={() => void start()}>
            <Search className="size-4" /> {starting ? '시작하는 중…' : asking ? '지금 바로 시작' : '이 조건으로 찾기 시작'}
          </Button>
          <span className={cn('text-[13px]', invalid.length ? 'text-destructive' : 'text-muted-foreground')}>{help}</span>
        </div>
      </div>
    </div>
  );
}

/** 조건 변경 전 검색 결과 요약 (화면 대신 기록만) */
export function HistoryCard({ summary }: { summary: RunSummary }) {
  const req = summary.requirements;
  const rows = [...summary.rows].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const picked = summary.recommended ? rows.find((x) => x.id === summary.recommended)?.name ?? summary.recommended : null;
  return (
    <Collapsible className="group rounded-lg bg-card text-[14px]">
      <CollapsibleTrigger className="flex w-full items-center gap-2.5 px-5 py-4 text-left">
        <History className="size-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium">이전 검색</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{clock(summary.at)}</span>
        <span className="truncate text-muted-foreground">
          {req.item} {req.quantity.toLocaleString('ko-KR')}개 · {won(req.budgetMax)} 이하 · {req.deadline}까지{picked ? ` · 추천 ${picked}` : ''}
        </span>
        <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-5 py-4">
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
  const [showTo, setShowTo] = useState(!draft.to);
  const vendor = vendors.find((v) => v.id === draft.vendorId);
  // 이전 검색 카드(보기 전용)에서는 API가 null을 돌려준다
  const done = (r: { ok: boolean; error?: string; imap?: boolean } | null) => {
    if (!r) {
      setState('draft');
      return;
    }
    if (r.ok) {
      setState('sent');
      setImap(Boolean(r.imap));
    } else {
      setState('draft');
      setError(r.error ?? '보내지 못했어요');
    }
  };
  const locked = state !== 'draft';
  // 시연용 주소(.test)는 메일 계정이 없어도 보내기를 누를 수 있다 (실제 발송 없이 회신만 흉내)
  const demo = isDemoAddress(edit.to);
  const canSend = Boolean(config?.smtpConfigured) || demo;
  // 디자인 29:174: 흰 카드, 칸마다 아래 줄, 근거는 회색 상자, 버튼은 외곽선 + 연파랑
  const bare = 'h-auto rounded-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 disabled:opacity-100';
  return (
    <div className="flex w-full max-w-[940px] flex-col gap-3 rounded-lg bg-white p-5">
      <div className="flex items-start justify-between gap-4 border-b border-line px-2 pb-3">
        <div className="flex min-w-0 flex-col gap-3 leading-normal">
          <p className="flex items-center gap-2 text-[19px] font-semibold text-ink">
            <Mail className="size-5 shrink-0 text-muted-foreground" />
            {vendor ? `${vendor.name}에 보낼 ${KIND_LABEL[draft.kind]} 메일` : `${KIND_LABEL[draft.kind]} 메일`}
          </p>
          {state !== 'sent' && <p className="text-[14px] font-medium text-muted-foreground">내용을 확인하고 직접 보내 주세요. 누르기 전에는 발송되지 않아요.</p>}
        </div>
        <div className="flex shrink-0 items-center rounded-lg bg-muted p-1">
          <span className={cn('rounded-lg px-4 py-2 text-[14px] font-medium', state === 'sent' ? 'text-muted-foreground' : 'bg-white text-black')}>보내기 전</span>
          <span className={cn('flex items-center gap-1 rounded-lg px-4 py-2 text-[14px] font-medium', state === 'sent' ? 'bg-white text-ok' : 'text-muted-foreground')}>
            {state === 'sent' && <Check className="size-4" />} 보냄
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Field label="받는 사람">
          {/* 업체 메일 주소는 기본으로 가린다. 비어 있으면 바로 입력할 수 있게 입력칸을 보여 준다 */}
          {edit.to && !showTo ? (
            <span className="flex items-center gap-2 text-[14px] font-medium text-ink">
              {maskEmail(edit.to)}
              <RevealButton shown={false} onToggle={() => setShowTo(true)} />
            </span>
          ) : (
            <Input disabled={locked} value={edit.to} placeholder="메일 주소" onChange={(e) => setEdit({ ...edit, to: e.target.value })} className={cn(bare, 'text-[14px] font-medium text-ink md:text-[14px]')} />
          )}
        </Field>
        {demo && state !== 'sent' && (
          <p className="flex items-center gap-1.5 px-2 text-[13px] font-medium text-primary">
            <FlaskConical className="size-4 shrink-0" />
            시연용 주소(.test)예요. 보내면 잠시 뒤 시연용 업체 회신이 자동으로 와요.
          </p>
        )}
        <Field label="제목">
          <Input disabled={locked} value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} className={cn(bare, 'text-[16px] font-semibold text-ink md:text-[16px]')} />
        </Field>
        <div className="flex flex-col gap-2 border-b border-line px-2 pb-5">
          <Textarea disabled={locked} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} className={cn(bare, 'min-h-48 text-[14px] font-medium leading-[1.6] text-ink md:text-[14px]')} />
          {draft.evidence && draft.evidence.length > 0 && (
            <div className="flex items-start justify-between gap-4 rounded-lg bg-muted px-4 py-2.5 text-[14px] leading-[1.6] text-ink">
              <div className="flex min-w-0 flex-col gap-2">
                <p className="font-semibold">근거로 쓴 내용</p>
                <ul className="font-medium">
                  {draft.evidence.map((e, i) => (
                    <li key={i}>{e.vendorId} 업체 {FIELD_LABELS[e.field]}: “{e.snippet}”</li>
                  ))}
                </ul>
              </div>
              <span className="shrink-0 text-[13px] font-medium text-primary">견적에서 가져옴</span>
            </div>
          )}
        </div>
      </div>

      {error && <div className="rounded-lg bg-destructive/10 px-4 py-2.5 text-[13px] text-destructive">{error}</div>}

      {state !== 'sent' ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" className="h-auto px-4 py-2.5 text-[14px]" disabled={state === 'sending'} onClick={async () => done(await api.openMailApp(edit))}>
            메일 앱으로 열기
          </Button>
          {canSend && (
            <Button variant="secondary" className="h-auto px-4 py-2.5 text-[14px]" disabled={state === 'sending'} onClick={async () => { setState('sending'); setError(''); done(await api.sendMail(edit)); }}>
              <Send className="size-4" /> {state === 'sending' ? '보내는 중…' : '승인하고 보내기'}
            </Button>
          )}
          {config?.smtpConfigured ? (
            <span className="text-[13px] text-muted-foreground">{config.mailUser}에서 보내요</span>
          ) : demo ? (
            <span className="text-[13px] text-muted-foreground">메일 계정이 없어 실제로는 보내지 않고 시연만 해요</span>
          ) : (
            <button onClick={() => set({ settingsOpen: true })} className="text-[13px] text-muted-foreground underline-offset-2 hover:text-ink hover:underline">
              Google 계정을 연결하면 앱에서 바로 보낼 수 있어요
            </button>
          )}
        </div>
      ) : draft.kind !== 'order' && !replied ? (
        <div className="flex flex-col gap-2 pt-1">
          <div className="text-[14px] font-semibold text-ink">업체 회신</div>
          <p className="text-[13px] text-muted-foreground">
            {imap ? '회신이 오면 자동으로 가져와 견적서에 반영해요. 다른 경로로 받았다면 여기에 붙여 넣어도 돼요.' : '업체에서 회신을 받으면 여기에 붙여 넣어 주세요.'}
          </p>
          <Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="받은 회신 내용" className="h-24 text-[14px] md:text-[14px]" />
          <Button variant="secondary" className="h-auto w-fit px-4 py-2.5 text-[14px]" disabled={!reply.trim()} onClick={async () => { setReplied(true); await api.pasteReply(draft.vendorId, draft.kind, reply); }}>
            견적에 반영
          </Button>
        </div>
      ) : replied ? (
        <p className="text-[13px] text-muted-foreground">회신을 견적에 반영했어요.</p>
      ) : null}
    </div>
  );
}

/** 문자·카톡 문의: 초안을 복사하거나 앱을 열어 사용자가 직접 보내고, 받은 견적서·답장을 같은 카드에 넣는다 */
export function MessageCard({ draft }: { draft: MessageDraft }) {
  const api = useApi();
  const { vendors } = useRunStore();
  const [body, setBody] = useState(draft.body);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const [replied, setReplied] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const vendor = vendors.find((v) => v.id === draft.vendorId);
  const chatLabel = draft.chatUrl?.includes('talk.naver.com') ? '네이버 톡톡 열기' : '카카오톡 열기';
  const bare = 'h-auto rounded-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0';
  const copy = async () => {
    await navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex w-full max-w-[940px] flex-col gap-3 rounded-lg bg-white p-5">
      <div className="flex items-start justify-between gap-4 border-b border-line px-2 pb-3">
        <div className="flex min-w-0 flex-col gap-3 leading-normal">
          <p className="flex items-center gap-2 text-[19px] font-semibold text-ink">
            <MessageCircle className="size-5 shrink-0 text-muted-foreground" />
            {vendor ? `${vendor.name}에 보낼 문자·카톡 문의` : '문자·카톡 문의'}
          </p>
          <p className="text-[14px] font-medium text-muted-foreground">초안을 복사하거나 앱을 열어 직접 보내 주세요. 돌다리가 대신 보내지는 않아요.</p>
        </div>
        <div className="flex shrink-0 items-center rounded-lg bg-muted p-1">
          <span className={cn('rounded-lg px-4 py-2 text-[14px] font-medium', sent ? 'text-muted-foreground' : 'bg-white text-black')}>보내기 전</span>
          <span className={cn('flex items-center gap-1 rounded-lg px-4 py-2 text-[14px] font-medium', sent ? 'bg-white text-ok' : 'text-muted-foreground')}>
            {sent && <Check className="size-4" />} 보냄
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Field label="연락처">
          <span className="flex items-center gap-2 text-[14px] font-medium text-ink">
            {/* 업체 연락처는 기본으로 가리고, 볼 때만 펼친다 (복사·문자 앱 열기는 원래 번호로) */}
            {[draft.phone && (showContact ? formatPhone(draft.phone) : maskPhone(draft.phone)), draft.chatUrl].filter(Boolean).join(' · ') ||
              (draft.contact ? (showContact ? draft.contact : maskText(draft.contact)) : '사이트에서 찾지 못했어요')}
            {(draft.phone || draft.contact) && <RevealButton shown={showContact} onToggle={() => setShowContact(!showContact)} />}
          </span>
        </Field>
        <div className="border-b border-line px-2 pb-5">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} className={cn(bare, 'min-h-40 text-[14px] font-medium leading-[1.6] text-ink md:text-[14px]')} />
        </div>
      </div>

      {error && <div className="rounded-lg bg-destructive/10 px-4 py-2.5 text-[13px] text-destructive">{error}</div>}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" className="h-auto px-4 py-2.5 text-[14px]" onClick={() => void copy()}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? '복사했어요' : '초안 복사'}
        </Button>
        {draft.chatUrl && (
          <Button variant="outline" className="h-auto px-4 py-2.5 text-[14px]" onClick={() => api.openExternal(draft.chatUrl!)}>
            <ExternalLink className="size-4" /> {chatLabel}
          </Button>
        )}
        {draft.phone && (
          <Button
            variant="outline"
            className="h-auto px-4 py-2.5 text-[14px]"
            onClick={async () => {
              setError('');
              const r = await api.openSms(draft.vendorId, body);
              if (r && !r.ok) setError(r.error ?? '문자 앱을 열 수 없어요.');
            }}
          >
            <Smartphone className="size-4" /> 문자 앱으로 열기
          </Button>
        )}
        {!sent && (
          <Button variant="secondary" className="h-auto px-4 py-2.5 text-[14px]" onClick={async () => { setSent(true); await api.messageSent(draft.vendorId); }}>
            <Send className="size-4" /> 보냈어요
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <div className="text-[14px] font-semibold text-ink">받은 견적서</div>
        <p className="text-[13px] text-muted-foreground">업체가 보낸 견적서 PDF·사진을 올리거나, 글로 받은 답장을 붙여 넣으면 웹 견적과 같은 기준으로 비교해요.</p>
        <UploadCard vendorId={draft.vendorId} />
        {replied ? (
          <p className="text-[13px] text-muted-foreground">답장을 견적에 반영했어요.</p>
        ) : (
          <>
            <Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="카톡·문자로 받은 답장 붙여넣기" className="h-24 text-[14px] md:text-[14px]" />
            <Button variant="secondary" className="h-auto w-fit px-4 py-2.5 text-[14px]" disabled={!reply.trim()} onClick={async () => { setReplied(true); await api.pasteMessage(draft.vendorId, reply); }}>
              답장을 견적에 반영
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** 01012345678 → 010-1234-5678 */
const formatPhone = (p: string) => p.replace(/^(02|0\d{2})(\d{3,4})(\d{4})$/, '$1-$2-$3');

function RevealButton({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-ink">
      {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />} {shown ? '가리기' : '보기'}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-5 border-b border-line px-2 pb-3">
      <span className="shrink-0 text-[14px] font-medium text-ink">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
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
        'flex w-full max-w-[654px] cursor-pointer items-center justify-between gap-4 rounded-lg border border-dashed border-primary px-6 py-4 transition-colors',
        drag ? 'bg-secondary' : 'bg-row hover:bg-secondary'
      )}
    >
      <input type="file" accept=".pdf,image/*,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
      <div className="flex min-w-0 flex-col gap-2 font-medium leading-normal">
        <div className="flex items-center gap-2 text-[17px] text-black">
          <span className={cn('size-2 shrink-0 rounded-full', VENDOR_DOT[vendorId])} />
          {vendor?.name ?? `${vendorId} 업체`} 견적서 올리기
        </div>
        <div className="truncate text-[14px] text-muted-foreground">
          {status === 'parsing' ? `“${name}” 읽는 중…` : doneUp ? `“${name}”을 같은 양식으로 정리했어요` : 'PDF, 이미지, 텍스트 파일을 끌어다 놓거나 눌러서 고르세요'}
        </div>
      </div>
      <span
        className={cn(
          'flex max-w-[45%] shrink-0 items-center gap-1.5 rounded-lg border bg-white px-4 py-2.5 text-[14px] font-medium',
          doneUp ? 'border-ok text-ok' : 'border-muted-foreground text-black'
        )}
      >
        {doneUp ? <Check className="size-4 shrink-0" /> : <Paperclip className="size-4 shrink-0" />}
        <span className="truncate">{name || '파일 고르기'}</span>
      </span>
    </label>
  );
}
