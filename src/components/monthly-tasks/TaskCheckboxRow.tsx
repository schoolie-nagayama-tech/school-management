'use client';

import { useState, useRef, useEffect } from 'react';
import type { MonthlyTaskWithChecks, School } from '@/types/database';
import { MessageSquare, Link2, Trash2, Check } from 'lucide-react';
import Link from 'next/link';

interface TaskCheckboxRowProps {
  task: MonthlyTaskWithChecks;
  schools: School[];
  canEdit: boolean;
  onToggleCheck: (taskId: string, schoolId: string, isCompleted: boolean) => void;
  onUpdateTask: (taskId: string, updates: Record<string, unknown>) => void;
  onDeleteTask: (taskId: string) => void;
  onUpdateNote: (taskId: string, note: string | null) => void;
}

export function TaskCheckboxRow({
  task,
  schools,
  canEdit,
  onToggleCheck,
  onUpdateTask,
  onDeleteTask,
  onUpdateNote,
}: TaskCheckboxRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(task.task_name);
  const [showNote, setShowNote] = useState(false);
  const [noteValue, setNoteValue] = useState(task.note || '');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const editRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const allDone = schools.every((s) => {
    const check = task.checks.find((c) => c.school_id === s.id);
    return check?.is_completed;
  });

  useEffect(() => {
    if (isEditing) editRef.current?.focus();
  }, [isEditing]);

  useEffect(() => {
    if (showNote) noteRef.current?.focus();
  }, [showNote]);

  const handleEditSubmit = () => {
    if (editValue.trim() && editValue !== task.task_name) {
      onUpdateTask(task.id, { task_name: editValue.trim() });
    }
    setIsEditing(false);
  };

  const handleNoteSubmit = () => {
    const val = noteValue.trim() || null;
    if (val !== task.note) {
      onUpdateNote(task.id, val);
    }
    setShowNote(false);
  };

  return (
    <div
      className={`group flex items-center gap-1.5 py-1 px-1 rounded text-xs transition-colors hover:bg-gray-50 ${
        allDone ? 'opacity-50' : ''
      }`}
    >
      {/* タスク名 */}
      <div className="flex-1 min-w-0 flex items-center gap-1">
        {isEditing && canEdit ? (
          <input
            ref={editRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleEditSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleEditSubmit();
              if (e.key === 'Escape') { setEditValue(task.task_name); setIsEditing(false); }
            }}
            className="flex-1 px-1 py-0.5 border rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
          />
        ) : (
          <span
            className={`truncate cursor-default ${allDone ? 'line-through text-gray-400' : ''}`}
            onDoubleClick={() => canEdit && setIsEditing(true)}
            title={task.task_name}
          >
            {task.task_name}
          </span>
        )}

        {/* 講習連携アイコン */}
        {task.linked_schedule_task_id && (
          <Link
            href="/courses/schedule"
            className="text-purple-400 hover:text-purple-600 flex-shrink-0"
            title="講習スケジュール連携"
          >
            <Link2 className="w-3 h-3" />
          </Link>
        )}

        {/* 補足アイコン */}
        <button
          onClick={() => setShowNote(!showNote)}
          className={`flex-shrink-0 ${
            task.note ? 'text-amber-500' : 'text-gray-300 opacity-0 group-hover:opacity-100'
          } hover:text-amber-600 transition-opacity`}
          title={task.note || '補足を追加'}
        >
          <MessageSquare className="w-3 h-3" />
        </button>

        {/* 削除 */}
        {canEdit && !task.linked_schedule_task_id && (
          <>
            {showDeleteConfirm ? (
              <button
                onClick={() => { onDeleteTask(task.id); setShowDeleteConfirm(false); }}
                className="flex-shrink-0 text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity text-[10px]"
              >
                削除
              </button>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex-shrink-0 text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </>
        )}
      </div>

      {/* 教室チェックボックス */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {schools.map((school) => {
          const check = task.checks.find((c) => c.school_id === school.id);
          const isChecked = check?.is_completed ?? false;
          const label = school.name.slice(0, 2);
          return (
            <button
              key={school.id}
              onClick={() => canEdit && onToggleCheck(task.id, school.id, !isChecked)}
              disabled={!canEdit}
              className={`w-7 h-6 flex items-center justify-center rounded text-[10px] font-medium transition-colors ${
                isChecked
                  ? 'bg-green-100 text-green-700 border border-green-300'
                  : 'bg-white text-gray-400 border border-gray-200 hover:border-gray-300'
              } ${canEdit ? 'cursor-pointer' : 'cursor-default'}`}
              title={`${school.name}: ${isChecked ? '完了' : '未完了'}`}
            >
              {isChecked ? <Check className="w-3 h-3" /> : label.slice(0, 1)}
            </button>
          );
        })}
      </div>

      {/* 補足ポップオーバー */}
      {showNote && (
        <div className="absolute z-10 mt-1 right-0 top-full bg-white border border-gray-200 rounded-lg shadow-lg p-2 w-56">
          <textarea
            ref={noteRef}
            value={noteValue}
            onChange={(e) => setNoteValue(e.target.value)}
            placeholder="補足メモ..."
            className="w-full text-xs border rounded p-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-blue-300"
            rows={3}
            readOnly={!canEdit}
          />
          <div className="flex justify-end gap-1 mt-1">
            <button
              onClick={() => setShowNote(false)}
              className="text-[10px] px-2 py-0.5 text-gray-500 hover:text-gray-700"
            >
              閉じる
            </button>
            {canEdit && (
              <button
                onClick={handleNoteSubmit}
                className="text-[10px] px-2 py-0.5 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                保存
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
