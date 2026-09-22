/**
 * 入試日。③「時期の重要性」で「入試まであと◯日」を出すために持つ。
 * ------------------------------------------------------------------
 * 出どころ: 東京都教育委員会「令和9年度東京都立高等学校入学者選抜実施要綱」
 *           （vault: NEST/ナレッジ/高校入試情報_都立は1020点の総合得点1本で決まる.md）
 *
 * ★都立の第一次募集・分割前期の学力検査日だけを持つ。
 *   推薦・二次・私立は生徒ごとに受けるかどうかが違い、1つの数字にできない。
 *   面談で「入試まであと何日」と言うときの基準は、全員が見ている一次の日付でよい。
 *
 * ★年度ごとに手で足す。毎年9月に都教委が実施要綱を出すので、そのとき更新する。
 *   将来の年度が無いときは null を返し、日数を出さない（当て推量の日付を出さない）。
 *
 * ★東京都のみ。緑園都市校が抱える神奈川県立は制度も日程も別物なので、
 *   ここに混ぜない（同じナレッジの冒頭に明記がある）。
 */

/** 都立高校 第一次募集・分割前期の学力検査日（年度キーは「令和N年度入試」の西暦年） */
const TOKYO_GENERAL_EXAM_DATES: Record<number, string> = {
  // 令和9年度入試。推薦 1/26・27（発表 2/2）／一次 2/21（発表 3/1）／二次 3/9
  2027: '2027-02-21',
};

/**
 * その生徒にとって次に来る都立一次の日付を返す。無ければ null。
 *
 * ★「次の入試」は、いま中3なら今年度、中1・中2なら卒業年度の入試。
 *   ただし学年から卒業年を割り出すのは年度替わりの境目で外すので、
 *   **受験学年（中3）のときだけ**日付を出す。中1・中2に「入試まで900日」と言っても
 *   面談では使わない。
 */
export function nextTokyoExamDate(today: Date, grade: number | null): string | null {
  if (grade !== 9) return null;

  // 学年度は4月始まり。1〜3月は前年の4月に始まった年度なので、入試はその年の2月
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const examYear = month >= 4 ? year + 1 : year;

  return TOKYO_GENERAL_EXAM_DATES[examYear] ?? null;
}

/** 入試まであと何日か。過ぎていたら 0 以下を返す */
export function daysUntil(today: Date, isoDate: string): number {
  const target = new Date(`${isoDate}T00:00:00`);
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - base.getTime()) / 86400000);
}

/**
 * ③に出す「入試まで」の1行。日付が分からなければ null（行そのものを出さない）。
 */
export function examCountdownLine(today: Date, grade: number | null): string | null {
  const date = nextTokyoExamDate(today, grade);
  if (!date) return null;
  const days = daysUntil(today, date);
  if (days < 0) return null;
  const [, m, d] = date.split('-');
  return `都立一次（${Number(m)}/${Number(d)}）まで あと${days}日`;
}
