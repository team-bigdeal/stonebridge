// 견적 화면에서 제품 사진을 골라 작은 이미지로 만든다 (견적 비교 카드에 보여 줄 용도)
import { nativeImage, net, type NativeImage } from 'electron';
import type { BrowserDriver } from './driver';

const MAX_WIDTH = 480;
const MAX_FETCH_BYTES = 4 * 1024 * 1024;
// 줄일 수 없는 형식(WebP 등)을 그대로 저장할 때의 한도
const MAX_RAW_BYTES = 600 * 1024;
// 페이지 안 사진을 몇 장까지 받아 볼지
const MAX_TRIES = 6;

type Rect = { x: number; y: number; w: number; h: number };
type Pick = { vw: number; vh: number; rect: Rect | null; og: string; urls: string[] };

/**
 * 페이지에서 제품 사진 후보를 찾는다.
 * - og: og:image 주소 (대개 상품 대표 사진)
 * - urls: 페이지 안 사진 주소들 (큰 것부터, 로고·아이콘·배너 제외, 지연 로딩 주소 포함)
 * - rect: 화면에 다 보이는 가장 큰 사진의 위치 (주소로 못 받을 때 화면에서 잘라 쓴다)
 */
const FIND = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const meta = document.querySelector('meta[property="og:image"], meta[name="og:image"], meta[name="twitter:image"]');
  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return ''; } };
  // 단어 경계로 본다 (silicone 안의 icon처럼 상품 이름에 섞인 글자는 거르지 않게)
  const SKIP = /(^|[\\/_\\-. ])(logo|guide|notice|event|icons?|ico|banner|sprite|btn|button|badge|arrow|loading|blank|spacer|pixel|tracking|avatar|profile|emoji|star|rating|pay|card|kakao|naver|facebook|instagram|youtube|sns)(?=[\\/_\\-. \\d]|$)/i;
  const PRODUCT = /(goods|item|product|prd|shopimages|thumb|detail_main|main_img)/i;
  // og:image가 사이트 로고인 곳도 있어 같은 기준으로 거른다
  const ogRaw = meta && meta.content ? abs(meta.content) : '';
  const og = SKIP.test(ogRaw.split('?')[0]) ? '' : ogRaw;
  const ogFile = og.split('?')[0].split('/').pop();
  const cands = [];
  let best = null, bestScore = 0;
  for (const img of document.images) {
    // 지연 로딩 사진은 src가 자리 표시 이미지라 data-* 주소를 먼저 본다
    const src = abs(img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy-src') || img.currentSrc || img.src || '');
    if (!src || /\\.svg(\\?|$)/i.test(src) || /^data:image\\/svg/i.test(src)) continue;
    if (SKIP.test(src + ' ' + (img.alt || '') + ' ' + (img.className || '') + ' ' + (img.id || ''))) continue;
    const r = img.getBoundingClientRect();
    const w = Math.max(r.width, img.naturalWidth || 0), h = Math.max(r.height, img.naturalHeight || 0);
    if (w < 100 || h < 100) continue;
    const ratio = w / h;
    if (ratio > 3 || ratio < 0.33) continue;
    // 실제로 보이는 크기를 기준으로 (숨겨진 큰 안내 이미지보다 보이는 상품 사진이 먼저)
    const shown = r.width > 0 && r.height > 0;
    let score = shown ? r.width * r.height : (img.naturalWidth || 0) * (img.naturalHeight || 0) / 20;
    // 화면 위쪽에 크게 보이는 사진이 대개 대표 사진, 아래로 한참 내려간 사진(상세 안내 등)은 뒤로
    if (shown) score *= r.top < vh * 1.2 ? 4 : r.top < vh * 2.5 ? 1 : 0.3;
    if (ogFile && src.split('?')[0].split('/').pop() === ogFile) score *= 3;
    // 상품 사진은 대개 정사각형에 가깝다. 세로로 긴 상세 설명·가로로 긴 배너는 뒤로
    if (ratio < 0.6 || ratio > 1.9) score *= 0.15;
    if (PRODUCT.test(src)) score *= 1.5;
    cands.push({ src, score });
    const st = getComputedStyle(img);
    const x0 = Math.max(0, r.left), y0 = Math.max(0, r.top), x1 = Math.min(vw, r.right), y1 = Math.min(vh, r.bottom);
    const visible = r.width >= 120 && r.height >= 120 && x1 - x0 >= r.width * 0.85 && y1 - y0 >= r.height * 0.85 && st.visibility !== 'hidden' && Number(st.opacity) >= 0.5;
    if (visible && score > bestScore) { bestScore = score; best = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; }
  }
  cands.sort((a, b) => b.score - a.score);
  const urls = [...new Set(cands.map((c) => c.src))].slice(0, 12);
  return { vw, vh, rect: best, og, urls };
})()`;

const toDataUrl = (img: NativeImage) => {
  const out = img.getSize().width > MAX_WIDTH ? img.resize({ width: MAX_WIDTH, quality: 'good' }) : img;
  return `data:image/jpeg;base64,${out.toJPEG(80).toString('base64')}`;
};

/** 가로로 긴 배너·작은 아이콘은 제품 사진이 아님 */
const photoLike = (w: number, h: number) => w >= 100 && h >= 100 && w / h <= 3 && w / h >= 0.33;

/** 받은 바이트를 data URL로. JPEG·PNG는 줄여 저장, WebP 등은 작을 때만 그대로 둔다 */
function bytesToPhoto(buf: Buffer, type: string): string | null {
  if (buf.length > MAX_FETCH_BYTES) return null;
  const img = nativeImage.createFromBuffer(buf);
  if (!img.isEmpty()) {
    const { width, height } = img.getSize();
    return photoLike(width, height) ? toDataUrl(img) : null;
  }
  // 1KB도 안 되는 파일은 투명 픽셀·자리 표시 이미지
  return buf.length >= 1024 && buf.length <= MAX_RAW_BYTES ? `data:${type};base64,${buf.toString('base64')}` : null;
}

/** 파일 앞 바이트로 사진 형식을 알아낸다 (content-type을 text/plain 등으로 잘못 주는 서버가 있음) */
function sniffImage(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.subarray(0, 4).toString('hex') === '89504e47') return 'image/png';
  if (buf.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.subarray(4, 12).toString('latin1').startsWith('ftypavif')) return 'image/avif';
  return null;
}

/** 사진 주소 하나를 받아 본다 (실패하면 null) */
async function fetchPhoto(url: string, referer: string): Promise<string | null> {
  try {
    const inline = /^data:(image\/(?:jpeg|png|webp|gif|avif));base64,(.+)$/i.exec(url);
    if (inline) return bytesToPhoto(Buffer.from(inline[2], 'base64'), inline[1]);
    if (!/^https?:\/\//.test(url)) return null;
    // Referer는 헤더로 넣으면 다른 도메인(CDN) 사진 요청이 ERR_BLOCKED_BY_CLIENT로 막힌다. referrer 옵션으로 넘긴다
    const res = await net.fetch(url, { referrer: referer, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_FETCH_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const type = sniffImage(buf);
    return type ? bytesToPhoto(buf, type) : null;
  } catch {
    return null;
  }
}

/** 이미 찍은 화면(shot)에서 사진 부분을 잘라 낸다 */
function cropShot(shot: Buffer, p: Pick): string | null {
  if (!p.rect || p.vw <= 0 || p.vh <= 0) return null;
  const img = nativeImage.createFromBuffer(shot);
  if (img.isEmpty()) return null;
  const { width, height } = img.getSize();
  const sx = width / p.vw;
  const sy = height / p.vh;
  const x = Math.max(0, Math.round(p.rect.x * sx));
  const y = Math.max(0, Math.round(p.rect.y * sy));
  const w = Math.min(width - x, Math.round(p.rect.w * sx));
  const h = Math.min(height - y, Math.round(p.rect.h * sy));
  return w > 40 && h > 40 ? toDataUrl(img.crop({ x, y, width: w, height: h })) : null;
}

/**
 * 제품 사진: og:image → 페이지 안 사진(큰 것부터) → 화면에서 잘라 내기 순으로 찾는다.
 * 대표 사진이 없어도 그 상품 페이지 안 사진이 있으면 그걸 쓴다.
 */
export async function productPhoto(d: BrowserDriver, shot: Buffer | null, pageUrl: string): Promise<string | null> {
  const p = await d.evaluate<Pick>(FIND).catch(() => null);
  if (!p) return null;
  const tried = new Set<string>();
  for (const url of [p.og, ...(p.urls ?? [])]) {
    if (!url || tried.has(url)) continue;
    if (tried.size >= MAX_TRIES) break;
    tried.add(url);
    const photo = await fetchPhoto(url, pageUrl);
    if (photo) return photo;
  }
  return shot ? cropShot(shot, p) : null;
}

// 페이지 HTML에서 쓰는 거르기 기준 (FIND의 SKIP과 같음)
const SKIP_URL = /(^|[\/_\-. ])(logo|guide|notice|event|icons?|ico|banner|sprite|btn|button|badge|arrow|loading|blank|spacer|pixel|tracking|avatar|profile|emoji|star|rating|pay|card|kakao|naver|facebook|instagram|youtube|sns)(?=[\/_\-. \d]|$)/i;

/**
 * 견적을 찾은 화면에 사진이 없을 때(FAQ·주문서 화면 등) 업체 상품 페이지 HTML을 따로 받아 사진을 찾는다.
 * 에이전트 브라우저는 건드리지 않는다
 */
export async function photoFromPage(pageUrl: string): Promise<string | null> {
  if (!/^https?:\/\//.test(pageUrl)) return null;
  let html = '';
  try {
    const res = await net.fetch(pageUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok || !/text\/html/.test(res.headers.get('content-type') ?? '')) return null;
    html = (await res.text()).slice(0, 2_000_000);
  } catch {
    return null;
  }
  const abs = (u: string) => {
    try {
      return new URL(u.replace(/&amp;/g, '&'), pageUrl).href;
    } catch {
      return '';
    }
  };
  const urls: string[] = [];
  const og = /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)["']/i.exec(html) ?? /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i.exec(html);
  if (og) urls.push(abs(og[1]));
  for (const m of html.matchAll(/<img\b[^>]*?\s(?:data-src|data-original|src)=["']([^"']+)["']/gi)) urls.push(abs(m[1]));
  const tried = new Set<string>();
  for (const url of urls) {
    if (!url || tried.has(url) || SKIP_URL.test(url.split('?')[0]) || /\.svg(\?|$)/i.test(url)) continue;
    if (tried.size >= MAX_TRIES) break;
    tried.add(url);
    const photo = await fetchPhoto(url, pageUrl);
    if (photo) return photo;
  }
  return null;
}
