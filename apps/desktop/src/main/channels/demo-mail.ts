// 시연용 업체 회신: 시연용 주소(.test)로 보낸 견적 요청·확인 질문에 목업 업체가 답장한 것처럼 회신을 만든다.
// 실제 업체가 아니라는 표시를 회신 끝에 남긴다. 회신 내용은 일반 회신과 똑같이 분석되어 견적에 반영된다.
import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import MailComposer from 'nodemailer/lib/mail-composer';
import type { FieldKey, MailDraft, Requirements } from '@shared/types';
import { won } from '@shared/quote';
import { localIsoDate } from '@shared/parse';

interface DemoQuote {
  company: string;
  /** 견적서 공급자 칸 */
  supplier?: { ceo: string; bizNo: string; address: string };
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

/** 목업 업체 B(라벨공방, quote@label-gongbang.test): 표시가는 가장 싸지만 칼선 제작비·배송비가 붙어 총액 순위가 내려간다
 *  (3000매: 제품 59,400원으로 표시가 최저 → 칼선 8,800원·배송비 4,000원이 더해져 총액 72,200원) */
function labelGongbang(r: Requirements): DemoQuote {
  const table: Record<number, number> = { 1000: 22000, 3000: 54000, 5000: 82000 };
  return {
    company: '라벨공방',
    supplier: { ceo: '김라벨', bizNo: '222-33-44444', address: '서울 성동구 성수이로 00' },
    signer: '라벨공방 김라벨 드림',
    product: table[r.quantity] ?? round(r.quantity * 18),
    spec: '유포지, 유광 코팅, 단면 칼라',
    shipping: 4000,
    extras: [{ name: '칼선(도무송) 제작비 (첫 주문 1회)', amount: 8000 }],
    warrantyNote: '인쇄 불량은 무상으로 다시 제작해 드립니다.',
    lead: '시안 확정 후 5영업일 제작, 출고 다음 날 도착',
    payment: '계좌이체 선결제',
    validity: '견적일로부터 14일'
  };
}

/** 다른 업체 최저 총액보다 이만큼 싸게 회신한다 (메일로 물어본 업체가 1위로 올라오는 장면) */
const CHEAPER_THAN_MARKET = 0.9;

/** 그 밖의 시연용 주소: 요구 조건(예산·설치·A/S)에 맞춰 그럴듯한 견적을 만든다.
 *  market(다른 업체 최저 총액, 부가세·배송비 포함)이 있으면 총액이 그보다 10% 남짓 싸게 나오도록 제품가를 맞춘다 */
function generic(r: Requirements, company: string, market?: number): DemoQuote {
  const longWarranty = r.minWarrantyMonths > 12;
  const shipFor = (p: number) => (r.needDelivery === false ? 0 : p >= 1_000_000 ? 30000 : 3500);
  // 앱이 비교하는 총액 ≈ (제품가 + 설치비) × 1.1 + 배송비 + A/S 연장비
  const factor = 1.1 * (1 + (r.needInstall ? 0.12 : 0)) + (longWarranty ? 0.08 : 0);
  let product = r.budgetMax > 0 ? round((r.budgetMax * 0.45) / 1.1) : round(r.quantity * 1000);
  if (market && market > 0) {
    const target = market * CHEAPER_THAN_MARKET;
    const raw = (target - shipFor(target / factor)) / factor;
    // 끝자리는 내림으로 맞춰 반올림 때문에 시장가를 넘지 않게
    const unit = raw >= 100_000 ? 1000 : 100;
    product = Math.max(unit, Math.floor(raw / unit) * unit);
  }
  const big = product >= 1_000_000;
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

function quoteFor(to: string, r: Requirements, company: string, market?: number): DemoQuote {
  if (/@label-gongbang\.test$/i.test(to.trim()) && /스티커|라벨|씰/.test(r.item)) return labelGongbang(r);
  return generic(r, company, market);
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

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const num = (n: number) => n.toLocaleString('ko-KR');

/** 첨부할 견적서 HTML (한국어 양식: 공급자·품목표·합계). 금액은 공급가액·세액을 나눠 적고 합계는 부가세·배송비 포함 */
function quoteHtml(q: DemoQuote, r: Requirements, to: string) {
  const today = localIsoDate(new Date());
  const unit = q.product / r.quantity;
  const rows = [
    { name: r.item, spec: q.spec ?? '-', qty: `${num(r.quantity)}매`, unit: Number.isInteger(unit) ? num(unit) : '-', supply: q.product },
    ...(q.install !== undefined ? [{ name: '설치비', spec: '-', qty: '1식', unit: num(q.install), supply: q.install }] : []),
    ...q.extras.map((e) => ({ name: e.name, spec: '-', qty: '1식', unit: num(e.amount), supply: e.amount }))
  ];
  const supply = rows.reduce((s, x) => s + x.supply, 0);
  const vat = Math.round(supply * 0.1);
  const ship = q.shipping ?? 0;
  const total = supply + vat + ship;
  const sup = q.supplier;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(q.company)} 견적서</title><style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif; color: #222; font-size: 12px; }
  h1 { text-align: center; font-size: 26px; letter-spacing: 14px; margin: 0 0 18px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #999; padding: 6px 8px; }
  th { background: #f1f3f5; font-weight: 600; }
  .meta td { border: none; padding: 2px 0; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .sum th { text-align: left; } .total td, .total th { font-size: 14px; font-weight: 700; background: #fff4e6; }
  .terms td:first-child { width: 110px; background: #f8f9fa; font-weight: 600; }
  .foot { margin-top: 18px; color: #868e96; font-size: 10px; }
  </style></head><body>
  <h1>견적서</h1>
  <table class="meta" style="margin-bottom:12px"><tr>
    <td style="width:50%;vertical-align:top">견적번호: DD-${today.replace(/-/g, '')}-${String(r.quantity).padStart(4, '0')}<br>견적일: ${today}<br>수신: 돌다리 사용자 귀하<br>아래와 같이 견적합니다.</td>
    <td style="vertical-align:top"><table>
      <tr><th style="width:80px">상호</th><td>${esc(q.company)}</td></tr>
      ${sup ? `<tr><th>대표자</th><td>${esc(sup.ceo)}</td></tr><tr><th>사업자번호</th><td>${esc(sup.bizNo)}</td></tr><tr><th>주소</th><td>${esc(sup.address)}</td></tr>` : ''}
      <tr><th>연락처</th><td>${esc(to)}</td></tr>
    </table></td>
  </tr></table>
  <table>
    <tr><th style="width:28px">No</th><th>품목</th><th>규격</th><th>수량</th><th>단가</th><th>공급가액</th><th>세액</th></tr>
    ${rows.map((x, i) => `<tr><td class="num">${i + 1}</td><td>${esc(x.name)}</td><td>${esc(x.spec)}</td><td class="num">${x.qty}</td><td class="num">${x.unit}</td><td class="num">${num(x.supply)}</td><td class="num">${num(Math.round(x.supply * 0.1))}</td></tr>`).join('')}
  </table>
  <table class="sum" style="margin-top:10px">
    <tr><th>공급가액 합계</th><td class="num">${num(supply)}원</td></tr>
    <tr><th>세액 (부가세 10%)</th><td class="num">${num(vat)}원</td></tr>
    <tr><th>배송비 (택배, 선결제)</th><td class="num">${ship ? `${num(ship)}원` : '무료'}</td></tr>
    <tr class="total"><th>총 합계 (부가세·배송비 포함)</th><td class="num">${num(total)}원</td></tr>
  </table>
  <table class="terms" style="margin-top:14px">
    <tr><td>납기</td><td>${esc(q.lead)}</td></tr>
    <tr><td>결제 조건</td><td>${esc(q.payment)}</td></tr>
    <tr><td>견적 유효기간</td><td>${esc(q.validity)}</td></tr>
    ${q.warrantyMonths ? `<tr><td>무상 A/S</td><td>${q.warrantyMonths}개월${q.warrantyExtra ? ` (1년 연장 시 ${num(q.warrantyExtra)}원, 부가세 포함)` : ''}</td></tr>` : ''}
    ${q.warrantyNote ? `<tr><td>비고</td><td>${esc(q.warrantyNote)}</td></tr>` : ''}
  </table>
  <p class="foot">${esc(FOOTER)}</p>
  </body></html>`;
}

/** 견적서 HTML → PDF (화면에 띄우지 않는 창에서 인쇄. 한글 글꼴이 그대로 들어간다) */
async function quotePdf(html: string): Promise<Buffer> {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

export interface DemoAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

/** 시연용 회신 (주문 문의에는 회신을 기다리지 않으므로 만들지 않음).
 *  견적 요청 회신에는 견적서 PDF를 붙이고 본문은 짧게 쓴다 (PDF를 못 만들면 본문에 견적 내용을 적는다) */
export async function demoReply(draft: MailDraft, r: Requirements, company: string, market?: number): Promise<{ fromName: string; text: string; attachments: DemoAttachment[] } | null> {
  if (draft.kind === 'order') return null;
  const q = quoteFor(draft.to, r, company, market);
  if (draft.kind === 'question') return { fromName: q.company, text: `${questionText(q, r, draft.fields ?? [])}\n\n${FOOTER}`, attachments: [] };
  try {
    const content = await quotePdf(quoteHtml(q, r, draft.to));
    const text = [
      `안녕하세요, ${q.company}입니다.`,
      `문의 주신 ${r.item} ${r.quantity.toLocaleString('ko-KR')}개 견적서를 PDF로 첨부해 드립니다.`,
      '금액·납기·결제 조건은 첨부한 견적서를 확인해 주세요.',
      '',
      '감사합니다.',
      q.signer
    ].join('\n');
    return { fromName: q.company, text: `${text}\n\n${FOOTER}`, attachments: [{ filename: `${q.company} 견적서.pdf`, contentType: 'application/pdf', content }] };
  } catch {
    return { fromName: q.company, text: `${requestText(q, r)}\n\n${FOOTER}`, attachments: [] };
  }
}

/** 받은편지함에 넣을 회신 메일 (보낸 메일에 대한 답장으로 묶이도록 In-Reply-To를 단다) */
export function demoReplyMessage(o: { vendorAddress: string; fromName: string; to: string; subject: string; inReplyTo: string; text: string; attachments: DemoAttachment[] }): Promise<Buffer> {
  const domain = o.vendorAddress.split('@')[1] || 'demo.test';
  return new MailComposer({
    from: { name: o.fromName, address: o.vendorAddress },
    to: o.to,
    subject: `Re: ${o.subject}`,
    text: o.text,
    attachments: o.attachments,
    inReplyTo: o.inReplyTo,
    references: [o.inReplyTo],
    messageId: `<demo-${randomUUID()}@${domain}>`,
    date: new Date()
  })
    .compile()
    .build();
}
