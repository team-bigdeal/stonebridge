// 받은 PDF 견적서를 종이처럼 보여 준다: pdf.js로 쪽마다 캔버스에 그린다 (Chromium PDF 뷰어의 도구 막대·회색 바탕 없이)
import { useEffect, useRef, useState } from 'react';
import { Check, Download, Loader2, Minus, Plus } from 'lucide-react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFWorker, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** data: URL 또는 PDF 바이트 */
export type PdfData = string | Uint8Array;

let lib: Promise<{ m: typeof import('pdfjs-dist'); worker: PDFWorker }> | null = null;
/** pdf.js는 처음 PDF를 볼 때 불러오고, 해석용 워커 하나를 모든 미리보기가 같이 쓴다 */
function pdfjs() {
  lib ??= import('pdfjs-dist').then((m) => {
    m.GlobalWorkerOptions.workerSrc = workerUrl;
    // 워커를 직접 만들어 넘긴다. pdf.js에 맡기면 빌드한 앱(file://)에서 blob: 주소로 감싸 CSP에 막히고 화면 스레드에서 돈다
    let port: Worker | undefined;
    try {
      port = new Worker(workerUrl, { type: 'module' });
    } catch {
      // 못 만들면 pdf.js가 화면 스레드에서 연다 (느려도 그려지기는 한다)
    }
    return { m, worker: m.PDFWorker.create({ port }) };
  });
  return lib;
}

