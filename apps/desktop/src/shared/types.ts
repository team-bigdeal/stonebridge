// main / preload / renderer가 함께 쓰는 데이터 모델

export type Stage = 'interview' | 'search' | 'collect' | 'compare' | 'questions' | 'draft';
export const STAGES: { id: Stage; label: string }[] = [
  { id: 'interview', label: '요구 조건' },
  { id: 'search', label: '업체 검색' },
  { id: 'collect', label: '견적 수집' },
  { id: 'compare', label: '비교' },
  { id: 'questions', label: '확인·추천' },
  { id: 'draft', label: '작성' }
];

export type VendorId = 'A' | 'B' | 'C';
export const VENDOR_IDS: VendorId[] = ['A', 'B', 'C'];

/** 브라우저 슬롯: 검색용 1개 + 업체별 3개 */
export type Slot = 'search' | VendorId;

/** 웹 검색으로 고른 업체 */
export interface VendorInfo {
  id: VendorId;
  name: string;
  url: string;
  reason: string;
  email?: string;
}

export interface Requirements {
  item: string;
  quantity: number;
  budgetMax: number;
  deadline: string; // ISO date
  needInstall: boolean;
  minWarrantyMonths: number;
  /** 배송이 필요한지 (방문 수령·현장 서비스면 false → 배송비를 묻지 않음). 없으면 필요로 본다 */
  needDelivery?: boolean;
  region?: string;
  notes?: string;
  /** 사용자가 이름으로 지정한 업체 (예: "와우프레스에서") */
  vendors?: string[];
  /** 지정한 업체에서만 받기 (true면 그 수만큼만 브라우저를 띄운다) */
  onlyVendors?: boolean;
}

export type Channel = 'web' | 'mail' | 'file';

export interface Source {
  channel: Channel;
  ref: string; // URL | mail messageId | 파일명
  snippet: string;
  capturedAt: string;
}

export interface Field<T> {
  value: T | null;
  source?: Source;
  status: 'found' | 'missing' | 'asked' | 'answered';
}

export const FIELD_KEYS = ['listedPrice', 'installFee', 'shippingFee', 'warrantyMonths', 'warrantyExtraFee', 'leadTimeDays'] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

export const FIELD_LABELS: Record<FieldKey, string> = {
  listedPrice: '표시가',
  installFee: '설치비',
  shippingFee: '배송비',
  warrantyMonths: 'A/S 기간',
  warrantyExtraFee: 'A/S 연장비',
  leadTimeDays: '납기'
};

/** 통일 견적서의 한 줄 */
export type LineKind = 'product' | 'install' | 'shipping' | 'warranty' | 'extra' | 'option';
export interface QuoteLine {
  kind: LineKind;
  name: string;
  spec?: string;
  qty: number;
  unitPrice: number | null;
  amount: number | null;
  note?: string;
  /** 총액에 들어가는 줄인지 (선택 옵션은 false) */
  counted: boolean;
  source?: Source;
}

export interface SupplierInfo {
  name: string;
  url?: string;
  bizNo?: string;
  ceo?: string;
  phone?: string;
  email?: string;
  address?: string;
}

export interface QuoteTerms {
  validity?: string;
  /** 납기 원문 (예: "제작 7영업일 + 택배 1~2일") */
  leadTimeText?: string;
  delivery?: string;
  payment?: string;
  place?: string;
}

/** 견적서 원본 (웹 화면 캡처·메일 본문·업로드 파일) */
export interface QuoteOriginal {
  id: string;
  vendorId: VendorId;
  channel: Channel;
  title: string;
  url?: string;
  image?: string; // data URL
  text?: string;
  fileName?: string;
  fileData?: string; // data URL
  mime?: string;
  capturedAt: string;
}

/** 에이전트·추출기가 숫자 필드 외에 함께 보고하는 정보 */
export interface QuoteMeta {
  /** 표시가가 몇 개(매) 기준 가격인지 (1000매 묶음이면 1000) */
  priceQty?: number;
  productName?: string;
  spec?: string;
  supplier?: Partial<SupplierInfo>;
  terms?: QuoteTerms;
  extras?: { name: string; amount: number; required: boolean; note?: string; source?: Source }[];
  notes?: string[];
  /** 가격 재확인에서 기준 수량(1개·묶음·시트)을 확인하지 못함 → 추천에서 뺀다. 내용은 사유 */
  priceDoubt?: string;
}

