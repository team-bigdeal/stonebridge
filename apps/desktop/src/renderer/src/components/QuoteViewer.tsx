import { useEffect, useMemo, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChevronLeft, ChevronRight, Download, ExternalLink, Sparkles } from 'lucide-react';
import type { Quote, Requirements, VendorId } from '@shared/types';
import { buildDoc } from '@shared/quote';
import { applyPolished, approvalFields, buildApproval, buildPolishInput, type ApprovalHeader, type PolishResult } from '@shared/approval';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApprovalDocument } from '@/doc/ApprovalDocument';
import { TemplateBar, TemplatePreview, useApprovalTemplate } from '@/components/ApprovalTemplatePanel';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useStore } from '@/store';
import { QuoteDocument } from '@/doc/QuoteDocument';
import { IntegratedDocument } from '@/doc/IntegratedDocument';
import { DOC_CSS } from '@/doc/styles';
import { saveDocPdf, saveHtmlPdf, saveXlsx } from '@/doc/print';
import { EditablePaper } from '@/doc/EditablePaper';
import { localIsoDate } from '@shared/parse';

/** 업체 견적서(통일 양식 ↔ 원본) / 통합 견적서 보기 */
export function QuoteViewer() {
  const live = useStore();
  const { viewer, set } = live;
  // 이전 검색 카드에서 연 견적서면 그 검색의 값으로
  const { quotes, requirements, vendors, originals } = viewer?.scope ?? live;
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  if (!viewer || !requirements?.deadline) return null;
  const req = requirements as Requirements;
  const urls = Object.fromEntries(vendors.map((v) => [v.id, v.url])) as Partial<Record<VendorId, string>>;
  const close = () => {
    set({ viewer: null });
    setSaved('');
    setError('');
  };

  if (viewer.kind === 'approval') return <ApprovalViewer req={req} quotes={quotes} urls={urls} onClose={close} />;

  if (viewer.kind === 'integrated') {
    const el = <IntegratedDocument quotes={quotes} req={req} urls={urls} />;
    return (
      <Dialog open onOpenChange={(o) => !o && close()}>
        <DialogContent className="flex max-h-[92vh] max-w-[900px] flex-col gap-3 sm:max-w-[900px]">
          <DialogHeader className="flex-row items-center gap-3">
            <div className="min-w-0 space-y-1">
              <DialogTitle>통합 견적서</DialogTitle>
              <DialogDescription>{req.item} · 업체별 견적을 같은 기준으로 한 장에 모았어요</DialogDescription>
            </div>
            <div className="ml-auto mr-8 flex gap-2">
              <Button size="sm" variant="outline" onClick={async () => setSaved((await saveDocPdf(el, `통합견적서_${req.item}`)) ?? '')}>
                <Download className="size-4" /> PDF 저장
              </Button>
              <Button size="sm" variant="outline" onClick={async () => {
                  setError('');
                  try {
                    // 화면 상태(프록시 등)를 떼어 순수 데이터로 보낸다
                    setSaved((await saveXlsx(JSON.parse(JSON.stringify({ quotes, req, urls, fileName: `통합견적서_${req.item}` })))) ?? '');
                  } catch (e) {
                    setSaved('');
                    setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
                  }
                }}>
                <Download className="size-4" /> 엑셀로 저장
              </Button>
            </div>
          </DialogHeader>
          {saved && <div className="truncate text-[12px] text-ok" title={saved}>저장했어요 · {saved}</div>}
          {error && <div className="text-[12px] text-destructive">엑셀 저장 실패 · {error}</div>}
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-background p-6">
            <style>{DOC_CSS}</style>
            {el}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const q = quotes[viewer.id];
  if (!q) return null;
  const doc = buildDoc(q, req, urls[viewer.id]);
  const el = <QuoteDocument doc={doc} req={req} channel={q.channel} />;
  const origs = originals[viewer.id] ?? [];
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex max-h-[92vh] max-w-[900px] flex-col gap-3 sm:max-w-[900px]">
        <DialogHeader className="flex-row items-center gap-3">
          <div className="min-w-0 space-y-1">
            <DialogTitle className="truncate">{q.vendorName}</DialogTitle>
            <DialogDescription>{viewer.id} 업체 견적서 · 통일 양식과 받은 원본을 나란히 볼 수 있어요</DialogDescription>
          </div>
          <Button size="sm" variant="outline" className="ml-auto mr-8" onClick={async () => setSaved((await saveDocPdf(el, `견적서_${viewer.id}_${q.vendorName}`)) ?? '')}>
            <Download className="size-4" /> PDF 저장
          </Button>
        </DialogHeader>
        {saved && <div className="truncate text-[12px] text-ok" title={saved}>PDF로 저장했어요 · {saved}</div>}
        <Tabs defaultValue="doc" className="min-h-0 flex-1">
          <TabsList>
            <TabsTrigger value="doc">통일 양식</TabsTrigger>
            <TabsTrigger value="orig">받은 원본 {origs.length > 0 && <span className="tabular-nums text-muted-foreground">{origs.length}</span>}</TabsTrigger>
          </TabsList>
          <TabsContent value="doc" className="min-h-0 overflow-y-auto rounded-lg bg-background p-6">
            <style>{DOC_CSS}</style>
            {el}
          </TabsContent>
          <TabsContent value="orig" className="min-h-0 space-y-3 overflow-y-auto">
            {origs.length === 0 && <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">아직 보관한 원본이 없어요. 웹 화면, 메일 회신, 올린 파일이 여기에 쌓여요.</div>}
            {[...origs].reverse().map((o) => (
              <div key={o.id} className="rounded-lg border bg-card p-3">
                <div className="mb-2 flex items-center gap-2 text-[12px] text-muted-foreground">
                  <span className="font-semibold text-foreground">{o.channel === 'web' ? '웹 화면' : o.channel === 'mail' ? '메일 회신' : '견적서 파일'}</span>
                  <span className="truncate">{o.title}</span>
                  {o.url && (
                    <Button size="sm" variant="ghost" className="ml-auto h-6" onClick={() => window.doldari.openExternal(o.url!)}>
                      <ExternalLink className="size-3.5" /> 열기
                    </Button>
                  )}
                </div>
                {o.image && <img src={o.image} alt="" className="w-full rounded border" />}
                {o.fileData && o.mime?.startsWith('image/') && <img src={o.fileData} alt="" className="w-full rounded border" />}
                {o.fileData && o.mime === 'application/pdf' && <PdfFrame title={o.title} dataUrl={o.fileData} />}
                {o.text && <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded bg-muted p-3 font-sans text-[13px]">{o.text}</pre>}
              </div>
            ))}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

const HEADER_KEY = 'doldari.approvalHeader';
const DEFAULT_HEADER: ApprovalHeader = { dept: '', author: '', roles: ['담당', '팀장', '본부장'] };

/** 기안부서·기안자·결재선은 이 컴퓨터에 기억 (저장소를 못 쓰면 기본값) */
function readHeader(): ApprovalHeader {
  try {
    const raw = JSON.parse(localStorage.getItem(HEADER_KEY) ?? 'null') as Partial<ApprovalHeader> | null;
    if (!raw) return DEFAULT_HEADER;
    const roles = Array.isArray(raw.roles) && raw.roles.length > 0 ? raw.roles.map(String).slice(0, 5) : DEFAULT_HEADER.roles;
    return { dept: String(raw.dept ?? ''), author: String(raw.author ?? ''), roles };
  } catch {
    return DEFAULT_HEADER;
  }
}


/** 구매 품의서 초안 (템플릿 문장 + 근거 붙임). 회사 양식을 끌어다 놓으면 옆 페이지로 넘겨 고치고 내려받는다 */
function ApprovalViewer({ req, quotes, urls, onClose }: { req: Requirements; quotes: Partial<Record<VendorId, Quote>>; urls: Partial<Record<VendorId, string>>; onClose: () => void }) {
  const [header, setHeader] = useState<ApprovalHeader>(readHeader);
  const [saved, setSaved] = useState('');
  const [page, setPage] = useState<0 | 1>(0);
  const [dragging, setDragging] = useState(false);
  const baseDoc = useMemo(() => buildApproval(quotes, req, urls, { date: localIsoDate() }), [quotes, req, urls]);
  const polishInput = useMemo(() => buildPolishInput(baseDoc), [baseDoc]);
  const polishKey = useMemo(() => JSON.stringify(polishInput), [polishInput]);
  // AI가 다듬은 문장 (사실이 바뀌면 버리고 템플릿 문장으로 돌아간다)
  const [polish, setPolish] = useState<{ key: string; result: PolishResult } | null>(null);
  const [polishMsg, setPolishMsg] = useState('');
  const [polishBusy, setPolishBusy] = useState(false);
  useEffect(() => {
    if (tried.current !== polishKey) void runPolish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polishKey]);
  const doc = useMemo(() => (polish && polish.key === polishKey ? applyPolished(baseDoc, polish.result) : baseDoc), [baseDoc, polish, polishKey]);
  /** 같은 사실에 대해 자동 다듬기를 한 번만 시도한다 (되돌리거나 실패해도 다시 돌지 않게) */
  const tried = useRef('');
  const runPolish = async () => {
    tried.current = polishKey;
    setPolishBusy(true);
    setPolishMsg('');
    try {
      const res = await window.doldari.polishApproval(polishInput);
      if (!res.ok) {
        setPolishMsg(res.error);
        return;
      }
      const total = polishInput.purpose.length + polishInput.reasons.length;
      const used = [...res.result.purpose, ...res.result.reasons].filter(Boolean).length;
      setPolish({ key: polishKey, result: res.result });
      setPolishMsg(used === 0 ? '검증을 통과한 문장이 없어 템플릿 문장을 그대로 씁니다.' : `${total}문장 중 ${used}문장을 다듬었어요.${used < total ? ` 나머지 ${total - used}문장은 검증(숫자·근거 번호)을 통과하지 못해 템플릿 문장을 썼어요.` : ''} 본문에서 직접 고친 내용은 초기화됐어요.`);
    } catch {
      setPolishMsg('AI 호출에 실패해 템플릿 문장을 그대로 씁니다.');
    } finally {
      setPolishBusy(false);
    }
  };
  const fields = useMemo(() => approvalFields(doc, header), [doc, header]);
  const t = useApprovalTemplate(fields, () => setPage(1));
  const hasTpl = t.tpl !== null;
  const view = hasTpl ? page : 0;
  const update = (p: Partial<ApprovalHeader>) => {
    const next = { ...header, ...p };
    setHeader(next);
    try {
      localStorage.setItem(HEADER_KEY, JSON.stringify(next));
    } catch {
      /* 저장소를 못 쓰면 이번 화면에서만 유지 */
    }
  };
  const paper = useRef<HTMLDivElement>(null);
  const markup = useMemo(() => renderToStaticMarkup(<ApprovalDocument doc={doc} header={header} />), [doc, header]);
  const arrow = 'absolute top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full border bg-background/95 shadow-md hover:bg-accent';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="flex max-h-[92vh] max-w-[900px] flex-col gap-3 sm:max-w-[900px]"
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer.types).includes('Files')) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void t.upload(e.dataTransfer.files[0]);
        }}
      >
        {dragging && <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/85 text-[15px] font-semibold">여기에 회사 품의서 양식을 놓으세요 (docx · xlsx · hwpx · PDF)</div>}
        <DialogHeader className="flex-row items-center gap-3">
          <div className="min-w-0 space-y-1">
            <DialogTitle>{view === 0 ? '구매 품의서 초안' : '회사 양식으로 작성'}</DialogTitle>
            <DialogDescription>{view === 0 ? `${req.item} · 모든 숫자에 근거 번호를 붙이고 붙임에 출처를 모았어요` : '칸마다 들어갈 글자를 확인하고 고친 뒤 내려받으세요'}</DialogDescription>
          </div>
          {view === 0 ? (
            <Button size="sm" variant="outline" className="ml-auto mr-8" onClick={async () => setSaved((await saveHtmlPdf(paper.current?.innerHTML ?? markup, `품의서_${req.item}`)) ?? '')}>
              <Download className="size-4" /> PDF 저장
            </Button>
          ) : (
            <Button size="sm" className="ml-auto mr-8" disabled={t.busy} onClick={() => void t.download()}>
              <Download className="size-4" /> 다운로드 (.{t.tpl?.kind})
            </Button>
          )}
        </DialogHeader>
        {view === 0 && (
          <>
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <Input className="h-8 w-36" placeholder="기안부서" value={header.dept} onChange={(e) => update({ dept: e.target.value })} />
            <Input className="h-8 w-28" placeholder="기안자" value={header.author} onChange={(e) => update({ author: e.target.value })} />
            <span className="text-muted-foreground">결재선</span>
            <Input className="h-8 w-64" placeholder="담당, 팀장, 본부장" value={header.roles.join(', ')} onChange={(e) => update({ roles: e.target.value.split(/[,，]/).map((r) => r.trim()).filter(Boolean).slice(0, 5) })} />
            <span className="ml-auto flex items-center gap-1 text-muted-foreground">
              <Sparkles className="size-3.5" /> {polishBusy ? 'AI가 문장을 다듬는 중…' : doc.polishedCount ? `AI가 ${doc.polishedCount}문장을 다듬었어요` : 'AI 다듬기 없음'}
            </span>
            <Button size="sm" variant="ghost" className="h-8" disabled={polishBusy} onClick={() => void runPolish()}>
              다시 다듬기
            </Button>
            {doc.polishedCount ? (
              <Button size="sm" variant="ghost" className="h-8" onClick={() => { setPolish(null); setPolishMsg('템플릿 문장으로 되돌렸어요.'); }}>
                원래 문장으로
              </Button>
            ) : null}
          </div>
          {polishMsg && <div className="-mt-1 text-[12px] text-muted-foreground">{polishMsg}</div>}
          </>
        )}
        <TemplateBar t={t} />
        {view === 0 && saved && <div className="truncate text-[12px] text-ok" title={saved}>PDF로 저장했어요 · {saved}</div>}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-background p-6">
            <style>{DOC_CSS}</style>
            {/* 두 페이지를 계속 그려 둬서 넘겨도 고친 내용이 남는다 */}
            <div className={view === 0 ? '' : 'hidden'}>
              <EditablePaper markup={markup} hostRef={paper} />
            </div>
            {hasTpl && (
              <div className={view === 1 ? '' : 'hidden'}>
                <TemplatePreview t={t} fields={fields} />
              </div>
            )}
          </div>
          {hasTpl && view === 0 && (
            <button type="button" className={`${arrow} -right-5`} title="회사 양식 페이지로" onClick={() => setPage(1)}>
              <ChevronRight className="size-5" />
            </button>
          )}
          {hasTpl && view === 1 && (
            <button type="button" className={`${arrow} -left-5`} title="기본 품의서로" onClick={() => setPage(0)}>
              <ChevronLeft className="size-5" />
            </button>
          )}
          {hasTpl && <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-background/90 px-3 py-0.5 text-[11px] text-muted-foreground shadow">{view === 0 ? '기본 양식' : '회사 양식'} · {view + 1} / 2</div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 받은 PDF를 앱 안 PDF 뷰어로 (data: URL은 iframe에서 막히는 경우가 있어 blob: URL로 바꿔 띄운다) */
function PdfFrame({ title, dataUrl }: { title: string; dataUrl: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [dataUrl]);
  if (!src) return null;
  return <iframe title={title} src={src} className="h-[70vh] w-full rounded border bg-white" />;
}
