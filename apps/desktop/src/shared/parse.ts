// 한국어 표기를 숫자로 바꾸는 후처리 함수 (SPEC §6.4: 프롬프트 규칙 + 후처리 이중 처리)

const KOREAN_DIGITS: Record<string, number> = {
  한: 1, 하나: 1, 일: 1, 두: 2, 둘: 2, 이: 2, 세: 3, 셋: 3, 삼: 3, 네: 4, 넷: 4, 사: 4,
  다섯: 5, 오: 5, 여섯: 6, 육: 6, 일곱: 7, 칠: 7, 여덟: 8, 팔: 8, 아홉: 9, 구: 9, 열: 10, 십: 10
};

function firstNumber(text: string): number | null {
  const m = text.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (m) return Number(m[0]);
  for (const [word, n] of Object.entries(KOREAN_DIGITS).sort((a, b) => b[0].length - a[0].length)) {
    if (new RegExp(`(^|\\s)${word}\\s*(개|주|년|달|일|대)`).test(text)) return n;
  }
  return null;
}

/** "50만 원" → 500000, "390,000원" → 390000, "1.5만" → 15000, "무료"/"포함" → 0 */
export function parseKrw(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Math.round(input);
  const text = input.replace(/\s/g, '');
  if (/무료|포함|없음|0원/.test(text) && !/\d{2,}/.test(text.replace(/0원/, ''))) return 0;
  const man = text.match(/([\d.,]+)만(?:([\d,]+)천)?/);
  if (man) {
    const base = Number(man[1].replace(/,/g, '')) * 10000;
    const thousand = man[2] ? Number(man[2].replace(/,/g, '')) * 1000 : 0;
    return Math.round(base + thousand);
  }
  const chun = text.match(/([\d.]+)천/);
  if (chun) return Math.round(Number(chun[1]) * 1000);
  const n = firstNumber(text);
  return n === null ? null : Math.round(n);
}

/** "3주" → 21, "10일" → 10, "한 달" → 30, "2주 6일" → 20 */
export function parseDays(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Math.round(input);
  const text = input.replace(/\s/g, '');
  let total = 0;
  let matched = false;
  const week = text.match(/([\d.]+|한|두|세|네)주/);
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
  if (matched) return Math.round(total);
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
  if (/(필요\s*없|안\s*해|아니|없어|괜찮|직접|노)/.test(input)) return false;
  if (/(네|예|응|필요|해\s*주|부탁|yes|ㅇㅇ|당연)/i.test(input)) return true;
  return null;
}

export function parseQuantity(input: string): number | null {
  const n = firstNumber(input);
  return n === null ? null : Math.max(1, Math.round(n));
}

export function addDaysIso(days: number, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
