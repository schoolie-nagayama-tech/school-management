'use client';

/**
 * LessonReportProgressGrid — 報告書フォームに埋め込む進行表グリッド
 *
 * 目的: 「学習内容・学校進度」の記入を、進行表の授業記録とまったく同じ操作
 *      （行の学校列 / 1〜3回目の列をクリックして選択）に統一する。
 *      講師が新しい操作を覚えなくていいことが要件（§7-4）。
 *
 * 実装方針:
 * - 行の描画は進行表の `ProgressRow` を **そのまま** 使う。
 *   ProgressRow は既に sessionMode / sessionSelection / onSessionCellToggle を
 *   持っているので、新しい選択UIは作らない。
 * - 進行表ページ（NewProgressPage / TableView）側のコードは一切変更しない。
 *   TableView は面談モード・一括塗り・目標編集など報告書に不要な機能と密結合して
 *   いるため共用せず、「sessionMode 専用の薄いラッパー」だけをここに置く。
 * - このグリッドでは進行表を直接更新しない（クリックは選択状態を変えるだけ）。
 *   実際の書き込みは報告書の保存時に recordSession（既存の唯一の保存経路）で行う。
 */

import { useMemo } from 'react';
import type { CurriculumItemWithProgress } from '@/types/database';
import { ProgressRow } from '@/app/students/[studentId]/progress/ProgressRow';
import {
  isIntentTag,
  type IntentTag,
  type MeetingColMap,
} from '@/app/students/[studentId]/progress/newProgress.shared';

/**
 * 報告書フォームで出す列だけ true にする。
 * 提案・申込・試験範囲・引継ぎ・宿題未/遅刻・講師名は進行表（教室長の管理列）や
 * 報告書の別セクションの担当なので、ここでは出さない。
 */
const REPORT_GRID_COLS: MeetingColMap = {
  proposal: false,
  application: false,
  examRange: false,
  schoolProgress: true,
  lesson1: true,
  lesson2: true,
  lesson3: true,
  handover: false,
  homeworkNotDone: false,
  tardy: false,
  teacherName: false,
};

export interface GridSelection {
  /** curriculum_item_id → 指導回（1〜3回目） */
  unitActions: Record<number, 1 | 2 | 3>;
  /** 学校進度としてマークした単元ID */
  schoolUnits: Set<number>;
  /** 選択セルに表示する日付（＝この授業の日） */
  sessionDate: string;
}

export function LessonReportProgressGrid({
  textbookName,
  rows,
  selection,
  onCellToggle,
  isTeacher = false,
}: {
  textbookName: string;
  rows: CurriculumItemWithProgress[];
  selection: GridSelection;
  onCellToggle: (curriculumItemId: number, column: 'school' | 1 | 2 | 3) => void;
  isTeacher?: boolean;
}) {
  // 指導意図タグは報告書では読み取り専用。グループ先頭行の値を全行に配って
  // ゴーストチップ（薄い破線チップ）で見せる。編集は進行表側の仕事。
  const intentByRowId = useMemo(() => {
    const groupIntent = new Map<number, IntentTag | null>();
    for (const r of rows) {
      const g = r.progress?.group_number;
      if (g == null) continue;
      if (!groupIntent.has(g)) {
        const t = r.progress?.intent_tag;
        groupIntent.set(g, isIntentTag(t) ? (t as IntentTag) : null);
      }
    }
    const map = new Map<number, IntentTag | null>();
    for (const r of rows) {
      const own = r.progress?.intent_tag;
      const g = r.progress?.group_number;
      map.set(
        r.id,
        isIntentTag(own) ? (own as IntentTag) : g != null ? (groupIntent.get(g) ?? null) : null
      );
    }
    return map;
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#e5e7eb] bg-surface px-3 py-4 text-xs text-text-muted">
        この教材には単元（目次）が登録されていないため、グリッドで選択できません。下の自由記述に入力してください。
      </div>
    );
  }

  const selectedCount = Object.keys(selection.unitActions).length;

  return (
    <div className="rounded-lg border border-[#e5e7eb] overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-[#f9fafb] border-b border-[#e5e7eb]">
        <span className="text-xs font-bold text-[#1f2937] truncate">{textbookName}</span>
        <span className="text-[11px] text-text-muted whitespace-nowrap">
          {selectedCount > 0 ? `指導 ${selectedCount} 単元を選択中` : '行をクリックして選択'}
        </span>
      </div>
      {/* 単元数が多い教材でもフォームが縦に伸びきらないよう、グリッド内でスクロールさせる */}
      <div className="max-h-[320px] overflow-y-auto overflow-x-auto">
        <table className="w-full text-sm min-w-[520px]">
          <thead className="bg-[#f9fafb] border-b border-[#e5e7eb] text-[#6b7280] text-xs sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2 text-left w-10">#</th>
              <th className="px-3 py-2 text-left min-w-[180px]">単元名</th>
              <th className="px-3 py-2 text-left w-24">学校進度</th>
              <th className="px-3 py-2 text-left w-24">1回目</th>
              <th className="px-3 py-2 text-left w-24">2回目</th>
              <th className="px-3 py-2 text-left w-24">3回目</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <ProgressRow
                key={row.id}
                row={row}
                examTypes={[]}
                isMeeting={false}
                meetingCols={REPORT_GRID_COLS}
                // 指導意図は編集させない（groupStart=false でピッカーの代わりに
                // 継承表示のゴーストチップが出る）
                groupStart={false}
                inheritedIntentTag={intentByRowId.get(row.id) ?? null}
                isTeacher={isTeacher}
                sessionMode
                sessionSelection={selection}
                // 表のセルからの直接編集は報告書では使わない（保存は recordSession に一本化）
                canDirectEdit={false}
                onLocalPatch={() => {}}
                onSaveProgress={async () => {}}
                onSaveLesson={async () => {}}
                onSessionCellToggle={onCellToggle}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
