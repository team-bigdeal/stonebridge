import { useContext, useEffect, useRef } from 'react';
import { create } from 'zustand';
import type { Slot } from '@shared/types';
import { cn } from '@/lib/utils';
import { setFrameIO, useStore } from '@/store';
import { registerView, useShownViews } from './viewManager';
import { RunContext } from '@/runScope';

/** 화면 이미지는 자주 바뀌므로 메인 상태와 분리 */
export const useFrames = create<{ frames: Partial<Record<Slot, string>> }>(() => ({ frames: {} }));
export const pushFrame = (slot: Slot, data: string) => useFrames.setState((s) => ({ frames: { ...s.frames, [slot]: data } }));
// 조건 바꾸기 때 store가 지금 화면을 이전 검색으로 얼리고 비울 수 있게
setFrameIO({ get: () => useFrames.getState().frames, clear: () => useFrames.setState({ frames: {} }) });
/**
 * 브라우저 화면: 내장 브라우저 뷰가 이 자리에 겹쳐 뜬다 (사용자가 그대로 클릭·입력).
 * 카드가 화면 밖이거나 지난 견적이면 마지막 화면 이미지.
 */
export function LiveFrame({ slot, className, priority = 1, still = false }: { slot: Slot; className?: string; priority?: number; still?: boolean }) {
  const scope = useContext(RunContext);
  const liveFrame = useFrames((s) => s.frames[slot]);
  // 이전 검색 카드는 그때 저장된 화면
  const frame = scope ? scope.frames[slot] : liveFrame;
  const ref = useRef<HTMLDivElement>(null);
  // still: 실제 뷰를 붙이지 않고 2초마다 찍는 화면만 (크게 보기 옆의 작은 화면)
  const replay = useStore((s) => Boolean(s.replay)) || Boolean(scope) || still;
  const shown = useShownViews((s) => Boolean(s.shown[slot]));

  useEffect(() => {
    if (replay || !ref.current) return;
    return registerView(slot, ref.current, priority);
  }, [replay, slot, priority]);

  if (replay) {
    // 지난 견적: 저장된 마지막 화면만
    return (
      <div className={cn('relative aspect-[16/10] w-full overflow-hidden rounded-lg bg-muted/40 ring-1 ring-border', className)}>
        {frame ? <img src={frame} alt="" draggable={false} className="h-full w-full select-none object-cover object-top" /> : still ? <Placeholder /> : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">저장된 화면이 없어요</div>}
      </div>
    );
  }
  return (
    <div ref={ref} className={cn('relative aspect-[16/10] w-full overflow-hidden rounded-lg bg-muted/40 ring-1 ring-border', className)}>
      {shown ? null : frame ? <img src={frame} alt="" draggable={false} className="h-full w-full select-none object-cover object-top opacity-80" /> : <Placeholder />}
    </div>
  );
}

function Placeholder() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
      <span className="size-4 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-transparent" />
      브라우저를 여는 중
    </div>
  );
}

