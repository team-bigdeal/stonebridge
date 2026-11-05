import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import type { Slot } from '@shared/types';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';
import { registerView, useShownViews } from './viewManager';
import { api } from '@/lib/api';

/** 프레임·커서는 자주 바뀌므로 메인 상태와 분리 */
export const useFrames = create<{ frames: Partial<Record<Slot, string>> }>(() => ({ frames: {} }));
export const pushFrame = (slot: Slot, data: string) => useFrames.setState((s) => ({ frames: { ...s.frames, [slot]: data } }));
interface Cursor {
  x: number;
  y: number;
  click?: boolean;
  at: number;
}
export const useCursors = create<{ cursors: Partial<Record<Slot, Cursor>> }>(() => ({ cursors: {} }));
export const pushCursor = (c: { slot: Slot; x: number; y: number; click?: boolean }) =>
  useCursors.setState((s) => ({ cursors: { ...s.cursors, [c.slot]: { x: c.x, y: c.y, click: c.click, at: Date.now() } } }));

/**
 * 브라우저 화면.
 * - 내장 브라우저: 실제 브라우저 뷰가 이 자리에 겹쳐 뜬다 (사용자가 그대로 클릭·입력). 카드가 화면 밖이면 마지막 화면 이미지.
 * - Aside: 탭 화면 이미지 + 앱 레이어 커서. 클릭·스크롤·타이핑은 그 탭으로 전달.
 */
export function LiveFrame({ slot, className, priority = 1 }: { slot: Slot; className?: string; priority?: number }) {
  const backend = useStore((s) => s.backend);
  const frame = useFrames((s) => s.frames[slot]);
  const ref = useRef<HTMLDivElement>(null);
  const replay = useStore((s) => Boolean(s.replay));
  const embedded = backend === 'electron' && !replay;
  const shown = useShownViews((s) => Boolean(s.shown[slot]));

  useEffect(() => {
    if (!embedded || !ref.current) return;
    return registerView(slot, ref.current, priority);
  }, [embedded, slot, priority]);

  if (replay) {
    // 지난 견적: 저장된 마지막 화면만
    return (
      <div className={cn('relative aspect-[16/10] w-full overflow-hidden rounded-lg bg-muted/40 ring-1 ring-border', className)}>
        {frame ? <img src={frame} alt="" draggable={false} className="h-full w-full select-none object-cover object-top" /> : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">저장된 화면이 없어요</div>}
      </div>
    );
  }
  if (embedded) {
    return (
      <div ref={ref} className={cn('relative aspect-[16/10] w-full overflow-hidden rounded-lg bg-muted/40 ring-1 ring-border', className)}>
        {shown ? null : frame ? <img src={frame} alt="" draggable={false} className="h-full w-full select-none object-cover object-top opacity-80" /> : <Placeholder />}
      </div>
    );
  }
  return <ImageFrame slot={slot} className={className} frame={frame} />;
}

function Placeholder() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
      <span className="size-4 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-transparent" />
      브라우저를 여는 중
    </div>
  );
}

function ImageFrame({ slot, className, frame }: { slot: Slot; className?: string; frame?: string }) {
  const cursor = useCursors((s) => s.cursors[slot]);
  const [focused, setFocused] = useState(false);
  const [, force] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const pos = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  // 커서는 잠시 뒤 사라진다
  useEffect(() => {
    if (!cursor) return;
    const t = setTimeout(() => force((n) => n + 1), 1900);
    return () => clearTimeout(t);
  }, [cursor]);
  const showCursor = cursor && Date.now() - cursor.at < 1800;

  return (
    <div
      ref={ref}
      tabIndex={0}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onClick={(e) => void api.browserInput({ slot, type: 'click', ...pos(e) })}
      onWheel={(e) => void api.browserInput({ slot, type: 'wheel', ...pos(e), deltaY: e.deltaY })}
      onKeyDown={(e) => {
        if (e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        if (e.key.length === 1) void api.browserInput({ slot, type: 'text', text: e.key });
        else void api.browserInput({ slot, type: 'key', key: e.key });
      }}
      onPaste={(e) => {
        const text = e.clipboardData.getData('text');
        if (text) void api.browserInput({ slot, type: 'text', text });
      }}
      className={cn('relative aspect-[16/10] w-full cursor-pointer overflow-hidden rounded-lg bg-muted/40 outline-none ring-1 transition', focused ? 'ring-primary' : 'ring-border', className)}
    >
      {frame ? <img src={frame} alt="" draggable={false} className="h-full w-full select-none object-cover object-top" /> : <Placeholder />}
      {showCursor && (
        <div
          className="pointer-events-none absolute transition-all duration-300 ease-out"
          style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }}
        >
          <span className="absolute -left-2 -top-2 block size-4 rounded-full border-2 border-white bg-primary shadow-md" />
          {cursor.click && <span key={cursor.at} className="absolute -left-2 -top-2 block size-4 animate-ping rounded-full border-[3px] border-primary" />}
          <span className="absolute left-3 top-3 whitespace-nowrap rounded bg-primary px-1.5 py-px text-[10px] font-semibold text-primary-foreground">돌다리</span>
        </div>
      )}
      {focused && <div className="pointer-events-none absolute right-2 top-2 rounded-md bg-background/90 px-2 py-1 text-[11px] font-medium text-foreground ring-1 ring-border">직접 조작 중 · 바깥을 누르면 끝나요</div>}
    </div>
  );
}
