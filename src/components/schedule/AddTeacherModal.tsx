'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui';
import { Button } from '@/components/ui';
import { SelectShadcn as Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui';

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
  onSelect: (teacherId: string) => void;
}

export function AddTeacherModal({
  open,
  onClose,
  teachers,
  schoolId,
  onSelect,
}: AddTeacherModalProps) {
  const [teacherId, setTeacherId] = useState('');

  const teachersForSchool = teachers.filter(
    (t) =>
      t.is_active !== false &&
      t.user_schools?.some((us) => us.school_id === schoolId)
  );

  useEffect(() => {
    if (open) {
      setTeacherId(teachersForSchool[0]?.id ?? '');
    }
  }, [open, teachersForSchool]);

  const handleSubmit = () => {
    if (teacherId) {
      onSelect(teacherId);
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>講師を追加</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-[var(--headline)]">講師</label>
            <Select value={teacherId} onValueChange={setTeacherId}>
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
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={!teacherId}>
            追加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
