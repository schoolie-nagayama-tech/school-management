'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase';
import {
  getPublishedSeasonalShiftSetting,
  getSeasonalShiftSlotSettings,
  createMySeasonalShiftSubmission,
  getMySeasonalShiftSubmission,
  updateMySeasonalShiftSubmission,
} from '@/lib/api/seasonal-shift';
import type { SeasonalShiftSetting, SubmissionWithSlots } from '@/types/seasonal-shift';
import type { UserProfile } from '@/types/database';

type SlotKey = string; // "YYYY-MM-DD|HH:MM-HH:MM"
type AuthState = 'loading' | 'unauthenticated' | 'authenticated';

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
  const settingId = params.settingId as string;

  const [authState, setAuthState] = useState<AuthState>('loading');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [setting, setSetting] = useState<SeasonalShiftSetting | null>(null);
  const [slotSettings, setSlotSettings] = useState<
    { slot_date: string; time_slot: string; is_open: boolean }[]
  >([]);
  const [existingSubmission, setExistingSubmission] = useState<SubmissionWithSlots | null>(null);
  const [selected, setSelected] = useState<Set<SlotKey>>(new Set());
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // 認証チェック
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        setAuthState('unauthenticated');
        return;
      }
      setAuthState('authenticated');
      supabase
        .from('user_profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()
        .then(({ data }) => setProfile(data as UserProfile | null));
    });
  }, []);

  const fetchData = useCallback(async () => {
    if (!settingId) return;
    setIsLoading(true);
    setErrorMessage('');
    try {
      const [s, slots, existing] = await Promise.all([
        getPublishedSeasonalShiftSetting(settingId),
        getSeasonalShiftSlotSettings(settingId),
        getMySeasonalShiftSubmission(settingId),
      ]);
      if (!s) {
        setSetting(null);
        return;
      }
      setSetting(s);
      setSlotSettings(
        slots.map((r) => ({ slot_date: r.slot_date, time_slot: r.time_slot, is_open: r.is_open }))
      );
      if (existing) {
        setExistingSubmission(existing);
        if (existing.allow_edit) {
          setNotes(existing.notes ?? '');
          const pre = new Set<SlotKey>();
          (existing.slots ?? []).forEach((slot) => {
            if (slot.available) pre.add(`${slot.shift_date}|${slot.time_slot}`);
          });
          setSelected(pre);
        }
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : '読み込みに失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [settingId]);

  useEffect(() => {
    if (authState === 'authenticated') {
      fetchData();
    }
  }, [authState, fetchData]);

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
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const slots = Array.from(selected).map((key) => {
        const [date, timeSlot] = key.split('|');
        return { shift_date: date, time_slot: timeSlot, available: true as const };
      });

      if (existingSubmission?.allow_edit) {
        await updateMySeasonalShiftSubmission(settingId, { notes: notes.trim() }, slots);
      } else {
        await createMySeasonalShiftSubmission(
          { setting_id: settingId, school_id: setting.school_id, notes: notes.trim() },
          slots
        );
      }
      setIsDone(true);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : '提出に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── 認証ローディング ───
  if (authState === 'loading') {
    return (
      <div className="min-h-screen bg-[#f3f4f6] flex items-center justify-center">
        <p className="text-[#4b5563]">読み込み中...</p>
      </div>
    );
  }

  // ─── 未ログイン ───
  if (authState === 'unauthenticated') {
    return (
      <div className="min-h-screen bg-[#f3f4f6] flex items-center justify-center p-4">
        <div className="bg-white rounded-xl border border-[#e5e7eb] p-8 max-w-sm w-full text-center">
          <h1 className="text-xl font-bold text-[#1f2937] mb-3">ログインが必要です</h1>
          <p className="text-sm text-[#6b7280] mb-6">
            シフト提出にはアカウントへのログインが必要です。
          </p>
          <a
            href={`/login?redirect=${encodeURIComponent(`/seasonal-shift/${settingId}`)}`}
            className="block w-full px-4 py-2.5 bg-[#d32f2f] hover:bg-[#b71c1c] text-white font-semibold rounded-lg text-sm transition-colors"
          >
            ログイン
          </a>
        </div>
      </div>
    );
  }

  // ─── データローディング ───
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f3f4f6] flex items-center justify-center">
        <p className="text-[#4b5563]">読み込み中...</p>
      </div>
    );
  }

  // ─── 設定なし ───
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

  // ─── 提出完了 ───
  if (isDone) {
    return (
      <div className="min-h-screen bg-[#f3f4f6]">
        <div className="max-w-lg mx-auto px-4 py-8">
          <div className="bg-white rounded-xl border border-[#e5e7eb] p-8 text-center">
            <h2 className="text-xl font-bold text-[#1f2937] mb-4">
              {existingSubmission?.allow_edit ? '修正を提出しました' : 'シフト提出が完了しました'}
            </h2>
            <p className="text-[#4b5563] text-sm">ご提出ありがとうございました。</p>
          </div>
        </div>
      </div>
    );
  }

  // ─── 提出済み（修正不可） ───
  if (existingSubmission && !existingSubmission.allow_edit) {
    const submittedAt = new Date(existingSubmission.submitted_at).toLocaleString('ja-JP');
    const slotCount = (existingSubmission.slots ?? []).filter((s) => s.available).length;
    return (
      <div className="min-h-screen bg-[#f3f4f6]">
        <div className="max-w-lg mx-auto px-4 py-8">
          <div className="bg-white rounded-xl border border-[#e5e7eb] p-8">
            <h2 className="text-xl font-bold text-[#1f2937] mb-2">提出済み</h2>
            <p className="text-sm text-[#6b7280] mb-4">{setting.name}</p>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-[#6b7280]">提出日時</dt>
                <dd className="text-[#1f2937] font-medium">{submittedAt}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#6b7280]">出勤可能コマ数</dt>
                <dd className="text-[#1f2937] font-medium">{slotCount} コマ</dd>
              </div>
              {existingSubmission.notes && (
                <div>
                  <dt className="text-[#6b7280] mb-1">備考</dt>
                  <dd className="text-[#1f2937] whitespace-pre-line">{existingSubmission.notes}</dd>
                </div>
              )}
            </dl>
            <p className="mt-6 text-xs text-[#9ca3af]">
              内容の修正が必要な場合は担当者にお問い合わせください。
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ─── 提出フォーム（新規 or 修正） ───
  const isEdit = !!existingSubmission?.allow_edit;
  const uniqueSlots = [...timeSlots];
  const uniqueDates = [...dates];
  const displayName = profile?.display_name ?? profile?.email ?? '';

  return (
    <div className="min-h-screen bg-[#f3f4f6]">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white rounded-xl border border-[#e5e7eb] p-6 mb-6">
          <h1 className="text-2xl font-bold text-[#1f2937] mb-2">{setting.name}</h1>
          {isEdit && (
            <p className="text-sm text-amber-600 font-medium mb-2">修正を受け付けています</p>
          )}
          {setting.description && (
            <p className="text-[#4b5563] whitespace-pre-line mb-4">{setting.description}</p>
          )}
          <p className="text-sm text-[#6b7280]">
            締切: {new Date(setting.deadline + 'T23:59:59').toLocaleDateString('ja-JP')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-[#e5e7eb] p-6 space-y-6">
          <div className="p-3 bg-[#f9fafb] rounded-lg border border-[#e5e7eb]">
            <p className="text-xs text-[#6b7280] mb-0.5">提出者</p>
            <p className="text-sm font-medium text-[#1f2937]">{displayName}</p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-[#1f2937] mb-2">出勤可能日時</h2>
            <p className="text-sm text-[#4b5563] mb-3">
              出勤可能なコマにチェックを入れてください。丸ボタンで日付・時間帯を一括で選択できます。
            </p>
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
                    className="rounded-xl border-2 border-[#e5e7eb] bg-[#f9fafb] overflow-hidden shadow-sm"
                  >
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-[#e5e7eb] bg-white">
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
                      <span className="text-sm font-semibold text-[#1f2937]">{dayLabel}</span>
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

          {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="px-6 py-3 bg-[#d32f2f] hover:bg-[#b71c1c] disabled:opacity-50 text-white font-semibold rounded-lg transition-colors duration-150"
          >
            {isSubmitting ? '送信中...' : isEdit ? '修正を提出する' : '提出する'}
          </button>
        </form>
      </div>
    </div>
  );
}
