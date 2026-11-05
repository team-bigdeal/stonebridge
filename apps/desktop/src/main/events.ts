// main → renderer 이벤트
import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import type { AgentEvent, AgentEventType, AgentStep, Slot, Stage, TimelineItem, VendorId, VendorStatus } from '@shared/types';

let win: BrowserWindow | null = null;
export const bindWindow = (w: BrowserWindow) => (win = w);
export const getWindow = () => (win && !win.isDestroyed() ? win : null);
export const send = (channel: string, payload: unknown) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

export function emit(type: AgentEventType, fields: Omit<AgentEvent, 'type' | 'at'> = {}) {
  send('agent:event', { type, at: new Date().toISOString(), ...fields } satisfies AgentEvent);
}

/** 대화 흐름에 카드/메시지를 추가 */
type NewItem = TimelineItem extends infer T ? (T extends { id: string } ? Omit<T, 'id'> : never) : never;
export function timeline(item: NewItem) {
  emit('timeline', { payload: { id: randomUUID(), ...item } });
}
export const say = (text: string) => timeline({ kind: 'assistant', text });

/** 앱 공지 (오류·경고) */
export const notice = (message: string, vendorId?: VendorId) => {
  console.log(`[notice]${vendorId ? ` ${vendorId}` : ''} ${message}`);
  emit('notice', { message, vendorId });
};

export function step(slot: Slot, tool: string, intent: string) {
  const s: AgentStep = { id: randomUUID(), slot, tool, intent, status: 'running', at: new Date().toISOString() };
  emit('step', { payload: s });
  console.log(`[step] ${slot} ${intent}`);
  return (status: 'done' | 'error', detail?: string) => emit('step', { payload: { ...s, status, detail } });
}

export const setBusy = (busy: boolean) => emit('busy', { payload: busy });

let currentStage: Stage = 'interview';
const order: Stage[] = ['interview', 'search', 'collect', 'compare', 'questions', 'draft'];
export const getStage = () => currentStage;
export function setStage(stage: Stage, force = false) {
  if (!force && order.indexOf(stage) <= order.indexOf(currentStage)) return;
  currentStage = stage;
  emit('stage', { payload: stage });
}

const statuses: Partial<Record<VendorId, VendorStatus>> = {};
export const getVendorStatus = (id: VendorId) => statuses[id] ?? 'idle';
export function setVendorStatus(vendorId: VendorId, status: VendorStatus) {
  statuses[vendorId] = status;
  emit('vendor_status', { vendorId, payload: status });
}
export function resetStatuses() {
  for (const k of Object.keys(statuses)) delete statuses[k as VendorId];
}
