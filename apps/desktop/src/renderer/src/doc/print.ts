// 문서 컴포넌트를 독립 HTML로 만들어 PDF로 저장
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DOC_CSS } from './styles';

/** 이미 그려진 문서 HTML(화면에서 고친 내용 포함)을 PDF로 저장 */
export async function saveHtmlPdf(bodyHtml: string, fileName: string) {
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>@page{size:A4;margin:0}body{margin:0;background:#fff}${DOC_CSS}</style></head><body>${bodyHtml}</body></html>`;
  return window.doldari.savePdf(html, fileName);
}

export async function saveDocPdf(el: ReactElement, fileName: string) {
  return saveHtmlPdf(renderToStaticMarkup(el), fileName);
}

/** 통합 견적서를 엑셀로 저장 (main이 원본 견적으로 다시 계산해서 만든다) */
export async function saveXlsx(payload: Parameters<typeof window.doldari.exportXlsx>[0]) {
  return window.doldari.exportXlsx(payload);
}
