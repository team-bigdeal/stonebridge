// 에이전트 커서는 페이지에 주입하지 않고 앱 레이어에서 그린다.
// 좌표는 페이지 뷰포트 기준 0~1로 정규화해 보낸다 (Aside 화면 이미지·내장 브라우저 공용).
import type { Slot } from '@shared/types';
import { sleep } from '../config';
import { send } from '../events';

export interface CursorEvent {
  slot: Slot;
  x: number;
  y: number;
  click?: boolean;
}

type Listener = (e: CursorEvent) => void;
const listeners = new Set<Listener>();
/** 내장 브라우저는 앱 창 위에 작은 커서 뷰를 직접 움직인다 */
export const onCursor = (l: Listener) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** 커서 이동 (뷰포트 좌표 x, y와 뷰포트 크기) */
export async function cursorTo(slot: Slot, x: number, y: number, vw: number, vh: number, click = false) {
  if (!vw || !vh) return;
  const e: CursorEvent = { slot, x: Math.max(0, Math.min(1, x / vw)), y: Math.max(0, Math.min(1, y / vh)), click };
  send('browser:cursor', e);
  for (const l of listeners) l(e);
  await sleep(click ? 180 : 320);
}
