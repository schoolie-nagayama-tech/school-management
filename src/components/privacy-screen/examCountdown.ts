/**
 * プライバシースクリーンに出す「入試まであと◯日」。
 * ------------------------------------------------------------------
 * 日付と呼び名は lib/interview/examDates.ts が正典。ここは「どの教室に・どのくらいの
 * 頻度で出すか」という出し方だけを持つ。
 */
import { nextExamDateForRegion, daysUntil, EXAM_NAME } from '@/lib/interview/examDates';
import { regionOfSchool } from '@/lib/interview/region';

/**
 * ★試験運用中。まず永山校だけで回す。
 *
 * 教室セレクタで永山校を選んでいるときだけ出す。良ければ他の教室へ広げ、この定数ごと消す。
 * 日付も見出しも都県で出し分けるようにしてあるので、緑園都市校（神奈川）を足しても
 * 「共通選抜まで」が出る。広げるかどうかは運用の判断で、コードの都合ではない。
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
  /** 見出し。★都県で変わる（東京「都立一次まで」／神奈川「共通選抜まで」） */
  label: string;
  /** 残り日数。0 は当日 */
  days: number;
  /** 「2/21」。曜日は出していない */
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

  const region = regionOfSchool(schoolId);
  if (!region) return null; // 都県の分からない教室に、どちらかの入試の日数を出さない

  const date = nextExamDateForRegion(today, region);
  if (!date) return null;

  const days = daysUntil(today, date);
  if (days < 0) return null; // 過ぎた入試の日数は出さない

  const [, m, d] = date.split('-');
  return {
    label: `${EXAM_NAME[region]}まで`,
    days,
    dateLabel: `${Number(m)}/${Number(d)}`,
  };
}

/** 今回のロックでカウントダウンを出すかどうかの抽選 */
export function drawCountdown(random: () => number = Math.random): boolean {
  return random() < COUNTDOWN_PROBABILITY;
}
