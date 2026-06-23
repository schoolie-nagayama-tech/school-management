'use client';

import { Input } from '@/components/ui';

interface SubjectInputProps {
  subjects: string[];
  values: Record<string, number>;
  onChange: (subject: string, value: number) => void;
  disabled?: boolean;
}

export function SubjectInput({ subjects, values, onChange, disabled = false }: SubjectInputProps) {
  const handleChange = (subject: string, value: string) => {
    const numValue = parseInt(value, 10);
    if (isNaN(numValue) || numValue < 0) {
      onChange(subject, 0);
      return;
    }
    if (numValue > 60) {
      onChange(subject, 60);
      return;
    }
    onChange(subject, numValue);
  };

  return (
    <div className="space-y-3">
      {subjects.map((subject) => (
        <div key={subject} className="flex items-center gap-4">
          <label className="w-24 text-sm font-medium text-[#1f2937] flex-shrink-0">{subject}</label>
          <div className="flex-1 flex items-center gap-2">
            <Input
              type="number"
              min="0"
              max="60"
              value={values[subject] || 0}
              onChange={(e) => handleChange(subject, e.target.value)}
              disabled={disabled}
              className="w-24"
            />
            <span className="text-sm text-[#4b5563]">コマ</span>
          </div>
        </div>
      ))}
    </div>
  );
}
