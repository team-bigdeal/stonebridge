// 브라우저 도구 정의와 실행기 (드라이버: Aside 또는 Electron)
import type Anthropic from '@anthropic-ai/sdk';
import type { QuoteMeta, ReportedFields, Slot } from '@shared/types';
import type { BrowserDriver } from '../browser/driver';
import * as pageTools from '../browser/page';
import type { Engine } from '../browser/page';
import type { PdfFile } from '../browser/pdf';
import { metaProperties, reportFieldsSchema } from './schema';
import { toMeta, toReported } from '../quote/normalize';

const intent = { type: 'string', description: '지금 하는 일 (사용자에게 보여 줄 한국어 한 줄, 예: "상세 페이지에서 설치비 확인 중")' };

const T = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): Anthropic.Tool => ({
  name,
  description,
  input_schema: { type: 'object', properties: { intent, ...properties }, required: ['intent', ...required] }
});

const vendorItem = {
  type: 'object',
  properties: {
    name: { type: 'string', description: '업체/쇼핑몰 이름' },
    url: { type: 'string', description: '견적 정보를 볼 페이지 URL (직접 열어 확인한 것)' },
    reason: { type: 'string', description: '고른 이유 한 줄' }
  },
  required: ['name', 'url', 'reason']
};

export const TOOL_DEFS = {
  search_web: T('search_web', '이 브라우저에서 네이버 검색을 실행하고 결과 링크 목록을 받는다.', { query: { type: 'string' } }, ['query']),
  navigate: T('navigate', 'URL로 이동하고 로딩을 기다린다.', { url: { type: 'string' } }, ['url']),
  snapshot: T('snapshot', '현재 페이지의 접근성 트리. 클릭/입력 가능한 요소에 ref가 붙는다. 클릭·입력 전에 사용.'),
  read_text: T('read_text', '현재 페이지 본문 텍스트. 가격·조건을 빠르게 찾을 때 사용.'),
  click: T('click', 'snapshot이 준 ref 요소를 클릭한다. 제출·결제 버튼은 거부된다.', { ref: { type: 'string', description: 'snapshot의 ref 값 그대로' } }, ['ref']),
  fill: T('fill', 'ref 입력칸의 기존 값을 지우고 text를 입력한다.', { ref: { type: 'string' }, text: { type: 'string' } }, ['ref', 'text']),
  select_option: T('select_option', '드롭다운에서 옵션을 고른다. <select>뿐 아니라 눌러서 목록이 펼쳐지는 커스텀 드롭다운(button/combobox, 현재 값이 글자로 보이는 칸)도 된다: 그 칸의 ref와 고를 글자를 주면 펼쳐서 누른다. 수량·규격·용지·인쇄 도수 등을 요구 조건에 맞추면 금액이 다시 계산된다. 옵션 글자가 정확하지 않으면 실패 메시지에 펼쳐진 목록이 나온다.', { ref: { type: 'string', description: 'snapshot의 숫자 ref (예: "12")' }, option: { type: 'string', description: '보이는 옵션 글자 그대로 (예: "1000매")' } }, ['ref', 'option']),
  find_in_page: T(
    'find_in_page',
    '페이지 전체(숨은 탭·접힌 영역·iframe 포함)에서 키워드 주변 문장과 관련 안내 링크를 찾는다. 배송비·납기·설치비가 본문에 안 보일 때 사용.',
    { keywords: { type: 'array', items: { type: 'string' }, description: '예: ["배송비", "택배", "무료배송"]' } },
    ['keywords']
  ),
  download_quote_pdf: T(
    'download_quote_pdf',
    '사이트가 내주는 가견적서·견적서 PDF를 받는다. "견적서 출력/다운로드/가견적서" 버튼이나 링크의 ref, 또는 PDF 주소(url). 받은 PDF는 자동으로 읽혀 견적에 반영된다. 옵션을 요구 조건에 맞춘 뒤 쓴다.',
    { ref: { type: 'string', description: 'snapshot의 버튼·링크 ref' }, url: { type: 'string', description: 'PDF 주소 (ref 대신)' } }
  ),
  report_sizes: T(
    'report_sizes',
    '사이트에서 파는 사이즈 선택지를 보고한다. 찾을 때마다 보고하고, 2~3개 사이트를 다 봤으면 done=true.',
    {
      sizes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: '사이트에 적힌 이름 그대로 (예: "일반 명함 90×50", "A4")' },
            width_mm: { type: 'number', description: '가로 mm' },
            height_mm: { type: 'number', description: '세로 mm' },
            vendor: { type: 'string', description: '업체 이름' },
            url: { type: 'string', description: '이 사이즈를 본 페이지 URL' },
            note: { type: 'string', description: '가격대·용도 등 한 줄 (선택)' }
          },
          required: ['label', 'width_mm', 'height_mm', 'vendor', 'url']
        }
      },
      done: { type: 'boolean' }
    },
    ['sizes', 'done']
  ),
  save_page_pdf: T('save_page_pdf', '지금 화면이 인쇄용 견적서 페이지이거나, 클릭으로 견적서 팝업(새 창)이 열렸을 때 그 화면을 PDF로 저장하고 읽어 견적에 반영한다. 팝업이 열려 있으면 팝업을 저장한다.'),
  expand_all: T('expand_all', '접힌 섹션(<details>, 아코디언)을 펼친다. 숨은 비용(설치비·배송비·옵션) 확인용.'),
  claim_vendor: T('claim_vendor', '이 브라우저가 견적을 받을 업체 1곳을 확정한다. 다른 브라우저가 이미 고른 업체면 거부된다.', vendorItem.properties, ['name', 'url', 'reason']),
  select_vendors: T('select_vendors', '견적을 받을 업체를 확정한다.', { vendors: { type: 'array', minItems: 1, maxItems: 3, items: vendorItem } }, ['vendors']),
  report_quote: T(
    'report_quote',
    '찾은 견적 정보를 보고한다. 찾은 것만 넣는다. 금액 필드마다 근거 snippet 필수. 다 찾았으면 done=true.',
    { fields: reportFieldsSchema, ...metaProperties, done: { type: 'boolean', description: '이 업체 탐색을 끝내면 true' } },
    ['fields', 'done']
  ),
  switch_channel: T(
    'switch_channel',
    '웹에 가격이 없을 때 다른 채널로 전환한다. mail = 견적 요청 메일(사이트에 적힌 메일 주소 필요), file = 카톡·전화 상담 후 견적서 파일로 받는 경우.',
    {
      channel: { type: 'string', enum: ['mail', 'file'] },
      contact: { type: 'string', description: '사이트에 적힌 메일 주소 또는 연락 방법' },
      reason: { type: 'string', description: '전환 이유 한 줄' }
    },
    ['channel', 'reason']
  ),
  request_user: T('request_user', 'CAPTCHA·로그인·본인인증 등 사람이 해야 하는 화면에서 멈추고 사용자에게 넘긴다.', { reason: { type: 'string' } }, ['reason']),
  handoff: T('handoff', '폼 작성을 마치고 제출 직전에 멈춘다. 이후 이 화면은 사용자가 직접 확인/제출한다.', { reason: { type: 'string' } }, ['reason'])
} satisfies Record<string, Anthropic.Tool>;

