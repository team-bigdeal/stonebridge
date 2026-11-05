// 견적 추출 스키마 (도구 입력 / 구조화 출력 공용)
import { FIELD_KEYS } from '@shared/types';

const FIELD_DESC: Record<string, string> = {
  listedPrice: '제품 가격(표시가). 원 단위 정수. 몇 개(매) 기준 가격인지 price_qty에 함께 적는다',
  installFee: '설치·시공비. 설치 포함이면 0',
  shippingFee: '배송비. 무료면 0',
  warrantyMonths: '기본 무상 A/S 기간(개월)',
  warrantyExtraFee: '요구 A/S 기간을 맞추는 데 드는 추가 비용. 기본 A/S로 충족하면 0',
  leadTimeDays: '주문 후 받기까지 걸리는 일수 ("3주" → 21)'
};

const str = { type: 'string' };

/** 견적 조건 글 항목 설명 (납기 칸에 배송 방법이 들어가거나 외국어 원문이 그대로 남지 않게) */
const TERM_DESC = {
  delivery: '납기: 주문 후 받기까지 걸리는 기간이나 날짜만 ("주문 후 5일", "11월 20일까지"). 택배·선불·착불 같은 배송 방법은 넣지 않는다',
  payment: '결제 조건 (한국어로. 예: "제작 전 계좌이체")'
};

/** report_quote 도구 입력의 부가 정보 (모두 선택) */
export const metaProperties = {
  product: { type: 'object', description: '견적 대상 상품', properties: { name: { ...str, description: '상품명' }, spec: { ...str, description: '모델명·규격·옵션' } } },
  supplier: {
    type: 'object',
    description: '공급자 정보 (페이지 하단 사업자 정보 등에서)',
    properties: { bizNo: { ...str, description: '사업자등록번호' }, ceo: { ...str, description: '대표자' }, phone: str, email: str, address: str }
  },
  terms: {
    type: 'object',
    description: '견적 조건',
    properties: {
      validity: { ...str, description: '견적 유효기간' },
      delivery: { ...str, description: TERM_DESC.delivery },
      leadTimeText: { ...str, description: '제작·출고·발송 기간 원문 그대로 ("7영업일" 등)' },
      payment: { ...str, description: TERM_DESC.payment },
      place: { ...str, description: '인도·설치 장소' }
    }
  },
  extras: {
    type: 'array',
    description: '그 밖의 비용: 출장비·철거비·추가 자재 등. required=true면 반드시 내야 하는 비용, false면 선택 옵션',
    items: {
      type: 'object',
      properties: { name: str, amount: { type: 'number' }, required: { type: 'boolean' }, note: str, snippet: { ...str, description: '근거 원문' } },
      required: ['name', 'amount', 'required', 'snippet']
    }
  },
  notes: { type: 'array', items: str, description: '견적서에 적을 특기사항 (조건·주의점, 한 줄씩)' }
};

/** report_quote 도구의 fields 스키마 (모든 필드 선택) */
export const reportFieldsSchema = {
  type: 'object',
  properties: Object.fromEntries(
    FIELD_KEYS.map((k) => [
      k,
      {
        type: 'object',
        description: FIELD_DESC[k],
        properties: {
          value: { type: 'number', description: '정규화된 숫자 값' },
          snippet: { type: 'string', description: '근거가 된 원문 그대로 (200자 이내)' },
          vat_included: { type: 'boolean', description: '금액이 부가세 포함이면 true, 별도면 false' },
          price_qty: { type: 'number', description: 'listedPrice 전용: 이 가격이 몇 개(매) 기준인지. 1개 가격이면 1, "1000매 12,430원"이면 1000' }
        },
        required: ['value', 'snippet']
      }
    ])
  )
};

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [{ type: 'null' }, schema] });
/** 글자 항목은 null 대신 빈 문자열로 "모름"을 나타낸다.
 *  구조화 출력은 null을 허용하는(union) 항목 수에 상한이 있어서, null은 숫자 항목(7개)에만 쓴다 */
const nstr = { type: 'string', description: '문서에 없으면 빈 문자열 ""' };

/** 메일/파일 추출용 구조화 출력 스키마 (없는 숫자 값은 null, 없는 글자 값은 "") */
export const extractionSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...FIELD_KEYS, 'price_qty', 'stated_total', 'product', 'supplier', 'terms', 'extras', 'notes'],
  properties: {
    stated_total: { type: 'number', description: '견적서에 적힌 최종 합계 금액(총 합계·합계금액·총 결제금액). 부가세·배송비가 들어간 그대로. 문서에 합계가 없으면 0' },
    price_qty: { ...nullable({ type: 'number' }), description: 'listedPrice가 몇 개(매) 기준 가격인지. 1개 가격이면 1' },
    ...Object.fromEntries(
      FIELD_KEYS.map((k) => [
        k,
        {
          ...nullable({
            type: 'object',
            additionalProperties: false,
            required: ['value', 'snippet', 'vat_included'],
            properties: { value: { type: 'number' }, snippet: { type: 'string' }, vat_included: { type: 'boolean' } }
          }),
          description: `${FIELD_DESC[k]}. 문서에 없으면 null`
        }
      ])
    ),
    product: { type: 'object', additionalProperties: false, required: ['name', 'spec'], properties: { name: nstr, spec: nstr } },
    supplier: {
      type: 'object',
      additionalProperties: false,
      required: ['bizNo', 'ceo', 'phone', 'email', 'address'],
      properties: { bizNo: nstr, ceo: nstr, phone: nstr, email: nstr, address: nstr }
    },
    terms: {
      type: 'object',
      additionalProperties: false,
      required: ['validity', 'delivery', 'leadTimeText', 'payment', 'place'],
      properties: { validity: nstr, delivery: { ...nstr, description: `${TERM_DESC.delivery}. ${nstr.description}` }, leadTimeText: nstr, payment: { ...nstr, description: `${TERM_DESC.payment}. ${nstr.description}` }, place: nstr }
    },
    extras: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'amount', 'required', 'note', 'snippet'],
        properties: { name: { type: 'string' }, amount: { type: 'number' }, required: { type: 'boolean' }, note: nstr, snippet: { type: 'string' } }
      }
    },
    notes: { type: 'array', items: { type: 'string' } }
  }
};
