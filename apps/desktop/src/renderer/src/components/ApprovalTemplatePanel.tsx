import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileUp, X } from 'lucide-react';
import type { ApprovalField } from '@shared/approval';
import type { TemplateInfo, TemplateSlot } from '@shared/template';
import { Button } from '@/components/ui/button';

const ACCEPT = /\.(docx|xlsx|hwpx|pdf)$/i;

/** 회사 양식: 올리기(클릭·드래그) → 칸 연결 → 화면에서 고치기 → 파일로 내려받기 */
export function useApprovalTemplate(fields: ApprovalField[], onUploaded: () => void) {
  const [tpl, setTpl] = useState<TemplateInfo | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  /** 사용자가 직접 고친 칸 값 (없으면 연결된 항목의 값) */
  const [edits, setEdits] = useState<Record<string, string>>({});

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
    setMsg(res.template.mappedBy === 'ai' ? 'AI가 양식의 칸을 품의서 항목에 연결했어요. 맞는지 확인하고 고쳐 주세요.' : 'API 키가 없거나 AI 호출이 실패해 칸 이름으로 짐작해 연결했어요. 맞는지 확인하고 고쳐 주세요.');
    onUploaded();
  };

  const remap = (slotId: string, key: string) => {
    if (!tpl) return;
    const mapping = { ...tpl.mapping, [slotId]: key || null };
    setTpl({ ...tpl, mapping });
    setEdits(({ [slotId]: _drop, ...rest }) => rest);
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
    const res = await window.doldari.templateFill(Object.fromEntries(tpl.slots.map((s) => [s.id, valueOf(s)])));
    setBusy(false);
    if (res.path) setMsg(`저장했어요 · ${res.path}${res.skipped?.length ? ` · 비워 둔 칸 ${res.skipped.length}개` : ''}`);
    else if (res.error) setMsg(res.error);
  };

  return { tpl, msg, busy, valueOf, upload, remap, edit, clear, download };
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

/** 양식 페이지: 칸마다 연결된 항목과 들어갈 글자를 보고 고친다 */
export function TemplateEditor({ t, fields }: { t: ApprovalTemplate; fields: ApprovalField[] }) {
  const { tpl } = t;
  if (!tpl) return null;
  return (
    <div className="mx-auto w-[794px] max-w-full rounded-sm bg-white p-8 text-[12px] text-neutral-900 shadow-sm">
      <div className="mb-1 text-[16px] font-bold">{tpl.name}</div>
      <div className="mb-4 text-neutral-500">칸마다 들어갈 글자예요. 직접 고치면 내려받는 파일에 그대로 들어가요. 항목을 바꾸면 그 칸 값이 항목의 값으로 다시 채워져요.</div>
      <div className="space-y-3">
        {tpl.slots.map((s) => {
          const v = t.valueOf(s);
          return (
            <div key={s.id} className="grid grid-cols-[180px_1fr] gap-3 border-b border-neutral-200 pb-3">
              <div className="min-w-0">
                <div className="truncate font-semibold" title={s.label}>
                  {s.label}
                </div>
                <div className="truncate text-[11px] text-neutral-500">{s.context}</div>
                <select className="mt-1 h-7 w-full rounded-md border bg-white px-1" value={tpl.mapping[s.id] ?? ''} onChange={(e) => t.remap(s.id, e.target.value)}>
                  <option value="">비워 둠</option>
                  {fields.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                className="min-h-9 w-full resize-y rounded-md border bg-white p-1.5 leading-snug"
                rows={Math.min(8, Math.max(1, v.split('\n').length))}
                value={v}
                placeholder="(비어 있음)"
                onChange={(e) => t.edit(s.id, e.target.value)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
