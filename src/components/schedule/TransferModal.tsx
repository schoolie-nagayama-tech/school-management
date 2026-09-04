'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui';
import { Button, Input, Label } from '@/components/ui';
import {
  SelectShadcn as Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui';
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
  /** Phase P2: 振替先が未定のまま保留プールへ入れる。指定時のみボタンを表示。 */
  onHold?: () => void;
}

export function TransferModal({
  open,
  onClose,
  entry,
  teachers,
  timeSlots,
  schoolId,
  weekStart: _weekStart,
  weekEnd: _weekEnd,
  closedDates: _closedDates = [],
  initialTargetDate,
  initialTargetSlotId,
  onTransfer,
  onHold,
}: TransferModalProps) {
  const [targetDate, setTargetDate] = useState('');
  const [targetSlotId, setTargetSlotId] = useState('');
  const [targetTeacherId, setTargetTeacherId] = useState('');
  const [seatLabel, setSeatLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const teachersForSchool = teachers.filter((t) =>
    t.user_schools?.some((us) => us.school_id === schoolId)
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

  /**
   * 振替元の要約。振替先の入力欄だけだと「どの授業を動かしているのか」が画面から消え、
   * 別の生徒のコマを動かす事故につながるため、確定ボタンと同じ画面に出す。
   */
  const sourceSummary = (() => {
    if (!entry) return null;
    const d = new Date(entry.entry_date + 'Z');
    const week = ['日', '月', '火', '水', '木', '金', '土'][d.getUTCDay()];
    const dateLabel = `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${week})`;
    const student = entry.student
      ? `${entry.student.last_name} ${entry.student.first_name}`
      : (entry.student_id ?? '—');
    const slot = entry.time_slot ? `${entry.time_slot.slot_number}限` : '';
    const teacher = entry.teacher?.display_name || entry.teacher?.email || '';
    const subjects = (entry.subjects ?? [])
      .map((s) => (typeof s === 'object' && s && 'name' in s ? s.name : String(s)))
      .filter(Boolean)
      .join('・');
    return { student, dateLabel, slot, teacher, subjects };
  })();

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
    /* Header / Footer は DialogContent の外に置く（中に入れるとスクロール領域に
       巻き込まれ、タイトルが上端で切れ、ボタンが画面外に出る）。幅は Dialog の size で決まる。 */
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} size="md">
      <DialogHeader>
        <DialogTitle>別の週へ振替</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          {sourceSummary && (
            <div className="rounded-md border border-[var(--stroke)] bg-[var(--surface)] px-3 py-2 text-sm">
              <div className="text-xs font-semibold text-[var(--headline)]">振替元</div>
              <div className="mt-0.5 font-medium text-[var(--headline)]">
                {sourceSummary.student}
              </div>
              <div className="text-xs text-[var(--paragraph)]">
                {sourceSummary.dateLabel} {sourceSummary.slot}
                {sourceSummary.teacher && ` ・ ${sourceSummary.teacher}`}
                {sourceSummary.subjects && ` ・ ${sourceSummary.subjects}`}
              </div>
            </div>
          )}
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
      </DialogContent>
      <DialogFooter className="flex-col sm:flex-row sm:justify-between gap-2">
        {/* Phase P2: 振替先が未定なら保留プールへ。左端に置いて確定操作と視覚的に分ける。 */}
        {onHold ? (
          <Button
            variant="outline"
            onClick={onHold}
            disabled={saving}
            className="sm:mr-auto"
            title="振替先を決めずに保留プールに入れる（後で座席表から配置）"
          >
            振替先が未定（保留にする）
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={onClose}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? '振替中...' : '振替する'}
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  );
}