export interface Quote {
  vendorId: VendorId;
  vendorName: string;
  channel: Channel;
  listedPrice: Field<number>;
  installFee: Field<number>;
  shippingFee: Field<number>;
  warrantyMonths: Field<number>;
  warrantyExtraFee: Field<number>;
  leadTimeDays: Field<number>;
  totalPrice: number | null;
  missing: string[];
  meta: QuoteMeta;
}

export interface ReportedField {
  value: number | string | null;
  snippet: string;
  vatIncluded?: boolean;
}
export type ReportedFields = Partial<Record<FieldKey, ReportedField>>;

export type VendorStatus =
  | 'idle'
  | 'browsing'
  | 'needs_mail'
  | 'waiting_reply'
  | 'needs_file'
  | 'needs_user'
  | 'parsing'
  | 'done'
  | 'failed'
  /** 사용자가 멈춤 (다시 시도로 이어서 할 수 있음) */
  | 'stopped';

export type MailKind = 'request' | 'question' | 'order';

export interface MailDraft {
  id: string;
  vendorId: VendorId;
  kind: MailKind;
  to: string;
  subject: string;
  body: string;
  fields?: FieldKey[];
  evidence?: (Source & { vendorId: VendorId; field: FieldKey })[];
  /** 발송 후 상태 */
  sent?: 'smtp' | 'external';
}

/** 문자·카카오톡으로 보낼 견적 요청 초안 (사용자가 복사하거나 앱을 열어 직접 보낸다) */
export interface MessageDraft {
  id: string;
  vendorId: VendorId;
  body: string;
  /** 숫자만 (문자 앱 열기용) */
  phone?: string;
  /** 카카오톡 채널·오픈채팅·네이버 톡톡 링크 */
  chatUrl?: string;
  /** 사이트에 적힌 연락 방법 원문 */
  contact?: string;
}

export interface MailRecord {
  id: string;
  direction: 'out' | 'in';
  vendorId: VendorId;
  kind: MailKind;
  to?: string;
  from?: string;
  subject: string;
  body: string;
  at: string;
}

export interface AppConfig {
  browser: 'aside' | 'electron' | null;
  /** 설정값: auto(Aside 우선) | electron(내장 브라우저) */
  browserPref: 'auto' | 'electron';
  hasApiKey: boolean;
  model: string;
  smtpConfigured: boolean;
  imapConfigured: boolean;
  smtpUser: string;
}

/** 에이전트 도구 호출 한 단계 (UI의 Tool step) */
export interface AgentStep {
  id: string;
  slot: Slot;
  tool: string;
  intent: string;
  status: 'running' | 'done' | 'error';
  detail?: string;
  at: string;
}

/** 대화 흐름에 끼워 넣는 카드 */
export type TimelineItem =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string }
  | { id: string; kind: 'requirements' }
  | { id: string; kind: 'search' }
  | { id: string; kind: 'vendors'; slots?: VendorId[] }
  | { id: string; kind: 'mail'; draft: MailDraft }
  | { id: string; kind: 'upload'; vendorId: VendorId; message?: MessageDraft }
  | { id: string; kind: 'compare' }
  | { id: string; kind: 'browser'; slot: Slot; title: string }
  | { id: string; kind: 'docs' }
  | { id: string; kind: 'report' }
  | { id: string; kind: 'history'; summary: RunSummary }
  | { id: string; kind: 'sizes'; item: string; status: SizeScanStatus; options: SizeOption[] };

/** 사이트를 돌며 모은 사이즈 선택지 (실제 크기로 그려서 고르게 한다) */
export interface SizeOption {
  /** 사이트에 적힌 이름 (예: "일반 명함", "90×50") */
  label: string;
  widthMm: number;
  heightMm: number;
  /** 이 사이즈를 파는 업체 */
  vendors: { name: string; url: string }[];
  /** 가격대·용도 등 짧은 메모 */
  note?: string;
}
export type SizeScanStatus = 'searching' | 'done' | 'failed' | 'stopped';
export interface SizesEventPayload {
  id: string;
  status: SizeScanStatus;
  options: SizeOption[];
}

