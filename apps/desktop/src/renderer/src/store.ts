// renderer 상태 (zustand). main 이벤트를 받아 갱신한다.
import { create } from 'zustand';
import type {
  AgentEvent, AgentStep, AppConfig, BrowserState, FieldKey, HistoryEventPayload, MailRecord, Quote, QuoteOriginal, QuoteUpdatePayload,
  Requirements, RunSummary, Slot, Source, Stage, TimelineItem, VendorId, VendorInfo, VendorStatus
} from '@shared/types';

export type SourceEntry = Source & { vendorId: VendorId; field: FieldKey };
export interface Notice { id: number; message: string; vendorId?: VendorId }

interface State {
  config: AppConfig | null;
  stage: Stage;
  requirements: Partial<Requirements> | null;
  /** 지금 조건으로 검색을 시작할 수 있는지 (인터뷰가 판단) */
  reqReady: boolean;
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
  /** 왼쪽 히스토리 사이드 탭 */
  sidebarOpen: boolean;
  /** 히스토리가 바뀔 때마다 올라간다 (사이드 탭이 목록을 다시 읽음) */
  historyRev: number;
  /** 히스토리에서 연 견적 한 건 (상세 창) */
  /** 히스토리에서 연 지난 견적 (보기 전용). null이면 지금 견적 */
  replay: { id: string } | null;
  /** 지금 진행 중인 견적의 히스토리 id (첫 저장 뒤부터) */
  liveId: string | null;
  expanded: Slot | null;
  originals: Partial<Record<VendorId, QuoteOriginal[]>>;
  backend: 'aside' | 'electron' | null;
  viewer: { kind: 'vendor'; id: VendorId } | { kind: 'integrated' } | null;
  set: (p: Partial<State>) => void;
  push: (item: TimelineItem) => void;
  handle: (ev: AgentEvent) => void;
  resetAll: () => void;
}

let noticeId = 0;
/** replay 중에 쌓인 지금 견적의 이벤트 */
export const pendingLive: AgentEvent[] = [];
/** 조건 바꾸기로 화면을 비우기 직전에 부르는 훅 (replay.ts가 이전 검색 화면을 기록에 바로 저장) */
let beforeRevised: (() => void) | null = null;
export const setBeforeRevised = (fn: (() => void) | null) => {
  beforeRevised = fn;
};
/** 사이드 탭 열림 상태는 이 컴퓨터에 기억 (저장소를 못 쓰면 열린 상태) */
function readSidebar() {
  try {
    return localStorage.getItem('doldari.sidebar') !== 'closed';
  } catch {
    return true;
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
  timeline: [
    { id: 'hello', kind: 'assistant', text: '안녕하세요, 돌다리예요. 어떤 견적이 필요하세요?\n말씀해 주시면 웹에서 업체를 찾아 직접 사이트를 돌아보고, 숨은 비용까지 더한 견적을 비교해 드릴게요.' }
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
  viewer: null,
  replay: null as { id: string } | null,
  liveId: null as string | null
});

export const useStore = create<State>((set, get) => ({
  config: null,
  settingsOpen: false,
  sidebarOpen: readSidebar(),
  historyRev: 0,
  backend: null,
  ...initial(),
  set: (p) => set(p),
  push: (item) => set((s) => ({ timeline: [...s.timeline, item] })),
  resetAll: () => set({ ...initial() }),
  handle: (ev) => {
    const s = get();
    // 지난 견적을 보는 동안 들어온 지금 견적의 이벤트는 모아 뒀다가 돌아올 때 반영
    if (s.replay && ev.type !== 'history' && ev.type !== 'backend' && !(ev.type === 'notice' && !ev.vendorId && !ev.payload)) {
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
        set({ quotes: { ...s.quotes, [quote.vendorId]: quote }, flash: field ? { vendorId: quote.vendorId, field, at: Date.now() } : s.flash });
        break;
      }
      case 'source':
        set({ sources: [...s.sources, ev.payload as SourceEntry] });
        break;
      case 'requirements':
        set({ requirements: ev.payload as Partial<Requirements> });
        break;
      case 'requirements_ready':
        set({ reqReady: Boolean(ev.payload) });
        break;
      case 'revised': {
        // 비우기 전에 이전 검색 화면을 그 기록에 저장하고, 이후 화면은 새 기록으로 (이전 기록을 덮어쓰지 않게)
        beforeRevised?.();
        set({ liveId: null });
        // 이전 검색 화면(브라우저·비교·메일 카드)은 지우고 대화와 요약 기록만 남긴다
        const keep = s.timeline.filter((t) => t.kind === 'user' || t.kind === 'assistant' || t.kind === 'history');
        set({
          timeline: [...keep, { id: crypto.randomUUID(), kind: 'history', summary: ev.payload as RunSummary }],
          quotes: {},
          flash: null,
          vendors: [],
          vendorStatus: {},
          steps: {},
          browsers: {},
          sources: [],
          originals: {},
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
        const o = ev.payload as QuoteOriginal;
        const list = (s.originals[o.vendorId] ?? []).filter((x) => !(o.url && x.url === o.url));
        set({ originals: { ...s.originals, [o.vendorId]: [...list, o].slice(-4) } });
        break;
      }
      case 'history': {
        const h = ev.payload as HistoryEventPayload;
        set({ historyRev: s.historyRev + 1, liveId: h.kind === 'saved' ? h.id : s.liveId === h.id ? null : s.liveId });
        break;
      }
      case 'backend':
        set((st) => ({ backend: ev.payload as 'aside' | 'electron' | null, config: st.config ? { ...st.config, browser: ev.payload as 'aside' | 'electron' | null } : st.config }));
        break;
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
export const ANGLE_LABEL: Record<VendorId, string> = { A: '전문 업체·공식몰', B: '쇼핑몰·오픈마켓', C: '시공·설치 업체' };

export const STATUS_LABEL: Record<VendorStatus, string> = {
  idle: '대기',
  browsing: '탐색 중',
  needs_mail: '메일 승인 필요',
  waiting_reply: '회신 대기',
  needs_file: '견적서 업로드 필요',
  needs_user: '직접 확인 필요',
  parsing: '분석 중',
  done: '완료',
  failed: '실패'
};

export const clock = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
export const vendorOf = (id: VendorId) => useStore.getState().vendors.find((v) => v.id === id);
