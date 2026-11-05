import { useEffect, useState } from 'react';
import { FileUp, X } from 'lucide-react';
import type { ApprovalField } from '@shared/approval';
import type { TemplateInfo } from '@shared/template';
import { Button } from '@/components/ui/button';

/** 회사 품의서 양식 올리기 → 칸 연결 확인 → 양식 파일로 저장 */
export function ApprovalTemplatePanel({ fields }: { fields: ApprovalField[] }) {
  const [tpl, setTpl] = useState<TemplateInfo | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [showMap, setShowMap] = useState(false);

  useEffect(() => {
    void window.doldari.templateGet().then(setTpl);
  }, []);

  const upload = async (file: File | undefined) => {
    if (!file) return;
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
    setShowMap(true);
    setMsg(res.template.mappedBy === 'ai' ? 'AI가 양식의 칸을 품의서 항목에 연결했어요. 맞는지 확인해 주세요.' : 'API 키가 없거나 AI 호출이 실패해 칸 이름으로 짐작해 연결했어요. 맞는지 확인해 주세요.');
  };

  const remap = (slotId: string, key: string) => {
    if (!tpl) return;
    const mapping = { ...tpl.mapping, [slotId]: key || null };
    setTpl({ ...tpl, mapping });
    void window.doldari.templateSetMapping(mapping);
  };

  const fill = async () => {
    setBusy(true);
    const res = await window.doldari.templateFill(Object.fromEntries(fields.map((f) => [f.key, f.value])));
    setBusy(false);
    if (res.path) setMsg(`양식으로 저장했어요 · ${res.path}${res.skipped?.length ? ` · 값이 없어 비워 둔 칸: ${res.skipped.join(', ')}` : ''}`);
    else if (res.error) setMsg(res.error);
  };

  const clear = async () => {
    await window.doldari.templateClear();
    setTpl(null);
    setMsg('');
  };

  return (
    <div className="rounded-lg border bg-card p-2.5 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">회사 양식</span>
        {tpl ? (
          <>
            <span className="truncate text-muted-foreground" title={tpl.name}>
              {tpl.name} · 채울 칸 {tpl.slots.length}개
            </span>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setShowMap((v) => !v)}>
              {showMap ? '연결 접기' : '연결 보기'}
            </Button>
            <Button size="sm" className="h-7" disabled={busy} onClick={() => void fill()}>
              양식으로 저장
            </Button>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => void clear()}>
              <X className="size-3.5" /> 양식 빼기
            </Button>
          </>
        ) : (
          <span className="text-muted-foreground">없으면 아래 기본 양식을 써요. docx · xlsx · hwpx · 입력란 있는 PDF를 올릴 수 있어요.</span>
        )}
        <label className="ml-auto">
          <input
            type="file"
            accept=".docx,.xlsx,.hwpx,.pdf"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <span className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border px-2.5 text-[12px] font-medium hover:bg-accent">
            <FileUp className="size-3.5" /> {busy ? '읽는 중…' : tpl ? '다른 양식 올리기' : '양식 올리기'}
          </span>
        </label>
      </div>
      {msg && <div className="mt-1.5 break-all text-muted-foreground">{msg}</div>}
      {tpl && showMap && (
        <div className="mt-2 max-h-44 space-y-1 overflow-y-auto">
          {tpl.slots.map((s) => (
            <div key={s.id} className="flex items-center gap-2">
              <span className="w-52 shrink-0 truncate" title={`${s.label} · ${s.context ?? ''}`}>
                {s.label}
                <span className="ml-1 text-muted-foreground">{s.context}</span>
              </span>
              <select className="h-7 min-w-0 flex-1 rounded-md border bg-background px-1.5" value={tpl.mapping[s.id] ?? ''} onChange={(e) => remap(s.id, e.target.value)}>
                <option value="">비워 둠</option>
                {fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
