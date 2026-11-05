// 드라이버와 무관한 페이지 도구: 웹 검색, 본문 읽기, 차단 감지, 접힌 섹션 펼치기, handoff 배너
import type { BrowserDriver } from './driver';
import { cursorTo } from './cursor';
import { SUBMIT_CHECK } from './guard';

/** 검색 엔진. 한 곳이 막혀 사용자가 건너뛰면 다음 엔진을 쓴다 */
export const ENGINES = {
  naver: (q: string) => `https://search.naver.com/search.naver?query=${encodeURIComponent(q)}`,
  daum: (q: string) => `https://search.daum.net/search?w=tot&q=${encodeURIComponent(q)}`,
  bing: (q: string) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=ko`
} as const;
export type Engine = keyof typeof ENGINES;
export const ENGINE_ORDER: Engine[] = ['naver', 'daum', 'bing'];
const SKIP_HOSTS = /(^|\.)(naver\.com|naver\.net|pstatic\.net|daum\.net|kakao\.com|bing\.com|microsoft\.com|google\.[a-z.]+|youtube\.com|instagram\.com|facebook\.com|tiktok\.com|namu\.wiki|wikipedia\.org|tistory\.com|blog\.me)$/;
const KEEP_HOSTS = /(^|\.)(smartstore\.naver\.com|brand\.naver\.com)$/;

export async function searchWeb(d: BrowserDriver, query: string, engine: Engine = 'naver') {
  await d.navigate(ENGINES[engine](query));
  const links = await d.evaluate<{ title: string; url: string; text: string }[]>(`(() => {
    const out = [];
    for (const a of document.querySelectorAll('a[href^="http"]')) {
      const title = (a.innerText || '').replace(/\\s+/g, ' ').trim();
      if (title.length < 6 || title.length > 120) continue;
      const box = a.closest('li, .total_wrap, .api_subject_bx, div');
      const text = box ? (box.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 220) : '';
      out.push({ title, url: a.href, text });
    }
    return out;
  })()`);
  const seen = new Set<string>();
  const results: string[] = [];
  for (const l of links ?? []) {
    let u: URL;
    try {
      u = new URL(l.url);
    } catch {
      continue;
    }
    if (SKIP_HOSTS.test(u.hostname) && !KEEP_HOSTS.test(u.hostname)) continue;
    const key = u.hostname + u.pathname.split('/').slice(0, 3).join('/');
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(`${results.length + 1}. ${l.title}\n   ${l.url}\n   ${l.text}`);
    if (results.length >= 25) break;
  }
  return `검색어: ${query} (${engine})\n${results.join('\n') || '추출된 외부 링크가 없습니다. snapshot이나 read_text로 화면을 확인하세요.'}`;
}

export async function readText(d: BrowserDriver, maxChars = 12000) {
  const text = await d.evaluate<string>('document.body ? document.body.innerText : ""');
  const body = (text ?? '').replace(/\n{3,}/g, '\n\n');
  const prices = await priceCandidates(d).catch(() => '');
  const hints = await findInPage(d, INFO_KEYWORDS, 10).catch(() => '');
  const contacts = await contactLinks(d).catch(() => '');
  // 길면 앞부분과 끝부분(사업자 정보·배송 안내가 주로 맨 아래)을 같이 준다
  const shown =
    body.length > maxChars
      ? `${body.slice(0, maxChars - 3000)}\n\n…(중간 ${(body.length - maxChars).toLocaleString()}자 생략 — find_in_page로 찾을 수 있음)…\n\n${body.slice(-3000)}`
      : body;
  // 다른 출처 iframe 안(옵션 선택·가격 계산기)도 함께 준다
  const frames = (await d.frameTexts?.().catch(() => [])) ?? [];
  const frameText = frames.map((f) => `\n\n## iframe (${f.host}) 안 내용\n${f.text}`).join('');
  return `URL: ${await d.url()}${prices}${hints ? `\n\n## 배송·납기·비용 관련 문구 (탭·접힌 영역 포함)\n${hints}` : ''}${contacts}\n\n## 본문\n${shown}${frameText}`;
}

// 카톡·톡톡·메일·전화 버튼은 아이콘만 있는 경우가 많아 innerText에 주소가 안 나온다. 링크 주소와 카카오 SDK 채널 id를 따로 뽑는다
const CONTACT_LINKS_JS = `(() => {
  const out = new Set();
  const docs = [document];
  for (const f of document.querySelectorAll('iframe')) { try { if (f.contentDocument && f.contentDocument.body) docs.push(f.contentDocument); } catch (e) {} }
  const chat = /https?:\\/\\/(?:pf\\.kakao\\.com|open\\.kakao\\.com|talk\\.naver\\.com)\\/[^\\s'"<>)]+/;
  const dec = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };
  for (const doc of docs) {
    for (const a of doc.querySelectorAll('a[href], [onclick]')) {
      const href = a.getAttribute('href') || '';
      const m = (href + ' ' + (a.getAttribute('onclick') || '')).match(chat);
      const v = m ? m[0] : /^(mailto|tel|sms):/i.test(href) ? href.split('?')[0] : '';
      if (!v) continue;
      const img = a.querySelector('img');
      const label = (a.innerText || a.getAttribute('aria-label') || a.getAttribute('title') || (img && img.alt) || '').replace(/\\s+/g, ' ').trim().slice(0, 30);
      out.add((label ? label + ' → ' : '') + dec(v));
    }
    for (const e of doc.querySelectorAll('[data-channel-public-id]')) out.add('카카오톡 채널 → https://pf.kakao.com/' + e.getAttribute('data-channel-public-id'));
    for (const s of doc.querySelectorAll('script:not([src])')) {
      for (const m of (s.textContent || '').matchAll(/channelPublicId\\s*:\\s*['"](_\\w+)['"]/g)) out.add('카카오톡 채널 → https://pf.kakao.com/' + m[1]);
    }
  }
  return [...out].slice(0, 15);
})()`;

