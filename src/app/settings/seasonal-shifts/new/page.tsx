'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Button, ToastContainer, Loading } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useAuth } from '@/contexts/AuthContext';
import { getDefaultSchoolId } from '@/lib/api/schools';
import { createSeasonalShiftSetting, setSeasonalShiftSlotSettings } from '@/lib/api/seasonal-shift';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { ShiftSlotMatrix, type SlotSettingRow } from '@/components/seasonal-shift/ShiftSlotMatrix';
import { generateDefaultSlotSettings } from '@/lib/utils/seasonalShiftSlots';
import { useMasterTimeSlots } from '@/hooks/useMasterTimeSlots';

export default function NewSeasonalShiftPage() {
  const router = useRouter();
  const { getSelectedSchoolIds } = useAuth();
  const { toasts, removeToast, success, error } = useToast();
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessPortal ?? false
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [slotSettings, setSlotSettings] = useState<SlotSettingRow[]>([]);
  const { slots: masterSlots, slotsString: masterSlotsString, isLoading: masterLoading } =
    useMasterTimeSlots();
  const [form, setForm] = useState({
    name: '',
    start_date: '',
    end_date: '',
    deadline: '',
    description: '',
    status: 'draft' as 'draft' | 'published',
  });

  const timeSlotsArray = masterSlots;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const schoolIds = getSelectedSchoolIds();
    const schoolId = schoolIds.length > 0 ? schoolIds[0] : getDefaultSchoolId();
    if (masterSlots.length === 0) {
      error('コマ時間マスタが未設定です。先に時間帯マスタを登録してください。');
      return;
    }
    setIsSubmitting(true);
    try {
      const created = await createSeasonalShiftSetting({
        school_id: schoolId,
        name: form.name.trim(),
        start_date: form.start_date,
        end_date: form.end_date,
        deadline: form.deadline,
        description: form.description.trim(),
        // 平日/土曜の時間帯は常にコマ時間マスタの値を採用する（手動編集は廃止）
        weekday_slots: masterSlotsString,
        saturday_slots: masterSlotsString,
        status: form.status,
      });
      const slotsToSave =
        slotSettings.length > 0
          ? slotSettings.map((s) => ({ ...s, setting_id: created.id }))
          : generateDefaultSlotSettings(form.start_date, form.end_date, timeSlotsArray).map((s) => ({
              ...s,
              setting_id: created.id,
            }));
      if (slotsToSave.length > 0) {
        await setSeasonalShiftSlotSettings(created.id, slotsToSave);
      }
      success('シフト設定を作成しました');
      router.push(`/settings/seasonal-shifts/${created.id}`);
    } catch (err) {
      error(err instanceof Error ? err.message : '作成に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (permissionLoading) {
    return (
      <AdminLayout>
        <Loading className="min-h-[40vh]" />
      </AdminLayout>
    );
  }
  if (!hasPermission) {
    return (
      <AdminLayout>
        <AccessDenied />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="講習シフト 新規作成">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div className="max-w-2xl">
        <Link
          href="/settings/seasonal-shifts"
          className="text-sm text-info hover:underline mb-4 inline-block"
        >
          ← 一覧に戻る
        </Link>
        <form onSubmit={handleSubmit} className="bg-surface-raised rounded-xl border border-border p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-heading mb-1">講習期間名 *</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="例：2026年春期講習"
              className="w-full px-3 py-2 border border-border rounded-lg text-sm"
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-heading mb-1">開始日 *</label>
              <input
                type="date"
                required
                value={form.start_date}
                onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-heading mb-1">終了日 *</label>
              <input
                type="date"
                required
                value={form.end_date}
                onChange={(e) => setForm((p) => ({ ...p, end_date: e.target.value }))}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-heading mb-1">提出締切日 *</label>
              <input
                type="date"
                required
                value={form.deadline}
                onChange={(e) => setForm((p) => ({ ...p, deadline: e.target.value }))}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-heading mb-1">説明文</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              rows={3}
              placeholder="提出フォームに表示する説明"
              className="w-full px-3 py-2 border border-border rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-heading mb-1">時間帯</label>
            <div className="px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text-body">
              {masterLoading
                ? '読み込み中...'
                : masterSlots.length > 0
                ? masterSlots.join('、')
                : 'コマ時間マスタが未設定です'}
            </div>
            <p className="mt-1 text-xs text-text-muted">
              <Link href="/schedule" className="text-info hover:underline">
                コマ時間マスタ
              </Link>
              で設定中の時間帯を使用します。
            </p>
          </div>
          {form.start_date && form.end_date && timeSlotsArray.length > 0 && (
            <div className="border-t border-border pt-4">
              <ShiftSlotMatrix
                startDate={form.start_date}
                endDate={form.end_date}
                timeSlots={timeSlotsArray}
                value={slotSettings}
                onChange={setSlotSettings}
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-text-heading mb-1">ステータス</label>
            <select
              value={form.status}
              onChange={(e) =>
                setForm((p) => ({ ...p, status: e.target.value as 'draft' | 'published' }))
              }
              className="w-full px-3 py-2 border border-border rounded-lg text-sm"
            >
              <option value="draft">下書き</option>
              <option value="published">公開中</option>
            </select>
          </div>
          <div className="flex gap-3 pt-4">
            <Button type="submit" disabled={isSubmitting} className="bg-danger hover:bg-danger/80 text-white transition-colors duration-150">
              {isSubmitting ? '作成中...' : '作成'}
            </Button>
            <Link href="/settings/seasonal-shifts">
              <Button type="button" variant="outline">
                キャンセル
              </Button>
            </Link>
          </div>
        </form>
      </div>
    </AdminLayout>
  );
}
