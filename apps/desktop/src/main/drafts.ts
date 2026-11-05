// 메일 초안: 견적 요청 / 확인 질문 / 주문 문의 / 빅딜(협상)
import { randomUUID } from 'node:crypto';
import type { FieldKey, MailDraft, Quote, Requirements, Source, VendorId } from '@shared/types';
import { FIELD_LABELS } from '@shared/types';
import { confirmQuestions, confirmedSum, won } from '@shared/quote';
import { hasApiKey } from './config';
import { getVendor, vendorName } from './vendors';
import { structured } from './agent/claude';

const vendorShort = (id: VendorId) => vendorName(id);
const companyName = (id: VendorId) => vendorName(id);

function reqLines(r: Requirements) {
  const as = r.minWarrantyMonths >= 12 && r.minWarrantyMonths % 12 === 0 ? `${r.minWarrantyMonths / 12}년` : `${r.minWarrantyMonths}개월`;
  return [
    `- 품목: ${r.item}`,
    `- 수량: ${r.quantity}개`,
    `- 희망 납기: ${r.deadline}까지`,
    `- 설치: ${r.needInstall ? '필요' : '불필요'}`,
    r.minWarrantyMonths > 0 ? `- A/S: 최소 ${as}` : '',
    r.region ? `- 지역: ${r.region}` : ''
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

/** 폼 채널(A)용 문의 내용 */
export function formMessage(vendorId: VendorId, r: Requirements) {
  return `${r.item} ${r.quantity}개 주문 문의드립니다. 설치 ${r.needInstall ? '포함' : '불필요'}, A/S ${r.minWarrantyMonths}개월 이상 희망합니다. ${r.deadline}까지 받을 수 있는지와 설치비 포함 총액을 알려 주세요.`;
}

type Evidence = Source & { vendorId: VendorId; field: FieldKey };

/** 빅딜 걸기: 다른 업체 견적 중 선택 업체보다 유리한 조건을 근거로 */
export async function bigdealDraft(vendorId: VendorId, quotes: Partial<Record<VendorId, Quote>>, r: Requirements): Promise<MailDraft | null> {
  const target = quotes[vendorId];
  if (!target) return null;
  const evidence: Evidence[] = [];
  const points: string[] = [];
  const others = (Object.values(quotes).filter(Boolean) as Quote[]).filter((q) => q.vendorId !== vendorId && q.listedPrice.value !== null);

  for (const o of others) {
    const cmp = (k: FieldKey, lower = true) => {
      const a = target[k].value;
      const b = o[k].value;
      return a !== null && b !== null && (lower ? b < a : b > a);
    };
    const add = (k: FieldKey, text: string) => {
      if (o[k].source) evidence.push({ ...o[k].source!, vendorId: o.vendorId, field: k });
      points.push(text);
    };
    if (r.needInstall && cmp('installFee')) {
      const total = confirmedSum(o, r);
      add('installFee', o.installFee.value === 0
        ? `${vendorShort(o.vendorId)}는 설치 포함 ${won(total)} 견적을 주셨습니다.`
        : `${vendorShort(o.vendorId)}는 설치비가 ${won(o.installFee.value!)}입니다.`);
    }
    if (cmp('shippingFee')) add('shippingFee', `${vendorShort(o.vendorId)}는 배송비가 ${o.shippingFee.value === 0 ? '무료' : won(o.shippingFee.value!)}입니다.`);
    if (cmp('warrantyMonths', false)) add('warrantyMonths', `${vendorShort(o.vendorId)}는 A/S ${o.warrantyMonths.value}개월을 기본 제공합니다.`);
    if (cmp('leadTimeDays')) add('leadTimeDays', `${vendorShort(o.vendorId)}는 납기가 ${o.leadTimeDays.value}일입니다.`);
  }
  if (points.length === 0) {
    const cheaper = others.filter((o) => confirmedSum(o, r) < confirmedSum(target, r));
    for (const o of cheaper) {
      if (o.listedPrice.source) evidence.push({ ...o.listedPrice.source, vendorId: o.vendorId, field: 'listedPrice' });
      points.push(`${vendorShort(o.vendorId)}는 총 ${won(confirmedSum(o, r))} 견적을 주셨습니다.`);
    }
  }
  const ask = target.installFee.value && r.needInstall ? '설치비 조정이 가능할까요?' : '가격이나 조건 조정이 가능할까요?';
  const evidenceText = evidence.length
    ? `\n\n[근거]\n${evidence.map((e) => `- ${vendorShort(e.vendorId)} ${FIELD_LABELS[e.field]}: "${e.snippet}" (${e.channel === 'web' ? e.ref : e.channel === 'mail' ? '메일 회신' : e.ref})`).join('\n')}`
    : '';

  let body = `안녕하세요, ${companyName(vendorId)} 담당자님.\n\n보내 주신 견적(확인된 총액 ${won(confirmedSum(target, r))}) 잘 받았습니다. 귀사 조건이 가장 마음에 드는데, 비교 중인 다른 견적이 있어 문의드립니다.\n\n${points.map((p) => `- ${p}`).join('\n') || '- 다른 업체들도 비슷한 가격대를 제시했습니다.'}\n\n${ask} 조정해 주시면 바로 진행하겠습니다.\n\n감사합니다.\n돌다리 사용자 드림`;

  if (hasApiKey()) {
    try {
      const out = await structured<{ body: string }>({
        system: '너는 공손하지만 단호한 구매 협상 메일 작성자다. 주어진 근거만 사용하고 과장하지 않는다. 한국어 메일 본문만 쓴다.',
        content: JSON.stringify({ to: companyName(vendorId), requirements: r, myQuote: target, betterConditions: points, ask }),
        schema: { type: 'object', additionalProperties: false, required: ['body'], properties: { body: { type: 'string' } } }
      });
      body = out.body;
    } catch (e) {
      console.error('협상 메일 생성 실패, 템플릿 사용', e);
    }
  }

  return base(vendorId, 'bigdeal', `[가격 협의] ${r.item} 견적 조정 문의`, body + evidenceText, { evidence });
}
