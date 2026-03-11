'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui';
import { Button } from '@/components/ui';
import type { KoushuCourse } from '@/lib/api/seasonalCourses';

const SEASON_OPTIONS = [
  { value: 'spring', label: '春期' },
  { value: 'summer', label: '夏期' },
  { value: 'winter', label: '冬期' },
];

interface KoushuPeriodFormModalProps {
  open: boolean;
  onClose: () => void;
  initialData?: KoushuCourse | null;
  onSave: (data: {
    name: string;
    season: string;
    start_date: string | null;
    end_date: string | null;
  }) => Promise<void>;
}

export function KoushuPeriodFormModal({
  open,
  onClose,
  initialData,
  onSave,
}: KoushuPeriodFormModalProps) {
  const [name, setName] = useState('');
  const [season, setSeason] = useState('summer');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(initialData?.name ?? '');
      setSeason(initialData?.season ?? 'summer');
      setStartDate(initialData?.start_date ?? '');
      setEndDate(initialData?.end_date ?? '');
      setError(null);
    }
  }, [open, initialData]);

  const handleSubmit = async () => {
    if (!name.trim()) { setError('講習名を入力してください'); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        season,
        start_date: startDate || null,
        end_date: endDate || null,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initialData ? '講習を編集' : '講習を追加'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="block text-sm font-medium text-[var(--headline)] mb-1">
              講習名 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 2026夏期講習"
              className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--headline)] mb-1">
              シーズン
            </label>
            <div className="flex gap-3">
              {SEASON_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="season"
                    value={opt.value}
                    checked={season === opt.value}
                    onChange={() => setSeason(opt.value)}
                  />
                  <span className="text-sm">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-[var(--headline)] mb-1">
                開始日
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--headline)] mb-1">
                終了日
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
            </div>
          </div>
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
