// Electron main: 창, IPC
import fs from 'node:fs';
import { exportXlsx, type XlsxPayload } from './export-xlsx';
import { savePdfFile } from './report';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron';
import type { MailDraft, MailKind, Requirements, SessionSnapshot, SettingsInput, Slot, VendorId } from '@shared/types';
import { clearApiKey, config, publicConfig, saveSettings, themeMode } from './config';
import { verifyApiKey } from './agent/claude';
import { bindWindow } from './events';
import { closeAll, goBack, openLoginWindow, setViewBounds } from './browser';
import { emit, getStage } from './events';
import * as flow from './orchestrator';
import { polishApproval } from './agent/approvalPolish';
import type { PolishInput } from '@shared/approval';
import { analyzeTemplate, clearTemplate, fillTemplate, loadTemplate, previewTemplate, saveMapping } from './template';
import type { FieldDef } from '@shared/template';
import { deleteRecord, getRecord, getSession, listRecords, saveSession } from './history';
import { cancelGoogleLogin, connectGoogle, disconnectGoogle } from './channels/google-auth';
import { resumePolling } from './channels/mail-poll';
import { focusedSid, withSession } from './session';

let mainWindow: BrowserWindow | null = null;

/** 창 배경색: 테마 설정에 맞춰 켤 때 번쩍이지 않게 한다. nativeTheme.themeSource는 바꾸지 않고 읽기만 한다 */
function windowBackground() {
  const mode = themeMode();
  const dark = mode === 'dark' || (mode === 'system' && nativeTheme.shouldUseDarkColors);
  return dark ? '#17171c' : '#f4f5f9';
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: '돌다리',
    backgroundColor: windowBackground(),
    titleBarStyle: 'hiddenInset',
    // 창 버튼을 상단 바(높이 56px) 가운데 높이에 맞춘다
    trafficLightPosition: { x: 20, y: 21 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
  mainWindow = win;
  bindWindow(win);
  limitZoom(win);
  // 시연용: 화면을 꽉 채워 연다 (에이전트 브라우저를 크게 보여 주려고)
  win.maximize();
  // 개발 실행(npm run dev)에서도 Dock에 돌다리 아이콘을 보여 준다 (빌드한 앱은 build/icon.png가 앱 아이콘)
  const devIcon = path.join(__dirname, '../../build/icon.png');
  if (!app.isPackaged && process.platform === 'darwin' && fs.existsSync(devIcon)) app.dock?.setIcon(devIcon);

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(path.join(__dirname, '../renderer/index.html'));
  // 화면을 다시 불러오면(⌘R·메뉴의 새로 고침 등) 화면은 처음 상태가 되므로 main도 새 견적으로 맞춘다.
  // 진행 중인 에이전트는 멈추고, 지난 검색은 히스토리에 남는다. 처음 불러올 때는 그대로 둔다
  let loaded = false;
  win.webContents.on('did-finish-load', () => {
    if (loaded) void flow.resetEverything().catch((e) => console.log(`[reload] 초기화 실패: ${e instanceof Error ? e.message : String(e)}`));
    loaded = true;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // preload(window.doldari)가 붙은 앱 창은 앱 화면 밖으로 이동하지 않는다 (링크는 기본 브라우저로)
  win.webContents.on('will-navigate', (e, url) => {
    if (isAppUrl(url)) return;
    e.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
}

/** 앱 화면 주소인지: 개발 실행은 vite 주소(같은 origin), 빌드한 앱은 renderer/index.html 파일 */
function isAppUrl(url: string) {
  try {
    const u = new URL(url);
    const dev = process.env.ELECTRON_RENDERER_URL;
    if (dev) return u.origin === new URL(dev).origin;
    return u.protocol === 'file:' && u.pathname === pathToFileURL(path.join(__dirname, '../renderer/index.html')).pathname;
  } catch {
    return false;
  }
}

// 모든 웹 화면: <webview>는 붙이지 않고, 새 창은 기본으로 거부한다 (필요한 화면은 만든 뒤 자기 처리기로 바꿔 씀)
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (ev) => ev.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

/** 화면 배율: Ctrl(⌘) + "+" / "-" / "0", Ctrl + 휠. 너무 작거나 커져 화면이 깨지지 않게 80%~150%로 묶는다 */
const ZOOM = { min: 0.8, max: 1.5, step: 0.1 };
function limitZoom(win: BrowserWindow) {
  const wc = win.webContents;
  const apply = (z: number) => wc.setZoomFactor(Math.min(ZOOM.max, Math.max(ZOOM.min, Math.round(z * 10) / 10)));
  // 키 입력을 메뉴 단축키보다 먼저 받아 직접 처리한다 (기본 확대·축소는 한계가 너무 넓음)
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    const z = wc.getZoomFactor();
    if (input.key === '=' || input.key === '+') apply(z + ZOOM.step);
    else if (input.key === '-' || input.key === '_') apply(z - ZOOM.step);
    else if (input.key === '0') apply(1);
    else return;
    event.preventDefault();
  });
  wc.on('zoom-changed', (_e, dir) => apply(wc.getZoomFactor() + (dir === 'in' ? ZOOM.step : -ZOOM.step)));
}

/** 화면에서 온 조작은 화면이 보고 있는 세션에서 실행한다 (처리 도중 화면이 다른 세션으로 바뀌어도 그 세션에서 끝까지) */
const handle = (channel: string, fn: (e: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown) =>
  ipcMain.handle(channel, (e, ...args) => withSession(focusedSid(), () => fn(e, ...args)));

function registerIpc() {
  handle('app:config', () => publicConfig());
  handle('app:reset', () => flow.newChat());
  handle('session:focus', (_e, sid: string) => flow.focusSession(String(sid)));
  handle('history:list', () => listRecords());
  handle('history:get', (_e, id: string) => getRecord(String(id)));
  handle('history:delete', async (_e, id: string) => {
    await flow.endSessionOf(String(id));
    return deleteRecord(String(id));
  });
  handle('history:saveSession', (_e, id: string, snap: SessionSnapshot) => saveSession(String(id), snap));
  handle('history:getSession', (_e, id: string) => getSession(String(id)));
  handle('history:resume', (_e, id: string) => flow.resumeHistory(String(id)));
  handle('settings:save', async (_e, input: SettingsInput) => {
    const key = input.ANTHROPIC_API_KEY?.trim();
    if (key) {
      const err = await verifyApiKey(key, input.ANTHROPIC_MODEL?.trim() || config.model);
      if (err) return { ok: false, error: err };
    }
    const saveErr = saveSettings(input);
    if (saveErr) return { ok: false, error: saveErr };
    // 테마를 바꿨으면 창 배경색도 맞춰 둔다 (크기를 줄일 때 비치는 색)
    if (input.THEME) mainWindow?.setBackgroundColor(windowBackground());
    // 앱 비밀번호를 새로 넣었으면 기다리던 회신 확인을 이어 간다
    resumePolling();
    return { ok: true, config: publicConfig() };
  });
  handle('settings:clearKey', () => {
    clearApiKey();
    return publicConfig();
  });
  handle('google:connect', async () => {
    try {
      await connectGoogle();
      // 브라우저에서 로그인을 마치면 앱으로 돌아온다
      if (process.platform === 'darwin') app.focus({ steal: true });
      mainWindow?.show();
      mainWindow?.focus();
      // 회신을 기다리던 메일이 있으면 새 계정으로 바로 확인을 이어 간다
      resumePolling();
      return { ok: true, config: publicConfig() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), config: publicConfig() };
    }
  });
  handle('google:cancel', () => cancelGoogleLogin());
  handle('google:disconnect', async () => {
    await disconnectGoogle();
    return publicConfig();
  });
  handle('chat:send', (_e, text: string) => flow.onChat(text));
  handle('order:open', (_e, id: VendorId) => flow.openOrderPage(id));
  handle('window:fullscreen', () => {
    if (!mainWindow) return false;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    return !mainWindow.isFullScreen();
  });
  handle('flow:start', (_e, patch: Partial<Requirements>) => flow.startSearch(patch ?? {}));
  handle('req:item', (_e, item: string) => flow.onItemChange(item));
  handle('req:edit', (_e, patch: Partial<Requirements>) => flow.editRequirements(patch ?? {}));
  handle('flow:revise', () => flow.revise());
  handle('file:upload', (_e, vendorId: VendorId, file: { name: string; mime: string; data: Uint8Array }) => flow.onFileUpload(vendorId, file));
  handle('mail:send', (_e, draft: MailDraft) => flow.onMailSend(draft));
  handle('mail:external', (_e, draft: MailDraft) => flow.onMailExternal(draft));
  handle('mail:pasteReply', (_e, vendorId: VendorId, kind: MailKind, text: string) => flow.onPasteReply(vendorId, kind, text));
  handle('message:sent', (_e, vendorId: VendorId) => flow.onMessageSent(vendorId));
  handle('message:paste', (_e, vendorId: VendorId, text: string) => flow.onPasteMessage(vendorId, text));
  handle('message:sms', (_e, vendorId: VendorId, body: string) => flow.onOpenSms(vendorId, body));
  handle('draft:order', (_e, id: VendorId) => flow.onDraftOrder(id));
  handle('draft:question', (_e, id: VendorId) => flow.onDraftQuestion(id));
  handle('agent:retry', (_e, id: VendorId) => flow.retry(id));
  handle('agent:stop', () => flow.stop());
  handle('agent:replace', (_e, id: VendorId) => flow.replace(id));
  handle('agent:skip', (_e, id: VendorId) => flow.skip(id));
  ipcMain.on('browser:bounds', (e, slot: Slot, rect: { x: number; y: number; width: number; height: number } | null) =>
    setViewBounds(slot, rect, e.sender.getZoomFactor())
  );
  handle('browser:login', (_e, url: string) => openLoginWindow(url));
  handle('agent:resume', (_e, slot: Slot) => flow.resume(slot));
  handle('report:pdf', (_e, html: string, name: string) => (mainWindow ? flow.onSavePdf(mainWindow, html, name) : null));
  handle('file:savePdf', (_e, data: Uint8Array, name: string) => (mainWindow ? savePdfFile(mainWindow, data, name) : null));
  handle('report:xlsx', (_e, payload: XlsxPayload) => (mainWindow ? exportXlsx(mainWindow, payload) : null));
  handle('approval:polish', (_e, input: PolishInput) => polishApproval(input));
  handle('template:get', () => loadTemplate());
  handle('template:analyze', (_e, file: { name: string; data: Uint8Array }, fields: FieldDef[]) => analyzeTemplate(file, fields));
  handle('template:mapping', (_e, mapping: Record<string, string | null>) => saveMapping(mapping));
  handle('template:clear', () => clearTemplate());
  handle('template:preview', (_e, values: Record<string, string>) => previewTemplate(values));
  handle('template:fill', (_e, values: Record<string, string>) => (mainWindow ? fillTemplate(mainWindow, values) : { ok: false, error: '창이 없어요.' }));
  handle('browser:back', (_e, slot: Slot) => goBack(slot));
  handle('browser:openExternal', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
}

// 개발 점검용: DOLDARI_DEBUG_PORT를 주면 CDP 원격 디버깅 포트를 연다
if (process.env.DOLDARI_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.DOLDARI_DEBUG_PORT);

app.whenReady().then(() => {
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => {
  void closeAll().finally(() => app.quit());
});
