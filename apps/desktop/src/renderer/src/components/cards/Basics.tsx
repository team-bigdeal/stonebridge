import { useState } from 'react';
import { Paperclip, Mail, Send } from 'lucide-react';
import type { MailDraft, VendorId } from '@shared/types';
import { FIELD_LABELS } from '@shared/types';
import { won } from '@shared/quote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useStore, VENDOR_DOT, VENDOR_TEXT } from '@/store';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

export function RequirementsCard() {
  const r = useStore((s) => s.requirements) ?? {};
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
              <Button size="sm" disabled={state === 'sending'} onClick={async () => { setState('sending'); setError(''); done(await api.sendMail(edit)); }}>
                <Send className="size-4" /> {state === 'sending' ? '보내는 중…' : `${config.smtpUser}로 보내기`}
              </Button>
            )}
            <Button size="sm" variant={config?.smtpConfigured ? 'outline' : 'default'} onClick={async () => done(await api.openMailApp(edit))}>
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
            <Button size="sm" disabled={!reply.trim()} onClick={async () => { setReplied(true); await api.pasteReply(draft.vendorId, draft.kind, reply); }}>
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
    await api.uploadFile(vendorId, { name: f.name, mime: f.type, data: new Uint8Array(await f.arrayBuffer()) });
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
