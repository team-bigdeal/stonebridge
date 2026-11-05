// 히스토리 세션 다시 보기.
// - 지금 견적 화면을 계속 <id>.session.json으로 저장해 두고 (autosave)
// - 히스토리를 누르면 그 세션 화면을 그대로 다시 그린다 (보기 전용).
// - 그동안 지금 견적은 따로 보관해 두고, 들어온 이벤트는 돌아올 때 반영한다.
import type { HistoryRecord, SessionSnapshot, TimelineItem } from '@shared/types';
import { pendingLive, useStore } from '@/store';
import { useFrames } from '@/components/workspace/LiveFrame';

const KEYS = ['stage', 'requirements', 'timeline', 'quotes', 'vendors', 'vendorStatus', 'steps', 'browsers', 'sources', 'mails', 'originals', 'runs', 'runOf'] as const;

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
          { id: id('docs'), kind: 'docs' },
          { id: id('report'), kind: 'report' }
        ] as TimelineItem[]))
  ];
  return {
    version: 1,
    stage: 'questions',
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

let stash: SessionSnapshot | null = null;

export async function openReplay(id: string) {
  const s = useStore.getState();
  // 지금 견적을 누르면 지금 화면으로
  if (id === s.liveId) {
    if (s.replay) exitReplay();
    return;
  }
  const snap = (await window.doldari.historyGetSession(id)) ?? (await window.doldari.historyGet(id).then((r) => (r ? fromRecord(r) : null)));
  if (!snap) {
    s.handle({ type: 'notice', at: new Date().toISOString(), message: '이 기록을 열 수 없어요.' });
    return;
  }
  if (!useStore.getState().replay) stash = takeSnapshot();
  applySnapshot(snap);
  useStore.setState({ replay: { id } });
}

/** 보고 있는 지난 견적을 지금 견적으로 이어서 하기: main이 그 견적을 되살리고, 화면은 보던 그대로 지금 견적이 된다 */
export async function resumeReplay() {
  const s = useStore.getState();
  const id = s.replay?.id;
  if (!id) return;
  const r = await window.doldari.historyResume(id).catch(() => null);
  if (!r?.ok) {
    s.handle({ type: 'notice', at: new Date().toISOString(), message: r?.message ?? '이 견적을 이어서 할 수 없어요.' });
    return;
  }
  // 이전에 하던 견적(보관본)과 보는 동안 쌓인 그 견적의 이벤트는 버린다 (그 견적은 이미 히스토리에 저장됨)
  stash = null;
  pendingLive.splice(0);
  useStore.setState({ replay: null, liveId: id, busy: false });
}

/** 지금 견적 화면으로 돌아오고, 보는 동안 쌓인 이벤트를 반영 */
export function exitReplay() {
  if (!useStore.getState().replay) return;
  if (stash) applySnapshot(stash);
  stash = null;
  useStore.setState({ replay: null });
  const events = pendingLive.splice(0);
  const handle = useStore.getState().handle;
  for (const ev of events) handle(ev);
}

/** 새 견적: 보관해 둔 지금 견적도 버린다 */
export function dropReplay() {
  stash = null;
  pendingLive.splice(0);
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
