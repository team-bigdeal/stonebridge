// 내장 브라우저(WebContentsView)를 카드 자리에 맞춘다.
// 카드가 대화 영역 안에 완전히 보일 때만 뷰를 띄우고, 아니면 숨긴 뒤 마지막 화면 이미지를 카드에 남긴다.
import type { Slot } from '@shared/types';
import { create } from 'zustand';
import { useStore } from '@/store';

/** 지금 실제 브라우저 뷰가 카드 위에 떠 있는 슬롯 (그동안 카드의 썸네일은 그리지 않는다) */
export const useShownViews = create<{ shown: Partial<Record<Slot, boolean>> }>(() => ({ shown: {} }));

interface Mount {
  el: HTMLElement;
  prio: number;
  id: number;
}

const mounts = new Map<Slot, Mount[]>();
const sent = new Map<Slot, string>();
let nextId = 0;
let raf = 0;

export function registerView(slot: Slot, el: HTMLElement, prio: number) {
  const m: Mount = { el, prio, id: ++nextId };
  mounts.set(slot, [...(mounts.get(slot) ?? []), m]);
  start();
  return () => {
    mounts.set(slot, (mounts.get(slot) ?? []).filter((x) => x !== m));
  };
}

function pick(slot: Slot) {
  const list = mounts.get(slot) ?? [];
  return [...list].sort((a, b) => b.prio - a.prio || b.id - a.id)[0];
}

/** 실제 뷰를 붙일 최소 너비. 페이지는 1100px로 배치해 축소해 보여 주는데 Chromium 최소 배율이 0.25라,
 *  이보다 좁은 자리에 붙이면 사이트가 모바일 화면으로 바뀌어 에이전트가 버튼을 못 찾는다. 더 좁으면 캡처 화면만 보여 준다 */
const MIN_VIEW_WIDTH = 1100 * 0.25;

/** 스크롤하는 동안에는 실제 뷰를 떼고 화면 이미지를 보여 준다.
 *  실제 뷰는 앱 화면 위에 따로 떠 있어 스크롤을 한 박자 늦게 따라와 끊겨 보이고, 칸이 잘리는 순간 사라졌다 나타났다 한다.
 *  스크롤이 멈추면 바로 다시 붙인다 */
const SCROLL_IDLE_MS = 160;
let lastScroll = 0;
const onScroll = () => {
  lastScroll = performance.now();
};
if (typeof document !== 'undefined') {
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  document.addEventListener('wheel', onScroll, { capture: true, passive: true });
}

function tick() {
  const st = useStore.getState();
  // 지난 견적을 보는 중이면 실제 브라우저 뷰는 숨기고 저장된 화면만 보여 준다
  const dialog = Boolean(st.viewer || st.settingsOpen || st.replay);
  const scrolling = performance.now() - lastScroll < SCROLL_IDLE_MS;
  for (const slot of new Set<Slot>([...mounts.keys(), ...sent.keys()])) {
    const m = pick(slot);
    let rect: { x: number; y: number; width: number; height: number } | null = null;
    if (m && !dialog && !scrolling && m.el.isConnected) {
      const r = m.el.getBoundingClientRect();
      const clipEl = m.prio > 1 ? null : m.el.closest('[role="log"]');
      const clip = clipEl ? clipEl.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      const fully = r.width >= MIN_VIEW_WIDTH && r.height > 40 && r.top >= clip.top - 1 && r.bottom <= clip.bottom + 1;
      if (fully) rect = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
    }
    // 앱 화면 배율(⌘+/⌘-)이 바뀌면 같은 CSS 좌표라도 다시 보내야 하므로 devicePixelRatio도 키에 넣는다
    const key = `${JSON.stringify(rect)}@${window.devicePixelRatio}`;
    if (sent.get(slot) !== key) {
      sent.set(slot, key);
      window.doldari.setViewBounds(slot, rect);
      if (Boolean(useShownViews.getState().shown[slot]) !== Boolean(rect)) {
        useShownViews.setState((s) => ({ shown: { ...s.shown, [slot]: Boolean(rect) } }));
      }
    }
  }
  raf = requestAnimationFrame(tick);
}

/** 보는 견적 세션을 바꾼 뒤: 같은 자리라도 새 세션 뷰가 그 자리에 오도록 모두 다시 보낸다 */
export function resendViews() {
  sent.clear();
  start();
}

function start() {
  if (!raf) raf = requestAnimationFrame(tick);
}
