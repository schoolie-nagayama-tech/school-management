'use client';

import { useEffect, useMemo, useState } from 'react';
import { Repeat, TriangleAlert, CircleCheck } from 'lucide-react';
import { Button, Modal, Textarea } from '@/components/ui';
import { isTransferDeadlinePassed } from '@/lib/mypage/transferDeadline';
import type {
  PortalScheduleEntryDto,
  PortalTimeSlotDto,
  TransferQuota,
} from '@/types/mypage-schedule';
import type { TransferCandidate } from '@/types/chat';

/**
 * 欠席・遅刻・振替希望の連絡シート（予定のコマから開く）。
 *
 * 正典: docs/portal-v2-requirements.md §7-2（締切・第1〜第3希望）/ §7-3（上限・許可・フリー期間）、UIモック。
 *
 * ★ Stage2 のテンプレ投稿 API に合流する（送信ロジックを二重実装しない）:
 *   送信先は ChatView のクイックアクションと同じ `POST /api/mypage/chat/template`。
 *   本文生成・受付自動返信・締切とクォータの再検証はすべてサーバー側の既存経路が担う。
 *   このコンポーネントが持つのは「予定のコマからのプリフィル」と「クォータに応じた
 *   UI の出し分け」だけ。＝連絡はすべてチャットに集約され、二重管理にならない。
 *
 * ★ クライアントのガードは UX、サーバーが最終防衛線:
 *   ここでの無効化・警告表示は「押せてしまって後から拒否される」体験を避けるためのもの。
 *   実際の拒否（欠席へのダウングレード）は API 側が再判定して行う。
 */

/** 連絡の種類。 */
type ContactKind = 'absence' | 'late' | 'transfer';

/** 'YYYY-MM-DD' → '7月16日(水)'。 */
const DOW_JP = ['日', '月', '火', '水', '木', '金', '土'];
function formatDayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}月${d}日(${DOW_JP[dow]})`;
}

/** 'YYYY-MM-DD' → '7/22'。 */
function formatSlash(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${m}/${d}`;
}

