// 통합 견적서 엑셀(.xlsx) 내보내기
import fs from 'node:fs';
import { dialog, type BrowserWindow as Win } from 'electron';
import ExcelJS from 'exceljs';
import type { Quote, Requirements, VendorId } from '@shared/types';
import { won } from '@shared/quote';
import { buildCompareTable, type CompareCell, type CompareRow } from '@shared/compare-table';
import { localIsoDate } from '@shared/parse';

export interface XlsxPayload {
  quotes: Partial<Record<VendorId, Quote>>;
  req: Requirements;
  urls: Partial<Record<VendorId, string>>;
  fileName: string;
}

const CH = { web: '웹', mail: '메일', file: '파일' } as const;
const FILL_MISSING = 'FFFFF2CC'; // 연한 노랑
const FILL_BEST = 'FFE2F0D9'; // 연한 초록
const FILL_HEAD = 'FFF3F4F6';
const FMT = { won: '#,##0', day: '0"일"', month: '0"개월"' } as const;

const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const thin: Partial<ExcelJS.Borders> = { top: { style: 'thin', color: { argb: 'FFD1D5DB' } }, bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } }, left: { style: 'thin', color: { argb: 'FFD1D5DB' } }, right: { style: 'thin', color: { argb: 'FFD1D5DB' } } };

/** 파일 이름에 못 쓰는 글자 정리 (savePdf와 같은 규칙) */
export const safeName = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, '_');

/** 셀에 값·서식·"확인 필요" 표시를 적는다. 외부 문자열은 항상 문자열 값으로만 쓴다(수식 객체 금지). */
function put(cell: ExcelJS.Cell, row: CompareRow, c: CompareCell, recommended: boolean) {
  let v: number | string | null = c.value;
  if (row.key === 'channel' && typeof v === 'string') v = CH[v as keyof typeof CH] ?? v;
  cell.value = v === null || v === '' ? null : v;
  if (c.kind === 'won') cell.numFmt = row.zeroLabel ? `#,##0;-#,##0;"${row.zeroLabel}"` : FMT.won;
  else if (c.kind === 'day') cell.numFmt = FMT.day;
  else if (c.kind === 'month') cell.numFmt = FMT.month;
  cell.alignment = { horizontal: c.kind === 'text' ? 'left' : 'right', vertical: 'middle', wrapText: c.kind === 'text' };
  cell.border = thin;
  if (recommended) cell.fill = fill(FILL_BEST);
  if (c.tone === 'bad') cell.font = { color: { argb: 'FFB91C1C' } };
  if (c.tone === 'ok') cell.font = { color: { argb: 'FF15803D' } };
  if (c.missing) {
    cell.fill = fill(FILL_MISSING);
    cell.note = c.value === null ? '확인 필요' : '확인 필요: 일부 금액을 확인하지 못해 합계에 다 반영되지 않았어요';
  }
}

