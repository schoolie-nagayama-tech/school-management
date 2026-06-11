'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  getSeasonalShiftSubmissionByEditToken,
  getPublishedSeasonalShiftSettingPublic,
  updateSeasonalShiftSubmissionByToken,
} from '@/lib/api/seasonal-shift';
import type { SeasonalShiftSetting } from '@/types/seasonal-shift';
import { Loading } from '@/components/ui';

type SlotKey = string;

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

export default function SeasonalShiftEditPage() {
  const params = useParams();
  const settingId = params.settingId as string;
  const editToken = params.editToken as string;

  const [setting, setSetting] = useState<SeasonalShiftSetting | null>(null);
  const [slotSettings, setSlotSettings] = useState<{ slot_date: string; time_slot: string; is_open: boolean }[]>([]);
  const [selected, setSelected] = useState<Set<SlotKey>>(new Set());
  const [teacherName, setTeacherName] = useState('');
  const [teacherEmail, setTeacherEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [invalidToken, setInvalidToken] = useState(false);

  const fetchData = useCallback(async () => {
    if (!editToken) {
      setInvalidToken(true);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setErrorMessage('');
    try {
      const submission = await getSeasonalShiftSubmissionByEditToken(editToken);
      if (!submission) {
        setInvalidToken(true);
        setIsLoading(false);
        return;
      }
      if (submission.setting_id !== settingId) {
        setInvalidToken(true);
        setIsLoading(false);
        return;
      }
      // 公開APIで取得（未ログインの講師がアクセスするためRLSを回避）
      const result = await getPublishedSeasonalShiftSettingPublic(settingId);
      if (!result) {
        setInvalidToken(true);
        setIsLoading(false);
        return;
      }
      setSetting(result.setting);
      setSlotSettings(result.slotSettings.map((r) => ({ slot_date: r.slot_date, time_slot: r.time_slot, is_open: r.is_open })));
      setTeacherName(submission.teacher_name ?? '');
      setTeacherEmail(submission.teacher_email ?? '');
      setNotes(submission.notes ?? '');
      const initialSelected = new Set<SlotKey>();
      for (const slot of submission.slots ?? []) {
        if (slot.available) {
          initialSelected.add(`${slot.shift_date}|${slot.time_slot}`);
        }
      }
      setSelected(initialSelected);
    } catch (err) {
      console.error(err);
      setErrorMessage(err instanceof Error ? err.message : '読み込みに失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [editToken, settingId]);

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
    if (!setting || !editToken) return;
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
      await updateSeasonalShiftSubmissionByToken(editToken, {
        teacher_name: teacherName.trim(),
        teacher_email: teacherEmail.trim(),
        notes: notes.trim(),
      }, slots);
      setSubmitted(true);
    } catch (err) {
      console.error(err);
      setErrorMessage(err instanceof Error ? err.message : '修正の保存に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface-hover flex items-center justify-center">
        <Loading />
      </div>
    );
  }

  if (invalidToken) {
    return (
      <div className="min-h-screen bg-surface-hover flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-xl font-bold text-text-heading mb-2">
            この修正用URLは無効です
          </h1>
          <p className="text-text-body text-sm">
            修正が完了済みか、URLの有効期限が切れています。管理者にお問い合わせください。
          </p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-surface-hover">
        <div className="max-w-lg mx-auto px-4 py-8">
          <div className="bg-surface-raised rounded-xl border border-border p-8 text-center">
            <h2 className="text-xl font-bold text-text-heading mb-4">シフト修正が完了しました</h2>
            <p className="text-text-body mb-6">
              修正内容が反映されました。このURLは今後使用できません。
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!setting) return null;

  const uniqueSlots = [...timeSlots];
  const uniqueDates = [...dates];

  return (
    <div className="min-h-screen bg-surface-hover">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-surface-raised rounded-xl border border-border p-6 mb-6">
          <h1 className="text-2xl font-bold text-text-heading mb-2">{setting.name} の修正</h1>
          {setting.description && (
            <p className="text-text-body whitespace-pre-line mb-4">{setting.description}</p>
          )}
          <p className="text-sm text-text-muted">
            シフト内容を修正して再送信してください。送信後、このURLは無効になります。
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
                const hasOpenInRow = slotMatrix.some((c) => c.date === dateStr && c.available);
                return (
                  <div
                    key={dateStr}
                    className="rounded-xl border-2 border-border bg-surface overflow-hidden shadow-sm"
                  >
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-surface-raised">
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
                      <span className="text-sm font-semibold text-text-heading">{dayLabel}</span>
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

          {errorMessage && (
            <p className="text-sm text-red-600">{errorMessage}</p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="px-6 py-3 bg-[#d32f2f] hover:bg-[#b71c1c] disabled:opacity-50 text-white font-semibold rounded-lg transition-colors duration-150"
          >
            {isSubmitting ? '送信中...' : '修正を送信する'}
          </button>
        </form>
      </div>
    </div>
  );
}
