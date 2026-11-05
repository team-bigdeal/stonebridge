import { useState } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import type { Requirements, VendorId } from '@shared/types';
import { buildDoc } from '@shared/quote';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useStore } from '@/store';
import { QuoteDocument } from '@/doc/QuoteDocument';
import { IntegratedDocument } from '@/doc/IntegratedDocument';
import { DOC_CSS } from '@/doc/styles';
import { saveDocPdf } from '@/doc/print';

/** 업체 견적서(통일 양식 ↔ 원본) / 통합 견적서 보기 */
export function QuoteViewer() {
  const live = useStore();
  const { viewer, set } = live;
  const [saved, setSaved] = useState('');
  // 히스토리에서 연 견적이면 보관된 값으로 그린다
  const src = viewer?.record ?? live;
  const { quotes, requirements, vendors, originals } = src;
  if (!viewer || !requirements?.deadline) return null;
  const req = requirements as Requirements;
  const urls = Object.fromEntries(vendors.map((v) => [v.id, v.url])) as Partial<Record<VendorId, string>>;
  const close = () => {
    set({ viewer: null });
    setSaved('');
  };

  if (viewer.kind === 'integrated') {
    const el = <IntegratedDocument quotes={quotes} req={req} urls={urls} />;
    return (
      <Dialog open onOpenChange={(o) => !o && close()}>
        <DialogContent className="flex max-h-[92vh] max-w-[900px] flex-col gap-3 sm:max-w-[900px]">
          <DialogHeader className="flex-row items-center gap-3">
            <DialogTitle>통합 견적서</DialogTitle>
            <Button size="sm" className="ml-auto mr-8" onClick={async () => setSaved((await saveDocPdf(el, `통합견적서_${req.item}`)) ?? '')}>
              <Download className="size-4" /> PDF 저장
            </Button>
          </DialogHeader>
          {saved && <div className="text-xs text-muted-foreground">저장됨: {saved}</div>}
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-neutral-200 p-4">
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
          <DialogTitle>{viewer.id} 업체 견적서 · {q.vendorName}</DialogTitle>
          <Button size="sm" className="ml-auto mr-8" onClick={async () => setSaved((await saveDocPdf(el, `견적서_${viewer.id}_${q.vendorName}`)) ?? '')}>
            <Download className="size-4" /> PDF 저장
          </Button>
        </DialogHeader>
        {saved && <div className="text-xs text-muted-foreground">저장됨: {saved}</div>}
        <Tabs defaultValue="doc" className="min-h-0 flex-1">
          <TabsList>
            <TabsTrigger value="doc">통일 양식</TabsTrigger>
            <TabsTrigger value="orig">원본 ({origs.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="doc" className="min-h-0 overflow-y-auto rounded-lg bg-neutral-200 p-4">
            <style>{DOC_CSS}</style>
            {el}
          </TabsContent>
          <TabsContent value="orig" className="min-h-0 space-y-3 overflow-y-auto">
            {origs.length === 0 && <div className="p-6 text-sm text-muted-foreground">아직 보관된 원본이 없어요.</div>}
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
                {o.fileData && o.mime === 'application/pdf' && <iframe title={o.title} src={o.fileData} className="h-[70vh] w-full rounded border bg-white" />}
                {o.text && <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded bg-muted p-3 font-sans text-[13px]">{o.text}</pre>}
              </div>
            ))}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
