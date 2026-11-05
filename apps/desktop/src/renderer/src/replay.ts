// 견적 세션 화면 관리.
// - 여러 견적 세션이 main에서 동시에 돈다. 화면은 그중 하나(focusedSid)만 그리고,
//   다른 세션은 마지막 화면(보관본)과 그 뒤에 온 이벤트를 모아 두었다가 그 세션으로 바꿀 때 반영한다.
// - 지금 견적 화면은 계속 <id>.session.json으로 저장해 두고 (autosave)
// - 히스토리를 누르면 그 세션 화면을 그대로 다시 그린다 (보기 전용). 그동안 들어온 이벤트는 돌아올 때 반영한다.
import type { AgentEvent, HistoryEventPayload, HistoryRecord, SessionSnapshot, Slot, Stage, TimelineItem, VendorId, VendorStatus } from '@shared/types';
import { pendingLive, useStore, type SessionMeta } from '@/store';
import { useFrames, pushFrame } from '@/components/workspace/LiveFrame';
import { resendViews } from '@/components/workspace/viewManager';

const KEYS = ['stage', 'requirements', 'timeline', 'quotes', 'vendors', 'vendorStatus', 'steps', 'browsers', 'sources', 'mails', 'originals', 'runs', 'runOf', 'rankLog'] as const;

function takeSnapshot(): SessionSnapshot {
  const s = useStore.getState();
  return {
    version: 1,
    ...(Object.fromEntries(KEYS.map((k) => [k, s[k]])) as Omit<SessionSnapshot, 'version' | 'frames'>),
    frames: useFrames.getState().frames
  };
}

function applySnapshot(snap: SessionSnapshot) {
  useStore.setState({
    ...Object.fromEntries(KEYS.map((k) => [k, snap[k]])),
    runs: snap.runs ?? {},
    runOf: snap.runOf ?? {},
    rankLog: snap.rankLog ?? [],
    busy: false,
    flash: null,
    viewer: null,
    expanded: null
  });
  useFrames.setState({ frames: snap.frames ?? {} });
}

/** 세션 파일이 없는 예전 기록: 저장된 견적으로 대화 흐름을 다시 꾸민다 */
function fromRecord(r: HistoryRecord): SessionSnapshot {
  const id = (k: string) => `${r.id}-${k}`;
  const timeline: TimelineItem[] = [
    { id: id('user'), kind: 'user', text: `${r.requirements.item} ${r.requirements.quantity.toLocaleString('ko-KR')}개 견적` },
    { id: id('req'), kind: 'requirements' },
    // 비교 전에 멈춘 검색은 비교·견적서 카드를 만들지 않는다
    ...(r.incomplete
      ? []
      : ([
          { id: id('compare'), kind: 'compare' },
          { id: id('report'), kind: 'report' }
        ] as TimelineItem[]))
  ];
  return {
    version: 1,
    stage: r.incomplete ? 'search' : 'questions',
    requirements: r.requirements,
    timeline,
    quotes: r.quotes,
    vendors: r.vendors,
    vendorStatus: Object.fromEntries(r.vendors.map((v) => [v.id, 'done'])),
    steps: {},
    browsers: {},
    sources: [],
    mails: [],
    originals: r.originals,
    frames: {},
    runs: {},
    runOf: {}
  };
}

// ─── 보고 있지 않은 세션 ───────────────────────────────────────

/** 다른 세션의 마지막 화면 + 그 뒤에 온 이벤트·화면 이미지 */
interface Parked {
  snap?: SessionSnapshot;
  extra?: { reqReady: boolean; reqAsking: boolean; busy: boolean; liveId: string | null };
  pending: AgentEvent[];
  frames: Partial<Record<Slot, string>>;
}
const parked = new Map<string, Parked>();
const parkedOf = (sid: string) => {
  let p = parked.get(sid);
  if (!p) parked.set(sid, (p = { pending: [], frames: {} }));
  return p;
};

/** 사이드바 표시용 세션 요약을 이벤트로 갱신 */
function track(ev: AgentEvent) {
  if (!ev.sid) return;
  const s = useStore.getState();
  const meta: SessionMeta = s.sessions[ev.sid] ?? { recordId: null, stage: 'interview', vendorStatus: {} };
  let next = meta;
  if (ev.type === 'stage') next = { ...meta, stage: ev.payload as Stage };
  else if (ev.type === 'vendor_status') next = { ...meta, vendorStatus: { ...meta.vendorStatus, [ev.vendorId as VendorId]: ev.payload as VendorStatus } };
  else if (ev.type === 'revised') next = { ...meta, vendorStatus: {} };
  else if (ev.type === 'history' && (ev.payload as HistoryEventPayload).kind === 'saved') next = { ...meta, recordId: (ev.payload as HistoryEventPayload).id };
  if (next !== meta || !s.sessions[ev.sid]) useStore.setState({ sessions: { ...s.sessions, [ev.sid]: next } });
}

