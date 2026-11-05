// 업체 연락처(전화번호·메일 주소) 가리기. 화면 표시·로그·히스토리 저장에 쓴다 (보내기·복사는 원래 값으로)

const PHONE = /(?<!\d)(?:\+82[-.\s]?0?|0)(\d{1,2})[-.\s]?(\d{3,4})[-.\s]?(\d{4})(?!\d)/g;
const EMAIL = /([\w.+-]+)@([\w-]+(?:\.[\w-]+)+)/g;

/** 01012345678 / 010-1234-5678 → 010-12**-**78 */
export function maskPhone(phone: string) {
  const d = phone.replace(/\D/g, '').replace(/^82/, '0');
  const m = d.match(/^(02|0\d{2})(\d{3,4})(\d{4})$/);
  if (!m) return '***';
  return `${m[1]}-${m[2].slice(0, 2)}${'*'.repeat(m[2].length - 2)}-**${m[3].slice(2)}`;
}

/** quote@shop.co.kr → qu***@shop.co.kr */
export const maskEmail = (email: string) => email.replace(/^([^@]{0,2})[^@]*@/, '$1***@');

/** 글 안의 전화번호·메일 주소를 모두 가린다 */
export const maskText = (text: string) =>
  text.replace(EMAIL, (m) => maskEmail(m)).replace(PHONE, (_m, a: string, b: string, c: string) => maskPhone(`0${a}${b}${c}`));

/** 저장 직전 객체 전체에서 글 값의 연락처를 가린다. id·주소·파일 데이터처럼 바꾸면 안 되는 값은 그대로 둔다 */
const KEEP = new Set(['id', 'messageId', 'recordId', 'url', 'ref', 'image', 'fileData', 'chatUrl']);
export function scrubContacts<T>(value: T, key = ''): T {
  if (typeof value === 'string') return (KEEP.has(key) || value.startsWith('data:') ? value : maskText(value)) as T;
  if (Array.isArray(value)) return value.map((v) => scrubContacts(v)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubContacts(v, k)])) as T;
  }
  return value;
}
