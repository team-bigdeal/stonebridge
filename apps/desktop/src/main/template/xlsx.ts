// xlsx: "라벨 옆 빈 칸"과 표 머리 아래 빈 칸, 자리표시 문구가 든 칸을 채울 자리로 본다
import type { TemplateSlot } from '@shared/template';
import { parseXml, PLACEHOLDER } from './xml';

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

const colNum = (s: string) => [...s].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
const parseRef = (r: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(r);
  return m ? { c: colNum(m[1]), r: Number(m[2]) } : null;
};
const colName = (n: number) => {
  let s = '';
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

export function sharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  return find(parseXml(xml).documentElement!, 'si').map((si) =>
    find(si, 't')
      .map((t) => t.textContent ?? '')
      .join('')
  );
}

export interface SheetEntry {
  slot: Omit<TemplateSlot, 'id'>;
  ref: string;
  /** 자리표시 문구가 든 칸이면 그 원문 */
  placeholderOf?: string;
}

export function scanSheet(doc: Document, strings: string[], sheetNo: number): SheetEntry[] {
  const rows = find(doc.documentElement!, 'row');
  const grid = new Map<string, string>();
  for (const row of rows)
    for (const c of kids(row).filter((x) => local(x) === 'c')) {
      const t = c.getAttribute('t');
      const v = kids(c).find((x) => local(x) === 'v')?.textContent ?? '';
      const text =
        t === 's'
          ? (strings[Number(v)] ?? '')
          : t === 'inlineStr'
            ? find(c, 't')
                .map((x) => x.textContent ?? '')
                .join('')
            : v;
      grid.set(c.getAttribute('r') ?? '', text.trim());
    }
  // 병합 영역: 칸 → 병합의 왼쪽 위 칸
  const anchor = new Map<string, string>();
  const spanEnd = new Map<string, number>();
  for (const m of find(doc.documentElement!, 'mergeCell')) {
    const [a, b] = (m.getAttribute('ref') ?? '').split(':');
    const pa = parseRef(a ?? '');
    const pb = parseRef(b ?? '');
    if (!pa || !pb) continue;
    spanEnd.set(a, pb.c);
    for (let r = pa.r; r <= pb.r; r++) for (let c = pa.c; c <= pb.c; c++) anchor.set(`${colName(c)}${r}`, a);
  }
  const at = (c: number, r: number) => anchor.get(`${colName(c)}${r}`) ?? `${colName(c)}${r}`;
  const seen = new Set<string>();
  const out: SheetEntry[] = [];
  const push = (e: SheetEntry) => {
    if (seen.has(e.ref) || out.length >= 120) return;
    seen.add(e.ref);
    out.push(e);
  };
  const ctx = (ref: string) => `시트 ${sheetNo}, ${ref}`;

  const refs = [...grid.keys()]
    .map((k) => ({ k, p: parseRef(k) }))
    .filter((x): x is { k: string; p: { c: number; r: number } } => x.p !== null);
  const maxRow = Math.max(0, ...refs.map((x) => x.p.r));
  const filled = (ref: string) => (grid.get(ref) ?? '') !== '';

  // 표 머리(한 줄에 연속 3칸 이상 글자): "라벨 옆 빈 칸" 규칙에서는 빼고, 아래 빈 행을 채울 자리로 본다
  const headerCells = new Set<string>();
  const headerSpans: { r: number; cols: number[] }[] = [];
  for (let r = 1; r <= maxRow; r++) {
    const cols = refs
      .filter((x) => x.p.r === r && grid.get(x.k))
      .map((x) => x.p.c)
      .sort((a, b) => a - b);
    let start = 0;
    for (let i = 1; i <= cols.length; i++) {
      if (i < cols.length && cols[i] === cols[i - 1] + 1) continue;
      if (i - start >= 3) {
        const span = cols.slice(start, i);
        headerSpans.push({ r, cols: span });
        for (const c of span) headerCells.add(`${colName(c)}${r}`);
      }
      start = i;
    }
  }

  for (const { k, p } of [...refs].sort((a, b) => a.p.r - b.p.r || a.p.c - b.p.c)) {
    const text = grid.get(k) ?? '';
    if (!text) continue;
    if (PLACEHOLDER.test(text)) {
      push({ slot: { label: text.slice(0, 60), context: ctx(k), current: text.slice(0, 80) }, ref: k, placeholderOf: text });
      continue;
    }
    if (headerCells.has(k) || text.length > 30 || /^[\d.,\s-]+$/.test(text)) continue;
    const endCol = spanEnd.get(k) ?? p.c;
    const next = at(endCol + 1, p.r);
    if (next !== k && !filled(next) && !(anchor.has(next) && anchor.get(next) !== next)) push({ slot: { label: text, context: ctx(next) }, ref: next });
  }
  // 표 머리 아래의 빈 행
  for (const { r, cols } of headerSpans) {
    for (let rr = r + 1; rr <= r + 12; rr++) {
      if (cols.some((c) => filled(`${colName(c)}${rr}`))) break;
      for (const c of cols) push({ slot: { label: `${grid.get(`${colName(c)}${r}`)} (${rr - r}행)`, context: ctx(`${colName(c)}${rr}`) }, ref: `${colName(c)}${rr}` });
    }
  }
  return out;
}

/** 칸에 글자를 넣는다 (서식은 유지, 칸이 없으면 만든다) */
export function fillCell(doc: Document, ref: string, text: string) {
  const p = parseRef(ref);
  if (!p) return;
  const sheetData = find(doc.documentElement!, 'sheetData')[0];
  const ns = sheetData.namespaceURI;
  const mk = (n: string) => doc.createElementNS(ns, n);
  let row = kids(sheetData).find((r) => Number(r.getAttribute('r')) === p.r);
  if (!row) {
    row = mk('row');
    row.setAttribute('r', String(p.r));
    const after = kids(sheetData).find((r) => Number(r.getAttribute('r')) > p.r);
    sheetData.insertBefore(row, after ?? null);
  }
  let cell = kids(row).find((c) => c.getAttribute('r') === ref);
  if (!cell) {
    cell = mk('c');
    cell.setAttribute('r', ref);
    const after = kids(row).find((c) => (parseRef(c.getAttribute('r') ?? '')?.c ?? 0) > p.c);
    row.insertBefore(cell, after ?? null);
  }
  while (cell.firstChild) cell.removeChild(cell.firstChild);
  cell.setAttribute('t', 'inlineStr');
  const is = mk('is');
  const t = mk('t');
  t.setAttribute('xml:space', 'preserve');
  t.appendChild(doc.createTextNode(text));
  is.appendChild(t);
  cell.appendChild(is);
}
