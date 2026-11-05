// 드라이버와 무관한 페이지 도구: 웹 검색, 본문 읽기, 차단 감지, 접힌 섹션 펼치기, handoff 배너
import type { BrowserDriver } from './driver';
import { cursorTo } from './cursor';

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
  return `URL: ${await d.url()}${prices}\n\n## 본문\n${body.length > maxChars ? `${body.slice(0, maxChars)}\n…(이하 생략)` : body}`;
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
      const el = [...document.querySelectorAll('details:not([open]) > summary, [aria-expanded="false"]')].find((e) => !e.dataset.dlTried && e.offsetParent !== null);
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