/** 조건 변경 전 검색 결과 요약 (화면은 지우고 기록만 남김) */
export interface RunSummary {
  requirements: Requirements;
  rows: { id: VendorId; name: string; url: string; channel: Channel; total: number | null; rank: number | null }[];
  recommended: VendorId | null;
  reasons: string[];
  at: string;
}

export interface BrowserState {
  slot: Slot;
  url: string;
  title: string;
  locked: boolean;
  /** 사용자가 직접 조작해야 하는 이유 (CAPTCHA, 로그인, 제출 직전) */
  handoff?: string;
}

export type AgentEventType =
  | 'stage'
  | 'step'
  | 'quote_update'
  | 'source'
  | 'requirements'
  | 'requirements_ready'
  | 'revised'
  | 'vendors'
  | 'vendor_status'
  | 'timeline'
  | 'mail'
  | 'browser'
  | 'notice'
  | 'original'
  | 'backend'
  | 'history'
  | 'sizes'
  | 'busy';

export interface AgentEvent {
  type: AgentEventType;
  vendorId?: VendorId;
  message?: string;
  payload?: unknown;
  at: string;
}

export interface QuoteUpdatePayload {
  quote: Quote;
  field?: FieldKey;
}

export interface BrowserInput {
  slot: Slot;
  type: 'click' | 'wheel' | 'text' | 'key';
  x?: number; // 0~1 정규화 좌표
  y?: number;
  deltaY?: number;
  text?: string;
  key?: string;
}

export type SettingsInput = Partial<Record<'ANTHROPIC_API_KEY' | 'ANTHROPIC_MODEL' | 'SMTP_USER' | 'SMTP_PASS' | 'IMAP_USER' | 'IMAP_PASS' | 'BROWSER_BACKEND', string>>;

/** 견적 히스토리: 견적 한 건을 통째로 보관 (main/history.ts) */
export interface HistoryRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  requirements: Requirements;
  vendors: VendorInfo[];
  quotes: Partial<Record<VendorId, Quote>>;
  originals: Partial<Record<VendorId, QuoteOriginal[]>>;
  recommendation?: { vendorId?: VendorId; vendorName?: string; total?: number; reasons: string[]; tentative: boolean };
}

export interface HistorySummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  item: string;
  quantity: number;
  vendorCount: number;
  pricedCount: number;
  best?: { name: string; total: number };
}

/** 견적 세션 화면 그대로 (대화·카드·브라우저 화면). 히스토리에서 열면 이걸로 다시 그린다 */
export interface SessionSnapshot {
  version: 1;
  stage: Stage;
  requirements: Partial<Requirements> | null;
  timeline: TimelineItem[];
  quotes: Partial<Record<VendorId, Quote>>;
  vendors: VendorInfo[];
  vendorStatus: Partial<Record<VendorId, VendorStatus>>;
  steps: Partial<Record<Slot, AgentStep[]>>;
  browsers: Partial<Record<Slot, BrowserState>>;
  sources: (Source & { vendorId: VendorId; field: FieldKey })[];
  mails: MailRecord[];
  originals: Partial<Record<VendorId, QuoteOriginal[]>>;
  /** 브라우저 카드의 마지막 화면 */
  frames: Partial<Record<Slot, string>>;
  /** 조건을 바꾸기 전 검색들 (대화 안에 그대로 남은 카드가 이 값으로 그려진다) */
  runs?: Record<string, RunSnapshot>;
  /** 타임라인 항목 id → 그 항목이 속한 이전 검색 id */
  runOf?: Record<string, string>;
}

/** 조건을 바꾸기 전 검색 한 번의 화면 상태 (카드는 대화에 그대로 남고 이 값으로 그린다) */
export interface RunSnapshot {
  stage: Stage;
  requirements: Partial<Requirements> | null;
  quotes: Partial<Record<VendorId, Quote>>;
  vendors: VendorInfo[];
  vendorStatus: Partial<Record<VendorId, VendorStatus>>;
  steps: Partial<Record<Slot, AgentStep[]>>;
  browsers: Partial<Record<Slot, BrowserState>>;
  sources: (Source & { vendorId: VendorId; field: FieldKey })[];
  originals: Partial<Record<VendorId, QuoteOriginal[]>>;
  frames: Partial<Record<Slot, string>>;
}

/** history 이벤트: 기록이 저장(saved)되거나 삭제(deleted)됨 */
export interface HistoryEventPayload {
  id: string;
  kind: 'saved' | 'deleted';
}
