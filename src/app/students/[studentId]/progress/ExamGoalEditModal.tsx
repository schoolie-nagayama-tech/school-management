'use client';

import { useState } from 'react';
import {
  createStudentTextbookExam,
  updateStudentTextbookExam,
  deleteStudentTextbookExam,
} from '@/lib/api/progress';
import type { ExamType, StudentTextbookExam } from '@/types/database';

/**
 * 目標設定 編集/新規作成モーダル
 * - 試験名（exam_types マスタから選択 or 自由入力）
 * - 試験日 / 目標点
 * - 削除（編集時のみ）
 */
export function ExamGoalEditModal({
  textbookId,
  examTypes,
  editing,
  onClose,
  onSaved,
  onDeleted,
  toastError,
}: {
  textbookId: string;
  examTypes: ExamType[];
  editing: StudentTextbookExam | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  toastError: (m: string) => void;
}) {
  const [examTypeId, setExamTypeId] = useState<string>(editing?.exam_type_id ?? '');
  const [customName, setCustomName] = useState<string>(editing?.custom_exam_name ?? '');
  const [examDate, setExamDate] = useState<string>(editing?.exam_date ?? '');
  const [targetScore, setTargetScore] = useState<string>(
    editing?.target_score != null ? String(editing.target_score) : ''
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!examDate) {
      toastError('試験日を入力してください');
      return;
    }
    if (!examTypeId && !customName.trim()) {
      toastError('試験名を選択または入力してください');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        student_textbook_id: textbookId,
        exam_type_id: examTypeId || null,
        custom_exam_name: examTypeId ? null : customName.trim() || null,
        exam_date: examDate,
        target_score: targetScore === '' ? null : Number(targetScore),
      };
      if (editing) {
        await updateStudentTextbookExam(editing.id, payload);
      } else {
        await createStudentTextbookExam(payload);
      }
      onSaved();
    } catch (e) {
      console.error(e);
      toastError('保存に失敗しました');
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    if (!window.confirm('この目標を削除しますか？関連する行動目標も一緒に削除されます。')) return;
    setSaving(true);
    try {
      await deleteStudentTextbookExam(editing.id);
      onDeleted();
    } catch (e) {
      console.error(e);
      toastError('削除に失敗しました');
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
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col pointer-events-auto animate-[popover-enter_150ms_cubic-bezier(0.23,1,0.32,1)]">
          <header className="px-6 py-4 border-b border-[#e5e7eb] flex items-center justify-between">
            <h2 className="font-bold text-[#1f2937] text-lg">
              {editing ? '目標を編集' : '目標を設定'}
            </h2>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded hover:bg-[#f3f4f6] text-[#6b7280] transition-[color] duration-150 ease-out active:scale-[0.97]"
            >
              ✕
            </button>
          </header>
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#6b7280] mb-1">
                試験名（マスタから選択）
              </label>
              <select
                value={examTypeId}
                onChange={(e) => {
                  setExamTypeId(e.target.value);
                  if (e.target.value) setCustomName('');
                }}
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white"
              >
                <option value="">（マスタから選択）</option>
                {examTypes.map((et) => (
                  <option key={et.id} value={et.id}>
                    {et.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6b7280] mb-1">
                または 試験名を自由入力
              </label>
              <input
                type="text"
                value={customName}
                onChange={(e) => {
                  setCustomName(e.target.value);
                  if (e.target.value) setExamTypeId('');
                }}
                placeholder="例: 第1回模試"
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#6b7280] mb-1">試験日 *</label>
                <input
                  type="date"
                  value={examDate}
                  onChange={(e) => setExamDate(e.target.value)}
                  className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6b7280] mb-1">目標点</label>
                <input
                  type="number"
                  min={0}
                  value={targetScore}
                  onChange={(e) => setTargetScore(e.target.value)}
                  placeholder="80"
                  className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm"
                />
              </div>
            </div>
          </div>
          <footer className="px-6 py-4 border-t border-[#e5e7eb] flex items-center justify-between bg-[#f9fafb]">
            {editing ? (
              <button
                onClick={remove}
                disabled={saving}
                className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"
              >
                削除
              </button>
            ) : (
              <div />
            )}
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-sm text-[#4b5563] hover:bg-[#f3f4f6] rounded-lg"
              >
                キャンセル
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-1.5 bg-[#1e3a5f] text-white text-sm font-medium rounded-lg hover:bg-[#2a4d7a] disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}
