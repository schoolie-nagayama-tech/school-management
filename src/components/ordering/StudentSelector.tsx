'use client';

import { useState, useRef, useEffect } from 'react';

interface StudentOption {
  id: string;
  last_name: string;
  first_name: string;
  grade: number | null;
}

interface StudentSelectorProps {
  students: StudentOption[];
  value: string;
  onChange: (studentId: string) => void;
  disabled?: boolean;
}

export function StudentSelector({ students, value, onChange, disabled }: StudentSelectorProps) {
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedStudent = students.find((s) => s.id === value);

  const filtered = search
    ? students.filter((s) => {
        const name = `${s.last_name}${s.first_name}`;
        return name.toLowerCase().includes(search.toLowerCase());
      })
    : students;

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSelect = (studentId: string) => {
    onChange(studentId);
    setSearch('');
    setIsOpen(false);
  };

  const handleClear = () => {
    onChange('');
    setSearch('');
  };

  const gradeLabel = (grade: number | null) => {
    if (grade === null || grade === undefined) return '';
    if (grade <= 6) return `小${grade}`;
    if (grade <= 9) return `中${grade - 6}`;
    return `高${grade - 9}`;
  };

  return (
    <div ref={containerRef} className="relative">
      {selectedStudent && !isOpen ? (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm">
          <span className="text-xs text-gray-500">{gradeLabel(selectedStudent.grade)}</span>
          <span className="flex-1 text-gray-800">
            {selectedStudent.last_name} {selectedStudent.first_name}
          </span>
          {!disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="text-gray-400 hover:text-gray-600 text-xs"
            >
              ✕
            </button>
          )}
        </div>
      ) : (
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder="生徒を検索..."
          disabled={disabled}
          className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white placeholder-gray-400 focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f] transition-colors"
        />
      )}
      {isOpen && !disabled && (
        <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">該当する生徒がいません</div>
          ) : (
            filtered.map((s) => (
              <button
                key={s.id}
                type="button"
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors flex items-center gap-2"
                onClick={() => handleSelect(s.id)}
              >
                <span className="text-xs text-gray-400 w-6">{gradeLabel(s.grade)}</span>
                <span className="text-gray-800">{s.last_name} {s.first_name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
