'use client';

/**
 * 「授業の設定」ページのコマ時間セクション。
 *
 * 旧「コマ時間設定」ページ（/settings/time-slots）の一覧＋追加・編集・削除をそのまま移植した。
 * 対象は「選択中の教室 × 選択中の指導形態」。形態ごとにコマ時間は独立採番される。
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui';
import { TimeSlotForm } from '@/components/schedule/TimeSlotForm';
import { TimeSlotTable } from '@/components/schedule/TimeSlotTable';
import {
  getTimeSlots,
  createTimeSlot,
  updateTimeSlot,
  deleteTimeSlot,
  isTimeSlotInUse,
  reorderTimeSlots,
} from '@/lib/api/schedule';
import type { ScheduleTimeSlot, ScheduleTimeSlotFormData } from '@/types/schedule';

/** コマ数の上限（DB CHECK制約 slot_number 1〜20 と合わせる） */
const MAX_TIME_SLOTS = 20;

interface Props {
  schoolId: string;
  /** 選択中の指導形態 key */
  formationKey: string;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  /** コマ時間を書き換えたら親に知らせる（講座フォームのコマ候補を作り直すため） */
  onSlotsChanged?: () => void;
}

export function TimeSlotSection({
  schoolId,
  formationKey,
  onSuccess,
  onError,
  onSlotsChanged,
}: Props) {
  const [slots, setSlots] = useState<ScheduleTimeSlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<ScheduleTimeSlot | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingSlot, setDeletingSlot] = useState<ScheduleTimeSlot | null>(null);

  const reload = useCallback(async () => {
    if (!schoolId) {
      setSlots([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      setSlots(await getTimeSlots(schoolId, formationKey));
    } catch {
      onError('コマ時間の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [schoolId, formationKey, onError]);

  useEffect(() => {
    reload();
  }, [reload]);

  const nextSlotNumber = Math.max(0, ...slots.map((s) => s.slot_number)) + 1;
  // 現在の形態のコマ数が上限に達したら追加できないようにする
  const atSlotCap = slots.length >= MAX_TIME_SLOTS;

  const handleSave = async (form: ScheduleTimeSlotFormData) => {
    if (!schoolId) return;
    try {
      if (editingSlot) {
        // 編集時は元のコマの formation を維持（タブ切替で誤って付け替えないように）
        await updateTimeSlot(editingSlot.id, { ...form, formation: editingSlot.formation });
        onSuccess('コマ時間を更新しました');
      } else {
        // 新規は現在表示中の formation（タブ）で作成
        await createTimeSlot(schoolId, { ...form, formation: formationKey });
        onSuccess('コマ時間を追加しました');
      }
      await reload();
      onSlotsChanged?.();
      setFormOpen(false);
      setEditingSlot(null);
    } catch (e) {
      onError((e as Error).message);
    }
  };

  // 上下並び替え → display_order に新しい表示順を書き込んでから
  // RPC(reorder_time_slots)で slot_number を連番に詰め直す。
  // display_order 自体には一意制約が無いため、個別 PATCH を並行実行しても衝突しない。
  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= slots.length || !schoolId) return;
    const newSlots = [...slots];
    [newSlots[index], newSlots[swapIndex]] = [newSlots[swapIndex], newSlots[index]];
    setSlots(newSlots);
    try {
      await Promise.all(newSlots.map((s, i) => updateTimeSlot(s.id, { display_order: i })));
      await reorderTimeSlots(schoolId, formationKey);
      await reload();
      onSlotsChanged?.();
    } catch (e) {
      onError((e as Error).message);
      await reload();
    }
  };

  // 有効/無効バッジのインライントグル。編集ダイアログを開かず即切替する
  const handleToggleSlotActive = async (slot: ScheduleTimeSlot) => {
    if (!schoolId) return;
    try {
      await updateTimeSlot(slot.id, { is_active: !slot.is_active });
      await reload();
      onSlotsChanged?.();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingSlot || !schoolId) return;
    try {
      const inUse = await isTimeSlotInUse(deletingSlot.id);
      if (inUse) {
        onError('このコマは通塾日程またはスケジュールで使用中のため削除できません。');
        setDeleteDialogOpen(false);
        setDeletingSlot(null);
        return;
      }
      await deleteTimeSlot(deletingSlot.id, schoolId);
      // 削除後にコマ番号の欠番を詰め直す。display_order は変更不要
      // （残った行どうしの相対順序は変わらないため、RPCを呼ぶだけでよい）
      const remaining = slots.filter((s) => s.id !== deletingSlot.id);
      if (remaining.length > 0) {
        await reorderTimeSlots(schoolId, formationKey);
      }
      onSuccess('コマ時間を削除しました');
      await reload();
      onSlotsChanged?.();
      setDeleteDialogOpen(false);
      setDeletingSlot(null);
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">コマ時間</CardTitle>
            <p className="mt-1 text-xs text-[var(--paragraph)]">
              この形態の授業コマの時間帯です。座席表の行になります。
            </p>
          </div>
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
        </CardHeader>
        <CardContent>
          <TimeSlotTable
            slots={slots}
            onEdit={(s) => {
              setEditingSlot(s);
              setFormOpen(true);
            }}
            onDelete={(s) => {
              setDeletingSlot(s);
              setDeleteDialogOpen(true);
            }}
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
    </>
  );
}
