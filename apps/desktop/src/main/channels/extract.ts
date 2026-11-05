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
- 금액은 원 단위 정수. 그 항목에 "부가세 별도/VAT 별도"라고 적혀 있거나 공급가액 줄에 들어 있을 때만 vat_included=false, 그 밖에는 true. 배송비·택배비는 따로 "별도"라는 말이 없으면 적힌 금액 그대로(vat_included=true).
- listedPrice는 제품 가격(설치비·배송비 제외). 몇 개(매) 기준 가격인지 price_qty에 적는다.
- 견적서 합계에 들어간 항목은 하나도 빠뜨리지 않는다. 코팅·박·후가공·재단·디자인비 같은 옵션도 견적 금액이 적혀 있고 합계에 들어 있으면("선택 옵션"이라고 적혀 있어도) extras에 required=true로 넣는다. 합계에서 빠진다고(별도·미포함) 적혀 있을 때만 required=false.
- extras의 amount는 부가세를 포함한 금액으로 적는다 (공급가액만 적혀 있으면 10%를 더한다).
- installFee: 설치 포함이면 0. shippingFee: 무료면 0.
- warrantyMonths: 기본 무상 A/S 개월 수. warrantyExtraFee: 요구 A/S ${params.requirements.minWarrantyMonths}개월을 맞추는 데 드는 추가비 (기본으로 충족하면 0).
- leadTimeDays: 주문 후 받기까지 걸리는 일수 ("3주" → 21). 제작·출고 기간과 배송 기간이 따로 적혀 있으면 더한다 (범위면 큰 값. "3영업일 출고 + 택배 1~2일" → 5). 원문은 terms.leadTimeText에.
- stated_total: 견적서에 적힌 최종 합계(총 합계·합계금액). 없으면 0.
- product·supplier·terms에는 견적서의 상품명·규격, 공급자(사업자번호·대표자·연락처·주소), 유효기간·납기·결제 조건·인도 장소를 그대로 옮긴다.
- extras에는 출장비·철거비·추가 자재 등 그 밖의 비용을 넣는다 (반드시 내야 하면 required=true).
- notes에는 특기사항을 한 줄씩.
- 문서에 없는 항목은 반드시 null. 추측하지 않는다.
- snippet은 근거 원문 그대로 (200자 이내).`;
  const raw = await structured<Record<string, unknown>>({ system, content: params.content, schema: extractionSchema });
  return { fields: toReported(raw), meta: toMeta(raw, { channel: params.channel, ref: params.ref }) };
}

