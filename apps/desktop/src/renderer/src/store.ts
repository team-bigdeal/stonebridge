// renderer 상태 (zustand). main 이벤트를 받아 갱신한다.
import { create } from 'zustand';
import type {
  AgentEvent, AgentStep, AppConfig, BrowserState, FieldKey, HistoryEventPayload, MailRecord, Quote, QuoteOriginal, QuoteUpdatePayload,
  RankStep, Requirements, RunSnapshot, Slot, Source, Stage, TimelineItem, VendorId, VendorInfo, VendorStatus, SizesEventPayload } from '@shared/types';
import { addOriginal } from '@shared/originals';
import { confirmedSum } from '@shared/quote';

export type SourceEntry = Source & { vendorId: VendorId; field: FieldKey };
export interface Notice { id: number; message: string; vendorId?: VendorId }

interface State {
  config: AppConfig | null;
  stage: Stage;
  requirements: Partial<Requirements> | null;
  /** 지금 조건으로 검색을 시작할 수 있는지 (인터뷰가 판단) */
  reqReady: boolean;
  /** 인터뷰 질문이 아직 남아 있는지 (버튼을 "지금 바로 시작"으로) */
  reqAsking: boolean;
  timeline: TimelineItem[];
  busy: boolean;
  quotes: Partial<Record<VendorId, Quote>>;
  flash: { vendorId: VendorId; field: FieldKey; at: number } | null;
  vendors: VendorInfo[];
  vendorStatus: Partial<Record<VendorId, VendorStatus>>;
  steps: Partial<Record<Slot, AgentStep[]>>;
  browsers: Partial<Record<Slot, BrowserState>>;
  sources: SourceEntry[];
  mails: MailRecord[];
  notices: Notice[];
  settingsOpen: boolean;
  /** 설정 창을 열 때 먼저 보여 줄 탭 (없으면 필요한 곳부터) */
  settingsTab?: 'ai' | 'browser' | 'mail';
  /** 왼쪽 히스토리 사이드 탭 */
  sidebarOpen: boolean;
  /** 왼쪽 지난 견적·오른쪽 요구 조건 너비 (경계를 끌어 조절, 이 컴퓨터에 기억) */
  sidebarWidth: number;
  panelWidth: number;
  /** 히스토리가 바뀔 때마다 올라간다 (사이드 탭이 목록을 다시 읽음) */
  historyRev: number;
  /** 히스토리에서 연 견적 한 건 (상세 창) */
  /** 히스토리에서 연 지난 견적 (보기 전용). null이면 지금 견적 */
  replay: { id: string } | null;
  /** 지금 진행 중인 견적의 히스토리 id (첫 저장 뒤부터) */
  liveId: string | null;
  /** 조건을 바꾸기 전 검색들 */
  runs: Record<string, RunSnapshot>;
  /** 타임라인 항목 id → 이전 검색 id */
  runOf: Record<string, string>;
  expanded: Slot | null;
  originals: Partial<Record<VendorId, QuoteOriginal[]>>;
  /** 값이 하나씩 확정될 때마다의 견적 (순위 변동 다시 보기) */
  rankLog: RankStep[];
  /** scope가 있으면 이전 검색 카드에서 연 것 (그 검색의 값으로 보여 줌) */
  viewer: { kind: 'vendor'; id: VendorId; scope?: RunSnapshot } | { kind: 'integrated'; scope?: RunSnapshot } | { kind: 'approval'; scope?: RunSnapshot } | null;
  set: (p: Partial<State>) => void;
  push: (item: TimelineItem) => void;
  handle: (ev: AgentEvent) => void;
  resetAll: () => void;
}

let noticeId = 0;
/** replay 중에 쌓인 지금 견적의 이벤트 */
export const pendingLive: AgentEvent[] = [];
/** 브라우저 카드 화면(별도 store)을 읽고 비우는 훅. LiveFrame이 등록한다 (순환 import 방지) */
let frameIO: { get: () => Partial<Record<Slot, string>>; clear: () => void } = { get: () => ({}), clear: () => undefined };
export const setFrameIO = (io: typeof frameIO) => {
  frameIO = io;
};

