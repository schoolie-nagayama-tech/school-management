'use client';

import type { ReactNode } from 'react';
import { Link2, Save } from 'lucide-react';
import { Button } from '@/components/ui';

/**
 * 単元編集画面のスティッキーボトムバー。提案書エディタと講習テンプレートで共有する。
 *
 * 合計・選択数・グループ化・申込結合・保存だけを持つ。
 * 「講習に登録」「プレビュー」のような画面固有のボタンは extraActions に逃がし、
 * バー自体が生徒や提案書に依存しないようにしている。
 */
export function EditorBottomBar({
  unitCount,
  totalKoma,
  totalAppliedKoma,
  selectedCount,
  contiguous,
  appliedMode,
  onGroup,
  onGroupApplied,
  onSave,
  saving,
  saveBlockers,
  extraActions,
}: {
  unitCount: number;
  totalKoma: number;
  /** 申込コマ合計。申込の概念が無い画面では null を渡す */
  totalAppliedKoma: number | null;
  selectedCount: number;
  /** 選択中の単元が隣接しているか（隣接時のみまとめられる） */
  contiguous: boolean;
  appliedMode: boolean;
  onGroup: () => void;
  onGroupApplied: () => void;
  onSave: () => void;
  saving: boolean;
  /** 保存できない理由。空でなければ保存ボタンを無効化し、理由をそのまま表示する */
  saveBlockers: string[];
  /** 画面固有のボタン（提案書なら「講習に登録」「プレビュー」）を差し込むスロット */
  extraActions?: ReactNode;
}) {
  return (
    // スティッキーボトムバー（コンテンツ幅 max-w-[1600px] に合わせる）
    <div className="fixed bottom-0 left-0 right-0 z-30 bg-surface-raised/95 backdrop-blur-sm border-t border-border-default print:hidden">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center gap-3">
        <div className="text-xs font-bold text-text-muted shrink-0">
          <span className="text-accent-ink">
            {unitCount}単元 / {totalKoma}コマ
          </span>
          {totalAppliedKoma != null && totalAppliedKoma > 0 && (
            <span className="text-info ml-2">申込 {totalAppliedKoma}</span>
          )}
        </div>
        <div className="flex-1" />
        {selectedCount > 0 && (
          <span className="text-[11px] font-medium text-text-muted shrink-0">
            {selectedCount}単元 選択中
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={onGroup}
          disabled={!contiguous}
          title="選択中の単元を1コマにまとめる（グループ化済みは新しいグループで上書き / ショートカット: G）"
        >
          <Link2 className="w-3.5 h-3.5 mr-1" />
          グループ化
        </Button>
        {/* 申込編集フェーズでは申込専用の結合も可能（提案結合とは別系統） */}
        {appliedMode && (
          <Button
            variant="outline"
            size="sm"
            onClick={onGroupApplied}
            disabled={!contiguous}
            title="選択中の単元を申込1コマにまとめる（提案結合とは独立）"
          >
            <Link2 className="w-3.5 h-3.5 mr-1 text-success" />
            申込結合
          </Button>
        )}
        {extraActions}
        <div className="flex flex-col items-end gap-1">
          <Button
            size="sm"
            onClick={onSave}
            disabled={saving || saveBlockers.length > 0}
            isLoading={saving}
            title={saveBlockers.length > 0 ? saveBlockers.join(' / ') : undefined}
          >
            <Save className="w-3.5 h-3.5 mr-1" />
            保存
          </Button>
          {/* 保存できない理由を明示（ボタンが disabled でも理由が分かるようにする） */}
          {saveBlockers.length > 0 && (
            <p className="text-[11px] font-medium text-red-600 text-right leading-tight">
              {saveBlockers.join(' / ')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
