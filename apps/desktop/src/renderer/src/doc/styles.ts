// 견적서 문서 스타일 (화면 미리보기와 PDF가 같은 CSS를 쓴다)
export const DOC_CSS = `
.dl-paper{background:#fff;color:#111827;width:794px;min-height:1123px;margin:0 auto;padding:44px 48px;box-sizing:border-box;font-family:"Pretendard",-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;font-size:12px;line-height:1.5}
.dl-paper *{box-sizing:border-box}
.dl-title{text-align:center;font-size:26px;font-weight:800;letter-spacing:14px;margin:0 0 18px}
.dl-sub{text-align:center;color:#6b7280;margin:-12px 0 16px;font-size:11px}
.dl-head{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:10px}
.dl-meta{color:#374151;font-size:11px}
.dl-to{font-size:15px;font-weight:700;border-bottom:1.5px solid #111827;padding-bottom:4px;min-width:240px}
.dl-to small{font-weight:500;color:#374151;margin-left:6px}
.dl-table{width:100%;border-collapse:collapse;margin:8px 0}
.dl-table th,.dl-table td{border:1px solid #9ca3af;padding:6px 8px;vertical-align:middle}
.dl-table th{background:#f3f4f6;font-weight:600;color:#374151;white-space:nowrap}
.dl-vert{writing-mode:vertical-rl;text-align:center;letter-spacing:6px;width:28px;background:#f3f4f6;font-weight:700}
.dl-lead{text-align:center;font-weight:700;margin:14px 0 6px}
.dl-amount{display:flex;align-items:center;justify-content:space-between;border:2px solid #111827;padding:10px 14px;margin:6px 0 10px;background:#f9fafb}
.dl-amount b{font-size:16px}
.dl-amount .won{font-size:20px;font-weight:800}
.dl-items th{text-align:center}
.dl-items td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.dl-items td.c{text-align:center}
.dl-items tr.sum td{background:#f9fafb;font-weight:600}
.dl-items tr.total td{background:#eef2ff;font-weight:800;font-size:13px}
.dl-items tr.opt td{color:#6b7280}
.dl-q{color:#ea580c;font-weight:800}
.dl-src{display:inline-block;margin-left:4px;padding:0 4px;border-radius:3px;background:#e5e7eb;color:#4b5563;font-size:9px;vertical-align:1px}
.dl-notes{border:1px solid #9ca3af;padding:8px 12px;margin-top:10px}
.dl-notes h4{margin:0 0 4px;font-size:12px}
.dl-notes ul{margin:0;padding-left:16px}
.dl-warn{border:1.5px solid #fb923c;background:#fff7ed;padding:8px 12px;margin-top:8px;color:#9a3412}
.dl-foot{margin-top:18px;color:#6b7280;font-size:10px;text-align:center;border-top:1px solid #e5e7eb;padding-top:8px}
.dl-rec{border:2px solid #2563eb;background:#eff6ff;padding:10px 14px;margin:10px 0}
.dl-rec b{color:#1d4ed8;font-size:14px}
.dl-cmp th.v{background:#e0e7ff}
.dl-cmp td.n{text-align:right;font-variant-numeric:tabular-nums}
.dl-cmp td.best{background:#eff6ff;font-weight:800}
.dl-cmp tr.total td{font-weight:800;font-size:13px;background:#f9fafb}
.dl-bad{color:#dc2626;font-weight:600}
.dl-ok{color:#047857;font-weight:600}
.dl-h3{font-size:13px;font-weight:800;margin:16px 0 4px;border-left:4px solid #2563eb;padding-left:8px}
.dl-sign{width:auto;margin:8px 0}
.dl-sign th{min-width:64px;text-align:center}
.dl-sign td.box{height:54px}
.dl-sent{margin:4px 0;padding-left:18px}
.dl-sent li{margin:2px 0}
.dl-ref{color:#2563eb;font-size:9px;margin-left:1px}
.dl-ev td,.dl-ev th{font-size:10px}
.dl-ev td.c{text-align:center}
@media print{.dl-paper{width:auto;min-height:0;padding:28px 32px}}
`;
