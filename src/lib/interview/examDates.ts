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
 *
 * ★2027-02-21 は日曜だが、これで正しい（2026-09-23 に確認）。
 *   都教委「令和９年度東京都立高等学校入学者選抜実施要綱」第２－１（2026-09-17 公表）に
 *   「学力検査及び面談 令和９年２月２１日（日）」とある。日程発表（2026-05-28）にも
 *   「2月21日（日）」と明記。例年と曜日が違うので疑いたくなるが、直さないこと。
 *   同じ表の 出願〆切 ２月４日（木）・取下げ ２月１０日（水）とも一致した
 *   （再提出は ２月１２日（金）正午まで）。
 */
const TOKYO_EXAM_SCHEDULE: Record<number, TokyoExamSchedule> = {
  // 令和9年度入試。推薦 1/26(火)・27(水)（発表 2/2(火)）／一次 2/21(日)（発表 3/1(月)）／
  // 二次・分割後期 3/9(火)（発表 3/12(金)）
  2027: { exam: '2027-02-21', applicationDue: '2027-02-04', withdrawalDue: '2027-02-10' },
};

/**
 * 神奈川県公立高校 共通選抜の学力検査日（年度キーは「令和N年度入試」の西暦年）
 *
 * ★出願・志願変更の日付はまだ持たない（examApplicationLine は東京のみ）。
 *   神奈川は出願期間・志願変更期間が「◯日〜◯日正午」の幅で、都立の「〆切1日」とは
 *   言い方が違う。足すときは都立の行を流用せず、神奈川用の文言を別に作ること。
 */
const KANAGAWA_EXAM_DATES: Record<number, string> = {
  // 令和9年度入試。共通選抜のみ（推薦は無い）。学力検査 2/16(火)（発表 2/26(金)）／
  // 二次募集 検査 3/9(火)。出どころは県教委「募集案内 1 日程」PDF（一次情報で確認済み）
  2027: '2027-02-16',
};

/**
 * 都県 → その年度の学力検査日。
 * ★Record<Region, …> にしてあるので、都県を足したときに日付の引き方を書き忘れると型で落ちる。
 */
const EXAM_DATE_OF: Record<Region, (examYear: number) => string | null> = {
  tokyo: (y) => TOKYO_EXAM_SCHEDULE[y]?.exam ?? null,
  kanagawa: (y) => KANAGAWA_EXAM_DATES[y] ?? null,
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

/** 今日から見て次に来る入試の年度キー。学年度は4月始まりで、1〜3月はその年の2月の入試 */
function examYearOf(today: Date): number {
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  return month >= 4 ? year + 1 : year;
}

/**
 * その教室にとって次に来る入試日を返す。無ければ null。学年は見ない。
 *
 * 生徒ごとではなく「教室として次に来る入試」を出したいとき（プライバシースクリーンの
 * カウントダウン等）に使う。面談台本のように受験学年に限りたいときは nextExamDate を使うこと。
 */
export function nextExamDateForRegion(today: Date, region: Region | null): string | null {
  if (!region) return null;
  return EXAM_DATE_OF[region](examYearOf(today));
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

/** その生徒にとって次に来る都立一次の日程一式。無ければ null */
function nextTokyoExamSchedule(
  today: Date,
  grade: number | null,
  region: Region | null
): TokyoExamSchedule | null {
  if (grade !== 9 || region !== 'tokyo') return null;
  return TOKYO_EXAM_SCHEDULE[examYearOf(today)] ?? null;
}

/** 「2/4」の形にする */
function formatMonthDay(isoDate: string): string {
  const [, m, d] = isoDate.split('-');
  return `${Number(m)}/${Number(d)}`;
}

/**
 * ③に出す出願まわりの1行。日程が分からなければ null（行そのものを出さない）。
 * ★過ぎた日付は出さない。面談は11月から2月まで続くので、終わった〆切を読み上げないため。
 * ★東京のみ。神奈川は出願の日程をまだ持っていないので黙る（KANAGAWA_EXAM_DATES の注記）。
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
  return `${EXAM_NAME[region]}（${formatMonthDay(date)}）まで あと${days}日`;
}
