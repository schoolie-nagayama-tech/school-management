'use client';

/**
 * 通塾日程の一覧表（1行=1授業・右に適用期間バー）。
 *
 * 週マトリクスは「今週の形」しか表せず、「いま社会・10月から理科」のような時間をまたぐ状態が
 * 読めなかった。現行システム（スクールIE）と同じ「1行=1授業、右に期間バー」の骨格に作り直し、
 * 期間バーそのものを変更履歴として読ませる。
 *
 * ここは表示層だけ。版管理・編集モーダル・保存処理・公開ゲートは既存の実装をそのまま使う
 * （行クリック／「変更」は呼び出し側が RegularScheduleFormModal を開く）。
 * D&Dによる登録はこの画面では持たない。登録は「＋授業を追加」、変更は行から行う。
 *
 * ★列構成: この表は生徒詳細モーダルの中で開かれる＝デスクトップ全幅は前提にできない。
 * 「曜日・コマ / 内容 / 期間バー / 操作」の4列に畳み、コマ・比率・講師は主要素の下に小さく添える。
 * 期間バーはヘッダーの月ラベルと同じ .timelineGrid（12等分）を共有し、月とバーを必ず対応させる。
 */

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import type { ScheduleRegularPattern } from '@/types/schedule';
import { DAY_OF_WEEK_LABELS, INDIVIDUAL_FORMATION } from '@/types/schedule';
import {
  getPatternPeriodStatus,
  formatPatternPeriod,
  type PatternPeriodStatus,
} from '@/lib/schedule/patternVersioning';
import {
  academicYearMonths,
  barGeometry,
  filterPlanRows,
  getAcademicYear,
  groupIntoChains,
  type BarGeometry,
} from '@/lib/schedule/lessonPlanTable';
import styles from './lessonPlan.module.css';

export interface LessonPlanTableProps {
  /** 通常期のパターン（個別・講座を混ぜてよい。終了済み・開始前も含めて渡す） */
  patterns: ScheduleRegularPattern[];
  /** 今日 'YYYY-MM-DD' */
  today: string;
  /** 編集できるか。false なら「変更」「＋授業を追加」を出さない */
  canEdit: boolean;
  /** 授業名（科目名 or 講座名）の解決。呼び出し側が科目・講座マスタから引く */
  lessonLabelOf: (pattern: ScheduleRegularPattern) => string;
  /** 講師の表示名（未設定は「担当未決定」） */
  teacherLabelOf: (pattern: ScheduleRegularPattern) => string;
  /** 行クリック／「変更」で編集モーダルを開く */
  onEdit: (pattern: ScheduleRegularPattern) => void;
  /** 授業を1件外す（従来UIのセルの×に当たる操作。確認ダイアログは呼び出し側が出す） */
  onDelete: (pattern: ScheduleRegularPattern) => void;
  /** 「＋授業を追加」 */
  onAdd: () => void;
}

/** 講座の授業か（個別以外の形態、または講座に紐づく行） */
function isCoursePattern(pattern: ScheduleRegularPattern): boolean {
  return pattern.formation !== INDIVIDUAL_FORMATION || !!pattern.special_course_id;
}

/** 「3限 16:20」。コマが引けないときは「—」 */
function slotLabelOf(pattern: ScheduleRegularPattern): string {
  const slot = pattern.time_slot;
  if (!slot) return '—';
  const start = slot.start_time?.slice(0, 5) ?? '';
  return start ? `${slot.slot_number}限 ${start}` : `${slot.slot_number}限`;
}

/** 曜日×コマのキー。同じコマの版を鎖にまとめるために使う */
function chainKeyOf(pattern: ScheduleRegularPattern): string {
  return `${pattern.day_of_week}-${pattern.time_slot_id}`;
}

/** バーの色クラス。終了=グレー / 現在=緑 / 開始前=青 */
const BAR_CLASS: Record<PatternPeriodStatus, string> = {
  ended: styles.barEnded,
  current: styles.barCurrent,
  upcoming: styles.barUpcoming,
};