async function contactLinks(d: BrowserDriver) {
  const links = await d.evaluate<string[]>(CONTACT_LINKS_JS);
  return links?.length ? `\n\n## 연락처 링크 (아이콘 버튼 포함)\n${links.map((l) => `- ${l}`).join('\n')}` : '';
}

/** 견적에 자주 빠지는 정보의 키워드 */
export const INFO_KEYWORDS = ['배송비', '택배비', '무료배송', '무료 배송', '배송', '출고', '발송', '제작기간', '제작 기간', '작업일', '납기', '설치비', '부가세', 'VAT'];

/**
 * 페이지 전체(숨은 탭·접힌 영역·같은 출처 iframe 포함)에서 키워드 주변 문장을 찾는다.
 * innerText는 보이는 글자만 주기 때문에 "배송/교환" 탭 안 내용 같은 건 놓친다.
 * 키워드가 들어간 링크·탭(예: "배송안내", "이용안내")도 함께 알려 준다.
 */
export async function findInPage(d: BrowserDriver, keywords: string[], limit = 20) {
  const kws = keywords.map((k) => k.trim()).filter(Boolean).slice(0, 12);
  if (!kws.length) return '';
  const r = await d.evaluate<{ hits: string[]; links: string[] }>(`(() => {
    const kws = ${JSON.stringify(kws)}.map((k) => k.toLowerCase());
    const docs = [document];
    for (const f of document.querySelectorAll('iframe')) { try { if (f.contentDocument && f.contentDocument.body) docs.push(f.contentDocument); } catch (e) {} }
    const vis = (e) => { if (!e) return false; const s = e.ownerDocument.defaultView.getComputedStyle(e); const b = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && b.width > 0 && b.height > 0; };
    const seen = new Set(); const hits = []; const links = [];
    for (const doc of docs) {
      const w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => {
        const p = n.parentElement; if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(p.tagName)) return NodeFilter.FILTER_REJECT;
        const t = n.nodeValue.toLowerCase(); return kws.some((k) => t.includes(k)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      } });
      for (let n = w.nextNode(); n && hits.length < ${limit}; n = w.nextNode()) {
        let box = n.parentElement;
        // 문장 단위가 나오도록 너무 짧으면 한 단계 위까지
        for (let i = 0; i < 3 && box.parentElement && (box.textContent || '').trim().length < 40; i++) box = box.parentElement;
        const text = (box.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 220);
        if (text.length < 4 || seen.has(text)) continue;
        seen.add(text);
        hits.push((vis(n.parentElement) ? '' : '[숨은 영역] ') + (doc === document ? '' : '[iframe] ') + text);
      }
      for (const a of doc.querySelectorAll('a, button, [role="tab"]')) {
        const t = (a.innerText || a.textContent || '').replace(/\s+/g, ' ').trim();
        if (!t || t.length > 30 || !/배송|교환|반품|이용\s*안내|주문\s*안내|제작\s*안내|FAQ|자주/i.test(t)) continue;
        const href = a.tagName === 'A' && a.href && !a.href.startsWith('javascript') ? a.href : '';
        const key = t + href; if (seen.has(key)) continue; seen.add(key);
        links.push(href ? t + ' → ' + href : t + ' (탭/버튼: snapshot으로 ref 확인 후 click)');
        if (links.length >= 10) break;
      }
    }
    return { hits, links };
  })()`);
  const parts: string[] = [];
  if (r?.hits?.length) parts.push(r.hits.map((h) => `- ${h}`).join('\n'));
  if (r?.links?.length) parts.push(`안내 페이지·탭 후보:\n${r.links.map((l) => `- ${l}`).join('\n')}`);
  return parts.join('\n');
}

/**
 * 화면에 보이는 금액과 그 주변 라벨. 옵션을 고르면 계산되는 주문 금액 박스(인쇄비·부가세·합계 등)는
 * 본문 텍스트에 잘 안 잡혀서 따로 뽑는다. 현재 선택된 옵션(수량 등)도 함께.
 */
