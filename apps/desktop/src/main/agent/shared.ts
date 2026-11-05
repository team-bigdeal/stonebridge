// 브라우저 3개가 함께 쓰는 메모: 누가 어느 사이트·페이지를 봤고 어떻게 판단했는지.
// 같은 상품 페이지를 여러 브라우저가 따로 확인하지 않게, 다른 브라우저가 이미 본 곳이면 도구 결과에 알려 준다.
import type { Slot } from '@shared/types';

interface Visit {
  slot: Slot;
  title: string;
  at: number;
}
interface SiteNote {
  /** 이 사이트에서 본 페이지 (경로 → 마지막 방문) */
  pages: Map<string, Visit>;
  /** 이 사이트에 대한 판단 (확정·탈락 사유·찾은 가격 등). 브라우저별 마지막 판단 */
  verdicts: Map<Slot, string>;
}

const sites = new Map<string, SiteNote>();

/** 사이트 키: 오픈마켓은 판매자 경로까지, 그 밖에는 기본 도메인 */
export function siteKey(url: string): string {
  try {
    const u = new URL(url);
    if (/(smartstore|11st|gmarket|auction|ssg|lotteon)/.test(u.hostname)) return u.host.replace(/^(www|m)\./, '') + u.pathname.split('/').slice(0, 3).join('/');
    const parts = u.hostname.split('.');
    const n = parts.length >= 3 && /^(co|or|go|ne|ac|re|pe|com|net|org)$/.test(parts[parts.length - 2]) ? 3 : 2;
    // 포트가 다르면 다른 사이트로 본다 (목업 업체 localhost:4101·4102… 가 한 업체로 묶이지 않도록)
    return parts.slice(-n).join('.') + (u.port ? `:${u.port}` : '');
  } catch {
    return url;
  }
}

/** 같은 상품 페이지 판단용: 호스트+경로+상품 번호 같은 주요 쿼리 */
function pageKey(url: string): string {
  try {
    const u = new URL(url);
    const keep = [...u.searchParams].filter(([k]) => /^(it_id|item_?no|itemno|prod_?no|product_?no|goods_?no|no|id|pid|idx)$/i.test(k));
    return u.host.replace(/^(www|m)\./, '') + u.pathname.replace(/\/$/, '') + (keep.length ? `?${keep.map(([k, v]) => `${k}=${v}`).join('&')}` : '');
  } catch {
    return url;
  }
}

const isWeb = (url: string) => /^https?:\/\//.test(url) && !/search\.naver|google\.|bing\.com|duckduckgo|daum\.net\/search|search\.daum/.test(url);

function site(url: string) {
  const key = siteKey(url);
  let s = sites.get(key);
  if (!s) sites.set(key, (s = { pages: new Map(), verdicts: new Map() }));
  return s;
}

/** 이 브라우저가 페이지에 도착했음을 기록하고, 다른 브라우저가 이미 본 곳이면 그 메모를 돌려준다 */
export function noteVisit(slot: Slot, url: string, title = ''): string | null {
  if (!isWeb(url)) return null;
  const s = site(url);
  const pk = pageKey(url);
  const before = s.pages.get(pk);
  const others = [...s.verdicts].filter(([sl]) => sl !== slot);
  const otherPages = [...s.pages.values()].filter((v) => v.slot !== slot);
  s.pages.set(pk, { slot, title: title.slice(0, 60), at: Date.now() });
  const lines: string[] = [];
  if (before && before.slot !== slot) lines.push(`브라우저 ${before.slot}가 이 페이지를 이미 봤습니다.`);
  else if (otherPages.length) lines.push(`브라우저 ${[...new Set(otherPages.map((v) => v.slot))].join(', ')}가 이 사이트(${siteKey(url)})를 이미 봤습니다.`);
  for (const [sl, v] of others) lines.push(`브라우저 ${sl}의 판단: ${v}`);
  if (!lines.length) return null;
  return `[다른 브라우저 메모] ${lines.join(' ')} 같은 업체를 다시 확인하지 말고, 이미 확정됐거나 안 된다고 한 업체면 다른 업체를 찾으세요.`;
}

/** 이 사이트에 대한 판단 기록 (확정·탈락·가격) */
export function noteVerdict(slot: Slot, url: string, verdict: string) {
  if (!isWeb(url)) return;
  site(url).verdicts.set(slot, verdict.slice(0, 120));
}

/** 이 브라우저에게 보여 줄 다른 브라우저들의 메모 (검색 결과 아래에 붙인다) */
export function boardFor(slot: Slot, max = 12): string {
  const rows: string[] = [];
  for (const [key, s] of sites) {
    const verdicts = [...s.verdicts].filter(([sl]) => sl !== slot);
    const seenBy = [...new Set([...s.pages.values()].filter((v) => v.slot !== slot).map((v) => v.slot))];
    if (!verdicts.length && !seenBy.length) continue;
    rows.push(`- ${key}: ${verdicts.length ? verdicts.map(([sl, v]) => `${sl} ${v}`).join(' / ') : `브라우저 ${seenBy.join(', ')}가 확인 중`}`);
  }
  if (!rows.length) return '';
  return `\n\n[다른 브라우저 메모] 이미 다른 브라우저가 본 사이트입니다. 확정됐거나 안 된다고 한 곳은 다시 고르지 마세요.\n${rows.slice(-max).join('\n')}`;
}

export function resetShared() {
  sites.clear();
}
