'use client';

import { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { Button, Modal, Textarea } from '@/components/ui';
import { fetchWithAuth } from '@/lib/api/auth';
import { useConfirm } from '@/hooks/useConfirm';
import {
  ASSESSMENT_CATEGORY_LABELS,
  ASSESSMENT_NAME_LABELS,
  GRADE_LABELS,
  SUBJECT_CODES,
  SUBJECT_LABELS,
} from '@/types/database';
import type { AdminScoreSubmissionQueueItem } from '@/types/portal-scores';

/**
 * 成績の承認待ちボード — スタッフ側（§7-5）。
 *
 * 正典: docs/portal-v2-requirements.md §7-5「Stage 5 詳細仕様: 成績の保護者入力＋閲覧」。
 * 参考実装: src/components/schedule/PendingTransfersBoard.tsx（同種の「待ち行列を出す/隠す」板）。
 *
 * 設置場所: /students/[studentId]/scores の上部（該当生徒の承認待ちがあるときだけ）。
 * ★ 承認/差し戻しの操作ボタンは canEdit（=permissions.canEditScores）が true のときだけ出す。
 *   閲覧自体（誰から何が申請されているか）は既存の成績ページの権限（canAccessScores）に
 *   ぶら下がる想定で、ここでは canEdit の有無に関わらず一覧は出す（見えるが押せない、が既定）。
 *
 * ★ API 呼び出しは必ず fetchWithAuth を使う（/api/admin/** を素の fetch で叩くと401になる
 *   既知の罠。MEMORY: project_distributor_ordering 等でも繰り返し踏まれている）。
 */
export function ScoreSubmissionQueue({
  studentId,
  canEdit,
  onChanged,
}: {
  studentId: string;
  /** 承認・差し戻しボタンを出すか（=permissions.canEditScores）。 */
  canEdit: boolean;
  /** 承認・差し戻しが成功した後に呼ばれる（既存の成績一覧の再取得に使う）。 */
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<AdminScoreSubmissionQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState('');
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<AdminScoreSubmissionQueueItem | null>(null);
  const { confirm, ConfirmDialog } = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth('/api/admin/score-submissions?status=submitted');
      const json = await res.json();
      const all: AdminScoreSubmissionQueueItem[] = res.ok ? (json.submissions ?? []) : [];
      // ★ APIはstudent_idで絞らない契約なので、このページの対象生徒だけをここで絞る。
      setItems(all.filter((s) => s.studentId === studentId));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (item: AdminScoreSubmissionQueueItem) => {
    const ok = await confirm({
      title: '成績の承認',
      description: `${submissionTitle(item)} を承認し、成績表に転記します。よろしいですか？`,
      confirmLabel: '承認する',
    });
    if (!ok) return;

    setActionError('');
    setApprovingId(item.id);
    try {
      const res = await fetchWithAuth(`/api/admin/score-submissions/${item.id}/approve`, {
        method: 'POST',
      });
      if (!res.ok) {
        if (res.status === 409) {
          setActionError('この申請はすでに処理されています。一覧を更新します。');
        } else {
          const json = await res.json().catch(() => ({}));
          setActionError(json.error ?? '承認に失敗しました');
        }
        await load();
        return;
      }
      setItems((prev) => prev.filter((s) => s.id !== item.id));
      onChanged?.();
    } finally {
      setApprovingId(null);
    }
  };

  const submitReject = async (reason: string) => {
    if (!rejectTarget || !reason.trim()) return;
    setActionError('');
    try {
      const res = await fetchWithAuth(`/api/admin/score-submissions/${rejectTarget.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setActionError(json.error ?? '差し戻しに失敗しました');
        return;
      }
      setItems((prev) => prev.filter((s) => s.id !== rejectTarget.id));
      setRejectTarget(null);
      onChanged?.();
    } catch {
      setActionError('通信に失敗しました');
    }
  };

  // 読み込み中・0件はノイズを増やさないので出さない（PendingTransfersBoard と同じ流儀）。
  if (loading || items.length === 0) return null;

  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-warning bg-warning-subtle">
      <div className="flex items-center gap-2 px-4 py-3">
        <ClipboardCheck className="h-4 w-4 flex-shrink-0 text-warning" />
        <span className="text-sm font-medium text-warning">保護者からの成績申請</span>
        <span className="text-xs text-warning">承認待ち {items.length}件</span>
      </div>

      {actionError && (
        <div className="border-t border-warning bg-danger-subtle px-4 py-2 text-xs text-danger">
          {actionError}
        </div>
      )}

      <div className="border-t border-warning bg-white">
        <ul className="divide-y divide-gray-100">
          {items.map((item) => (
            <li key={item.id} className="px-4 py-3">
              <QueueItemRow
                item={item}
                canEdit={canEdit}
                isApproving={approvingId === item.id}
                onApprove={() => approve(item)}
                onReject={() => setRejectTarget(item)}
              />
            </li>
          ))}
        </ul>
      </div>

      {rejectTarget && (
        <RejectReasonModal
          title={submissionTitle(rejectTarget)}
          onClose={() => setRejectTarget(null)}
          onSubmit={submitReject}
        />
      )}

      {ConfirmDialog}
    </div>
  );
}

// ============================================================
// 1申請の行（差分表示＋操作）
// ============================================================

function QueueItemRow({
  item,
  canEdit,
  isApproving,
  onApprove,
  onReject,
}: {
  item: AdminScoreSubmissionQueueItem;
  canEdit: boolean;
  isApproving: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const diffs = buildScoreDiffs(item);

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-medium text-[var(--headline)]">{item.studentName}</span>
        <span className="text-xs text-text-muted">{submissionTitle(item)}</span>
        {item.existingAssessmentId && (
          <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-text-muted">
            既存の成績あり
          </span>
        )}
      </div>

      {/* 差分表示: 申請値と既存値を並べる。既存と異なる科目だけ強調する。 */}
      <div className="mb-2 grid grid-cols-3 gap-x-2 gap-y-1 sm:grid-cols-5">
        {diffs.map((d) => (
          <div
            key={d.code}
            className={`rounded px-1.5 py-1 ${d.changed ? 'bg-warning-subtle' : ''}`}
          >
            <p className="text-[10px] text-text-muted">{d.label}</p>
            <p className="text-sm font-semibold tabular-nums text-[var(--headline)]">
              {d.existing != null && d.existing !== d.next && (
                <span className="mr-1 text-xs font-normal text-text-faint line-through">
                  {d.existing}
                </span>
              )}
              {d.next}
            </p>
          </div>
        ))}
      </div>

      {canEdit && (
        <div className="flex gap-2">
          <Button variant="primary" size="sm" onClick={onApprove} isLoading={isApproving}>
            承認
          </Button>
          <Button variant="danger" size="sm" onClick={onReject} disabled={isApproving}>
            差し戻し
          </Button>
        </div>
      )}
    </div>
  );
}

/** 差し戻し理由入力モーダル（理由必須・空なら送信不可）。 */
function RejectReasonModal({
  title,
  onClose,
  onSubmit,
}: {
  title: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!reason.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit(reason);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="成績申請の差し戻し" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-[var(--paragraph)]">{title}</p>
        <Textarea
          label="差し戻し理由（保護者に表示されます）"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          required
          placeholder="例: 3組の点数が判読できないため、もう一度ご確認の上ご入力ください"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            キャンセル
          </Button>
          <Button
            variant="danger"
            onClick={submit}
            isLoading={submitting}
            disabled={!reason.trim()}
          >
            差し戻す
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================
// ヘルパー
// ============================================================

/** 科目コードの表示順（GradesView/ScoreSubmitModal と揃える。COMMON_9_SUBJECTS）。 */
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

/** 「定期テスト 1学期中間・中2」のような1行タイトル。 */
function submissionTitle(item: AdminScoreSubmissionQueueItem): string {
  const parts = [
    ASSESSMENT_CATEGORY_LABELS[item.category],
    ASSESSMENT_NAME_LABELS[item.nameCode] ?? item.nameCode,
    GRADE_LABELS[item.grade] ?? `${item.grade}`,
  ];
  if (item.examMonth) parts.push(item.examMonth.slice(0, 7));
  return parts.join(' ・ ');
}

/** 申請の科目（＋既存にだけある科目）を並べ、既存値と申請値を差分表示用に整形する。 */
function buildScoreDiffs(
  item: AdminScoreSubmissionQueueItem
): { code: string; label: string; existing: number | null; next: number; changed: boolean }[] {
  const existing = item.existingScores ?? {};
  // Set の直接イテレーションは tsconfig の target/downlevelIteration の制約で使えないため
  // 配列で持つ（このプロジェクトの既定設定に合わせる）。
  const codes = Array.from(new Set<string>(Object.keys(item.scores).concat(Object.keys(existing))));
  // 表示順は既知の9科目を先に、残りは末尾（未知の科目もそのまま出す）。
  const ordered = [
    ...SUBJECT_ORDER.filter((c) => codes.includes(c)),
    ...codes.filter((c) => !(SUBJECT_ORDER as readonly string[]).includes(c)),
  ];
  return ordered
    .filter((code) => item.scores[code] != null)
    .map((code) => {
      const next = item.scores[code];
      const prev = existing[code] ?? null;
      return {
        code,
        label: SUBJECT_LABELS[code] ?? code,
        existing: prev,
        next,
        changed: prev !== next,
      };
    });
}
