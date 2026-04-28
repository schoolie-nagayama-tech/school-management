'use client';

import { useState } from 'react';
import { Input, Button } from '@/components/ui';
import { ChevronDown } from 'lucide-react';

interface SubjectListEditorProps {
  subjects: string[];
  onChange: (subjects: string[]) => void;
  disabled?: boolean;
}

const DEFAULT_SUBJECTS = ['英語', '数学', '国語', '理科', '社会'];

export function SubjectListEditor({
  subjects,
  onChange,
  disabled = false,
}: SubjectListEditorProps) {
  const [newSubject, setNewSubject] = useState('');

  const handleAdd = () => {
    if (!newSubject.trim() || subjects.includes(newSubject.trim())) {
      return;
    }
    onChange([...subjects, newSubject.trim()]);
    setNewSubject('');
  };

  const handleDelete = (index: number) => {
    if (disabled) return;
    const newSubjects = subjects.filter((_, i) => i !== index);
    onChange(newSubjects);
  };

  const handleMoveUp = (index: number) => {
    if (disabled || index === 0) return;
    const newSubjects = [...subjects];
    [newSubjects[index - 1], newSubjects[index]] = [
      newSubjects[index],
      newSubjects[index - 1],
    ];
    onChange(newSubjects);
  };

  const handleMoveDown = (index: number) => {
    if (disabled || index === subjects.length - 1) return;
    const newSubjects = [...subjects];
    [newSubjects[index], newSubjects[index + 1]] = [
      newSubjects[index + 1],
      newSubjects[index],
    ];
    onChange(newSubjects);
  };

  const handleSetDefaults = () => {
    if (disabled) return;
    onChange([...DEFAULT_SUBJECTS]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-[#1f2937]">
          科目リスト
        </label>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleSetDefaults}
          disabled={disabled}
        >
          デフォルトを設定
        </Button>
      </div>

      {/* 科目一覧 */}
      <div className="border border-[#e5e7eb] rounded-lg overflow-hidden">
        <div className="divide-y divide-[#e5e7eb]/20">
          {subjects.map((subject, index) => (
            <div
              key={index}
              className="flex items-center gap-3 px-4 py-3 bg-white hover:bg-[#f3f4f6] transition-colors"
            >
              <div className="flex items-center gap-2 flex-1">
                <span className="text-sm text-[#4b5563] w-6">{index + 1}.</span>
                <span className="text-sm font-medium text-[#1f2937] flex-1">
                  {subject}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleMoveUp(index)}
                  disabled={disabled || index === 0}
                  className="p-1 text-[#4b5563] hover:text-[#1f2937] disabled:opacity-50 disabled:cursor-not-allowed"
                  title="上へ"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 15l7-7 7 7"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => handleMoveDown(index)}
                  disabled={disabled || index === subjects.length - 1}
                  className="p-1 text-[#4b5563] hover:text-[#1f2937] disabled:opacity-50 disabled:cursor-not-allowed"
                  title="下へ"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(index)}
                  disabled={disabled}
                  className="p-1 text-[#ef4444] hover:text-[#c02650] disabled:opacity-50 disabled:cursor-not-allowed"
                  title="削除"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 科目追加 */}
      <div className="flex gap-2">
        <Input
          type="text"
          value={newSubject}
          onChange={(e) => setNewSubject(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder="科目名を入力"
          disabled={disabled}
          className="flex-1"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={handleAdd}
          disabled={disabled || !newSubject.trim()}
        >
          追加
        </Button>
      </div>
    </div>
  );
}
