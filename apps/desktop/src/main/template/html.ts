// xlsx / hwpx를 화면에 보여 줄 HTML로 바꾼다 (표 구조·병합·열 너비 위주의 미리보기. 글자 모양은 단순화)
import JSZip from 'jszip';
import { parseXml } from './xml';
import { sharedStrings } from './xlsx';

type El = Element;
const kids = (e: El) => Array.from(e.childNodes as unknown as ArrayLike<Node>).filter((n): n is El => n.nodeType === 1);
const local = (e: El) => e.localName || e.nodeName.split(':').pop() || '';
const find = (e: El, name: string, out: El[] = []): El[] => {
  for (const c of kids(e)) {
    if (local(c) === name) out.push(c);
    find(c, name, out);
  }
  return out;
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const colNum = (s: string) => [...s].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
const parseRef = (r: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(r);
  return m ? { c: colNum(m[1]), r: Number(m[2]) } : null;
};

const TABLE_CSS = "border-collapse:collapse;background:#fff;color:#111;font-size:12px;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif";

export async function xlsxToHtml(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const strings = sharedStrings((await zip.file('xl/sharedStrings.xml')?.async('string')) ?? null);
  const parts = Object.keys(zip.files)
    .filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  let html = '';
  for (const [si, name] of parts.entries()) {
    const root = parseXml(await zip.file(name)!.async('string')).documentElement!;
    // 열 너비 (문자 수 → 픽셀 근사)
    const widths = new Map<number, number>();
    for (const c of find(root, 'col')) for (let i = Number(c.getAttribute('min')); i <= Number(c.getAttribute('max')); i++) widths.set(i, Math.round(Number(c.getAttribute('width') ?? 8.43) * 7 + 5));
    const merges = new Map<string, { cs: number; rs: number }>();
    const covered = new Set<string>();
    for (const m of find(root, 'mergeCell')) {
      const [a, b] = (m.getAttribute('ref') ?? '').split(':');
      const pa = parseRef(a ?? '');
      const pb = parseRef(b ?? '');
      if (!pa || !pb) continue;
      merges.set(a, { cs: pb.c - pa.c + 1, rs: pb.r - pa.r + 1 });
      for (let r = pa.r; r <= pb.r; r++) for (let c = pa.c; c <= pb.c; c++) if (r !== pa.r || c !== pa.c) covered.add(`${c},${r}`);
    }
    const cells = new Map<string, string>();
    let maxC = 1;
    let maxR = 1;
    for (const row of find(root, 'row'))
      for (const c of kids(row).filter((x) => local(x) === 'c')) {
        const ref = parseRef(c.getAttribute('r') ?? '');
        if (!ref) continue;
        const t = c.getAttribute('t');
        const v = kids(c).find((x) => local(x) === 'v')?.textContent ?? '';
        const text = t === 's' ? (strings[Number(v)] ?? '') : t === 'inlineStr' ? find(c, 't').map((x) => x.textContent ?? '').join('') : v;
        cells.set(`${ref.c},${ref.r}`, text);
        maxC = Math.max(maxC, ref.c);
        maxR = Math.max(maxR, ref.r);
      }
    for (const k of merges.keys()) {
      const p = parseRef(k);
      if (p) {
        maxC = Math.max(maxC, p.c + (merges.get(k)?.cs ?? 1) - 1);
        maxR = Math.max(maxR, p.r + (merges.get(k)?.rs ?? 1) - 1);
      }
    }
    maxC = Math.min(maxC, 30);
    maxR = Math.min(maxR, 200);
    const colName = (n: number) => {
      let s = '';
      while (n > 0) {
        s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
        n = Math.floor((n - 1) / 26);
      }
      return s;
    };
    let t = `<table style="${TABLE_CSS}"><colgroup>${Array.from({ length: maxC }, (_, i) => `<col style="width:${widths.get(i + 1) ?? 64}px">`).join('')}</colgroup>`;
    for (let r = 1; r <= maxR; r++) {
      t += '<tr>';
      for (let c = 1; c <= maxC; c++) {
        if (covered.has(`${c},${r}`)) continue;
        const m = merges.get(`${colName(c)}${r}`);
        const text = cells.get(`${c},${r}`) ?? '';
        t += `<td${m ? ` colspan="${m.cs}" rowspan="${m.rs}"` : ''} style="border:1px solid #cfcfcf;padding:3px 6px;height:20px;white-space:pre-wrap;vertical-align:middle">${esc(text) || '&nbsp;'}</td>`;
      }
      t += '</tr>';
    }
    html += `${parts.length > 1 ? `<div style="font:600 12px sans-serif;margin:12px 0 4px">시트 ${si + 1}</div>` : ''}${t}</table>`;
  }
  return html;
}

// ─── hwpx ───

const hwpPx = (v: string | null) => (v ? Math.max(8, Math.round(Number(v) / 75)) : 0);
const spanNum = (v: string | null | undefined) => Math.min(1000, Math.max(1, Math.trunc(Number(v)) || 1));

function hwpxPara(p: El): string {
  let out = '';
  let text = '';
  const flush = () => {
    out += `<p style="margin:0;min-height:1.3em;white-space:pre-wrap">${esc(text) || '&nbsp;'}</p>`;
    text = '';
  };
  for (const run of kids(p).filter((c) => local(c) === 'run'))
    for (const c of kids(run)) {
      if (local(c) === 't') text += c.textContent ?? '';
      else if (local(c) === 'tbl') {
        if (text) flush();
        out += hwpxTable(c);
      }
    }
  if (text || !out) flush();
  return out;
}

function hwpxTable(tbl: El): string {
  let t = `<table style="${TABLE_CSS};margin:4px 0;width:100%">`;
  for (const tr of kids(tbl).filter((c) => local(c) === 'tr')) {
    t += '<tr>';
    for (const tc of kids(tr).filter((c) => local(c) === 'tc')) {
      const span = find(tc, 'cellSpan')[0];
      const size = find(tc, 'cellSz')[0];
      const sub = kids(tc).find((c) => local(c) === 'subList');
      const inner = sub ? kids(sub).filter((c) => local(c) === 'p').map(hwpxPara).join('') : '';
      const w = hwpPx(size?.getAttribute('width') ?? null);
      // 파일에서 온 값이라 HTML 속성에 넣기 전에 숫자로만
      t += `<td colspan="${spanNum(span?.getAttribute('colSpan'))}" rowspan="${spanNum(span?.getAttribute('rowSpan'))}" style="border:1px solid #888;padding:3px 6px;vertical-align:middle${w ? `;min-width:${w}px` : ''}">${inner}</td>`;
    }
    t += '</tr>';
  }
  return `${t}</table>`;
}

export async function hwpxToHtml(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const parts = Object.keys(zip.files)
    .filter((f) => /^Contents\/section\d+\.xml$/.test(f))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  let html = '<div style="background:#fff;color:#111;font:12px \'Malgun Gothic\',sans-serif;padding:32px;max-width:794px;margin:0 auto">';
  for (const name of parts) {
    const root = parseXml(await zip.file(name)!.async('string')).documentElement!;
    html += kids(root)
      .filter((c) => local(c) === 'p')
      .map(hwpxPara)
      .join('');
  }
  return `${html}</div>`;
}
