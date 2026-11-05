import { Check, PanelLeft, RotateCcw, Settings, X } from 'lucide-react';
import { STAGES } from '@shared/types';
import { Button } from '@/components/ui/button';
import { saveSidebar, useStore, VENDOR_DOT } from '@/store';
import { dropReplay } from '@/replay';
import { cn } from '@/lib/utils';
import { LiveFrame } from './workspace/LiveFrame';
import { Steps } from './workspace/Steps';

export function TopBar() {
  const { stage, config, sidebarOpen, timeline, set, resetAll } = useStore();
  const current = STAGES.findIndex((s) => s.id === stage);
  const started = timeline.length > 1;

  async function restart() {
    if (started && !window.confirm('지금까지 모은 견적이 사라져요. 새 견적을 시작할까요?')) return;
    dropReplay();
    await window.doldari.reset();
    resetAll();
  }

  return (
    <header className="drag flex h-12 shrink-0 items-center gap-6 border-b pl-20 pr-3">
      <div className="flex items-center gap-2">
        <Button
          size="icon"
          variant="ghost"
          className={cn('no-drag size-7', sidebarOpen ? 'text-foreground' : 'text-muted-foreground')}
          title={sidebarOpen ? '히스토리 닫기' : '히스토리 열기'}
          aria-label={sidebarOpen ? '히스토리 닫기' : '히스토리 열기'}
          onClick={() => {
            saveSidebar(!sidebarOpen);
            set({ sidebarOpen: !sidebarOpen });
          }}
        >
          <PanelLeft className="size-4" />
        </Button>
        <span className="text-[15px] font-bold tracking-tight">돌다리</span>
      </div>

      {/* 진행 단계 */}
      <ol className="mx-auto flex items-center gap-1 text-[12px]">
        {STAGES.map((s, i) => {
          const done = i < current;
          const now = i === current;
          return (
            <li key={s.id} className="flex items-center gap-1">
              <span
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2 py-1',
                  now ? 'bg-secondary font-semibold text-foreground' : done ? 'text-muted-foreground' : 'text-muted-foreground/50'
                )}
              >
                <span
                  className={cn(
                    'flex size-4 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums',
                    now ? 'bg-primary text-primary-foreground' : done ? 'bg-muted text-muted-foreground' : 'border border-border'
                  )}
                >
                  {done ? <Check className="size-2.5" strokeWidth={3} /> : i + 1}
                </span>
                {s.label}
              </span>
              {i < STAGES.length - 1 && <span className={cn('h-px w-3', done ? 'bg-muted-foreground/40' : 'bg-border')} />}
            </li>
          );
        })}
      </ol>

      <div className="no-drag flex items-center gap-1">
        {/* 브라우저·모델 상태는 설정 창 안에서 본다. API 키가 없을 때만 상단에 알린다 */}
        <Button size="sm" variant="ghost" onClick={() => void restart()}>
          <RotateCcw className="size-3.5" /> 새 견적
        </Button>
        <Button size="sm" variant="ghost" onClick={() => set({ settingsOpen: true })} className={cn(!config?.hasApiKey && 'text-destructive')}>
          <Settings className="size-3.5" />
          {config?.hasApiKey ? '설정' : 'API 키 필요'}
        </Button>
      </div>
    </header>
  );
}

export function Notices() {
  const { notices, set } = useStore();
  return (
    <div className="pointer-events-none fixed bottom-28 right-6 z-50 flex w-80 flex-col gap-2">
      {notices.map((n) => (
        <div key={n.id} className="pointer-events-auto flex items-start gap-2 rounded-lg border bg-popover px-3 py-2.5 text-[13px] leading-snug shadow-lg">
          {n.vendorId && <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', VENDOR_DOT[n.vendorId])} />}
          <span className="min-w-0 flex-1">{n.message}</span>
          <button
            aria-label="알림 닫기"
            onClick={() => set({ notices: useStore.getState().notices.filter((x) => x.id !== n.id) })}
            className="-mr-1 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** 브라우저 크게 보기 (직접 조작) */
export function ExpandedBrowser() {
  const { expanded, vendors, set } = useStore();
  if (!expanded) return null;
  const vendor = expanded !== 'search' ? vendors.find((v) => v.id === expanded) : null;
  const close = () => set({ expanded: null });
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black/80 p-6" onClick={close}>
      <div className="mx-auto flex w-full max-w-[1700px] min-h-0 flex-1 flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 text-sm">
          {vendor && <span className={cn('size-2 rounded-full', VENDOR_DOT[vendor.id])} />}
          <span className="font-semibold">{vendor?.name ?? '웹 검색'}</span>
          <span className="text-muted-foreground">화면을 직접 클릭하고 입력할 수 있어요</span>
          <Button size="sm" variant="secondary" className="ml-auto" onClick={close}>
            <X className="size-4" /> 닫기
          </Button>
        </div>
        <div className="flex min-h-0 items-start gap-4">
          <div className="min-w-0 flex-1">
            <LiveFrame slot={expanded} priority={2} />
          </div>
          <aside className="scroll-thin max-h-[80vh] w-80 shrink-0 overflow-y-auto rounded-lg border bg-card p-3">
            <div className="mb-2 text-[13px] font-semibold">진행 기록</div>
            <Steps slot={expanded} defaultOpen />
          </aside>
        </div>
      </div>
    </div>
  );
}
