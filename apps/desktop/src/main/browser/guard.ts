// 제출·결제 버튼 판별. 내장 브라우저(CDP) 클릭·옵션 선택·펼치기가 같은 규칙을 쓴다.
// 페이지 안에서 (el) => ({ text, isSubmit })로 실행되는 함수 소스 (템플릿 문자열이라 정규식의 \는 \\로 쓴다)

export const SUBMIT_CHECK = `(el) => {
  const has = (e, n) => !!(e && e.hasAttribute && e.hasAttribute(n));
  const attr = (e, n) => ((e && e.getAttribute && e.getAttribute(n)) || '') + '';
  const label = (e) => ((e && (e.innerText || e.value || attr(e, 'aria-label') || attr(e, 'title') || attr(e, 'alt'))) || '').toString().replace(/\\s+/g, ' ').trim();
  // 안쪽 글자·아이콘을 가리켜도 실제로 눌리는 요소(링크·버튼)로 판단한다
  const t = (el && el.closest && el.closest('a,button,input,[role=button],[role=link],[onclick]')) || el;
  const tag = (t && t.tagName) || '';
  const type = attr(t, 'type').toLowerCase();
  const role = attr(t, 'role').toLowerCase();
  const own = label(t);
  // 카드 전체처럼 큰 영역이 눌리는 요소면 가리킨 요소의 글자로 본다
  const text = (own.length <= 60 ? own : label(el) || own).slice(0, 80);
  // 정보·옵션 문구(주문제작·구매안내·결제방법·주문수량·요청사항 등)는 제출로 보지 않는다
  const info = '(?!\\\\s*(제작|안내|방법|가이드|정보|조회|내역|후기|수량|옵션|번호|가능|기간|마감|사항|문의|일))';
  const flow = new RegExp('제출|보내기|전송|문의\\\\s*하기|담기|장바구니|(신청|접수|등록|예약|요청|주문|구매|결제)' + info + '|(네이버|카카오|토스|N)\\\\s*페이|\\\\b(submit|send|checkout|check\\\\s*out|buy|purchase|orders?|pay|payment|paypal|cart|basket)\\\\b|add\\\\s*to\\\\s*(cart|bag|basket)', 'i');
  // 진짜 주소로 가는 링크는 이동일 뿐이라(문의 페이지 열기 등) 구매·결제 흐름만 막는다
  const buy = new RegExp('담기|장바구니|바로\\\\s*(주문|구매)|주문\\\\s*하기|(구매|결제)' + info + '|(네이버|카카오|토스|N)\\\\s*페이|\\\\b(checkout|check\\\\s*out|buy|purchase|pay|payment|paypal|cart|basket)\\\\b|add\\\\s*to\\\\s*(cart|bag|basket)', 'i');
  const href = attr(t, 'href').trim();
  const realLink = tag === 'A' && role !== 'button' && !!href && !/^(#|javascript:)/i.test(href);
  const denied = (realLink ? buy : flow).test(text);
  // 폼을 실제로 보내는 컨트롤: 계산·조회 문구여도 누르지 않는다
  const btnSubmits = tag === 'BUTTON' && ((t.type || '') + '').toLowerCase() === 'submit';
  const explicit = (tag === 'INPUT' && (type === 'submit' || type === 'image')) || (btnSubmits && (type === 'submit' || has(t, 'form'))) || has(t, 'formaction');
  // type을 안 적은 폼 안 버튼, 스크립트로 폼 제출·주문·결제를 부르는 요소: 계산·견적서 받기 문구면 허용
  const implicit = btnSubmits && type !== 'submit' && !!t.form;
  const code = attr(t, 'onclick') + ' ' + (/^javascript:/i.test(href) ? href : '');
  const scripted = /\\.submit\\s*\\(|\\bsubmit\\w*\\s*\\(|\\b(fn_?|go_?|do_?|add_?)?(order|buy|cart|pay|purchase|checkout)\\w*\\s*\\(/i.test(code);
  const calc = /계산|견적\\s*보기|견적\\s*확인|가격\\s*(확인|조회)|금액\\s*(확인|조회)|조회|적용|견적서\\s*(출력|다운|발행|인쇄|받기|보기|저장)|가견적|PDF|인쇄/i.test(text);
  // 드롭다운을 여는 버튼은 폼 안에 있어도 제출로 보지 않는다
  const popup = has(t, 'aria-haspopup') || has(t, 'aria-expanded') || role === 'combobox';
  const isSubmit = denied || explicit || (!calc && !popup && (implicit || scripted));
  return { text: text.slice(0, 40), isSubmit };
}`;
