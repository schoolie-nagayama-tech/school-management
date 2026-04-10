'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Button, ToastContainer } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import {
  getSeasonalShiftSetting,
  getSeasonalShiftSlotSettings,
  updateSeasonalShiftSetting,
  setSeasonalShiftSlotSettings,
} from '@/lib/api/seasonal-shift';
import type { SeasonalShiftSetting } from '@/types/seasonal-shift';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { ShiftSlotMatrix, type SlotSettingRow } from '@/components/seasonal-shift/ShiftSlotMatrix';
import { generateDefaultSlotSettings } from '@/lib/utils/seasonalShiftSlots';

export default function SeasonalShiftDetailPage() {
  const params = useParams();
  const router = useRouter();
  const settingId = params.settingId as string;
  const { toasts, removeToast, success, error } = useToast();
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessPortal ?? false
  );
  const [setting, setSetting] = useState<SeasonalShiftSetting | null>(null);
  const [slotSettings, setSlotSettings] = useState<SlotSettingRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({
    name: '',
    start_date: '',
    end_date: '',
    deadline: '',
    description: '',
    weekday_slots: '',
    saturday_slots: '',
    status: 'draft' as 'draft' | 'published',
  });

  const fetchData = useCallback(async () => {
    if (!settingId) return;
    setIsLoading(true);
    try {
      const [s, slots] = await Promise.all([
        getSeasonalShiftSetting(settingId),
        getSeasonalShiftSlotSettings(settingId),
      ]);
      if (!s) {
        router.replace('/settings/seasonal-shifts');
        return;
      }
      setSetting(s);
      setForm({
        name: s.name,
        start_date: s.start_date,
        end_date: s.end_date,
        deadline: s.deadline,
        description: s.description ?? '',
        weekday_slots: s.weekday_slots,
        saturday_slots: s.saturday_slots,
        status: s.status,
      });
      const timeSlotsFromSetting = s.weekday_slots.split(',').map((x) => x.trim()).filter(Boolean);
      setSlotSettings(
        slots.length > 0
          ? slots.map((row) => ({
              slot_date: row.slot_date,
              time_slot: row.time_slot,
              is_open: row.is_open,
            }))
          : generateDefaultSlotSettings(s.start_date, s.end_date, timeSlotsFromSetting)
      );
    } catch (err) {
      console.error(err);
      error(err instanceof Error ? err.message : '取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [settingId, router, error]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const timeSlotsArray = form.weekday_slots
    ? form.weekday_slots.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settingId) return;
    setIsSubmitting(true);
    try {
      await updateSeasonalShiftSetting(settingId, {
        name: form.name.trim(),
        start_date: form.start_date,
        end_date: form.end_date,
        deadline: form.deadline,
        description: form.description.trim(),
        weekday_slots: form.weekday_slots.trim(),
        saturday_slots: form.saturday_slots.trim(),
        status: form.status,
      });
      const toSave =
        slotSettings.length > 0
          ? slotSettings.map((s) => ({ ...s, setting_id: settingId }))
          : generateDefaultSlotSettings(form.start_date, form.end_date, timeSlotsArray).map((s) => ({
              ...s,
              setting_id: settingId,
            }));
      if (toSave.length > 0) {
        await setSeasonalShiftSlotSettings(settingId, toSave);
      }
      success('保存しました');
      fetchData();
    } catch (err) {
      error(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  const publicUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/seasonal-shift/${settingId}`
      : '';

  const copyUrl = () => {
    if (!publicUrl) return;
    navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    success('URLをコピーしました');
    setTimeout(() => setCopied(false), 2000);
  };

  if (permissionLoading || isLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center min-h-[40vh]">
          <p className="text-[#4b5563]">読み込み中...</p>
        </div>
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
  if (!setting) return null;

  return (
    <AdminLayout headerTitle="講習シフト 編集">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div className="max-w-2xl space-y-6">
        <Link
          href="/settings/seasonal-shifts"
          className="text-sm text-[#3b82f6] hover:underline inline-block"
        >
          ← 一覧に戻る
        </Link>

        {/* 提出URL */}
        <div className="bg-white rounded-xl border border-[#e5e7eb] p-4">
          <h2 className="text-sm font-semibold text-[#1f2937] mb-2">講師用提出URL</h2>
          <p className="text-xs text-[#4b5563] mb-2">
            このURLを講師に共有すると、シフト提出フォームが開きます。（公開中のみ有効）
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={publicUrl}
              className="flex-1 px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-[#f9fafb]"
            />
            <Button type="button" onClick={copyUrl} className="bg-[#1f2937] hover:bg-[#111827] text-white">
              {copied ? 'コピー済み' : 'コピー'}
            </Button>
          </div>
        </div>

        <form onSubmit={handleSave} className="bg-white rounded-xl border border-[#e5e7eb] p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-1">講習期間名 *</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm"
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#1f2937] mb-1">開始日 *</label>
              <input
                type="date"
                required
                value={form.start_date}
                onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))}
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#1f2937] mb-1">終了日 *</label>
              <input
                type="date"
                required
                value={form.end_date}
                onChange={(e) => setForm((p) => ({ ...p, end_date: e.target.value }))}
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#1f2937] mb-1">提出締切日 *</label>
              <input
                type="date"
                required
                value={form.deadline}
                onChange={(e) => setForm((p) => ({ ...p, deadline: e.target.value }))}
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-1">説明文</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-1">平日の時間帯 *</label>
            <input
              type="text"
              required
              value={form.weekday_slots}
              onChange={(e) => setForm((p) => ({ ...p, weekday_slots: e.target.value }))}
              className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-1">土曜の時間帯 *</label>
            <input
              type="text"
              required
              value={form.saturday_slots}
              onChange={(e) => setForm((p) => ({ ...p, saturday_slots: e.target.value }))}
              className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm"
            />
          </div>
          {form.start_date && form.end_date && timeSlotsArray.length > 0 && (
            <div className="border-t border-[#e5e7eb] pt-4">
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
            <label className="block text-sm font-medium text-[#1f2937] mb-1">ステータス</label>
            <select
              value={form.status}
              onChange={(e) =>
                setForm((p) => ({ ...p, status: e.target.value as 'draft' | 'published' }))
              }
              className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm"
            >
              <option value="draft">下書き</option>
              <option value="published">公開中</option>
            </select>
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="submit" disabled={isSubmitting} className="bg-[#d32f2f] hover:bg-[#b71c1c] text-white">
              {isSubmitting ? '保存中...' : '保存'}
            </Button>
            <Link href={`/settings/seasonal-shifts/${settingId}/submissions`}>
              <Button type="button" variant="outline">
                提出一覧
              </Button>
            </Link>
          </div>
        </form>
      </div>
    </AdminLayout>
  );
}
