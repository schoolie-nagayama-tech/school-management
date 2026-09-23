/**
 * プライバシースクリーンに出す「入試まであと◯日」。
 * ------------------------------------------------------------------
 * 日付そのものは lib/interview/examDates.ts が正典。ここは「どの教室に・どのくらいの
 * 頻度で出すか」という出し方だけを持つ。
 */
import { nextTokyoExamDateForRegion, daysUntil } from '@/lib/interview/examDates';
import { regionOfSchool } from '@/lib/interview/region';

/**
 * ★試験運用中。まず永山校だけで回す。
 *
 * 教室セレクタで永山校を選んでいるときだけ出す。良ければ東京3校（region === 'tokyo'）へ
 * 広げ、この定数ごと消す。神奈川（緑園都市校）は共通選抜 2/16 の日付を持っているが、
 * examDates.ts に足すと面談台本③の挙動まで変わるため、試験の範囲に入れていない。
 */
const TRIAL_SCHOOL_IDS: readonly string[] = [
  'd187f7a3-633a-46ce-8d32-c56c85d17bac', // 永山校
];

/**
 * ★毎回は出さない。100回に1回だけ。
 *
 * プライバシースクリーンは1日に何度も立つ。毎回同じ数字が出ると3日で壁紙になって
 * 誰も読まなくなるので、たまにしか出さないことで「見る」状態を保つ。
 *
 * ★裏を返すと、日付の更新漏れには気づけない（100回に1回しか出ないので、古い日付でも
 *   誰も気づかない）。年度が変わったら examDates.ts を必ず手で直すこと。
 */
export const COUNTDOWN_PROBABILITY = 1 / 100;

export interface ExamCountdown {
  /** 見出し。「都立入試まで」 */
  label: string;
  /** 残り日数。0 は当日 */
  days: number;
  /** 「2/21」。曜日は出さない（短く保つため。日付そのものは 2026-09-23 に実施要綱で確認済み） */
  dateLabel: string;
}

/**
 * その教室に出すカウントダウン。出さない場合は null。
 *
 * ★「すべての教室」を選んでいるとき（schoolId === 'all'）は出さない。都県ごとに入試日が
 *   違うので、どの日付を指しているのか分からない数字を出すほうが害になる。
 */
export function examCountdownForSchool(
  today: Date,
  schoolId: string | 'all' | null | undefined
): ExamCountdown | null {
  if (!schoolId || schoolId === 'all') return null;
  if (!TRIAL_SCHOOL_IDS.includes(schoolId)) return null;

  const date = nextTokyoExamDateForRegion(today, regionOfSchool(schoolId));
  if (!date) return null;

  const days = daysUntil(today, date);
  if (days < 0) return null; // 過ぎた入試の日数は出さない

  const [, m, d] = date.split('-');
  return {
    label: '都立入試まで',
    days,
    dateLabel: `${Number(m)}/${Number(d)}`,
  };
}

/** 今回のロックでカウントダウンを出すかどうかの抽選 */
export function drawCountdown(random: () => number = Math.random): boolean {
  return random() < COUNTDOWN_PROBABILITY;
}
