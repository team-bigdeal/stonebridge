// 파일 채널 (C업체 카톡 견적서): PDF/이미지 → Claude document/image 블록 → 통일 스키마
import type Anthropic from '@anthropic-ai/sdk';
import type { QuoteMeta, ReportedFields, Requirements, VendorId } from '@shared/types';
import { extractQuote } from './extract';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

export async function parseQuoteFile(params: {
  vendorId: VendorId;
  requirements: Requirements;
  name: string;
  mime: string;
  data: Uint8Array;
}): Promise<{ fields: ReportedFields; meta: QuoteMeta }> {
  const data = Buffer.from(params.data).toString('base64');
  let block: Anthropic.ContentBlockParam;
  if (params.mime === 'application/pdf' || params.name.toLowerCase().endsWith('.pdf')) {
    block = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  } else if ((IMAGE_TYPES as readonly string[]).includes(params.mime)) {
    block = { type: 'image', source: { type: 'base64', media_type: params.mime as (typeof IMAGE_TYPES)[number], data } };
  } else if (params.mime.startsWith('text/') || /\.(txt|md|csv)$/i.test(params.name)) {
    block = { type: 'text', text: Buffer.from(params.data).toString('utf8').slice(0, 50_000) };
  } else {
    throw new Error(`지원하지 않는 파일 형식입니다: ${params.mime || params.name}`);
  }
  return extractQuote({
    ref: params.name,
    channel: 'file',
    vendorId: params.vendorId,
    requirements: params.requirements,
    hint: `업체에게 받은 견적서 파일(${params.name})`,
    content: [block, { type: 'text', text: '이 견적서에서 견적 항목을 추출해 주세요.' }]
  });
}
