'use client';

import { useMemo, useState } from 'react';
import { Package, X, Check, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { createOrdersForCandidates, type OrderCandidate } from '@/lib/api/ordering';

/**
 * 提案書公開後に表示する発注ダイアログ。
 * 「発注する」ボタンを押したタイミングで、その場で発注（発注済(ordered)＋所持教材登録）する。
 * ページ遷移や自動発注はしない。押すまでは発注されない（チェックで取捨選択可）。
 * - needsOrder（未所持 & 既存発注なし）: ボタンで一括発注の対象。
 *   対応 material が無いテキストも、発注時にラベル名で material を作成して発注する（発注ページと同じ）。
 * - 既に発注あり / 所持済み: スキップ（情報表示のみ）
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
  const ownedCount = candidates.filter((c) => c.alreadyOwned).length;
  const autoCandidates = useMemo(() => candidates.filter((c) => c.needsOrder), [candidates]);
  // 既に未キャンセルの発注がある分（重複防止でスキップ）
  const duplicateCandidates = useMemo(
    () => candidates.filter((c) => !c.alreadyOwned && c.hasOrder),
    [candidates]
  );

  // 発注対象は既定で全選択（押すまで発注はされない）
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(autoCandidates.map((c) => c.proposalId))
  );
  const [phase, setPhase] = useState<'confirm' | 'creating' | 'done'>('confirm');
  const [result, setResult] = useState<{ success: number; failed: number } | null>(null);

  const toggle = (proposalId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(proposalId)) next.delete(proposalId);
      else next.add(proposalId);
      return next;
    });
  };

  const selectedCount = selected.size;
  const creating = phase === 'creating';
  const done = phase === 'done';

  // ボタン押下でその場で発注（ページ遷移しない）
  const handleOrder = async () => {
    const targets = autoCandidates.filter((c) => selected.has(c.proposalId));
    if (targets.length === 0) return;
    setPhase('creating');
    try {
      const r = await createOrdersForCandidates(targets);
      setResult(r);
      onCreated?.();
    } catch (e) {
      console.error('発注に失敗:', e);
      setResult({ success: 0, failed: targets.length });
    } finally {
      setPhase('done');
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={creating ? undefined : onClose} />
      <div className="relative w-full max-w-md bg-surface-raised rounded-2xl shadow-xl border border-border-default overflow-hidden animate-[popover-enter_150ms_cubic-bezier(0.23,1,0.32,1)]">
        {/* ヘッダー */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
          <Package className="w-4 h-4 text-info" />
          <h2 className="text-sm font-bold text-text-heading">
            {done ? '教材を発注しました' : '教材を発注しますか？'}
          </h2>
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
          {/* 発注対象 */}
          {autoCandidates.length > 0 ? (
            <div>
              <div className="text-[11px] font-bold text-text-muted mb-1.5">
                {done
                  ? `発注しました（${result?.success ?? 0}件 / 所持教材にも反映）`
                  : '発注する教材（「発注する」を押すと発注済みになり、所持教材にも反映）'}
              </div>
              <div className="space-y-1">
                {autoCandidates.map((c) => {
                  const checked = selected.has(c.proposalId);
                  // 確認中はチェックで選択。発注後は結果表示（選択済みだったものに✓）。
                  if (done) {
                    const ordered = checked;
                    return (
                      <div
                        key={c.proposalId}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg border ${
                          ordered ? 'border-info/30 bg-info-subtle' : 'border-border-subtle opacity-60'
                        }`}
                      >
                        <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${ordered ? 'bg-info text-white' : 'bg-border-default'}`}>
                          {ordered && <Check className="w-2.5 h-2.5" />}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium text-text-heading truncate">{c.studentName}</span>
                          <span className="block text-xs text-text-muted truncate">{c.materialName ?? c.textbookName}</span>
                        </span>
                        {!ordered && <span className="text-[10px] text-text-faint shrink-0">対象外</span>}
                      </div>
                    );
                  }
                  return (
                    <button
                      key={c.proposalId}
                      onClick={() => toggle(c.proposalId)}
                      disabled={creating}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg border text-left transition-colors duration-150 disabled:opacity-60 ${
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
                        <span className="block text-sm font-medium text-text-heading truncate">{c.studentName}</span>
                        <span className="block text-xs text-text-muted truncate">{c.materialName ?? c.textbookName}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {done && result && result.failed > 0 && (
                <p className="text-[11px] text-danger mt-1">{result.failed}件の発注に失敗しました。発注画面で確認してください。</p>
              )}
            </div>
          ) : (
            !done && <div className="text-sm text-text-muted py-2">発注が必要な教材はありません。</div>
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

          {done && (
            <p className="text-[11px] text-text-faint">間違いがあれば発注画面で修正・取消できます。</p>
          )}
        </div>

        {/* フッター */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-border-subtle">
          {done ? (
            <>
              <Link href="/ordering" className="text-[11px] font-medium text-text-muted hover:text-text-body underline">
                発注画面で確認
              </Link>
              <div className="flex-1" />
              <button
                onClick={onClose}
                className="px-3.5 py-1.5 text-xs font-bold bg-info text-white rounded-lg hover:brightness-95 active:scale-[0.97] transition-[filter,transform] duration-150"
              >
                閉じる
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onClose}
                disabled={creating}
                className="px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text-body rounded-lg hover:bg-surface-hover transition-colors disabled:opacity-50"
              >
                発注しない
              </button>
              <div className="flex-1" />
              <button
                onClick={handleOrder}
                disabled={creating || autoCandidates.length === 0 || selectedCount === 0}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold bg-info text-white rounded-lg hover:brightness-95 active:scale-[0.97] transition-[filter,transform] duration-150 disabled:opacity-50"
              >
                {creating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    発注中…
                  </>
                ) : (
                  `発注する${selectedCount > 0 ? ` (${selectedCount})` : ''}`
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
