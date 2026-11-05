// 견적서 PDF 저장 (renderer가 만든 HTML을 인쇄)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, dialog, session, type BrowserWindow as Win, type Session } from 'electron';

/** 지금 인쇄 중인 임시 HTML 주소 (인쇄 창은 이것과 data: 말고는 불러오지 않는다) */
const printing = new Set<string>();
let printSes: Session | null = null;

/** 인쇄 전용 세션(메모리에만): 견적서 HTML 안의 외부 주소로 요청이 나가지 않게 */
function printSession() {
  if (!printSes) {
    printSes = session.fromPartition('doldari-report');
    printSes.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !(printing.has(d.url.split(/[?#]/)[0]) || /^data:/i.test(d.url)) }));
  }
  return printSes;
}

export async function savePdf(parent: Win, html: string, fileName: string) {
  const { filePath, canceled } = await dialog.showSaveDialog(parent, {
    title: '견적서 저장',
    defaultPath: `${fileName.replace(/[\\/:*?"<>|\s]+/g, '_')}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return null;
  // data: URL은 그림이 많으면 주소 길이 한도를 넘어서 임시 파일로 연다. 실패해도 창과 임시 파일은 정리한다
  const tmp = path.join(os.tmpdir(), `doldari-report-${randomUUID()}.html`);
  const url = pathToFileURL(tmp).href;
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false, session: printSession() } });
  try {
    fs.writeFileSync(tmp, html, { mode: 0o600 });
    printing.add(url);
    await win.loadURL(url);
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    fs.writeFileSync(filePath, pdf);
    return filePath;
  } finally {
    printing.delete(url);
    if (!win.isDestroyed()) win.destroy();
    fs.rmSync(tmp, { force: true });
  }
}
