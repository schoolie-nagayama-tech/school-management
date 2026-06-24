'use client';

import type {
  CurriculumItemWithProgress,
  ExamType,
  StudentTextbookExamRange,
} from '@/types/database';
import { itemNo } from './newProgress.shared';

// 試験範囲インライン（カード内に埋め込み用。外枠なし）
// ─────────────────────────────────────────────
export function ExamRangesInline({
  textbookId: _textbookId,
  examTypes,
  ranges,
  progress,
  isMeeting,
  onOpenEdit,
  onDelete,
}: {
  textbookId: string;
  examTypes: ExamType[];
  ranges: StudentTextbookExamRange[];
  progress: CurriculumItemWithProgress[];
  isMeeting: boolean;
  onOpenEdit: (rangeId: string | null, examTypeId: string | null) => void;
  onDelete: (rangeId: string) => void;
}) {
  const titleOfItem = (no: number) => progress.find((p) => itemNo(p) === no)?.title ?? `項目${no}`;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <label className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">
          試験範囲
        </label>
        {!isMeeting && (
          <button
            onClick={() => onOpenEdit(null, null)}
            className="px-2 py-0.5 text-[11px] bg-[#f9fafb] border border-[#e5e7eb] rounded text-[#1e3a5f] hover:bg-[#1e3a5f] hover:text-white transition-[background-color,color] duration-150 ease-out active:scale-[0.97]"
          >
            ＋ 追加
          </button>
        )}
      </div>
      {ranges.length === 0 ? (
        <div className="text-[11px] text-[#9ca3af]">未設定</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {ranges.map((r) => {
            const name = examTypes.find((t) => t.id === r.exam_type_id)?.name ?? '試験';
            const startTitle = titleOfItem(r.range_start_item_number);
            const endTitle = titleOfItem(r.range_end_item_number);
            const label =
              r.range_start_item_number === r.range_end_item_number
                ? startTitle
                : `${startTitle} 〜 ${endTitle}`;
            return (
              <span
                key={r.id}
                className="inline-flex items-center gap-1 px-2 py-1 bg-[#eff6ff] border border-[#dbeafe] rounded text-[11px]"
              >
                <strong className="text-[#1e3a5f]">{name}</strong>
                <span className="text-[#6b7280]">|</span>
                <span className="text-[#1f2937]">{label}</span>
                <span className="text-[11px] text-[#6b7280]">
                  （{r.range_start_item_number}〜{r.range_end_item_number}）
                </span>
                {!isMeeting && (
                  <>
                    <button
                      onClick={() => onOpenEdit(r.id, r.exam_type_id)}
                      className="px-1 text-[11px] text-[#1e40af] hover:underline"
                    >
                      編集
                    </button>
                    <button
                      onClick={() => onDelete(r.id)}
                      className="px-1 text-[11px] text-red-500 hover:underline"
                    >
                      削除
                    </button>
                  </>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
