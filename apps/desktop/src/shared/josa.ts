// 한국어 조사: 앞말의 받침에 맞춰 은/는·이/가·을/를·으로/로·과/와를 고른다 (main과 renderer가 같이 씀)

type Pair = '은/는' | '이/가' | '을/를' | '으로/로' | '과/와';

/** 숫자를 읽었을 때의 받침 (0 영, 1 일, 3 삼, 6 육, 7 칠, 8 팔은 받침 있음. 1·7·8은 ㄹ) */
const DIGIT_JONG: Record<string, number> = { '0': 21, '1': 8, '2': 0, '3': 16, '4': 0, '5': 0, '6': 1, '7': 8, '8': 8, '9': 0 };

/** 마지막 글자의 받침 번호 (0이면 받침 없음, 8이면 ㄹ). 한글·숫자가 아니면 null */
function jongOf(word: string): number | null {
  const last = word.trim().replace(/[)\]"'”’」』]+$/, '').slice(-1);
  if (!last) return null;
  const c = last.charCodeAt(0);
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28;
  return DIGIT_JONG[last] ?? null;
}

/** josa('스티커몰', '은/는') → "스티커몰은", josa('75,000원', '으로/로') → "75,000원으로". 받침을 모르면 "은(는)" */
export function josa(word: string, pair: Pair): string {
  const [withJong, without] = pair.split('/');
  const jong = jongOf(word);
  if (jong === null) return `${word}${withJong}(${without})`;
  // ㄹ 받침 뒤에는 "으로"가 아니라 "로"
  if (pair === '으로/로') return word + (jong === 0 || jong === 8 ? without : withJong);
  return word + (jong ? withJong : without);
}