export async function priceCandidates(d: BrowserDriver) {
  const r = await d.evaluate<{ prices: string[]; options: string[] }>(`(() => {
    const vis = (e) => { const s = getComputedStyle(e); const b = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && b.width > 0 && b.height > 0; };
    const seen = new Set(); const prices = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.children.length > 2) continue;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/[0-9][0-9,]{2,}\s*원/.test(t) || t.length > 60 || !vis(el)) continue;
      const row = el.closest('tr, li, dl, dd, p, div');
      const ctx = row ? (row.innerText || row.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140) : t;
      if (seen.has(ctx)) continue;
      seen.add(ctx);
      prices.push(ctx);
      if (prices.length >= 40) break;
    }
    const options = [...document.querySelectorAll('select')].filter(vis).map((s) => {
      const label = (s.labels && s.labels[0] && s.labels[0].innerText) || s.getAttribute('aria-label') || s.name || s.id || '';
      return label.trim().slice(0, 30) + ' = ' + (s.selectedOptions[0] ? s.selectedOptions[0].text.trim() : '') + ' (선택지: ' + [...s.options].slice(0, 10).map((o) => o.text.trim()).join(' | ') + ')';
    }).slice(0, 15);
    return { prices, options };
  })()`);
  const parts = [];
  if (r?.prices?.length) parts.push(`## 화면의 금액 (주변 라벨 포함)\n${r.prices.map((p) => `- ${p}`).join('\n')}`);
  if (r?.options?.length) parts.push(`## 현재 선택된 옵션 (select_option으로 바꿀 수 있음)\n${r.options.map((o) => `- ${o}`).join('\n')}`);
  return parts.length ? `\n\n${parts.join('\n\n')}` : '';
}

export interface BlockInfo {
  kind: 'status' | 'captcha' | 'login';
  reason: string;
}

const LOGIN_URL = /(nid\.naver\.com\/nidlogin|accounts\.google\.com|accounts\.kakao\.com|logins?\.|\/(member\/)?login|\/signin|\/sign-in|\/auth\/login)/i;

/**
 * 차단 화면 감지: HTTP 403/418/429, CAPTCHA·봇 확인 문구, 원하지 않은 로그인 리다이렉트.
 * 우회하지 않는다. 감지되면 에이전트를 멈추고 사용자에게 넘긴다.
 */
export async function detectBlock(d: BrowserDriver, intendedUrl?: string): Promise<BlockInfo | null> {
  const info = await d
    .evaluate<{ status: number; text: string; url: string }>(`(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      return {
        status: nav && nav.responseStatus ? nav.responseStatus : 0,
        text: (document.title + ' ' + (document.body ? document.body.innerText.slice(0, 3000) : '')).toLowerCase(),
        url: location.href
      };
    })()`)
    .catch(() => null);
  if (!info) return null;
  if ([403, 418, 429].includes(info.status)) return { kind: 'status', reason: `사이트가 접근을 막았습니다 (HTTP ${info.status})` };
  if (/captcha|recaptcha|보안\s*확인|자동입력\s*방지|로봇이 아닙니다|unusual traffic|access denied|비정상적인 접근|서비스 접속이 불가|일시적으로 제한/.test(info.text))
    return { kind: 'captcha', reason: '보안 확인(CAPTCHA) 화면이 나왔습니다' };
  if (LOGIN_URL.test(info.url) && !(intendedUrl && LOGIN_URL.test(intendedUrl))) return { kind: 'login', reason: '로그인 페이지로 이동됐습니다' };
  return null;
}

/** 접힌 <details>와 aria-expanded=false 요소를 커서로 하나씩 펼친다 */
export async function expandAll(d: BrowserDriver) {
  if (d.locked) throw new Error('handoff 이후에는 조작할 수 없습니다.');
  const opened: string[] = [];
  for (let i = 0; i < 12; i++) {
    const t = await d.evaluate<{ x: number; y: number; vw: number; vh: number; text: string } | null>(`(() => {
      // 펼치기라도 제출·결제·장바구니 버튼은 누르지 않는다
      const submitLike = (e) => { try { return (${SUBMIT_CHECK})(e).isSubmit; } catch { return true; } };
      const el = [...document.querySelectorAll('details:not([open]) > summary, [aria-expanded="false"]')].find((e) => !e.dataset.dlTried && e.offsetParent !== null && !submitLike(e));
      if (!el) return null;
      el.dataset.dlTried = '1';
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      const x = r.left + Math.min(r.width / 2, 90), y = r.top + r.height / 2;
      return { x, y, vw: window.innerWidth, vh: window.innerHeight, text: (el.innerText || '').trim().slice(0, 30) };
    })()`);
    if (!t) break;
    await cursorTo(d.slot, t.x, t.y, t.vw, t.vh);
    await cursorTo(d.slot, t.x, t.y, t.vw, t.vh, true);
    await d.evaluate(`(() => {
      const el = document.querySelector('[data-dl-tried="1"]:not([data-dl-done])');
      if (!el) return true;
      el.dataset.dlDone = '1';
      if (el.tagName === 'SUMMARY') el.parentElement.open = true; else el.click();
      return true;
    })()`);
    opened.push(t.text);
  }
  return opened.length ? `펼친 섹션: ${opened.join(', ')}. read_text나 snapshot으로 펼쳐진 내용을 확인하세요.` : '접힌 섹션이 없습니다.';
}
