'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui';
import { Button, Input, Label, Checkbox } from '@/components/ui';
import type { ScheduleClosedDayFormData } from '@/types/schedule';

interface ClosedDayFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: ScheduleClosedDayFormData) => Promise<void>;
}

export function ClosedDayForm({ open, onClose, onSubmit }: ClosedDayFormProps) {
  const [form, setForm] = useState<ScheduleClosedDayFormData>({
    closed_date: '',
    reason: '',
    is_global: false,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && !form.closed_date) {
      const d = new Date();
      setForm((f) => ({ ...f, closed_date: d.toISOString().slice(0, 10) }));
    }
  }, [open]);

  const handleSubmit = async () => {
    if (!form.closed_date) return;
    setSaving(true);
    try {
      await onSubmit(form);
      onClose();
      setForm({ closed_date: '', reason: '', is_global: false });
    } finally {
      setSaving(false);
    }
  };

  return (
    /* Header / Footer は DialogContent の外に置く（中に入れるとスクロール領域に
       巻き込まれ、タイトルが上端で切れ、ボタンが画面外に出る）。幅は Dialog の size で決まる。 */
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogHeader>
        <DialogTitle>休講日を追加</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="closed_date">日付</Label>
            <Input
              id="closed_date"
              type="date"
              value={form.closed_date}
              onChange={(e) => setForm({ ...form, closed_date: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reason">理由（任意）</Label>
            <Input
              id="reason"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="例：祝日、教室休講"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="is_global"
              checked={form.is_global}
              onCheckedChange={(c) => setForm({ ...form, is_global: !!c })}
            />
            <Label htmlFor="is_global" className="cursor-pointer">
              全教室共通（祝日など）
            </Label>
          </div>
        </div>
      </DialogContent>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          キャンセル
        </Button>
        <Button onClick={handleSubmit} disabled={saving}>
          {saving ? '登録中...' : '登録'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
