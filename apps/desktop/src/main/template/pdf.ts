// PDF 입력란(AcroForm)에 채우기. 입력란이 없는 PDF(스캔·평면)는 지원하지 않는다
import fs from 'node:fs';
import { PDFDocument, PDFTextField } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { TemplateSlot } from '@shared/template';

const FONT_CANDIDATES = [
  'C:\\Windows\\Fonts\\malgun.ttf',
  '/Library/Fonts/NanumGothic.ttf',
  '/Library/Fonts/NanumGothic.otf',
  '/usr/share/fonts/truetype/nanum/NanumGothic.ttf',
  '/usr/share/fonts/nanum/NanumGothic.ttf'
];

function koreanFont(): Uint8Array {
  for (const p of FONT_CANDIDATES) if (fs.existsSync(p)) return fs.readFileSync(p);
  throw new Error('한글 글꼴(맑은 고딕·나눔고딕)을 이 컴퓨터에서 찾지 못했어요.');
}

const textFields = (doc: PDFDocument) => doc.getForm().getFields().filter((f): f is PDFTextField => f instanceof PDFTextField);

export async function scanPdf(bytes: Uint8Array): Promise<Omit<TemplateSlot, 'id'>[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return textFields(doc).map((f, i) => ({ label: f.getName(), context: `입력란 ${i + 1}` }));
}

/** values: 입력란 순번(0부터) → 글자 */
export async function fillPdf(bytes: Uint8Array, values: Map<number, string>): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(koreanFont(), { subset: true });
  textFields(doc).forEach((f, i) => {
    const v = values.get(i);
    if (v === undefined) return;
    if (v.includes('\n')) f.enableMultiline();
    f.setText(v);
  });
  doc.getForm().updateFieldAppearances(font);
  return doc.save();
}
