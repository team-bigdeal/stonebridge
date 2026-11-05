// 한국어 표기를 숫자로 바꾸는 후처리 함수 (SPEC §6.4: 프롬프트 규칙 + 후처리 이중 처리)

const KOREAN_DIGITS: Record<string, number> = {
  한: 1, 하나: 1, 일: 1, 두: 2, 둘: 2, 이: 2, 세: 3, 셋: 3, 삼: 3, 네: 4, 넷: 4, 사: 4,
  다섯: 5, 오: 5, 여섯: 6, 육: 6, 일곱: 7, 칠: 7, 여덟: 8, 팔: 8, 아홉: 9, 구: 9, 열: 10, 십: 10
};

const UNIT: Record<string, number> = { 억: 1e8, 만: 1e4, 천: 1e3, 백: 100 };

/** "1만 5,000" → 15000, "2억 5천만" → 250000000, "3천5백" → 3500. 숫자가 없으면 null */
function unitNumber(raw: string): number | null {
  const text = raw.normalize('NFKC').replace(/[\s,]/g, '');
  for (const run of text.matchAll(/(?:\d+(?:\.\d+)?[억만천백]?|[억만천백])+/g)) {
    if (!/\d/.test(run[0])) continue;
    let total = 0;
    let low = 0; // 만 아래에 쌓이는 값
    for (const p of run[0].matchAll(/(\d+(?:\.\d+)?)([억만천백])?|([억만천백])/g)) {
      const n = p[1] === undefined ? undefined : Number(p[1]);
      const u = p[2] ?? p[3];
      if (!u) low += n ?? 0;
      else if (u === '억' || u === '만') {
        total += (n === undefined && low === 0 ? 1 : low + (n ?? 0)) * UNIT[u];
        low = 0;
      } else low += (n ?? 1) * UNIT[u];
    }
    total += low;
    const i = run.index ?? 0;
    const neg = text[i - 1] === '-' && !/\d/.test(text[i - 2] ?? '');
    return neg ? -total : total;
  }
  return null;
}

function firstNumber(text: string): number | null {
  const n = unitNumber(text);
  if (n !== null) return n;
  const words = { ...KOREAN_DIGITS, 천: 1000, 백: 100, 만: 10000 };
  for (const [word, v] of Object.entries(words).sort((a, b) => b[0].length - a[0].length)) {
    if (new RegExp(`(^|\\s)${word}\\s*(개|주|년|달|일|대|장|매|부)`).test(text)) return v;
  }
  return null;
}

/** "50만 원" → 500000, "390,000원" → 390000, "1.5만" → 15000, "무료"/"포함" → 0, "2,500원(5만원 이상 무료)" → 2500 */
export function parseKrw(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input) : null;
  // "3만원 이상" 같은 조건 금액은 값이 아니다
  const text = input.normalize('NFKC').replace(/\s/g, '').replace(/[\d.,억만천백]+원?(이상|초과|이내|미만)/g, '');
  const n = unitNumber(text);
  if (n !== null) return Math.round(n);
  // 금액이 없을 때만 무료·포함은 0 ("미포함"은 제외)
  return /무료|(?<!미)포함|없음/.test(text) ? 0 : null;
}

/** "3주" → 21, "10일" → 10, "한 달" → 30, "2주 6일" → 20 */
export function parseDays(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Math.round(input);
  const text = input.normalize('NFKC').replace(/\s/g, '');
  let total = 0;
  let matched = false;
  const week = text.match(/([\d.]+|한|두|세|네|일)주/);
  if (week) {
    total += (Number(week[1]) || KOREAN_DIGITS[week[1]] || 0) * 7;
    matched = true;
  }
  const month = text.match(/([\d.]+|한|두|세)(개월|달)/);
  if (month) {
    total += (Number(month[1]) || KOREAN_DIGITS[month[1]] || 0) * 30;
    matched = true;
  }
  const day = text.match(/(\d+)일/);
  if (day) {
    total += Number(day[1]);
    matched = true;
  }
  const year = text.match(/(\d+|한|두)년/);
  if (year) {
    total += (Number(year[1]) || KOREAN_DIGITS[year[1]] || 0) * 365;
    matched = true;
  }
  if (matched) return Math.round(total);
  // 숫자 없는 표현
  const WORDS: [RegExp, number][] = [[/즉시|당일/, 0], [/익일|하루/, 1], [/이틀/, 2], [/사흘/, 3], [/나흘/, 4], [/열흘/, 10]];
  for (const [re, d] of WORDS) if (re.test(text)) return d;
  return firstNumber(text);
}

/** "2년" → 24, "1년 6개월" → 18, "6개월" → 6 */
export function parseMonths(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Math.round(input);
  const text = input.replace(/\s/g, '');
  let total = 0;
  let matched = false;
  const year = text.match(/([\d.]+|한|두|세)년/);
  if (year) {
    total += (Number(year[1]) || KOREAN_DIGITS[year[1]] || 0) * 12;
    matched = true;
  }
  const month = text.match(/(\d+)개월/);
  if (month) {
    total += Number(month[1]);
    matched = true;
  }
  if (/없/.test(text) && !matched) return 0;
  if (matched) return Math.round(total);
  return firstNumber(text);
}

export function parseBool(input: string): boolean | null {
  if (/(필요\s*없|안\s*해|아니|없어|괜찮(아|습|다|네|지)|직접|(^|[\s,.!])노+($|[\s,.!]))/.test(input)) return false;
  if (/(네|예|응|필요|해\s*주|부탁|yes|ㅇㅇ|당연)/i.test(input)) return true;
  return null;
}

export function parseQuantity(input: string): number | null {
  const n = firstNumber(input);
  return n === null ? null : Math.max(1, Math.round(n));
}

/** 이 컴퓨터 시간(한국 시간) 기준 YYYY-MM-DD. toISOString은 UTC라 자정~오전 9시에 하루 전 날짜가 된다 */
export function localIsoDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDaysIso(days: number, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return localIsoDate(d);
}
