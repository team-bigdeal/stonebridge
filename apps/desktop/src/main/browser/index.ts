// 슬롯별 브라우저 드라이버 관리. 브라우저는 앱 안 내장 브라우저(Electron WebContentsView) 하나만 쓴다.
import { BrowserWindow } from 'electron';
import type { BrowserState, Slot } from '@shared/types';
import { emit } from '../events';
import type { BrowserDriver } from './driver';
import { browserSession, ElectronDriver, type Rect } from './electron';

const drivers = new Map<Slot, ElectronDriver>();
const states = new Map<Slot, BrowserState>();

export function getDriver(slot: Slot): BrowserDriver {
  let d = drivers.get(slot);
  if (!d) {
    d = new ElectronDriver(slot);
    drivers.set(slot, d);
  }
  return d;
}

/** 주소·제목·handoff 상태를 카드에 반영 */
export async function refreshState(slot: Slot, patch: Partial<BrowserState> = {}) {
  const d = getDriver(slot);
  const prev = states.get(slot) ?? { slot, url: '', title: '', locked: false };
  const [url, title] = await Promise.all([d.url().catch(() => prev.url), d.title().catch(() => prev.title)]);
  const next: BrowserState = { ...prev, url, title, locked: d.locked, ...patch };
  states.set(slot, next);
  emit('browser', { payload: next });
}

/** 사용자에게 넘김 (안내는 앱 화면에 표시하고 페이지는 건드리지 않는다) */
export async function setHandoff(slot: Slot, reason: string | undefined) {
  const d = getDriver(slot);
  d.locked = Boolean(reason);
  await refreshState(slot, { handoff: reason, locked: Boolean(reason) });
}

/** renderer 카드 자리에 내장 브라우저 뷰를 맞춘다 */
/** renderer가 보낸 카드 자리(CSS px)를 창 좌표(DIP)로 바꿔 뷰를 맞춘다. 앱 화면이 ⌘+/⌘-로 확대·축소돼 있으면 그 배율을 곱한다 */
export function setViewBounds(slot: Slot, rect: Rect | null, zoom = 1) {
  const d = drivers.get(slot) ?? (getDriver(slot) as ElectronDriver);
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  void d.setBounds(
    rect && { x: Math.round(rect.x * z), y: Math.round(rect.y * z), width: Math.round(rect.width * z), height: Math.round(rect.height * z) }
  );
}

/** 내장 브라우저 세션에 사용자가 직접 로그인하는 창 (쿠키가 에이전트 브라우저와 공유된다) */
export function openLoginWindow(url: string) {
  const target = /^https?:\/\//.test(url) ? url : 'https://www.naver.com';
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    title: '돌다리 브라우저 로그인 — 로그인을 마치면 이 창을 닫으세요',
    webPreferences: { sandbox: true, contextIsolation: true, session: browserSession() }
  });
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https?:/.test(u)) void win.webContents.loadURL(u);
    return { action: 'deny' };
  });
  win.on('page-title-updated', (e) => e.preventDefault());
  void win.loadURL(target);
}

export async function goBack(slot: Slot) {
  await getDriver(slot).back();
  await refreshState(slot);
}

export async function resetAll() {
  // 하나씩 기다리면 조건 변경 뒤 새 검색 시작이 늦어지므로 동시에 정리한다
  await Promise.all(
    [...drivers].map(async ([slot, d]) => {
      await d.reset();
      states.delete(slot);
      emit('browser', { payload: { slot, url: '', title: '', locked: false } });
    })
  );
}

export async function closeAll() {
  await Promise.all([...drivers.values()].map((d) => d.close().catch(() => undefined)));
  drivers.clear();
}
