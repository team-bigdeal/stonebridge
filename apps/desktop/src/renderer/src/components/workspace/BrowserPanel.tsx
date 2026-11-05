import { ArrowLeft, ExternalLink, FileText, Maximize2, RefreshCw, Replace, Play, SkipForward, ShieldAlert } from 'lucide-react';
import type { Slot, VendorId } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ANGLE_LABEL, STATUS_LABEL, useStore, VENDOR_DOT } from '@/store';
import { cn } from '@/lib/utils';
import { LiveFrame } from './LiveFrame';
import { Steps } from './Steps';
import { api } from '@/lib/api';

export function BrowserPanel({ slot, title, className }: { slot: Slot; title?: string; className?: string }) {
  const { browsers, vendorStatus, vendors, quotes, set } = useStore();
  const b = browsers[slot];
  const vid = slot === 'search' ? null : (slot as VendorId);
  const vendor = vid ? vendors.find((v) => v.id === vid) : null;
  const status = vid ? vendorStatus[vid] : undefined;
  const hasDoc = vid ? quotes[vid]?.listedPrice.value !== null && quotes[vid]?.listedPrice.value !== undefined : false;
  const host = (() => {
    try {
      return b?.url && /^https?:/.test(b.url) ? new URL(b.url).hostname.replace(/^www\./, '') : '';
    } catch {
      return '';
    }
  })();

  return (
    <Card className={cn('gap-0 overflow-hidden p-0', className)}>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        {vid && <span className={cn('size-2.5 shrink-0 rounded-full', VENDOR_DOT[vid], status === 'browsing' && 'animate-pulse')} />}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{title ?? (vendor ? vendor.name : vid ? `브라우저 ${vid} · 업체 찾는 중` : '웹 검색')}</div>
          {vid && <div className="truncate text-[11px] text-muted-foreground">{vid} · {ANGLE_LABEL[vid]}</div>}
        </div>
        {status && (
          <Badge variant={status === 'failed' ? 'destructive' : status === 'done' ? 'secondary' : 'outline'} className="ml-auto shrink-0">
            {STATUS_LABEL[status]}
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-1 bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
        <Button size="icon" variant="ghost" className="size-6" onClick={() => api.browserBack(slot)} title="뒤로">
          <ArrowLeft className="size-3.5" />
        </Button>
        <span className="truncate">{host || '—'}</span>
        <div className="ml-auto flex shrink-0">
          {b?.url && /^https?:/.test(b.url) && (
            <Button size="icon" variant="ghost" className="size-6" onClick={() => window.doldari.openExternal(b.url)} title="기본 브라우저로 열기">
              <ExternalLink className="size-3.5" />
            </Button>
          )}
          <Button size="icon" variant="ghost" className="size-6" onClick={() => set({ expanded: slot })} title="크게 보기">
            <Maximize2 className="size-3.5" />
          </Button>
        </div>
      </div>
      {b?.handoff && (
        <div className="mx-2 mt-2 rounded-lg bg-amber-400 px-3 py-2 text-[12px] font-semibold text-amber-950">
          <div className="flex items-start gap-1.5">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <span>{b.handoff}</span>
          </div>
          {vid && status === 'needs_user' && (
            <div className="mt-2 flex gap-1.5">
              <Button size="sm" className="h-7 flex-1 bg-amber-950 text-amber-50 hover:bg-amber-900" onClick={() => api.resume(slot)}>
                <Play className="size-3.5" /> 해결했어요, 계속
              </Button>
              <Button size="sm" variant="outline" className="h-7 flex-1 border-amber-950/40 bg-transparent text-amber-950 hover:bg-amber-300" onClick={() => api.skip(vid)}>
                <SkipForward className="size-3.5" /> 건너뛰기
              </Button>
            </div>
          )}
        </div>
      )}
      <div className="relative p-2">
        <LiveFrame slot={slot} />
      </div>
      <div className="space-y-2 px-3 pb-3">
        <Steps slot={slot} />
        {vid && (
          <div className="flex flex-wrap gap-1.5">
            {hasDoc && (
              <Button size="sm" className="flex-1" onClick={() => set({ viewer: { kind: 'vendor', id: vid } })}>
                <FileText className="size-4" /> {vid} 업체 견적서 보기
              </Button>
            )}
            {status === 'failed' && (
              <Button size="sm" variant="secondary" className="flex-1" onClick={() => api.retry(vid)}>
                <RefreshCw className="size-4" /> 다시 시도
              </Button>
            )}
            {status === 'failed' && (
              <Button size="sm" variant="outline" className="flex-1" onClick={() => api.replace(vid)}>
                <Replace className="size-4" /> 다른 업체로 바꾸기
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/** 브라우저 3개를 크게 나란히 */
export function BrowserGrid() {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      {(['A', 'B', 'C'] as const).map((id) => (
        <BrowserPanel key={id} slot={id} />
      ))}
    </div>
  );
}