/** 表に出す1行 */
interface PlanRow {
  pattern: ScheduleRegularPattern;
  status: PatternPeriodStatus;
  bar: BarGeometry;
}

export function LessonPlanTable({
  patterns,
  today,
  canEdit,
  lessonLabelOf,
  teacherLabelOf,
  onEdit,
  onDelete,
  onAdd,
}: LessonPlanTableProps) {
  // 表示中の年度。既定は今日の属する年度（塾の年度＝3月始まり）。
  const [year, setYear] = useState(() => getAcademicYear(today));
  // 終了した授業も出すか（既定オフ）。オンでも直近1年より古いものは filterPlanRows が落とす。
  const [showEnded, setShowEnded] = useState(false);

  const months = useMemo(() => academicYearMonths(year), [year]);
  // 今月の列。表示中の年度に今日が含まれないときは無い（-1）。
  const currentMonthIndex = useMemo(() => months.indexOf(today.slice(0, 7)), [months, today]);

  /**
   * 表に出す行の鎖。
   * 絞り込み（終了は直近1年ぶんのみ）→ 年度で切る → 曜日・コマ・開始日で並べる → 同じコマを鎖にまとめる、
   * の順。並べてから鎖にするので、鎖の中は古い版から新しい版の順になる。
   */
  const chains = useMemo(() => {
    const rows: PlanRow[] = [];
    for (const pattern of filterPlanRows(patterns, today, { showEnded })) {
      const bar = barGeometry({
        effectiveFrom: pattern.effective_from,
        effectiveUntil: pattern.effective_until,
        year,
      });
      // その年度に一切かからない行は出さない（◀▶で送れば見える）
      if (!bar) continue;
      rows.push({ pattern, status: getPatternPeriodStatus(pattern, today), bar });
    }
    rows.sort((a, b) => {
      const byDay = a.pattern.day_of_week - b.pattern.day_of_week;
      if (byDay !== 0) return byDay;
      const bySlot =
        (a.pattern.time_slot?.slot_number ?? 0) - (b.pattern.time_slot?.slot_number ?? 0);
      if (bySlot !== 0) return bySlot;
      return a.pattern.effective_from.localeCompare(b.pattern.effective_from);
    });
    return groupIntoChains(rows, (row) => chainKeyOf(row.pattern));
  }, [patterns, today, showEnded, year]);

  const rowCount = useMemo(() => chains.reduce((sum, chain) => sum + chain.length, 0), [chains]);

  return (
    <div className="space-y-2">
      {/* 表の上の操作列。左=終了した授業のトグル / 右=授業を追加 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex items-center gap-1.5 text-[11px] text-[var(--paragraph-light)] cursor-pointer">
          <input
            type="checkbox"
            checked={showEnded}
            onChange={(e) => setShowEnded(e.target.checked)}
            className="w-3 h-3 accent-[var(--primary)]"
          />
          終了した授業も表示
        </label>
        {canEdit && (
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center gap-1 text-[11px] text-[var(--headline)] hover:underline transition-[color] duration-150 ease-out"
          >
            <Plus className="w-3 h-3" aria-hidden="true" />
            授業を追加
          </button>
        )}
      </div>

      {/* 表はページ本体を横に伸ばさないよう、この中だけ横スクロールさせる */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-xs">
          <thead>
            <tr>
              <Th>曜日・コマ</Th>
              <Th>内容</Th>
              <th className="border-b border-[var(--stroke)] bg-[var(--bg)] px-2.5 py-1 text-left align-bottom">
                {/* 年度送り。既定は今日の年度。塾の年度なので3月始まり2月終わり。 */}
                <div className="flex items-center justify-center gap-1 text-[10px] text-[var(--paragraph-light)]">
                  <button
                    type="button"
                    onClick={() => setYear((prev) => prev - 1)}
                    aria-label="前の年度"
                    className="inline-flex p-0.5 rounded hover:bg-[var(--surface-hover)] transition-[background-color] duration-150 ease-out"
                  >
                    <ChevronLeft className="w-3 h-3" aria-hidden="true" />
                  </button>
                  <span className="font-medium text-[var(--paragraph)] tabular-nums">
                    {year}年度
                  </span>
                  <button
                    type="button"
                    onClick={() => setYear((prev) => prev + 1)}
                    aria-label="次の年度"
                    className="inline-flex p-0.5 rounded hover:bg-[var(--surface-hover)] transition-[background-color] duration-150 ease-out"
                  >
                    <ChevronRight className="w-3 h-3" aria-hidden="true" />
                  </button>
                </div>
                {/* 月ラベル。本文のバーと同じ .timelineGrid に載せて列を共有する */}
                <div
                  className={`${styles.timelineGrid} ${styles.timelineHead}`}
                  data-lp-grid="months"
                >
                  {months.map((month) => (
                    <span key={month}>{Number(month.slice(5))}</span>
                  ))}
                </div>
              </th>
              {/* 操作列。見出しは要らないが、列数を揃えるために空で置く */}
              <Th />
            </tr>
          </thead>
          <tbody>
            {rowCount === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-2.5 py-6 text-center text-[11px] text-[var(--paragraph-light)]"
                >
                  {year}年度に該当する授業はありません。
                  {canEdit && '「授業を追加」から登録できます。'}
                </td>
              </tr>
            )}
            {chains.map((chain) =>
              chain.map((row, indexInChain) => (
                <PlanTableRow
                  key={row.pattern.id}
                  row={row}
                  indexInChain={indexInChain}
                  chainLength={chain.length}
                  currentMonthIndex={currentMonthIndex}
                  canEdit={canEdit}
                  lessonLabelOf={lessonLabelOf}
                  teacherLabelOf={teacherLabelOf}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 凡例。バーの色の意味は覚えていられないので常に添える */}
      <div className="flex flex-wrap gap-3 text-[10px] text-[var(--paragraph-light)]">
        <span>
          <i className={`${styles.legendSwatch} ${styles.barEnded}`} aria-hidden="true" />
          終了
        </span>
        <span>
          <i className={`${styles.legendSwatch} ${styles.barCurrent}`} aria-hidden="true" />
          現在
        </span>
        <span>
          <i className={`${styles.legendSwatch} ${styles.barUpcoming}`} aria-hidden="true" />
          開始前（予定）
        </span>
        <span>
          <i className={`${styles.legendSwatch} ${styles.legendCurrentMonth}`} aria-hidden="true" />
          今月
        </span>
        <span>終了した授業は直近1年ぶんまで表示します</span>
      </div>
    </div>
  );
}

/** 見出しセル（表のヘッダーは全部同じ体裁にする） */
function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="border-b border-[var(--stroke)] bg-[var(--bg)] px-2.5 py-1.5 text-left text-[10px] font-medium text-[var(--paragraph-light)] whitespace-nowrap">
      {children}
    </th>
  );
}

interface PlanTableRowProps {
  row: PlanRow;
  /** 鎖の中の位置。0 以外は同じ曜日×コマの次の版なので「↳」を付ける */
  indexInChain: number;
  chainLength: number;
  currentMonthIndex: number;
  canEdit: boolean;
  lessonLabelOf: (pattern: ScheduleRegularPattern) => string;
  teacherLabelOf: (pattern: ScheduleRegularPattern) => string;
  onEdit: (pattern: ScheduleRegularPattern) => void;
  onDelete: (pattern: ScheduleRegularPattern) => void;
}

function PlanTableRow({
  row,
  indexInChain,
  chainLength,
  currentMonthIndex,
  canEdit,
  lessonLabelOf,
  teacherLabelOf,
  onEdit,
  onDelete,
}: PlanTableRowProps) {
  const { pattern, status, bar } = row;
  const isCourse = isCoursePattern(pattern);
  const isChained = indexInChain > 0;

  return (
    <tr
      onClick={canEdit ? () => onEdit(pattern) : undefined}
      title={canEdit ? 'クリックして変更' : formatPatternPeriod(pattern)}
      className={`border-b border-[var(--stroke-light)] ${
        // 終了した授業は薄く出して、今の内容と取り違えないようにする
        status === 'ended' ? 'opacity-60' : ''
      } ${
        canEdit
          ? 'cursor-pointer hover:bg-[var(--surface-hover)] transition-[background-color] duration-150 ease-out'
          : ''
      }`}
    >
      {/* 曜日・コマは鎖の先頭だけに出し、同じコマの版であることを縦の結合で示す */}
      {!isChained && (
        <td
          rowSpan={chainLength}
          className="px-2.5 py-2 align-middle whitespace-nowrap text-[var(--paragraph)]"
        >
          <span className="block font-medium text-[var(--headline)]">
            {DAY_OF_WEEK_LABELS[pattern.day_of_week] ?? '—'}
          </span>
          <span className="block text-[10px] text-[var(--paragraph-light)]">
            {slotLabelOf(pattern)}
          </span>
        </td>
      )}
      {/* 内容だけは折り返し可（科目を複数持つ行が横に伸びると期間バーが押し出されるため） */}
      <td className="px-2.5 py-2 align-middle text-[var(--paragraph)]">
        <span className="block font-medium text-[var(--headline)]">
          {isChained && (
            <span className="text-[var(--paragraph-light)] font-normal mr-1" aria-hidden="true">
              ↳
            </span>
          )}
          {lessonLabelOf(pattern)}
          {isCourse && (
            <span className="ml-1.5 inline-flex rounded px-1.5 py-0.5 text-[9px] font-normal bg-[var(--accent-ink-subtle)] text-[var(--accent-ink)]">
              講座
            </span>
          )}
        </span>
        {/* 比率は個別指導だけの概念（講座は定員で管理する）。列を分けず主要素の下に添える */}
        <span className="block text-[10px] text-[var(--paragraph-light)] whitespace-nowrap">
          {[isCourse ? null : pattern.ratio === 1 ? '1対1' : '1対2', teacherLabelOf(pattern)]
            .filter(Boolean)
            .join('・')}
        </span>
      </td>
      <td className="px-2.5 py-2 align-middle">
        <div className={styles.timeline} title={formatPatternPeriod(pattern)}>
          {/* 月セルはヘッダーの月ラベルと同じ .timelineGrid に載せる（列定義の共有が肝） */}
          <div className={styles.timelineGrid} data-lp-grid="months">
            {Array.from({ length: 12 }, (_, index) => (
              <span
                key={index}
                className={`${styles.cell} ${index === currentMonthIndex ? styles.cellCurrent : ''}`}
              />
            ))}
          </div>
          <div
            className={`${styles.bar} ${BAR_CLASS[status]} ${
              bar.clippedLeft ? styles.clippedLeft : ''
            } ${bar.clippedRight ? styles.clippedRight : ''}`}
            style={{ left: `${bar.leftPct}%`, width: `${bar.widthPct}%` }}
          />
        </div>
      </td>
      <td className="px-2.5 py-2 align-middle text-right whitespace-nowrap">
        {canEdit && (
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={(e) => {
                // 行クリックと二重に発火させない
                e.stopPropagation();
                onEdit(pattern);
              }}
              className="rounded border border-[var(--stroke)] px-2.5 py-0.5 text-[11px] text-[var(--paragraph)] hover:bg-[var(--surface-hover)] transition-[background-color] duration-150 ease-out"
            >
              変更
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(pattern);
              }}
              aria-label="この授業を外す"
              title="この授業を外す"
              className="inline-flex p-1 rounded text-[var(--text-faint)] hover:text-[var(--danger)] hover:bg-[var(--surface-hover)] transition-[color,background-color] duration-150 ease-out"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
