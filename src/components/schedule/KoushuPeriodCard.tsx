'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Pencil, Trash2, Plus, Users } from 'lucide-react';
import { Button, Loading } from '@/components/ui';
import type { KoushuCourse, KoushuEnrollment } from '@/lib/api/seasonalCourses';
import type { Subject } from '@/types/database';

const SEASON_LABELS: Record<string, string> = {
  spring: '春期',
  summer: '夏期',
  winter: '冬期',
};

const SEASON_COLORS: Record<string, string> = {
  spring: 'bg-pink-100 text-pink-700',
  summer: 'bg-orange-100 text-orange-700',
  winter: 'bg-blue-100 text-blue-700',
};

function gradeLabel(grade: number): string {
  if (grade <= 6) return `小${grade}`;
  if (grade <= 9) return `中${grade - 6}`;
  return `高${grade - 9}`;
}

interface KoushuPeriodCardProps {
  course: KoushuCourse;
  enrollments: KoushuEnrollment[];
  subjects: Subject[];
  enrollmentsLoading: boolean;
  onEdit: (course: KoushuCourse) => void;
  onDelete: (course: KoushuCourse) => void;
  onAddEnrollment: () => void;
  onEditEnrollment: (enrollment: KoushuEnrollment) => void;
  onDeleteEnrollment: (enrollment: KoushuEnrollment) => void;
  onExpand: () => void;
}

export function KoushuPeriodCard({
  course,
  enrollments,
  subjects,
  enrollmentsLoading,
  onEdit,
  onDelete,
  onAddEnrollment,
  onEditEnrollment,
  onDeleteEnrollment,
  onExpand,
}: KoushuPeriodCardProps) {
  const [expanded, setExpanded] = useState(false);

  const subjectMap = new Map(subjects.map((s) => [s.id, s.name]));

  const toggleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) onExpand();
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
      {/* カードヘッダー */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors duration-150"
        onClick={toggleExpand}
      >
        {/* シーズンバッジ */}
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${
            SEASON_COLORS[course.season] ?? 'bg-gray-100 text-gray-700'
          }`}
        >
          {SEASON_LABELS[course.season] ?? course.season}
        </span>

        {/* 名前 */}
        <span className="font-semibold text-[var(--headline)] flex-1 min-w-0 truncate">
          {course.name}
        </span>

        {/* 期間欄は廃止：講習期間は course_prep_periods で全生徒統一のため、
            コース（テンプレート）個別の期間は意味を持たない。 */}

        {/* 登録人数 */}
        <span className="flex items-center gap-1 text-xs text-[var(--paragraph)] shrink-0">
          <Users className="w-3.5 h-3.5" />
          {course.enrollment_count ?? 0}名
        </span>

        {/* アクションボタン */}
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => onEdit(course)}
            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors duration-150"
            title="編集"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onDelete(course)}
            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors duration-150"
            title="削除"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 展開アイコン */}
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
        )}
      </div>

      {/* 展開: 生徒一覧 */}
      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50">
          {enrollmentsLoading ? (
            <Loading size="md" />
          ) : (
            <>
              {enrollments.length === 0 ? (
                <div className="py-6 text-center text-sm text-[var(--paragraph)]">
                  まだ生徒が登録されていません
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-[var(--paragraph)] border-b border-gray-200">
                        <th className="text-left px-4 py-2 font-medium">生徒名</th>
                        <th className="text-left px-4 py-2 font-medium">学年</th>
                        <th className="text-left px-4 py-2 font-medium">コマ数</th>
                        <th className="text-left px-4 py-2 font-medium">科目</th>
                        <th className="px-4 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {enrollments.map((en) => (
                        <tr
                          key={en.id}
                          className="border-b border-gray-100 last:border-0 hover:bg-white transition-colors duration-150"
                        >
                          <td className="px-4 py-2 font-medium text-[var(--headline)]">
                            {en.student
                              ? `${en.student.last_name} ${en.student.first_name}`
                              : '—'}
                          </td>
                          <td className="px-4 py-2 text-[var(--paragraph)]">
                            {en.student ? gradeLabel(en.student.grade) : '—'}
                          </td>
                          <td className="px-4 py-2 text-[var(--paragraph)]">
                            <span
                              className={`mr-1.5 inline-block px-1.5 py-0.5 rounded text-[10px] font-medium align-middle ${
                                en.formation === 'group'
                                  ? 'bg-accent-ink-subtle text-accent-ink border border-accent-ink/15'
                                  : 'bg-info-subtle text-info border border-info/20'
                              }`}
                            >
                              {en.formation === 'group' ? '集団' : '個別'}
                            </span>
                            <span className="font-semibold text-[var(--headline)]">
                              {en.koma_count}
                            </span>
                            コマ
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex flex-wrap gap-1">
                              {en.subject_ids.length === 0 ? (
                                <span className="text-[var(--paragraph)]">—</span>
                              ) : (
                                en.subject_ids.map((sid) => {
                                  // 科目別コマ数があれば「国語 2」のように表示
                                  const n = en.koma_by_subject?.[sid];
                                  return (
                                    <span
                                      key={sid}
                                      className="text-xs px-1.5 py-0.5 bg-white border border-gray-200 rounded text-[var(--paragraph)]"
                                    >
                                      {subjectMap.get(sid) ?? sid}
                                      {n != null && <span className="ml-1 font-semibold text-[var(--headline)]">{n}</span>}
                                    </span>
                                  );
                                })
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-1 justify-end">
                              <button
                                onClick={() => onEditEnrollment(en)}
                                className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                                title="編集"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => onDeleteEnrollment(en)}
                                className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                                title="削除"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="px-4 py-3">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onAddEnrollment}
                  className="flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  生徒を追加
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
