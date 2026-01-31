'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui';
import { Button, Input, Label, Switch } from '@/components/ui';
import type { ScheduleTimeSlot, ScheduleTimeSlotFormData } from '@/types/schedule';

const DEFAULT_SUGGESTIONS: { start: string; end: string }[] = [
  { start: '16:00', end: '17:30' },
  { start: '17:40', end: '19:10' },
  { start: '19:20', end: '20:50' },
  { start: '14:50', end: '16:20' },
];

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
  nextSlotNumber: number;
  nextDisplayOrder: number;
}

export function TimeSlotForm({
  open,
  onClose,
  onSubmit,
  editingSlot,
  nextSlotNumber,
  nextDisplayOrder,
}: TimeSlotFormProps) {
  const [form, setForm] = useState<ScheduleTimeSlotFormData>({
    slot_number: nextSlotNumber,
    start_time: '16:00',
    end_time: '17:30',
    is_active: true,
    display_order: nextDisplayOrder,
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
        const next = DEFAULT_SUGGESTIONS[nextSlotNumber - 1] ?? DEFAULT_SUGGESTIONS[0];
        setForm({
          slot_number: nextSlotNumber,
          start_time: next.start,
          end_time: next.end,
          is_active: true,
          display_order: nextDisplayOrder,
        });
      }
    }
  }, [open, editingSlot, nextSlotNumber, nextDisplayOrder]);

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
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editingSlot ? 'コマ時間を編集' : 'コマ時間を追加'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="slot_number">コマ番号</Label>
              <Input
                id="slot_number"
                type="number"
                min={1}
                max={7}
                value={form.slot_number}
                onChange={(e) => setForm({ ...form, slot_number: parseInt(e.target.value) || 1 })}
                disabled={!!editingSlot}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="display_order">表示順</Label>
              <Input
                id="display_order"
                type="number"
                min={0}
                value={form.display_order}
                onChange={(e) => setForm({ ...form, display_order: parseInt(e.target.value) || 0 })}
              />
            </div>
          </div>
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
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
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
