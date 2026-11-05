// 테스트용 목업 업체 (실제 사이트 아님)
//  A :4101 가격 공개 + 수량 옵션에 따라 금액 계산
//  B :4102 가격 비공개, 메일 문의만
//  D :4104 가격은 보이지만 배송비·제작 기간은 닫힌 "배송/교환" 탭 안에만 있음 (숨은 정보 탐색 테스트용)
//  E :4105 시트 단위 가격 (1시트 = 24개) — 1개 가격으로 잘못 읽으면 금액이 수십 배로 튐 (수량 재확인 테스트용)
//  F :4106 화면엔 가격이 없고, 수량을 고른 뒤 "견적서 다운로드"를 누르면 가견적서 PDF가 내려옴 (PDF 받기·분석 테스트용)
//  G :4107 가격 없이 카카오톡 채널·문자 상담으로만 견적 (문자·카톡 문의 초안 테스트용). /reply.pdf = 업체가 보낸 셈 치는 견적서
//  H :4108 "견적서 출력" → 신청자명만 묻는 모달 → "다음" → 인쇄용 HTML 견적서 (신청자명 양식 테스트용)
//          /popup = 같은 양식을 팝업 창(window.open)으로, /contact = 연락처·이메일·동의까지 묻는 양식 (넣지 않아야 함)
//  C :4103 첫 방문은 HTTP 418 "보안 확인" 화면 → 사용자가 "확인" 누르면 정상 페이지 (차단 감지·handoff 테스트용)
import http from 'node:http';

const page = (title, body) =>
  `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
  <style>body{font-family:-apple-system,"Apple SD Gothic Neo",sans-serif;margin:0;padding:24px;color:#222;max-width:820px}h1{font-size:22px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px 10px}.price{font-size:20px;font-weight:800;color:#d9480f}footer{margin-top:40px;font-size:12px;color:#777;border-top:1px solid #ddd;padding-top:10px}button{padding:8px 16px}</style></head><body>${body}</body></html>`;

const A = page(
  '스티커프린트 - 원형 방수 스티커',
  `<h1>원형 방수 스티커 (유포지, 유광 코팅)</h1>
  <p>규격: 지름 50mm 원형 · 유광 코팅 · 단면 칼라</p>
  <label for="qty">수량</label>
  <select id="qty" name="qty">
    <option value="1000">1000매</option><option value="3000">3000매</option><option value="5000">5000매</option>
  </select>
  <table style="margin-top:12px"><tbody>
    <tr><th>인쇄비</th><td id="supply">28,000 원</td></tr>
    <tr><th>부가세</th><td id="vat">2,800 원</td></tr>
    <tr><th>총 결제금액</th><td class="price" id="total">30,800 원</td></tr>
  </tbody></table>
  <script>
    const P = { 1000: 28000, 3000: 66000, 5000: 98000 };
    const f = (n) => n.toLocaleString('ko-KR') + ' 원';
    document.getElementById('qty').addEventListener('change', (e) => {
      const s = P[e.target.value];
      document.getElementById('supply').textContent = f(s);
      document.getElementById('vat').textContent = f(s / 10);
      document.getElementById('total').textContent = f(s * 1.1);
    });
  </script>
  <h3>배송 안내</h3><p>택배 배송비 3,000원 (5만원 이상 무료 아님)</p>
  <h3>출고</h3><p>주문 확정 후 4일 이내 출고</p>
  <footer>(주)스티커프린트 · 대표 홍길동 · 사업자등록번호 123-45-67890 · 대구광역시 중구 · 053-000-0000 · help@sticker-print.test</footer>`
);

const B = page(
  '라벨공방 - 주문제작 스티커',
  `<h1>라벨공방</h1><p>원형·사각·자유형 방수 스티커를 주문제작합니다.</p>
  <h3>가격 안내</h3><p>모든 제품은 주문제작이라 가격을 공개하지 않습니다.<br>견적은 메일로 문의해 주세요: <b>quote@label-gongbang.test</b></p>
  <footer>라벨공방 · 대표 김라벨 · 사업자등록번호 222-33-44444 · 서울 성동구</footer>`
);

const C_BLOCK = page(
  '보안 확인',
  `<h1>비정상적인 접근이 감지되었습니다</h1><p>보안 확인 후 이용해 주세요.</p>
  <form action="/verify" method="get"><button type="submit">확인</button></form>`
);
const C = page(
  '스티커팩토리 - 방수 스티커',
  `<h1>방수 스티커 원형 50mm</h1>
  <table><tbody>
    <tr><th>3000장</th><td class="price">66,000원 (부가세 포함)</td></tr>
    <tr><th>배송비</th><td>무료</td></tr>
    <tr><th>제작 기간</th><td>7일</td></tr>
  </tbody></table>
  <footer>스티커팩토리 · 사업자등록번호 333-44-55555 · 대구광역시 수성구 · 053-111-2222</footer>`
);

