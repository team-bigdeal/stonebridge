// 슬롯별 브라우저 드라이버 관리. 기본은 Aside(사용자의 실제 브라우저), 없거나 설정에서 고르면 앱 안 내장 브라우저.
import { BrowserWindow, nativeImage } from 'electron';
import type { BrowserInput, BrowserState, Slot } from '@shared/types';
import { emit, send } from '../events';
import { AsideDriver } from './aside';
import type { BrowserDriver } from './driver';
import { browserSession, ElectronDriver, type Rect } from './electron';
import { findAsideBin } from './mcp';

const drivers = new Map<Slot, BrowserDriver>();
const states = new Map<Slot, BrowserState>();
let backend: 'aside' | 'electron' | null = null;
let frameTimer: NodeJS.Timeout | null = null;
const capturing = new Set<Slot>();

/** 앱 시작 시 한 번: Aside가 실행 가능한지 확인 */
export async function detectBackend(): Promise<'aside' | 'electron'> {
  if (backend) return backend;
  // 설정의 BROWSER_BACKEND=electron 이면 Aside가 있어도 내장 브라우저
  const pref = (process.env.DOLDARI_BROWSER || process.env.BROWSER_BACKEND || 'auto').toLowerCase();
  const bin = pref === 'electron' ? null : findAsideBin();
  if (bin) {
    const probe = new AsideDriver('search', bin);
    try {
      const ok = await Promise.race([probe.ping(), new Promise<boolean>((r) => setTimeout(() => r(false), 15000))]);
      if (ok) {
        backend = 'aside';
        drivers.set('search', probe);
        startFrames();
        return backend;
      }
    } catch {
      /* Electron으로 대체 */
    }
    probe.close().catch(() => undefined);
  }
  backend = 'electron';
  return backend;
}

export const getBackend = () => backend;

export function getDriver(slot: Slot): BrowserDriver {
  let d = drivers.get(slot);
  if (!d) {
    const bin = findAsideBin();
    d = backend === 'aside' && bin ? new AsideDriver(slot, bin) : new ElectronDriver(slot);
    drivers.set(slot, d);
  }
  return d;
}

/** Aside 탭은 스크린샷을 주기적으로 받아 카드에 보낸다 */
function startFrames() {
  if (frameTimer) return;
  frameTimer = setInterval(() => {
    for (const [slot, d] of drivers) {
      if (d.kind !== 'aside' || capturing.has(slot)) continue;
      capturing.add(slot);
      void d
        .screenshot()
        .then((buf) => {
          if (!buf) return;
          const img = nativeImage.createFromBuffer(buf);
          const out = img.getSize().width > 1200 ? img.resize({ width: 1200 }) : img;
          send('browser:frame', { slot, data: `data:image/jpeg;base64,${out.toJPEG(62).toString('base64')}` });
        })
        .finally(() => capturing.delete(slot));
    }
  }, 450);
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
  const d = drivers.get(slot) ?? (backend === 'electron' ? getDriver(slot) : undefined);
  if (!(d instanceof ElectronDriver)) return;
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

export async function userInput(input: BrowserInput) {
  await getDriver(input.slot).userInput(input);
  setTimeout(() => void refreshState(input.slot), 600);
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
  if (frameTimer) clearInterval(frameTimer);
  frameTimer = null;
  await Promise.all([...drivers.values()].map((d) => d.close().catch(() => undefined)));
  drivers.clear();
}

/** 설정에서 브라우저를 바꾸면 재시작 없이 바로 적용: 기존 브라우저(Aside 탭 포함)를 닫고 다시 고른다 */
export async function switchBackend(): Promise<'aside' | 'electron'> {
  await closeAll();
  for (const slot of states.keys()) emit('browser', { payload: { slot, url: '', title: '', locked: false } });
  states.clear();
  backend = null;
  return detectBackend();
}
