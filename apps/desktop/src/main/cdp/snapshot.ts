// Accessibility.getFullAXTree → 압축 텍스트 트리. 인터랙티브 노드에 [ref=N] 부여.
import type { CdpSession } from './session';

interface AXValue { value?: unknown }
interface AXNode {
  nodeId: string;
  ignored?: boolean;
  role?: AXValue;
  name?: AXValue;
  value?: AXValue;
  childIds?: string[];
  backendDOMNodeId?: number;
  properties?: { name: string; value: AXValue }[];
}

const INTERACTIVE = new Set([
  'link', 'button', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'listbox', 'option',
  'menuitem', 'tab', 'switch', 'spinbutton', 'DisclosureTriangle', 'slider'
]);
const STRUCTURAL = new Set(['heading', 'table', 'row', 'cell', 'columnheader', 'rowheader', 'list', 'listitem', 'img', 'group', 'form']);
const SKIP = new Set(['InlineTextBox', 'LineBreak']);
const MAX_CHARS = 9000;
/** 잘린 스냅샷에서도 남길 줄: 견적서·가격·배송 관련 버튼과 문구 */
const KEEP_RE = /견적|PDF|출력|인쇄|합계|총\s*(금액|액)|결제\s*금액|배송|택배|납기|출고|수량|\[ref=\d+\].*(계산|조회|확인)/;

export async function takeSnapshot(cdp: CdpSession): Promise<string> {
  const { nodes } = await cdp.send<{ nodes: AXNode[] }>('Accessibility.getFullAXTree');
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  cdp.refs.clear();
  let nextRef = 1;
  const lines: string[] = [];

  const text = (v?: AXValue) => (typeof v?.value === 'string' ? v.value.replace(/\s+/g, ' ').trim() : '');

  function walk(id: string, depth: number, parentName: string) {
    const node = byId.get(id);
    if (!node) return;
    const role = text(node.role);
    const name = text(node.name);
    let childDepth = depth;
    let nameForChildren = parentName;

    if (!node.ignored && !SKIP.has(role)) {
      const pad = '  '.repeat(depth);
      if (INTERACTIVE.has(role) && node.backendDOMNodeId) {
        const ref = nextRef++;
        cdp.refs.set(ref, node.backendDOMNodeId);
        const value = text(node.value);
        const expanded = node.properties?.find((p) => p.name === 'expanded');
        const extra = [value ? `value="${value}"` : '', expanded ? `expanded=${expanded.value.value}` : ''].filter(Boolean).join(' ');
        lines.push(`${pad}- ${role === 'DisclosureTriangle' ? 'summary' : role} "${name}"${extra ? ` ${extra}` : ''} [ref=${ref}]`);
        childDepth = depth + 1;
        nameForChildren = name;
      } else if (role === 'StaticText') {
        if (name && name !== parentName) lines.push(`${pad}${name}`);
      } else if (STRUCTURAL.has(role)) {
        lines.push(`${pad}- ${role}${name && role !== 'row' && role !== 'cell' ? ` "${name}"` : ''}`);
        childDepth = depth + 1;
        if (role === 'heading') nameForChildren = name;
      }
    }
    for (const c of node.childIds ?? []) walk(c, childDepth, nameForChildren);
  }

  if (nodes[0]) walk(nodes[0].nodeId, 0, '');
  const title = await cdp.evaluate<string>('document.title').catch(() => '');
  let out = `페이지: ${title}\nURL: ${cdp.url()}\n${lines.join('\n')}`;
  if (out.length > MAX_CHARS) {
    // 메뉴가 긴 쇼핑몰은 아래쪽 견적서 출력·합계 버튼이 잘려 ref를 못 얻는다. 잘린 부분에서 견적·가격 관련 줄은 남긴다
    const head = out.slice(0, MAX_CHARS);
    const cut = head.split('\n').length - 1;
    const keep = lines
      .slice(Math.max(0, cut - 2))
      .filter((l) => KEEP_RE.test(l))
      .map((l) => l.trim())
      .slice(0, 40);
    out = `${head}\n…(이하 생략)${keep.length ? `\n\n## 생략된 부분의 견적·가격 관련 요소\n${keep.join('\n')}` : ''}`;
  }
  return out;
}
