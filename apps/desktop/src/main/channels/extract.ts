// 메일 본문·첨부, 견적서 파일 → 통일 스키마 추출 (Claude 구조화 출력)
import type Anthropic from '@anthropic-ai/sdk';
import type { QuoteMeta, ReportedFields, Requirements, VendorId } from '@shared/types';
import { structured } from '../agent/claude';
import { extractionSchema } from '../agent/schema';
import { toMeta, toReported } from '../quote/normalize';
import { vendorName } from '../vendors';

export async function extractQuote(params: {
  vendorId: VendorId;
  requirements: Requirements;
  content: Anthropic.ContentBlockParam[];
  hint: string;
  ref: string;
  channel: 'mail' | 'file';
}): Promise<{ fields: ReportedFields; meta: QuoteMeta }> {
  const system = `너는 견적서 정규화기다. ${vendorName(params.vendorId)}의 ${params.hint}에서 견적 항목을 추출한다.
- 금액은 원 단위 정수. 부가세 별도 금액이면 vat_included=false, 포함이면 true.
- listedPrice는 제품 1개 표시가(설치비·배송비 제외).
- installFee: 설치 포함이면 0. shippingFee: 무료면 0.
- warrantyMonths: 기본 무상 A/S 개월 수. warrantyExtraFee: 요구 A/S ${params.requirements.minWarrantyMonths}개월을 맞추는 데 드는 추가비 (기본으로 충족하면 0).
- leadTimeDays: 받기까지 걸리는 일수 ("3주" → 21).
- product·supplier·terms에는 견적서의 상품명·규격, 공급자(사업자번호·대표자·연락처·주소), 유효기간·납기·결제 조건·인도 장소를 그대로 옮긴다.
- extras에는 출장비·철거비·추가 자재 등 그 밖의 비용을 넣는다 (반드시 내야 하면 required=true).
- notes에는 특기사항을 한 줄씩.
- 문서에 없는 항목은 반드시 null. 추측하지 않는다.
- snippet은 근거 원문 그대로 (200자 이내).`;
  const raw = await structured<Record<string, unknown>>({ system, content: params.content, schema: extractionSchema });
  return { fields: toReported(raw), meta: toMeta(raw, { channel: params.channel, ref: params.ref }) };
}

