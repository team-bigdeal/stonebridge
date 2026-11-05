// 파일 채널 (C업체 카톡 견적서): PDF/이미지 → Claude document/image 블록 → 통일 스키마
import type Anthropic from '@anthropic-ai/sdk';
import type { QuoteMeta, ReportedFields, Requirements, VendorId } from '@shared/types';
import { extractQuote } from './extract';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
type ImageType = (typeof IMAGE_TYPES)[number];
// 메일 첨부는 형식이 application/octet-stream으로 오기도 해서 확장자로도 판단한다
const IMAGE_EXT: Record<string, ImageType> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

/** 견적서 파일(PDF·이미지·글)을 Claude 입력 블록으로. 지원하지 않는 형식이면 null */
export function quoteFileBlock(file: { name: string; mime: string; data: Uint8Array }): Anthropic.ContentBlockParam | null {
  const data = Buffer.from(file.data).toString('base64');
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  if (file.mime === 'application/pdf' || ext === 'pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  }
  const image = (IMAGE_TYPES as readonly string[]).includes(file.mime) ? (file.mime as ImageType) : IMAGE_EXT[ext];
  if (image) return { type: 'image', source: { type: 'base64', media_type: image, data } };
  if (file.mime.startsWith('text/') || /\.(txt|md|csv)$/i.test(file.name)) {
    return { type: 'text', text: Buffer.from(file.data).toString('utf8').slice(0, 50_000) };
  }
  return null;
}

export async function parseQuoteFile(params: {
  vendorId: VendorId;
  requirements: Requirements;
  name: string;
  mime: string;
  data: Uint8Array;
}): Promise<{ fields: ReportedFields; meta: QuoteMeta }> {
  const block = quoteFileBlock(params);
  if (!block) throw new Error(`지원하지 않는 파일 형식입니다: ${params.mime || params.name}`);
  return extractQuote({
    ref: params.name,
    channel: 'file',
    vendorId: params.vendorId,
    requirements: params.requirements,
    hint: `업체에게 받은 견적서 파일(${params.name})`,
    content: [block, { type: 'text', text: '이 견적서에서 견적 항목을 추출해 주세요.' }]
  });
}
