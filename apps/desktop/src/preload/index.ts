// renderer에 노출하는 안전한 API (API 키 등 비밀값은 노출하지 않는다)
import { contextBridge, ipcRenderer } from 'electron';
import type { AgentEvent, AppConfig, BrowserInput, HistoryRecord, HistorySummary, MailDraft, MailKind, Requirements, SettingsInput, Slot, VendorId } from '../shared/types';

type MailResult = { ok: boolean; error?: string; imap?: boolean };

function on<T>(channel: string, cb: (v: T) => void) {
  const listener = (_: unknown, v: T) => cb(v);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api = {
  config: (): Promise<AppConfig> => ipcRenderer.invoke('app:config'),
  reset: () => ipcRenderer.invoke('app:reset'),
  historyList: (): Promise<HistorySummary[]> => ipcRenderer.invoke('history:list'),
  historyGet: (id: string): Promise<HistoryRecord | null> => ipcRenderer.invoke('history:get', id),
  historyDelete: (id: string): Promise<boolean> => ipcRenderer.invoke('history:delete', id),
  saveSettings: (input: SettingsInput): Promise<{ ok: boolean; error?: string; config?: AppConfig }> => ipcRenderer.invoke('settings:save', input),
  clearApiKey: (): Promise<AppConfig> => ipcRenderer.invoke('settings:clearKey'),
  onEvent: (cb: (ev: AgentEvent) => void) => on('agent:event', cb),
  onFrame: (cb: (f: { slot: Slot; data: string }) => void) => on('browser:frame', cb),
  sendChat: (text: string) => ipcRenderer.invoke('chat:send', text),
  startSearch: (patch: Partial<Requirements>) => ipcRenderer.invoke('flow:start', patch),
  revise: () => ipcRenderer.invoke('flow:revise'),
  uploadFile: (vendorId: VendorId, file: { name: string; mime: string; data: Uint8Array }) => ipcRenderer.invoke('file:upload', vendorId, file),
  sendMail: (draft: MailDraft): Promise<MailResult> => ipcRenderer.invoke('mail:send', draft),
  openMailApp: (draft: MailDraft): Promise<MailResult> => ipcRenderer.invoke('mail:external', draft),
  pasteReply: (vendorId: VendorId, kind: MailKind, text: string) => ipcRenderer.invoke('mail:pasteReply', vendorId, kind, text),
  draftOrder: (id: VendorId) => ipcRenderer.invoke('draft:order', id),
  draftQuestion: (id: VendorId) => ipcRenderer.invoke('draft:question', id),
  retry: (id: VendorId) => ipcRenderer.invoke('agent:retry', id),
  replace: (id: VendorId) => ipcRenderer.invoke('agent:replace', id),
  skip: (id: VendorId) => ipcRenderer.invoke('agent:skip', id),
  setViewBounds: (slot: Slot, rect: { x: number; y: number; width: number; height: number } | null) => ipcRenderer.send('browser:bounds', slot, rect),
  openLoginWindow: (url: string) => ipcRenderer.invoke('browser:login', url),
  onCursor: (cb: (c: { slot: Slot; x: number; y: number; click?: boolean }) => void) => on('browser:cursor', cb),
  resume: (slot: Slot) => ipcRenderer.invoke('agent:resume', slot),
  savePdf: (html: string, name: string): Promise<string | null> => ipcRenderer.invoke('report:pdf', html, name),
  browserInput: (input: BrowserInput) => ipcRenderer.invoke('browser:input', input),
  browserBack: (slot: Slot) => ipcRenderer.invoke('browser:back', slot),
  openExternal: (url: string) => ipcRenderer.invoke('browser:openExternal', url)
};

export type DoldariApi = typeof api;
contextBridge.exposeInMainWorld('doldari', api);
