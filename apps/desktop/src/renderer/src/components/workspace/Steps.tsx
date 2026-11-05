import type { Slot } from '@shared/types';
import { Task, TaskContent, TaskItem, TaskTrigger } from '@/components/ai-elements/task';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { useStore } from '@/store';

/** 에이전트 도구 호출 단계 (AI Elements Task) */
export function Steps({ slot, defaultOpen = false }: { slot: Slot; defaultOpen?: boolean }) {
  const steps = useStore((s) => s.steps[slot]) ?? [];
  if (steps.length === 0) return null;
  const last = steps[steps.length - 1];
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-[13px]">
        {last.status === 'running' ? (
          <span className="size-2 shrink-0 animate-pulse rounded-full bg-primary" />
        ) : (
          <span className={`size-2 shrink-0 rounded-full ${last.status === 'error' ? 'bg-destructive' : 'bg-primary/60'}`} />
        )}
        {last.status === 'running' ? <Shimmer className="truncate">{last.intent}</Shimmer> : <span className="truncate text-muted-foreground">{last.intent}</span>}
      </div>
      <Task defaultOpen={defaultOpen}>
        <TaskTrigger title={`작업 ${steps.length}단계`} />
        <TaskContent>
          {steps.map((s) => (
            <TaskItem key={s.id} className={s.status === 'error' ? 'text-destructive' : undefined}>
              <span className="mr-1.5 rounded bg-secondary px-1 text-[10px] font-semibold">{s.tool}</span>
              {s.intent}
              {s.detail && <span className="block text-[11px] opacity-80">{s.detail}</span>}
            </TaskItem>
          ))}
        </TaskContent>
      </Task>
    </div>
  );
}
