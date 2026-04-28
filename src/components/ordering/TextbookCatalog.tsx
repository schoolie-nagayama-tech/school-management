'use client';

import { useState, useMemo, useCallback } from 'react';
import { Search, AlertTriangle, Package, ShoppingCart, X, Trash2 } from 'lucide-react';
import type { Textbook, Material } from '@/types/database';

interface StudentOption {
  id: string;
  last_name: string;
  first_name: string;
  grade: number | null;
}

export interface CartItem {
  id: string; // unique key for cart
  textbookName: string;
  studentId: string;
  studentLabel: string;
  quantity: number;
  textbook: Textbook;
}

interface TextbookCatalogProps {
  textbooks: Textbook[];
  students: StudentOption[];
  canEdit: boolean;
  materials: Material[];
  onOrder: (textbookName: string, studentId: string, quantity: number, notes: string) => Promise<void>;
  onBulkOrder: (items: CartItem[]) => Promise<void>;
  onStockAdjust?: (material: Material) => void;
  onStockRegister?: (textbookName: string) => void;
}

const ITEMS_PER_PAGE = 60;

// ─── Subject Color Coding ─────────────────────────────────
const SUBJECT_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  '英語': { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  '数学': { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  '国語': { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  '理科': { bg: 'bg-purple-50', text: 'text-purple-700', dot: 'bg-purple-500' },
  '社会': { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
};
const DEFAULT_COLOR = { bg: 'bg-gray-50', text: 'text-gray-700', dot: 'bg-gray-400' };

function getSubjectColor(subject: string | null) {
  if (!subject) return DEFAULT_COLOR;
  return SUBJECT_COLORS[subject] ?? DEFAULT_COLOR;
}

function gradeLabel(grade: number | null): string {
  if (grade === null || grade === undefined) return '';
  if (grade <= 6) return `小${grade}`;
  if (grade <= 9) return `中${grade - 6}`;
  return `高${grade - 9}`;
}

function formatTextbookLabel(tb: Textbook): string {
  const parts = [tb.name];
  if (tb.publisher) parts.push(tb.publisher);
  if (tb.grade) parts.push(tb.grade);
  if (tb.subject) parts.push(tb.subject);
  return parts.join(' | ');
}

// ─── Product Card ───────────────────────────────────────────

interface TextbookProductCardProps {
  textbook: Textbook;
  students: StudentOption[];
  canEdit: boolean;
  stockQuantity: number | null;
  onAddToCart: (textbook: Textbook, textbookName: string, studentId: string, studentLabel: string, quantity: number) => void;
  onStockAdjust?: () => void;
}

function TextbookProductCard({ textbook, students, canEdit, stockQuantity, onAddToCart, onStockAdjust }: TextbookProductCardProps) {
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [addedSuccess, setAddedSuccess] = useState(false);

  const handleAddToCart = () => {
    if (!selectedStudentId) return;
    const student = students.find((s) => s.id === selectedStudentId);
    if (!student) return;
    const studentLabel = `${gradeLabel(student.grade)} ${student.last_name} ${student.first_name}`;
    onAddToCart(textbook, formatTextbookLabel(textbook), selectedStudentId, studentLabel, quantity);
    setSelectedStudentId('');
    setQuantity(1);
    setAddedSuccess(true);
    setTimeout(() => setAddedSuccess(false), 1500);
  };

  const color = getSubjectColor(textbook.subject);

  // Stock display: 0が正常（全配布済み）、多いほど要対応（未配布在庫あり）
  const stockColor =
    stockQuantity === null
      ? 'text-gray-400'
      : stockQuantity === 0
        ? 'text-green-600'
        : stockQuantity >= 10
          ? 'text-red-600 font-semibold'
          : stockQuantity >= 5
            ? 'text-orange-600 font-medium'
            : 'text-[#1e3a5f]';

  return (
    <div className={`rounded-lg border ${stockQuantity !== null && stockQuantity >= 10 ? 'border-red-300' : stockQuantity !== null && stockQuantity >= 5 ? 'border-orange-300' : 'border-gray-200'} hover:shadow-md transition-shadow flex flex-col overflow-hidden`}>
      {/* Header: 学年 + 科目（色付き帯） */}
      <div className={`flex items-center justify-between px-3 py-1.5 ${color.bg}`}>
        {textbook.grade ? (
          <span className="text-xs font-bold text-[#1e3a5f] bg-white/80 px-2 py-0.5 rounded">
            {textbook.grade}
          </span>
        ) : (
          <span className="text-[10px] text-gray-400">-</span>
        )}
        {textbook.subject && (
          <span className={`text-xs font-semibold ${color.text}`}>
            {textbook.subject}
          </span>
        )}
      </div>
      {/* Textbook Info */}
      <div className="px-3 pt-2 pb-1">
        <div className="text-sm font-semibold text-[#1e3a5f] line-clamp-2 leading-tight" title={textbook.name}>
          {textbook.name}
        </div>
        {textbook.publisher && (
          <div className="text-[11px] text-gray-400 mt-0.5">{textbook.publisher}</div>
        )}
      </div>

      {/* Stock Display */}
      <div className="flex items-center justify-between px-3 mb-2">
        <span className={`text-xs ${stockColor}`}>
          {stockQuantity === null
            ? '在庫: 未登録'
            : stockQuantity === 0
              ? '在庫: 0冊（配布完了）'
              : `在庫: ${stockQuantity}冊`}
          {stockQuantity !== null && stockQuantity >= 5 && (
            <AlertTriangle className="inline w-3.5 h-3.5 ml-0.5" />
          )}
        </span>
        {canEdit && (
          <button
            onClick={onStockAdjust}
            className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-[#1e3a5f] transition-colors duration-150"
          >
            {stockQuantity !== null ? '在庫調整' : '在庫登録'}
          </button>
        )}
      </div>

      {/* Order Section */}
      {canEdit && (
        <div className="border-t border-gray-100 pt-2 px-3 pb-3 flex-1 flex flex-col gap-1.5">
          <select
            value={selectedStudentId}
            onChange={(e) => setSelectedStudentId(e.target.value)}
            className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-xs bg-white text-gray-700 focus:ring-1 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f] transition-colors duration-150"
          >
            <option value="">生徒を選択...</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {gradeLabel(s.grade)} {s.last_name} {s.first_name}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              max={20}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
              className="w-14 text-center px-1 py-1.5 border border-gray-200 rounded-md text-xs"
            />
            <span className="text-xs text-gray-400">冊</span>
            <button
              onClick={handleAddToCart}
              disabled={!selectedStudentId}
              className={`flex-1 py-1.5 rounded-md font-medium text-xs transition-colors ${
                addedSuccess
                  ? 'bg-green-600 text-white'
                  : 'bg-[#1e3a5f] text-white hover:bg-[#2d4a6f] disabled:opacity-40 disabled:cursor-not-allowed'
              }`}
            >
              {addedSuccess ? '追加しました' : 'カートに追加'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Subject Legend ──────────────────────────────────────────

function SubjectLegend() {
  const colorEntries = Object.entries(SUBJECT_COLORS);
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3 px-1">
      {colorEntries.map(([subject, colors]) => (
        <span
          key={subject}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colors.bg} ${colors.text}`}
        >
          <span className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
          {subject}
        </span>
      ))}
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-600">
        <span className="w-2.5 h-2.5 rounded-full bg-gray-400" />
        その他
      </span>
    </div>
  );
}

// ─── Cart Drawer ────────────────────────────────────────────

function CartDrawer({
  isOpen,
  items,
  onClose,
  onRemove,
  onSubmit,
  isSubmitting,
}: {
  isOpen: boolean;
  items: CartItem[];
  onClose: () => void;
  onRemove: (id: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}) {
  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <ShoppingCart className="w-5 h-5" />
            発注カート（{items.length}件）
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 transition-colors duration-150">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {items.length === 0 ? (
            <div className="text-center text-gray-400 py-12">
              <ShoppingCart className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">カートは空です</p>
            </div>
          ) : (
            items.map((item) => {
              const color = getSubjectColor(item.textbook.subject);
              return (
                <div
                  key={item.id}
                  className={`flex items-start gap-3 p-3 rounded-lg border border-gray-200 bg-white`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{item.textbook.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {item.studentLabel} × {item.quantity}冊
                    </div>
                    {item.textbook.subject && (
                      <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded mt-1 ${color.bg} ${color.text}`}>
                        {item.textbook.grade} {item.textbook.subject}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => onRemove(item.id)}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors duration-150"
                    title="削除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="border-t border-gray-200 p-4 space-y-2">
            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>合計</span>
              <span className="font-bold text-gray-900">{items.length}件 / {items.reduce((sum, i) => sum + i.quantity, 0)}冊</span>
            </div>
            <button
              onClick={onSubmit}
              disabled={isSubmitting}
              className="w-full py-2.5 rounded-lg font-bold text-sm bg-[#1e3a5f] text-white hover:bg-[#2d4a6f] disabled:opacity-50 transition-colors duration-150"
            >
              {isSubmitting ? '発注中...' : 'まとめて発注する'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Main Catalog ───────────────────────────────────────────

export function TextbookCatalog({ textbooks, students, canEdit, materials, onBulkOrder, onStockAdjust, onStockRegister }: TextbookCatalogProps) {
  // Cart state
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAddToCart = useCallback((textbook: Textbook, textbookName: string, studentId: string, studentLabel: string, quantity: number) => {
    const newItem: CartItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      textbookName,
      studentId,
      studentLabel,
      quantity,
      textbook,
    };
    setCartItems((prev) => [...prev, newItem]);
  }, []);

  const handleRemoveFromCart = useCallback((id: string) => {
    setCartItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleBulkOrder = useCallback(async () => {
    if (cartItems.length === 0) return;
    setIsSubmitting(true);
    try {
      await onBulkOrder(cartItems);
      setCartItems([]);
      setIsCartOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  }, [cartItems, onBulkOrder]);

  // Filters
  const [search, setSearch] = useState('');
  const [schoolTypeFilter, setSchoolTypeFilter] = useState<string>('all');
  const [selectedGrades, setSelectedGrades] = useState<Set<string>>(new Set());
  const [selectedSubjects, setSelectedSubjects] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);

  // Build a stock lookup: textbook label → stock_quantity
  const stockMap = useMemo(() => {
    const map = new Map<string, { quantity: number; material: Material }>();
    for (const m of materials) {
      map.set(m.name, { quantity: m.stock_quantity, material: m });
    }
    return map;
  }, [materials]);

  // Derive available grades and subjects from data
  const { grades, subjects } = useMemo(() => {
    const gradeSet = new Set<string>();
    const subjectSet = new Set<string>();
    textbooks.forEach((tb) => {
      if (tb.grade) gradeSet.add(tb.grade);
      if (tb.subject) subjectSet.add(tb.subject);
    });
    return {
      grades: Array.from(gradeSet).sort(),
      subjects: Array.from(subjectSet).sort(),
    };
  }, [textbooks]);

  // Filter textbooks
  const filteredTextbooks = useMemo(() => {
    let result = textbooks;

    // School type filter
    if (schoolTypeFilter !== 'all') {
      result = result.filter((tb) => tb.grade_category === schoolTypeFilter);
    }

    // Grade filter
    if (selectedGrades.size > 0) {
      result = result.filter((tb) => tb.grade !== null && selectedGrades.has(tb.grade));
    }

    // Subject filter
    if (selectedSubjects.size > 0) {
      result = result.filter((tb) => tb.subject !== null && selectedSubjects.has(tb.subject));
    }

    // Search filter
    if (search.trim()) {
      const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
      result = result.filter((tb) => {
        const searchable = [tb.name, tb.publisher, tb.grade, tb.subject]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return terms.every((term) => searchable.includes(term));
      });
    }

    // 科目 → 学年の順でデフォルトソート
    const SUBJECT_ORDER = ['英語', '数学', '算数', '国語', '理科', '社会'];
    result = [...result].sort((a, b) => {
      const subA = SUBJECT_ORDER.indexOf(a.subject || '');
      const subB = SUBJECT_ORDER.indexOf(b.subject || '');
      const orderA = subA === -1 ? 999 : subA;
      const orderB = subB === -1 ? 999 : subB;
      if (orderA !== orderB) return orderA - orderB;
      return (a.grade || '').localeCompare(b.grade || '', 'ja');
    });

    return result;
  }, [textbooks, schoolTypeFilter, selectedGrades, selectedSubjects, search]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredTextbooks.length / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedTextbooks = filteredTextbooks.slice(
    (safeCurrentPage - 1) * ITEMS_PER_PAGE,
    safeCurrentPage * ITEMS_PER_PAGE
  );

  // Reset page on filter change
  const resetPage = useCallback(() => setCurrentPage(1), []);

  const toggleGrade = (grade: string) => {
    setSelectedGrades((prev) => {
      const next = new Set(prev);
      if (next.has(grade)) next.delete(grade);
      else next.add(grade);
      return next;
    });
    resetPage();
  };

  const toggleSubject = (subject: string) => {
    setSelectedSubjects((prev) => {
      const next = new Set(prev);
      if (next.has(subject)) next.delete(subject);
      else next.add(subject);
      return next;
    });
    resetPage();
  };

  const clearFilters = () => {
    setSchoolTypeFilter('all');
    setSelectedGrades(new Set());
    setSelectedSubjects(new Set());
    setSearch('');
    resetPage();
  };

  const hasActiveFilters =
    schoolTypeFilter !== 'all' || selectedGrades.size > 0 || selectedSubjects.size > 0 || search.trim() !== '';

  // Page number buttons
  const pageNumbers = useMemo(() => {
    const pages: number[] = [];
    const maxVisible = 5;
    let start = Math.max(1, safeCurrentPage - Math.floor(maxVisible / 2));
    const end = Math.min(totalPages, start + maxVisible - 1);
    start = Math.max(1, end - maxVisible + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }, [safeCurrentPage, totalPages]);

  // Helper to get stock info for a textbook
  const getStockInfo = useCallback((tb: Textbook) => {
    const label = formatTextbookLabel(tb);
    const entry = stockMap.get(label) ?? stockMap.get(tb.name);
    return entry ?? null;
  }, [stockMap]);

  return (
    <div className="flex gap-4">
      {/* ─── Left Sidebar Filters ─── */}
      <div className="w-48 flex-shrink-0 sticky top-4 self-start hidden md:block">
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
          {/* School Type */}
          <div>
            <h4 className="text-xs font-semibold text-gray-700 mb-2">学校種別</h4>
            <div className="space-y-1">
              {[
                { value: 'all', label: '全て' },
                { value: 'elementary', label: '小学' },
                { value: 'middle', label: '中学' },
              ].map((opt) => (
                <label key={opt.value} className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                  <input
                    type="radio"
                    name="schoolType"
                    value={opt.value}
                    checked={schoolTypeFilter === opt.value}
                    onChange={() => {
                      setSchoolTypeFilter(opt.value);
                      resetPage();
                    }}
                    className="w-3 h-3 text-[#1e3a5f] focus:ring-[#1e3a5f]"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* Grade */}
          {grades.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-700 mb-2">学年</h4>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {grades.map((grade) => (
                  <label key={grade} className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedGrades.has(grade)}
                      onChange={() => toggleGrade(grade)}
                      className="w-3 h-3 rounded text-[#1e3a5f] focus:ring-[#1e3a5f]"
                    />
                    {grade}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Subject */}
          {subjects.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-700 mb-2">科目</h4>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {subjects.map((subject) => (
                  <label key={subject} className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedSubjects.has(subject)}
                      onChange={() => toggleSubject(subject)}
                      className="w-3 h-3 rounded text-[#1e3a5f] focus:ring-[#1e3a5f]"
                    />
                    {subject}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Clear Filters */}
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="w-full text-xs text-gray-500 hover:text-gray-700 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors duration-150"
            >
              フィルターをクリア
            </button>
          )}
        </div>
      </div>

      {/* ─── Product Grid ─── */}
      <div className="flex-1 min-w-0">
        {/* Search Bar */}
        <div className="mb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                resetPage();
              }}
              placeholder="テキスト名・出版社で検索..."
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white placeholder-gray-400 focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f] transition-colors duration-150"
            />
          </div>
        </div>

        {/* Subject Legend */}
        <SubjectLegend />

        {/* Results count */}
        <div className="text-xs text-gray-500 mb-2">
          {filteredTextbooks.length}件の教材
        </div>

        {/* Mobile Filters (visible on small screens) */}
        <div className="flex flex-wrap gap-2 mb-3 md:hidden">
          <select
            value={schoolTypeFilter}
            onChange={(e) => {
              setSchoolTypeFilter(e.target.value);
              resetPage();
            }}
            className="px-2 py-1 border border-gray-200 rounded text-xs bg-white text-gray-600"
          >
            <option value="all">種別: 全て</option>
            <option value="elementary">小学</option>
            <option value="middle">中学</option>
          </select>
        </div>

        {/* Grid */}
        {paginatedTextbooks.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <Package className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-gray-800 mb-1">
              {textbooks.length === 0 ? 'テキストが登録されていません' : '条件に一致するテキストがありません'}
            </h3>
            <p className="text-sm text-gray-500">
              {textbooks.length === 0
                ? 'テキストマスタにデータを追加してください'
                : '検索条件やフィルターを変更してみてください'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {paginatedTextbooks.map((tb) => {
              const stockInfo = getStockInfo(tb);
              return (
                <TextbookProductCard
                  key={tb.id}
                  textbook={tb}
                  students={students}
                  canEdit={canEdit}
                  stockQuantity={stockInfo ? stockInfo.quantity : null}
                  onAddToCart={handleAddToCart}
                  onStockAdjust={
                    stockInfo && onStockAdjust
                      ? () => onStockAdjust(stockInfo.material)
                      : onStockRegister
                        ? () => onStockRegister(formatTextbookLabel(tb))
                        : undefined
                  }
                />
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-1">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={safeCurrentPage <= 1}
              className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors duration-150"
            >
              &laquo;
            </button>
            {pageNumbers.map((page) => (
              <button
                key={page}
                onClick={() => setCurrentPage(page)}
                className={`w-7 h-7 text-xs rounded transition-colors ${
                  page === safeCurrentPage
                    ? 'bg-[#1e3a5f] text-white'
                    : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {page}
              </button>
            ))}
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={safeCurrentPage >= totalPages}
              className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors duration-150"
            >
              &raquo;
            </button>
          </div>
        )}
      </div>

      {/* Floating Cart Bar */}
      {canEdit && cartItems.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 shadow-[0_-4px_12px_rgba(0,0,0,0.1)]">
          <div className="max-w-screen-xl mx-auto px-4 py-3 flex items-center justify-between">
            <button
              onClick={() => setIsCartOpen(true)}
              className="flex items-center gap-2 text-sm text-gray-700 hover:text-[#1e3a5f] transition-colors duration-150"
            >
              <div className="relative">
                <ShoppingCart className="w-5 h-5" />
                <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-bold w-4.5 h-4.5 rounded-full flex items-center justify-center min-w-[18px] px-1">
                  {cartItems.length}
                </span>
              </div>
              <span className="font-medium">
                カート: {cartItems.length}件（{cartItems.reduce((s, i) => s + i.quantity, 0)}冊）
              </span>
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCartItems([])}
                className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors duration-150"
              >
                全て取消
              </button>
              <button
                onClick={() => setIsCartOpen(true)}
                className="px-4 py-1.5 text-sm rounded-lg font-bold bg-[#1e3a5f] text-white hover:bg-[#2d4a6f] transition-colors duration-150"
              >
                まとめて発注
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cart Drawer */}
      <CartDrawer
        isOpen={isCartOpen}
        items={cartItems}
        onClose={() => setIsCartOpen(false)}
        onRemove={handleRemoveFromCart}
        onSubmit={handleBulkOrder}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}