export type ToolName = keyof typeof TOOL_DEFS;

export interface PickedVendor {
  name: string;
  url: string;
  reason: string;
}

export type AgentOutcome =
  | { kind: 'reported' }
  | { kind: 'vendors'; vendors: PickedVendor[] }
  | { kind: 'switch'; channel: 'mail' | 'file'; contact?: string; reason: string }
  | { kind: 'user'; reason: string; blocked?: boolean; url?: string }
  | { kind: 'handoff'; reason: string }
  | { kind: 'incomplete' };

export interface ToolContext {
  slot: Slot;
  driver: BrowserDriver;
  onReport?: (fields: ReportedFields, meta: QuoteMeta, url: string) => Promise<string[]> | string[];
  /** 업체 확정. 거부 사유를 돌려주면 에러 */
  onClaim?: (v: PickedVendor) => string | null;
  /** 도구 실행 후 화면 상태 갱신 */
  onAfter?: () => void;
  /** 이 브라우저가 쓸 검색 엔진 */
  engine?: () => Engine;
  /** 받은 가견적서 PDF를 원본으로 보관하고 읽어서 반영. 반영된 항목 이름을 돌려준다 */
  onPdf?: (file: PdfFile) => Promise<string[]>;
  /** done=true 직전에 아직 비어 있는 주요 항목 (한 번은 되돌려 보내 더 찾게 한다) */
  missingOnDone?: () => string[];
  doneNudged?: boolean;
  shipNudged?: boolean;
  /** 페이지에 도착하면 기록하고, 다른 브라우저가 이미 본 곳이면 그 메모 */
  onVisit?: (url: string, title: string) => string | null;
  /** 다른 브라우저들이 본 사이트·판단 메모 (검색 결과 아래에 붙임) */
  board?: () => string;
  /** 사이즈 조사: 찾은 사이즈 보고 */
  onSizes?: (sizes: { label: string; widthMm: number; heightMm: number; vendor: string; url: string; note?: string }[]) => number;
}

