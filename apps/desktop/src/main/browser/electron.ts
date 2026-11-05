// 내장 브라우저 드라이버: 앱 창 안에 보이는 WebContentsView. 사용자가 직접 보고 쓰는 브라우저와 같은 방식으로 동작한다.
// 화면 위치는 renderer의 카드 자리(placeholder)를 따라가고, 에이전트 커서는 페이지가 아니라 앱 레이어(작은 커서 뷰)에 그린다.
import { session as electronSession, WebContentsView } from 'electron';
import type { Slot } from '@shared/types';
import { CdpSession } from '../cdp/session';
import * as act from '../cdp/actions';
import { takeSnapshot } from '../cdp/snapshot';
import { getWindow, send } from '../events';
import { onCursor } from './cursor';
import type { BrowserDriver } from './driver';

export const BROWSER_PARTITION = 'persist:doldari-browser';
let sessionReady = false;

/** 사용자가 "브라우저 로그인"으로 로그인한 쿠키가 남는 세션 */
export function browserSession() {
  const ses = electronSession.fromPartition(BROWSER_PARTITION);
  if (!sessionReady) {
    sessionReady = true;
    // 위치·알림·카메라 등 권한 요청은 모두 거부
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  }
  return ses;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const CURSOR_HTML = `<!doctype html><html><body style="margin:0;overflow:hidden;background:transparent">
<div id="c" style="position:absolute;left:20px;top:20px;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;background:rgba(59,130,246,.95);border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.4)"></div>
<div id="t" style="position:absolute;left:34px;top:32px;background:#2563eb;color:#fff;font:700 10px/1 sans-serif;padding:3px 5px;border-radius:4px">AI</div>
<div id="r" style="position:absolute;left:20px;top:20px;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:3px solid #3b82f6;opacity:0"></div>
<script>window.ring=()=>{const r=document.getElementById('r');r.animate([{transform:'scale(1)',opacity:1},{transform:'scale(3.2)',opacity:0}],{duration:450,easing:'ease-out'})}</script>
</body></html>`;
const CURSOR_BOX = 64;
/** 페이지는 항상 이 너비(CSS px)로 배치한다. 카드가 작으면 축소해서 보여 줘 데스크톱 화면 비율을 유지하고,
 *  카드가 보이든 숨든 같은 배치라 에이전트가 읽는 화면도 같다 */
const LAYOUT_WIDTH = 1100;

export class ElectronDriver implements BrowserDriver {
  readonly kind = 'electron' as const;
  readonly view: WebContentsView;
  private cursorView: WebContentsView;
  private cdp: CdpSession;
  private bounds: Rect | null = null;
  private frameTimer: NodeJS.Timeout | null = null;
  private cursorTimer: NodeJS.Timeout | null = null;
  private offCursor: () => void;

  constructor(readonly slot: Slot) {
    // disableDialogs: 사이트의 alert/confirm 창이 앱 창 전체를 덮지 않게 한다 (alert는 확인, confirm은 취소로 처리됨)
    this.view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, disableDialogs: true, session: browserSession() } });
    this.view.setBorderRadius?.(8);
    this.view.setVisible(false);
    // 화면에 붙기 전에도 페이지가 정상 크기로 배치되도록 기본 크기
    this.view.setBounds({ x: 0, y: 0, width: LAYOUT_WIDTH, height: 700 });
    this.cursorView = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true } });
    this.cursorView.setBackgroundColor('#00000000');
    this.cursorView.setVisible(false);
    void this.cursorView.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(CURSOR_HTML)}`);

    const win = getWindow();
    win?.contentView.addChildView(this.view);
    win?.contentView.addChildView(this.cursorView);

    const wc = this.view.webContents;
    this.cdp = new CdpSession(slot, wc);
    // 새 창 링크는 같은 뷰에서 연다. mailto 등 외부 프로토콜은 열지 않는다.
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void wc.loadURL(url);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (e, url) => {
      if (!/^(https?|data|about):/.test(url)) e.preventDefault();
    });
    wc.on('did-stop-loading', () => void this.captureFrame());
    // 확대 배율은 사이트(origin)마다 따로 저장되므로 이동할 때마다 다시 맞춘다
    wc.on('did-navigate', () => this.applyZoom());
    wc.on('did-navigate-in-page', () => this.applyZoom());
    void wc.loadURL('about:blank').then(() => this.cdp.init());

    this.offCursor = onCursor((e) => {
      if (e.slot === this.slot) this.moveCursor(e.x, e.y, Boolean(e.click));
    });
  }

  /** renderer가 알려 준 카드 자리. null이면 숨기고 마지막 화면 이미지를 카드에 남긴다 */
  async setBounds(rect: Rect | null) {
    if (!rect) {
      if (this.bounds) await this.captureFrame();
      this.bounds = null;
      this.view.setVisible(false);
      // 숨은 동안에도 같은 배치로 계속 일하도록 기본 크기로 되돌린다
      this.view.setBounds({ x: 0, y: 0, width: LAYOUT_WIDTH, height: 700 });
      this.applyZoom();
      this.cursorView.setVisible(false);
      if (this.frameTimer) clearInterval(this.frameTimer);
      this.frameTimer = null;
      return;
    }
    this.bounds = rect;
    this.view.setBounds(rect);
    this.applyZoom();
    this.view.setVisible(true);
    // 위로 올려 앱 화면보다 앞에 보이게 (커서 뷰는 그 위)
    const win = getWindow();
    win?.contentView.addChildView(this.view);
    win?.contentView.addChildView(this.cursorView);
    this.frameTimer ??= setInterval(() => void this.captureFrame(), 2000);
  }

  private applyZoom() {
    const wc = this.view.webContents;
    if (wc.isDestroyed()) return;
    const width = this.view.getBounds().width || LAYOUT_WIDTH;
    const z = Math.min(1, width / LAYOUT_WIDTH);
    if (Math.abs(wc.getZoomFactor() - z) > 0.001) wc.setZoomFactor(z);
  }

  /** 카드가 화면 밖일 때 보여 줄 썸네일 */
  private async captureFrame() {
    if (this.view.webContents.isDestroyed() || !this.view.getVisible()) return;
    const img = await this.view.webContents.capturePage().catch(() => null);
    if (!img || img.isEmpty()) return;
    const out = img.getSize().width > 1100 ? img.resize({ width: 1100 }) : img;
    send('browser:frame', { slot: this.slot, data: `data:image/jpeg;base64,${out.toJPEG(65).toString('base64')}` });
  }

  private moveCursor(nx: number, ny: number, click: boolean) {
    if (!this.bounds) return;
    // 커서 원의 중심이 뷰 안 (20, 20)에 있다
    const x = Math.round(this.bounds.x + nx * this.bounds.width - 20);
    const y = Math.round(this.bounds.y + ny * this.bounds.height - 20);
    this.cursorView.setBounds({ x, y, width: CURSOR_BOX, height: CURSOR_BOX });
    this.cursorView.setVisible(true);
    if (click) void this.cursorView.webContents.executeJavaScript('window.ring && window.ring()').catch(() => undefined);
    // 잠시 뒤 숨겨서 사용자의 클릭을 가리지 않게
    if (this.cursorTimer) clearTimeout(this.cursorTimer);
    this.cursorTimer = setTimeout(() => this.cursorView.setVisible(false), 1800);
  }

  get locked() {
    return this.cdp.locked;
  }
  set locked(v: boolean) {
    this.cdp.locked = v;
  }

  navigate(url: string) {
    return act.navigate(this.cdp, url);
  }
  snapshot() {
    return takeSnapshot(this.cdp);
  }
  click(ref: string) {
    return act.click(this.cdp, Number(String(ref).replace(/\D/g, '')));
  }
  fill(ref: string, text: string) {
    return act.fill(this.cdp, Number(String(ref).replace(/\D/g, '')), text);
  }
  async selectOption(ref: string, option: string) {
    if (this.cdp.locked) throw new Error('handoff 이후에는 조작할 수 없습니다.');
    const id = this.cdp.refs.get(Number(String(ref).replace(/\D/g, '')));
    if (!id) throw new Error(`ref=${ref}를 찾을 수 없습니다. snapshot을 다시 찍으세요.`);
    const ok = await this.cdp.callOn<boolean>(
      id,
      `function () { const v = ${JSON.stringify(option)}; const o = [...(this.options || [])].find((o) => o.text.trim() === v || o.value === v); if (!o) return false; this.value = o.value; this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true })); return true; }`
    );
    if (!ok) throw new Error(`"${option}" 옵션이 없습니다.`);
    await new Promise((r) => setTimeout(r, 800));
    return `옵션 선택 완료: ${option}. read_text로 다시 계산된 금액을 확인하세요.`;
  }
  evaluate<T>(expression: string) {
    return this.cdp.evaluate<T>(expression);
  }
  async screenshot() {
    const img = await this.view.webContents.capturePage().catch(() => null);
    return img && !img.isEmpty() ? img.toJPEG(70) : null;
  }
  async url() {
    return this.view.webContents.isDestroyed() ? '' : this.view.webContents.getURL();
  }
  async title() {
    return this.view.webContents.isDestroyed() ? '' : this.view.webContents.getTitle();
  }
  async back() {
    const h = this.view.webContents.navigationHistory;
    if (h.canGoBack()) h.goBack();
  }
  /** 내장 브라우저는 사용자가 뷰를 직접 조작하므로 카드 이미지 입력은 쓰지 않는다 */
  async userInput() {}
  async reset() {
    this.cdp.reset();
    if (!this.view.webContents.isDestroyed()) await this.view.webContents.loadURL('about:blank');
  }
  async close() {
    this.offCursor();
    if (this.frameTimer) clearInterval(this.frameTimer);
    const win = getWindow();
    win?.contentView.removeChildView(this.view);
    win?.contentView.removeChildView(this.cursorView);
    this.view.webContents.close();
    this.cursorView.webContents.close();
  }
}
