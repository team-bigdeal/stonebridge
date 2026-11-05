import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';
import { FileUp, X } from 'lucide-react';
import type { ApprovalField } from '@shared/approval';
import type { TemplateInfo, TemplateSlot } from '@shared/template';
import { Button } from '@/components/ui/button';
import { PdfPaper } from '@/components/PdfPaper';

const ACCEPT = /\.(docx|xlsx|hwpx|pdf)$/i;

/** 회사 양식: 올리기(클릭·드래그) → 칸 연결 → 화면에서 고치기 → 파일로 내려받기 */
export function useApprovalTemplate(fields: ApprovalField[], onUploaded: () => void) {
  const [tpl, setTpl] = useState<TemplateInfo | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  /** 사용자가 직접 고친 칸 값 (없으면 연결된 항목의 값) */
  const [edits, setEdits] = useState<Record<string, string>>({});
  /** 미리보기를 다시 그리게 하는 번호 */
  const [version, setVersion] = useState(0);
  /** 미리보기 화면에서 고친 칸 값을 꺼내는 함수 (미리보기가 등록) */
  const collectRef = useRef<(() => Record<string, string>) | null>(null);

  useEffect(() => {
    // 앱을 다시 시작하기 전(옛 preload)이면 양식 API가 없다 → 양식 없이 기본 품의서만 보여 준다
    try {
      if (typeof window.doldari.templateGet === 'function') void window.doldari.templateGet().then(setTpl).catch(() => undefined);
    } catch {
      /* 양식 기능을 못 쓰는 상태 */
    }
  }, []);

  const byKey = useMemo(() => new Map(fields.map((f) => [f.key, f.value])), [fields]);
  const valueOf = useCallback(
    (s: TemplateSlot) => {
      if (s.id in edits) return edits[s.id];
      const key = tpl?.mapping[s.id];
      return key ? (byKey.get(key) ?? '') : '';
    },
    [edits, tpl, byKey]
  );

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPT.test(file.name)) {
      setMsg('docx, xlsx, hwpx, PDF 파일만 올릴 수 있어요. (.hwp / .doc / .xls는 새 형식으로 저장해 주세요)');
      return;
    }
    setBusy(true);
    setMsg('');
    const data = new Uint8Array(await file.arrayBuffer());
    const res = await window.doldari.templateAnalyze({ name: file.name, data }, fields.map(({ key, label }) => ({ key, label })));
    setBusy(false);
    if (!res.ok) {
      setMsg(res.error);
      return;
    }
    setTpl(res.template);
    setEdits({});
    setVersion((v) => v + 1);
    setMsg(res.template.mappedBy === 'ai' ? 'AI가 양식의 칸을 품의서 항목에 연결했어요. 맞는지 확인하고 고쳐 주세요.' : 'API 키가 없거나 AI 호출이 실패해 칸 이름으로 짐작해 연결했어요. 맞는지 확인하고 고쳐 주세요.');
    onUploaded();
  };

  const remap = (slotId: string, key: string) => {
    if (!tpl) return;
    const mapping = { ...tpl.mapping, [slotId]: key || null };
    // 화면에서 직접 고친 값은 지키고, 이 칸만 새 항목의 값으로 다시 채운다
    const typed = collectRef.current?.() ?? {};
    setTpl({ ...tpl, mapping });
    setEdits(({ [slotId]: _drop, ...rest }) => {
      const { [slotId]: _d2, ...others } = typed;
      return { ...rest, ...others };
    });
    setVersion((v) => v + 1);
    void window.doldari.templateSetMapping(mapping);
  };

  const edit = (slotId: string, text: string) => setEdits((e) => ({ ...e, [slotId]: text }));

  const clear = async () => {
    await window.doldari.templateClear();
    setTpl(null);
    setEdits({});
    setMsg('');
  };

  const download = async () => {
    if (!tpl) return;
    setBusy(true);
    const values = collectRef.current ? collectRef.current() : Object.fromEntries(tpl.slots.map((s) => [s.id, valueOf(s)]));
    const res = await window.doldari.templateFill(values);
    setBusy(false);
    if (res.path) setMsg(`저장했어요 · ${res.path}${res.skipped?.length ? ` · 비워 둔 칸 ${res.skipped.length}개` : ''}`);
    else if (res.error) setMsg(res.error);
  };

  const refresh = () => {
    const typed = collectRef.current?.() ?? {};
    setEdits((e) => ({ ...e, ...typed }));
    setVersion((v) => v + 1);
  };

  return { tpl, msg, busy, version, collectRef, valueOf, upload, remap, edit, clear, download, refresh };
}
export type ApprovalTemplate = ReturnType<typeof useApprovalTemplate>;