const D = page(
  '라벨하우스 - 원형 방수 스티커',
  `<h1>원형 방수 스티커 50mm (유광)</h1>
  <table><tbody>
    <tr><th>수량</th><td>3000매</td></tr>
    <tr><th>판매가 (부가세 포함)</th><td class="price">71,500 원</td></tr>
  </tbody></table>
  <nav style="margin-top:16px;display:flex;gap:8px">
    <button role="tab" aria-selected="true" onclick="show('detail')">상세정보</button>
    <button role="tab" aria-selected="false" onclick="show('ship')">배송/교환</button>
  </nav>
  <section id="detail"><p>방수 유포지에 유광 코팅으로 야외 행사에도 좋습니다.</p></section>
  <section id="ship" style="display:none">
    <h3>배송 정보</h3>
    <p>택배사: CJ대한통운 · 배송비 3,500원 (선결제)</p>
    <p>제작 기간: 시안 확정 후 4영업일 출고, 출고 후 1~2일 내 도착</p>
  </section>
  <script>function show(id){for(const s of document.querySelectorAll('section'))s.style.display=s.id===id?'':'none'}</script>
  <footer>(주)라벨하우스 · 대표 박지은 · 사업자등록번호 345-67-89012 · 02-555-0101 · help@labelhouse.test</footer>`
);

const E = page(
  '스티커몰 - 원형 스티커 시트',
  `<h1>원형 방수 스티커 50mm 유광</h1>
  <p class="price">600원</p>
  <p style="font-size:12px;color:#888">* 위 가격은 1시트(A4, 50mm 원형 24개 배치) 기준이며 부가세 포함입니다. 주문은 시트 단위입니다.</p>
  <p>배송비 2,500원 · 제작 3일 + 배송 1~2일</p>
  <footer>스티커몰 · 대표 이수현 · 사업자등록번호 456-78-90123 · 031-777-0202</footer>`
);

const F = page(
  '스티커팩토리 - 가견적서 발행',
  `<h1>원형 방수 스티커 50mm (유광)</h1>
  <p>가격은 가견적서로 확인하세요. 수량을 고른 뒤 <b>견적서 다운로드</b>를 누르면 PDF로 받을 수 있어요.</p>
  <form id="f" onsubmit="return false">
    <label for="qty">수량</label>
    <select id="qty" name="qty"><option value="1000">1000매</option><option value="3000">3000매</option><option value="5000">5000매</option></select>
    <button id="dl">견적서 다운로드</button>
  </form>
  <script>document.getElementById('dl').addEventListener('click', (e) => { e.preventDefault(); location.href = '/quote.pdf?qty=' + document.getElementById('qty').value; });</script>
  <footer>스티커팩토리 · 대표 정민호 · 사업자등록번호 567-89-01234 · 053-222-0303 · 대구 북구 · quote@stickerfactory.test</footer>`
);

