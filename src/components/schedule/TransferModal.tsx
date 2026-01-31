'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui';
import { Button, Input, Label } from '@/components/ui';
import { SelectShadcn as Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui';
import type { ScheduleEntry } from '@/types/schedule';
import type { ScheduleTimeSlot } from '@/types/schedule';

interface TeacherOption {
  id: string;
  display_name: string | null;
  email: string | null;
  user_schools?: Array<{ school_id: string }>;
}

interface TransferModalProps {
  open: boolean;
  onClose: () => void;
  entry: ScheduleEntry | null;
  teachers: TeacherOption[];
  timeSlots: ScheduleTimeSlot[];
  schoolId: string;
  weekStart: string;
  weekEnd: string;
  closedDates?: string[];
  /** 振替先セルクリックで開いた場合の初期値 */
  initialTargetDate?: string;
  initialTargetSlotId?: string;
  onTransfer: (
    targetDate: string,
    targetSlotId: string,
    targetTeacherId: string,
    seatLabel?: string | null
  ) => Promise<void>;
}

export function TransferModal({
  open,
  onClose,
  entry,
  teachers,
  timeSlots,
  schoolId,
  weekStart,
  weekEnd,
  closedDates = [],
  initialTargetDate,
  initialTargetSlotId,
  onTransfer,
}: TransferModalProps) {
  const [targetDate, setTargetDate] = useState('');
  const [targetSlotId, setTargetSlotId] = useState('');
  const [targetTeacherId, setTargetTeacherId] = useState('');
  const [seatLabel, setSeatLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const teachersForSchool = teachers.filter(
    (t) => t.user_schools?.some((us) => us.school_id === schoolId)
  );

  useEffect(() => {
    if (open && entry) {
      setTargetDate(initialTargetDate ?? '');
      setTargetSlotId(initialTargetSlotId ?? timeSlots[0]?.id ?? '');
      setTargetTeacherId(entry.teacher_id);
      setSeatLabel(entry.seat_label || '');
    }
  }, [open, entry, timeSlots, initialTargetDate, initialTargetSlotId]);

  const today = new Date().toISOString().slice(0, 10);

  const handleSubmit = async () => {
    if (!targetDate || !targetSlotId || !targetTeacherId) return;
    setSaving(true);
    try {
      await onTransfer(targetDate, targetSlotId, targetTeacherId, seatLabel || undefined);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>別の週へ振替</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>振替先日付</Label>
            <Input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              min={today}
            />
          </div>
          <div className="space-y-2">
            <Label>振替先コマ</Label>
            <Select value={targetSlotId} onValueChange={setTargetSlotId}>
              <SelectTrigger>
                <SelectValue placeholder="コマを選択" />
              </SelectTrigger>
              <SelectContent>
                {timeSlots.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.slot_number}限 {s.start_time?.slice(0, 5)}-{s.end_time?.slice(0, 5)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>振替先講師</Label>
            <Select value={targetTeacherId} onValueChange={setTargetTeacherId}>
              <SelectTrigger>
                <SelectValue placeholder="講師を選択" />
              </SelectTrigger>
              <SelectContent>
                {teachersForSchool.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.display_name || t.email || t.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="transfer_seat">座席番号（任意）</Label>
            <Input
              id="transfer_seat"
              value={seatLabel}
              onChange={(e) => setSeatLabel(e.target.value)}
              placeholder="例：A席"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? '振替中...' : '振替する'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
