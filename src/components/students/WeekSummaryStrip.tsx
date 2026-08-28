'use client';

/**
 * 通塾日程の週サマリ帯（読み取り専用）。
 *
 * 下の一覧表（LessonPlanTable）が正で、この帯は「今週どう来るのか」を3秒で読むための写し。
 * クリックしても何も起きない（入り口を二重に作ると、どちらが正か分からなくなるため）。
 *
 * 出すもの:
 *  - 今日の時点で有効な授業
 *  - まだ始まっていない授業のうち、同じ曜日×コマに今の授業が無いもの（「9/1から開始」）
 * 今の授業に控えている変更がある場合は、そのチップに「→ 10/1から理科」を添える。
 */

import { useMemo } from 'react';
import type { ScheduleRegularPattern } from '@/types/schedule';
import { DAY_OF_WEEK_LABELS } from '@/types/schedule';
import { getPatternPeriodStatus, formatUpcomingBadge } from '@/lib/schedule/patternVersioning';
import styles from './lessonPlan.module.css';

export interface WeekSummaryStripProps {
  /** 通常期のパターン（個別・講座を混ぜてよい） */
  patterns: ScheduleRegularPattern[];
  /** 今日 'YYYY-MM-DD' */
  today: string;
  /** 授業名（科目名 or 講座名）の解決。呼び出し側が科目・講座マスタから引く */
  lessonLabelOf: (pattern: ScheduleRegularPattern) => string;
  /** 講師の表示名（未設定は「担当未決定」） */
  teacherLabelOf: (pattern: ScheduleRegularPattern) => string;
}

/** 曜日×コマのキー。同じコマの版を突き合わせるために使う */
function slotKeyOf(pattern: ScheduleRegularPattern): string {
  return `${pattern.day_of_week}-${pattern.time_slot_id}`;
}

/** 「月 3限」のような見出し。コマ番号が引けないときは曜日だけ出す */
function headingOf(pattern: ScheduleRegularPattern): string {
  const day = DAY_OF_WEEK_LABELS[pattern.day_of_week] ?? '—';
  const slot = pattern.time_slot?.slot_number;
  return slot != null ? `${day} ${slot}限` : day;
}

export function WeekSummaryStrip({
  patterns,
  today,
  lessonLabelOf,
  teacherLabelOf,
}: WeekSummaryStripProps) {
  const chips = useMemo(() => {
    const current: ScheduleRegularPattern[] = [];
    const upcoming: ScheduleRegularPattern[] = [];
    for (const pattern of patterns) {
      const status = getPatternPeriodStatus(pattern, today);
      if (status === 'current') current.push(pattern);
      else if (status === 'upcoming') upcoming.push(pattern);
    }

    // 同じ曜日×コマの「次の版」。複数あるときは開始が早いものを控えている変更として出す。
    const nextBySlot = new Map<string, ScheduleRegularPattern>();
    for (const pattern of upcoming) {
      const key = slotKeyOf(pattern);
      const kept = nextBySlot.get(key);
      if (!kept || pattern.effective_from < kept.effective_from) nextBySlot.set(key, pattern);
    }

    const currentKeys = new Set(current.map(slotKeyOf));
    const rows = [
      ...current.map((pattern) => ({
        pattern,
        next: nextBySlot.get(slotKeyOf(pattern)) ?? null,
        isNew: false,
      })),
      // 今の授業が無いコマの開始前の授業は、それ自体を1枚のチップとして出す
      ...upcoming
        .filter((pattern) => !currentKeys.has(slotKeyOf(pattern)))
        .map((pattern) => ({ pattern, next: null, isNew: true })),
    ];

    return rows.sort((a, b) => {
      const byDay = a.pattern.day_of_week - b.pattern.day_of_week;
      if (byDay !== 0) return byDay;
      return (a.pattern.time_slot?.slot_number ?? 0) - (b.pattern.time_slot?.slot_number ?? 0);
    });
  }, [patterns, today]);

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map(({ pattern, next, isNew }) => (
        <div
          key={pattern.id}
          className="min-w-[116px] rounded-lg border border-[var(--stroke)] bg-[var(--surface)] px-3 py-1.5"
        >
          <span className="block text-[11px] font-bold text-[var(--headline)]">
            {headingOf(pattern)}
          </span>
          <span className="block text-xs text-[var(--paragraph)]">
            {lessonLabelOf(pattern)}
            <span className="text-[var(--paragraph-light)]">（{teacherLabelOf(pattern)}）</span>
          </span>
          {/* 控えている変更・これから始まる授業は warning 系の色で添える（今の内容と取り違えないように） */}
          {isNew ? (
            <span className={`block text-[11px] ${styles.upcomingNote}`}>
              {formatUpcomingBadge(pattern.effective_from)}開始
            </span>
          ) : (
            next && (
              <span className={`block text-[11px] ${styles.upcomingNote}`}>
                → {formatUpcomingBadge(next.effective_from)}
                {lessonLabelOf(next)}
              </span>
            )
          )}
        </div>
      ))}
    </div>
  );
}
