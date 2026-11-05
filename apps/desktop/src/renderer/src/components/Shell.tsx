import { Check, Maximize, PanelLeft, Plus, Settings, X } from 'lucide-react';
import { STAGES } from '@shared/types';
import { Button } from '@/components/ui/button';
import { saveSidebar, useStore, VENDOR_DOT } from '@/store';
import { dropReplay } from '@/replay';
import { cn } from '@/lib/utils';
import { LiveFrame } from './workspace/LiveFrame';
import { Steps } from './workspace/Steps';
import { Mascot } from './Mascot';

/** 상단 단계 이름 (디자인 표기) */
const STAGE_LABEL: Partial<Record<(typeof STAGES)[number]['id'], string>> = {
  search: '업체 탐색',
  compare: '견적서 비교',
  questions: '확인 추천'
};

/** 새 견적 시작. 확인 없이 바로 초기화 (헤더·사이드바 공용) */
export function useRestart() {
  const { resetAll } = useStore();
  return async function restart() {
    dropReplay();
    await window.doldari.reset();
    resetAll();
  };
}

export function TopBar() {
  const { stage, config, sidebarOpen, sidebarWidth, set } = useStore();
  const restart = useRestart();
  const current = STAGES.findIndex((s) => s.id === stage);

  return (
    <header className="drag flex h-14 shrink-0 items-center border-b bg-card pr-6">
      {/* 로고 칸은 사이드바와 같은 너비 (창 버튼 오른쪽부터). 단계는 본문이 시작하는 곳에서 */}
      <div className="flex h-full shrink-0 items-center gap-2 pl-[88px]" style={{ width: sidebarOpen ? Math.max(sidebarWidth, 256) : 256 }}>
        <Mascot size={26} className="rounded-md" />
        <span className="logo-type whitespace-nowrap text-[19px] leading-none text-primary" aria-label="돌다리">StoneBridge</span>
      </div>

      {/* 진행 단계 */}
      <ol className="flex min-w-0 items-center gap-1 overflow-x-auto pl-6 xl:pl-8 [scrollbar-width:none] xl:gap-3 [&::-webkit-scrollbar]:hidden">
        {STAGES.map((s, i) => {
          const done = i < current;
          const now = i === current;
          return (
            <li key={s.id}>
              <span
                aria-current={now ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-medium leading-none xl:px-4 xl:text-[14px]',
                  now ? 'bg-secondary text-primary' : done ? 'text-ink' : 'text-muted-foreground'
                )}
              >
                {done ? <Check className="size-3.5 text-primary" strokeWidth={2.5} /> : <span className="tabular-nums">{i + 1}.</span>}
                {STAGE_LABEL[s.id] ?? s.label}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="no-drag ml-auto flex items-center gap-2">
        {/* 브라우저·모델 상태는 설정 창 안에서 본다. API 키가 없을 때만 상단에 알린다 */}
        {/* 사이드바가 닫혀 있을 때만 새 견적 버튼을 헤더에 둔다 */}
        {!sidebarOpen && (
          <Button variant="ghost" size="icon" title="새 견적 추가하기" aria-label="새 견적 추가하기" onClick={() => void restart()} className="size-auto p-2 text-muted-foreground hover:text-ink">
            <Plus className="size-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon" title="전체 화면 (켜고 끄기)" aria-label="전체 화면" onClick={() => void window.doldari.toggleFullScreen()} className="size-auto p-2 text-muted-foreground hover:text-ink">
          <Maximize className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size={config?.hasApiKey ? 'icon' : 'default'}
          title="설정"
          aria-label="설정"
          onClick={() => set({ settingsOpen: true })}
          className={cn('size-auto p-2', config?.hasApiKey ? 'text-muted-foreground hover:text-ink' : 'text-destructive')}
        >
          <Settings className="size-4" />
          {!config?.hasApiKey && 'API 키 필요'}
        </Button>
      </div>
    </header>
  );
}

/** 히스토리 열기·닫기. 사이드바 머리말(열림) 또는 대화 왼쪽 위(닫힘)에 둔다 */
export function SidebarToggle({ className }: { className?: string }) {
  const { sidebarOpen, set } = useStore();
  return (
    <Button
      size="icon"
      variant="ghost"
      className={cn('size-7 text-muted-foreground hover:text-ink', className)}
      title={sidebarOpen ? '히스토리 닫기' : '히스토리 열기'}
      aria-label={sidebarOpen ? '히스토리 닫기' : '히스토리 열기'}
      onClick={() => {
        saveSidebar(!sidebarOpen);
        set({ sidebarOpen: !sidebarOpen });
      }}
    >
      <PanelLeft className="size-4" />
    </Button>
  );
}

export function Notices() {
  const { notices, set } = useStore();
  return (
    <div className="pointer-events-none fixed bottom-28 right-6 z-50 flex w-80 flex-col gap-2">
      {notices.map((n) => (
        <div key={n.id} className="pointer-events-auto flex items-start gap-2 rounded-lg bg-popover px-4 py-3 text-[13px] leading-snug shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
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
    <div className="fixed inset-0 z-40 flex flex-col bg-black/50 p-3" onClick={close}>
      <div className="flex w-full min-h-0 flex-1 flex-col gap-3 rounded-lg bg-background p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 text-[14px]">
          {vendor && <span className={cn('size-2 rounded-full', VENDOR_DOT[vendor.id])} />}
          <span className="font-semibold">{vendor?.name ?? '웹 검색'}</span>
          <span className="text-muted-foreground">화면을 직접 클릭하고 입력할 수 있어요</span>
          <Button size="sm" variant="secondary" className="ml-auto" onClick={close}>
            <X className="size-4" /> 닫기
          </Button>
        </div>
        <div className="flex min-h-0 items-start gap-4">
          <div className="min-w-0 flex-1">
            <LiveFrame slot={expanded} priority={2} className="max-h-[calc(100vh-110px)]" />
          </div>
          <aside className="scroll-thin max-h-[calc(100vh-110px)] w-80 shrink-0 overflow-y-auto rounded-lg bg-card p-4">
            <div className="mb-2 text-[12px] font-semibold">진행 기록</div>
            <Steps slot={expanded} defaultOpen />
          </aside>
        </div>
      </div>
    </div>
  );
}
