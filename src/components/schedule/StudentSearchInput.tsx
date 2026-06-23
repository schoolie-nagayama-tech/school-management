'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Search } from 'lucide-react';
import { searchStudents } from '@/lib/api/students';
import type { Student } from '@/types/database';
import type { Subject } from '@/types/database';

export type StudentWithSubjects = Student & { subjects: Subject[] };

function gradeLabel(grade: number): string {
  if (grade <= 6) return `小${grade}`;
  if (grade <= 9) return `中${grade - 6}`;
  return `高${grade - 9}`;
}

export interface StudentSearchInputProps {
  schoolId: string;
  onSelect: (student: StudentWithSubjects) => void;
  excludeStudentIds?: string[];
  placeholder?: string;
  disabled?: boolean;
}

const SEARCH_DEBOUNCE_MS = 300;
const LIMIT = 20;
const DEFAULT_EXCLUDE: string[] = [];

export function StudentSearchInput({
  schoolId,
  onSelect,
  excludeStudentIds = DEFAULT_EXCLUDE,
  placeholder = '生徒を検索...',
  disabled = false,
}: StudentSearchInputProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StudentWithSubjects[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const excludeRef = useRef(excludeStudentIds);
  excludeRef.current = excludeStudentIds;

  const runSearch = useCallback(
    async (q: string) => {
      if (!schoolId) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const list = await searchStudents(schoolId, q, {
          excludeIds: excludeRef.current,
          limit: LIMIT,
        });
        setResults(list);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [schoolId]
  );

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    const t = setTimeout(() => {
      runSearch(query);
      setOpen(true);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  const handleSelect = (student: StudentWithSubjects) => {
    onSelect(student);
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--paragraph-light)]" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.trim() && setOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full pl-9 pr-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent disabled:bg-[var(--surface)]"
          aria-label="生徒を検索"
        />
      </div>
      {open && (query.trim() || results.length > 0) && (
        <>
          <div className="fixed inset-0 z-10" aria-hidden onClick={() => setOpen(false)} />
          <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-[var(--stroke)] rounded-lg shadow-lg max-h-60 overflow-y-auto">
            {loading ? (
              <div className="py-4 text-center text-sm text-[var(--paragraph-light)]">
                検索中...
              </div>
            ) : results.length === 0 ? (
              <div className="py-4 text-center text-sm text-[var(--paragraph-light)]">
                {query.trim() ? '該当する生徒がいません' : '名前・かな・コードで検索'}
              </div>
            ) : (
              <ul className="py-1">
                {results.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(s)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--surface)] flex justify-between items-center gap-2"
                    >
                      <span className="font-medium truncate">
                        {s.last_name} {s.first_name}
                        <span className="text-[var(--paragraph)] font-normal ml-1">
                          （{gradeLabel(s.grade)}）
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
