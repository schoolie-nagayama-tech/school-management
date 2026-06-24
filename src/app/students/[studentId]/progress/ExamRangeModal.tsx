'use client';

import { useEffect, useState } from 'react';
import { updateStudentProgress, upsertStudentProgress } from '@/lib/api/progress';
import { upsertExamRange } from '@/lib/api/exam-ranges';
import type {
  CurriculumItemWithProgress,
  ExamType,
  StudentTextbookExamRange,
  StudentTextbookExamRangeInsert,
} from '@/types/database';
import { itemNo } from './newProgress.shared';
import { RangeSlider } from './RangeSlider';

// ─────────────────────────────────────────────
// 試験範囲モーダル (スライダー + 項目ピル) — 独立テーブル対応
// 選択した試験 (exam_type_id) に対して項目範囲を設定。
// 独立テーブル student_textbook_exam_ranges に保存し、
// 互換性のため student_progress.exam_range_exam_type_id も同期更新する。
// ─────────────────────────────────────────────
export function ExamRangeModal({
  textbookId,
  progress,
  examTypes,
  existingRanges,
  initialExamTypeId,
  initialRangeId,
  onClose,
  onSaved,
  toastError,
}: {
  textbookId: string;
  progress: CurriculumItemWithProgress[];
  examTypes: ExamType[];
  existingRanges: StudentTextbookExamRange[];
  initialExamTypeId: string | null;
  initialRangeId: string | null;
  onClose: () => void;
  onSaved: (saved: StudentTextbookExamRange) => void;
  toastError: (m: string) => void;
}) {
  const sorted = [...progress]
    .filter((p) => itemNo(p) != null)
    .sort((a, b) => (itemNo(a) ?? 0) - (itemNo(b) ?? 0));
  const min = (sorted[0] ? itemNo(sorted[0]) : null) ?? 1;
  const max = (sorted[sorted.length - 1] ? itemNo(sorted[sorted.length - 1]) : null) ?? min;

  const [examTypeId, setExamTypeId] = useState<string>(initialExamTypeId ?? '');
  // 編集時は対象セグメントの範囲を初期値にする（新規追加時は min/max）
  const initExisting = initialRangeId
    ? existingRanges.find((r) => r.id === initialRangeId)
    : undefined;
  const [rangeStart, setRangeStart] = useState<number>(
    initExisting?.range_start_item_number ?? min
  );
  const [rangeEnd, setRangeEnd] = useState<number>(initExisting?.range_end_item_number ?? max);
  const [saving, setSaving] = useState(false);

  // 試験を切り替えたら min/max にリセット（新規追加モード時のみ）
  useEffect(() => {
    if (!examTypeId || initialRangeId) return;
    setRangeStart(min);
    setRangeEnd(max);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examTypeId]);

  const save = async () => {
    if (!examTypeId) {
      toastError('試験を選択してください');
      return;
    }
    setSaving(true);
    try {
      // 1. 独立テーブルに保存（id があれば update、無ければ新規 insert）
      const saved = await upsertExamRange({
        ...(initialRangeId ? { id: initialRangeId } : {}),
        student_textbook_id: textbookId,
        exam_type_id: examTypeId,
        range_start_item_number: rangeStart,
        range_end_item_number: rangeEnd,
      } as StudentTextbookExamRangeInsert & { id?: string });
      // 2. per-row の exam_range_exam_type_id を同期
      //    同じ試験の「他のセグメント」は保護する（複数区間対応）
      const otherSegments = existingRanges.filter(
        (r) => r.exam_type_id === examTypeId && r.id !== saved.id
      );
      const inOther = (n: number | null): boolean => {
        if (n == null) return false;
        return otherSegments.some(
          (r) => n >= r.range_start_item_number && n <= r.range_end_item_number
        );
      };
      // 今回保存した範囲に含まれる行（番号なし中間行も内包）
      let startIdx = -1;
      let endIdx = -1;
      for (let i = 0; i < progress.length; i++) {
        const n = itemNo(progress[i]);
        if (n == null) continue;
        if (n >= rangeStart && n <= rangeEnd) {
          if (startIdx < 0) startIdx = i;
          endIdx = i;
        }
      }
      const inRangeIds = new Set<string>();
      if (startIdx >= 0 && endIdx >= 0) {
        for (let i = startIdx; i <= endIdx; i++) inRangeIds.add(String(progress[i].id));
      }
      const tasks: Promise<unknown>[] = [];
      for (const row of progress) {
        const n = itemNo(row);
        const inRange = inRangeIds.has(String(row.id));
        const hasThis = row.progress?.exam_range_exam_type_id === examTypeId;
        if (inRange && !hasThis) {
          if (row.progress?.id) {
            tasks.push(
              updateStudentProgress(row.progress.id, { exam_range_exam_type_id: examTypeId })
            );
          } else {
            tasks.push(
              upsertStudentProgress({
                student_textbook_id: textbookId,
                curriculum_item_id: row.id,
                exam_range_exam_type_id: examTypeId,
              })
            );
          }
        } else if (!inRange && hasThis && !inOther(n)) {
          // 他セグメントに含まれない行のみ解除
          if (row.progress?.id) {
            tasks.push(updateStudentProgress(row.progress.id, { exam_range_exam_type_id: null }));
          }
        }
      }
      await Promise.all(tasks);
      onSaved(saved);
    } catch (e) {
      console.error(e);
      toastError('試験範囲の保存に失敗しました');
      setSaving(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-40 animate-[fade-in_150ms_ease-out]"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col pointer-events-auto animate-[popover-enter_150ms_cubic-bezier(0.23,1,0.32,1)]">
          <header className="px-6 py-4 border-b border-[#e5e7eb] flex items-center justify-between">
            <h2 className="font-bold text-[#1f2937] text-lg">
              {initialRangeId ? '試験範囲を編集' : '試験範囲を設定'}
            </h2>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded hover:bg-[#f3f4f6] text-[#6b7280] transition-[color] duration-150 ease-out active:scale-[0.97]"
            >
              ✕
            </button>
          </header>
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* 対象の試験（マスタから選択） */}
            <div>
              <label className="block text-xs font-medium text-[#6b7280] mb-1.5">
                対象の試験（マスタから選択）
              </label>
              <select
                value={examTypeId}
                onChange={(e) => setExamTypeId(e.target.value)}
                disabled={!!initialRangeId}
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white"
              >
                <option value="">選択してください</option>
                {examTypes.map((et) => {
                  const segs = existingRanges.filter((r) => r.exam_type_id === et.id);
                  const hint =
                    segs.length === 0
                      ? ''
                      : segs.length === 1
                        ? ` （設定済: 項目${segs[0].range_start_item_number}〜${segs[0].range_end_item_number}）`
                        : ` （設定済: ${segs.length}区間）`;
                  return (
                    <option key={et.id} value={et.id}>
                      {et.name}
                      {hint}
                    </option>
                  );
                })}
              </select>
              <p className="text-[11px] text-[#6b7280] mt-1">
                目標設定の有無と関係なく、試験名に対して独立に範囲を設定できます。
              </p>
            </div>

            {examTypeId && (
              <div>
                <label className="block text-xs font-medium text-[#6b7280] mb-2">
                  範囲{' '}
                  <span className="text-[#1f2937] ml-1">
                    項目 {rangeStart} 〜 {rangeEnd}（{rangeEnd - rangeStart + 1}項目）
                  </span>
                </label>
                <RangeSlider
                  min={min}
                  max={max}
                  start={rangeStart}
                  end={rangeEnd}
                  onChange={(s, e) => {
                    setRangeStart(s);
                    setRangeEnd(e);
                  }}
                />
                <div className="mt-3 flex flex-wrap gap-1">
                  {sorted.map((r) => {
                    const n = itemNo(r) ?? 0;
                    const inRange = n >= rangeStart && n <= rangeEnd;
                    return (
                      <button
                        key={r.id}
                        onClick={() => {
                          if (n < rangeStart) setRangeStart(n);
                          else if (n > rangeEnd) setRangeEnd(n);
                          else if (n - rangeStart < rangeEnd - n) setRangeStart(n);
                          else setRangeEnd(n);
                        }}
                        className={`px-2 py-1 text-[11px] rounded border transition-[background-color,color,border-color] duration-150 ease-out whitespace-nowrap ${
                          inRange
                            ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                            : 'bg-white text-[#4b5563] border-[#e5e7eb] hover:bg-[#f3f4f6]'
                        }`}
                        title={r.title}
                      >
                        {n}. {r.title.length > 14 ? r.title.slice(0, 14) + '…' : r.title}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 flex gap-1">
                  <button
                    onClick={() => {
                      setRangeStart(min);
                      setRangeEnd(max);
                    }}
                    className="text-[11px] px-2 py-0.5 bg-[#f3f4f6] rounded hover:bg-[#e5e7eb]"
                  >
                    全範囲
                  </button>
                  <button
                    onClick={() => {
                      setRangeStart(Math.max(min, max - 7));
                      setRangeEnd(max);
                    }}
                    className="text-[11px] px-2 py-0.5 bg-[#f3f4f6] rounded hover:bg-[#e5e7eb]"
                  >
                    直近8項目
                  </button>
                </div>
              </div>
            )}
          </div>
          <footer className="px-6 py-4 border-t border-[#e5e7eb] flex items-center justify-end gap-2 bg-[#f9fafb]">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-[#4b5563] hover:bg-[#f3f4f6] rounded-lg"
            >
              キャンセル
            </button>
            <button
              onClick={save}
              disabled={saving || !examTypeId}
              className="px-4 py-1.5 bg-[#1e3a5f] text-white text-sm font-medium rounded-lg hover:bg-[#2a4d7a] disabled:opacity-50"
            >
              {saving ? '保存中...' : '範囲を保存'}
            </button>
          </footer>
        </div>
      </div>
    </>
  );
}
