// Electron main: 창, IPC
import path from 'node:path';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import type { BrowserInput, MailDraft, MailKind, Requirements, SessionSnapshot, SettingsInput, Slot, VendorId } from '@shared/types';
import { clearApiKey, config, publicConfig, saveSettings } from './config';
import { verifyApiKey } from './agent/claude';
import { bindWindow } from './events';
import { closeAll, detectBackend, goBack, openLoginWindow, setViewBounds, switchBackend, userInput } from './browser';
import { emit, getStage } from './events';
import * as flow from './orchestrator';
import { polishApproval } from './agent/approvalPolish';
import type { PolishInput } from '@shared/approval';
import { analyzeTemplate, clearTemplate, fillTemplate, loadTemplate, previewTemplate, saveMapping } from './template';
import type { FieldDef } from '@shared/template';
import { deleteRecord, getRecord, getSession, listRecords, saveSession } from './history';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: '돌다리',
    backgroundColor: '#07080b',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // 받은 견적서 PDF를 앱 안에서 보여 주는 Chromium 내장 PDF 뷰어 (앱 창에만, 외부 사이트 뷰에는 켜지 않음)
      plugins: true
    }
  });
  mainWindow = win;
  bindWindow(win);
  // 시연용: 화면을 꽉 채워 연다 (에이전트 브라우저를 크게 보여 주려고)
  win.maximize();

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(path.join(__dirname, '../renderer/index.html'));

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
}

function registerIpc() {
  ipcMain.handle('app:config', () => publicConfig());
  ipcMain.handle('app:reset', () => flow.reset());
  ipcMain.handle('history:list', () => listRecords());
  ipcMain.handle('history:get', (_e, id: string) => getRecord(String(id)));
  ipcMain.handle('history:delete', (_e, id: string) => deleteRecord(String(id)));
  ipcMain.handle('history:saveSession', (_e, id: string, snap: SessionSnapshot) => saveSession(String(id), snap));
  ipcMain.handle('history:getSession', (_e, id: string) => getSession(String(id)));
  ipcMain.handle('settings:save', async (_e, input: SettingsInput) => {
    const key = input.ANTHROPIC_API_KEY?.trim();
    if (key) {
      const err = await verifyApiKey(key, input.ANTHROPIC_MODEL?.trim() || config.model);
      if (err) return { ok: false, error: err };
    }
    const prevPref = publicConfig().browserPref;
    saveSettings(input);
    if (publicConfig().browserPref !== prevPref) {
      // 탐색 중이면 에이전트를 멈춘 뒤 바꾼다 (끝난 견적·대화는 그대로 둔다)
      if (getStage() === 'search' || getStage() === 'collect') await flow.reset();
      emit('backend', { payload: null });
      emit('backend', { payload: await switchBackend() });
    }
    return { ok: true, config: publicConfig() };
  });
  ipcMain.handle('settings:clearKey', () => {
    clearApiKey();
    return publicConfig();
  });
  ipcMain.handle('chat:send', (_e, text: string) => flow.onChat(text));
  ipcMain.handle('order:open', (_e, id: VendorId) => flow.openOrderPage(id));
  ipcMain.handle('window:fullscreen', () => {
    if (!mainWindow) return false;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    return !mainWindow.isFullScreen();
  });
  ipcMain.handle('flow:start', (_e, patch: Partial<Requirements>) => flow.startSearch(patch ?? {}));
  ipcMain.handle('flow:revise', () => flow.revise());
  ipcMain.handle('file:upload', (_e, vendorId: VendorId, file: { name: string; mime: string; data: Uint8Array }) => flow.onFileUpload(vendorId, file));
  ipcMain.handle('mail:send', (_e, draft: MailDraft) => flow.onMailSend(draft));
  ipcMain.handle('mail:external', (_e, draft: MailDraft) => flow.onMailExternal(draft));
  ipcMain.handle('mail:pasteReply', (_e, vendorId: VendorId, kind: MailKind, text: string) => flow.onPasteReply(vendorId, kind, text));
  ipcMain.handle('message:sent', (_e, vendorId: VendorId) => flow.onMessageSent(vendorId));
  ipcMain.handle('message:paste', (_e, vendorId: VendorId, text: string) => flow.onPasteMessage(vendorId, text));
  ipcMain.handle('message:sms', (_e, vendorId: VendorId, body: string) => flow.onOpenSms(vendorId, body));
  ipcMain.handle('draft:order', (_e, id: VendorId) => flow.onDraftOrder(id));
  ipcMain.handle('draft:question', (_e, id: VendorId) => flow.onDraftQuestion(id));
  ipcMain.handle('agent:retry', (_e, id: VendorId) => flow.retry(id));
  ipcMain.handle('agent:stop', () => flow.stop());
  ipcMain.handle('agent:replace', (_e, id: VendorId) => flow.replace(id));
  ipcMain.handle('agent:skip', (_e, id: VendorId) => flow.skip(id));
  ipcMain.on('browser:bounds', (e, slot: Slot, rect: { x: number; y: number; width: number; height: number } | null) =>
    setViewBounds(slot, rect, e.sender.getZoomFactor())
  );
  ipcMain.handle('browser:login', (_e, url: string) => openLoginWindow(url));
  ipcMain.handle('agent:resume', (_e, slot: Slot) => flow.resume(slot));
  ipcMain.handle('report:pdf', (_e, html: string, name: string) => (mainWindow ? flow.onSavePdf(mainWindow, html, name) : null));
  ipcMain.handle('approval:polish', (_e, input: PolishInput) => polishApproval(input));
  ipcMain.handle('template:get', () => loadTemplate());
  ipcMain.handle('template:analyze', (_e, file: { name: string; data: Uint8Array }, fields: FieldDef[]) => analyzeTemplate(file, fields));
  ipcMain.handle('template:mapping', (_e, mapping: Record<string, string | null>) => saveMapping(mapping));
  ipcMain.handle('template:clear', () => clearTemplate());
  ipcMain.handle('template:preview', (_e, values: Record<string, string>) => previewTemplate(values));
  ipcMain.handle('template:fill', (_e, values: Record<string, string>) => (mainWindow ? fillTemplate(mainWindow, values) : { ok: false, error: '창이 없어요.' }));
  ipcMain.handle('browser:input', (_e, input: BrowserInput) => userInput(input));
  ipcMain.handle('browser:back', (_e, slot: Slot) => goBack(slot));
  ipcMain.handle('browser:openExternal', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
}

// 개발 점검용: DOLDARI_DEBUG_PORT를 주면 CDP 원격 디버깅 포트를 연다
if (process.env.DOLDARI_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.DOLDARI_DEBUG_PORT);

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  // 사용자의 Aside 브라우저를 쓸 수 있으면 그것으로, 아니면 내장 브라우저로
  void detectBackend().then((b) => emit('backend', { payload: b }));
});

app.on('window-all-closed', () => {
  void closeAll().finally(() => app.quit());
});
