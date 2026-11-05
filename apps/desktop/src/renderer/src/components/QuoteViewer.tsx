import { useState } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import type { Requirements, VendorId } from '@shared/types';
import { buildDoc } from '@shared/quote';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
  // 이전 검색 카드에서 연 견적서면 그 검색의 값으로
  const { quotes, requirements, vendors, originals } = viewer?.scope ?? live;
  const [saved, setSaved] = useState('');
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
            <div className="min-w-0 space-y-1">
              <DialogTitle>통합 견적서</DialogTitle>
              <DialogDescription>{req.item} · 업체별 견적을 같은 기준으로 한 장에 모았어요</DialogDescription>
            </div>
            <Button size="sm" variant="outline" className="ml-auto mr-8" onClick={async () => setSaved((await saveDocPdf(el, `통합견적서_${req.item}`)) ?? '')}>
              <Download className="size-4" /> PDF 저장
            </Button>
          </DialogHeader>
          {saved && <div className="truncate text-[12px] text-ok" title={saved}>PDF로 저장했어요 · {saved}</div>}
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-neutral-300/90 p-6">
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
          <TabsContent value="doc" className="min-h-0 overflow-y-auto rounded-lg bg-neutral-300/90 p-6">
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
