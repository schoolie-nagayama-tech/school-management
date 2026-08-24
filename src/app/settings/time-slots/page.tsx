'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import {
  SelectShadcn as Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui';
import { Button } from '@/components/ui';
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
import { ToastContainer, Loading } from '@/components/ui';
import { TimeSlotForm } from '@/components/schedule/TimeSlotForm';
import { TimeSlotTable } from '@/components/schedule/TimeSlotTable';
import { useToast } from '@/hooks/useToast';
import { useMasterData } from '@/contexts/MasterDataContext';
import {
  getTimeSlots,
  createTimeSlot,
  updateTimeSlot,
  deleteTimeSlot,
  isTimeSlotInUse,
  reorderTimeSlots,
} from '@/lib/api/schedule';
import {
  getFormations,
  createFormation,
  renameFormation,
  setFormationActive,
  updateFormationOrder,
  deleteFormation,
} from '@/lib/api/schedule-formations';
import type {
  ScheduleTimeSlot,
  ScheduleTimeSlotFormData,
  ScheduleFormation,
} from '@/types/schedule';
// Phase B: コマ時間タブを schedule_formations マスタ駆動に置換。
// 個別（既定選択）だけは定数で判定するため INDIVIDUAL_FORMATION を参照する。
import { INDIVIDUAL_FORMATION } from '@/types/schedule';
import type { School } from '@/types/database';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { isManagerOrAbove } from '@/lib/utils/roles';
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

// コマ数の上限（DB CHECK制約 slot_number 1〜20 と合わせる）
const MAX_TIME_SLOTS = 20;

