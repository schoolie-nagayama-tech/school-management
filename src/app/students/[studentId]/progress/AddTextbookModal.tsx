'use client';

import { useMemo } from 'react';
import { Button, Modal, Select } from '@/components/ui';
import type { StudentTextbookWithDetails, Textbook } from '@/types/database';

// ─────────────────────────────────────────────
// テキスト追加モーダル
// ─────────────────────────────────────────────
export function AddTextbookModal({
  isOpen,
  onClose,
  allTextbooks,
  studentTextbooks,
  gradeCategory,
  setGradeCategory,
  subject,
  setSubject,
  search,
  setSearch,
  onAdd,
}: {
  isOpen: boolean;
  onClose: () => void;
  allTextbooks: Textbook[];
  studentTextbooks: StudentTextbookWithDetails[];
  gradeCategory: 'elementary' | 'middle' | 'high' | '';
  setGradeCategory: (v: 'elementary' | 'middle' | 'high' | '') => void;
  subject: string;
  setSubject: (v: string) => void;
  search: string;
  setSearch: (v: string) => void;
  onAdd: (textbookId: number) => void;
}) {
  const availableSubjects = useMemo(() => {
    const subjects = new Set<string>();
    allTextbooks.forEach((tb) => tb.subject && subjects.add(tb.subject));
    return Array.from(subjects).sort();
  }, [allTextbooks]);

  const filtered = useMemo(() => {
    const existing = new Set(studentTextbooks.map((st) => st.textbook_id));
    return allTextbooks.filter((tb) => {
      if (existing.has(tb.id)) return false;
      if (gradeCategory && tb.grade_category !== gradeCategory) return false;
      if (subject && tb.subject !== subject) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay =
          `${tb.name} ${tb.publisher ?? ''} ${tb.subject ?? ''} ${tb.grade ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allTextbooks, studentTextbooks, gradeCategory, subject, search]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="テキストを追加" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Select
            label="学年カテゴリ"
            value={gradeCategory}
            onChange={(e) => {
              setGradeCategory(e.target.value as 'elementary' | 'middle' | 'high' | '');
            }}
            options={[
              { value: '', label: 'すべて' },
              { value: 'elementary', label: '小学生' },
              { value: 'middle', label: '中学生' },
              { value: 'high', label: '高校生' },
            ]}
          />
          <Select
            label="科目"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            options={[
              { value: '', label: 'すべて' },
              ...availableSubjects.map((s) => ({ value: s, label: s })),
            ]}
          />
          <div>
            <label className="block text-sm font-medium mb-1 text-[#1f2937]">検索</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="テキスト名・出版社"
              className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="border-t border-[#e5e7eb] pt-3">
          <div className="text-xs text-[#6b7280] mb-2">{filtered.length} 件</div>
          {filtered.length === 0 ? (
            <p className="text-sm text-[#4b5563] py-6 text-center">
              条件に一致するテキストがありません
            </p>
          ) : (
            <div className="max-h-80 overflow-y-auto space-y-2">
              {filtered.map((tb) => (
                <div
                  key={tb.id}
                  className="p-3 bg-[#f9fafb] rounded-lg border border-[#e5e7eb] hover:bg-[#f3f4f6] flex items-center justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[#1f2937] truncate">{tb.name}</div>
                    <div className="text-xs text-[#6b7280] mt-0.5">
                      {tb.publisher && <span>{tb.publisher}</span>}
                      {tb.subject && (
                        <span className={tb.publisher ? ' ml-2' : ''}>{tb.subject}</span>
                      )}
                      {tb.grade && <span className="ml-2">{tb.grade}</span>}
                      {tb.grade_category && (
                        <span className="ml-2">
                          {tb.grade_category === 'elementary'
                            ? '小'
                            : tb.grade_category === 'middle'
                              ? '中'
                              : '高'}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button onClick={() => onAdd(tb.id)} variant="primary" size="sm">
                    追加
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
