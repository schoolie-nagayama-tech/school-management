'use client';

import { Code2, Users } from 'lucide-react';
import { InlineLoading } from '@/components/ui';
import type { Student } from '@/types/database';
import { GRADE_LABELS } from '@/types/database';
import { DAY_OF_WEEK_LABELS } from '@/types/schedule';
import { StatusDot, StudentRowActions, type StudentRow } from './StudentTable';

/**
 * 生徒一覧のモバイル用カード表示（アダプティブ）。
 *
 * 横に広い StudentTable はスマホで操作が窮屈なため、lg 未満では本コンポーネントへ
 * 切り替える（同一ルート・同一データ・同一ハンドラ）。状況ドット/行アクションは
 * StudentTable から再利用し、PC とで挙動・意味配色がズレないようにする。
 * 選択（一括操作）は従来どおりスマホ非対応のため props に含めない。
 */
interface StudentCardListProps {
  students: StudentRow[];
  onEdit?: (student: Student) => void;
  onDelete?: (student: Student) => void;
  onRowClick?: (student: Student) => void;
  onScores?: (student: Student) => void;
  onInterviews?: (student: Student) => void;
  onProgress?: (student: Student) => void;
  onSchedule?: (student: Student) => void;
  isLoading?: boolean;
  /** 講師ロール時は空状態の文言を中立にする（StudentTable と揃える） */
  isTeacher?: boolean;
}

export function StudentCardList({
  students,
  onEdit,
  onDelete,
  onRowClick,
  onScores,
  onInterviews,
  onProgress,
  onSchedule,
  isLoading = false,
  isTeacher = false,
}: StudentCardListProps) {
  if (isLoading) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8">
        <InlineLoading />
      </div>
    );
  }

  if (students.length === 0) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <Users className="mx-auto h-12 w-12 text-text-faint" />
        {isTeacher ? (
          <p className="mt-4 text-text-muted">表示できる生徒がいません</p>
        ) : (
          <>
            <p className="mt-4 text-text-muted">生徒が登録されていません</p>
            <p className="text-sm text-text-faint">「新規登録」ボタンから生徒を追加してください</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {students.map((student) => {
        const schedulePatterns = student.schedulePatterns || [];
        // 週回数: 同じ曜日×コマは週1回として数える（StudentTable と同じ定義）
        const weeklyCount = new Set(
          schedulePatterns.map((p) => `${p.day_of_week}-${p.time_slot_id}`)
        ).size;
        return (
          <div
            key={student.id}
            onClick={() => onRowClick?.(student)}
            className={`rounded-xl border border-border bg-surface-raised p-3.5 transition-[background-color,transform] duration-150 ease-out ${
              onRowClick ? 'cursor-pointer hover:bg-surface-hover active:scale-[0.99]' : ''
            }`}
          >
            {/* 見出し行: 状況ドット・氏名・学年 */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <StatusDot status={student.status} />
                <span className="truncate text-sm font-semibold text-text-heading">
                  {student.last_name} {student.first_name}
                </span>
                {student.is_programming && (
                  <span title="プログラミングコース" aria-label="プログラミングコース">
                    <Code2 className="h-3.5 w-3.5 shrink-0 text-purple-500" />
                  </span>
                )}
                {student.is_sibling && (
                  <span title="兄弟・姉妹あり" aria-label="兄弟・姉妹あり">
                    <Users className="h-3.5 w-3.5 shrink-0 text-teal-500" />
                  </span>
                )}
              </div>
              <span className="shrink-0 rounded-md bg-surface-hover px-2 py-0.5 text-xs font-medium text-text-muted">
                {GRADE_LABELS[student.grade] || student.grade}
              </span>
            </div>

            {/* サブ情報: フリガナ・学校名・週回数 */}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-muted">
              {(student.last_name_kana || student.first_name_kana) && (
                <span className="text-text-faint">
                  {student.last_name_kana} {student.first_name_kana}
                </span>
              )}
              {student.school_name && <span>{student.school_name}</span>}
              {weeklyCount > 0 && <span className="text-text-faint">週{weeklyCount}回</span>}
            </div>

            {/* 通塾日程チップ */}
            {schedulePatterns.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5">
                {schedulePatterns.map((p, i) => (
                  <span key={i} className="inline-flex text-xs">
                    <span className="text-text-faint">{DAY_OF_WEEK_LABELS[p.day_of_week]}</span>
                    {p.subject_names?.[0] && (
                      <span className="ml-0.5 text-info">{p.subject_names[0]}</span>
                    )}
                  </span>
                ))}
              </div>
            )}

            {/* アクション行（StudentTable と同じ導線を再利用） */}
            <div className="mt-2.5 border-t border-border-subtle pt-2.5">
              <StudentRowActions
                student={student}
                onEdit={onEdit}
                onDelete={onDelete}
                onScores={onScores}
                onInterviews={onInterviews}
                onProgress={onProgress}
                onSchedule={onSchedule}
              />
            </div>
          </div>
        );
      })}

      {/* 件数表示（StudentTable のフッターと揃える） */}
      <div className="px-1 py-1">
        <p className="text-sm text-text-muted">
          全 <span className="font-semibold">{students.length}</span> 件
        </p>
      </div>
    </div>
  );
}
