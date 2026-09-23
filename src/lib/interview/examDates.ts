/**
 * 入試日。③「時期の重要性」で「入試まであと◯日」を出すために持つ。
 * ------------------------------------------------------------------
 * 出どころ:
 *   東京都 ― 東京都教育委員会「令和9年度東京都立高等学校入学者選抜実施要綱」
 *            （vault: NEST/ナレッジ/高校入試情報_都立は1020点の総合得点1本で決まる.md）
 *   神奈川県 ― 神奈川県教育委員会「募集案内 1 日程」
 *              （vault: NEST/ナレッジ/高校入試情報_神奈川の公立は中2の内申が効き合計点では言えない.md）
 *
 * ★都県ごとに「全員が見ている本番1つ」だけを持つ。東京は都立の第一次募集・分割前期、
 *   神奈川は共通選抜の学力検査。推薦・二次・私立は生徒ごとに受けるかどうかが違い、
 *   1つの数字にできない。
 *
 * ★東京と神奈川は制度も日程も呼び名も別物。日付を都県で出し分けるだけでなく、
 *   画面に出す名前も EXAM_NAME で分ける。神奈川の教室に「都立一次」と出せば、
 *   それだけで面談が事故る。
 *
 * ★年度ごとに手で足す。東京は毎年9月に都教委が実施要綱を、神奈川は県教委が募集案内を
 *   出すので、そのとき更新する。将来の年度が無いときは null を返し、日数を出さない
 *   （当て推量の日付を出さない）。
 */
import type { Region } from '@/lib/interview/region';

/**
 * 都県ごとの学力検査日（年度キーは「令和N年度入試」の西暦年）
 *
 * ★東京の 2027-02-21 は日曜だが、これで正しい。直さないこと。
 *   都立の一次が日曜なのは珍しく、「前年度の日付を引き写した誤りでは」と一度疑われたが、
 *   都教委の一次情報2つで「2月21日（日曜日）」と明記されているのを確かめた（2026-09-23）。
 *     - 「令和9年度都立高等学校入学者選抜の日程について」（2026-05-28 報道発表）
 *     - 「令和9年度東京都立高等学校入学者選抜実施要綱・同細目について」（2026-09-17 報道発表）
 *   日曜になった理由は発表に書かれていない。曜日を画面に出しても差し支えない。
 */
const EXAM_DATES: Record<Region, Record<number, string>> = {
  // 令和9年度入試。推薦 1/26(火)・27(水)（発表 2/2(火)）／一次 2/21(日)（発表 3/1(月)）／
  // 二次・分割後期 3/9(火)（発表 3/12(金)）
  tokyo: {
    2027: '2027-02-21',
  },
  // 令和9年度入試。共通選抜のみ（推薦は無い）。学力検査 2/16(火)（発表 2/26(金)）／
  // 二次募集 検査 3/9(火)。出どころは県教委「募集案内 1 日程」PDF（一次情報で確認済み）
  kanagawa: {
    2027: '2027-02-16',
  },
};

/**
 * 画面に出す入試の呼び名。★都県で変える。
 *
 * 神奈川に「都立一次」と出るのが一番まずい事故なので、日付と同じ場所で名前も持つ
 * （日付を足すときに名前を足し忘れられないように、Record<Region, …> で型に守らせる）。
 */
export const EXAM_NAME: Record<Region, string> = {
  tokyo: '都立一次',
  kanagawa: '共通選抜',
};

/**
 * その教室にとって次に来る入試日を返す。無ければ null。学年は見ない。
 *
 * 生徒ごとではなく「教室として次に来る入試」を出したいときに使う。
 * 面談台本のように受験学年に限りたいときは nextExamDate を使うこと。
 */
export function nextExamDateForRegion(today: Date, region: Region | null): string | null {
  if (!region) return null;

  // 学年度は4月始まり。1〜3月は前年の4月に始まった年度なので、入試はその年の2月
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const examYear = month >= 4 ? year + 1 : year;

  return EXAM_DATES[region][examYear] ?? null;
}

/**
 * その生徒にとって次に来る入試の日付を返す。無ければ null。
 *
 * ★「次の入試」は、いま中3なら今年度、中1・中2なら卒業年度の入試。
 *   ただし学年から卒業年を割り出すのは年度替わりの境目で外すので、
 *   **受験学年（中3）のときだけ**日付を出す。中1・中2に「入試まで900日」と言っても
 *   面談では使わない。
 */
export function nextExamDate(
  today: Date,
  grade: number | null,
  region: Region | null
): string | null {
  if (grade !== 9) return null;
  return nextExamDateForRegion(today, region);
}

/** 入試まであと何日か。過ぎていたら 0 以下を返す */
export function daysUntil(today: Date, isoDate: string): number {
  const target = new Date(`${isoDate}T00:00:00`);
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - base.getTime()) / 86400000);
}

/**
 * ③に出す「入試まで」の1行。日付が分からなければ null（行そのものを出さない）。
 * ★呼び名は都県で変わる（東京「都立一次」／神奈川「共通選抜」）。
 */
export function examCountdownLine(
  today: Date,
  grade: number | null,
  region: Region | null
): string | null {
  const date = nextExamDate(today, grade, region);
  if (!date || !region) return null;
  const days = daysUntil(today, date);
  if (days < 0) return null;
  const [, m, d] = date.split('-');
  return `${EXAM_NAME[region]}（${Number(m)}/${Number(d)}）まで あと${days}日`;
}
