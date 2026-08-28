'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui';
import { Button } from '@/components/ui';
import {
  SelectShadcn as Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui';

export interface TeacherOption {
  id: string;
  display_name: string | null;
  email: string | null;
  is_active?: boolean;
  user_schools?: Array<{ school_id: string }>;
}

interface AddTeacherModalProps {
  open: boolean;
  onClose: () => void;
  teachers: TeacherOption[];
  schoolId: string;
  /** このコマに既に表示されている講師ID（除外するため） */
  existingTeacherIds?: string[];
  onSelect: (teacherId: string) => void;
}

export function AddTeacherModal({
  open,
  onClose,
  teachers,
  schoolId,
  existingTeacherIds = [],
  onSelect,
}: AddTeacherModalProps) {
  const [teacherId, setTeacherId] = useState('');

  // 教室に所属・有効・このコマに未追加の講師のみ表示
  const availableTeachers = teachers.filter(
    (t) =>
      t.is_active !== false &&
      t.user_schools?.some((us) => us.school_id === schoolId) &&
      !existingTeacherIds.includes(t.id)
  );

  useEffect(() => {
    if (open) {
      setTeacherId(availableTeachers[0]?.id ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSubmit = () => {
    if (teacherId) {
      onSelect(teacherId);
      onClose();
    }
  };

  return (
    /* Header / Footer は DialogContent の外に置く（中に入れるとスクロール領域に
       巻き込まれ、タイトルが上端で切れ、ボタンが画面外に出る）。幅は Dialog の size で決まる。 */
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} size="lg">
      <DialogHeader>
        <DialogTitle>講師を追加</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-3 py-2">
          {availableTeachers.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">
              このコマに追加できる講師はいません
            </p>
          ) : (
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--headline)]">講師を選択</label>
              <Select value={teacherId} onValueChange={setTeacherId}>
                <SelectTrigger className="w-full text-base py-2.5">
                  <SelectValue placeholder="講師を選択" />
                </SelectTrigger>
                {/* 講師が多い教室でも一度に見渡せるよう、既定(max-h-60)より高くする */}
                <SelectContent className="max-h-80">
                  {availableTeachers.map((t) => (
                    <SelectItem key={t.id} value={t.id} className="text-base py-2.5">
                      {t.display_name || t.email || t.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </DialogContent>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          キャンセル
        </Button>
        <Button onClick={handleSubmit} disabled={!teacherId || availableTeachers.length === 0}>
          追加
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