export function buildWorkbook({ quotes, req, urls }: XlsxPayload): ExcelJS.Workbook {
  const table = buildCompareTable(quotes, req, urls);
  const wb = new ExcelJS.Workbook();
  wb.creator = '돌다리';
  wb.created = new Date();
  const ws = wb.addWorksheet('비교표', { views: [{ state: 'frozen', xSplit: 1, ySplit: 6 }] });
  const cols = table.vendors.length + 1;
  const today = localIsoDate();

  const note = (r: number, text: string, bold = false) => {
    ws.mergeCells(r, 1, r, Math.max(cols, 2));
    const c = ws.getCell(r, 1);
    c.value = text;
    c.alignment = { vertical: 'middle', wrapText: true };
    c.font = { bold, size: bold ? 14 : 11 };
  };
  const reqLine = `수량 ${req.quantity}개 · 예산 ${won(req.budgetMax)} 이하 · ${req.deadline}까지 · 설치 ${req.needInstall ? '필요' : '불필요'} · A/S ${req.minWarrantyMonths > 0 ? `${req.minWarrantyMonths}개월 이상` : '불필요'}${req.needDelivery === false ? ' · 배송 불필요' : ''}${req.region ? ` · ${req.region}` : ''}`;
  const rec = table.recommendation;
  note(1, '통합 견적서', true);
  note(2, `품목: ${req.item} · 작성일: ${today} · 업체 ${table.vendors.length}곳 비교`);
  note(3, `요구 조건: ${reqLine}`);
  note(4, `추천: ${rec.vendorName ?? '조건을 모두 만족하는 업체 없음'}${rec.tentative && rec.vendorName ? ' (확인 필요 항목 있음)' : ''}${rec.reasons.length ? ` — ${rec.reasons.join(' / ')}` : ''}`);
  note(5, '모든 금액은 부가세 포함 기준입니다. 노란 칸은 확인하지 못한 값이에요.');
  ws.getRow(3).height = 32;
  ws.getRow(4).height = 32;

  // 열 제목
  const head = ws.getRow(6);
  head.getCell(1).value = '항목';
  table.vendors.forEach((v, i) => {
    head.getCell(i + 2).value = `${v.rank}위 · ${v.name}`;
  });
  for (let c = 1; c <= cols; c++) {
    const cell = head.getCell(c);
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = thin;
    cell.fill = fill(c > 1 && table.vendors[c - 2].recommended ? FILL_BEST : FILL_HEAD);
  }

  // 엑셀에서는 A/S 연장비를 숫자 행으로 따로 둔다(한 칸에 두 값을 못 넣으므로)
  const rows: CompareRow[] = [];
  for (const r of table.rows) {
    rows.push(r);
    if (r.key === 'warranty' && r.cells.some((c) => c.addon))
      rows.push({ key: 'warranty-extra', label: 'A/S 연장비', cells: r.cells.map((c) => ({ value: c.addon ?? 0, kind: 'won' as const })) });
  }
  rows.forEach((r, ri) => {
    const row = ws.getRow(7 + ri);
    const label = row.getCell(1);
    label.value = r.label;
    label.font = { bold: true };
    label.border = thin;
    label.fill = fill(FILL_HEAD);
    r.cells.forEach((c, i) => put(row.getCell(i + 2), r, c, table.vendors[i].recommended));
    if (r.total) {
      for (let c = 1; c <= cols; c++) {
        const cell = row.getCell(c);
        cell.font = { ...(cell.font ?? {}), bold: true };
        cell.border = { ...thin, top: { style: 'medium', color: { argb: 'FF111827' } } };
      }
    }
  });

  ws.getColumn(1).width = 18;
  for (let c = 2; c <= cols; c++) ws.getColumn(c).width = 26;
  return wb;
}

export async function exportXlsx(parent: Win, payload: XlsxPayload) {
  // 저장 창을 띄우기 전에 먼저 만들어서, 만들다 실패하면 바로 오류가 드러나게 한다
  let buffer: Buffer;
  try {
    buffer = Buffer.from(await buildWorkbook(payload).xlsx.writeBuffer());
  } catch (e) {
    console.error('[xlsx] 만들기 실패', e);
    throw new Error(`엑셀을 만들지 못했어요: ${e instanceof Error ? e.message : String(e)}`);
  }
  const { filePath, canceled } = await dialog.showSaveDialog(parent, {
    title: '통합 견적서 엑셀 저장',
    defaultPath: `${safeName(payload.fileName)}.xlsx`,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  });
  if (canceled || !filePath) return null;
  try {
    fs.writeFileSync(filePath, buffer);
  } catch (e) {
    // 엑셀에서 같은 파일이 열려 있으면 여기서 실패한다
    throw new Error(`파일을 쓰지 못했어요 (같은 이름 파일이 열려 있나요?): ${e instanceof Error ? e.message : String(e)}`);
  }
  return filePath;
}
