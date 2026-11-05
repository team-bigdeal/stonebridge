// 사이트가 내주는 가견적서 PDF 받기 (드라이버 공통 도우미).
// 안전: PDF(%PDF- 로 시작)만 받고, 크기를 제한하고, 파일은 메모리로만 다룬다 (열거나 실행하지 않음).
import type { BrowserDriver } from './driver';
import { ToolError } from './driver';

export const MAX_PDF_BYTES = 15 * 1024 * 1024;

export interface PdfFile {
  data: Buffer;
  name: string;
  url: string;
}

export const isPdf = (b: Buffer) => b.length > 5 && b.subarray(0, 5).toString('latin1') === '%PDF-';

/** URL·제목에서 파일 이름 */
export function pdfName(url: string, fallback = '가견적서'): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
    if (/\.pdf$/i.test(last)) return last;
  } catch {
    /* 무시 */
  }
  return `${fallback.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || '가견적서'}.pdf`;
}

/** 받은 바이트가 PDF인지·너무 크지 않은지 확인 */
export function checkPdf(data: Buffer, url: string, name?: string): PdfFile {
  if (data.length > MAX_PDF_BYTES) throw new ToolError(`파일이 너무 큽니다 (${Math.round(data.length / 1024 / 1024)}MB). 15MB 이하 PDF만 받습니다.`);
  if (!isPdf(data)) throw new ToolError('받은 파일이 PDF가 아닙니다. 견적서 PDF 링크나 버튼인지 확인하세요.');
  return { data, url, name: name && /\.pdf$/i.test(name) ? name : pdfName(url) };
}

/** 지금 탭이 PDF를 보여 주는 중인지 (클릭 뒤 PDF로 이동한 경우) */
export async function showingPdf(d: BrowserDriver): Promise<string | null> {
  const url = await d.url().catch(() => '');
  if (!/^https?:/.test(url)) return null;
  if (/\.pdf(\?|#|$)/i.test(url)) return url;
  const ct = await d.evaluate<string>('document.contentType').catch(() => '');
  return ct === 'application/pdf' ? url : null;
}
