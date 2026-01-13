'use client';

import { useState, useEffect } from 'react';
import { StudentInterview } from '@/types/database';
import { getPendingTasks, completeTask } from '@/lib/api/interviews';
import { useToast } from '@/hooks/useToast';
import { getDefaultSchoolId } from '@/lib/api/schools';

interface TaskWithStudent extends StudentInterview {
  student: { last_name: string; first_name: string };
}

interface TaskAlertProps {
  schoolId?: string;
  onTaskClick?: (studentId: string) => void;
}

export function TaskAlert({ schoolId, onTaskClick }: TaskAlertProps) {
  const [tasks, setTasks] = useState<TaskWithStudent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const { success, error: toastError } = useToast();
  const targetSchoolId = schoolId || getDefaultSchoolId();

  // タスク取得
  const fetchTasks = async () => {
    setIsLoading(true);
    try {
      const data = await getPendingTasks(targetSchoolId);
      setTasks(data);
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
      toastError('未完了タスクの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
    // 定期的に更新（30秒ごと）
    const interval = setInterval(fetchTasks, 30000);
    return () => clearInterval(interval);
  }, [targetSchoolId]);

  // タスク完了処理
  const handleComplete = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await completeTask(taskId);
      success('タスクを完了しました');
      fetchTasks();
    } catch (error) {
      console.error('Failed to complete task:', error);
      toastError(
        error instanceof Error ? error.message : 'タスクの完了に失敗しました'
      );
    }
  };

  // 日付フォーマット
  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}/${day}`;
  };

  // 期限チェック（今日以前なら期限切れ）
  const isOverdue = (dateStr: string): boolean => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const taskDate = new Date(dateStr);
    taskDate.setHours(0, 0, 0, 0);
    return taskDate < today;
  };

  if (isLoading || tasks.length === 0) {
    return null;
  }

  return (
    <div className="mb-6 bg-[#d9376e]/10 border border-[#d9376e] rounded-lg overflow-hidden">
      {/* ヘッダー（クリックで展開/折りたたみ） */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-[#d9376e]/20 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-[#d9376e] text-xl">⚠️</span>
          <span className="font-medium text-[#d9376e]">
            未完了のタスクが {tasks.length} 件あります
          </span>
        </div>
        <span className="text-[#d9376e]/60">
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {/* タスクリスト（展開時） */}
      {expanded && (
        <div className="border-t border-[#d9376e] divide-y divide-[#d9376e]/20">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="px-4 py-3 flex items-start justify-between gap-4 hover:bg-[#d9376e]/10 cursor-pointer transition-colors"
              onClick={() => onTaskClick?.(task.student_id)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {/* 期限 */}
                  <span
                    className={`text-sm font-medium ${
                      isOverdue(task.interview_date)
                        ? 'text-[#d9376e]'
                        : 'text-[#2a2a2a]'
                    }`}
                  >
                    {formatDate(task.interview_date)}
                    {isOverdue(task.interview_date) && ' (期限切れ)'}
                  </span>
                  {/* 生徒名 */}
                  <span className="text-sm text-[#0d0d0d] font-medium">
                    {task.student.last_name} {task.student.first_name}
                  </span>
                </div>
                {/* 内容 */}
                <p className="text-sm text-[#2a2a2a] line-clamp-2">
                  {task.content}
                </p>
              </div>
              {/* 完了ボタン */}
              <button
                onClick={(e) => handleComplete(task.id, e)}
                className="px-3 py-1 bg-[#fffffe] border border-[#d9376e] text-[#d9376e] text-sm rounded hover:bg-[#d9376e] hover:text-white transition-colors whitespace-nowrap"
              >
                完了
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
