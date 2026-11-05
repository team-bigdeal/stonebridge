// 내장 브라우저 드라이버: 앱 창 안에 보이는 WebContentsView. 사용자가 직접 보고 쓰는 브라우저와 같은 방식으로 동작한다.
// 화면 위치는 renderer의 카드 자리(placeholder)를 따라가고, 에이전트 커서는 페이지가 아니라 앱 레이어(작은 커서 뷰)에 그린다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app, session as electronSession, WebContentsView, type BrowserWindow, type DownloadItem, type WebContents } from 'electron';
import type { Slot } from '@shared/types';
import { CdpSession } from '../cdp/session';
import * as act from '../cdp/actions';
import { takeSnapshot } from '../cdp/snapshot';
import { getWindow, send } from '../events';
import { quoteRequesterName, sleep } from '../config';
import { onCursor } from './cursor';
import { guardFocus } from './focus';
import { type BrowserDriver, ToolError } from './driver';
import { looksLikeQuote, QUOTE_FORM_CHECK, QUOTE_ISSUE_RE, type QuoteFormCheck } from './guard';
import { checkPdf, MAX_PDF_BYTES, pdfName, showingPdf, type PdfFile } from './pdf';

export const BROWSER_PARTITION = 'persist:doldari-browser';
let sessionReady = false;

/** 사용자가 "브라우저 로그인"으로 로그인한 쿠키가 남는 세션 */
export function browserSession() {
  const ses = electronSession.fromPartition(BROWSER_PARTITION);
  if (!sessionReady) {
    sessionReady = true;
    // 위치·알림·카메라 등 권한 요청은 모두 거부
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    // User-Agent에서 앱 이름(doldari-desktop/1.0.0, StoneBridge/1.0.0)만 뺀다. 이 낱말 때문에 브라우저 판별이 틀려
    // 모바일 페이지로 보내는 사이트가 있다(와우프레스). Chrome·Electron 표기는 그대로 둔다 (자동화를 숨기려는 게 아님)
    ses.setUserAgent(ses.getUserAgent().replace(new RegExp(`\\s*${app.getName().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[\\d.]+`, 'i'), ''));
    // 다운로드: 에이전트가 가견적서를 기다리는 중인 PDF만 받고, 나머지(실행 파일 등)는 모두 취소
    ses.on('will-download', (_e, item, wc) => handleDownload(item, wc));
  }
  return ses;
}

type DownloadResult = PdfFile | { error: string };
/** webContents id → 가견적서 PDF를 기다리는 중인 드라이버 */
const downloadWaiters = new Map<number, (r: DownloadResult) => void>();