/** main 이벤트를 세션별로 나눠 받는다 (App이 onEvent로 연결) */
export function routeEvent(ev: AgentEvent) {
  const s = useStore.getState();
  // 처음 받은 세션이 화면이 보는 세션
  if (ev.sid && !s.focusedSid) useStore.setState({ focusedSid: ev.sid });
  const focused = useStore.getState().focusedSid;
  track(ev);
  if (ev.type === 'history') {
    const h = ev.payload as HistoryEventPayload;
    // 다른 세션 기록이 지워지면 main이 그 세션을 없앤다 → 화면에서도 뺀다
    if (h.kind === 'deleted') {
      const gone = Object.entries(useStore.getState().sessions).find(([sid, m]) => sid !== focused && m.recordId === h.id)?.[0];
      if (gone) {
        parked.delete(gone);
        const { [gone]: _drop, ...rest } = useStore.getState().sessions;
        useStore.setState({ sessions: rest });
      }
    }
    if (ev.sid && ev.sid !== focused) {
      useStore.setState({ historyRev: useStore.getState().historyRev + 1 });
      return;
    }
  }
  if (ev.sid && ev.sid !== focused) {
    parkedOf(ev.sid).pending.push(ev);
    return;
  }
  s.handle(ev);
}

/** 화면 이미지도 세션별로 */
export function routeFrame(f: { sid: string; slot: Slot; data: string }) {
  const focused = useStore.getState().focusedSid;
  if (!focused || f.sid === focused) pushFrame(f.slot, f.data);
  else parkedOf(f.sid).frames[f.slot] = f.data;
}

/** 지금 보고 있는 세션 화면을 보관해 둔다 (지난 견적을 보는 중이면 그 전에 보관해 둔 지금 견적) */
function parkFocused() {
  const s = useStore.getState();
  if (!s.focusedSid) return;
  const snap = s.replay ? stash : takeSnapshot();
  if (!snap) return;
  const p = parkedOf(s.focusedSid);
  p.snap = snap;
  p.extra = s.replay ? stashExtra ?? undefined : { reqReady: s.reqReady, reqAsking: s.reqAsking, busy: s.busy, liveId: s.liveId };
  p.pending.push(...pendingLive.splice(0));
  stash = null;
  stashExtra = null;
  // 보관한 화면도 세션 파일로 남긴다 (보고 있지 않는 동안은 autosave가 돌지 않음)
  const id = p.extra?.liveId;
  if (id) void window.doldari.historySaveSession(id, snap);
}

/** 보관해 둔 세션을 화면에 올리고, 그동안 온 이벤트를 반영한다 */
function unpark(sid: string) {
  const p = parked.get(sid);
  parked.delete(sid);
  const meta = useStore.getState().sessions[sid];
  if (p?.snap) {
    applySnapshot(p.snap);
    useStore.setState({ ...(p.extra ?? {}), replay: null, focusedSid: sid, liveId: p.extra?.liveId ?? meta?.recordId ?? null });
  } else {
    useStore.getState().resetAll();
    useFrames.setState({ frames: {} });
    useStore.setState({ focusedSid: sid, liveId: meta?.recordId ?? null });
  }
  for (const [slot, data] of Object.entries(p?.frames ?? {})) pushFrame(slot as Slot, data);
  const handle = useStore.getState().handle;
  for (const ev of p?.pending ?? []) handle(ev);
}

/** 다른 견적 세션으로 화면을 바꾼다 */
export async function switchSession(sid: string) {
  const s = useStore.getState();
  if (sid === s.focusedSid) {
    if (s.replay) exitReplay();
    return;
  }
  if (!(await window.doldari.focusSession(sid))) return;
  parkFocused();
  unpark(sid);
  resendViews();
}

/** 이 기록을 돌리고 있는 세션 */
const sessionOfRecord = (id: string) => Object.entries(useStore.getState().sessions).find(([, m]) => m.recordId === id)?.[0];

// ─── 지난 견적 보기 / 이어 가기 / 새 견적 ──────────────────────

