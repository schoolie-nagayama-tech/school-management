'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { SelectShadcn as Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui';
import { Button } from '@/components/ui';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui';
import { ToastContainer } from '@/components/ui';
import { TimeSlotForm, TimeSlotTable } from '@/components/schedule';
import { useToast } from '@/hooks/useToast';
import { getSchools } from '@/lib/api/schools';
import {
  getTimeSlots,
  createTimeSlot,
  updateTimeSlot,
  deleteTimeSlot,
  isTimeSlotInUse,
} from '@/lib/api/schedule';
import type { ScheduleTimeSlot, ScheduleTimeSlotFormData } from '@/types/schedule';
import type { School } from '@/types/database';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';

export default function TimeSlotsPage() {
  const { profile } = useAuth();
  const { toasts, removeToast, success, error: toastError } = useToast();
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('');
  const [slots, setSlots] = useState<ScheduleTimeSlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<ScheduleTimeSlot | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingSlot, setDeletingSlot] = useState<ScheduleTimeSlot | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getSchools();
        setSchools(data);
        if (data.length > 0 && !selectedSchoolId) setSelectedSchoolId(data[0].id);
      } catch {
        toastError('教室の取得に失敗しました');
      }
    };
    load();
  }, [toastError]);

  useEffect(() => {
    if (!selectedSchoolId) return;
    setIsLoading(true);
    getTimeSlots(selectedSchoolId)
      .then(setSlots)
      .catch(() => toastError('コマ時間の取得に失敗しました'))
      .finally(() => setIsLoading(false));
  }, [selectedSchoolId, toastError]);

  const selectedSchool = schools.find((s) => s.id === selectedSchoolId);
  const nextSlotNumber = Math.max(0, ...slots.map((s) => s.slot_number)) + 1;
  const nextDisplayOrder = Math.max(0, ...slots.map((s) => s.display_order)) + 1;

  const handleSave = async (form: ScheduleTimeSlotFormData) => {
    if (!selectedSchoolId) return;
    try {
      if (editingSlot) {
        await updateTimeSlot(editingSlot.id, form);
        success('コマ時間を更新しました');
      } else {
        await createTimeSlot(selectedSchoolId, form);
        success('コマ時間を追加しました');
      }
      const data = await getTimeSlots(selectedSchoolId);
      setSlots(data);
      setFormOpen(false);
      setEditingSlot(null);
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
      await deleteTimeSlot(deletingSlot.id);
      success('コマ時間を削除しました');
      const data = await getTimeSlots(selectedSchoolId!);
      setSlots(data);
      setDeleteDialogOpen(false);
      setDeletingSlot(null);
    } catch (e) {
      toastError((e as Error).message);
    }
  };

  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';
  if (!profile) {
    return (
      <AdminLayout headerTitle="座席表">
        <div className="py-8 text-center text-[#2a2a2a]">読み込み中...</div>
      </AdminLayout>
    );
  }
  if (!isAdmin) {
    return (
      <AdminLayout headerTitle="座席表">
        <AccessDenied message="座席表の設定は管理者のみ利用できます。" />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="座席表">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/schedule" className="text-sm text-[#2a2a2a] hover:text-[#ff8e3c]">
              ← 座席表に戻る
            </Link>
            <h1 className="text-2xl font-bold text-[#0d0d0d]">コマ時間設定</h1>
          </div>
          <div className="flex items-center gap-4">
            <Select value={selectedSchoolId} onValueChange={setSelectedSchoolId}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="教室を選択">
                  {selectedSchool?.name}
                </SelectValue>
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
            >
              コマを追加
            </Button>
          </div>
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
        nextDisplayOrder={nextDisplayOrder}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>コマ時間を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingSlot && `${deletingSlot.slot_number}限 ${deletingSlot.start_time?.slice(0, 5)}-${deletingSlot.end_time?.slice(0, 5)} を削除します。`}
              通塾日程またはスケジュールで使用中の場合は削除できません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteDialogOpen(false)}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-[#d9376e] text-white hover:bg-[#c02d5a]"
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