/** pdf.js가 넘겨받은 바이트를 워커로 옮기면 원래 배열이 비므로 늘 새로 만든다 */
function bytesOf(data: PdfData) {
  if (typeof data !== 'string') return data.slice();
  const bin = atob(data.slice(data.indexOf(',') + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function usePdf(data: PdfData) {
  const [state, setState] = useState<{ doc: PDFDocumentProxy | null; error: boolean }>({ doc: null, error: false });
  useEffect(() => {
    let task: PDFDocumentLoadingTask | null = null;
    let dead = false;
    setState({ doc: null, error: false });
    // 한글 CMap·표준 글꼴·이미지 해석 파일 (electron.vite.config.ts의 pdfjsAssets가 pdfjs/ 아래에 둔다)
    const dir = (d: string) => new URL(`pdfjs/${d}/`, document.baseURI).href;
    pdfjs()
      .then(({ m, worker }) => {
        if (dead) return;
        task = m.getDocument({ data: bytesOf(data), worker, cMapUrl: dir('cmaps'), standardFontDataUrl: dir('standard_fonts'), wasmUrl: dir('wasm'), iccUrl: dir('iccs') });
        return task.promise.then((doc) => {
          if (!dead) setState({ doc, error: false });
        });
      })
      .catch(() => {
        if (!dead) setState({ doc: null, error: true });
      });
    return () => {
      dead = true;
      void task?.destroy();
    };
  }, [data]);
  return state;
}

/** 칸의 안쪽 너비 (창 크기·앱 배율이 바뀌면 다시 잰다) */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 처음 한 번은 바로 잰다 (창이 가려져 있으면 ResizeObserver가 늦게 온다)
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const PAPER = 'block rounded-[2px] bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_1px_4px_rgba(0,0,0,0.10)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.08)]';

function PdfPage({ doc, n, width }: { doc: PDFDocumentProxy; n: number; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // 쪽을 읽기 전에는 A4 세로 비율로 자리를 잡아 둔다
  const [ratio, setRatio] = useState(Math.SQRT2);
  useEffect(() => {
    let task: RenderTask | null = null;
    let dead = false;
    doc
      .getPage(n)
      .then((page) => {
        const canvas = ref.current;
        if (dead || !canvas) return;
        const base = page.getViewport({ scale: 1 });
        setRatio(base.height / base.width);
        // 화면 픽셀 밀도만큼 크게 그려야 글자가 또렷하다
        const viewport = page.getViewport({ scale: (width / base.width) * (window.devicePixelRatio || 1) });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        task = page.render({ canvas, viewport });
        return task.promise;
      })
      .catch(() => undefined);
    return () => {
      dead = true;
      task?.cancel();
    };
  }, [doc, n, width]);
  return <canvas ref={ref} aria-label={`${n}쪽`} className={PAPER} style={{ width, height: Math.round(width * ratio) }} />;
}

/** PDF 쪽들을 흰 종이처럼 세로로 쌓는다. 폭은 감싸는 칸에 맞추고 zoom배로 키운다 (넘치면 칸 안에서 스크롤) */
export function PdfPaper({ data, title, zoom = 1, className }: { data: PdfData; title: string; zoom?: number; className?: string }) {
  const { doc, error } = usePdf(data);
  const [ref, width] = useWidth();
  // 종이 그림자가 잘리지 않게 양옆 4px씩 남긴다
  const pageWidth = Math.max(0, Math.floor((width - 8) * zoom));
  return (
    <div ref={ref} role="document" aria-label={title} className={cn('overflow-auto', className)}>
      {error ? (
        <p className="rounded-md border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">PDF를 그리지 못했어요. "PDF 저장"으로 내려받아 열어 보세요.</p>
      ) : (
        <div className="mx-auto flex w-fit flex-col gap-3 p-1">
          {doc && pageWidth > 0 ? (
            Array.from({ length: doc.numPages }, (_, i) => <PdfPage key={i} doc={doc} n={i + 1} width={pageWidth} />)
          ) : (
            <div className={cn(PAPER, 'flex items-center justify-center gap-2 text-[13px] text-neutral-400')} style={{ width: pageWidth, height: Math.round(pageWidth * Math.SQRT2) }}>
              <Loader2 className="size-4 animate-spin" /> PDF 여는 중
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 받은 PDF 원본을 그대로 저장 (저장 위치는 main이 묻는다). 저장한 경로를 돌려준다 */
export function savePdfFile(data: PdfData, fileName: string) {
  return window.doldari.savePdfFile(bytesOf(data), fileName.replace(/\.pdf$/i, ''));
}

/** "PDF 저장" 버튼: 저장하면 잠깐 "저장했어요"로 바뀐다 */
export function SavePdfButton({ data, fileName, label = 'PDF 저장', className }: { data: PdfData; fileName: string; label?: string; className?: string }) {
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [saved]);
  return (
    <Button size="sm" variant="ghost" className={cn('h-7 px-2 text-[13px] text-muted-foreground', className)} onClick={async () => setSaved(!!(await savePdfFile(data, fileName)))}>
      {saved ? <Check className="size-3.5 text-ok" /> : <Download className="size-3.5" />}
      {saved ? '저장했어요' : label}
    </Button>
  );
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/** 확대·축소와 저장이 붙은 PDF 보기 (받은 원본 탭, 크게 보기 창) */
export function PdfViewer({ data, title, fileName, className }: { data: PdfData; title: string; fileName: string; className?: string }) {
  const [zoom, setZoom] = useState(1);
  const i = ZOOMS.indexOf(zoom);
  return (
    <div className={cn('flex min-h-0 flex-col gap-2', className)}>
      <div className="flex items-center gap-1 text-[13px] text-muted-foreground">
        <Button size="icon-xs" variant="ghost" aria-label="축소" disabled={i <= 0} onClick={() => setZoom(ZOOMS[i - 1])}>
          <Minus />
        </Button>
        <span className="w-11 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <Button size="icon-xs" variant="ghost" aria-label="확대" disabled={i >= ZOOMS.length - 1} onClick={() => setZoom(ZOOMS[i + 1])}>
          <Plus />
        </Button>
        {zoom !== 1 && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[13px] text-muted-foreground" onClick={() => setZoom(1)}>
            폭에 맞춤
          </Button>
        )}
        {/* 견적서 보기 창 위쪽의 "PDF 저장"(통일 양식)과 헷갈리지 않게 */}
        <SavePdfButton data={data} fileName={fileName} label="원본 PDF 저장" className="ml-auto" />
      </div>
      <PdfPaper data={data} title={title} zoom={zoom} className="min-h-0 flex-1" />
    </div>
  );
}
