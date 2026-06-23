'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import {
  getPublishedRegularShiftSettingPublic,
  getRegularShiftSubmissionByEditToken,
  updateRegularShiftSubmission,
} from '@/lib/api/regular-shift';
import type { RegularShiftSetting, RegularShiftSlotSetting } from '@/types/regular-shift';
import {
  RegularShiftSlotMatrix,
  type RegularSlotSettingRow,
} from '@/components/regular-shift/RegularShiftSlotMatrix';
import { Loading } from '@/components/ui';

const DAYS = [1, 2, 3, 4, 5, 6] as const;

export default function RegularShiftEditPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const settingId = params.settingId as string;
  const editToken = params.editToken as string;
  const submitted = searchParams.get('submitted') === '1';

  const [setting, setSetting] = useState<RegularShiftSetting | null>(null);
  const [slotSettings, setSlotSettings] = useState<RegularShiftSlotSetting[]>([]);
  const [formSlots, setFormSlots] = useState<RegularSlotSettingRow[]>([]);
  const [teacherName, setTeacherName] = useState('');
  const [teacherEmail, setTeacherEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const fetchData = useCallback(async () => {
    if (!settingId || !editToken) return;
    setIsLoading(true);
    setErrorMessage('');
    try {
      const [settingResult, submission] = await Promise.all([
        getPublishedRegularShiftSettingPublic(settingId),
        getRegularShiftSubmissionByEditToken(editToken),
      ]);
      if (!settingResult || !submission) {
        setSetting(null);
        setIsLoading(false);
        return;
      }
      const { setting: s, slotSettings: slots } = settingResult;
      setSetting(s);
      setSlotSettings(slots);
      setSubmissionId(submission.id);
      setTeacherName(submission.teacher_name);
      setTeacherEmail(submission.teacher_email);
      setNotes(submission.notes ?? '');

      // Build form slots from existing submission
      const timeSlots = s.weekday_slots
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      const existingSlots = submission.slots ?? [];
      const initial: RegularSlotSettingRow[] = [];
      DAYS.forEach((day) => {
        timeSlots.forEach((ts) => {
          const existing = existingSlots.find(
            (es) => es.day_of_week === day && es.time_slot === ts
          );
          initial.push({
            day_of_week: day,
            time_slot: ts,
            is_open: existing?.available ?? false,
          });
        });
      });
      setFormSlots(initial);
    } catch (err) {
      console.error(err);
      setErrorMessage(err instanceof Error ? err.message : '読み込みに失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [settingId, editToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const timeSlots = setting
    ? setting.weekday_slots
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    : [];

  const slotSettingsForMatrix: RegularSlotSettingRow[] = slotSettings.map((s) => ({
    day_of_week: s.day_of_week,
    time_slot: s.time_slot,
    is_open: s.is_open,
  }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setting || !submissionId) return;
    if (!teacherName.trim() || !teacherEmail.trim()) {
      setErrorMessage('名前とメールアドレスを入力してください');
      return;
    }
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const slots = formSlots
        .filter((s) => s.is_open)
        .map((s) => ({
          day_of_week: s.day_of_week,
          time_slot: s.time_slot,
          available: true,
        }));
      await updateRegularShiftSubmission(
        submissionId,
        {
          teacher_name: teacherName.trim(),
          teacher_email: teacherEmail.trim(),
          notes: notes.trim(),
        },
        slots
      );
      window.location.href = `?submitted=1`;
    } catch (err) {
      console.error(err);
      setErrorMessage(err instanceof Error ? err.message : '更新に失敗しました');
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
  if (!setting || !submissionId) {
    return (
      <div className="min-h-screen bg-surface-hover flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-xl font-bold text-text-heading mb-2">この修正リンクは無効です</h1>
          <p className="text-text-body text-sm">URLをご確認ください。</p>
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
            <p className="text-text-body mb-6">修正内容を保存しました。ご確認ください。</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-hover">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-surface-raised rounded-xl border border-border p-6 mb-6">
          <h1 className="text-2xl font-bold text-text-heading mb-2">{setting.name}（修正）</h1>
          {setting.description && (
            <p className="text-text-body whitespace-pre-line mb-4">{setting.description}</p>
          )}
          {setting.deadline && (
            <p className="text-sm text-text-muted">
              締切: {new Date(setting.deadline + 'T23:59:59').toLocaleDateString('ja-JP')}
            </p>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-surface-raised rounded-xl border border-border p-6 space-y-6"
        >
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
            <label className="block text-sm font-medium text-text-heading mb-1">
              メールアドレス *
            </label>
            <input
              type="email"
              required
              value={teacherEmail}
              onChange={(e) => setTeacherEmail(e.target.value)}
              className="w-full max-w-md px-3 py-2 border border-border rounded-lg text-sm"
            />
          </div>

          <div>
            <RegularShiftSlotMatrix
              timeSlots={timeSlots}
              value={formSlots}
              onChange={setFormSlots}
              mode="submission"
              slotSettings={slotSettingsForMatrix}
            />
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
            {isSubmitting ? '送信中...' : '修正を提出する'}
          </button>
        </form>
      </div>
    </div>
  );
}
