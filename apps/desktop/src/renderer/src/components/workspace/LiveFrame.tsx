import { useContext, useEffect, useRef, useState } from 'react';
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

/** 에이전트 커서 (페이지 뷰포트 기준 0~1). 실제 뷰가 붙어 있으면 main이 뷰 위에 그리고, 아니면 화면 이미지 위에 여기서 그린다 */
interface Cursor {
  x: number;
  y: number;
  click?: boolean;
  at: number;
}
export const useCursors = create<{ cursors: Partial<Record<Slot, Cursor>> }>(() => ({ cursors: {} }));
export const pushCursor = (c: { slot: Slot; x: number; y: number; click?: boolean }) =>
  useCursors.setState((s) => ({ cursors: { ...s.cursors, [c.slot]: { x: c.x, y: c.y, click: c.click, at: Date.now() } } }));
/** 탐색 중이 아니면 이 시간 뒤 커서를 숨긴다. 탐색 중이면 다음 동작까지 마지막 자리에 남겨 둔다 */
const CURSOR_MS = 10_000;
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
  const past = useStore((s) => Boolean(s.replay)) || Boolean(scope);
  const replay = past || still;
  const shown = useShownViews((s) => Boolean(s.shown[slot]));
  // 이미 페이지를 연 브라우저면 화면 이미지가 오기 전이라도 "여는 중" 대신 빈 페이지로 둔다 (스크롤로 잠깐 뗄 때 깜빡이지 않게)
  const hasPage = useStore((s) => /^https?:/.test(s.browsers[slot]?.url ?? ''));

  useEffect(() => {
    if (replay || !ref.current) return;
    return registerView(slot, ref.current, priority);
  }, [replay, slot, priority]);

  if (replay) {
    // 지난 견적: 저장된 마지막 화면만
    return (
      <div className={cn('relative aspect-[16/10] w-full overflow-hidden rounded-lg bg-muted/40 ring-1 ring-border', className)}>
        {frame ? <img src={frame} alt="" draggable={false} className="h-full w-full select-none object-cover object-top" /> : still ? <Placeholder /> : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">저장된 화면이 없어요</div>}
        {!past && frame && <CursorDot slot={slot} />}
      </div>
    );
  }
  return (
    <div ref={ref} className={cn('relative aspect-[16/10] w-full overflow-hidden rounded-lg bg-muted/40 ring-1 ring-border', className)}>
      {shown ? null : frame ? <img src={frame} alt="" draggable={false} className="h-full w-full select-none object-cover object-top" /> : hasPage ? <div className="h-full w-full bg-white" /> : <Placeholder />}
      {!shown && frame && <CursorDot slot={slot} />}
    </div>
  );
}

/** 화면 이미지 위 에이전트 커서: 이동은 부드럽게, 클릭은 퍼지는 원. 잠시 뒤 사라진다 */
function CursorDot({ slot }: { slot: Slot }) {
  const cursor = useCursors((s) => s.cursors[slot]);
  const browsing = useStore((s) => slot !== 'search' && (s.vendorStatus[slot] === 'browsing' || s.vendorStatus[slot] === 'parsing'));
  const [, tick] = useState(0);
  useEffect(() => {
    if (!cursor) return;
    const t = setTimeout(() => tick((n) => n + 1), CURSOR_MS + 50);
    return () => clearTimeout(t);
  }, [cursor]);
  if (!cursor || (!browsing && Date.now() - cursor.at > CURSOR_MS)) return null;
  return (
    <div className="pointer-events-none absolute z-10 transition-all duration-300 ease-out" style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }}>
      <span className="absolute -left-2.5 -top-2.5 block size-5 rounded-full border-[3px] border-white bg-blue-500 shadow-[0_2px_10px_rgba(0,0,0,0.4)]" />
      {cursor.click && <span key={cursor.at} className="absolute -left-2.5 -top-2.5 block size-5 animate-ping rounded-full border-[3px] border-blue-500" />}
      <span className="absolute left-3 top-3 rounded bg-blue-600 px-1.5 py-[3px] text-[10px] font-bold leading-none text-white">AI</span>
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

