'use client';

import { useState, useEffect, useCallback } from 'react';
import { StudentInterview, InterviewType, INTERVIEW_TYPE_LABELS, INTERVIEW_TYPE_COLORS } from '@/types/database';
import { getStudentInterviews, deleteInterview, completeTask, uncompleteTask } from '@/lib/api/interviews';
import { InterviewModal } from './InterviewModal';
import { Button, Select } from '@/components/ui';
import { useToast } from '@/hooks/useToast';

interface InterviewListProps {
  studentId: string;
  schoolId: string;
}

export function InterviewList({ studentId, schoolId }: InterviewListProps) {
  const [interviews, setInterviews] = useState<StudentInterview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingInterview, setEditingInterview] = useState<StudentInterview | null>(null);
  const [filterType, setFilterType] = useState<InterviewType | 'all'>('all');
  const { success, error: toastError } = useToast();

  // データ取得
  const fetchInterviews = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getStudentInterviews(studentId);
      setInterviews(data);
    } catch (error) {
      console.error('Failed to fetch interviews:', error);
      toastError('面談記録の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [studentId, toastError]);

  useEffect(() => {
    if (studentId) {
      fetchInterviews();
    }
  }, [studentId, fetchInterviews]);

  // フィルター適用
  const filteredInterviews = filterType === 'all'
    ? interviews
    : interviews.filter(i => i.interview_type === filterType);

  // 日付でグループ化
  const groupedByDate = filteredInterviews.reduce((acc, interview) => {
    const date = interview.interview_date;
    if (!acc[date]) acc[date] = [];
    acc[date].push(interview);
    return acc;
  }, {} as Record<string, StudentInterview[]>);

  // 削除処理
  const handleDelete = async (id: string) => {
    if (!window.confirm('この記録を削除しますか？')) return;
    
    try {
      await deleteInterview(id);
      success('削除しました');
      fetchInterviews();
    } catch (error) {
      console.error('Failed to delete:', error);
      toastError('削除に失敗しました');
    }
  };

  // 編集モーダルを開く
  const handleEdit = (interview: StudentInterview) => {
    setEditingInterview(interview);
    setIsModalOpen(true);
  };

  // 新規追加モーダルを開く
  const handleAdd = () => {
    setEditingInterview(null);
    setIsModalOpen(true);
  };

  // モーダルを閉じる
  const handleModalClose = () => {
    setIsModalOpen(false);
    setEditingInterview(null);
  };

  // 保存完了後
  const handleSaved = () => {
    handleModalClose();
    fetchInterviews();
  };

  // 日付フォーマット
  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
    return `${year}/${month}/${day}（${dayOfWeek}）`;
  };

  if (isLoading) {
    return <div className="p-4 text-center text-[#2a2a2a]">読み込み中...</div>;
  }

  return (
    <div>
      {/* ヘッダー */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-[#0d0d0d]">面談記録</h3>
        <Button onClick={handleAdd} size="sm">+ 記録を追加</Button>
      </div>

      {/* フィルター */}
      <div className="mb-4">
        <Select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as InterviewType | 'all')}
          options={[
            { value: 'all', label: 'すべて' },
            ...Object.entries(INTERVIEW_TYPE_LABELS).map(([key, label]) => ({
              value: key,
              label,
            })),
          ]}
          className="w-48"
        />
      </div>

      {/* 記録一覧 */}
      {filteredInterviews.length === 0 ? (
        <div className="text-center py-12 bg-[#eff0f3] rounded-lg border border-[#0d0d0d]">
          <p className="text-[#2a2a2a] mb-4">まだ面談記録がありません</p>
          <Button onClick={handleAdd}>+ 最初の記録を追加</Button>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedByDate)
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([date, dateInterviews]) => (
              <div key={date}>
                <div className="text-sm font-medium text-[#2a2a2a] mb-2">
                  {formatDate(date)}
                </div>
                <div className="space-y-3">
                  {dateInterviews.map((interview) => (
                    <div
                      key={interview.id}
                      className={`bg-[#fffffe] border border-[#0d0d0d] rounded-lg p-4 ${
                        interview.interview_type === 'task' && interview.is_completed
                          ? 'opacity-50'
                          : ''
                      }`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          {/* タスクの場合は完了チェックボックスを表示 */}
                          {interview.interview_type === 'task' && (
                            <input
                              type="checkbox"
                              checked={interview.is_completed || false}
                              onChange={async (e) => {
                                try {
                                  if (e.target.checked) {
                                    await completeTask(interview.id);
                                    success('タスクを完了しました');
                                  } else {
                                    await uncompleteTask(interview.id);
                                    success('タスクを未完了に戻しました');
                                  }
                                  fetchInterviews();
                                } catch (error) {
                                  console.error('Failed to update task:', error);
                                  toastError('更新に失敗しました');
                                }
                              }}
                              className="w-5 h-5 rounded border-[#0d0d0d] text-[#ff8e3c] focus:ring-[#ff8e3c] cursor-pointer"
                            />
                          )}
                          <span
                            className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                              INTERVIEW_TYPE_COLORS[interview.interview_type]
                            }`}
                          >
                            {INTERVIEW_TYPE_LABELS[interview.interview_type]}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleEdit(interview)}
                            className="text-sm text-[#2a2a2a] hover:text-[#ff8e3c] transition-colors"
                          >
                            編集
                          </button>
                          <button
                            onClick={() => handleDelete(interview.id)}
                            className="text-sm text-[#d9376e] hover:text-[#d9376e]/80 transition-colors"
                          >
                            削除
                          </button>
                        </div>
                      </div>
                      <p className={`text-[#0d0d0d] whitespace-pre-wrap text-sm leading-relaxed ${
                        interview.interview_type === 'task' && interview.is_completed
                          ? 'line-through'
                          : ''
                      }`}>
                        {interview.content}
                      </p>
                      {/* 完了日時表示（タスクの場合） */}
                      {interview.interview_type === 'task' && interview.is_completed && interview.completed_at && (
                        <p className="text-xs text-[#2a2a2a]/60 mt-2">
                          完了: {new Date(interview.completed_at).toLocaleString('ja-JP')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}

      {/* モーダル */}
      {isModalOpen && (
        <InterviewModal
          studentId={studentId}
          schoolId={schoolId}
          interview={editingInterview}
          onClose={handleModalClose}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
