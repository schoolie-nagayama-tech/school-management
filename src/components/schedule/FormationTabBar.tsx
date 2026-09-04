'use client';

/**
 * 指導形態のタブバー（schedule_formations マスタ駆動）。
 *
 * 旧「コマ時間設定」ページ（/settings/time-slots）の中段タブバーを、
 * 「授業の設定」ページ（/schedule/special-courses）と共有するために切り出したもの。
 * タブ切替に加えて、形態の追加・改名・並び替え・無効化・削除と、
 * 無効な形態を表示するトグルを持つ。
 *
 * 形態マスタを書き換えたら onChanged() を呼ぶので、親は一覧を読み直すこと。
 */

import { useEffect, useRef, useState } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui';
import {
  createFormation,
  renameFormation,
  setFormationActive,
  updateFormationOrder,
  deleteFormation,
} from '@/lib/api/schedule-formations';
import type { ScheduleFormation } from '@/types/schedule';
import { INDIVIDUAL_FORMATION } from '@/types/schedule';
import {
  Plus,
  Settings2,
  Pencil,
  ChevronUp,
  ChevronDown,
  EyeOff,
  Eye,
  Trash2,
  Check,
} from 'lucide-react';

export interface FormationTabBarProps {
  /** 形態マスタの全件（無効・システム含む）。並び替えの隣接判定に全件が要る。 */
  formations: ScheduleFormation[];
  /** 選択中の形態 key */
  selectedKey: string;
  onSelectKey: (key: string) => void;
  /** 形態マスタを書き換えたあとに呼ばれる（親は getFormations で読み直す） */
  onChanged: () => void | Promise<void>;
  /** 形態の追加・改名・並び替え・無効化・削除の導線を出すか（manager 以上） */
  canManage: boolean;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

export function FormationTabBar({
  formations,
  selectedKey,
  onSelectKey,
  onChanged,
  canManage,
  onSuccess,
  onError,
}: FormationTabBarProps) {
  // 無効化した形態も一覧に出すか（再有効化導線）
  const [showInactive, setShowInactive] = useState(false);
  // 形態の追加・改名・メニュー用のインラインUI状態
  const [addingFormation, setAddingFormation] = useState(false);
  const [newFormationLabel, setNewFormationLabel] = useState('');
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameLabel, setRenameLabel] = useState('');
  const [menuOpenKey, setMenuOpenKey] = useState<string | null>(null);
  // 形態削除の確認ダイアログ
  const [deleteFormationTarget, setDeleteFormationTarget] = useState<ScheduleFormation | null>(
    null
  );

  // タブに表示する形態（無効を隠すトグルに応じてフィルタ）
  const visibleFormations = showInactive ? formations : formations.filter((f) => f.is_active);
  // 並び替えの隣接判定・境界(上端/下端)判定用に、sort_order順で全形態（無効含む）を並べたリスト。
  // 表示中リストだけで隣接判定すると、無効形態を挟んだときに交換相手がズレる。
  const sortedFormations = [...formations].sort((a, b) => a.sort_order - b.sort_order);

  // 選択中の形態が表示一覧から消えた（無効化・削除・トグルOFF）場合は個別へ戻す
  useEffect(() => {
    if (formations.length === 0) return;
    const visible = showInactive ? formations : formations.filter((f) => f.is_active);
    if (!visible.some((f) => f.key === selectedKey)) {
      onSelectKey(INDIVIDUAL_FORMATION);
    }
  }, [formations, selectedKey, showInactive, onSelectKey]);

  // 形態を新規作成 → 一覧を再読込 → 新タブへ切替
  const handleCreateFormation = async () => {
    const label = newFormationLabel.trim();
    if (!label) return;
    try {
      const created = await createFormation(label);
      setAddingFormation(false);
      setNewFormationLabel('');
      await onChanged();
      onSelectKey(created.key);
      onSuccess(`形態「${created.label}」を追加しました`);
    } catch (e) {
      onError((e as Error).message);
    }
  };

  // 形態を改名
  const handleRenameFormation = async (key: string) => {
    const label = renameLabel.trim();
    if (!label) return;
    try {
      await renameFormation(key, label);
      setRenamingKey(null);
      setRenameLabel('');
      await onChanged();
      onSuccess('形態名を変更しました');
    } catch (e) {
      onError((e as Error).message);
    }
  };

  // 形態の有効/無効を切替
  const handleToggleActive = async (f: ScheduleFormation) => {
    setMenuOpenKey(null);
    try {
      await setFormationActive(f.key, !f.is_active);
      // 無効化した形態が選択中なら個別へ戻す
      if (f.is_active && selectedKey === f.key) {
        onSelectKey(INDIVIDUAL_FORMATION);
      }
      await onChanged();
      onSuccess(f.is_active ? '形態を無効化しました' : '形態を有効化しました');
    } catch (e) {
      onError((e as Error).message);
    }
  };