export default function TimeSlotsSettingsPage() {
  const { profile, selectedSchoolId: headerSelectedSchoolId, getSelectedSchoolIds } = useAuth();
  const { toasts, removeToast, success, error: toastError } = useToast();
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('');
  const [slots, setSlots] = useState<ScheduleTimeSlot[]>([]);
  // Phase B: 形態は schedule_formations マスタ駆動。key(string) で管理する。
  const [formations, setFormations] = useState<ScheduleFormation[]>([]);
  const [selectedFormation, setSelectedFormation] = useState<string>(INDIVIDUAL_FORMATION);
  // 無効化した形態も一覧に出すか（再有効化導線）
  const [showInactive, setShowInactive] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<ScheduleTimeSlot | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingSlot, setDeletingSlot] = useState<ScheduleTimeSlot | null>(null);

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

  const { schools: masterSchools } = useMasterData();

  // manager 以上のみ形態の作成・編集導線を出す
  const canManageFormations = isManagerOrAbove(profile?.role);

  // 形態一覧を読み込む。無効・システム含む全件を常に取得し、
  // 表示フィルタ（無効を隠す）はクライアント側で行う。
  // 並び替えの隣接判定・sort_order交換を「表示中リストだけ」で行うと、
  // 無効形態を挟んだときに交換相手がズレるバグになるため、常に全件を保持しておく。
  const loadFormations = useCallback(async () => {
    try {
      const list = await getFormations(true);
      setFormations(list);
    } catch (e) {
      toastError((e as Error).message);
    }
  }, [toastError]);

  useEffect(() => {
    loadFormations();
  }, [loadFormations]);

  // タブに表示する形態（無効を隠すトグルに応じてフィルタ）
  const visibleFormations = showInactive ? formations : formations.filter((f) => f.is_active);
  // 並び替えの隣接判定・境界(上端/下端)判定用に、sort_order順で全形態（無効含む）を並べたリスト
  const sortedFormations = [...formations].sort((a, b) => a.sort_order - b.sort_order);

  // 選択中の形態が表示一覧から消えた（無効化・削除・トグルOFF）場合は個別へ戻す
  useEffect(() => {
    if (formations.length === 0) return;
    const visible = showInactive ? formations : formations.filter((f) => f.is_active);
    if (!visible.some((f) => f.key === selectedFormation)) {
      setSelectedFormation(INDIVIDUAL_FORMATION);
    }
  }, [formations, selectedFormation, showInactive]);

  useEffect(() => {
    if (masterSchools.length > 0) {
      setSchools(masterSchools);
      if (!selectedSchoolId) {
        // ヘッダーで特定の教室が選ばれていればそれを優先。'all' やなしの場合は先頭。
        const headerIds = getSelectedSchoolIds();
        const preferred =
          headerSelectedSchoolId && headerSelectedSchoolId !== 'all'
            ? headerSelectedSchoolId
            : headerIds.length > 0
              ? headerIds[0]
              : masterSchools[0].id;
        setSelectedSchoolId(preferred);
      }
    }
  }, [masterSchools, selectedSchoolId, headerSelectedSchoolId, getSelectedSchoolIds]);

  useEffect(() => {
    if (!selectedSchoolId) return;
    setIsLoading(true);
    getTimeSlots(selectedSchoolId, selectedFormation)
      .then(setSlots)
      .catch(() => toastError('コマ時間の取得に失敗しました'))
      .finally(() => setIsLoading(false));
  }, [selectedSchoolId, selectedFormation, toastError]);

  const selectedSchool = schools.find((s) => s.id === selectedSchoolId);
  const nextSlotNumber = Math.max(0, ...slots.map((s) => s.slot_number)) + 1;
  // 現在タブのコマ数が上限に達したら追加できないようにする
  const atSlotCap = slots.length >= MAX_TIME_SLOTS;

  const handleSave = async (form: ScheduleTimeSlotFormData) => {
    if (!selectedSchoolId) return;
    try {
      if (editingSlot) {
        // 編集時は元のコマの formation を維持（タブ切替で誤って付け替えないように）
        await updateTimeSlot(editingSlot.id, { ...form, formation: editingSlot.formation });
        success('コマ時間を更新しました');
      } else {
        // 新規は現在表示中の formation（タブ）で作成
        await createTimeSlot(selectedSchoolId, { ...form, formation: selectedFormation });
        success('コマ時間を追加しました');
      }
      const data = await getTimeSlots(selectedSchoolId, selectedFormation);
      setSlots(data);
      setFormOpen(false);
      setEditingSlot(null);
    } catch (e) {
      toastError((e as Error).message);
    }
  };

  // 上下並び替え → display_order に新しい表示順を書き込んでから
  // RPC(reorder_time_slots)で slot_number を連番に詰め直す。
  // display_order 自体には一意制約が無いため、個別 PATCH を並行実行しても衝突しない。
  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= slots.length || !selectedSchoolId) return;
    const newSlots = [...slots];
    [newSlots[index], newSlots[swapIndex]] = [newSlots[swapIndex], newSlots[index]];
    setSlots(newSlots);
    try {
      await Promise.all(newSlots.map((s, i) => updateTimeSlot(s.id, { display_order: i })));
      await reorderTimeSlots(selectedSchoolId, selectedFormation);
      const data = await getTimeSlots(selectedSchoolId, selectedFormation);
      setSlots(data);
    } catch (e) {
      toastError((e as Error).message);
      const data = await getTimeSlots(selectedSchoolId, selectedFormation);
      setSlots(data);
    }
  };

  // 有効/無効バッジのインライントグル。編集ダイアログを開かず即切替する
  const handleToggleSlotActive = async (slot: ScheduleTimeSlot) => {
    if (!selectedSchoolId) return;
    try {
      await updateTimeSlot(slot.id, { is_active: !slot.is_active });
      const data = await getTimeSlots(selectedSchoolId, selectedFormation);
      setSlots(data);
    } catch (e) {
      toastError((e as Error).message);
    }
  };

  const handleDeleteClick = (slot: ScheduleTimeSlot) => {
    setDeletingSlot(slot);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingSlot) return;
    try {
      const inUse = await isTimeSlotInUse(deletingSlot.id);
      if (inUse) {
        toastError('このコマは通塾日程またはスケジュールで使用中のため削除できません。');
        setDeleteDialogOpen(false);
        setDeletingSlot(null);
        return;
      }
      await deleteTimeSlot(deletingSlot.id, selectedSchoolId!);
      // 削除後にコマ番号の欠番を詰め直す。display_order は変更不要
      // （残った行どうしの相対順序は変わらないため、RPCを呼ぶだけでよい）
      const remaining = slots.filter((s) => s.id !== deletingSlot.id);
      if (remaining.length > 0) {
        await reorderTimeSlots(selectedSchoolId!, selectedFormation);
      }
      success('コマ時間を削除しました');
      const data = await getTimeSlots(selectedSchoolId!, selectedFormation);
      setSlots(data);
      setDeleteDialogOpen(false);
      setDeletingSlot(null);
    } catch (e) {
      toastError((e as Error).message);
    }
  };

  // ========================================
  // 指導形態の操作（作成・改名・並び替え・無効化・削除）
  // ========================================

  // 形態を新規作成 → 一覧を再読込 → 新タブへ切替
  const handleCreateFormation = async () => {
    const label = newFormationLabel.trim();
    if (!label) return;
    try {
      const created = await createFormation(label);
      setAddingFormation(false);
      setNewFormationLabel('');
      await loadFormations();
      setSelectedFormation(created.key);
      success(`形態「${created.label}」を追加しました`);
    } catch (e) {
      toastError((e as Error).message);
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
      await loadFormations();
      success('形態名を変更しました');
    } catch (e) {
      toastError((e as Error).message);
    }
  };

  // 形態の有効/無効を切替
  const handleToggleActive = async (f: ScheduleFormation) => {
    setMenuOpenKey(null);
    try {
      await setFormationActive(f.key, !f.is_active);
      // 無効化した形態が選択中なら個別へ戻す
      if (f.is_active && selectedFormation === f.key) {
        setSelectedFormation(INDIVIDUAL_FORMATION);
      }
      await loadFormations();
      success(f.is_active ? '形態を無効化しました' : '形態を有効化しました');
    } catch (e) {
      toastError((e as Error).message);
    }
  };

  // 形態の並び順を上下に移動。
  // 個別・小集団（is_system）も並び替え対象に含め、表示フィルタ（無効を隠す等）に
  // 関係なく全形態（無効含む）を sort_order 順に並べたリストの中で隣接入れ替えする。
  // 表示中リストだけで隣接判定すると、無効形態を挟んだときに交換相手がズレる。
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
      await loadFormations();
    } catch (e) {
      toastError((e as Error).message);
    }
  };

  // 形態を物理削除（参照ありは API 側で 23503 → フレンドリーエラー）
  const handleDeleteFormation = async () => {
    if (!deleteFormationTarget) return;
    const target = deleteFormationTarget;
    try {
      await deleteFormation(target.key);
      setDeleteFormationTarget(null);
      if (selectedFormation === target.key) {
        setSelectedFormation(INDIVIDUAL_FORMATION);
      }
      await loadFormations();
      success('形態を削除しました');
    } catch (e) {
      // 「使用中のため削除できません。無効化してください。」等
      setDeleteFormationTarget(null);
      toastError((e as Error).message);
    }
  };

  if (!profile) {
    return (
      <AdminLayout headerTitle="設定">
        <Loading size="md" />
      </AdminLayout>
    );
  }
  if (!isManagerOrAbove(profile.role)) {
    return (
      <AdminLayout headerTitle="設定">
        <AccessDenied message="コマ時間設定は管理者のみ利用できます。" />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="設定">
      <div className="space-y-6">
        {/* 上段: 戻る/タイトル と 教室選択・コマ追加 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/settings"
              className="text-sm text-[var(--paragraph)] hover:text-[var(--primary)]"
            >
              ← 設定に戻る
            </Link>
            <h1 className="text-text-headingxl font-bold text-[var(--headline)]">コマ時間設定</h1>
          </div>
          <div className="flex items-center gap-4">
            <Select value={selectedSchoolId} onValueChange={setSelectedSchoolId}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="教室を選択">{selectedSchool?.name}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {schools.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={() => {
                setEditingSlot(null);
                setFormOpen(true);
              }}
              disabled={atSlotCap}
              title={atSlotCap ? `コマ数の上限（${MAX_TIME_SLOTS}）に達しています` : undefined}
            >
              コマを追加
            </Button>
          </div>
        </div>

        {/* 中段: 指導形態タブバー（schedule_formations マスタ駆動） */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {visibleFormations.map((f) => {
              const isSelected = selectedFormation === f.key;
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
                    onClick={() => setSelectedFormation(f.key)}
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
                  {canManageFormations && (
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
                    <FormationMenu
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
            {canManageFormations &&
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
          {canManageFormations && (
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

        <Card>
          <CardHeader>
            <CardTitle>コマ時間一覧</CardTitle>
          </CardHeader>
          <CardContent>
            <TimeSlotTable
              slots={slots}
              onEdit={(s) => {
                setEditingSlot(s);
                setFormOpen(true);
              }}
              onDelete={handleDeleteClick}
              onMove={handleMove}
              onToggleActive={handleToggleSlotActive}
              onAdd={() => {
                setEditingSlot(null);
                setFormOpen(true);
              }}
              isLoading={isLoading}
            />
          </CardContent>
        </Card>
      </div>

      <TimeSlotForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditingSlot(null);
        }}
        onSubmit={handleSave}
        editingSlot={editingSlot}
        nextSlotNumber={nextSlotNumber}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>コマ時間を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingSlot &&
                `${deletingSlot.slot_number}限 ${deletingSlot.start_time?.slice(0, 5)}-${deletingSlot.end_time?.slice(0, 5)} を削除します。`}
              通塾日程またはスケジュールで使用中の場合は削除できません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteDialogOpen(false)}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-[#d9376e] text-white hover:bg-[#c02d5a] transition-colors duration-150"
            >
              削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}

/**
 * 形態タブの操作メニュー（改名 / 並び替え / 無効化・有効化 / 削除）。
 * Popover プリミティブが無いため、外側クリックで閉じる軽量ドロップダウンとして実装する。
 * individual/group（is_system）は並び替えのみ許可し、改名・無効化・削除は
 * disabled にした上で title に理由を表示する（システム標準の形態のため変更不可）。
 */
function FormationMenu({
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
