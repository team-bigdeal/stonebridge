// 메일 초안: 견적 요청 / 확인 질문 / 주문 문의
import { randomUUID } from 'node:crypto';
import type { MailDraft, MessageDraft, Quote, Requirements, VendorId } from '@shared/types';
import { confirmQuestions, confirmedSum, won } from '@shared/quote';
import { getVendor, vendorName } from './vendors';

const companyName = (id: VendorId) => vendorName(id);

function reqLines(r: Requirements) {
  const as = r.minWarrantyMonths >= 12 && r.minWarrantyMonths % 12 === 0 ? `${r.minWarrantyMonths / 12}년` : `${r.minWarrantyMonths}개월`;
  return [
    `- 품목: ${r.item}`,
    `- 수량: ${r.quantity}개`,
    `- 희망 납기: ${r.deadline}까지`,
    `- 설치: ${r.needInstall ? '필요' : '불필요'}`,
    r.minWarrantyMonths > 0 ? `- A/S: 최소 ${as}` : '',
    r.region ? `- 지역: ${r.region}` : '',
    ...(r.specs ?? []).filter((s) => s.value).map((s) => `- ${s.label}: ${s.value}${s.unit ?? ''}`)
  ]
    .filter(Boolean)
    .join('\n');
}

const base = (vendorId: VendorId, kind: MailDraft['kind'], subject: string, body: string, extra: Partial<MailDraft> = {}): MailDraft => ({
  id: randomUUID(),
  vendorId,
  kind,
  to: getVendor(vendorId)?.email ?? '',
  subject,
  body,
  ...extra
});

export function requestDraft(vendorId: VendorId, r: Requirements): MailDraft {
  return base(
    vendorId,
    'request',
    `[견적 요청] ${r.item} ${r.quantity}개`,
    `안녕하세요, ${companyName(vendorId)} 담당자님.\n\n홈페이지를 보고 견적 문의드립니다. 아래 조건으로 견적 부탁드립니다.\n\n${reqLines(r)}\n\n제품가(부가세 포함 여부), 설치비, 배송비, A/S 기간과 연장 비용, 납기를 함께 알려 주시면 감사하겠습니다.\n\n감사합니다.\n돌다리 사용자 드림`
  );
}

export function questionDraft(vendorId: VendorId, quotes: Partial<Record<VendorId, Quote>>, r: Requirements): MailDraft | null {
  const q = confirmQuestions(quotes, r).find((x) => x.vendorId === vendorId);
  if (!q) return null;
  return base(
    vendorId,
    'question',
    `[견적 확인] ${r.item} 견적 관련 문의`,
    `안녕하세요, ${companyName(vendorId)} 담당자님.\n\n보내 주신 견적 잘 받았습니다. 결정 전에 몇 가지만 확인 부탁드립니다.\n\n${q.lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}\n\n감사합니다.\n돌다리 사용자 드림`,
    { fields: q.fields }
  );
}

export function orderDraft(vendorId: VendorId, quotes: Partial<Record<VendorId, Quote>>, r: Requirements): MailDraft {
  const q = quotes[vendorId]!;
  const pending = confirmQuestions(quotes, r).find((x) => x.vendorId === vendorId);
  return base(
    vendorId,
    'order',
    `[주문 문의] ${r.item} ${r.quantity}개 진행 요청`,
    `안녕하세요, ${companyName(vendorId)} 담당자님.\n\n견적 주신 조건(확인된 총액 ${won(confirmedSum(q, r))})으로 주문을 진행하고 싶습니다.\n\n${reqLines(r)}\n${pending ? `\n진행 전 확인 부탁드립니다:\n${pending.lines.map((l) => `- ${l}`).join('\n')}\n` : ''}\n결제 방법과 일정 안내 부탁드립니다.\n\n감사합니다.\n돌다리 사용자 드림`
  );
}

/** 사이트에 적힌 연락 방법에서 전화번호(숫자만)와 메신저 링크를 꺼낸다 */
export function parseContact(contact = '') {
  // 국내 번호(0으로 시작)와 +82 표기를 모두 0으로 시작하는 숫자로
  const m = contact.match(/(?:\+82[-\s]?0?|0)(\d{1,2})[-.\s]?(\d{3,4})[-.\s]?(\d{4})/);
  const phone = m ? `0${m[1]}${m[2]}${m[3]}` : undefined;
  const chatUrl = contact.match(/https?:\/\/(?:pf\.kakao\.com|open\.kakao\.com|talk\.naver\.com)\/[^\s)'"<>]+/)?.[0];
  return { phone, chatUrl };
}

/** 문자·카톡용 견적 요청 (메일보다 짧게, 견적서는 PDF로 받기) */
export function messageDraft(vendorId: VendorId, r: Requirements, contact?: string): MessageDraft {
  return {
    id: randomUUID(),
    vendorId,
    contact,
    ...parseContact(contact),
    body: `안녕하세요, 홈페이지 보고 견적 문의드립니다.\n\n${reqLines(r)}\n\n제품가·배송비·설치비·A/S·납기가 들어간 견적서를 PDF로 보내 주실 수 있을까요? 감사합니다.`
  };
}

/** 폼 채널(A)용 문의 내용 */
export function formMessage(vendorId: VendorId, r: Requirements) {
  return `${r.item} ${r.quantity}개 주문 문의드립니다. 설치 ${r.needInstall ? '포함' : '불필요'}, A/S ${r.minWarrantyMonths}개월 이상 희망합니다. ${r.deadline}까지 받을 수 있는지와 설치비 포함 총액을 알려 주세요.`;
}
