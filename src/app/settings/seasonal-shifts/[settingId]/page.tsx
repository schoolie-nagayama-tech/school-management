'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Button, ToastContainer, Loading } from '@/components/ui';
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
import { useMasterTimeSlots } from '@/hooks/useMasterTimeSlots';

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
  const {
    slots: masterSlots,
    slotsString: masterSlotsString,
    isLoading: masterLoading,
  } = useMasterTimeSlots();
  const [form, setForm] = useState({
    name: '',
    start_date: '',
    end_date: '',
    deadline: '',
    description: '',
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
        status: s.status,
      });
      // 時間帯はマスタから引くため、ここでは既存スロット設定の is_open のみを引き継ぐ
      setSlotSettings(
        slots.map((row) => ({
          slot_date: row.slot_date,
          time_slot: row.time_slot,
          is_open: row.is_open,
        }))
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

  const timeSlotsArray = masterSlots;

  // 既存 slot_settings をマスタ時間帯にリキー: 一致行は is_open 維持、不足はデフォルト生成
  const mergedSlotSettings = (() => {
    if (!form.start_date || !form.end_date || timeSlotsArray.length === 0) return [];
    const defaults = generateDefaultSlotSettings(form.start_date, form.end_date, timeSlotsArray);
    const existingByKey = new Map<string, boolean>(
      slotSettings.map((row) => [`${row.slot_date}|${row.time_slot}`, row.is_open])
    );
    return defaults.map((row) => {
      const key = `${row.slot_date}|${row.time_slot}`;
      const existing = existingByKey.get(key);
      return existing !== undefined ? { ...row, is_open: existing } : row;
    });
  })();

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settingId) return;
    if (masterSlots.length === 0) {
      error('コマ時間マスタが未設定です。先に時間帯マスタを登録してください。');
      return;
    }
    setIsSubmitting(true);
    try {
      await updateSeasonalShiftSetting(settingId, {
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
      // マトリクスの値を保存。ユーザー操作分を優先し、未操作の日時はデフォルト値で埋める。
      const editedKeys = new Set(slotSettings.map((s) => `${s.slot_date}|${s.time_slot}`));
      const toSave = mergedSlotSettings.map((s) => {
        const wasEdited = editedKeys.has(`${s.slot_date}|${s.time_slot}`);
        const edited = wasEdited
          ? slotSettings.find((r) => r.slot_date === s.slot_date && r.time_slot === s.time_slot)
          : null;
        return {
          ...(edited ?? s),
          setting_id: settingId,
        };
      });
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
    typeof window !== 'undefined' ? `${window.location.origin}/seasonal-shift/${settingId}` : '';

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
        <Loading size="md" />
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
          className="text-sm text-info hover:underline inline-block"
        >
          ← 一覧に戻る
        </Link>

        {/* 提出URL */}
        <div className="bg-surface-raised rounded-xl border border-border p-4">
          <h2 className="text-sm font-semibold text-text-heading mb-2">講師用提出URL</h2>
          <p className="text-xs text-text-body mb-2">
            このURLを講師に共有すると、シフト提出フォームが開きます。（公開中のみ有効）
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={publicUrl}
              className="flex-1 px-3 py-2 border border-border rounded-lg text-sm bg-surface"
            />
            <Button
              type="button"
              onClick={copyUrl}
              className="bg-text-heading hover:bg-text-heading/90 text-white transition-colors duration-150"
            >
              {copied ? 'コピー済み' : 'コピー'}
            </Button>
          </div>
        </div>

        <form
          onSubmit={handleSave}
          className="bg-surface-raised rounded-xl border border-border p-6 space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-text-heading mb-1">講習期間名 *</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
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
              <label className="block text-sm font-medium text-text-heading mb-1">
                提出締切日 *
              </label>
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
                value={mergedSlotSettings}
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
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-danger hover:bg-danger/80 text-white transition-colors duration-150"
            >
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
