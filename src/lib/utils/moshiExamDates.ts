// 模試の試験日程まわりの共通ロジック。
// 設定は exam_dates（複数日程）が正典だが、旧データは exam_date/exam_date_label/exam_time の
// 単一日程しか持たない。読み手が毎回そのフォールバックを書かなくて済むようここに集約する。

import type { MoshiExamDate, MoshiSettings } from '@/types/forms/moshi';

const DAY_OF_WEEK = ['日', '月', '火', '水', '木', '金', '土'];

/** YYYY-MM-DD から "2月15日（日）" 形式のラベルを作る */
export function formatMoshiDateLabel(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}月${date.getDate()}日（${DAY_OF_WEEK[date.getDay()]}）`;
}

/** 日付が平日（月〜金）か。振替受験の判定に使う */
export function isWeekday(dateStr: string): boolean {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return false;
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

/**
 * 設定から試験日程の一覧を取り出す。日付の昇順。
 * exam_dates が空の旧データは exam_date から1件だけ組み立てて返すので、
 * 呼び出し側は常に「配列」として扱えばよい。
 */
export function getMoshiExamDates(settings: MoshiSettings | undefined): MoshiExamDate[] {
  if (!settings) return [];

  const dates = settings.exam_dates?.filter((d) => d?.date) ?? [];
  if (dates.length > 0) {
    return [...dates].sort((a, b) => a.date.localeCompare(b.date));
  }

  // 旧データ互換: 単一日程を1件の配列に見せる
  if (settings.exam_date) {
    return [
      {
        id: settings.exam_date,
        date: settings.exam_date,
        label: settings.exam_date_label || formatMoshiDateLabel(settings.exam_date),
        time: settings.exam_time || undefined,
      },
    ];
  }

  return [];
}

/** 「2月15日（日） 10:00〜13:00」形式の表示用テキスト */
export function formatMoshiExamDateText(examDate: Pick<MoshiExamDate, 'label' | 'time'>): string {
  return examDate.time ? `${examDate.label} ${examDate.time}` : examDate.label;
}

/**
 * 振替受験の希望日として選べる最小日（= 最終試験日の翌日）。YYYY-MM-DD。
 * 通常受験と振替は排他なので、生徒がどの日程を選んだかに関係なく
 * 「すべての試験日程が終わった後」を下限とする。
 */
export function getMinFurikaeDate(settings: MoshiSettings | undefined): string {
  const dates = getMoshiExamDates(settings);
  if (dates.length === 0) return '';

  const latest = dates[dates.length - 1].date;
  const d = new Date(latest);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