/** 대화 안 이전 검색 카드가 해당하는 타임라인 종류 */
const RUN_KINDS = new Set<TimelineItem['kind']>(['requirements', 'search', 'vendors', 'browser', 'mail', 'upload', 'reply_file', 'compare', 'docs', 'report']);
/** 사이드 탭 열림 상태는 이 컴퓨터에 기억 (저장소를 못 쓰면 열린 상태) */
function readSidebar() {
  try {
    return localStorage.getItem('doldari.sidebar') !== 'closed';
  } catch {
    return true;
  }
}
export const SIDEBAR_WIDTH = { min: 200, max: 420, init: 256 };
export const PANEL_WIDTH = { min: 280, max: 560, init: 340 };
function readWidth(key: string, r: { min: number; max: number; init: number }) {
  try {
    const n = Number(localStorage.getItem(key));
    return n >= r.min && n <= r.max ? n : r.init;
  } catch {
    return r.init;
  }
}
export function saveWidth(key: 'doldari.sidebarWidth' | 'doldari.panelWidth', n: number) {
  try {
    localStorage.setItem(key, String(Math.round(n)));
  } catch {
    /* 무시 */
  }
}
export function saveSidebar(open: boolean) {
  try {
    localStorage.setItem('doldari.sidebar', open ? 'open' : 'closed');
  } catch {
    /* 무시 */
  }
}
const initial = () => ({
  stage: 'interview' as Stage,
  requirements: null,
  reqReady: false,
  reqAsking: false,
  timeline: [
    { id: 'hello', kind: 'assistant', text: '안녕하세요, 돌다리예요. 어떤 견적이 필요하세요?' }
  ] as TimelineItem[],
  busy: false,
  quotes: {},
  flash: null,
  vendors: [],
  vendorStatus: {},
  steps: {},
  browsers: {},
  sources: [],
  mails: [],
  notices: [],
  expanded: null,
  originals: {},
  rankLog: [] as RankStep[],
  viewer: null,
  replay: null as { id: string } | null,
  liveId: null as string | null,
  runs: {} as Record<string, RunSnapshot>,
  runOf: {} as Record<string, string>
});

