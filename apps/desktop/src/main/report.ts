// 견적서 PDF 저장 (renderer가 만든 HTML을 인쇄)
import fs from 'node:fs';
import { BrowserWindow, dialog, type BrowserWindow as Win } from 'electron';

export async function savePdf(parent: Win, html: string, fileName: string) {
  const { filePath, canceled } = await dialog.showSaveDialog(parent, {
    title: '견적서 저장',
    defaultPath: `${fileName.replace(/[\\/:*?"<>|\s]+/g, '_')}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return null;
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  win.destroy();
  fs.writeFileSync(filePath, pdf);
  return filePath;
}
