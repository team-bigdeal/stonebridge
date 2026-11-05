import { ChevronDown } from 'lucide-react';
import type { Slot, VendorStatus } from '@shared/types';
import { Task, TaskContent, TaskTrigger } from '@/components/ai-elements/task';
import { useStore } from '@/store';
import { cn } from '@/lib/utils';
import { useRunSel } from '@/runScope';

/** 끝난 브라우저는 마지막 작업 대신 마무리 한 줄을 보여 준다 ("견적 정보 보고 중"이 완료 옆에 남지 않게) */
const FINAL: Partial<Record<VendorStatus, { text: string; dot: string }>> = {
  done: { text: '견적 확인을 마쳤어요', dot: 'bg-ok' },
  failed: { text: '견적을 받지 못하고 탐색을 마쳤어요', dot: 'bg-destructive' },
  stopped: { text: '멈췄어요 · "이어서 하기"로 계속할 수 있어요', dot: 'bg-muted-foreground/50' }
};

/** 에이전트 작업 기록: 지금 하는 일 한 줄 + 펼치면 전체 기록 (history=false면 한 줄만) */
export function Steps({ slot, defaultOpen = false, history = true }: { slot: Slot; defaultOpen?: boolean; history?: boolean }) {
  const steps = useRunSel((s) => s.steps[slot]) ?? [];
  const status = useRunSel((s) => (slot === 'search' ? undefined : s.vendorStatus[slot]));
  if (steps.length === 0) return null;
  const last = steps[steps.length - 1];
  const final = status ? FINAL[status] : undefined;
  const running = !final && last.status === 'running';
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[14px] font-medium">
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            final ? final.dot : running ? 'animate-pulse bg-primary' : last.status === 'error' ? 'bg-destructive' : 'bg-muted-foreground/50'
          )}
        />
        <span className={cn('truncate', running ? 'text-ink' : 'text-muted-foreground')} title={final ? `마지막 작업: ${last.intent}` : last.intent}>{final ? final.text : last.intent}</span>
      </div>
      {history && (
      <Task defaultOpen={defaultOpen}>
        <TaskTrigger title="">
          <button className="group flex items-center gap-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-ink">
            진행 기록 {steps.length}개
            <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
          </button>
        </TaskTrigger>
        <TaskContent>
          {steps.map((s) => (
            <div key={s.id} className={cn('text-[12px] leading-snug', s.status === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 text-foreground/85">{s.intent}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">{s.tool}</span>
              </div>
              {s.detail && <div className="mt-0.5 break-words opacity-80">{s.detail}</div>}
            </div>
          ))}
        </TaskContent>
      </Task>
      )}
    </div>
  );
}
