// renderer에 노출하는 안전한 API (API 키 등 비밀값은 노출하지 않는다)
import { contextBridge, ipcRenderer } from 'electron';
import type { AgentEvent, AppConfig, BrowserInput, HistoryRecord, HistorySummary, MailDraft, MailKind, Requirements, SessionSnapshot, SettingsInput, Slot, VendorId } from '../shared/types';

import type { PolishInput, PolishResult } from '../shared/approval';
import type { FieldDef, TemplateFillResult, TemplateInfo, TemplatePreviewResult, TemplateResult } from '../shared/template';

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
  historySaveSession: (id: string, snap: SessionSnapshot): Promise<boolean> => ipcRenderer.invoke('history:saveSession', id, snap),
  historyGetSession: (id: string): Promise<SessionSnapshot | null> => ipcRenderer.invoke('history:getSession', id),
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
  messageSent: (vendorId: VendorId) => ipcRenderer.invoke('message:sent', vendorId),
  pasteMessage: (vendorId: VendorId, text: string) => ipcRenderer.invoke('message:paste', vendorId, text),
  openSms: (vendorId: VendorId, body: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('message:sms', vendorId, body),
  draftOrder: (id: VendorId) => ipcRenderer.invoke('draft:order', id),
  draftQuestion: (id: VendorId) => ipcRenderer.invoke('draft:question', id),
  retry: (id: VendorId) => ipcRenderer.invoke('agent:retry', id),
  stop: () => ipcRenderer.invoke('agent:stop'),
  replace: (id: VendorId) => ipcRenderer.invoke('agent:replace', id),
  skip: (id: VendorId) => ipcRenderer.invoke('agent:skip', id),
  setViewBounds: (slot: Slot, rect: { x: number; y: number; width: number; height: number } | null) => ipcRenderer.send('browser:bounds', slot, rect),
  openLoginWindow: (url: string) => ipcRenderer.invoke('browser:login', url),
  onCursor: (cb: (c: { slot: Slot; x: number; y: number; click?: boolean }) => void) => on('browser:cursor', cb),
  resume: (slot: Slot) => ipcRenderer.invoke('agent:resume', slot),
  savePdf: (html: string, name: string): Promise<string | null> => ipcRenderer.invoke('report:pdf', html, name),
  polishApproval: (input: PolishInput): Promise<{ ok: true; result: PolishResult } | { ok: false; error: string }> => ipcRenderer.invoke('approval:polish', input),
  templateGet: (): Promise<TemplateInfo | null> => ipcRenderer.invoke('template:get'),
  templateAnalyze: (file: { name: string; data: Uint8Array }, fields: FieldDef[]): Promise<TemplateResult> => ipcRenderer.invoke('template:analyze', file, fields),
  templateSetMapping: (mapping: Record<string, string | null>): Promise<boolean> => ipcRenderer.invoke('template:mapping', mapping),
  templateClear: (): Promise<boolean> => ipcRenderer.invoke('template:clear'),
  templatePreview: (values: Record<string, string>): Promise<TemplatePreviewResult> => ipcRenderer.invoke('template:preview', values),
  templateFill: (values: Record<string, string>): Promise<TemplateFillResult> => ipcRenderer.invoke('template:fill', values),
  browserInput: (input: BrowserInput) => ipcRenderer.invoke('browser:input', input),
  browserBack: (slot: Slot) => ipcRenderer.invoke('browser:back', slot),
  openExternal: (url: string) => ipcRenderer.invoke('browser:openExternal', url)
};

export type DoldariApi = typeof api;
contextBridge.exposeInMainWorld('doldari', api);
