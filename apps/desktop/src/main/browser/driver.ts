// 브라우저 드라이버 인터페이스 (구현: 앱 안 내장 브라우저 ElectronDriver). 에이전트 도구는 이 인터페이스만 쓴다.
import type { Slot } from '@shared/types';

export interface BrowserDriver {
  readonly slot: Slot;
  readonly kind: 'electron';
  /** handoff 이후 click/fill 금지 */
  locked: boolean;
  navigate(url: string): Promise<string>;
  /** 접근성 트리 + [ref=…] */
  snapshot(): Promise<string>;
  click(ref: string): Promise<string>;
  fill(ref: string, text: string): Promise<string>;
  /** <select>에서 옵션 고르기 (보이는 글자 또는 value) */
  selectOption(ref: string, option: string): Promise<string>;
  /** 페이지 컨텍스트에서 식을 평가하고 JSON으로 돌려받는다 */
  evaluate<T>(expression: string): Promise<T>;
  /** 현재 화면 JPEG */
  screenshot(): Promise<Buffer | null>;
  url(): Promise<string>;
  title(): Promise<string>;
  back(): Promise<void>;
  reset(): Promise<void>;
  close(): Promise<void>;
  /** 가견적서 PDF 받기: PDF 링크 URL, 링크·버튼 ref (버튼이면 눌러서 내려오는 PDF를 받는다) */
  downloadPdf(target: { ref?: string; url?: string }): Promise<import('./pdf').PdfFile>;
  /** 지금 화면(인쇄용 견적서 페이지)을 PDF로 저장 */
  printPdf(): Promise<import('./pdf').PdfFile>;
  /** 다른 출처 iframe(옵션·가격 계산기 등)의 보이는 글자. 지원하지 않으면 없음 */
  frameTexts?(): Promise<{ host: string; text: string }[]>;
}

export class ToolError extends Error {}