export interface ToolResult {
  text: string;
  isError?: boolean;
  outcome?: AgentOutcome;
}

/** 배송비 0원의 근거가 조건부 무료(금액 기준·회원 혜택)면 다시 확인하라는 안내. 아니면 null */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function freeShippingDoubt(fields: any): string | null {
  const f = fields?.shippingFee;
  if (!f || Number(f.value) !== 0) return null;
  const snip = String(f.snippet ?? '');
  if (/VIP|회원|등급|멤버십|쿠폰|이벤트|첫\s*구매|적립/i.test(snip)) {
    return `배송비 0원의 근거("${snip.slice(0, 60)}")가 회원 등급·멤버십·쿠폰·이벤트 혜택으로 보입니다. 로그인하지 않은 일반 주문에는 적용되지 않으니, 일반 배송비(택배비)를 찾아 shippingFee를 다시 보고하세요.`;
  }
  const m = /(\d[\d,]*)\s*(만)?\s*원\s*이상/.exec(snip);
  if (m) {
    const won = Number(m[1].replace(/,/g, '')) * (m[2] ? 10000 : 1);
    return `배송비 0원의 근거가 "${won.toLocaleString('ko-KR')}원 이상 무료" 조건입니다. 이번 주문 합계(부가세 포함)가 그 금액 이상인지 확인하세요. 미만이면 일반 배송비를 찾아 shippingFee를 다시 보고하세요.`;
  }
  return null;
}

const isUrl = (u: unknown) => /^https?:\/\//.test(String(u ?? ''));

