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

// ─── 좁은 예외: 견적서 신청자명 양식 ─────────────────────────────
// "견적서 출력" 창이 신청자명(이름·회사명)만 묻고 "다음/확인"을 눌러야 견적서를 보여 주는 경우만 누른다.
// 연락처·이메일·주소·비밀번호·결제·약관 동의 등 다른 칸이 하나라도 있으면 거부한다 (위 SUBMIT_CHECK는 그대로).

/** 견적서를 내주는 화면·버튼 글자 */
export const QUOTE_ISSUE_RE = /견적서\s*(출력|인쇄|발행|다운로드?|받기|보기|저장)|가\s*견적서?/;

/** 페이지 안에서 (target, trigger) => 판정으로 실행되는 함수 소스 (String.raw라 \를 한 번만 쓴다).
 *  target이 document면 화면에서 양식을 찾고, 요소면 그 버튼이 양식의 다음·확인 버튼인지 본다.
 *  trigger: 이 창을 연 버튼 글자 (견적서 출력 등). 통과하면 이름 칸에 data-doldari-qname, 버튼에 data-doldari-qnext를 붙인다 */
export const QUOTE_FORM_CHECK = String.raw`(target, trigger) => {
  const S = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const doc = target && target.nodeType === 9 ? target : target.ownerDocument;
  const win = doc.defaultView || window;
  const ISSUE = ${QUOTE_ISSUE_RE};
  const NAME = /신청\s*자|신청인|성\s*함|이\s*름|담당자\s*명?|회사\s*명|업체\s*명|상\s*호|고객\s*명|기관\s*명|단체\s*명/;
  const NAME_KEY = /(^|[_\-\s])(name|nm|company|corp)(\d*$|[_\-\s])/i;
  const BAD = /연락처|전화|휴대|핸드폰|폰\s*번호|팩스|메일|주소|우편|비밀\s*번호|패스워드|결제|카드|계좌|은행|입금|주민|생년|생일|사업자|아이디|e-?mail|phone|mobile|\btel\b|\bfax\b|address|password|card|account|birth/i;
  const BAD_KEY = /(^|[_\-\s])(hp|tel|phone|mobile|cell|fax|e?mail|addr|address|zip|post|pw|pwd|pass|passwd|password|card|account|bank|birth|jumin|ssn|biz|userid|login)(\d*$|[_\-\s])/i;
  const BAD_TYPE = /^(email|tel|password|file|url|date|datetime-local|month|week|time)$/;
  const TERMS = /동의|약관|개인\s*정보|수집|마케팅|수신/;
  const NEXT = /^(다음(\s*단계)?|확인|출력(하기)?|발행(하기)?|인쇄(하기)?|견적서?\s*(보기|출력|발행|인쇄)(하기)?|가\s*견적서?\s*(보기|출력|발행|인쇄)?)$/;
  const FIELD = 'input, select, textarea';
  const BTN = 'button, input[type=submit], input[type=button], input[type=image], a, [role=button]';
  const DIALOG = '[role=dialog], dialog, [aria-modal=true], [class*=modal], [class*=layer], [class*=popup], [id*=modal], [id*=layer], [id*=popup]';
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = win.getComputedStyle(e); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const typeOf = (f) => (f.getAttribute('type') || '').toLowerCase();
  const editable = (f) => !(f.tagName === 'INPUT' && /^(hidden|submit|button|image|reset)$/.test(typeOf(f))) && !f.disabled && !f.readOnly && vis(f);
  // 칸 이름: label·aria-label·placeholder·표의 머리칸·이 칸 하나만 감싼 조상의 글자
  const labelOf = (f) => {
    const parts = [];
    if (f.labels) for (const l of f.labels) parts.push(l.innerText);
    for (const a of ['aria-label', 'placeholder', 'title', 'itemname']) parts.push(f.getAttribute(a));
    const by = f.getAttribute('aria-labelledby');
    if (by) for (const id of by.split(/\s+/)) { const e = doc.getElementById(id); if (e) parts.push(e.innerText); }
    const row = f.closest('tr');
    if (row) { const th = row.querySelector('th'); if (th) parts.push(th.innerText); else if (row.cells && row.cells[0] && !row.cells[0].contains(f)) parts.push(row.cells[0].innerText); }
    const dd = f.closest('dd');
    if (dd && dd.previousElementSibling && dd.previousElementSibling.tagName === 'DT') parts.push(dd.previousElementSibling.innerText);
    let p = f.parentElement;
    for (let i = 0; p && i < 3; i++, p = p.parentElement) {
      if (p.querySelectorAll(FIELD).length > 1) break;
      const t = S(p.innerText);
      if (t) { if (t.length <= 40) parts.push(t); break; }
    }
    return S(parts.filter(Boolean).join(' ')).slice(0, 120);
  };
  const btnText = (b) => S(b.innerText || b.value || b.getAttribute('aria-label') || b.getAttribute('title') || b.getAttribute('alt') || '').replace(/[<>›»→▶▷:]/g, '').trim();
  const isName = (f) => f.tagName === 'INPUT' && /^(|text)$/.test(typeOf(f)) && !BAD.test(labelOf(f)) && !BAD_KEY.test(f.name || '') && !/검색|search|keyword|query/i.test(labelOf(f) + ' ' + (f.name || '')) && (NAME.test(labelOf(f)) || NAME_KEY.test(f.name || ''));
  const nextIn = (box) => [...box.querySelectorAll(BTN)].find((b) => vis(b) && NEXT.test(btnText(b)));
  const clear = () => doc.querySelectorAll('[data-doldari-qname], [data-doldari-qnext]').forEach((e) => { e.removeAttribute('data-doldari-qname'); e.removeAttribute('data-doldari-qnext'); });
  // 이 양식으로 보내지는 칸 전부(같은 상자 + 같은 form)를 보고, 이름 칸만 있는지 판정한다
  const judge = (box, btn) => {
    const set = new Set(box.querySelectorAll(FIELD));
    for (const form of [btn.form, ...[...set].map((f) => f.form)]) if (form) for (const f of form.elements) if (f.matches && f.matches(FIELD)) set.add(f);
    const names = [], bad = [], other = [];
    for (const f of set) {
      if (!editable(f)) continue;
      const type = typeOf(f), label = labelOf(f), key = f.name || '';
      if (f.tagName === 'INPUT' && (type === 'checkbox' || type === 'radio')) {
        if (f.required || TERMS.test(label)) bad.push(label.slice(0, 20) || '약관 동의');
        continue;
      }
      if (BAD.test(label) || BAD_KEY.test(key) || BAD_TYPE.test(type)) bad.push(label.slice(0, 20) || key || type);
      else if (isName(f)) names.push(f);
      else other.push(label.slice(0, 20) || key || f.tagName.toLowerCase());
    }
    const dlg = box.closest(DIALOG);
    const heads = [doc.title, trigger, S(box.innerText).slice(0, 80), dlg ? S(dlg.innerText).slice(0, 80) : '', dlg ? dlg.getAttribute('aria-label') : ''];
    for (const h of box.querySelectorAll('h1, h2, h3, h4, legend, caption')) heads.push(S(h.innerText).slice(0, 60));
    const context = heads.find((h) => h && ISSUE.test(h)) || '';
    const out = { found: true, ok: false, reason: '', button: btnText(btn).slice(0, 20), fields: names.map((f) => labelOf(f).slice(0, 20)), context: S(context).slice(0, 40) };
    if (!context) out.reason = '견적서 출력 화면이 아닙니다';
    else if (bad.length) out.reason = '신청자명 말고도 ' + [...new Set(bad)].slice(0, 3).join(', ') + '을(를) 요구합니다';
    else if (other.length) out.reason = '신청자명이 아닌 입력칸(' + [...new Set(other)].slice(0, 3).join(', ') + ')이 있습니다';
    else if (!names.length || names.length > 3) out.reason = '신청자명 입력칸을 찾지 못했습니다';
    else {
      out.ok = true;
      for (const f of names) f.setAttribute('data-doldari-qname', '1');
      btn.setAttribute('data-doldari-qnext', '1');
    }
    return out;
  };
  clear();
  if (target.nodeType === 9) {
    let best = null;
    const seen = new Set();
    for (const f of doc.querySelectorAll('input')) {
      if (!editable(f) || !isName(f)) continue;
      let box = f.parentElement, btn = null;
      while (box && !(btn = nextIn(box))) box = box.parentElement;
      // 칸이 많은 큰 영역(상품 페이지 전체 등)까지 올라갔으면 작은 견적서 양식이 아니다
      if (!box || !btn || seen.has(box) || [...box.querySelectorAll(FIELD)].filter(editable).length > 8) continue;
      seen.add(box);
      const r = judge(box, btn);
      if (r.ok) return r;
      if (!best || (r.context && !best.context)) best = r;
    }
    return best || { found: false, ok: false, reason: '신청자명 양식이 없습니다', button: '', fields: [], context: '' };
  }
  const b = (target.closest && target.closest(BTN)) || target;
  if (!vis(b) || !NEXT.test(btnText(b))) return { found: false, ok: false, reason: '견적서 양식의 다음·확인 버튼이 아닙니다', button: btnText(b).slice(0, 20), fields: [], context: '' };
  let box = b.parentElement;
  while (box && ![...box.querySelectorAll('input')].some((f) => editable(f) && isName(f))) box = box.parentElement;
  if (!box) return { found: false, ok: false, reason: '신청자명 입력칸이 없습니다', button: btnText(b).slice(0, 20), fields: [], context: '' };
  return judge(box, b);
}`;

export interface QuoteFormCheck {
  found: boolean;
  ok: boolean;
  reason: string;
  button: string;
  fields: string[];
  context: string;
}

/** 화면 글자가 견적서처럼 보이는지: "견적"과 금액(12,000원·₩·KRW), 또는 수량·단가/금액 표.
 *  견적서 출력 양식·빈 화면을 견적서 원본으로 남기지 않으려고 쓴다 */
export function looksLikeQuote(text: string): boolean {
  const t = String(text || '');
  if (!/견\s*적/.test(t)) return false;
  const money = /[1-9][\d,]*\s*원|₩\s*[1-9]|[1-9][\d,]*\s*KRW|KRW\s*[1-9]/i.test(t);
  const table = /수\s*량/.test(t) && /단\s*가|금\s*액/.test(t) && /\d{1,3}(,\d{3})+|\d{4,}/.test(t);
  return money || table;
}
