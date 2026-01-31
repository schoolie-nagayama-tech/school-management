'use client';

import { Button } from '@/components/ui';
import type { AttendanceStatusType } from '@/types/schedule';
import { Check, X, Clock } from 'lucide-react';

const LABELS: Record<NonNullable<AttendanceStatusType>, string> = {
  present: '出席',
  absent: '欠席',
  late: '遅刻',
};

interface AttendanceButtonsProps {
  current: AttendanceStatusType;
  onSelect: (status: 'present' | 'absent' | 'late') => void;
  disabled?: boolean;
}

export function AttendanceButtons({ current, onSelect, disabled }: AttendanceButtonsProps) {
  return (
    <div className="flex flex-wrap gap-1">
      <Button
        variant="ghost"
        size="sm"
        className={`text-xs ${current === 'present' ? 'bg-green-100 text-green-800' : ''}`}
        onClick={() => onSelect('present')}
        disabled={disabled}
      >
        <Check className="h-3 w-3 mr-1" />
        {LABELS.present}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={`text-xs ${current === 'absent' ? 'bg-red-100 text-red-800' : ''}`}
        onClick={() => onSelect('absent')}
        disabled={disabled}
      >
        <X className="h-3 w-3 mr-1" />
        {LABELS.absent}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={`text-xs ${current === 'late' ? 'bg-amber-100 text-amber-800' : ''}`}
        onClick={() => onSelect('late')}
        disabled={disabled}
      >
        <Clock className="h-3 w-3 mr-1" />
        {LABELS.late}
      </Button>
    </div>
  );
}
