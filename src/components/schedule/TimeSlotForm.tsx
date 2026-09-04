'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui';
import { Button, Input, Label, Switch } from '@/components/ui';
import type { ScheduleTimeSlot, ScheduleTimeSlotFormData } from '@/types/schedule';

function timeToInputValue(t: string): string {
  if (!t) return '';
  if (t.length >= 5) return t.slice(0, 5);
  return t;
}

interface TimeSlotFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: ScheduleTimeSlotFormData) => Promise<void>;
  editingSlot: ScheduleTimeSlot | null;
  /** INSERT時に仮で使う slot_number（保存後に時刻順で自動振り直し） */
  nextSlotNumber: number;
}

export function TimeSlotForm({
  open,
  onClose,
  onSubmit,
  editingSlot,
  nextSlotNumber,
}: TimeSlotFormProps) {
  const [form, setForm] = useState<ScheduleTimeSlotFormData>({
    slot_number: nextSlotNumber,
    start_time: '16:00',
    end_time: '17:30',
    is_active: true,
    display_order: 0,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (editingSlot) {
        setForm({
          slot_number: editingSlot.slot_number,
          start_time: timeToInputValue(editingSlot.start_time),
          end_time: timeToInputValue(editingSlot.end_time),
          is_active: editingSlot.is_active,
          display_order: editingSlot.display_order,
        });
      } else {
        setForm({
          slot_number: nextSlotNumber,
          start_time: '',
          end_time: '',
          is_active: true,
          display_order: 0,
        });
      }
    }
  }, [open, editingSlot, nextSlotNumber]);

  const handleSubmit = async () => {
    if (!form.start_time || !form.end_time) return;
    setSaving(true);
    try {
      await onSubmit(form);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    /* Header / Footer は DialogContent の外に置く（中に入れるとスクロール領域に
       巻き込まれ、タイトルが上端で切れ、ボタンが画面外に出る）。幅は Dialog の size で決まる。 */
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogHeader>
        <DialogTitle>{editingSlot ? 'コマ時間を編集' : 'コマ時間を追加'}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <p className="text-sm text-[var(--paragraph)]">
            コマ番号は末尾に自動で割り当てられます。並び順は一覧の矢印ボタンで変更できます。
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start_time">開始時刻</Label>
              <Input
                id="start_time"
                type="time"
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end_time">終了時刻</Label>
              <Input
                id="end_time"
                type="time"
                value={form.end_time}
                onChange={(e) => setForm({ ...form, end_time: e.target.value })}
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="is_active">有効</Label>
            <Switch
              id="is_active"
              checked={form.is_active}
              onCheckedChange={(c) => setForm({ ...form, is_active: c })}
            />
          </div>
        </div>
      </DialogContent>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          キャンセル
        </Button>
        <Button onClick={handleSubmit} disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
