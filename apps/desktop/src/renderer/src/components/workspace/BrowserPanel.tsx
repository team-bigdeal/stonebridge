import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Columns3, ExternalLink, PanelLeft, FileText, Maximize2, Play, RefreshCw, Replace, ShieldAlert, SkipForward, Square } from 'lucide-react';
import type { Slot, VendorId, VendorStatus } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { STATUS_LABEL, useStore, VENDOR_DOT } from '@/store';
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
  failed: 'bad',
  stopped: 'muted'
};

export function BrowserPanel({ slot, title, className, frameClassName, compact = false }: { slot: Slot; title?: string; className?: string; frameClassName?: string; compact?: boolean }) {
  const api = useApi();
  const { browsers, vendorStatus, vendors, quotes, set, scoped } = useRunStore();
  const b = browsers[slot];
  // 계속·건너뛰기·다시 시도·다른 업체로: 처리하는 동안 버튼을 잠가 두 번 눌리지 않게
  const [pending, setPending] = useState(false);
  const once = (fn: () => unknown) => async () => {
    if (pending) return;
    setPending(true);
    try {
      await fn();
    } finally {
      setPending(false);
    }
  };
  const vid = slot === 'search' ? null : (slot as VendorId);
  const vendor = vid ? vendors.find((v) => v.id === vid) : null;
  const status = vid ? vendorStatus[vid] : undefined;
  // 탐색 중일 때만 진행 기록을 펼칠 수 있게 (끝난 업체는 상태만)
  const active = !vid || status === 'browsing' || status === 'parsing';
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
      <div className="flex max-w-full items-center gap-2 self-start rounded-t-lg bg-card px-4 py-2.5 text-[14px] font-medium text-muted-foreground xl:text-[16px]">
        {vid && <span className={cn('size-2 shrink-0 rounded-full', VENDOR_DOT[vid])} />}
        <span className="truncate" title={vendor?.name}>{title ?? (vendor ? vendor.name : vid ? '업체 찾는 중' : '웹 검색')}</span>
      </div>
    <Card className="gap-5 overflow-hidden rounded-tl-none px-5 py-6">
      {/* 주소줄 */}
      <div className="flex items-center gap-1 rounded-full bg-muted py-1.5 pl-2 pr-2 text-[14px] font-medium text-muted-foreground">
        <Button size="icon" variant="ghost" className="size-8 rounded-full hover:bg-card" onClick={() => api.browserBack(slot)} title="뒤로" aria-label="뒤로">
          <ArrowLeft className="size-4" />
        </Button>
        <span className="min-w-0 flex-1 truncate px-1" title={b?.url}>{host || '페이지 준비 중'}</span>
        {web && (
          <Button size="icon" variant="ghost" className="size-8 rounded-full hover:bg-card" onClick={() => window.doldari.openExternal(b!.url)} title="기본 브라우저로 열기" aria-label="기본 브라우저로 열기">
            <ExternalLink className="size-4" />
          </Button>
        )}
        {!scoped && <Button size="icon" variant="ghost" className="size-8 rounded-full hover:bg-card" onClick={() => set({ expanded: slot })} title="크게 보고 직접 조작하기" aria-label="크게 보기">
          <Maximize2 className="size-4" />
        </Button>}
      </div>

      {/* 상태 */}
      {status && (
        <div className="-mt-1 flex items-center">
          <Pill tone={STATUS_TONE[status]} className="text-[13px]">{STATUS_LABEL[status]}</Pill>
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
            // 카드가 좁으면 버튼 글자가 잘리지 않게 줄을 바꾼다
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <Button size="sm" className="h-7 flex-auto" disabled={pending} onClick={once(() => api.resume(slot))}>
                <Play className="size-3.5" /> 해결했어요, 계속
              </Button>
              <Button size="sm" variant="outline" className="h-7 flex-auto" disabled={pending} onClick={once(() => api.skip(vid))}>
                <SkipForward className="size-3.5" /> 건너뛰기
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-lg bg-background">
        {/* 한 화면 안에 보이도록 높이를 화면 높이에 맞춰 제한한다 (넘치면 가로로 넓어짐) */}
        <LiveFrame slot={slot} still={compact} className={cn('max-h-[calc(100vh-360px)]', frameClassName)} />
      </div>

      {/* 작은 화면에도 지금 하는 일 한 줄은 보여 준다 (기록 펼치기는 큰 화면에서만) */}
      <Steps slot={slot} history={!compact && active} />
      {vid && (hasDoc || status === 'failed' || status === 'stopped') && (
        <div className="flex flex-wrap gap-2">
          {hasDoc && (
            <Button variant="secondary" className="h-auto flex-1 px-4 py-2.5 text-[14px]" onClick={() => set({ viewer: { kind: 'vendor', id: vid } })}>
              <FileText className="size-4" /> 견적서 보기
            </Button>
          )}
          {(status === 'failed' || status === 'stopped') && (
            <>
              <Button variant="secondary" className="h-auto flex-1 px-4 py-2.5 text-[14px]" disabled={pending} onClick={once(() => api.retry(vid))}>
                <RefreshCw className="size-4" /> {status === 'stopped' ? '이어서 하기' : '다시 시도'}
              </Button>
              <Button variant="outline" className="h-auto flex-1 px-4 py-2.5 text-[14px]" disabled={pending} onClick={once(() => api.replace(vid))}>
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

type GridLayout = 'focus' | 'grid';
// 기본값을 나란히로 바꾸면서 키를 새로 씀 (예전에 저장된 '크게 보기'가 남지 않도록)
const LAYOUT_KEY = 'doldari.browserLayout.v2';
const loadLayout = (): GridLayout => {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'focus' ? 'focus' : 'grid';
  } catch {
    return 'grid';
  }
};

/**
 * 이번 검색에 쓰는 브라우저들.
 * - 나란히(기본): 같은 크기로 나란히
 * - 크게 보기: 고른 브라우저 하나를 보기 편한 크기로 크게, 나머지는 오른쪽에 작게 (누르면 바꿔 봄)
 * 브라우저가 1개면 그 하나를 화면에 맞춰 크게 보여 준다.
 */
export function BrowserGrid({ slots = ['A', 'B', 'C'] }: { slots?: VendorId[] }) {
  const api = useApi();
  const { vendorStatus, scoped } = useRunStore();
  const running = !scoped && slots.some((id) => vendorStatus[id] === 'browsing');
  const [layout, setLayout] = useState<GridLayout>(loadLayout);
  // 나란히 놓으면 칸이 실제 브라우저를 붙일 최소 너비(약 280px)보다 좁아져 정지 화면만 보이고 커서도 안 보인다.
  // 그럴 때는 크게 보기로 보여 준다 (고른 보기 방식은 그대로 기억)
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const cols = slots.length >= 3 ? 3 : 2;
  const tooNarrow = slots.length > 1 && width > 0 && (width - 20 * (cols - 1)) / cols - 40 < 280;
  const shown: GridLayout = tooNarrow ? 'focus' : layout;
  const [focus, setFocus] = useState<VendorId>(slots[0]);
  const main = slots.includes(focus) ? focus : slots[0];
  const others = slots.filter((id) => id !== main);
  const choose = (l: GridLayout) => {
    setLayout(l);
    try {
      localStorage.setItem(LAYOUT_KEY, l);
    } catch {
      /* 무시 */
    }
  };
  return (
    <div ref={box} className="space-y-3" data-browser-grid>
      <div className="flex items-center justify-end gap-2">
        {slots.length > 1 && (
          <div className="flex rounded-lg bg-muted p-0.5 text-[13px] font-medium">
            {(['grid', 'focus'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => choose(l)}
                disabled={tooNarrow && l === 'grid'}
                title={tooNarrow && l === 'grid' ? '창이 좁아 나란히 놓으면 실제 화면이 안 보여요. 창을 넓히면 쓸 수 있어요' : undefined}
                className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors disabled:opacity-40', shown === l ? 'bg-card text-ink dark:bg-input shadow-sm' : 'text-muted-foreground hover:text-ink')}
              >
                {l === 'focus' ? <PanelLeft className="size-3.5" /> : <Columns3 className="size-3.5" />}
                {l === 'focus' ? '크게 보기' : '나란히'}
              </button>
            ))}
          </div>
        )}
        {running && (
          <Button size="sm" variant="outline" onClick={() => api.stop()} title="탐색을 멈추고 지금까지 모은 견적으로 비교해요">
            <Square className="size-3.5" /> 멈추기
          </Button>
        )}
      </div>
      {slots.length === 1 ? (
        <BrowserPanel slot={slots[0]} frameClassName="max-h-[calc(100vh-300px)]" />
      ) : shown === 'focus' ? (
        // 화면이 넓어도 너무 커지지 않게 전체 너비와 높이를 묶어 둔다 (16:10 비율 유지)
        <div className="mx-auto grid w-full max-w-[1080px] grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(240px,28%)]">
          <BrowserPanel key={main} slot={main} frameClassName="max-h-[min(54vh,520px)]" />
          <div className="flex flex-col gap-5">
            {others.map((id) => (
              <div key={id} className="relative">
                <BrowserPanel slot={id} compact />
                {/* 작은 화면을 누르면 크게 바꿔 본다 (작은 카드 안 브라우저는 조작하지 않고 고르기만) */}
                <button
                  type="button"
                  onClick={() => setFocus(id)}
                  className="absolute inset-0 z-10 rounded-lg ring-primary/0 transition hover:bg-primary/5 hover:ring-2 hover:ring-primary/40"
                  title="크게 보기"
                  aria-label={`브라우저 ${id} 크게 보기`}
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className={cn('grid grid-cols-1 gap-5', slots.length >= 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2')}>
          {slots.map((id) => (
            <BrowserPanel key={id} slot={id} />
          ))}
        </div>
      )}
    </div>
  );
}