function handleDownload(item: DownloadItem, wc: WebContents | undefined) {
  const waiter = wc ? downloadWaiters.get(wc.id) : undefined;
  const name = item.getFilename();
  const pdf = /pdf/i.test(item.getMimeType()) || /\.pdf$/i.test(name);
  if (!waiter || !pdf) {
    item.cancel();
    if (waiter) waiter({ error: `PDF가 아닌 파일(${name})이라 받지 않았습니다.` });
    return;
  }
  if (item.getTotalBytes() > MAX_PDF_BYTES) {
    item.cancel();
    waiter({ error: '파일이 너무 큽니다. 15MB 이하 PDF만 받습니다.' });
    return;
  }
  // 임시 폴더에 받았다가 읽고 바로 지운다 (열거나 실행하지 않음)
  const tmp = path.join(os.tmpdir(), `doldari-${randomUUID()}.pdf`);
  item.setSavePath(tmp);
  item.once('done', (_e, state) => {
    try {
      if (state !== 'completed') return waiter({ error: `다운로드가 끝나지 않았습니다 (${state}).` });
      const data = fs.readFileSync(tmp);
      try {
        waiter(checkPdf(data, item.getURL(), name));
      } catch (err) {
        waiter({ error: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });
}

/** 화면을 PDF로 저장하기 전에 그 화면이 견적서인지 본다 (상품 페이지를 통째로 PDF로 만들어 견적서처럼 쓰지 않게).
 *  "견적서"와 함께 견적서 양식에만 있는 말(아래와 같이 견적합니다·견적일·견적번호·공급자·귀하·유효기간)이 보여야 한다 */
/** 화면에 보이는 글자 (같은 출처 iframe 안 — 모달 안 견적서 등 — 포함) */
const VISIBLE_TEXT = `(() => {
  const parts = [document.body ? document.body.innerText : ''];
  for (const f of document.querySelectorAll('iframe')) {
    try {
      const r = f.getBoundingClientRect();
      if (r.width > 50 && r.height > 50 && f.contentDocument && f.contentDocument.body) parts.push(f.contentDocument.body.innerText);
    } catch (e) {}
  }
  return parts.join('\\n');
})()`;

/** 견적서 양식 글자인지: "견적서"와 견적서에만 있는 말(아래와 같이 견적합니다·견적일·견적번호·공급자·귀하·유효기간) */
const QUOTE_MARKS = [/아래와\s*같이\s*견적/, /견\s*적\s*일/, /견적\s*번호/, /공\s*급\s*자/, /귀\s*하/, /유효\s*기간/];
/** "견적서"와 견적서 항목 하나, 또는 (제목이 그림이라 "견적서" 글자가 없어도) 견적서 항목 두 개 이상 */
const isQuoteDocText = (text: string) => {
  const marks = QUOTE_MARKS.filter((re) => re.test(text)).length;
  return (/견\s*적\s*서/.test(text) && marks >= 1) || marks >= 2;
};

async function assertQuoteDoc(wc: WebContents, extra = '') {
  const text = (await wc.executeJavaScript(VISIBLE_TEXT).catch(() => '')) + '\n' + extra;
  // 견적서 양식 글자에 금액·품목표까지 있어야 견적서로 본다 (견적서 출력 양식·빈 화면 제외)
  const doc = isQuoteDocText(text) && looksLikeQuote(text);
  if (!doc) throw new ToolError('지금 화면은 견적서가 아닙니다 (상품 페이지를 PDF로 저장하지 않습니다). "견적서 출력" 버튼을 눌러 견적서 화면·창이 열렸을 때만 save_page_pdf를 쓰세요. 견적서를 받을 수 없으면 페이지의 가격으로 report_quote 하세요.');
}

/** 사이트의 인쇄 요청(window.print)은 인쇄 창을 띄우지 않고 표시만 남긴다. 그 화면을 printToPDF로 저장한다 */
const PRINT_HOOK = 'window.print = function () { window.__doldariPrint = Date.now(); };';
const PRINT_HOOK_ALL = `(() => { const hook = (w) => { try { w.print = function () { w.__doldariPrint = Date.now(); }; } catch (e) {} }; hook(window); for (const f of document.querySelectorAll('iframe')) hook(f.contentWindow); return true; })()`;
const PRINTED = `(() => { if (window.__doldariPrint) return true; for (const f of document.querySelectorAll('iframe')) { try { if (f.contentWindow.__doldariPrint) return true; } catch (e) {} } return false; })()`;

/** 신청자명을 넣고 누른 뒤 지금 화면이 견적서인지 (양식이 아직 떠 있으면 아니다).
 *  navigated: 다른 화면으로 넘어감, printed: 사이트가 인쇄하려 함 */
function quoteReady(s: { text: string; formShown: boolean; printed: boolean }, navigated: boolean) {
  if (!looksLikeQuote(s.text)) return false;
  return s.printed || (!s.formShown && navigated) || ((!s.formShown || navigated) && isQuoteDocText(s.text));
}

/** 팝업 페이지 안에서 실행. 페이지가 멈춰도 기다리기만 하지 않게 응답이 없거나 실패하면 null */
const jsIn = <T,>(wc: WebContents, code: string, ms = 4000) =>
  Promise.race([wc.executeJavaScript(code).catch(() => null) as Promise<T | null>, sleep(ms).then(() => null)]);

const safeDecode = (u: string) => {
  try {
    return decodeURIComponent(u);
  } catch {
    return u;
  }
};

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
/** 커서를 마지막 자리에 남겨 두는 시간 (움직일 때마다 다시 잼) */
const CURSOR_HOLD_MS = 10_000;
/** 페이지는 항상 이 너비(CSS px)로 배치한다. 카드가 작으면 축소해서 보여 줘 데스크톱 화면 비율을 유지하고,
 *  카드가 보이든 숨든 같은 배치라 에이전트가 읽는 화면도 같다 */
const LAYOUT_WIDTH = 1100;
/** Chromium이 허용하는 최소 확대 배율 */
const MIN_ZOOM = 0.25;
/** 카드가 화면 밖일 때 뷰를 두는 곳 (창 밖이라 보이지 않지만 입력·렌더링은 그대로) */
const OFFSCREEN = { x: -20000, y: 0, width: LAYOUT_WIDTH, height: 700 };
/** 견적서 팝업은 이 시간이 지나면 닫는다 */
const POPUP_TTL = 3 * 60 * 1000;

export class ElectronDriver implements BrowserDriver {
  readonly kind = 'electron' as const;
  readonly view: WebContentsView;
  private cursorView: WebContentsView;
  private cdp: CdpSession;
  private bounds: Rect | null = null;
  private frameTimer: NodeJS.Timeout | null = null;
  private cursorTimer: NodeJS.Timeout | null = null;
  private lastFrameAt = 0;
  private offCursor: () => void;
  /** 사이트가 window.open으로 띄운 견적서 팝업 (보이지 않는 창). 원래 창(opener)에서 값을 읽어 채우는 견적서가 있어 실제 창으로 연다 */
  private popup: { win: BrowserWindow; at: number; timer: NodeJS.Timeout } | null = null;

  constructor(readonly slot: Slot, readonly sid: string) {
    // disableDialogs: 사이트의 alert/confirm 창이 앱 창 전체를 덮지 않게 한다 (alert는 확인, confirm은 취소로 처리됨)
    this.view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, disableDialogs: true, session: browserSession() } });
    this.view.setBorderRadius?.(8);
    // 숨길 때도 setVisible(false)를 쓰지 않고 창 밖으로 옮긴다: 숨긴 뷰는 마우스·키 입력을 받지 않아
    // 카드가 화면 밖일 때 에이전트의 클릭이 조용히 사라지고 화면 캡처도 멈췄다
    this.view.setBounds(OFFSCREEN);
    this.cursorView = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true } });
    this.cursorView.setBackgroundColor('#00000000');
    this.cursorView.setVisible(false);
    void this.cursorView.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(CURSOR_HTML)}`);

    const win = getWindow();
    win?.contentView.addChildView(this.view);
    win?.contentView.addChildView(this.cursorView);

    const wc = this.view.webContents;
    // 뷰를 붙이거나 페이지를 불러올 때 채팅 입력창 포커스를 빼앗지 않게
    guardFocus(wc);
    guardFocus(this.cursorView.webContents);
    this.cdp = new CdpSession(slot, wc);
    // 새 창 링크는 같은 뷰에서 연다. mailto 등 외부 프로토콜은 열지 않는다.
    // 예외: 빈 창(window.open('', 이름))이나 POST 폼을 새 창으로 보내는 경우는 견적서·인쇄 팝업이 대부분이고
    // 팝업이 원래 창(opener)의 금액·옵션을 읽어 채우므로, 보이지 않는 실제 창으로 열어 둔다 (save_page_pdf로 저장)
    wc.setWindowOpenHandler(({ url, postBody }) => {
      // 견적서·인쇄 창 주소(estimate_print 등)도 원래 창(opener) 값을 읽어 채우는 곳이 많아 실제 팝업으로 연다 (성원애드피아)
      const quoteWindow = /^https?:/.test(url) && /estimat|print|quot|invoice|견적/i.test(decodeURIComponent(url));
      if (url === '' || url === 'about:blank' || (postBody && /^https?:/.test(url)) || quoteWindow) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            show: false,
            width: 970,
            height: 1200,
            webPreferences: { sandbox: true, contextIsolation: true, disableDialogs: true, backgroundThrottling: false }
          }
        };
      }
      if (/^https?:/.test(url)) void wc.loadURL(url);
      return { action: 'deny' };
    });
    wc.on('did-create-window', (win) => this.adoptPopup(win));
    wc.on('will-navigate', (e, url) => {
      if (!/^(https?|data|about):/.test(url)) e.preventDefault();
    });
    wc.on('did-stop-loading', () => void this.captureFrame());
    // 확대 배율은 사이트(origin)마다 따로 저장되므로 이동할 때마다 다시 맞춘다
    wc.on('did-navigate', () => this.applyZoom());
    wc.on('did-navigate-in-page', () => this.applyZoom());
    void wc.loadURL('about:blank').then(() => this.cdp.init());
    // 화면 캡처: 실제 뷰가 카드에 붙어 있으면 2초마다(썸네일·기록용), 안 붙어 있으면(나란히 보기의 좁은 칸·화면 밖) 카드에 보이는 화면이라 0.7초마다
    this.frameTimer = setInterval(() => {
      if (this.bounds && Date.now() - this.lastFrameAt < 2000) return;
      void this.captureFrame();
    }, 700);

    this.offCursor = onCursor((e) => {
      if (e.slot === this.slot && e.sid === this.sid) this.moveCursor(e.x, e.y, Boolean(e.click));
    });
  }

  /** renderer가 알려 준 카드 자리. null이면 창 밖으로 옮기고(입력·캡처는 계속) 카드에는 화면 이미지를 남긴다 */
  async setBounds(rect: Rect | null) {
    // 최소 배율(0.25)로도 1100px 배치를 지킬 수 없는 좁은 자리면 창 밖에서 일한다 (모바일 화면 방지)
    if (rect && rect.width < LAYOUT_WIDTH * MIN_ZOOM) rect = null;
    if (!rect) {
      if (this.bounds) await this.captureFrame();
      const last = this.bounds;
      this.bounds = null;
      // 창 밖에서도 같은 배치(1100px)로 계속 일한다. 마지막 크기를 그대로 두고 위치만 옮긴다:
      // 창 밖(가려진) 뷰는 Chromium이 화면 크기를 다시 계산하지 않아, 크기·배율을 바꾸면
      // 작은 카드 크기에 배율 1이 걸려 사이트가 모바일 화면(309px)으로 바뀌었다
      this.view.setBounds(last ? { ...OFFSCREEN, width: last.width, height: last.height } : OFFSCREEN);
      this.applyZoom();
      this.cursorView.setVisible(false);
      return;
    }
    const prev = this.bounds;
    const raise = !prev || prev.width !== rect.width || prev.height !== rect.height;
    this.bounds = rect;
    this.view.setBounds(rect);
    this.applyZoom();
    // 위로 올려 앱 화면보다 앞에 보이게 (커서 뷰는 그 위).
    // 뷰를 다시 붙이면 키보드 포커스를 가져가 채팅 입력이 끊기므로, 스크롤로 위치만 바뀔 때는 하지 않고
    // 다시 보이거나 크기가 바뀔 때(크게 보기)만 하되 그 전에 앱 화면에 있던 포커스는 돌려준다
    if (raise) {
      const win = getWindow();
      const keepFocus = win?.webContents.isFocused();
      win?.contentView.addChildView(this.view);
      win?.contentView.addChildView(this.cursorView);
      if (keepFocus) win?.webContents.focus();
    }
  }

  private applyZoom() {
    const wc = this.view.webContents;
    if (wc.isDestroyed()) return;
    const width = this.view.getBounds().width || LAYOUT_WIDTH;
    const z = Math.min(1, width / LAYOUT_WIDTH);
    if (Math.abs(wc.getZoomFactor() - z) > 0.001) wc.setZoomFactor(z);
  }

  /** 카드가 화면 밖일 때 보여 줄 썸네일 (창 밖에 있어도 계속 찍는다 → 히스토리에도 화면이 남음) */
  private async captureFrame() {
    if (this.view.webContents.isDestroyed() || !/^https?:/.test(this.view.webContents.getURL())) return;
    const img = await this.view.webContents.capturePage().catch(() => null);
    if (!img || img.isEmpty()) return;
    this.lastFrameAt = Date.now();
    const out = img.getSize().width > 1100 ? img.resize({ width: 1100 }) : img;
    send('browser:frame', { sid: this.sid, slot: this.slot, data: `data:image/jpeg;base64,${out.toJPEG(65).toString('base64')}` });
  }

  private moveCursor(nx: number, ny: number, click: boolean) {
    // 실제 뷰가 카드에 없으면 앱 화면이 이미지 위에 커서를 그린다. 클릭 뒤 바뀐 화면이 바로 보이게 한 번 더 찍는다
    if (!this.bounds) {
      if (click) setTimeout(() => void this.captureFrame(), 450);
      return;
    }
    // 커서 원의 중심이 뷰 안 (20, 20)에 있다
    const x = Math.round(this.bounds.x + nx * this.bounds.width - 20);
    const y = Math.round(this.bounds.y + ny * this.bounds.height - 20);
    this.cursorView.setBounds({ x, y, width: CURSOR_BOX, height: CURSOR_BOX });
    this.cursorView.setVisible(true);
    if (click) void this.cursorView.webContents.executeJavaScript('window.ring && window.ring()').catch(() => undefined);
    // 탐색하는 동안은 마지막 자리에 남겨 두고(다음 동작까지 몇 초씩 걸림), 한동안 움직임이 없으면 숨겨 사용자의 클릭을 가리지 않게
    if (this.cursorTimer) clearTimeout(this.cursorTimer);
    this.cursorTimer = setTimeout(() => this.cursorView.setVisible(false), CURSOR_HOLD_MS);
  }

  private adoptPopup(win: BrowserWindow) {
    this.closePopup();
    const pwc = win.webContents;
    guardFocus(pwc);
    // 팝업 안에서는 또 다른 창이나 외부 프로토콜을 열지 않는다
    pwc.setWindowOpenHandler(() => ({ action: 'deny' }));
    pwc.on('will-navigate', (e, url) => {
      if (!/^(https?|about):/.test(url)) e.preventDefault();
    });
    // window.print()가 인쇄 대화상자를 띄우지 않게 (인쇄하려 했다는 표시만 남긴다).
    // 다음 문서(양식 → 견적서)부터는 문서가 시작될 때 바꾼다: dom-ready는 load 때 부르는 print보다 늦을 수 있다
    pwc.on('dom-ready', () => void pwc.executeJavaScript(PRINT_HOOK).catch(() => undefined));
    try {
      pwc.debugger.attach('1.3');
      void pwc.debugger
        .sendCommand('Page.enable')
        .then(() => pwc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: PRINT_HOOK }))
        .catch(() => undefined);
    } catch {
      /* 붙지 못하면 dom-ready 때만 바꾼다 */
    }
    const timer = setTimeout(() => this.closePopup(), POPUP_TTL);
    this.popup = { win, at: Date.now(), timer };
    win.on('closed', () => {
      if (this.popup?.win === win) {
        clearTimeout(this.popup.timer);
        this.popup = null;
      }
    });
  }

  private closePopup() {
    const p = this.popup;
    this.popup = null;
    if (!p) return;
    clearTimeout(p.timer);
    if (!p.win.isDestroyed()) p.win.destroy();
  }

  /** 열린 견적서 팝업이 내용을 다 불러왔으면 그 창. http 페이지이거나, 빈 창에 스크립트가 내용을 써 넣은 경우 */
  private async readyPopup(since = 0): Promise<BrowserWindow | null> {
    const p = this.popup;
    if (!p || p.at < since || p.win.isDestroyed()) return null;
    const pwc = p.win.webContents;
    if (pwc.isLoading()) return null;
    if (/^https?:/.test(pwc.getURL())) return p.win;
    const len = await pwc.executeJavaScript('(document.body && document.body.innerText || "").trim().length').catch(() => 0);
    return Number(len) > 30 ? p.win : null;
  }

  /** 팝업을 PDF로 저장하고 닫는다 (팝업 스크립트가 값을 채울 시간을 잠깐 준다) */
  private async printPopup(win: BrowserWindow): Promise<PdfFile> {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const pwc = win.webContents;
      // 견적서가 아니라 신청자명만 묻는 견적서 출력 양식이면 이름을 넣고 다음을 눌러 나온 견적서를 받는다 (대구판촉물)
      const text = (await jsIn<string>(pwc, VISIBLE_TEXT)) ?? '';
      if (!(isQuoteDocText(text) && looksLikeQuote(text))) {
        const trigger = act.recentTrigger(this.cdp);
        const form = await jsIn<QuoteFormCheck>(pwc, `(${QUOTE_FORM_CHECK})(document, ${JSON.stringify(trigger)})`);
        if (form?.ok) return await this.submitPopupForm(win, trigger);
        if (form?.found && form.context) throw new ToolError(act.quoteFormRefusal(form));
      }
      await assertQuoteDoc(pwc);
      return await this.savePopup(win);
    } finally {
      if (this.popup?.win === win) this.closePopup();
    }
  }

  private async savePopup(win: BrowserWindow): Promise<PdfFile> {
    const pwc = win.webContents;
    const data = await pwc.printToPDF({ printBackground: true, pageSize: 'A4' });
    // 빈 창에 써 넣은 견적서는 주소가 about:blank라 원래 페이지 주소를 출처로 남긴다
    const url = /^https?:/.test(pwc.getURL()) ? pwc.getURL() : this.view.webContents.getURL();
    return checkPdf(Buffer.from(data), url, pdfName('', pwc.getTitle() || `${new URL(url).hostname.replace(/^www\./, '')} 견적서`));
  }

  /** 팝업(보이지 않는 창)의 견적서 신청자명 양식: 이름을 넣고 다음을 눌러 나온 견적서(PDF·인쇄용 화면)를 받는다.
   *  팝업은 커서·스냅샷이 없어 페이지 안에서 넣고 누르되, 누르기 직전에 같은 판정을 다시 한다 */
  private async submitPopupForm(win: BrowserWindow, trigger: string): Promise<PdfFile> {
    const pwc = win.webContents;
    const before = pwc.getURL();
    const name = quoteRequesterName();
    const got = new Promise<DownloadResult>((resolve) => downloadWaiters.set(pwc.id, resolve));
    const js = <T,>(code: string) => jsIn<T>(pwc, code);
    try {
      const q = await js<QuoteFormCheck>(`(() => {
        const check = ${QUOTE_FORM_CHECK};
        const trigger = ${JSON.stringify(trigger)};
        const r = check(document, trigger);
        if (!r.ok) return r;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        for (const e of document.querySelectorAll('[data-doldari-qname]')) {
          e.focus();
          setter.call(e, ${JSON.stringify(name)});
          e.dispatchEvent(new Event('input', { bubbles: true }));
          e.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const b = document.querySelector('[data-doldari-qnext]');
        const again = b ? check(b, trigger) : r;
        if (!b || !again.ok) return Object.assign({}, again, { ok: false });
        ${PRINT_HOOK}
        b.click();
        return again;
      })()`);
      if (!q?.ok) throw new ToolError(act.quoteFormRefusal(q));
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        const r = await Promise.race([got, sleep(500).then(() => null)]);
        if (r) {
          if ('error' in r) throw new ToolError(r.error);
          return r;
        }
        if (win.isDestroyed()) throw new ToolError('견적서 창이 닫혀 견적서를 받지 못했습니다.');
        if (pwc.isLoading()) continue;
        const s = await js<{ text: string; formShown: boolean; printed: boolean; pdf: boolean }>(
          `(() => { const f = (${QUOTE_FORM_CHECK})(document, ''); return { text: ${VISIBLE_TEXT}, formShown: f.found && !!f.context, printed: !!window.__doldariPrint, pdf: document.contentType === 'application/pdf' }; })()`
        );
        if (!s) continue;
        if (s.pdf && /^https?:/.test(pwc.getURL())) return this.fetchPdf(pwc.getURL());
        if (quoteReady(s, pwc.getURL() !== before)) {
          await sleep(800);
          return await this.savePopup(win);
        }
      }
      throw new ToolError(`견적서 창에 신청자명("${name}")을 넣고 "${q.button}"을 눌렀지만 견적서가 나오지 않았습니다. 견적서를 받을 수 없으면 페이지의 가격으로 report_quote 하세요.`);
    } finally {
      downloadWaiters.delete(pwc.id);
    }
  }

  /** 본문(모달·같은 출처 iframe 포함)의 견적서 신청자명 양식: 이름을 넣고 다음을 눌러 나온 견적서를 받는다 */
  private async submitViewForm(ref?: number): Promise<PdfFile> {
    const wc = this.view.webContents;
    const trigger = act.recentTrigger(this.cdp);
    const before = wc.getURL();
    const start = Date.now();
    const name = quoteRequesterName();
    const got = new Promise<DownloadResult>((resolve) => downloadWaiters.set(wc.id, resolve));
    // 다음을 누른 뒤 열리는 견적서 화면이 인쇄 창을 띄우려 해도 막고 표시만 남긴다
    const hook = await this.cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source: PRINT_HOOK }).catch(() => null);
    try {
      await this.cdp.evaluate(PRINT_HOOK_ALL).catch(() => undefined);
      const q = await act.submitQuoteForm(this.cdp, name, trigger, ref);
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        const r = await Promise.race([got, sleep(500).then(() => null)]);
        if (r) {
          if ('error' in r) throw new ToolError(r.error);
          return r;
        }
        if (wc.isDestroyed()) break;
        if (wc.isLoading()) continue;
        const navigated = wc.getURL() !== before;
        const pdfUrl = navigated ? await showingPdf(this) : null;
        if (pdfUrl) return this.fetchPdf(pdfUrl);
        const popup = await this.readyPopup(start);
        if (popup) return this.printPopup(popup);
        const page = await this.cdp.evaluate<{ text: string; printed: boolean }>(`({ text: ${VISIBLE_TEXT}, printed: ${PRINTED} })`).catch(() => null);
        if (!page) continue;
        const frames = (await this.frameTexts().catch(() => [])).map((f) => f.text).join('\n');
        const form = await act.findQuoteForm(this.cdp, trigger).catch(() => null);
        if (quoteReady({ text: `${page.text}\n${frames}`, printed: page.printed, formShown: Boolean(form?.found && form.context) }, navigated)) {
          await sleep(800);
          const data = await wc.printToPDF({ printBackground: true, pageSize: 'A4' });
          return checkPdf(Buffer.from(data), wc.getURL(), pdfName(wc.getURL(), wc.getTitle() || '견적서'));
        }
      }
      throw new ToolError(`신청자명("${name}")을 넣고 "${q.button}"을 눌렀지만 견적서가 나오지 않았습니다. snapshot으로 화면을 확인하고, 인쇄용 견적서 화면이 보이면 save_page_pdf로 저장하세요.`);
    } finally {
      downloadWaiters.delete(wc.id);
      if (hook?.identifier) void this.cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: hook.identifier }).catch(() => undefined);
    }
  }

  /** quote_name_form 도구: 팝업이나 화면의 견적서 신청자명 양식에 이름을 넣고 다음을 눌러 견적서를 받는다 */
  async submitQuoteForm(target: { ref?: string } = {}): Promise<PdfFile> {
    const ref = target.ref ? Number(String(target.ref).replace(/\D/g, '')) : undefined;
    // 견적서 출력 버튼이 보이지 않는 팝업 창을 열었으면 그 창의 양식
    const popup = ref ? null : await this.readyPopup();
    if (popup) return this.printPopup(popup);
    return this.submitViewForm(ref);
  }

  /** 지금 화면이 견적서 출력 양식(신청자명 입력 등)이거나 아직 견적서가 뜨지 않은 견적서 출력 화면인지 (원본으로 남기지 않는다) */
  async quoteFormScreen(): Promise<boolean> {
    if (this.view.webContents.isDestroyed()) return false;
    const form = await act.findQuoteForm(this.cdp).catch(() => null);
    if (form?.found && form.context) return true;
    const page = await this.cdp.evaluate<{ title: string; url: string; text: string }>(`({ title: document.title, url: location.href, text: ${VISIBLE_TEXT} })`).catch(() => null);
    if (!page) return false;
    const issuing = QUOTE_ISSUE_RE.test(page.title) && /estimat|print|quot|견적/i.test(safeDecode(page.url));
    return issuing && !looksLikeQuote(page.text);
  }

  get locked() {
    return this.cdp.locked;
  }
  set locked(v: boolean) {
    this.cdp.locked = v;
  }

  async navigate(url: string) {
    // 앱 브라우저는 데스크톱 화면이라 모바일 주소(m.)는 데스크톱 주소로 먼저 연다 (모바일 페이지에는 견적서 출력·옵션 계산이 없는 곳이 많다)
    const desktop = /^https?:\/\/m\.[^/]+/i.test(url) ? url.replace(/^(https?:\/\/)m\./i, '$1') : null;
    if (desktop) {
      try {
        const r = await act.navigate(this.cdp, desktop);
        if (!/^chrome-error:/.test(this.view.webContents.getURL())) return `${r} (모바일 주소 대신 데스크톱 페이지로 열었습니다)`;
      } catch {
        /* 데스크톱 주소가 없으면 원래 주소로 */
      }
    }
    return act.navigate(this.cdp, url);
  }

  /** 지금 화면(또는 모달 iframe)에 견적서가 떠 있는지 */
  private async showsQuoteDoc(): Promise<boolean> {
    const wc = this.view.webContents;
    const text = await wc.executeJavaScript(VISIBLE_TEXT).catch(() => '');
    const frames = (await this.frameTexts().catch(() => [])).map((f) => f.text).join('\n');
    return isQuoteDocText(`${text}\n${frames}`);
  }
  snapshot() {
    return takeSnapshot(this.cdp);
  }
  async click(ref: string) {
    const start = Date.now();
    const r = await act.click(this.cdp, Number(String(ref).replace(/\D/g, '')));
    // 클릭으로 견적서 팝업이 떴으면 알려 준다 (팝업은 보이지 않는 창이라 snapshot에는 안 나온다)
    for (let i = 0; i < 6 && this.popup && this.popup.at >= start && !(await this.readyPopup(start)); i++) await new Promise((res) => setTimeout(res, 500));
    if (this.popup && this.popup.at >= start) return `${r}\n새 창(팝업)이 열렸습니다: ${this.popup.win.webContents.getURL() || '불러오는 중'}. 견적서 팝업이면 save_page_pdf로 그 창을 PDF로 저장하세요 (신청자명만 묻는 견적서 출력 창이면 설정한 신청자명을 넣고 다음을 눌러 받습니다).`;
    return r;
  }
  fill(ref: string, text: string) {
    return act.fill(this.cdp, Number(String(ref).replace(/\D/g, '')), text);
  }
  async selectOption(ref: string, option: string) {
    if (this.cdp.locked) throw new Error('handoff 이후에는 조작할 수 없습니다.');
    const id = this.cdp.refs.get(Number(String(ref).replace(/\D/g, '')));
    if (!id) throw new Error(`ref=${ref}를 찾을 수 없습니다. snapshot을 다시 찍으세요.`);
    // 네이티브 <select>가 아니면(Vuetify·커스텀 드롭다운) 펼쳐서 목록 항목을 누른다
    const sid = this.cdp.refFrame.get(Number(String(ref).replace(/\D/g, '')));
    const native = await this.cdp.callOn<boolean>(id, `function () { return this.tagName === 'SELECT' || !!(this.querySelector && this.querySelector('select')); }`, sid);
    if (!native) return act.selectCustom(this.cdp, Number(String(ref).replace(/\D/g, '')), option);
    // 값은 스크립트로 바꾸지만 커서는 그 칸으로 가서 누르는 모습을 보여 준다
    await act.pointAt(this.cdp, id, sid);
    const r = await this.cdp.callOn<{ ok: boolean; options: string[] }>(
      id,
      `function () {
        const el = this.tagName === 'SELECT' ? this : this.querySelector('select');
        const norm = ${act.NORM_FN};
        const v = ${JSON.stringify(option)};
        const opts = [...(el.options || [])];
        const o = opts.find((o) => o.text.trim() === v || o.value === v) || opts.find((o) => norm(o.text) === norm(v)) || opts.find((o) => norm(o.text).includes(norm(v)));
        if (!o) return { ok: false, options: opts.map((o) => o.text.trim()).slice(0, 30) };
        el.value = o.value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, options: [] };
      }`,
      sid
    );
    if (!r?.ok) throw new Error(`"${option}" 옵션이 없습니다. 있는 옵션: ${(r?.options ?? []).join(' / ')}`);
    await new Promise((r) => setTimeout(r, 800));
    return `옵션 선택 완료: ${option}. read_text로 다시 계산된 금액을 확인하세요.`;
  }
  evaluate<T>(expression: string) {
    return this.cdp.evaluate<T>(expression);
  }
  async frameTexts() {
    const out: { host: string; text: string }[] = [];
    for (const f of this.cdp.frameSessions()) {
      if (!/^https?:/.test(f.url)) continue;
      const text = await this.cdp.evaluate<string>('document.body ? document.body.innerText : ""', f.sessionId).catch(() => '');
      if (text && text.trim().length > 20) out.push({ host: new URL(f.url).host, text: text.replace(/\n{3,}/g, '\n\n').slice(0, 4000) });
    }
    return out;
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
  /** 세션 쿠키를 그대로 써서 PDF URL을 받는다 (다른 출처 CDN 파일도 가능) */
  private async fetchPdf(url: string): Promise<PdfFile> {
    if (!/^https?:\/\//.test(url)) throw new ToolError('http(s) 주소의 PDF만 받을 수 있습니다.');
    const res = await browserSession().fetch(url).catch((e: unknown) => {
      throw new ToolError(`PDF를 받지 못했습니다 (${e instanceof Error ? e.message : String(e)}).`);
    });
    if (!res.ok) throw new ToolError(`PDF를 받지 못했습니다 (HTTP ${res.status}).`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_PDF_BYTES) throw new ToolError('파일이 너무 큽니다. 15MB 이하 PDF만 받습니다.');
    const cd = res.headers.get('content-disposition') ?? '';
    const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)?.[1];
    return checkPdf(Buffer.from(await res.arrayBuffer()), url, named ? decodeURIComponent(named) : undefined);
  }

  async downloadPdf(target: { ref?: string; url?: string }): Promise<PdfFile> {
    if (target.url) return this.fetchPdf(target.url);
    if (!target.ref) throw new ToolError('ref나 url 중 하나가 필요합니다.');
    const refNum = Number(String(target.ref).replace(/\D/g, ''));
    const id = this.cdp.refs.get(refNum);
    if (!id) throw new ToolError(`ref=${target.ref}를 찾을 수 없습니다. snapshot을 다시 찍으세요.`);
    // 링크면 주소로 바로 받는다
    const href = await this.cdp
      .callOn<string>(id, `function () { const a = this.closest('a'); return a && a.href && !/^javascript:/i.test(a.href) ? a.href : ''; }`, this.cdp.refFrame.get(refNum))
      .catch(() => '');
    if (href && /^https?:/.test(href)) {
      try {
        return await this.fetchPdf(href);
      } catch {
        /* PDF가 아니면 눌러서 받아 본다 */
      }
    }
    // 버튼: 누르고, 내려오는 PDF(다운로드) 또는 PDF 화면으로의 이동을 기다린다
    const wc = this.view.webContents;
    const before = wc.getURL();
    const start = Date.now();
    const got = new Promise<DownloadResult>((resolve) => downloadWaiters.set(wc.id, resolve));
    let refused: QuoteFormCheck | null = null;
    try {
      await act.click(this.cdp, refNum);
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        const r = await Promise.race([got, new Promise<null>((res) => setTimeout(() => res(null), 500))]);
        if (r) {
          if ('error' in r) throw new ToolError(r.error);
          return r;
        }
        const pdfUrl = wc.getURL() !== before ? await showingPdf(this) : null;
        if (pdfUrl) return this.fetchPdf(pdfUrl);
        // 견적서를 팝업 창(HTML)으로 띄우는 사이트: 그 창을 PDF로 저장한다
        const popup = await this.readyPopup(start);
        if (popup) return this.printPopup(popup);
        // 견적서를 모달(같은 화면 안 창·iframe)로 띄우는 사이트: 그 화면을 PDF로 저장한다
        if (Date.now() - start > 1500 && (await this.showsQuoteDoc())) {
          await new Promise((r) => setTimeout(r, 800));
          return this.printPdf();
        }
        // 견적서 대신 신청자명만 묻는 모달·화면이 뜨면 설정한 이름을 넣고 다음을 눌러 받는다 (다른 개인정보를 물으면 넣지 않음)
        if (Date.now() - start > 1500 && !wc.isLoading()) {
          const form = await act.findQuoteForm(this.cdp).catch(() => null);
          if (form?.ok) return this.submitViewForm();
          if (form?.found && form.context) refused = form;
        }
      }
      if (refused) throw new ToolError(act.quoteFormRefusal(refused));
      throw new ToolError('버튼을 눌렀지만 PDF가 내려오지 않았습니다. 인쇄용 견적서 화면이 열렸다면 save_page_pdf로 그 화면을 PDF로 저장하세요.');
    } finally {
      downloadWaiters.delete(wc.id);
    }
  }

  async printPdf(): Promise<PdfFile> {
    // 견적서 팝업이 열려 있으면 그 창을 저장한다
    const popup = await this.readyPopup();
    if (popup) return this.printPopup(popup);
    const wc = this.view.webContents;
    if (wc.isDestroyed() || !/^https?:/.test(wc.getURL())) throw new ToolError('저장할 페이지가 없습니다.');
    const frames = (await this.frameTexts().catch(() => [])).map((f) => f.text).join('\n');
    // 견적서가 아니라 신청자명만 묻는 견적서 출력 양식이면 이름을 넣고 다음을 눌러 나온 견적서를 받는다
    const text = `${await wc.executeJavaScript(VISIBLE_TEXT).catch(() => '')}\n${frames}`;
    if (!(isQuoteDocText(text) && looksLikeQuote(text))) {
      const form = await act.findQuoteForm(this.cdp).catch(() => null);
      if (form?.ok) return this.submitViewForm();
      if (form?.found && form.context) throw new ToolError(act.quoteFormRefusal(form));
    }
    await assertQuoteDoc(wc, frames);
    const data = await wc.printToPDF({ printBackground: true, pageSize: 'A4' });
    return checkPdf(Buffer.from(data), wc.getURL(), pdfName(wc.getURL(), wc.getTitle() || '견적서 화면'));
  }

  async reset() {
    this.closePopup();
    this.cdp.reset();
    // 멈춘 에이전트의 페이지 이동과 겹치면 ERR_ABORTED로 실패하는데, 정리 목적이라 무시해도 된다
    if (!this.view.webContents.isDestroyed()) await this.view.webContents.loadURL('about:blank').catch(() => undefined);
  }
  async close() {
    this.closePopup();
    this.offCursor();
    if (this.frameTimer) clearInterval(this.frameTimer);
    const win = getWindow();
    win?.contentView.removeChildView(this.view);
    win?.contentView.removeChildView(this.cursorView);
    this.view.webContents.close();
    this.cursorView.webContents.close();
  }
}
