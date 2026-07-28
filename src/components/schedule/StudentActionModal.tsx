'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui';
import { Button } from '@/components/ui';
import { Calendar, XCircle, Pencil, Trash2, RotateCcw, ArrowLeftRight } from 'lucide-react';
import type { ScheduleEntry, ScheduleTimeSlot } from '@/types/schedule';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';

function formatDay(dateStr: string): string {
  const d = new Date(dateStr + 'Z');
  const week = ['日', '月', '火', '水', '木', '金', '土'][d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${week})`;
}

export interface StudentActionModalProps {
  open: boolean;
  onClose: () => void;
  entry: ScheduleEntry | null;
  timeSlot: ScheduleTimeSlot | null;
  onTransfer: () => void;
  onRevertTransfer?: () => void;
  onAbsent: () => void;
  /**
   * §2.12 生徒の入れ替えモードを開始する。個別タブ・通常モードでのみ親が渡す
   * （未指定なら「入れ替え」ボタンを表示しない）。見込み客・振替元・キャンセルでは常に非表示。
   */
  onSwap?: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** 生徒名クリック時（親で授業操作モーダルを閉じてから開くこと） */
  onStudentClick?: () => void;
  /** 講師名クリック時（親で授業操作モーダルを閉じてから開くこと） */
  onTeacherClick?: () => void;
}

export function StudentActionModal({
  open,
  onClose,
  entry,
  timeSlot,
  onTransfer,
  onRevertTransfer,
  onAbsent,
  onSwap,
  onEdit,
  onDelete,
  onStudentClick,
  onTeacherClick,
}: StudentActionModalProps) {
  if (!entry) return null;

  // Phase T: 体験の見込み客（student_id 無し・inquiry_id 参照）は終端的なコマ。
  // 振替・出欠・編集の対象外で、取消（削除）のみ許可する。
  const isInquiry = !entry.student_id && !!entry.inquiry_id;
  const studentName = entry.student
    ? `${entry.student.last_name} ${entry.student.first_name}（${formatGradeLabel(entry.student.grade)}）`
    : entry.inquiry
      ? `${entry.inquiry.student_name || '（氏名未登録）'}（見込み客）`
      : (entry.student_id ?? '—');
  const subjectNames =
    (entry.subjects ?? [])
      .map((s) => (typeof s === 'object' && s && 'name' in s ? s.name : String(s)))
      .filter(Boolean)
      .join('・') || '—';
  const teacherName = entry.teacher?.display_name || entry.teacher?.email || '—';
  const slotLabel = timeSlot
    ? `${timeSlot.slot_number}限 ${timeSlot.start_time?.slice(0, 5) ?? ''}-${timeSlot.end_time?.slice(0, 5) ?? ''}`
    : '—';

  const isTransferredOut = entry.status === 'transferred_out';
  const isTransferredIn = entry.status === 'transferred_in';
  const isCancelled = entry.status === 'cancelled';
  const canAct = !isTransferredOut && !isCancelled;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md bg-white border border-gray-200">
        <DialogHeader>
          <DialogTitle>授業の操作</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="text-sm">
            <div>
              生徒:{' '}
              {onStudentClick ? (
                <button
                  type="button"
                  onClick={onStudentClick}
                  className="text-[var(--primary)] hover:underline font-medium cursor-pointer border-0 bg-transparent p-0"
                >
                  {studentName}
                </button>
              ) : (
                studentName
              )}
            </div>
            <div>
              日時: {formatDay(entry.entry_date)} {slotLabel}
            </div>
            <div>
              講師:{' '}
              {onTeacherClick ? (
                <button
                  type="button"
                  onClick={onTeacherClick}
                  className="text-[var(--primary)] hover:underline font-medium cursor-pointer border-0 bg-transparent p-0"
                >
                  {teacherName}
                </button>
              ) : (
                teacherName
              )}
            </div>
            <div>科目: {subjectNames}</div>
          </div>

          {isTransferredIn && onRevertTransfer && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRevertTransfer()}
                className="border-[var(--primary)] text-[var(--primary)] hover:bg-[var(--primary-subtle)]"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                通常の授業に戻す
              </Button>
            </div>
          )}
          {/* 見込み客（体験）は振替・出欠・編集の対象外。取消のみ許可する。 */}
          {canAct && isInquiry && (
            <>
              <p className="text-xs text-[var(--paragraph)]">
                問合せ名簿の見込み客（未入会）の体験です。振替・出欠・編集の対象外です。
              </p>
              <div className="border-t border-[var(--surface)] pt-2 flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-[#c62828] hover:bg-red-50"
                  onClick={() => onDelete()}
                >
                  <Trash2 className="h-3 w-3 mr-2" />
                  取消
                </Button>
              </div>
            </>
          )}
          {canAct && !isInquiry && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onTransfer()}
                  className="border-[#1e3a5f] text-[#1e3a5f] hover:bg-[#1e3a5f]/10"
                >
                  <Calendar className="h-4 w-4 mr-2" />
                  振替する
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onAbsent()}
                  className="bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  欠席にする
                </Button>
                {/* §2.12 入れ替え: 個別タブ・通常モードのときだけ親が onSwap を渡す */}
                {onSwap && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onSwap()}
                    className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                  >
                    <ArrowLeftRight className="h-4 w-4 mr-2" />
                    入れ替え
                  </Button>
                )}
              </div>

              <div className="border-t border-[var(--surface)] pt-2 flex gap-2">
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => onEdit()}>
                  <Pencil className="h-3 w-3 mr-2" />
                  編集
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-[#c62828] hover:bg-red-50"
                  onClick={() => onDelete()}
                >
                  <Trash2 className="h-3 w-3 mr-2" />
                  削除
                </Button>
              </div>
            </>
          )}
          {(isTransferredOut || isCancelled) && (
            <p className="text-sm text-[var(--paragraph)]">
              {isCancelled ? '取消済み' : '振替元のため操作できません'}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
