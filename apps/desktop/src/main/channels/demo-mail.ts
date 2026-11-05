// 시연용 업체 회신: 시연용 주소(.test)로 보낸 견적 요청·확인 질문에 목업 업체가 답장한 것처럼 회신을 만든다.
// 실제 업체가 아니라는 표시를 회신 끝에 남긴다. 회신 내용은 일반 회신과 똑같이 분석되어 견적에 반영된다.
import { randomUUID } from 'node:crypto';
import MailComposer from 'nodemailer/lib/mail-composer';
import type { FieldKey, MailDraft, Requirements } from '@shared/types';
import { won } from '@shared/quote';

interface DemoQuote {
  company: string;
  /** 회신 끝 서명 */
  signer: string;
  /** 제품가 (부가세 별도) */
  product: number;
  spec?: string;
  install?: number;
  shipping?: number;
  extras: { name: string; amount: number }[];
  warrantyMonths?: number;
  /** A/S 1년 연장 비용 */
  warrantyExtra?: number;
  warrantyNote?: string;
  lead: string;
  payment: string;
  validity: string;
}

const round = (n: number, unit = 1000) => Math.max(unit, Math.round(n / unit) * unit);

/** 목업 업체 B(라벨공방, quote@label-gongbang.test): 표시가는 가장 싸지만 칼선 제작비·배송비가 붙어 총액은 비싸진다 */
function labelGongbang(r: Requirements): DemoQuote {
  const table: Record<number, number> = { 1000: 22000, 3000: 54000, 5000: 82000 };
  return {
    company: '라벨공방',
    signer: '라벨공방 김라벨 드림',
    product: table[r.quantity] ?? round(r.quantity * 18),
    spec: '유포지, 유광 코팅, 단면 칼라',
    shipping: 4000,
    extras: [{ name: '칼선(도무송) 제작비 (첫 주문 1회)', amount: 15000 }],
    warrantyNote: '인쇄 불량은 무상으로 다시 제작해 드립니다.',
    lead: '시안 확정 후 5영업일 제작, 출고 다음 날 도착',
    payment: '계좌이체 선결제',
    validity: '견적일로부터 14일'
  };
}

/** 그 밖의 시연용 주소: 요구 조건(예산·설치·A/S)에 맞춰 그럴듯한 견적을 만든다 */
function generic(r: Requirements, company: string): DemoQuote {
  const product = r.budgetMax > 0 ? round((r.budgetMax * 0.55) / 1.1) : round(r.quantity * 1000);
  const big = product >= 1_000_000;
  const longWarranty = r.minWarrantyMonths > 12;
  return {
    company,
    signer: `${company} 드림`,
    product,
    install: r.needInstall ? Math.max(30000, round(product * 0.12)) : undefined,
    shipping: r.needDelivery === false ? undefined : big ? 30000 : 3500,
    extras: [],
    warrantyMonths: r.minWarrantyMonths > 0 ? 12 : undefined,
    // 요구한 A/S 기간이 1년보다 길면 연장비가 숨은 비용이 된다
    warrantyExtra: longWarranty ? round(product * 0.08) : undefined,
    lead: '주문 확정 후 5영업일',
    payment: '계좌이체 (세금계산서 발행)',
    validity: '견적일로부터 14일'
  };
}

function quoteFor(to: string, r: Requirements, company: string): DemoQuote {
  if (/@label-gongbang\.test$/i.test(to.trim()) && /스티커|라벨|씰/.test(r.item)) return labelGongbang(r);
  return generic(r, company);
}

const FOOTER = '※ 돌다리 시연용 자동 회신입니다. 실제 업체가 보낸 메일이 아니에요.';

