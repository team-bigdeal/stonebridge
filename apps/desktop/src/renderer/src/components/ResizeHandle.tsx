// 사이드바 경계: 마우스를 올리면 파란 선이 보이고, 끌면 너비가 바뀐다 (두 번 누르면 처음 너비로)
import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export function ResizeHandle({
  side,
  width,
  range,
  onResize,
  onDone,
  onClose,
  onClosing,
  label
}: {
  /** 손잡이가 붙는 쪽: 왼쪽 사이드바는 오른쪽 끝(right), 오른쪽 패널은 왼쪽 끝(left) */
  side: 'left' | 'right';
  width: number;
  range: { min: number; max: number; init: number };
  onResize: (w: number) => void;
  onDone: (w: number) => void;
  /** 최소 너비보다 더 끌어서 놓으면 닫는다 */
  onClose?: () => void;
  /** 놓으면 닫힐 만큼 끌고 있는지 (미리 보기용) */
  onClosing?: (closing: boolean) => void;
  label: string;
}) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const clamp = (w: number) => Math.min(range.max, Math.max(range.min, w));
  // 최소 너비에서 이만큼 더 끌면 닫힌다
  const closeAt = range.min - 80;
  const raw = (x: number) => start.current!.w + (side === 'right' ? x - start.current!.x : start.current!.x - x);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      title="끌어서 너비 조절 · 끝까지 끌면 닫기 · 두 번 누르면 처음 너비"
      onPointerDown={(e) => {
        e.preventDefault();
        // 창 밖으로 끌어도 놓칠 때까지 따라오게
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* 캡처를 못 해도 끌기는 된다 */
        }
        start.current = { x: e.clientX, w: width };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const w = raw(e.clientX);
        onClosing?.(Boolean(onClose) && w < closeAt);
        onResize(clamp(w));
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        const w = raw(e.clientX);
        const startW = start.current.w;
        start.current = null;
        setDragging(false);
        onClosing?.(false);
        if (onClose && w < closeAt) {
          // 닫고, 다시 열 때는 끌기 전 너비로
          onResize(startW);
          onClose();
          return;
        }
        onDone(clamp(w));
      }}
      onPointerCancel={() => {
        start.current = null;
        setDragging(false);
        onClosing?.(false);
      }}
      onDoubleClick={() => {
        onResize(range.init);
        onDone(range.init);
      }}
      onKeyDown={(e) => {
        // 키보드로도 조절 (←·→ 10px)
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const grow = (e.key === 'ArrowRight') === (side === 'right');
        const w = clamp(width + (grow ? 10 : -10));
        onResize(w);
        onDone(w);
      }}
      className={cn(
        'group absolute inset-y-0 z-20 w-2 cursor-col-resize touch-none outline-none',
        side === 'right' ? '-right-1' : '-left-1'
      )}
    >
      <span
        className={cn(
          'pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100',
          dragging && 'opacity-100'
        )}
      />
    </div>
  );
}
