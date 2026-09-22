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
 *   神奈川の教室には日付を出さない（region を渡すと null が返る）。共通選抜の日程を
 *   確かな出どころで持つまで、都立の日付を代わりに見せることはしない。
 */
import type { Region } from '@/lib/interview/region';

/** 都立高校 第一次募集・分割前期の日程（年度キーは「令和N年度入試」の西暦年） */
interface TokyoExamSchedule {
  /** 学力検査日 */
  exam: string;
  /** 出願の〆切 */
  applicationDue: string;
  /** 志望変更（出願の取り下げ）ができる最終日 */
  withdrawalDue: string;
}

/**
 * ★出願・取り下げの日付もここに置く。
 *   面談では「2/4までに出願」「2/10が取り下げ日」と口で言う場面があるが、
 *   これを定型トークの文字列に書くと**年が変わっても誰も気づかないまま残る**。
 *   年度ごとに手で足すこのファイルに集めておき、年度が無ければ黙る。
 */
const TOKYO_EXAM_SCHEDULE: Record<number, TokyoExamSchedule> = {
  // 令和9年度入試。推薦 1/26・27（発表 2/2）／一次 2/21（発表 3/1）／二次 3/9
  2027: { exam: '2027-02-21', applicationDue: '2027-02-04', withdrawalDue: '2027-02-10' },
};

/**
 * その生徒にとって次に来る都立一次の日付を返す。無ければ null。
 *
 * ★「次の入試」は、いま中3なら今年度、中1・中2なら卒業年度の入試。
 *   ただし学年から卒業年を割り出すのは年度替わりの境目で外すので、
 *   **受験学年（中3）のときだけ**日付を出す。中1・中2に「入試まで900日」と言っても
 *   面談では使わない。
 */
export function nextTokyoExamDate(
  today: Date,
  grade: number | null,
  region: Region | null
): string | null {
  if (grade !== 9 || region !== 'tokyo') return null;

  // 学年度は4月始まり。1〜3月は前年の4月に始まった年度なので、入試はその年の2月
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const examYear = month >= 4 ? year + 1 : year;

  return TOKYO_EXAM_SCHEDULE[examYear]?.exam ?? null;
}

/** その生徒にとって次に来る都立一次の日程一式。無ければ null */
function nextTokyoExamSchedule(
  today: Date,
  grade: number | null,
  region: Region | null
): TokyoExamSchedule | null {
  if (grade !== 9 || region !== 'tokyo') return null;
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const examYear = month >= 4 ? year + 1 : year;
  return TOKYO_EXAM_SCHEDULE[examYear] ?? null;
}

/** 「2/4」の形にする */
function formatMonthDay(isoDate: string): string {
  const [, m, d] = isoDate.split('-');
  return `${Number(m)}/${Number(d)}`;
}

/**
 * ③に出す出願まわりの1行。日程が分からなければ null（行そのものを出さない）。
 * ★過ぎた日付は出さない。面談は11月から2月まで続くので、終わった〆切を読み上げないため。
 */
export function examApplicationLine(
  today: Date,
  grade: number | null,
  region: Region | null
): string | null {
  const schedule = nextTokyoExamSchedule(today, grade, region);
  if (!schedule) return null;
  const parts: string[] = [];
  if (daysUntil(today, schedule.applicationDue) >= 0) {
    parts.push(`出願は ${formatMonthDay(schedule.applicationDue)} まで`);
  }
  if (daysUntil(today, schedule.withdrawalDue) >= 0) {
    parts.push(`志望変更の取り下げは ${formatMonthDay(schedule.withdrawalDue)}`);
  }
  return parts.length > 0 ? `★都立 ―― ${parts.join('／')}` : null;
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
export function examCountdownLine(
  today: Date,
  grade: number | null,
  region: Region | null
): string | null {
  const date = nextTokyoExamDate(today, grade, region);
  if (!date) return null;
  const days = daysUntil(today, date);
  if (days < 0) return null;
  return `都立一次（${formatMonthDay(date)}）まで あと${days}日`;
}
