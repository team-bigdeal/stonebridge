import { useState } from 'react';
import { Check, Mail, Paperclip, Send } from 'lucide-react';
import type { MailDraft, VendorId } from '@shared/types';
import { FIELD_LABELS } from '@shared/types';
import { won } from '@shared/quote';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useStore, VENDOR_DOT } from '@/store';
import { cn } from '@/lib/utils';
import { Pill, SectionHead } from './Section';

export function RequirementsCard() {
  const r = useStore((s) => s.requirements) ?? {};
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
              <Button size="sm" disabled={state === 'sending'} onClick={async () => { setState('sending'); setError(''); done(await window.doldari.sendMail(edit)); }}>
                <Send className="size-3.5" /> {state === 'sending' ? '보내는 중…' : '보내기'}
              </Button>
            )}
            <Button size="sm" variant={config?.smtpConfigured ? 'outline' : 'default'} disabled={state === 'sending'} onClick={async () => done(await window.doldari.openMailApp(edit))}>
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
            <Button size="sm" disabled={!reply.trim()} onClick={async () => { setReplied(true); await window.doldari.pasteReply(draft.vendorId, draft.kind, reply); }}>
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
  const { vendors, vendorStatus } = useStore();
  const [drag, setDrag] = useState(false);
  const [name, setName] = useState('');
  const vendor = vendors.find((v) => v.id === vendorId);
  const status = vendorStatus[vendorId];
  const upload = async (f: File) => {
    setName(f.name);
    await window.doldari.uploadFile(vendorId, { name: f.name, mime: f.type, data: new Uint8Array(await f.arrayBuffer()) });
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
