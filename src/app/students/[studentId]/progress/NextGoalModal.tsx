'use client';

import { useState } from 'react';
import { createStudentTextbookExam, updateStudentTextbookExam } from '@/lib/api/progress';
import { copyActionGoalsFromExam } from '@/lib/api/action-goals';
import type { SubjectColumn } from './newProgress.shared';
import type { ExamType, StudentTextbookExam } from '@/types/database';

/**
 * 「次の目標へ」モーダル
 * 試験が終わった後の一連の流れ（振り返り → 次の目標作成 → 行動目標の引き継ぎ）を
 * 1つのフローでまとめて実行する。ExamGoalEditModal の新規作成部分の入力仕様・バリデーションを踏襲。
 *
 * 目標の親は「生徒×科目」（studentId + subjectKey）。同科目の全テキストが対象になる。
 */
export function NextGoalModal({
  studentId,
  subjectKey,
  prevExam,
  prevExamName,
  examTypes,
  onClose,
  onSaved,
  toastError,
}: {
  studentId: string;
  subjectKey: SubjectColumn;
  prevExam: StudentTextbookExam;
  prevExamName: string;
  examTypes: ExamType[];
  onClose: () => void;
  onSaved: () => void;
  toastError: (m: string) => void;
}) {
  // A. 前回の振り返り（結果点数は任意。既存値があれば初期表示する）
  const [resultScore, setResultScore] = useState<string>(
    prevExam.result_score != null ? String(prevExam.result_score) : ''
  );

  // B. 次の目標（ExamGoalEditModal の新規作成と同じ3項目）
  const [examTypeId, setExamTypeId] = useState<string>('');
  const [customName, setCustomName] = useState<string>('');
  const [examDate, setExamDate] = useState<string>('');
  const [targetScore, setTargetScore] = useState<string>('');

  // C. 引き継ぎ（既定ON）
  const [carryOverGoals, setCarryOverGoals] = useState(true);

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
      // 1. 前回試験の結果点数を保存（未入力なら送らない。ただし既存値をクリアした場合は null で更新する）
      const trimmedResult = resultScore.trim();
      if (trimmedResult !== '') {
        await updateStudentTextbookExam(prevExam.id, { result_score: Number(trimmedResult) });
      } else if (prevExam.result_score != null) {
        await updateStudentTextbookExam(prevExam.id, { result_score: null });
      }

      // 2. 次の目標を作成
      const nextExam = await createStudentTextbookExam({
        student_id: studentId,
        subject_key: subjectKey,
        exam_type_id: examTypeId || null,
        custom_exam_name: examTypeId ? null : customName.trim() || null,
        exam_date: examDate,
        target_score: targetScore === '' ? null : Number(targetScore),
      });

      // 3. チェックがONなら前回の行動目標を引き継ぐ（達成状況・回数はリセットされる）
      if (carryOverGoals) {
        await copyActionGoalsFromExam(prevExam.id, nextExam.id);
      }

      onSaved();
    } catch (e) {
      console.error(e);
      toastError('保存に失敗しました');
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
            <h2 className="font-bold text-[#1f2937] text-lg">次の目標へ</h2>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded hover:bg-[#f3f4f6] text-[#6b7280] transition-[color] duration-150 ease-out active:scale-[0.97]"
            >
              ✕
            </button>
          </header>
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* A. 前回の振り返り */}
            <section>
              <h3 className="text-xs font-bold text-[#6b7280] uppercase mb-2">前回の振り返り</h3>
              <div className="bg-[#f9fafb] border border-[#e5e7eb] rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-[#1f2937]">{prevExamName}</span>
                  <span className="text-[#6b7280]">{prevExam.exam_date}</span>
                </div>
                <div className="text-[11px] text-[#6b7280]">
                  目標点 {prevExam.target_score ?? '—'}
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#6b7280] mb-1">
                    結果（点数）
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={resultScore}
                    onChange={(e) => setResultScore(e.target.value)}
                    placeholder="75"
                    className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white"
                  />
                </div>
              </div>
            </section>

            {/* B. 次の目標 */}
            <section>
              <h3 className="text-xs font-bold text-[#6b7280] uppercase mb-2">次の目標</h3>
              <div className="space-y-3">
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
                    <label className="block text-xs font-medium text-[#6b7280] mb-1">
                      試験日 *
                    </label>
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
            </section>

            {/* C. 引き継ぎ */}
            <section>
              <label className="flex items-center gap-2 text-sm text-[#1f2937] cursor-pointer">
                <input
                  type="checkbox"
                  checked={carryOverGoals}
                  onChange={(e) => setCarryOverGoals(e.target.checked)}
                  className="w-4 h-4 rounded border-[#e5e7eb]"
                />
                前回の行動目標を引き継ぐ（達成状況・回数はリセット）
              </label>
            </section>
          </div>
          <footer className="px-6 py-4 border-t border-[#e5e7eb] flex items-center justify-end gap-2 bg-[#f9fafb]">
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
              {saving ? '保存中...' : '次の目標を作成'}
            </button>
          </footer>
        </div>
      </div>
    </>
  );
}
