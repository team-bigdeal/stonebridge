import { ArrowLeft, ExternalLink, FileText, Maximize2, Play, RefreshCw, Replace, ShieldAlert, SkipForward } from 'lucide-react';
import type { Slot, VendorId, VendorStatus } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ANGLE_LABEL, STATUS_LABEL, useStore, VENDOR_DOT } from '@/store';
import { cn } from '@/lib/utils';
import { Pill } from '../cards/Section';
import { LiveFrame } from './LiveFrame';
import { Steps } from './Steps';
import { useRunStore, useApi } from '@/runScope';

const STATUS_TONE: Record<VendorStatus, 'ok' | 'warn' | 'bad' | 'muted' | 'primary'> = {
  idle: 'muted',
  browsing: 'primary',
  needs_mail: 'warn',
  waiting_reply: 'muted',
  needs_file: 'warn',
  needs_user: 'warn',
  parsing: 'primary',
  done: 'ok',
  failed: 'bad'
};

export function BrowserPanel({ slot, title, className }: { slot: Slot; title?: string; className?: string }) {
  const api = useApi();
  const { browsers, vendorStatus, vendors, quotes, set, scoped } = useRunStore();
  const b = browsers[slot];
  const vid = slot === 'search' ? null : (slot as VendorId);
  const vendor = vid ? vendors.find((v) => v.id === vid) : null;
  const status = vid ? vendorStatus[vid] : undefined;
  const hasDoc = vid ? quotes[vid]?.listedPrice.value !== null && quotes[vid]?.listedPrice.value !== undefined : false;
  const web = Boolean(b?.url && /^https?:/.test(b.url));
  const host = (() => {
    try {
      return web ? new URL(b!.url).hostname.replace(/^www\./, '') : '';
    } catch {
      return '';
    }
  })();

  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      {/* 탭: 업체 이름 (디자인의 파일 이름 탭 자리) */}
      <div className="flex max-w-full items-center gap-2 self-start rounded-t-lg bg-[#fffffd] px-4 py-2.5 text-[14px] font-medium text-muted-foreground xl:text-[16px]">
        {vid && <span className={cn('size-2 shrink-0 rounded-full', VENDOR_DOT[vid])} />}
        <span className="truncate" title={vendor?.name}>{title ?? (vendor ? vendor.name : vid ? '업체 찾는 중' : '웹 검색')}</span>
      </div>
    <Card className="gap-5 overflow-hidden rounded-tl-none px-5 py-6">
      {/* 주소줄 */}
      <div className="flex items-center gap-1 rounded-full bg-muted py-1.5 pl-2 pr-2 text-[14px] font-medium text-muted-foreground">
        <Button size="icon" variant="ghost" className="size-8 rounded-full hover:bg-white" onClick={() => api.browserBack(slot)} title="뒤로" aria-label="뒤로">
          <ArrowLeft className="size-4" />
        </Button>
        <span className="min-w-0 flex-1 truncate px-1" title={b?.url}>{host || '페이지 준비 중'}</span>
        {web && (
          <Button size="icon" variant="ghost" className="size-8 rounded-full hover:bg-white" onClick={() => window.doldari.openExternal(b!.url)} title="기본 브라우저로 열기" aria-label="기본 브라우저로 열기">
            <ExternalLink className="size-4" />
          </Button>
        )}
        {!scoped && <Button size="icon" variant="ghost" className="size-8 rounded-full hover:bg-white" onClick={() => set({ expanded: slot })} title="크게 보고 직접 조작하기" aria-label="크게 보기">
          <Maximize2 className="size-4" />
        </Button>}
      </div>

      {/* 업체 설명 + 상태 */}
      {(vid || status) && (
        <div className="-mt-1 flex items-center gap-3">
          {vid && <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-muted-foreground">{ANGLE_LABEL[vid]}</span>}
          {status && <Pill tone={STATUS_TONE[status]} className="text-[13px]">{STATUS_LABEL[status]}</Pill>}
        </div>
      )}

      {/* 차단·로그인 화면: 사용자에게 넘김 */}
      {b?.handoff && (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-[13px] leading-snug">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-px size-4 shrink-0 text-warn" />
            <div className="min-w-0">
              <div className="font-semibold text-warn">직접 확인이 필요해요</div>
              <div className="mt-0.5 text-foreground/85">{b.handoff}</div>
            </div>
          </div>
          {vid && status === 'needs_user' && (
            <div className="mt-2.5 flex gap-1.5">
              <Button size="sm" className="h-7 flex-1" onClick={() => api.resume(slot)}>
                <Play className="size-3.5" /> 해결했어요, 계속
              </Button>
              <Button size="sm" variant="outline" className="h-7 flex-1" onClick={() => api.skip(vid)}>
                <SkipForward className="size-3.5" /> 건너뛰기
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-lg bg-background">
        <LiveFrame slot={slot} />
      </div>

      <Steps slot={slot} />
      {vid && (hasDoc || status === 'failed') && (
        <div className="flex flex-wrap gap-2">
          {hasDoc && (
            <Button variant="secondary" className="h-auto flex-1 px-4 py-2.5 text-[14px]" onClick={() => set({ viewer: { kind: 'vendor', id: vid } })}>
              <FileText className="size-4" /> 견적서 보기
            </Button>
          )}
          {status === 'failed' && (
            <>
              <Button variant="secondary" className="h-auto flex-1 px-4 py-2.5 text-[14px]" onClick={() => api.retry(vid)}>
                <RefreshCw className="size-4" /> 다시 시도
              </Button>
              <Button variant="outline" className="h-auto flex-1 px-4 py-2.5 text-[14px]" onClick={() => api.replace(vid)}>
                <Replace className="size-4" /> 다른 업체로
              </Button>
            </>
          )}
        </div>
      )}
    </Card>
    </div>
  );
}

/** 브라우저 3개를 나란히 */
export function BrowserGrid() {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      {(['A', 'B', 'C'] as const).map((id) => (
        <BrowserPanel key={id} slot={id} />
      ))}
    </div>
  );
}
