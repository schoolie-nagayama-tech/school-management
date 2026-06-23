'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  StudentInterview,
  InterviewType,
  INTERVIEW_TYPE_LABELS,
  INTERVIEW_TYPE_COLORS,
} from '@/types/database';
import {
  getStudentInterviews,
  deleteInterview,
  completeTask,
  uncompleteTask,
} from '@/lib/api/interviews';
import { undismissAlert } from '@/lib/api/alerts';
import { InterviewModal } from './InterviewModal';
import { ImportNottaModal } from './ImportNottaModal';
import { Button, Select, Loading } from '@/components/ui';
import { Mic } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/hooks/useConfirm';

interface InterviewListProps {
  studentId: string;
  schoolId: string;
}

export function InterviewList({ studentId, schoolId }: InterviewListProps) {
  const { confirm, ConfirmDialog } = useConfirm();
  const [interviews, setInterviews] = useState<StudentInterview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isNottaModalOpen, setIsNottaModalOpen] = useState(false);
  const [editingInterview, setEditingInterview] = useState<StudentInterview | null>(null);
  const [filterType, setFilterType] = useState<InterviewType | 'all'>('all');
  const { success, error: toastError } = useToast();
  const { permissions } = useAuth();

  // 編集権限チェック（講師は編集・削除不可）
  const canEdit = permissions?.canEditInterviews ?? false;

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
  const filteredInterviews =
    filterType === 'all' ? interviews : interviews.filter((i) => i.interview_type === filterType);

  // 日付でグループ化
  const groupedByDate = filteredInterviews.reduce(
    (acc, interview) => {
      const date = interview.interview_date;
      if (!acc[date]) acc[date] = [];
      acc[date].push(interview);
      return acc;
    },
    {} as Record<string, StudentInterview[]>
  );

  // 削除処理
  const handleDelete = async (id: string) => {
    if (
      !(await confirm({
        title: '削除確認',
        description: 'この記録を削除しますか？',
        confirmLabel: '削除',
        variant: 'danger',
      }))
    )
      return;

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
    return <Loading size="md" />;
  }

  return (
    <div>
      {/* ヘッダー */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-[#1f2937]">面談記録</h3>
        {/* 面談記録の追加は編集権限(canEditInterviews)を持つロールのみ。講師には出さない */}
        {canEdit && (
          <div className="flex items-center gap-2">
            <Button onClick={() => setIsNottaModalOpen(true)} size="sm" variant="secondary">
              <Mic className="w-3.5 h-3.5 mr-1 inline" />
              Nottaから取り込み
            </Button>
            <Button onClick={handleAdd} size="sm">
              + 記録を追加
            </Button>
          </div>
        )}
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
        <div className="text-center py-12 bg-[#f3f4f6] rounded-lg border border-[#e5e7eb]">
          <p className="text-[#4b5563] mb-4">まだ面談記録がありません</p>
          {canEdit && <Button onClick={handleAdd}>+ 最初の記録を追加</Button>}
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedByDate)
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([date, dateInterviews]) => (
              <div key={date}>
                <div className="text-sm font-medium text-[#4b5563] mb-2">{formatDate(date)}</div>
                <div className="space-y-3">
                  {dateInterviews.map((interview) => (
                    <div
                      key={interview.id}
                      className={`bg-white border border-[#e5e7eb] rounded-lg p-4 ${
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
                              disabled={!canEdit}
                              onChange={async (e) => {
                                try {
                                  if (e.target.checked) {
                                    await completeTask(interview.id);
                                    success('タスクを完了しました');
                                  } else {
                                    await uncompleteTask(interview.id);
                                    // 対応済み記録があれば解除してアラートを再表示
                                    try {
                                      await undismissAlert(
                                        schoolId,
                                        studentId,
                                        'interview_task',
                                        `task:${interview.id}`
                                      );
                                    } catch (_) {
                                      // 対応済み記録がない場合は無視
                                    }
                                    success('タスクを未完了に戻しました');
                                  }
                                  fetchInterviews();
                                } catch (error) {
                                  console.error('Failed to update task:', error);
                                  toastError('更新に失敗しました');
                                }
                              }}
                              className="w-5 h-5 rounded border-[#e5e7eb] text-[#3b82f6] focus:ring-[#3b82f6] cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                            />
                          )}
                          <span
                            className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                              INTERVIEW_TYPE_COLORS[interview.interview_type]
                            }`}
                          >
                            {INTERVIEW_TYPE_LABELS[interview.interview_type]}
                          </span>
                          {interview.title && (
                            <span className="text-sm font-medium text-[#1f2937]">
                              {interview.title}
                            </span>
                          )}
                        </div>
                        {canEdit && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleEdit(interview)}
                              className="text-sm text-[#4b5563] hover:text-[#3b82f6] transition-colors duration-150"
                            >
                              編集
                            </button>
                            <button
                              onClick={() => handleDelete(interview.id)}
                              className="text-sm text-[#ef4444] hover:text-[#ef4444]/80 transition-colors duration-150"
                            >
                              削除
                            </button>
                          </div>
                        )}
                      </div>
                      <p
                        className={`text-[#1f2937] whitespace-pre-wrap text-sm leading-relaxed ${
                          interview.interview_type === 'task' && interview.is_completed
                            ? 'line-through'
                            : ''
                        }`}
                      >
                        {interview.content}
                      </p>
                      {/* 完了日時表示（タスクの場合） */}
                      {interview.interview_type === 'task' &&
                        interview.is_completed &&
                        interview.completed_at && (
                          <p className="text-xs text-[#4b5563]/60 mt-2">
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

      {ConfirmDialog}

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

      <ImportNottaModal
        isOpen={isNottaModalOpen}
        onClose={() => setIsNottaModalOpen(false)}
        studentId={studentId}
        schoolId={schoolId}
        onSuccess={() => {
          setIsNottaModalOpen(false);
          fetchInterviews();
          success('Notta文字起こしを面談記録に取り込みました');
        }}
      />
    </div>
  );
}
