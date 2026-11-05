// 회사 품의서 양식 (업로드한 파일에 값을 채워 넣기)
export type TemplateKind = 'docx' | 'xlsx' | 'hwpx' | 'pdf';

/** 양식 안의 채울 자리 (빈 칸, 입력란, {{표시}}) */
export interface TemplateSlot {
  id: string;
  /** 자리 옆·위의 라벨 (예: "기안부서") */
  label: string;
  /** 표 위치 같은 보조 설명 */
  context?: string;
  /** 지금 들어 있는 글자 (자리표시 문구) */
  current?: string;
}

export interface TemplateInfo {
  name: string;
  kind: TemplateKind;
  slots: TemplateSlot[];
  /** 자리 id → 품의서 항목 key (null이면 비워 둠) */
  mapping: Record<string, string | null>;
  mappedBy: 'ai' | 'keyword' | 'saved';
}

export interface FieldDef {
  key: string;
  label: string;
}

export type TemplateResult = { ok: true; template: TemplateInfo } | { ok: false; error: string };
/** 채운 양식 미리보기: docx·pdf는 파일 바이트, xlsx·hwpx는 HTML (칸은 id값 마커) */
export type TemplatePreviewResult = { ok: true; kind: TemplateKind; bytes?: Uint8Array; html?: string } | { ok: false; error: string };
export type TemplateFillResult = { ok: boolean; path?: string; error?: string; skipped?: string[] };

/** 라벨 글자로 항목을 짐작 (AI를 못 쓸 때의 기본 매핑). 앞쪽 규칙이 우선 */
const GUESS: [RegExp, string][] = [
  [/문서\s*번호|문서번호/, 'docNo'],
  [/기안\s*일|작성\s*일|^일\s*자|날\s*짜/, 'date'],
  [/기안\s*부서|부\s*서|소\s*속/, 'dept'],
  [/기안\s*자|작성\s*자|^성\s*명|담당자/, 'author'],
  [/제\s*목|건\s*명|품\s*의\s*명/, 'title'],
  [/목\s*적|사\s*유|취\s*지|개\s*요|배\s*경/, 'purpose'],
  [/선정\s*사유|추천/, 'reasons'],
  [/공급\s*가/, 'supply'],
  [/부가\s*세|VAT/i, 'vat'],
  [/한글|금\s*액\s*\(?\s*한글|금\s*[일이삼사오육칠팔구십]/, 'totalKorean'],
  [/합\s*계|총\s*액|소요\s*예산|총\s*금액|구매\s*금액/, 'total'],
  [/예산\s*잔|잔\s*액/, 'remaining'],
  [/예\s*산/, 'budgetMax'],
  [/납\s*기|납품\s*기한|인도\s*시기/, 'delivery'],
  [/결제|지급\s*조건|대금/, 'payment'],
  [/인도\s*장소|납품\s*장소|장\s*소/, 'place'],
  [/업\s*체\s*명|거래처|공급\s*자|구매처|선정\s*업체/, 'vendorName'],
  [/업체\s*비교|비교/, 'vendors_text'],
  [/확인\s*필요|특이|기타|비고|참고/, 'checks'],
  [/붙\s*임|첨\s*부|근거|출처/, 'evidence_text'],
  [/품\s*명|품\s*목|내\s*용/, 'items_text']
];
export function guessField(label: string, keys: Set<string>): string | null {
  for (const [re, key] of GUESS) if (re.test(label) && keys.has(key)) return key;
  return null;
}
