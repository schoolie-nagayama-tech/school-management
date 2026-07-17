'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, ClipboardCheck, PencilLine } from 'lucide-react';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';
import {
  ASSESSMENT_CATEGORY_LABELS,
  ASSESSMENT_NAME_LABELS,
  SUBJECT_CODES,
  SUBJECT_LABELS,
} from '@/types/database';
import { ScoreSubmitModal } from './ScoreSubmitModal';
import type { PortalAssessment, PortalScoreSubmission } from '@/types/portal-scores';

/**
 * 成績（保護者の入力＋閲覧）— 保護者側（§7-5）。
 *
 * 正典: docs/portal-v2-requirements.md §7-5「Stage 5 詳細仕様: 成績の保護者入力＋閲覧」。
 *
 * 構成（既存 /mypage 配下のデザイン言語に合わせる。ReportsView/ScheduleView と同型）:
 *   兄弟切替タブ → 自分の申請の状態（あれば） → 「成績を入力」ボタン →
 *   成績一覧（カテゴリ別・新しい順）。
 *
 * ★ 模試は入力対象外（§7-5 三本柱の1）だが、閲覧はスタッフ入力分も含めて全カテゴリ出す
 *   （「スタッフが入れた成績も保護者に見せる」設計判断）。カテゴリの絞り込みは
 *   一覧側にはかけず、入力できるカテゴリだけをモーダル側（ScoreSubmitModal）で絞る。
 */

/** 兄弟切替に使う生徒（親から渡す）。 */
export interface GradesStudent {
  id: string;
  name: string;
  grade: number | null;
}