/** 페이지가 바뀌는 도구 뒤에는 차단 화면(418·CAPTCHA·로그인 리다이렉트)인지 확인하고, 그렇다면 바로 멈춘다 */
const PAGE_CHANGING = new Set(['search_web', 'navigate', 'click', 'select_option', 'download_quote_pdf']);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runTool(ctx: ToolContext, name: string, input: any): Promise<ToolResult> {
  let r = await runToolInner(ctx, name, input);
  // 다른 브라우저와 본 페이지 공유: 새 페이지에 도착하면 기록하고, 이미 다른 브라우저가 본 곳이면 알려 준다
  if (PAGE_CHANGING.has(name) && !r.isError && ctx.onVisit) {
    const url = await ctx.driver.url().catch(() => '');
    const note = url ? ctx.onVisit(url, await ctx.driver.title().catch(() => '')) : null;
    if (note) r = { ...r, text: `${r.text}\n${note}` };
  }
  if (name === 'search_web' && !r.isError && ctx.board) r = { ...r, text: r.text + ctx.board() };
  if (!PAGE_CHANGING.has(name) || r.outcome) return r;
  const block = await pageTools.detectBlock(ctx.driver, name === 'navigate' ? String(input.url) : undefined).catch(() => null);
  if (!block) return r;
  const url = await ctx.driver.url().catch(() => '');
  return {
    text: `${block.reason}. 우회하지 않고 사용자에게 넘깁니다.`,
    outcome: { kind: 'user', reason: block.reason, blocked: true, url }
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runToolInner(ctx: ToolContext, name: string, input: any): Promise<ToolResult> {
  const d = ctx.driver;
  try {
    switch (name) {
      case 'search_web':
        return { text: await pageTools.searchWeb(d, String(input.query), ctx.engine?.() ?? 'naver') };
      case 'navigate':
        return { text: await d.navigate(String(input.url)) };
      case 'snapshot':
        return { text: await d.snapshot() };
      case 'read_text':
        return { text: await pageTools.readText(d) };
      case 'click':
        return { text: await d.click(String(input.ref)) };
      case 'fill':
        return { text: await d.fill(String(input.ref), String(input.text ?? '')) };
      case 'select_option':
        return { text: await d.selectOption(String(input.ref), String(input.option)) };
      case 'expand_all':
        return { text: await pageTools.expandAll(d) };
      case 'download_quote_pdf':
      case 'save_page_pdf': {
        if (!ctx.onPdf) return { text: '이 단계에서는 PDF를 받을 수 없습니다.', isError: true };
        const file = name === 'save_page_pdf' ? await d.printPdf() : await d.downloadPdf({ ref: input.ref ? String(input.ref) : undefined, url: input.url ? String(input.url) : undefined });
        const added = await ctx.onPdf(file);
        return {
          text: `가견적서 PDF를 받아 읽었습니다 (${file.name}, ${Math.max(1, Math.round(file.data.length / 1024))}KB). ${added.length ? `반영된 항목: ${added.join(', ')}.` : '숫자 항목은 찾지 못했습니다.'} 빠진 항목(배송비·납기 등)은 페이지에서 계속 찾고, 다 됐으면 report_quote(done=true)로 끝내세요.`
        };
      }
      case 'find_in_page': {
        const kws = Array.isArray(input.keywords) ? input.keywords.map(String) : [String(input.keywords ?? '')];
        return { text: (await pageTools.findInPage(d, kws)) || `"${kws.join(', ')}"가 들어간 문구가 이 페이지에 없습니다. 안내 페이지(배송·이용 안내, FAQ)로 이동해 보세요.` };
      }
      case 'claim_vendor': {
        if (!isUrl(input.url)) return { text: 'http(s) URL이 필요합니다.', isError: true };
        const v = { name: String(input.name), url: String(input.url), reason: String(input.reason ?? '') };
        const err = ctx.onClaim?.(v) ?? null;
        if (err) return { text: err, isError: true };
        return { text: `업체 확정: ${v.name}. 이제 이 업체의 견적 정보를 찾아 report_quote로 보고하세요.` };
      }
      case 'select_vendors': {
        const vendors = (Array.isArray(input.vendors) ? input.vendors : [])
          .filter((v: PickedVendor) => v && isUrl(v.url))
          .slice(0, 3)
          .map((v: PickedVendor) => ({ name: String(v.name), url: String(v.url), reason: String(v.reason ?? '') }));
        if (vendors.length === 0) return { text: 'URL이 있는 업체가 없습니다.', isError: true };
        return { text: `업체 ${vendors.length}곳 확정`, outcome: { kind: 'vendors', vendors } };
      }
      case 'report_quote': {
        const url = await d.url();
        const shipDoubt = !ctx.shipNudged ? freeShippingDoubt(input.fields) : null;
        const added = (await ctx.onReport?.(toReported(input.fields), toMeta(input, { channel: 'web', ref: url }), url)) ?? [];
        // 끝내기 전에 빠진 항목이 있으면 한 번은 더 찾아보게 한다
        if (shipDoubt) {
          ctx.shipNudged = true;
          return { text: `${added.length ? `보고 완료: ${added.join(', ')}. ` : ''}${shipDoubt}` };
        }
        const missing = input.done && !ctx.doneNudged ? (ctx.missingOnDone?.() ?? []) : [];
        if (missing.length) {
          ctx.doneNudged = true;
          return {
            text: `${added.length ? `보고 완료: ${added.join(', ')}. ` : ''}아직 ${missing.join(', ')}이(가) 비어 있습니다. 끝내기 전에 find_in_page(예: ["배송비", "택배", "무료배송", "출고", "제작기간"])로 숨은 탭까지 찾고, 안내 페이지·탭 후보가 있으면 열어 확인하세요. 정말 없으면 report_quote(done=true)를 다시 호출하세요.`
          };
        }
        return {
          text: added.length ? `보고 완료: ${added.join(', ')}` : '숫자 필드는 없었습니다. (부가 정보는 기록됨)',
          outcome: input.done ? { kind: 'reported' } : undefined
        };
      }
      case 'report_sizes': {
        const list = (Array.isArray(input.sizes) ? input.sizes : [])
          .map((x: Record<string, unknown>) => ({ label: String(x.label ?? '').slice(0, 40), widthMm: Number(x.width_mm), heightMm: Number(x.height_mm), vendor: String(x.vendor ?? '').slice(0, 40), url: String(x.url ?? ''), note: x.note ? String(x.note).slice(0, 60) : undefined }))
          .filter((x: { widthMm: number; heightMm: number }) => x.widthMm > 0 && x.heightMm > 0 && x.widthMm < 10000 && x.heightMm < 10000);
        const total = ctx.onSizes?.(list) ?? 0;
        return { text: `사이즈 ${list.length}개 기록 (지금까지 ${total}종).`, outcome: input.done ? { kind: 'reported' } : undefined };
      }
      case 'switch_channel':
        return {
          text: `${input.channel === 'mail' ? '메일' : '파일'} 채널로 전환합니다. 탐색을 끝내세요.`,
          outcome: { kind: 'switch', channel: input.channel === 'file' ? 'file' : 'mail', contact: input.contact, reason: String(input.reason ?? '') }
        };
      case 'request_user':
        return { text: '사용자에게 넘겼습니다.', outcome: { kind: 'user', reason: String(input.reason ?? '') } };
      case 'handoff':
        d.locked = true;
        return { text: '사용자에게 넘겼습니다.', outcome: { kind: 'handoff', reason: String(input.reason ?? '') } };
      default:
        return { text: `알 수 없는 도구: ${name}`, isError: true };
    }
  } catch (e) {
    return { text: e instanceof Error ? e.message : String(e), isError: true };
  } finally {
    ctx.onAfter?.();
  }
}