let stash: SessionSnapshot | null = null;
let stashExtra: Parked['extra'] | null = null;

export async function openReplay(id: string) {
  const s = useStore.getState();
  // 지금 보는 세션의 기록이면 지금 화면으로
  if (id === s.liveId) {
    if (s.replay) exitReplay();
    return;
  }
  // 다른 세션이 돌리고 있는 기록이면 그 세션으로 바꾼다
  const running = sessionOfRecord(id);
  if (running) return switchSession(running);
  const snap = (await window.doldari.historyGetSession(id)) ?? (await window.doldari.historyGet(id).then((r) => (r ? fromRecord(r) : null)));
  if (!snap) {
    s.handle({ type: 'notice', at: new Date().toISOString(), message: '이 기록을 열 수 없어요.' });
    return;
  }
  if (!useStore.getState().replay) {
    stash = takeSnapshot();
    stashExtra = { reqReady: s.reqReady, reqAsking: s.reqAsking, busy: s.busy, liveId: s.liveId };
  }
  applySnapshot(snap);
  useStore.setState({ replay: { id } });
}

/** 보고 있는 지난 견적을 이어서 하기: main이 새 세션에서 그 견적을 되살리고, 화면은 보던 그대로 그 세션이 된다.
 *  하던 견적은 멈추지 않고 다른 세션으로 계속 돈다 */
export async function resumeReplay() {
  const s = useStore.getState();
  const id = s.replay?.id;
  if (!id) return;
  const r = await window.doldari.historyResume(id).catch(() => null);
  if (!r?.ok || !r.sid) {
    s.handle({ type: 'notice', at: new Date().toISOString(), message: r?.message ?? '이 견적을 이어서 할 수 없어요.' });
    return;
  }
  const shown = takeSnapshot();
  parkFocused();
  // 되살린 세션은 아직 저장 이벤트가 없으므로 어느 기록인지 직접 적어 둔다 (사이드바에서 다시 누르면 이 세션으로)
  const sessions = useStore.getState().sessions;
  useStore.setState({ sessions: { ...sessions, [r.sid]: { ...(sessions[r.sid] ?? { stage: 'draft', vendorStatus: {} }), recordId: id } } });
  if (parked.get(r.sid)?.snap) {
    // 이미 다른 세션이 이어서 하던 기록
    unpark(r.sid);
  } else {
    applySnapshot(shown);
    const p = parked.get(r.sid);
    parked.delete(r.sid);
    useStore.setState({ replay: null, focusedSid: r.sid, liveId: id, busy: false });
    const handle = useStore.getState().handle;
    for (const ev of p?.pending ?? []) handle(ev);
  }
  resendViews();
}

/** 새 견적: 진행 중인 견적은 다른 세션으로 계속 두고 빈 화면에서 시작 */
export async function newSession() {
  const s = useStore.getState();
  const r = await window.doldari.reset();
  if (r.sid === s.focusedSid) {
    // main이 그 자리에서 비웠다 (아직 기록이 없던 대화)
    stash = null;
    stashExtra = null;
    pendingLive.splice(0);
    useStore.getState().resetAll();
    return;
  }
  parkFocused();
  unpark(r.sid);
  resendViews();
}

/** 지금 견적 화면으로 돌아오고, 보는 동안 쌓인 이벤트를 반영 */
export function exitReplay() {
  if (!useStore.getState().replay) return;
  if (stash) applySnapshot(stash);
  if (stashExtra) useStore.setState(stashExtra);
  stash = null;
  stashExtra = null;
  useStore.setState({ replay: null });
  const events = pendingLive.splice(0);
  const handle = useStore.getState().handle;
  for (const ev of events) handle(ev);
}

/** 지금 견적이 히스토리에 들어간 뒤부터 화면이 바뀔 때마다 세션 파일로 저장 */
export function startAutosave() {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    const s = useStore.getState();
    if (s.replay || !s.liveId) return;
    if (timer) clearTimeout(timer);
    const id = s.liveId;
    timer = setTimeout(() => {
      timer = null;
      const now = useStore.getState();
      if (now.replay || now.liveId !== id) return;
      void window.doldari.historySaveSession(id, takeSnapshot());
    }, 1500);
  };
  const off1 = useStore.subscribe((s, p) => {
    if (s.liveId !== p.liveId || KEYS.some((k) => s[k] !== p[k])) schedule();
  });
  const off2 = useFrames.subscribe(schedule);
  return () => {
    off1();
    off2();
  };
}