/** 科目コードの表示順（5教科＋実技4科＝COMMON_9_SUBJECTS）。未知の科目は末尾に回す。 */
const SUBJECT_ORDER = [
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

export function GradesView({ students }: { students: GradesStudent[] }) {
  const [studentId, setStudentId] = useState<string | null>(students[0]?.id ?? null);
  const [assessments, setAssessments] = useState<PortalAssessment[]>([]);
  const [submissions, setSubmissions] = useState<PortalScoreSubmission[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/mypage/scores?student_id=${encodeURIComponent(studentId)}`);
      const json = await res.json();
      if (res.ok) {
        setAssessments(json.assessments ?? []);
        setSubmissions(json.submissions ?? []);
      } else {
        setAssessments([]);
        setSubmissions([]);
      }
    } catch {
      setAssessments([]);
      setSubmissions([]);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    load();
  }, [load]);

  const activeStudent = students.find((s) => s.id === studentId) ?? null;

  // 申請は新しい順。承認済みも含めて全部出す（§7-5「承認待ち/承認済み/差し戻し」の3状態）。
  const sortedSubmissions = useMemo(
    () => [...submissions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [submissions]
  );

  // カテゴリ別にグルーピングし、各カテゴリ内は新しい順（試験日→実施年月の順で降順比較）。
  const groupedAssessments = useMemo(() => groupAndSort(assessments), [assessments]);

  if (students.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface-raised p-4 text-sm text-text-muted">
        表示できる生徒がいません。教室から届いた招待で生徒を紐づけてください。
      </div>
    );
  }

  return (
    <div>
      {/* 兄弟切替（1人なら出さない） */}
      {students.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {students.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStudentId(s.id)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                s.id === studentId
                  ? 'border-text-heading bg-text-heading font-semibold text-surface-raised'
                  : 'border-border bg-surface-raised text-text-muted'
              }`}
            >
              {s.name}
              {s.grade != null && `（${formatGradeLabel(s.grade)}）`}
            </button>
          ))}
        </div>
      )}

      {/* 自分の申請の状態 */}
      {sortedSubmissions.length > 0 && (
        <section className="mb-3 rounded-xl border border-border-subtle bg-surface-raised px-3.5 py-3">
          <h2 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-text-muted">
            <ClipboardCheck className="h-[14px] w-[14px]" />
            自分の申請の状態
          </h2>
          <ul className="divide-y divide-border-subtle">
            {sortedSubmissions.map((s) => (
              <li key={s.id} className="py-2 first:pt-0 last:pb-0">
                <SubmissionRow submission={s} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 成績を入力ボタン */}
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          disabled={!studentId}
          className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-[13px] font-bold text-surface-raised transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <PencilLine className="h-[14px] w-[14px]" />
          成績を入力
        </button>
      </div>

      {/* 成績一覧 */}
      {loading && assessments.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-raised p-4 text-sm text-text-muted">
          読み込み中…
        </div>
      ) : groupedAssessments.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-raised p-4 text-sm text-text-muted">
          まだ成績はありません。
        </div>
      ) : (
        <div className="space-y-4">
          {groupedAssessments.map((g) => (
            <section key={g.category}>
              <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-text-muted">
                <Award className="h-[14px] w-[14px]" />
                {ASSESSMENT_CATEGORY_LABELS[g.category]}
              </h2>
              <ul className="space-y-2">
                {g.items.map((a) => (
                  <li key={a.id}>
                    <AssessmentCard assessment={a} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {modalOpen && studentId && (
        <ScoreSubmitModal
          studentId={studentId}
          defaultGrade={activeStudent?.grade ?? null}
          onClose={() => setModalOpen(false)}
          onSubmitted={() => {
            setModalOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// 自分の申請1件
// ============================================================

/** 状態バッジの色（装飾に色を使わない・状態のみ）: 承認待ち=warning／承認済み=success／差し戻し=primary。 */
const STATUS_BADGE: Record<PortalScoreSubmission['status'], { label: string; className: string }> =
  {
    submitted: { label: '承認待ち', className: 'bg-warning-subtle text-warning' },
    approved: { label: '承認済み', className: 'bg-success-subtle text-success' },
    rejected: { label: '差し戻し', className: 'bg-primary-subtle text-primary-dark' },
  };

function SubmissionRow({ submission }: { submission: PortalScoreSubmission }) {
  const badge = STATUS_BADGE[submission.status];
  const title = [
    ASSESSMENT_CATEGORY_LABELS[submission.category],
    ASSESSMENT_NAME_LABELS[submission.nameCode] ?? submission.nameCode,
  ].join(' ・ ');

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[13px] font-semibold text-text-heading">{title}</span>
        <span className="text-[11px] text-text-muted">
          {formatGradeLabel(submission.grade)}
          {submission.examMonth && ` ・ ${formatExamMonth(submission.examMonth)}`}
        </span>
        <span className={`rounded-full px-2 py-[1.5px] text-[9.5px] font-bold ${badge.className}`}>
          {badge.label}
        </span>
      </div>
      {/* 差し戻し理由は保護者への返答そのものなので必ず表示する（§7-5）。 */}
      {submission.status === 'rejected' && submission.rejectedReason && (
        <p className="mt-1 rounded-lg bg-primary-subtle px-2.5 py-1.5 text-[12px] text-primary-dark">
          {submission.rejectedReason}
        </p>
      )}
    </div>
  );
}

// ============================================================
// 成績1件のカード
// ============================================================

function AssessmentCard({ assessment }: { assessment: PortalAssessment }) {
  const entries = orderedScoreEntries(assessment.scores);
  const dateLabel = formatExamDate(assessment.examDate) ?? formatExamMonth(assessment.examMonth);

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-raised px-3.5 py-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[13.5px] font-bold text-text-heading">
          {ASSESSMENT_NAME_LABELS[assessment.nameCode] ?? assessment.nameCode}
        </span>
        <span className="text-[11px] text-text-muted">{formatGradeLabel(assessment.grade)}</span>
        {dateLabel && <span className="text-[11px] tabular-nums text-text-muted">{dateLabel}</span>}
      </div>
      {entries.length === 0 ? (
        <p className="text-[12px] text-text-faint">点数の記録はありません</p>
      ) : (
        <div className="grid grid-cols-3 gap-x-2 gap-y-1.5 sm:grid-cols-5">
          {entries.map(({ code, label, value }) => (
            <div key={code}>
              <p className="text-[10.5px] text-text-muted">{label}</p>
              <p className="text-sm font-semibold tabular-nums text-text-body">{value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// ヘルパー
// ============================================================

/** カテゴリごとにグルーピングし、各カテゴリ内を新しい順（試験日→実施年月）に並べる。 */
function groupAndSort(
  assessments: PortalAssessment[]
): { category: PortalAssessment['category']; items: PortalAssessment[] }[] {
  const order: PortalAssessment['category'][] = ['regular_test', 'report_card', 'mock'];
  const map = new Map<PortalAssessment['category'], PortalAssessment[]>();
  for (const a of assessments) {
    if (!map.has(a.category)) map.set(a.category, []);
    map.get(a.category)!.push(a);
  }
  // Map/Set の直接イテレーションは tsconfig の target/downlevelIteration の制約で使えないため
  // forEach で回す（このプロジェクトの既定設定に合わせる）。
  map.forEach((items) => {
    items.sort((a, b) => {
      const aKey = a.examDate ?? a.examMonth ?? '';
      const bKey = b.examDate ?? b.examMonth ?? '';
      if (aKey !== bKey) return bKey.localeCompare(aKey);
      return b.grade - a.grade;
    });
  });
  return order.filter((c) => map.has(c)).map((c) => ({ category: c, items: map.get(c)! }));
}

/** scores（jsonb）を表示順に整列した配列にする。既知の9科目→未知の科目の順。 */
function orderedScoreEntries(
  scores: Record<string, number>
): { code: string; label: string; value: number }[] {
  const known = SUBJECT_ORDER.filter((code) => scores[code] != null).map((code) => ({
    code,
    label: SUBJECT_LABELS[code] ?? code,
    value: scores[code],
  }));
  const rest = Object.keys(scores)
    .filter((code) => !(SUBJECT_ORDER as readonly string[]).includes(code))
    .map((code) => ({ code, label: SUBJECT_LABELS[code] ?? code, value: scores[code] }));
  return [...known, ...rest];
}

/** 'YYYY-MM' → '2026年7月'。null はそのまま null。 */
function formatExamMonth(examMonth: string | null): string | null {
  if (!examMonth) return null;
  const [y, m] = examMonth.split('-').map(Number);
  if (!y || !m) return examMonth;
  return `${y}年${m}月`;
}

/** 'YYYY-MM-DD' → '2026年7月13日'。null はそのまま null。 */
function formatExamDate(examDate: string | null | undefined): string | null {
  if (!examDate) return null;
  const [y, m, d] = examDate.split('-').map(Number);
  if (!y || !m || !d) return examDate;
  return `${y}年${m}月${d}日`;
}
