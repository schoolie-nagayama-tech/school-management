'use client';

import { useState } from 'react';
import {
  createActionGoal,
  updateActionGoal,
  deleteActionGoal,
  copyActionGoalsFromExam,
} from '@/lib/api/action-goals';
import type { ActionGoal, ExamType, StudentTextbookExam } from '@/types/database';
import { ActionGoalRow } from './ActionGoalRow';

// ─────────────────────────────────────────────
// 行動目標セクション
// - 追加: タイトル + 任意カウンター目標
// - チェック: achieved 切替
// - カウンター: current/target を ± で増減
// - 削除: 個別
// - 過去試験から一括コピー: examGoals テンプレから複製
// ─────────────────────────────────────────────
export function ActionGoalsSection({
  examId,
  goals,
  allExams,
  examTypes,
  isMeeting,
  toastError,
  success,
  onChange,
}: {
  examId: string;
  goals: ActionGoal[];
  allExams: StudentTextbookExam[];
  examTypes: ExamType[];
  isMeeting: boolean;
  toastError: (m: string) => void;
  success: (m: string) => void;
  onChange: (next: ActionGoal[]) => void;
}) {
  const [newTitle, setNewTitle] = useState('');
  const [newCounter, setNewCounter] = useState<number | ''>('');
  const [copyOpen, setCopyOpen] = useState(false);

  // 複製元候補: 他の目標設定
  const copySources = allExams.filter((e) => e.id !== examId);

  const add = async () => {
    const title = newTitle.trim();
    if (!title) return;
    try {
      const created = await createActionGoal({
        student_textbook_exam_id: examId,
        title,
        counter_target: newCounter === '' ? null : Number(newCounter),
        counter_current: 0,
        achieved: false,
        sort_order: goals.length,
      });
      onChange([...goals, created]);
      setNewTitle('');
      setNewCounter('');
    } catch (e) {
      console.error(e);
      toastError('行動目標の追加に失敗しました');
    }
  };

  const patch = async (id: string, patchData: Partial<ActionGoal>) => {
    const prevList = goals;
    const optimistic = goals.map((g) => (g.id === id ? ({ ...g, ...patchData } as ActionGoal) : g));
    onChange(optimistic);
    try {
      const updated = await updateActionGoal(id, patchData);
      onChange(optimistic.map((g) => (g.id === id ? updated : g)));
    } catch (e) {
      console.error(e);
      toastError('保存に失敗しました');
      onChange(prevList);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('この行動目標を削除しますか？')) return;
    try {
      await deleteActionGoal(id);
      onChange(goals.filter((g) => g.id !== id));
    } catch (e) {
      console.error(e);
      toastError('削除に失敗しました');
    }
  };

  const copyFrom = async (sourceExamId: string) => {
    setCopyOpen(false);
    try {
      const copied = await copyActionGoalsFromExam(sourceExamId, examId);
      onChange([...goals, ...copied]);
      success(`${copied.length}件の行動目標を複製しました`);
    } catch (e) {
      console.error(e);
      toastError('複製に失敗しました');
    }
  };

  return (
    <div className="pt-3 border-t border-[#1e40af]/15">
      {/* リスト */}
      <div className="space-y-1.5 mb-3">
        {goals.length === 0 ? (
          <div className="text-xs text-[#9ca3af] text-center py-3">
            まだ行動目標がありません。目標達成のための具体的な行動を追加しましょう。
          </div>
        ) : (
          goals.map((g) => (
            <ActionGoalRow
              key={g.id}
              goal={g}
              isMeeting={isMeeting}
              onPatch={(d) => patch(g.id, d)}
              onDelete={() => remove(g.id)}
            />
          ))
        )}
      </div>
      {/* 追加フォーム（面談モードでは非表示） */}
      {!isMeeting && (
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add();
            }}
            placeholder="例: 毎朝英単語50個を覚える"
            className="flex-1 min-w-[200px] px-2 py-1.5 text-sm bg-white border border-[#e5e7eb] rounded focus:outline-none focus:border-[#1e3a5f]"
          />
          <input
            type="number"
            min={0}
            value={newCounter}
            onChange={(e) => setNewCounter(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="回数(任意)"
            className="w-24 px-2 py-1.5 text-sm bg-white border border-[#e5e7eb] rounded focus:outline-none focus:border-[#1e3a5f]"
          />
          <button
            onClick={add}
            disabled={!newTitle.trim()}
            className="px-3 py-1.5 text-xs bg-[#1e3a5f] text-white rounded hover:bg-[#2a4d7a] disabled:bg-[#9ca3af]"
          >
            追加
          </button>
          {copySources.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setCopyOpen((v) => !v)}
                className="px-3 py-1.5 text-xs bg-white border border-[#1e40af]/20 text-[#1e40af] rounded hover:bg-[#eff6ff]"
              >
                過去の目標から複製 ▾
              </button>
              {copyOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setCopyOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-[#e5e7eb] rounded-lg shadow-lg z-20 overflow-hidden origin-top-right animate-[popover-enter_150ms_cubic-bezier(0.23,1,0.32,1)]">
                    {copySources.map((e) => {
                      const name =
                        examTypes.find((t) => t.id === e.exam_type_id)?.name ||
                        e.custom_exam_name ||
                        '試験';
                      return (
                        <button
                          key={e.id}
                          onClick={() => copyFrom(e.id)}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-[#f9fafb] border-b border-[#f3f4f6] last:border-0"
                        >
                          <div className="font-medium text-[#1f2937]">{name}</div>
                          <div className="text-[11px] text-[#6b7280] mt-0.5">
                            {e.exam_date} / 目標{e.target_score ?? '—'}点
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