export const useStore = create<State>((set, get) => ({
  config: null,
  settingsOpen: false,
  sidebarOpen: readSidebar(),
  sidebarWidth: readWidth('doldari.sidebarWidth', SIDEBAR_WIDTH),
  panelWidth: readWidth('doldari.panelWidth', PANEL_WIDTH),
  historyRev: 0,
  ...initial(),
  set: (p) => set(p),
  push: (item) => set((s) => ({ timeline: [...s.timeline, item] })),
  resetAll: () => set({ ...initial() }),
  handle: (ev) => {
    const s = get();
    // 지난 견적을 보는 동안 들어온 지금 견적의 이벤트는 모아 뒀다가 돌아올 때 반영
    if (s.replay && ev.type !== 'history' && !(ev.type === 'notice' && !ev.vendorId && !ev.payload)) {
      pendingLive.push(ev);
      return;
    }
    switch (ev.type) {
      case 'stage':
        set({ stage: ev.payload as Stage });
        break;
      case 'busy':
        set({ busy: Boolean(ev.payload) });
        break;
      case 'timeline':
        set({ timeline: [...s.timeline, ev.payload as TimelineItem] });
        break;
      case 'sizes': {
        // 사이즈 조사 카드: 같은 id의 항목을 새 값으로 바꾼다
        const p = ev.payload as SizesEventPayload;
        set({ timeline: s.timeline.map((t) => (t.kind === 'sizes' && t.id === p.id ? { ...t, status: p.status, options: p.options } : t)) });
        break;
      }
      case 'step': {
        const st = ev.payload as AgentStep;
        const list = s.steps[st.slot] ?? [];
        const idx = list.findIndex((x) => x.id === st.id);
        const next = idx >= 0 ? list.map((x) => (x.id === st.id ? st : x)) : [...list, st];
        set({ steps: { ...s.steps, [st.slot]: next } });
        break;
      }
      case 'quote_update': {
        const { quote, field } = ev.payload as QuoteUpdatePayload;
        const quotes = { ...s.quotes, [quote.vendorId]: quote };
        const at = Date.now();
        // 값이 확정되거나(field) 추가 비용 등으로 합계가 바뀌면 순위 변동 기록에 남긴다
        const req = (s.requirements?.deadline ? s.requirements : null) as Requirements | null;
        const prev = s.quotes[quote.vendorId];
        const sumChanged = Boolean(prev && prev.listedPrice.value !== null && confirmedSum(prev, req) !== confirmedSum(quote, req));
        set({
          quotes,
          flash: field ? { vendorId: quote.vendorId, field, at } : s.flash,
          rankLog: field || sumChanged ? [...s.rankLog, { at, vendorId: quote.vendorId, field, quotes }] : s.rankLog
        });
        break;
      }
      case 'source':
        set({ sources: [...s.sources, ev.payload as SourceEntry] });
        break;
      case 'requirements':
        set({ requirements: ev.payload as Partial<Requirements> });
        break;
      case 'requirements_ready': {
        const p = ev.payload as { ready: boolean; asking: boolean };
        set({ reqReady: p.ready, reqAsking: p.asking });
        break;
      }
      case 'revised': {
        // 이전 검색 카드(요구 조건·브라우저·비교·견적서·메일)는 대화에 그대로 두고, 그 시점 상태를 따로 얼려 둔다.
        // 새 검색은 그 아래로 이어진다.
        const runId = crypto.randomUUID();
        const snap: RunSnapshot = {
          stage: s.stage,
          requirements: s.requirements,
          quotes: s.quotes,
          vendors: s.vendors,
          vendorStatus: s.vendorStatus,
          steps: s.steps,
          browsers: s.browsers,
          sources: s.sources,
          originals: s.originals,
          rankLog: s.rankLog,
          frames: frameIO.get()
        };
        const runOf = { ...s.runOf };
        for (const t of s.timeline) if (RUN_KINDS.has(t.kind) && !runOf[t.id]) runOf[t.id] = runId;
        frameIO.clear();
        set({
          runs: { ...s.runs, [runId]: snap },
          runOf,
          quotes: {},
          flash: null,
          vendors: [],
          vendorStatus: {},
          steps: {},
          browsers: {},
          sources: [],
          originals: {},
          rankLog: [],
          expanded: null,
          viewer: null
        });
        break;
      }
      case 'vendors': {
        const next = ev.payload as VendorInfo[];
        // 업체가 바뀐 자리는 이전 업체의 원본을 비운다
        const originals = { ...s.originals };
        for (const v of s.vendors) {
          if (next.find((n) => n.id === v.id)?.url !== v.url) delete originals[v.id];
        }
        set({ vendors: next, originals });
        break;
      }
      case 'vendor_status':
        set({ vendorStatus: { ...s.vendorStatus, [ev.vendorId!]: ev.payload as VendorStatus } });
        break;
      case 'browser': {
        const b = ev.payload as BrowserState;
        set({ browsers: { ...s.browsers, [b.slot]: b } });
        break;
      }
      case 'original': {
        // 같은 원본·같은 웹 화면은 바꿔 끼우고, 넘치면 웹 화면부터 버린다 (받은 견적서는 남김)
        const o = ev.payload as QuoteOriginal;
        set({ originals: { ...s.originals, [o.vendorId]: addOriginal(s.originals[o.vendorId] ?? [], o) } });
        break;
      }
      case 'history': {
        const h = ev.payload as HistoryEventPayload;
        set({ historyRev: s.historyRev + 1, liveId: h.kind === 'saved' ? h.id : s.liveId === h.id ? null : s.liveId });
        break;
      }
      case 'mail':
        set({ mails: [...s.mails, ev.payload as MailRecord] });
        break;
      case 'notice': {
        const payload = ev.payload as { openSettings?: boolean } | undefined;
        const n = { id: ++noticeId, message: ev.message ?? '', vendorId: ev.vendorId };
        set({ notices: [...s.notices, n].slice(-4), settingsOpen: payload?.openSettings ? true : s.settingsOpen });
        setTimeout(() => set({ notices: get().notices.filter((x) => x.id !== n.id) }), 7000);
        break;
      }
    }
  }
}));

export const VENDOR_DOT: Record<VendorId, string> = { A: 'bg-va', B: 'bg-vb', C: 'bg-vc' };
export const VENDOR_TEXT: Record<VendorId, string> = { A: 'text-va', B: 'text-vb', C: 'text-vc' };
export const ANGLE_LABEL: Record<VendorId, string> = { A: '전문 업체·공식몰', B: '견적 계산·견적서 사이트', C: '시공·설치 업체' };

export const STATUS_LABEL: Record<VendorStatus, string> = {
  idle: '대기',
  browsing: '탐색 중',
  needs_mail: '메일 승인 필요',
  waiting_reply: '회신 대기',
  needs_file: '견적서 업로드 필요',
  needs_user: '직접 확인 필요',
  parsing: '분석 중',
  done: '완료',
  failed: '실패',
  stopped: '멈춤'
};

export const clock = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
export const vendorOf = (id: VendorId) => useStore.getState().vendors.find((v) => v.id === id);
