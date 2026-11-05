import { Check, PanelLeft, RotateCcw, Settings, X } from 'lucide-react';
import { STAGES } from '@shared/types';
import { Button } from '@/components/ui/button';
import { saveSidebar, useStore, VENDOR_DOT } from '@/store';
import { dropReplay } from '@/replay';
import { cn } from '@/lib/utils';
import { LiveFrame } from './workspace/LiveFrame';
import { Steps } from './workspace/Steps';

/** 상단 단계 이름 (디자인 표기) */
const STAGE_LABEL: Partial<Record<(typeof STAGES)[number]['id'], string>> = {
  search: '업체 탐색',
  compare: '견적서 비교',
  questions: '확인 추천'
};

export function TopBar() {
  const { stage, config, timeline, set, resetAll } = useStore();
  const current = STAGES.findIndex((s) => s.id === stage);
  const started = timeline.length > 1;

  async function restart() {
    if (started && !window.confirm('지금까지 모은 견적이 사라져요. 새 견적을 시작할까요?')) return;
    dropReplay();
    await window.doldari.reset();
    resetAll();
  }

  return (
    <header className="drag flex shrink-0 items-center gap-6 bg-white py-2.5 pl-20 pr-6 xl:gap-12">
      <span className="logo-type whitespace-nowrap text-[20px] leading-none text-primary" aria-label="돌다리">StoneBridge</span>

      {/* 진행 단계 */}
      <ol className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] xl:gap-3 [&::-webkit-scrollbar]:hidden">
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
        <Button variant="outline" size="sm" className="h-8 px-3 text-[13px]" onClick={() => void restart()}>
          <RotateCcw className="size-3.5" /> 새 견적 추가하기
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
    <div className="fixed inset-0 z-40 flex flex-col bg-black/50 p-6" onClick={close}>
      <div className="mx-auto flex w-full max-w-[1700px] min-h-0 flex-1 flex-col gap-3 rounded-lg bg-background p-4" onClick={(e) => e.stopPropagation()}>
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
            <LiveFrame slot={expanded} priority={2} />
          </div>
          <aside className="scroll-thin max-h-[80vh] w-80 shrink-0 overflow-y-auto rounded-lg bg-card p-4">
            <div className="mb-2 text-[12px] font-semibold">진행 기록</div>
            <Steps slot={expanded} defaultOpen />
          </aside>
        </div>
      </div>
    </div>
  );
}
