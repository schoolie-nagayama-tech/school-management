'use client';

import type { Student, Subject } from '@/types/database';
import { GRADE_LABELS, STATUS_LABELS, STATUS_COLORS } from '@/types/database';

interface StudentTableProps {
  students: (Student & { subjects?: Subject[] })[];
  onEdit: (student: Student) => void;
  onDelete: (student: Student) => void;
  onRowClick?: (student: Student) => void;
  onScores?: (student: Student) => void;
  onInterviews?: (student: Student) => void;
  onProgress?: (student: Student) => void;
  isLoading?: boolean;
}

export function StudentTable({
  students,
  onEdit,
  onDelete,
  onRowClick,
  onScores,
  onInterviews,
  onProgress,
  isLoading = false,
}: StudentTableProps) {
  if (isLoading) {
    return (
      <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-8">
        <div className="flex items-center justify-center">
          <svg
            className="animate-spin h-8 w-8 text-blue-600"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span className="ml-3 text-[#2a2a2a]">読み込み中...</span>
        </div>
      </div>
    );
  }

  if (students.length === 0) {
    return (
      <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-8">
        <div className="text-center">
          <svg
            className="mx-auto h-12 w-12 text-[#2a2a2a]/30"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z"
            />
          </svg>
          <p className="mt-4 text-[#2a2a2a]">生徒が登録されていません</p>
          <p className="text-sm text-[#2a2a2a]/60">
            「新規登録」ボタンから生徒を追加してください
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-[#eff0f3] border-b border-[#0d0d0d]">
              <th className="px-4 py-3 text-left text-xs font-semibold text-[#0d0d0d] uppercase tracking-wider">
                コード
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                氏名
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                フリガナ
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                学年
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                学校名
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                受講科目
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                状況
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {students.map((student) => {
              const subjectNames = student.subjects?.map((s) => s.name).join(', ') || '';
              return (
                <tr
                  key={student.id}
                  className={`transition-colors duration-150 ${
                    onRowClick ? 'cursor-pointer hover:bg-[#eff0f3]' : ''
                  }`}
                  onClick={() => onRowClick?.(student)}
                >
                <td className="px-4 py-3 text-sm font-mono text-[#2a2a2a]">
                  {student.student_code || <span className="text-[#2a2a2a]/30">-</span>}
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm font-medium text-[#0d0d0d]">
                    {student.last_name} {student.first_name}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-[#2a2a2a]">
                  {student.last_name_kana} {student.first_name_kana}
                </td>
                <td className="px-4 py-3 text-sm text-[#2a2a2a]">
                  {GRADE_LABELS[student.grade] || student.grade}
                </td>
                <td className="px-4 py-3 text-sm text-[#2a2a2a]">
                  {student.school_name || <span className="text-[#2a2a2a]/30">-</span>}
                </td>
                <td className="px-4 py-3 text-sm text-[#2a2a2a]">
                  {subjectNames || <span className="text-[#2a2a2a]/30">-</span>}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[student.status]}`}
                  >
                    {STATUS_LABELS[student.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                    {onScores && (
                      <button
                        onClick={() => onScores(student)}
                        className="p-1.5 text-[#2a2a2a] hover:text-[#ff8e3c] hover:bg-[#ff8e3c]/10 rounded-lg transition-colors"
                        title="成績"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                          />
                        </svg>
                      </button>
                    )}
                    {onInterviews && (
                      <button
                        onClick={() => onInterviews(student)}
                        className="p-1.5 text-[#2a2a2a] hover:text-[#0d0d0d] hover:bg-[#0d0d0d]/10 rounded-lg transition-colors"
                        title="面談記録"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                          />
                        </svg>
                      </button>
                    )}
                    {onProgress && (
                      <button
                        onClick={() => onProgress(student)}
                        className="p-1.5 text-[#2a2a2a] hover:text-[#ff8e3c] hover:bg-[#ff8e3c]/10 rounded-lg transition-colors"
                        title="進行表"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                          />
                        </svg>
                      </button>
                    )}
                    <button
                      onClick={() => onEdit(student)}
                      className="p-1.5 text-[#2a2a2a] hover:text-[#ff8e3c] hover:bg-[#ff8e3c]/10 rounded-lg transition-colors"
                      title="編集"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                        />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(student);
                      }}
                      className="p-1.5 text-[#2a2a2a] hover:text-[#d9376e] hover:bg-[#d9376e]/10 rounded-lg transition-colors"
                      title="削除"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      
      {/* フッター：件数表示 */}
      <div className="px-4 py-3 bg-[#eff0f3] border-t border-[#0d0d0d]">
        <p className="text-sm text-[#2a2a2a]">
          全 <span className="font-semibold">{students.length}</span> 件
        </p>
      </div>
    </div>
  );
}
