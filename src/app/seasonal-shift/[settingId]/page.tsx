'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  getPublishedSeasonalShiftSettingPublic,
  createSeasonalShiftSubmission,
} from '@/lib/api/seasonal-shift';
import type { SeasonalShiftSetting } from '@/types/seasonal-shift';
import { Loading } from '@/components/ui';

type SlotKey = string; // "YYYY-MM-DD|HH:MM-HH:MM"

function getDatesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  const d = new Date(start);
  const endDate = new Date(end);
  while (d <= endDate) {
    dates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

/**
 * 季節シフト提出ページ（公開・ログイン不要）。
 * 既存提出の修正は `/seasonal-shift/[settingId]/edit/[editToken]` 経由で行うため、
 * このページは新規提出専用とし、サーバー側のユニーク制約 (teacher_email × setting_id)
 * で多重提出を 409 として返す。
 */
export default function SeasonalShiftFormPage() {
  const params = useParams();
  const settingId = params.settingId as string;

  const [setting, setSetting] = useState<SeasonalShiftSetting | null>(null);
  const [slotSettings, setSlotSettings] = useState<
    { slot_date: string; time_slot: string; is_open: boolean }[]
  >([]);
  const [selected, setSelected] = useState<Set<SlotKey>>(new Set());
  const [teacherName, setTeacherName] = useState('');
  const [teacherEmail, setTeacherEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const fetchData = useCallback(async () => {
    if (!settingId) return;
    setIsLoading(true);
    setErrorMessage('');
    try {
      const result = await getPublishedSeasonalShiftSettingPublic(settingId);
      if (!result) {
        setSetting(null);
        return;
      }
      setSetting(result.setting);
      setSlotSettings(
        result.slotSettings.map((r) => ({
          slot_date: r.slot_date,
          time_slot: r.time_slot,
          is_open: r.is_open,
        }))
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : '読み込みに失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [settingId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const dates = setting ? getDatesBetween(setting.start_date, setting.end_date) : [];
  const timeSlots = setting
    ? setting.weekday_slots
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    : [];
  const slotMatrix: { date: string; slot: string; key: SlotKey; available: boolean }[] = [];
  if (setting) {
    dates.forEach((dateStr) => {
      timeSlots.forEach((slot) => {
        const key: SlotKey = `${dateStr}|${slot}`;
        const slotRow = slotSettings.find((s) => s.slot_date === dateStr && s.time_slot === slot);
        slotMatrix.push({ date: dateStr, slot, key, available: slotRow?.is_open ?? false });
      });
    });
  }

  const toggle = (key: SlotKey) => {
    const cell = slotMatrix.find((c) => c.key === key);
    if (!cell || !cell.available) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleColumn = (slot: string) => {
    const available = slotMatrix.filter((c) => c.slot === slot && c.available);
    const allChecked = available.every((c) => selected.has(c.key));
    setSelected((prev) => {
      const next = new Set(prev);
      available.forEach((c) => (allChecked ? next.delete(c.key) : next.add(c.key)));
      return next;
    });
  };

  const toggleRow = (date: string) => {
    const available = slotMatrix.filter((c) => c.date === date && c.available);
    const allChecked = available.every((c) => selected.has(c.key));
    setSelected((prev) => {
      const next = new Set(prev);
      available.forEach((c) => (allChecked ? next.delete(c.key) : next.add(c.key)));
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setting) return;
    if (!teacherName.trim() || !teacherEmail.trim()) {
      setErrorMessage('名前とメールアドレスを入力してください');
      return;
    }
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const slots = Array.from(selected).map((key) => {
        const [date, timeSlot] = key.split('|');
        return { shift_date: date, time_slot: timeSlot, available: true as const };
      });
      await createSeasonalShiftSubmission(
        {
          setting_id: settingId,
          school_id: setting.school_id,
          teacher_name: teacherName.trim(),
          teacher_email: teacherEmail.trim(),
          notes: notes.trim(),
        },
        slots
      );
      setIsDone(true);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : '提出に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── データローディング ───
  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface-hover flex items-center justify-center">
        <Loading />
      </div>
    );
  }

  // ─── 設定なし ───
  if (!setting) {
    return (
      <div className="min-h-screen bg-surface-hover flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-xl font-bold text-text-heading mb-2">
            このシフト提出は現在受付していません
          </h1>
          <p className="text-text-body text-sm">URLをご確認ください。</p>
        </div>
      </div>
    );
  }

  // ─── 提出完了 ───
  if (isDone) {
    return (
      <div className="min-h-screen bg-surface-hover">
        <div className="max-w-lg mx-auto px-4 py-8">
          <div className="bg-surface-raised rounded-xl border border-border p-8 text-center">
            <h2 className="text-xl font-bold text-text-heading mb-4">
              シフト提出が完了しました
            </h2>
            <p className="text-text-body text-sm">ご提出ありがとうございました。</p>
          </div>
        </div>
      </div>
    );
  }

  // ─── 提出フォーム ───
  const uniqueSlots = [...timeSlots];
  const uniqueDates = [...dates];

  return (
    <div className="min-h-screen bg-surface-hover">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-surface-raised rounded-xl border border-border p-6 mb-6">
          <h1 className="text-2xl font-bold text-text-heading mb-2">{setting.name}</h1>
          {setting.description && (
            <p className="text-text-body whitespace-pre-line mb-4">{setting.description}</p>
          )}
          <p className="text-sm text-text-muted">
            締切: {new Date(setting.deadline + 'T23:59:59').toLocaleDateString('ja-JP')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-surface-raised rounded-xl border border-border p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-text-heading mb-1">お名前 *</label>
            <input
              type="text"
              required
              value={teacherName}
              onChange={(e) => setTeacherName(e.target.value)}
              className="w-full max-w-md px-3 py-2 border border-border rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-heading mb-1">メールアドレス *</label>
            <input
              type="email"
              required
              value={teacherEmail}
              onChange={(e) => setTeacherEmail(e.target.value)}
              className="w-full max-w-md px-3 py-2 border border-border rounded-lg text-sm"
            />
          </div>

          <div>
            <h2 className="text-lg font-semibold text-text-heading mb-2">出勤可能日時</h2>
            <p className="text-sm text-text-body mb-3">
              出勤可能なコマにチェックを入れてください。丸ボタンで日付・時間帯を一括で選択できます。
            </p>
            <div className="flex flex-wrap gap-2 mb-4">
              {uniqueSlots.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  onClick={() => toggleColumn(slot)}
                  title={`${slot}を一括選択`}
                  className="px-2 py-1.5 text-xs font-medium rounded-lg border border-border bg-surface-raised text-text-heading hover:bg-surface-hover active:bg-border transition-colors duration-150"
                >
                  {slot}
                </button>
              ))}
            </div>
            <div className="space-y-4">
              {uniqueDates.map((dateStr) => {
                const dayLabel = new Date(dateStr + 'T12:00:00').toLocaleDateString('ja-JP', {
                  month: 'numeric',
                  day: 'numeric',
                  weekday: 'short',
                });
                const hasOpen = slotMatrix.some((c) => c.date === dateStr && c.available);
                return (
                  <div
                    key={dateStr}
                    className="rounded-xl border-2 border-border bg-surface overflow-hidden shadow-sm"
                  >
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-surface-raised">
                      {hasOpen && (
                        <button
                          type="button"
                          onClick={() => toggleRow(dateStr)}
                          title="この日を一括選択"
                          className="w-7 h-7 rounded-full bg-gray-300 hover:bg-gray-400 active:bg-gray-500 transition-colors shrink-0 flex items-center justify-center"
                          aria-label="この日を一括選択"
                        >
                          <span className="text-xs text-gray-600 font-medium">全</span>
                        </button>
                      )}
                      <span className="text-sm font-semibold text-text-heading">{dayLabel}</span>
                    </div>
                    <div className="grid grid-cols-1 gap-1 p-3">
                      {uniqueSlots.map((slot) => {
                        const key: SlotKey = `${dateStr}|${slot}`;
                        const cell = slotMatrix.find((c) => c.key === key);
                        if (!cell?.available) return null;
                        const checked = selected.has(key);
                        return (
                          <label
                            key={key}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm cursor-pointer min-h-[2.75rem] transition-colors ${
                              checked
                                ? 'bg-blue-100 border-2 border-blue-200 hover:bg-blue-100'
                                : 'bg-surface-raised border-2 border-transparent hover:bg-surface-raised/90'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggle(key)}
                              className="w-5 h-5 text-info rounded cursor-pointer shrink-0"
                            />
                            <span className="text-text-heading font-medium">{slot}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-heading mb-1">備考</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm"
            />
          </div>

          {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="px-6 py-3 bg-[#d32f2f] hover:bg-[#b71c1c] disabled:opacity-50 text-white font-semibold rounded-lg transition-colors duration-150"
          >
            {isSubmitting ? '送信中...' : '提出する'}
          </button>
        </form>
      </div>
    </div>
  );
}
