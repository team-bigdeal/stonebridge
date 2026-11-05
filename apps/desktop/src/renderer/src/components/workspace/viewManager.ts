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

function tick() {
  const st = useStore.getState();
  const dialog = Boolean(st.viewer || st.settingsOpen || st.historyOpen);
  for (const slot of new Set<Slot>([...mounts.keys(), ...sent.keys()])) {
    const m = pick(slot);
    let rect: { x: number; y: number; width: number; height: number } | null = null;
    if (m && !dialog && m.el.isConnected) {
      const r = m.el.getBoundingClientRect();
      const clipEl = m.prio > 1 ? null : m.el.closest('[role="log"]');
      const clip = clipEl ? clipEl.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      const fully = r.width > 40 && r.height > 40 && r.top >= clip.top - 1 && r.bottom <= clip.bottom + 1;
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

function start() {
  if (!raf) raf = requestAnimationFrame(tick);
}
