import { PanelLeft, Plus, Settings, X } from 'lucide-react';
import { STAGES } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { saveSidebar, useStore, VENDOR_DOT } from '@/store';
import { dropReplay } from '@/replay';
import { cn } from '@/lib/utils';
import { LiveFrame } from './workspace/LiveFrame';
import { Steps } from './workspace/Steps';

export function TopBar() {
  const { stage, config, sidebarOpen, set, resetAll } = useStore();
  const current = STAGES.findIndex((s) => s.id === stage);
  return (
    <header className="drag flex h-12 shrink-0 items-center gap-4 border-b bg-background/90 pl-20 pr-4">
      <div className="flex items-center gap-2">
        <Button
          size="icon"
          variant="ghost"
          className={cn('no-drag size-7', sidebarOpen && 'text-primary')}
          title={sidebarOpen ? '히스토리 닫기' : '히스토리 열기'}
          onClick={() => {
            saveSidebar(!sidebarOpen);
            set({ sidebarOpen: !sidebarOpen });
          }}
        >
          <PanelLeft className="size-4" />
        </Button>
        <span className="text-[15px] font-black tracking-tight">돌다리</span>
        <Badge variant="secondary" className="text-primary">견적 에이전트</Badge>
      </div>
      <div className="mx-auto flex items-center gap-1">
        {STAGES.map((s, i) => (
          <div key={s.id} className="flex items-center gap-1">
            <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-semibold', i === current ? 'bg-primary text-primary-foreground' : i < current ? 'text-primary' : 'text-muted-foreground/60')}>
              {i < current ? '✓ ' : ''}
              {s.label}
            </span>
            {i < STAGES.length - 1 && <span className={cn('h-px w-4', i < current ? 'bg-primary/60' : 'bg-border')} />}
          </div>
        ))}
      </div>
      <div className="no-drag flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={async () => { dropReplay(); await window.doldari.reset(); resetAll(); }}>
          <Plus className="size-4" /> 새 견적
        </Button>
        {/* 브라우저·모델·API 키 상태는 설정 창 안에서 본다. API 키가 없을 때만 표시 */}
        <Button size="icon" variant="outline" className="relative size-8" title="설정" onClick={() => set({ settingsOpen: true })}>
          <Settings className="size-4" />
          {!config?.hasApiKey && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-destructive" title="API 키 필요" />}
        </Button>
      </div>
    </header>
  );
}

export function Notices() {
  const notices = useStore((s) => s.notices);
  return (
    <div className="pointer-events-none fixed bottom-24 right-6 z-50 space-y-2">
      {notices.map((n) => (
        <div key={n.id} className="pointer-events-auto max-w-sm rounded-xl border bg-popover/95 px-3 py-2 text-[13px] shadow-2xl backdrop-blur">
          {n.vendorId && <span className={cn('mr-1.5 inline-block size-2 rounded-full', VENDOR_DOT[n.vendorId])} />}
          {n.message}
        </div>
      ))}
    </div>
  );
}

/** 브라우저 크게 보기 (직접 조작) */
export function ExpandedBrowser() {
  const { expanded, set } = useStore();
  if (!expanded) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm" onClick={() => set({ expanded: null })}>
      <div className="flex w-full max-w-[1700px] gap-4" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0 flex-1">
          <LiveFrame slot={expanded} priority={2} />
          <p className="mt-2 text-center text-xs text-muted-foreground">화면을 직접 클릭·스크롤·입력할 수 있어요. 바깥을 누르면 닫혀요.</p>
        </div>
        <div className="max-h-[85vh] w-80 shrink-0 overflow-y-auto rounded-xl border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">작업 단계</span>
            <Button size="icon" variant="ghost" className="size-7" onClick={() => set({ expanded: null })}><X className="size-4" /></Button>
          </div>
          <Steps slot={expanded} defaultOpen />
        </div>
      </div>
    </div>
  );
}
