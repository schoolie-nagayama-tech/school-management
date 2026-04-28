'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import {
  getPublishedSeasonalShiftSetting,
  getSeasonalShiftSlotSettings,
  createSeasonalShiftSubmission,
} from '@/lib/api/seasonal-shift';
import type { SeasonalShiftSetting } from '@/types/seasonal-shift';

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

export default function SeasonalShiftFormPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const settingId = params.settingId as string;
  const submitted = searchParams.get('submitted') === '1';

  const [setting, setSetting] = useState<SeasonalShiftSetting | null>(null);
  const [slotSettings, setSlotSettings] = useState<{ slot_date: string; time_slot: string; is_open: boolean }[]>([]);
  const [selected, setSelected] = useState<Set<SlotKey>>(new Set());
  const [teacherName, setTeacherName] = useState('');
  const [teacherEmail, setTeacherEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const fetchData = useCallback(async () => {
    if (!settingId) return;
    setIsLoading(true);
    setErrorMessage('');
    try {
      const [s, slots] = await Promise.all([
        getPublishedSeasonalShiftSetting(settingId),
        getSeasonalShiftSlotSettings(settingId),
      ]);
      if (!s) {
        setSetting(null);
        setIsLoading(false);
        return;
      }
      setSetting(s);
      setSlotSettings(slots.map((r) => ({ slot_date: r.slot_date, time_slot: r.time_slot, is_open: r.is_open })));
    } catch (err) {
      console.error(err);
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
    ? setting.weekday_slots.split(',').map((x) => x.trim()).filter(Boolean)
    : [];
  const slotMatrix: { date: string; slot: string; key: SlotKey; available: boolean }[] = [];
  if (setting) {
    dates.forEach((dateStr) => {
      timeSlots.forEach((slot) => {
        const key: SlotKey = `${dateStr}|${slot}`;
        const slotRow = slotSettings.find((s) => s.slot_date === dateStr && s.time_slot === slot);
        const available = slotRow?.is_open ?? false;
        slotMatrix.push({ date: dateStr, slot, key, available });
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
    const availableInColumn = slotMatrix.filter((c) => c.slot === slot && c.available);
    const allChecked = availableInColumn.every((c) => selected.has(c.key));
    const newValue = !allChecked;
    setSelected((prev) => {
      const next = new Set(prev);
      availableInColumn.forEach((c) => {
        if (newValue) next.add(c.key);
        else next.delete(c.key);
      });
      return next;
    });
  };

  const toggleRow = (date: string) => {
    const availableInRow = slotMatrix.filter((c) => c.date === date && c.available);
    const allChecked = availableInRow.every((c) => selected.has(c.key));
    const newValue = !allChecked;
    setSelected((prev) => {
      const next = new Set(prev);
      availableInRow.forEach((c) => {
        if (newValue) next.add(c.key);
        else next.delete(c.key);
      });
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
        return { shift_date: date, time_slot: timeSlot, available: true };
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
      window.location.href = `?submitted=1`;
    } catch (err) {
      console.error(err);
      setErrorMessage(err instanceof Error ? err.message : '提出に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f3f4f6] flex items-center justify-center">
        <p className="text-[#4b5563]">読み込み中...</p>
      </div>
    );
  }
  if (!setting) {
    return (
      <div className="min-h-screen bg-[#f3f4f6] flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-xl font-bold text-[#1f2937] mb-2">
            このシフト提出は現在受付していません
          </h1>
          <p className="text-[#4b5563] text-sm">URLをご確認ください。</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#f3f4f6]">
        <div className="max-w-lg mx-auto px-4 py-8">
          <div className="bg-white rounded-xl border border-[#e5e7eb] p-8 text-center">
            <h2 className="text-xl font-bold text-[#1f2937] mb-4">シフト提出が完了しました</h2>
            <p className="text-[#4b5563] mb-6">
              確認メールをお送りしました。内容をご確認ください。
            </p>
          </div>
        </div>
      </div>
    );
  }

  const uniqueSlots = [...timeSlots];
  const uniqueDates = [...dates];

  return (
    <div className="min-h-screen bg-[#f3f4f6]">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white rounded-xl border border-[#e5e7eb] p-6 mb-6">
          <h1 className="text-2xl font-bold text-[#1f2937] mb-2">{setting.name}</h1>
          {setting.description && (
            <p className="text-[#4b5563] whitespace-pre-line mb-4">{setting.description}</p>
          )}
          <p className="text-sm text-[#6b7280]">
            締切: {new Date(setting.deadline + 'T23:59:59').toLocaleDateString('ja-JP')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-[#e5e7eb] p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-1">お名前 *</label>
            <input
              type="text"
              required
              value={teacherName}
              onChange={(e) => setTeacherName(e.target.value)}
              className="w-full max-w-md px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-1">メールアドレス *</label>
            <input
              type="email"
              required
              value={teacherEmail}
              onChange={(e) => setTeacherEmail(e.target.value)}
              className="w-full max-w-md px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm"
            />
          </div>

          <div>
            <h2 className="text-lg font-semibold text-[#1f2937] mb-2">出勤可能日時</h2>
            <p className="text-sm text-[#4b5563] mb-3">
              出勤可能なコマにチェックを入れてください。丸ボタンで日付・時間帯を一括で選択できます。
            </p>
            {/* 時間帯で一括選択（横スクロールなし・折り返し） */}
            <div className="flex flex-wrap gap-2 mb-4">
              {uniqueSlots.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  onClick={() => toggleColumn(slot)}
                  title={`${slot}を一括選択`}
                  className="px-2 py-1.5 text-xs font-medium rounded-lg border border-[#e5e7eb] bg-white text-[#1f2937] hover:bg-[#f3f4f6] active:bg-[#e5e7eb] transition-colors duration-150"
                >
                  {slot}
                </button>
              ))}
            </div>
            {/* 日付ごとのブロック（1列表示で時間は1行・区切りとタップ領域を強化） */}
            <div className="space-y-4">
              {uniqueDates.map((dateStr) => {
                const dayLabel = new Date(dateStr + 'T12:00:00').toLocaleDateString('ja-JP', {
                  month: 'numeric',
                  day: 'numeric',
                  weekday: 'short',
                });
                const hasOpenInRow = slotMatrix.some((c) => c.date === dateStr && c.available);
                return (
                  <div
                    key={dateStr}
                    className="rounded-xl border-2 border-[#e5e7eb] bg-[#f9fafb] overflow-hidden shadow-sm"
                  >
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-[#e5e7eb] bg-white">
                      {hasOpenInRow && (
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
                      <span className="text-sm font-semibold text-[#1f2937]">{dayLabel}</span>
                    </div>
                    <div className="grid grid-cols-1 gap-1 p-3">
                      {uniqueSlots.map((slot) => {
                        const key: SlotKey = `${dateStr}|${slot}`;
                        const cell = slotMatrix.find((c) => c.key === key);
                        const available = cell?.available ?? false;
                        if (!available) return null;
                        const checked = selected.has(key);
                        return (
                          <label
                            key={key}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm cursor-pointer min-h-[2.75rem] transition-colors ${
                              checked
                                ? 'bg-blue-100 border-2 border-blue-200 hover:bg-blue-100'
                                : 'bg-white border-2 border-transparent hover:bg-white/90'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggle(key)}
                              className="w-5 h-5 text-[#3b82f6] rounded cursor-pointer shrink-0"
                            />
                            <span className="text-[#1f2937] font-medium">{slot}</span>
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
            <label className="block text-sm font-medium text-[#1f2937] mb-1">備考</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm"
            />
          </div>

          {errorMessage && (
            <p className="text-sm text-red-600">{errorMessage}</p>
          )}

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