export function AbsenceSheet({
  studentId,
  entry,
  timeSlots,
  onClose,
  onSent,
}: {
  studentId: string;
  entry: PortalScheduleEntryDto;
  /** その教室に実在する時限。振替希望の「時限」はここからの選択にする（自由入力にしない）。 */
  timeSlots: PortalTimeSlotDto[];
  onClose: () => void;
  onSent: () => void;
}) {
  const [kind, setKind] = useState<ContactKind>('absence');
  const [reason, setReason] = useState('');
  const [candidates, setCandidates] = useState<TransferCandidate[]>([
    { date: '', slot: '' },
    { date: '', slot: '' },
    { date: '', slot: '' },
  ]);
  const [quota, setQuota] = useState<TransferQuota | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // 対象授業の日付・時限はコマからプリフィルする。
  const lessonDate = entry.entryDate;
  const lessonSlot = entry.slotLabel ?? (entry.slotNumber != null ? `${entry.slotNumber}限` : '');

  // 締切（前日21:00 JST）。Stage2 の純関数をそのまま使う。
  const deadlinePassed = useMemo(() => isTransferDeadlinePassed(lessonDate), [lessonDate]);

  // ★ クォータは「対象授業日」を基準に取る（今日ではない。§7-3 の罠）。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setQuotaLoading(true);
      try {
        const res = await fetch(
          `/api/mypage/transfer-usage?studentId=${encodeURIComponent(studentId)}&targetDate=${lessonDate}`
        );
        const json = await res.json();
        if (!cancelled) setQuota(res.ok ? (json.quota ?? null) : null);
      } finally {
        if (!cancelled) setQuotaLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studentId, lessonDate]);

  // 振替希望を選べるか = 締切内 かつ クォータOK。
  const quotaAllows = quota?.canRequestTransfer ?? false;
  const transferAvailable = !deadlinePassed && quotaAllows;

  // 選べない状態になったら選択を欠席へ戻す（不整合な送信を防ぐ）。
  useEffect(() => {
    if (!transferAvailable && kind === 'transfer' && !quotaLoading) setKind('absence');
  }, [transferAvailable, kind, quotaLoading]);

  const submit = async () => {
    setError('');
    const filled = candidates.filter((c) => c.date);
    if (kind === 'transfer' && filled.length === 0) {
      setError('振替の第1希望（日付）を入力してください');
      return;
    }

    setSubmitting(true);
    try {
      // Stage2 のテンプレ投稿 API に合流。遅刻は absence テンプレの理由に含める
      // （template_kind は absence/transfer_request/meeting_request の3種類のため）。
      const templateKind = kind === 'transfer' ? 'transfer_request' : 'absence';
      const payload: Record<string, unknown> = {
        lessonDate,
        lessonSlot: lessonSlot || undefined,
        reason: kind === 'late' ? `遅刻${reason ? ` / ${reason}` : ''}` : reason || undefined,
      };
      if (kind === 'absence') payload.wantsTransfer = false;
      if (kind === 'transfer') payload.candidates = filled;

      const res = await fetch('/api/mypage/chat/template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: studentId, template_kind: templateKind, payload }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? '送信に失敗しました');
        return;
      }
      onSent();
    } catch {
      setError('通信に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="欠席・振替の連絡" size="md">
      <div className="space-y-4">
        {/* 対象授業（プリフィル表示）＋その下に小さく残り回数 */}
        <div className="rounded-xl border border-border-subtle bg-ink-subtle px-3 py-2.5">
          <div className="text-[10.5px] font-bold tracking-wide text-ink">対象の授業</div>
          <div className="text-sm font-bold text-text-heading">
            {formatDayLabel(lessonDate)}
            {lessonSlot && ` ${lessonSlot}`}
            {entry.subjectNames.length > 0 && ` ・ ${entry.subjectNames.join('・')}`}
            {entry.teacherName && `（${entry.teacherName}先生）`}
          </div>
          {!quotaLoading && <QuotaNote quota={quota} />}
        </div>

        {/* 連絡の種類 */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-text-heading">連絡の種類</label>
          <div className="flex flex-wrap gap-2">
            <KindChip label="欠席" active={kind === 'absence'} onClick={() => setKind('absence')} />
            <KindChip label="遅刻" active={kind === 'late'} onClick={() => setKind('late')} />
            <KindChip
              label="振替希望"
              icon={<Repeat className="h-3.5 w-3.5" />}
              active={kind === 'transfer'}
              disabled={!transferAvailable}
              onClick={() => setKind('transfer')}
            />
          </div>

          {/* 選べない理由（締切 → 上限 の順で1つだけ出す） */}
          {deadlinePassed ? (
            <WarnNote>
              振替のご連絡は<b>前日21:00まで</b>です。それ以降は「欠席」のみ受け付けます。
            </WarnNote>
          ) : quota?.mode === 'limited' && !quota.canRequestTransfer ? (
            <WarnNote>
              今月の振替上限（{quota.effectiveLimit}回）に達しています。
              振替をご希望の場合は「連絡」から教室にご相談ください。
            </WarnNote>
          ) : quota?.mode === 'limited' && quota.hasPermission ? (
            // 教室が明示的に解錠したことを伝える（成功色の注記）。
            <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-success bg-success-subtle px-3 py-2 text-[11.5px] text-success">
              <CircleCheck className="mt-0.5 h-3.5 w-3.5 flex-none" />
              教室が今月の振替を追加で{quota.permissionExtra}回許可しています。
            </div>
          ) : null}
        </div>

        {/* 振替の希望日時（第1必須〜第3） */}
        {kind === 'transfer' && (
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-text-heading">
              振替の希望日時（第1希望は必須・第3希望まで）
            </label>
            <div className="space-y-2">
              {candidates.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-12 flex-none text-[11.5px] font-bold text-text-muted">
                    第{i + 1}希望
                  </span>
                  <input
                    type="date"
                    aria-label={`第${i + 1}希望の日付`}
                    value={c.date}
                    onChange={(e) => {
                      const next = [...candidates];
                      next[i] = { ...next[i], date: e.target.value };
                      setCandidates(next);
                    }}
                    className="rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-sm text-text-body"
                  />
                  {/*
                    ★ 自由入力にしない理由: 保護者が「6限」「夕方」など教室に存在しない
                      表記で書くと、教室側が毎回読み替えて確認の往復が発生する。
                      実在する時限だけを出せば、そのまま席の調整に使える。
                      空（未選択）は残す＝時限の希望は今までどおり任意。
                  */}
                  <select
                    aria-label={`第${i + 1}希望の時限`}
                    value={c.slot}
                    onChange={(e) => {
                      const next = [...candidates];
                      next[i] = { ...next[i], slot: e.target.value };
                      setCandidates(next);
                    }}
                    className="min-w-0 flex-1 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-sm text-text-body"
                  >
                    <option value="">時限（任意）</option>
                    {timeSlots.map((s) => (
                      <option key={s.id} value={s.slotLabel}>
                        {s.slotLabel}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        <Textarea
          label="理由・連絡事項（任意）"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
        />

        {error && (
          <div className="rounded-lg border border-danger bg-danger/10 p-3 text-sm text-danger">
            {error}
          </div>
        )}

        <div>
          <Button onClick={submit} isLoading={submitting} className="w-full">
            この内容で連絡する
          </Button>
          <p className="mt-2 text-center text-[11px] text-text-muted">
            送信すると「連絡」に受付メッセージが届きます
          </p>
        </div>
      </div>
    </Modal>
  );
}

/** 種類選択のチップ。無効時はグレーアウト＋打ち消し（モック準拠）。 */
function KindChip({
  label,
  icon,
  active,
  disabled,
  onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] transition-colors ${
        disabled
          ? 'cursor-not-allowed border-border bg-surface-raised text-text-muted line-through opacity-45'
          : active
            ? 'border-primary bg-primary-subtle font-semibold text-primary-dark'
            : 'border-border bg-surface-raised text-text-muted hover:bg-surface-hover'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/** 警告注記（振替が選べない理由）。 */
function WarnNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-warning bg-warning-subtle px-3 py-2 text-[11.5px] text-warning">
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-none" />
      <span>{children}</span>
    </div>
  );
}

/**
 * 対象授業の月の残り回数（対象授業ボックス内の小さな1行）。
 * フリー期間中は上限の注記を出さず「振替制限なし」の1行にする（§7-3）。
 */
function QuotaNote({ quota }: { quota: TransferQuota | null }) {
  if (!quota) return null;

  if (quota.mode === 'free') {
    return (
      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink">
        <Repeat className="h-3 w-3 flex-none" />
        {formatSlash(quota.startDate)}〜{formatSlash(quota.endDate)} は振替制限なし
        {quota.label ? `（${quota.label}）` : ''}
      </div>
    );
  }

  const monthOnly = quota.monthLabel.replace(/^\d+年/, '');
  return (
    <div className="mt-1 flex items-center gap-1.5 text-[11px] tabular-nums text-text-muted">
      <Repeat className="h-3 w-3 flex-none" />
      {monthOnly}の振替 残り{quota.remaining}回（{quota.effectiveLimit}回まで）
    </div>
  );
}
