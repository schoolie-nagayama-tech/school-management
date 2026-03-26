'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { StudentSelector } from './StudentSelector';
import type { Textbook } from '@/types/database';

interface StudentOption {
  id: string;
  last_name: string;
  first_name: string;
  grade: number | null;
}

interface TextbookOrderFormProps {
  students: StudentOption[];
  textbooks: Textbook[];
  canEdit: boolean;
  onOrder: (textbookName: string, studentId: string, quantity: number, notes: string) => Promise<void>;
}

export function TextbookOrderForm({ students, textbooks, canEdit, onOrder }: TextbookOrderFormProps) {
  const [searchText, setSearchText] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedTextbook, setSelectedTextbook] = useState<Textbook | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [isOrdering, setIsOrdering] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter textbooks based on search
  const filteredTextbooks = useMemo(() => {
    if (!searchText.trim()) return textbooks.slice(0, 20);
    const terms = searchText.toLowerCase().split(/\s+/).filter(Boolean);
    return textbooks
      .filter((tb) => {
        const searchable = [tb.name, tb.publisher, tb.grade, tb.subject]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return terms.every((term) => searchable.includes(term));
      })
      .slice(0, 20);
  }, [textbooks, searchText]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSelectTextbook = (tb: Textbook) => {
    setSelectedTextbook(tb);
    setSearchText('');
    setIsDropdownOpen(false);
  };

  const handleClearTextbook = () => {
    setSelectedTextbook(null);
    setSearchText('');
  };

  const formatTextbookLabel = (tb: Textbook) => {
    const parts = [tb.name];
    if (tb.publisher) parts.push(tb.publisher);
    if (tb.grade) parts.push(tb.grade);
    if (tb.subject) parts.push(tb.subject);
    return parts.join(' | ');
  };

  const handleOrder = async () => {
    if (!selectedTextbook || !selectedStudentId) return;
    setIsOrdering(true);
    try {
      await onOrder(
        formatTextbookLabel(selectedTextbook),
        selectedStudentId,
        quantity,
        notes
      );
      setSelectedTextbook(null);
      setSelectedStudentId('');
      setQuantity(1);
      setNotes('');
      setSearchText('');
      setOrderSuccess(true);
      setTimeout(() => setOrderSuccess(false), 2000);
    } finally {
      setIsOrdering(false);
    }
  };

  if (!canEdit) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
      {/* Header */}
      <div className="px-4 py-3 bg-[#f0f4f8] rounded-t-xl border-b border-gray-200">
        <h3 className="text-sm font-semibold text-[#1e3a5f] flex items-center gap-1.5">
          <span className="text-base">📚</span>
          テキスト発注
        </h3>
      </div>

      {/* Form Body */}
      <div className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] lg:grid-cols-[2fr_1.5fr_auto_1fr_auto] gap-3 items-end">
          {/* Textbook Selector */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">テキスト</label>
            <div ref={dropdownRef} className="relative">
              {selectedTextbook && !isDropdownOpen ? (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm min-h-[34px]">
                  <span className="flex-1 text-gray-800 truncate text-xs">
                    {formatTextbookLabel(selectedTextbook)}
                  </span>
                  <button
                    type="button"
                    onClick={handleClearTextbook}
                    disabled={isOrdering}
                    className="text-gray-400 hover:text-gray-600 text-xs flex-shrink-0"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <input
                  ref={inputRef}
                  type="text"
                  value={searchText}
                  onChange={(e) => {
                    setSearchText(e.target.value);
                    setIsDropdownOpen(true);
                  }}
                  onFocus={() => setIsDropdownOpen(true)}
                  placeholder="🔍 テキスト名・出版社・学年・教科で検索..."
                  disabled={isOrdering}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white placeholder-gray-400 focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f] transition-colors"
                />
              )}
              {isDropdownOpen && !isOrdering && (
                <div className="absolute z-30 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {filteredTextbooks.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-gray-400">
                      該当するテキストがありません
                    </div>
                  ) : (
                    filteredTextbooks.map((tb) => (
                      <button
                        key={tb.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-b-0"
                        onClick={() => handleSelectTextbook(tb)}
                      >
                        <div className="font-medium text-gray-800 text-xs">{tb.name}</div>
                        <div className="text-[11px] text-gray-500 mt-0.5">
                          {[tb.publisher, tb.grade, tb.subject].filter(Boolean).join(' / ')}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Student Selector */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">生徒</label>
            <StudentSelector
              students={students}
              value={selectedStudentId}
              onChange={setSelectedStudentId}
              disabled={isOrdering}
            />
          </div>

          {/* Quantity */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">数量</label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={isOrdering || quantity <= 1}
                className="w-7 h-[34px] rounded border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40 text-sm"
              >
                −
              </button>
              <input
                type="number"
                min={1}
                max={99}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Math.min(99, parseInt(e.target.value) || 1)))}
                disabled={isOrdering}
                className="w-12 text-center px-1 py-1.5 border border-gray-200 rounded text-sm"
              />
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.min(99, q + 1))}
                disabled={isOrdering || quantity >= 99}
                className="w-7 h-[34px] rounded border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40 text-sm"
              >
                ＋
              </button>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">メモ</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="メモ（任意）"
              disabled={isOrdering}
              className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white placeholder-gray-400 focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f] transition-colors"
            />
          </div>

          {/* Order Button */}
          <div>
            <label className="block text-xs text-gray-500 mb-1 invisible">発注</label>
            <button
              onClick={handleOrder}
              disabled={!selectedTextbook || !selectedStudentId || isOrdering}
              className={`w-full whitespace-nowrap px-4 py-1.5 rounded-lg font-medium text-sm transition-colors ${
                orderSuccess
                  ? 'bg-green-600 text-white'
                  : 'bg-[#1e3a5f] text-white hover:bg-[#162d4a] disabled:opacity-50 disabled:cursor-not-allowed'
              }`}
            >
              {isOrdering ? '発注中...' : orderSuccess ? '発注しました!' : '🛒 発注'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