  // 形態の並び順を上下に移動。
  // 個別・小集団（is_system）も並び替え対象に含め、表示フィルタ（無効を隠す等）に
  // 関係なく全形態（無効含む）を sort_order 順に並べたリストの中で隣接入れ替えする。
  const handleMoveFormation = async (key: string, direction: 'up' | 'down') => {
    setMenuOpenKey(null);
    const sorted = [...formations].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex((f) => f.key === key);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= sorted.length) return;
    const a = sorted[idx];
    const b = sorted[swapIdx];
    try {
      // 2件の sort_order を交換
      await updateFormationOrder(a.key, b.sort_order);
      await updateFormationOrder(b.key, a.sort_order);
      await onChanged();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  // 形態を物理削除（参照ありは API 側で 23503 → フレンドリーエラー）
  const handleDeleteFormation = async () => {
    if (!deleteFormationTarget) return;
    const target = deleteFormationTarget;
    try {
      await deleteFormation(target.key);
      setDeleteFormationTarget(null);
      if (selectedKey === target.key) {
        onSelectKey(INDIVIDUAL_FORMATION);
      }
      await onChanged();
      onSuccess('形態を削除しました');
    } catch (e) {
      // 「使用中のため削除できません。無効化してください。」等
      setDeleteFormationTarget(null);
      onError((e as Error).message);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {visibleFormations.map((f) => {
            const isSelected = selectedKey === f.key;
            const isRenaming = renamingKey === f.key;
            // 並び替えの上下ボタンの活性判定は、表示フィルタに関係なく
            // 全形態（無効含む）の sort_order 順リストでの位置を見る
            const idxInAll = sortedFormations.findIndex((x) => x.key === f.key);
            const canMoveUp = idxInAll > 0;
            const canMoveDown = idxInAll >= 0 && idxInAll < sortedFormations.length - 1;
            // 改名中はタブの中身をインライン入力に差し替える
            if (isRenaming) {
              return (
                <div
                  key={f.key}
                  className="inline-flex items-center gap-1 rounded-md border border-border-default bg-white px-2 py-1.5"
                >
                  <input
                    autoFocus
                    value={renameLabel}
                    onChange={(e) => setRenameLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRenameFormation(f.key);
                      if (e.key === 'Escape') {
                        setRenamingKey(null);
                        setRenameLabel('');
                      }
                    }}
                    className="w-28 px-1.5 py-1 text-sm border border-border-default rounded"
                  />
                  <button
                    type="button"
                    onClick={() => handleRenameFormation(f.key)}
                    className="p-1 text-[var(--primary)] hover:opacity-80"
                    title="確定"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              );
            }
            return (
              <div key={f.key} className="relative inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSelectKey(f.key)}
                  className={`flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                    isSelected
                      ? 'border-[var(--primary)] bg-[var(--primary)] text-white shadow-sm'
                      : 'border-border-default bg-white text-text-muted hover:border-[var(--primary)]/50 hover:text-text-body'
                  } ${!f.is_active ? 'opacity-60' : ''}`}
                >
                  {f.label}
                  {!f.is_active && (
                    <span className="text-[10px] font-normal opacity-80">(無効)</span>
                  )}
                </button>
                {/* 歯車メニューは常時表示（ホバー依存にしない）。個別・小集団(is_system)も
                    並び替えだけはここから操作できる（改名・無効化・削除はメニュー内で無効化） */}
                {canManage && (
                  <button
                    type="button"
                    onClick={() => setMenuOpenKey(menuOpenKey === f.key ? null : f.key)}
                    className={`flex items-center justify-center rounded-md border p-2 transition-colors ${
                      isSelected
                        ? 'border-[var(--primary)] bg-[var(--primary)] text-white hover:brightness-90'
                        : 'border-border-default bg-white text-text-muted hover:border-[var(--primary)]/50 hover:text-text-body'
                    }`}
                    title="形態の操作"
                  >
                    <Settings2 className="w-4 h-4" />
                  </button>
                )}
                {menuOpenKey === f.key && (
                  <FormationTabMenu
                    formation={f}
                    canMoveUp={canMoveUp}
                    canMoveDown={canMoveDown}
                    onRename={() => {
                      setMenuOpenKey(null);
                      setRenamingKey(f.key);
                      setRenameLabel(f.label);
                    }}
                    onMoveUp={() => handleMoveFormation(f.key, 'up')}
                    onMoveDown={() => handleMoveFormation(f.key, 'down')}
                    onToggleActive={() => handleToggleActive(f)}
                    onDelete={() => {
                      setMenuOpenKey(null);
                      setDeleteFormationTarget(f);
                    }}
                    onClose={() => setMenuOpenKey(null)}
                  />
                )}
              </div>
            );
          })}

          {/* ＋形態を追加（インライン入力） */}
          {canManage &&
            (addingFormation ? (
              <div className="inline-flex items-center gap-1 rounded-md border border-dashed border-[var(--primary)]/50 bg-white px-2 py-1.5">
                <input
                  autoFocus
                  value={newFormationLabel}
                  onChange={(e) => setNewFormationLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateFormation();
                    if (e.key === 'Escape') {
                      setAddingFormation(false);
                      setNewFormationLabel('');
                    }
                  }}
                  placeholder="形態名"
                  className="w-28 px-1.5 py-1 text-sm border border-border-default rounded"
                />
                <button
                  type="button"
                  onClick={handleCreateFormation}
                  className="p-1 text-[var(--primary)] hover:opacity-80"
                  title="追加"
                >
                  <Check className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddingFormation(true)}
                className="flex items-center gap-1.5 rounded-md border border-dashed border-[var(--primary)]/40 px-4 py-2 text-sm font-medium text-[var(--primary)] hover:bg-surface"
                title="形態を追加"
              >
                <Plus className="w-4 h-4" />
                形態を追加
              </button>
            ))}
        </div>

