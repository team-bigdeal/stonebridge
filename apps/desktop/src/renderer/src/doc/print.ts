// 문서 컴포넌트를 독립 HTML로 만들어 PDF로 저장
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DOC_CSS } from './styles';

export async function saveDocPdf(el: ReactElement, fileName: string) {
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>@page{size:A4;margin:0}body{margin:0;background:#fff}${DOC_CSS}</style></head><body>${renderToStaticMarkup(el)}</body></html>`;
  return window.doldari.savePdf(html, fileName);
}