/** 품의서 위쪽 한 줄: 양식 이름·올리기·빼기 */
export function TemplateBar({ t }: { t: ApprovalTemplate }) {
  const { tpl, busy } = t;
  return (
    <div className="rounded-lg border bg-card p-2.5 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">회사 양식</span>
        {tpl ? (
          <>
            <span className="truncate text-muted-foreground" title={tpl.name}>
              {tpl.name} · 채울 칸 {tpl.slots.length}개
            </span>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => void t.clear()}>
              <X className="size-3.5" /> 양식 빼기
            </Button>
          </>
        ) : (
          <span className="text-muted-foreground">이 창에 docx · xlsx · hwpx · 입력란 있는 PDF 파일을 끌어다 놓으면 그 양식으로 채워 줘요. 없으면 기본 양식을 써요.</span>
        )}
        <label className="ml-auto">
          <input
            type="file"
            accept=".docx,.xlsx,.hwpx,.pdf"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              void t.upload(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <span className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border px-2.5 text-[12px] font-medium hover:bg-accent">
            <FileUp className="size-3.5" /> {busy ? '읽는 중…' : tpl ? '다른 양식' : '양식 올리기'}
          </span>
        </label>
      </div>
      {t.msg && <div className="mt-1.5 break-all text-muted-foreground">{t.msg}</div>}
    </div>
  );
}


// ─── 실제 파일 미리보기 (칸은 그 자리에서 고친다) ───

const MARK = /(\w+)([\s\S]*?)/g;

/** 마커로 감싼 칸을 제자리 편집 영역으로 바꾼다 */
function decorate(host: HTMLElement) {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) if ((walker.currentNode.nodeValue ?? '').includes('')) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const text = node.nodeValue ?? '';
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(MARK)) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const span = document.createElement('span');
      span.dataset.slot = m[1];
      span.contentEditable = 'plaintext-only';
      span.spellcheck = false;
      span.textContent = m[2];
      span.style.cssText = 'background:#fff6bf;outline:1px dashed #d4a72c;min-width:2.5em;min-height:1.2em;display:inline-block;white-space:pre-wrap;cursor:text;padding:0 2px';
      frag.appendChild(span);
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode?.replaceChild(frag, node);
  }
}

