'use client';

import { useMemo, useState } from 'react';
import { Button, Modal, Select } from '@/components/ui';
import {
  ASSESSMENT_NAME_OPTIONS,
  GRADE_LABELS,
  SUBJECT_CODES,
  SUBJECT_LABELS,
} from '@/types/database';
import type { SubmittableScoreCategory } from '@/types/portal-scores';

/**
 * 成績入力モーダル — 保護者側（§7-5）。
 *
 * ★ 保護者にもタイピング最小化を適用（§7-5・グローバル方針）: 自由入力は一切なし。
 *   カテゴリ・テスト名・学年は選択式、科目別点数だけが数値入力（inputMode="numeric"）。
 *
 * ★ 模試は入力対象外（§7-5 三本柱の1）。カテゴリの選択肢は定期テスト／内申の2択のみ。
 *
 * ★ エラー表示はサーバーの文言をそのまま出す（§実装指示）: レンジ・未知科目キーなどの
 *   検証はサーバー（POST /api/mypage/scores の入口）が行う。ここでの制約（min/max・
 *   送信ボタンの活性化条件）はUXのためのガードであり、独自の検証メッセージは持たない。
 */

const CATEGORY_OPTIONS: { value: SubmittableScoreCategory; label: string }[] = [
  { value: 'regular_test', label: '定期テスト' },
  { value: 'report_card', label: '内申' },
];

/** 学年の選択肢（既存の管理画面「行を追加」と同じ範囲＝中1〜高3）。 */
const GRADE_OPTIONS = [7, 8, 9, 10, 11, 12];

/** 科目別点数の入力欄（COMMON_9_SUBJECTS＝5教科＋実技4科）。
 *  高校生の動的科目マスタ（src/components/scores/ScoreTable.tsx参照）はここでは扱わない。 */
const SCORE_SUBJECTS = [
  SUBJECT_CODES.ENGLISH,
  SUBJECT_CODES.MATH,
  SUBJECT_CODES.JAPANESE,
  SUBJECT_CODES.SOCIAL,
  SUBJECT_CODES.SCIENCE,
  SUBJECT_CODES.MUSIC,
  SUBJECT_CODES.ART,
  SUBJECT_CODES.TECH_HOME,
  SUBJECT_CODES.PE,
] as const;

export function ScoreSubmitModal({
  studentId,
  defaultGrade,
  onClose,
  onSubmitted,
}: {
  studentId: string;
  /** 生徒の現在の学年。選択肢に含まれればプリフィルする。 */
  defaultGrade: number | null;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [category, setCategory] = useState<SubmittableScoreCategory>('regular_test');
  const [nameCode, setNameCode] = useState('');
  const [grade, setGrade] = useState<number>(
    defaultGrade != null && GRADE_OPTIONS.includes(defaultGrade) ? defaultGrade : GRADE_OPTIONS[0]
  );
  const [examMonth, setExamMonth] = useState('');
  const [scores, setScores] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const nameOptions = ASSESSMENT_NAME_OPTIONS[category];
  const isReportCard = category === 'report_card';
  const scoreRange = isReportCard ? { min: 1, max: 5 } : { min: 0, max: 100 };

  // カテゴリを切り替えたらテスト名の選択をリセット（内申⇔定期テストで選択肢が違うため）。
  const handleCategoryChange = (next: SubmittableScoreCategory) => {
    setCategory(next);
    setNameCode('');
  };

  // 空欄の科目は送信しない（未申請の科目として扱われ、承認側の「申請科目だけ上書き」に合流する）。
  const filledScores = useMemo(() => {
    const out: Record<string, number> = {};
    for (const code of SCORE_SUBJECTS) {
      const raw = scores[code];
      if (raw == null || raw.trim() === '') continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      out[code] = n;
    }
    return out;
  }, [scores]);

  const canSubmit = !!nameCode && Object.keys(filledScores).length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/mypage/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: studentId,
          category,
          grade,
          name_code: nameCode,
          exam_month: isReportCard ? null : examMonth || null,
          scores: filledScores,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? '送信に失敗しました');
        return;
      }
      onSubmitted();
    } catch {
      setError('通信に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="成績を入力" size="md">
      <div className="space-y-4">
        {/* カテゴリ（2択のピル） */}
        <div>
          <label className="mb-1 block text-sm font-medium text-text-heading">カテゴリ</label>
          <div className="flex gap-2">
            {CATEGORY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleCategoryChange(opt.value)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                  category === opt.value
                    ? 'border-text-heading bg-text-heading text-surface-raised'
                    : 'border-border bg-surface-raised text-text-body hover:bg-surface-hover'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <Select
          label="テスト名"
          value={nameCode}
          onChange={(e) => setNameCode(e.target.value)}
          options={nameOptions.map((o) => ({ value: o.code, label: o.label }))}
          placeholder="選択してください"
          required
        />

        <Select
          label="学年"
          value={grade}
          onChange={(e) => setGrade(Number(e.target.value))}
          options={GRADE_OPTIONS.map((g) => ({ value: g, label: GRADE_LABELS[g] ?? `${g}` }))}
        />

        {/* 実施年月（内申は学期単位のため出さない） */}
        {!isReportCard && (
          <div>
            <label className="mb-1 block text-sm font-medium text-text-heading">
              実施年月（任意）
            </label>
            <input
              type="month"
              value={examMonth}
              onChange={(e) => setExamMonth(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text-body transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        )}

        {/* 科目別点数（入力した科目だけ送信） */}
        <div>
          <label className="mb-1 block text-sm font-medium text-text-heading">
            科目別点数（{isReportCard ? '1〜5' : '0〜100'}）
          </label>
          <p className="mb-2 text-[11px] text-text-muted">入力した科目だけが送信されます</p>
          <div className="grid grid-cols-3 gap-2">
            {SCORE_SUBJECTS.map((code) => (
              <div key={code}>
                <label className="mb-0.5 block text-[11px] text-text-muted">
                  {SUBJECT_LABELS[code]}
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={scoreRange.min}
                  max={scoreRange.max}
                  value={scores[code] ?? ''}
                  onChange={(e) => setScores((prev) => ({ ...prev, [code]: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-center text-sm text-text-body transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-danger bg-danger/10 p-3 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            キャンセル
          </Button>
          <Button onClick={submit} isLoading={submitting} disabled={!canSubmit}>
            送信する
          </Button>
        </div>
      </div>
    </Modal>
  );
}
