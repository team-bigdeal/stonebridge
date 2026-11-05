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
  region?: string;
  notes?: string;
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
  | 'failed';

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
  | { id: string; kind: 'vendors' }
  | { id: string; kind: 'mail'; draft: MailDraft }
  | { id: string; kind: 'upload'; vendorId: VendorId }
  | { id: string; kind: 'compare' }
  | { id: string; kind: 'browser'; slot: Slot; title: string }
  | { id: string; kind: 'docs' }
  | { id: string; kind: 'report' };

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
  | 'vendors'
  | 'vendor_status'
  | 'timeline'
  | 'mail'
  | 'browser'
  | 'notice'
  | 'original'
  | 'backend'
  | 'history'
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