/** 칸 목록: 어느 항목을 넣을지 바꾼다 (PDF는 값도 여기서 고친다) */
function SlotList({ t, fields, withValue }: { t: ApprovalTemplate; fields: ApprovalField[]; withValue: boolean }) {
  const { tpl } = t;
  if (!tpl) return null;
  return (
    <div className="space-y-2 rounded-lg bg-white p-3 text-[12px] text-neutral-900">
      {tpl.slots.map((s) => {
        const v = t.valueOf(s);
        return (
          <div key={s.id} className={withValue ? 'grid grid-cols-[180px_1fr] gap-3 border-b border-neutral-200 pb-2' : 'flex items-center gap-2'}>
            <div className="min-w-0">
              <div className="truncate font-semibold" title={s.label}>
                {s.label} <span className="font-normal text-neutral-500">{s.context}</span>
              </div>
              <select className="mt-1 h-7 w-full rounded-md border bg-white px-1" value={tpl.mapping[s.id] ?? ''} onChange={(e) => t.remap(s.id, e.target.value)}>
                <option value="">비워 둠</option>
                {fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            {withValue && (
              <textarea className="min-h-9 w-full resize-y rounded-md border bg-white p-1.5 leading-snug" rows={Math.min(8, Math.max(1, v.split('\n').length))} value={v} placeholder="(비어 있음)" onChange={(e) => t.edit(s.id, e.target.value)} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 올린 양식 파일을 실제 모양으로 띄우고, 채워진 칸(노란 표시)을 그 자리에서 고친다 */
export function TemplatePreview({ t, fields }: { t: ApprovalTemplate; fields: ApprovalField[] }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ loading: boolean; error: string; pdf: Uint8Array | null }>({ loading: false, error: '', pdf: null });
  const [showMap, setShowMap] = useState(false);
  const latest = useRef(t);
  latest.current = t;
  const tpl = t.tpl;
  const kind = tpl?.kind;

  useEffect(() => {
    t.collectRef.current = () => {
      const out: Record<string, string> = {};
      host.current?.querySelectorAll<HTMLElement>('[data-slot]').forEach((el) => {
        out[el.dataset.slot!] = (el.textContent ?? '').replace(/\n$/, '');
      });
      return out;
    };
    return () => {
      t.collectRef.current = null;
    };
  }, [t.collectRef, kind]);

  useEffect(() => {
    const cur = latest.current;
    if (!cur.tpl) return;
    let dead = false;
    setState((s) => ({ ...s, loading: true, error: '' }));
    const values = Object.fromEntries(cur.tpl.slots.map((s) => [s.id, cur.valueOf(s)]));
    void (async () => {
      try {
        const res = await window.doldari.templatePreview(values);
        if (dead || !host.current) return;
        if (!res.ok) {
          setState({ loading: false, error: res.error, pdf: null });
          return;
        }
        host.current.innerHTML = '';
        let pdf: Uint8Array | null = null;
        if (res.kind === 'docx' && res.bytes) await renderAsync(new Blob([new Uint8Array(res.bytes)]), host.current, undefined, { className: 'docx', inWrapper: true, breakPages: true });
        else if (res.html) host.current.innerHTML = res.html;
        else if (res.kind === 'pdf' && res.bytes) pdf = new Uint8Array(res.bytes);
        if (dead || !host.current) return;
        decorate(host.current);
        setState({ loading: false, error: '', pdf });
      } catch (e) {
        if (!dead) setState({ loading: false, error: `미리보기를 그리지 못했어요: ${e instanceof Error ? e.message : String(e)}`, pdf: null });
      }
    })();
    return () => {
      dead = true;
    };
  }, [t.version, tpl?.name]);

  if (!tpl) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[12px] text-neutral-700">
        <span>{kind === 'pdf' ? '채워진 PDF예요. 값은 아래 칸 목록에서 고치고 "미리보기 갱신"을 누르세요.' : '노란 칸을 눌러 그 자리에서 고치세요. 고친 글자 그대로 내려받는 파일에 들어가요.'}</span>
        {kind === 'pdf' && (
          <Button size="sm" variant="outline" className="h-7" onClick={() => t.refresh()}>
            미리보기 갱신
          </Button>
        )}
        <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => setShowMap((v) => !v)}>
          {showMap ? '칸 연결 접기' : '칸 연결 보기'}
        </Button>
      </div>
      {state.loading && <div className="rounded-md bg-white/80 p-3 text-center text-[12px] text-neutral-600">양식을 그리는 중…</div>}
      {state.error && <div className="rounded-md bg-white p-3 text-[12px] text-red-600">{state.error}</div>}
      {showMap && <SlotList t={t} fields={fields} withValue={kind === 'pdf'} />}
      {kind === 'pdf' && state.pdf && <PdfPaper data={state.pdf} title="채워진 PDF" className="max-h-[60vh]" />}
      <div ref={host} className="overflow-x-auto" />
      {kind === 'pdf' && !showMap && <SlotList t={t} fields={fields} withValue />}
    </div>
  );
}