function requestText(q: DemoQuote, r: Requirements) {
  const lines = [
    `- 품목: ${r.item}${q.spec ? ` (${q.spec})` : ''}`,
    `- 수량: ${r.quantity.toLocaleString('ko-KR')}개`,
    `- 제품가: ${won(q.product)} (부가세 별도)`,
    q.install !== undefined ? `- 설치비: ${won(q.install)} (부가세 별도)` : '',
    ...q.extras.map((e) => `- ${e.name}: ${won(e.amount)} (부가세 별도)`),
    q.shipping !== undefined ? `- 배송비: ${q.shipping ? `${won(q.shipping)} (택배, 선결제)` : '무료'}` : '',
    q.warrantyMonths ? `- 무상 A/S: ${q.warrantyMonths}개월${q.warrantyExtra ? ` (1년 연장 시 ${won(q.warrantyExtra)})` : ''}` : '',
    `- 납기: ${q.lead}`,
    `- 결제 조건: ${q.payment}`,
    `- 견적 유효기간: ${q.validity}`
  ].filter(Boolean);
  return [
    `안녕하세요, ${q.company}입니다.`,
    `문의 주신 ${r.item} ${r.quantity.toLocaleString('ko-KR')}개 견적 보내 드립니다.`,
    '',
    '[견적 내용]',
    ...lines,
    ...(q.warrantyNote ? ['', `※ ${q.warrantyNote}`] : []),
    '',
    '감사합니다.',
    q.signer
  ].join('\n');
}

function answer(field: FieldKey, q: DemoQuote, r: Requirements): string {
  switch (field) {
    case 'listedPrice':
      return `제품가는 ${r.quantity.toLocaleString('ko-KR')}개 기준 ${won(q.product)}(부가세 별도)입니다.`;
    case 'installFee':
      return q.install !== undefined ? `설치비는 ${won(q.install)}(부가세 별도)입니다.` : '설치는 따로 하지 않아 설치비는 없습니다.';
    case 'shippingFee':
      return q.shipping ? `배송비는 ${won(q.shipping)}(택배, 선결제)입니다.` : '배송비는 무료입니다.';
    case 'warrantyMonths':
      return q.warrantyMonths ? `무상 A/S는 ${q.warrantyMonths}개월입니다.` : `별도 A/S 기간은 없습니다.${q.warrantyNote ? ` ${q.warrantyNote}` : ''}`;
    case 'warrantyExtraFee':
      return q.warrantyExtra ? `A/S를 1년 연장하시면 ${won(q.warrantyExtra)}이 추가됩니다.` : 'A/S 연장 상품은 없습니다.';
    case 'leadTimeDays':
      return `납기는 ${q.lead}입니다.`;
  }
}

function questionText(q: DemoQuote, r: Requirements, fields: FieldKey[]) {
  const asked: FieldKey[] = fields.length ? fields : ['shippingFee', 'leadTimeDays'];
  return [
    `안녕하세요, ${q.company}입니다.`,
    '문의 주신 내용 답변드립니다.',
    '',
    ...asked.map((f, i) => `${i + 1}. ${answer(f, q, r)}`),
    '',
    '감사합니다.',
    q.signer
  ].join('\n');
}

/** 시연용 회신 본문 (주문 문의에는 회신을 기다리지 않으므로 만들지 않음) */
export function demoReply(draft: MailDraft, r: Requirements, company: string): { fromName: string; text: string } | null {
  if (draft.kind === 'order') return null;
  const q = quoteFor(draft.to, r, company);
  const body = draft.kind === 'question' ? questionText(q, r, draft.fields ?? []) : requestText(q, r);
  return { fromName: q.company, text: `${body}\n\n${FOOTER}` };
}

/** 받은편지함에 넣을 회신 메일 (보낸 메일에 대한 답장으로 묶이도록 In-Reply-To를 단다) */
export function demoReplyMessage(o: { vendorAddress: string; fromName: string; to: string; subject: string; inReplyTo: string; text: string }): Promise<Buffer> {
  const domain = o.vendorAddress.split('@')[1] || 'demo.test';
  return new MailComposer({
    from: { name: o.fromName, address: o.vendorAddress },
    to: o.to,
    subject: `Re: ${o.subject}`,
    text: o.text,
    inReplyTo: o.inReplyTo,
    references: [o.inReplyTo],
    messageId: `<demo-${randomUUID()}@${domain}>`,
    date: new Date()
  })
    .compile()
    .build();
}