        {/* 無効の形態を表示トグル */}
        {canManage && (
          <button
            type="button"
            onClick={() => setShowInactive((v) => !v)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-text-muted hover:text-text-body"
            title={showInactive ? '無効の形態を隠す' : '無効の形態を表示'}
          >
            {showInactive ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            {showInactive ? '無効の形態を隠す' : '無効の形態を表示'}
          </button>
        )}
      </div>

      {/* 形態削除の確認 */}
      <AlertDialog
        open={deleteFormationTarget !== null}
        onOpenChange={(open) => !open && setDeleteFormationTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>形態を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteFormationTarget && `形態「${deleteFormationTarget.label}」を削除します。`}
              コマ時間・通塾日程・スケジュールで使用中の場合は削除できません（無効化をご利用ください）。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteFormationTarget(null)}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteFormation}
              className="bg-[#d9376e] text-white hover:bg-[#c02d5a] transition-colors duration-150"
            >
              削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * 形態タブの操作メニュー（改名 / 並び替え / 無効化・有効化 / 削除）。
 * Popover プリミティブが無いため、外側クリックで閉じる軽量ドロップダウンとして実装する。
 * individual/group（is_system）は並び替えのみ許可し、改名・無効化・削除は
 * disabled にした上で title に理由を表示する（システム標準の形態のため変更不可）。
 */
function FormationTabMenu({
  formation,
  canMoveUp,
  canMoveDown,
  onRename,
  onMoveUp,
  onMoveDown,
  onToggleActive,
  onDelete,
  onClose,
}: {
  formation: ScheduleFormation;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onRename: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // 外側クリックで閉じる
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const itemClass =
    'flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left text-text-body hover:bg-surface disabled:cursor-not-allowed disabled:text-text-faint disabled:hover:bg-transparent';
  const isSystem = formation.is_system;
  const systemTitle = isSystem ? 'システム標準の形態のため変更できません' : undefined;

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 z-20 mt-1 w-48 rounded-md border border-border-default bg-white shadow-lg py-1"
    >
      <button
        type="button"
        onClick={onRename}
        disabled={isSystem}
        title={systemTitle}
        className={itemClass}
      >
        <Pencil className="w-3.5 h-3.5" />
        改名
      </button>
      <button type="button" onClick={onMoveUp} disabled={!canMoveUp} className={itemClass}>
        <ChevronUp className="w-3.5 h-3.5" />
        並び順を上へ
      </button>
      <button type="button" onClick={onMoveDown} disabled={!canMoveDown} className={itemClass}>
        <ChevronDown className="w-3.5 h-3.5" />
        並び順を下へ
      </button>
      <button
        type="button"
        onClick={onToggleActive}
        disabled={isSystem}
        title={systemTitle}
        className={itemClass}
      >
        {formation.is_active ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        {formation.is_active ? '無効化' : '有効化'}
      </button>
      <div className="my-1 border-t border-border-default" />
      <button
        type="button"
        onClick={onDelete}
        disabled={isSystem}
        title={systemTitle}
        className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left ${
          isSystem ? 'cursor-not-allowed text-text-faint' : 'text-[#d9376e] hover:bg-surface'
        }`}
      >
        <Trash2 className="w-3.5 h-3.5" />
        削除
      </button>
      {isSystem && (
        <p className="px-3 pt-1.5 text-[10px] leading-relaxed text-text-faint">
          個別・小集団はシステム標準の形態のため、並び順の変更のみ可能です
        </p>
      )}
    </div>
  );
}