/** 아주 작은 PDF (Helvetica, 영문·숫자만) */
function makePdf(lines) {
  const esc = (t) => t.replace(/[\\()]/g, (m) => '\\' + m);
  const content = 'BT /F1 12 Tf 50 780 Td 18 TL ' + lines.map((l) => `(${esc(l)}) Tj T*`).join(' ') + ' ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
const F_SUPPLY = { 1000: 25000, 3000: 60000, 5000: 90000 };
const won = (n) => n.toLocaleString('en-US') + ' KRW';
function fQuote(qty) {
  const supply = F_SUPPLY[qty] ?? F_SUPPLY[3000];
  return makePdf([
    'ESTIMATE (preliminary quote)  No. SF-20261105-' + qty,
    'Supplier: Sticker Factory  Biz No. 567-89-01234  Tel 053-222-0303',
    'Item: Round waterproof sticker, 50mm, glossy laminate',
    'Quantity: ' + qty + ' pcs',
    'Supply amount: ' + won(supply),
    'VAT (10%): ' + won(supply / 10),
    'Total (VAT incl.): ' + won(supply * 1.1),
    'Shipping: ' + won(2500) + ' (parcel, prepaid)',
    'Production: 4 business days after artwork approval, delivery 1 day',
    'Valid until: 2026-11-30',
    'Payment: bank transfer before production'
  ]);
}

// G: 가격·견적서 다운로드가 없고 카카오톡 채널·문자 상담으로만 견적을 준다 (문자·카톡 문의 초안 테스트용).
// /reply.pdf 는 업체가 카톡으로 보내 준 셈 치는 견적서 (페이지에는 링크를 두지 않아 에이전트가 직접 받지 않게)
const G = page(
  '도장공방 스티커 - 카톡 상담',
  `<h1>도장공방 스티커</h1>
  <p>모든 스티커는 디자인과 수량에 따라 가격이 달라서, <b>카카오톡 채널 상담</b>으로 견적서를 PDF로 보내 드립니다.</p>
  <h3>견적 상담</h3>
  <p>카카오톡 채널: <b>https://pf.kakao.com/_mockdojang</b><br>문자 상담: <b>010-0000-4107</b> (평일 9시~18시)</p>
  <footer>도장공방 · 대표 이도장 · 사업자등록번호 333-44-55555 · 대구 북구</footer>`
);
function gReply() {
  return makePdf([
    'QUOTATION  No. DJ-20261105-01',
    'Supplier: Dojang Gongbang  Biz No. 333-44-55555  Tel 010-0000-4107',
    'Item: Round waterproof sticker, 50mm, glossy',
    'Quantity: 3000 pcs',
    'Supply amount: ' + won(54000),
    'VAT (10%): ' + won(5400),
    'Total (VAT incl.): ' + won(59400),
    'Shipping: ' + won(3000) + ' (parcel)',
    'Production: 3 business days, delivery 1 day',
    'Warranty: reprint free within 7 days if defective',
    'Valid until: 2026-11-30'
  ]);
}

// H: 상품 페이지엔 가격이 없고 "견적서 출력"을 누르면 신청자명만 묻는 창이 뜬다. 이름을 넣고 "다음"을 누르면 인쇄용 견적서
const H_SUPPLY = { 1000: 24000, 3000: 58000, 5000: 88000 };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const H_QTY = `<label for="qty">수량</label>
  <select id="qty" name="qty"><option value="1000">1000매</option><option value="3000">3000매</option><option value="5000">5000매</option></select>
  <button type="button" id="est">견적서 출력</button>`;
const H_FOOT = `<footer>판촉스티커몰 · 대표 한상호 · 사업자등록번호 678-90-12345 · 대구 달서구 · 053-333-0404</footer>`;
const H_STYLE = `<style>.modal{position:fixed;inset:0;background:rgba(0,0,0,.4);display:none;align-items:center;justify-content:center}.modal.open{display:flex}.modal .box{background:#fff;padding:20px 24px;border-radius:8px;min-width:360px}</style>`;
/** 모달 안 견적서 출력 양식. fields = 신청자명 밖에 더 묻는 칸 (/contact) */
const hModal = (fields = '') => `<div class="modal" id="modal" role="dialog" aria-modal="true" aria-labelledby="mt"><div class="box">
  <h2 id="mt">견적서 출력</h2>
  <form method="post" action="/estimate">
    <input type="hidden" name="qty" id="fqty" value="">
    <table><tbody><tr><th>신청자명</th><td><input type="text" name="es_name" required></td></tr>${fields}</tbody></table>
    <p style="text-align:center"><input type="submit" value="다음"> <button type="button" onclick="document.getElementById('modal').classList.remove('open')">닫기</button></p>
  </form></div></div>`;
const H_OPEN_MODAL = `<script>document.getElementById('est').addEventListener('click', () => { document.getElementById('fqty').value = document.getElementById('qty').value; document.getElementById('modal').classList.add('open'); });</script>`;
const hProduct = (extra) =>
  page(
    '판촉스티커몰 - 원형 방수 스티커',
    `${H_STYLE}<h1>원형 방수 스티커 50mm (유광)</h1>
  <p>금액은 견적서로 안내합니다. 수량을 고른 뒤 <b>견적서 출력</b>을 눌러 주세요.</p>
  ${H_QTY}${extra}${H_FOOT}`
  );
const H = hProduct(hModal() + H_OPEN_MODAL);
const H_CONTACT = hProduct(
  hModal(`<tr><th>연락처</th><td><input type="text" name="es_hp" required></td></tr><tr><th>이메일</th><td><input type="text" name="es_email" required></td></tr>
    <tr><td colspan="2"><label><input type="checkbox" name="agree" required> 개인정보 수집·이용에 동의합니다</label></td></tr>`) + H_OPEN_MODAL
);
// 대구판촉물 같은 방식: 견적서 출력 → window.open으로 양식 창 → 다음 → 같은 창에 견적서
const H_POPUP = hProduct(`<script>document.getElementById('est').addEventListener('click', () => window.open('/estimateform?qty=' + document.getElementById('qty').value, 'win_itemestimate', 'width=600,height=580'));</script>`);
const hForm = (qty) =>
  page(
    '견적서 출력',
    `<form method="post" action="/estimate"><input type="hidden" name="qty" value="${esc(qty)}">
  <h2>견적서 출력</h2>
  <table><tbody><tr><th>신청자명</th><td><input type="text" name="es_name" required></td></tr></tbody></table>
  <p><input type="submit" value="다음"> <a href="javascript:window.close()">닫기</a></p></form>`
  );
function hQuote(qty, name) {
  const q = H_SUPPLY[qty] ? qty : 3000;
  const supply = H_SUPPLY[q];
  const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;
  const today = new Date().toISOString().slice(0, 10);
  return page(
    '견적서',
    `<h1 style="text-align:center;letter-spacing:8px">견 적 서</h1>
  <p>견적일: ${today} · 견적번호: PS-${today.replace(/-/g, '')}-${q}</p>
  <p><b>${esc(name)}</b> 귀하 · 아래와 같이 견적합니다.</p>
  <table><thead><tr><th>품목</th><th>규격</th><th>수량</th><th>단가</th><th>금액</th></tr></thead>
  <tbody><tr><td>원형 방수 스티커</td><td>지름 50mm · 유광 코팅</td><td>${q.toLocaleString('ko-KR')}매</td><td>${(supply / q).toFixed(1)}원</td><td>${won(supply)}</td></tr></tbody></table>
  <table style="margin-top:12px"><tbody>
    <tr><th>공급가액</th><td>${won(supply)}</td></tr><tr><th>부가세</th><td>${won(supply / 10)}</td></tr><tr><th>합계</th><td class="price">${won(supply * 1.1)}</td></tr>
    <tr><th>배송비</th><td>3,000원 (택배, 별도)</td></tr><tr><th>납기</th><td>시안 확정 후 5영업일 출고</td></tr>
    <tr><th>유효기간</th><td>견적일로부터 14일</td></tr><tr><th>결제 조건</th><td>계좌이체 (제작 전 입금)</td></tr>
  </tbody></table>
  <p>공급자: 판촉스티커몰 · 대표 한상호 · 사업자등록번호 678-90-12345 · 대구 달서구 · 053-333-0404</p>
  <p><button onclick="window.print()">인쇄</button></p>
  <script>window.addEventListener('load', () => window.print());</script>`
  );
}
const readForm = (req) =>
  new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body = (body + c).slice(0, 10000)));
    req.on('end', () => resolve(new URLSearchParams(body)));
  });

