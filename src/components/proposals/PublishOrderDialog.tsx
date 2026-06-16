'use client';

import { useMemo, useState } from 'react';
import { Package, X, Check, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { InlineLoading } from '@/components/ui';
import { createOrdersForCandidates, type OrderCandidate } from '@/lib/api/ordering';

/**
 * 提案書公開後に表示する「教材を発注しますか？」ダイアログ。
 * - 紐付けあり & 未所持 & 既存発注なし（needsOrder）: チェックで選んでそのまま発注済(ordered)で作成（所持教材にも登録）
 * - 教材未紐付け（materialId=null）: 自動作成できないため手動発注画面へ誘導
 * - 既に発注あり / 所持済み: 情報表示のみ（作成対象外）
 *
 * 所持判定は公開「前」のスナップショットである必要があるため、candidates は
 * publishProposal 実行前に getProposalOrderCandidates で取得して渡すこと。
 */
export function PublishOrderDialog({
  candidates,
  onClose,
  onCreated,
}: {
  candidates: OrderCandidate[];
  onClose: () => void;
  onCreated?: () => void;
}) {
  // 所持済みは表示しない（発注不要）。件数だけ控えめに伝える。
  const ownedCount = candidates.filter((c) => c.alreadyOwned).length;
  const autoCandidates = useMemo(() => candidates.filter((c) => c.needsOrder), [candidates]);
  const duplicateCandidates = useMemo(
    () => candidates.filter((c) => !c.alreadyOwned && c.materialId && c.hasOrder),
    [candidates]
  );
  const manualCandidates = useMemo(
    () => candidates.filter((c) => !c.alreadyOwned && !c.materialId),
    [candidates]
  );

  // 自動発注対象は既定で全選択
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(autoCandidates.map((c) => c.proposalId))
  );
  const [creating, setCreating] = useState(false);

  const toggle = (proposalId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(proposalId)) next.delete(proposalId);
      else next.add(proposalId);
      return next;
    });
  };

  const selectedCount = selected.size;

  const handleCreate = async () => {
    const targets = autoCandidates.filter((c) => selected.has(c.proposalId));
    if (targets.length === 0) {
      onClose();
      return;
    }
    setCreating(true);
    try {
      const { success, failed } = await createOrdersForCandidates(targets);
      if (failed > 0) {
        alert(`${success}件を発注、${failed}件が失敗しました`);
      }
      onCreated?.();
      onClose();
    } catch (e) {
      console.error(e);
      alert('発注の作成に失敗しました');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={creating ? undefined : onClose} />
      <div className="relative w-full max-w-md bg-surface-raised rounded-2xl shadow-xl border border-border-default overflow-hidden animate-[popover-enter_150ms_cubic-bezier(0.23,1,0.32,1)]">
        {/* ヘッダー */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
          <Package className="w-4 h-4 text-info" />
          <h2 className="text-sm font-bold text-text-heading">教材を発注しますか？</h2>
          <button
            onClick={onClose}
            disabled={creating}
            className="ml-auto p-1 text-text-faint hover:text-text-body rounded hover:bg-surface-hover transition-colors disabled:opacity-50"
            aria-label="閉じる"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 max-h-[60vh] overflow-y-auto space-y-3">
          {/* 自動発注対象 */}
          {autoCandidates.length > 0 ? (
            <div>
              <div className="text-[11px] font-bold text-text-muted mb-1.5">
                発注する教材（発注済みとして登録し、所持教材にも反映）
              </div>
              <div className="space-y-1">
                {autoCandidates.map((c) => {
                  const checked = selected.has(c.proposalId);
                  return (
                    <button
                      key={c.proposalId}
                      onClick={() => toggle(c.proposalId)}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg border text-left transition-colors duration-150 ${
                        checked ? 'border-info/40 bg-info-subtle' : 'border-border-subtle hover:bg-surface-hover'
                      }`}
                    >
                      <span
                        className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
                          checked ? 'bg-info border-info text-white' : 'border-border-default'
                        }`}
                      >
                        {checked && <Check className="w-2.5 h-2.5" />}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium text-text-heading truncate">
                          {c.studentName}
                        </span>
                        <span className="block text-xs text-text-muted truncate">
                          {c.materialName ?? c.textbookName}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-sm text-text-muted py-2">
              自動で発注できる教材はありません。
            </div>
          )}

          {/* 教材未紐付け → 手動発注へ誘導 */}
          {manualCandidates.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <div className="text-[11px] font-bold text-amber-700 mb-1">
                手動で発注が必要（発注教材が未設定のテキスト）
              </div>
              <ul className="text-xs text-amber-800 space-y-0.5 mb-1.5">
                {manualCandidates.map((c) => (
                  <li key={c.proposalId} className="truncate">
                    {c.studentName} / {c.textbookName}
                  </li>
                ))}
              </ul>
              <Link
                href="/ordering"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 hover:text-amber-900 underline"
              >
                発注画面を開く <ExternalLink className="w-3 h-3" />
              </Link>
              <p className="text-[10px] text-amber-700/80 mt-1">
                ※ 教材マスタでテキストに発注教材を紐付けると、次回から自動候補に出ます
              </p>
            </div>
          )}

          {/* 既に発注あり / 所持済み */}
          {(duplicateCandidates.length > 0 || ownedCount > 0) && (
            <div className="text-[11px] text-text-faint">
              {duplicateCandidates.length > 0 && (
                <div>既に発注済みのためスキップ: {duplicateCandidates.length}件</div>
              )}
              {ownedCount > 0 && <div>所持済みのためスキップ: {ownedCount}件</div>}
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-border-subtle">
          <button
            onClick={onClose}
            disabled={creating}
            className="px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text-body rounded-lg hover:bg-surface-hover transition-colors disabled:opacity-50"
          >
            発注しない
          </button>
          <div className="flex-1" />
          <button
            onClick={handleCreate}
            disabled={creating || autoCandidates.length === 0 || selectedCount === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold bg-info text-white rounded-lg hover:brightness-95 active:scale-[0.97] transition-[filter,transform] duration-150 disabled:opacity-50"
          >
            {creating ? (
              <InlineLoading size="sm" label="発注中..." />
            ) : (
              `発注する${selectedCount > 0 ? ` (${selectedCount})` : ''}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
