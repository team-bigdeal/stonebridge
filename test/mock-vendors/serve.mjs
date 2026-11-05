// 테스트용 목업 업체 (실제 사이트 아님)
//  A :4101 가격 공개 + 수량 옵션에 따라 금액 계산
//  B :4102 가격 비공개, 메일 문의만
//  D :4104 가격은 보이지만 배송비·제작 기간은 닫힌 "배송/교환" 탭 안에만 있음 (숨은 정보 탐색 테스트용)
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

const send = (res, status, html, headers = {}) => {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(html);
};

http.createServer((req, res) => send(res, 200, A)).listen(4101);
http.createServer((req, res) => send(res, 200, B)).listen(4102);
http.createServer((req, res) => send(res, 200, D)).listen(4104);
http
  .createServer((req, res) => {
    // /always 는 확인해도 계속 막힌다 (건너뛰기 테스트용)
    if (req.url.startsWith('/always')) return send(res, 418, C_BLOCK.replace('/verify', '/always'));
    if (req.url.startsWith('/verify')) return send(res, 302, '', { location: '/', 'set-cookie': 'passed=1; Path=/' });
    if (!(req.headers.cookie || '').includes('passed=1')) return send(res, 418, C_BLOCK);
    send(res, 200, C);
  })
  .listen(4103);
console.log('[mock] A http://localhost:4101  B http://localhost:4102  C http://localhost:4103 (418 차단 → /verify)  C-항상차단 http://localhost:4103/always  D(숨은 배송 탭) http://localhost:4104');