const send = (res, status, html, headers = {}) => {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(html);
};

http.createServer((req, res) => send(res, 200, A)).listen(4101);
http.createServer((req, res) => send(res, 200, B)).listen(4102);
http.createServer((req, res) => send(res, 200, D)).listen(4104);
http.createServer((req, res) => send(res, 200, E)).listen(4105);
http
  .createServer((req, res) => {
    if (req.url.startsWith('/quote.pdf')) {
      const qty = Number(new URL(req.url, 'http://x').searchParams.get('qty')) || 3000;
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="estimate-${qty}.pdf"`, 'cache-control': 'no-store' });
      return res.end(fQuote(qty));
    }
    send(res, 200, F);
  })
  .listen(4106);
http
  .createServer((req, res) => {
    if (req.url.startsWith('/reply.pdf')) {
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="dojang-quote.pdf"', 'cache-control': 'no-store' });
      return res.end(gReply());
    }
    send(res, 200, G);
  })
  .listen(4107);
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/estimate') {
      const form = req.method === 'POST' ? await readForm(req) : url.searchParams;
      const name = (form.get('es_name') || '').trim();
      if (!name) return send(res, 400, page('견적서 출력', '<p>신청자명을 입력해 주세요.</p>'));
      return send(res, 200, hQuote(Number(form.get('qty')) || 3000, name.slice(0, 40)));
    }
    if (url.pathname === '/estimateform') return send(res, 200, hForm(url.searchParams.get('qty') || '3000'));
    if (url.pathname === '/popup') return send(res, 200, H_POPUP);
    if (url.pathname === '/contact') return send(res, 200, H_CONTACT);
    send(res, 200, H);
  })
  .listen(4108);
http
  .createServer((req, res) => {
    // /always 는 확인해도 계속 막힌다 (건너뛰기 테스트용)
    if (req.url.startsWith('/always')) return send(res, 418, C_BLOCK.replace('/verify', '/always'));
    if (req.url.startsWith('/verify')) return send(res, 302, '', { location: '/', 'set-cookie': 'passed=1; Path=/' });
    if (!(req.headers.cookie || '').includes('passed=1')) return send(res, 418, C_BLOCK);
    send(res, 200, C);
  })
  .listen(4103);
console.log('[mock] A http://localhost:4101  B http://localhost:4102  C http://localhost:4103 (418 차단 → /verify)  C-항상차단 http://localhost:4103/always  D(숨은 배송 탭) http://localhost:4104  E(시트 단위 가격) http://localhost:4105  F(가견적서 PDF) http://localhost:4106  G(카톡·문자 상담만, 회신 PDF /reply.pdf) http://localhost:4107  H(견적서 출력 → 신청자명 양식, /popup·/contact) http://localhost:4108');
