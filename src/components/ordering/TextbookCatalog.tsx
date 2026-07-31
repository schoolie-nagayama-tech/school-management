'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Search, AlertTriangle, Package, ShoppingCart, X, Trash2, Plus, Minus } from 'lucide-react';
import type { Textbook, Material } from '@/types/database';
import { formatGradeLabelOrEmpty } from '@/lib/utils/gradeLabel';

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
  /**
   * 生徒スロットの初期選択（入会フローから特定の生徒の発注に来たとき用）。
   * 各カードの1冊目にだけ入れる。以降の増冊や手動変更は従来どおり自由。
   */
  initialStudentId?: string;
  canEdit: boolean;
  materials: Material[];
  onOrder: (
    textbookName: string,
    studentId: string,
    quantity: number,
    notes: string
  ) => Promise<void>;
  onBulkOrder: (items: CartItem[]) => Promise<void>;
  onStockAdjust?: (material: Material) => void;
  onStockRegister?: (textbookName: string) => void;
  /** カート保存のスコープ（選択中の教室）。変わったらカートを捨てる。 */
  schoolScopeKey: string;
  /**
   * すでに発注済み（未キャンセル）の「生徒ID::教材名ラベル」集合。
   * 生徒選択肢に「発注済」を表示して事前に気づかせる（L0・即時警告）。
   * 所持済みは含めない（このページで未ロードのため）。確定時のサーバー再判定で最終的に弾く。
   */
  existingOrderPairs?: Set<string>;
}

const ITEMS_PER_PAGE = 60;

// カートは本コンポーネントの useState だが、親が fetchData() する度に
// isLoading の出し分けで本コンポーネントごとアンマウントされ、カートが黙って消える
// （教材登録・在庫調整など、ページから動いていなくても起きる）。
// sessionStorage に退避して復元する。タブを閉じたら破棄でよいので localStorage は使わない。
const CART_STORAGE_KEY = 'nest-ordering-cart-v1';

type StoredCart = { scope: string; items: CartItem[] };

/** 保存済みカートを読む。スコープ（教室）が違えば捨てる。壊れていても落とさない。 */
function loadStoredCart(scope: string): CartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const saved = JSON.parse(raw) as StoredCart;
    if (saved?.scope !== scope || !Array.isArray(saved.items)) return [];
    return saved.items;
  } catch {
    return [];
  }
}

// ─── Subject Color Coding ─────────────────────────────────
const SUBJECT_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  英語: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  数学: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  国語: { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  理科: { bg: 'bg-purple-50', text: 'text-purple-700', dot: 'bg-purple-500' },
  社会: { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
};
const DEFAULT_COLOR = { bg: 'bg-gray-50', text: 'text-gray-700', dot: 'bg-gray-400' };

function getSubjectColor(subject: string | null) {
  if (!subject) return DEFAULT_COLOR;
  return SUBJECT_COLORS[subject] ?? DEFAULT_COLOR;
}

function formatTextbookLabel(tb: Textbook): string {
  const parts = [tb.name];
  if (tb.publisher) parts.push(tb.publisher);
  if (tb.grade) parts.push(tb.grade);
  if (tb.subject) parts.push(tb.subject);
  return parts.join(' | ');
}

// ─── Product Card ───────────────────────────────────────────

const SAMPLE_VALUE = '__SAMPLE__';

interface TextbookProductCardProps {
  textbook: Textbook;
  students: StudentOption[];
  canEdit: boolean;
  stockQuantity: number | null;
  onAddToCart: (
    textbook: Textbook,
    textbookName: string,
    studentId: string,
    studentLabel: string,
    quantity: number
  ) => void;
  onStockAdjust?: () => void;
  /** すでに発注済みの「生徒ID::教材名ラベル」集合（発注済バッジ用）。 */
  existingOrderPairs?: Set<string>;
  /** 1冊目の生徒スロットの初期値（入会フローからの遷移時）。 */
  initialStudentId?: string;
}

function TextbookProductCard({
  textbook,
  students,
  initialStudentId,
  canEdit,
  stockQuantity,
  onAddToCart,
  onStockAdjust,
  existingOrderPairs,
}: TextbookProductCardProps) {
  const cardLabel = formatTextbookLabel(textbook);
  // この生徒がこのテキストをすでに発注済みか（未キャンセル）。選択肢に注記して事前に気づかせる。
  const isOrdered = (studentId: string) =>
    !!existingOrderPairs && existingOrderPairs.has(`${studentId}::${cardLabel}`);
  // 冊数分の生徒スロット。1冊=1生徒（または見本）として、冊数を増やすと
  // その冊数分だけ生徒を割り当てられる。空欄の冊はカートに追加されない。
  // 初期選択は students に実在するときだけ効かせる。
  // 実在しない ID を入れると、select は該当 option が無いので「生徒を選択...」に見えるのに
  // 内部状態だけ ID を持ち、そのままカートに入って別教室の生徒に発注されうる。
  const [studentIds, setStudentIds] = useState<string[]>([
    initialStudentId && students.some((s) => s.id === initialStudentId) ? initialStudentId : '',
  ]);
  const [addedSuccess, setAddedSuccess] = useState(false);

  const quantity = studentIds.length;

  // 冊数を変更（生徒スロット配列を伸縮。既存の選択は保持）
  const changeQuantity = (next: number) => {
    const q = Math.max(1, Math.min(20, next));
    setStudentIds((prev) => {
      if (q === prev.length) return prev;
      if (q < prev.length) return prev.slice(0, q);
      return [...prev, ...Array(q - prev.length).fill('')];
    });
  };

  const setStudentAt = (index: number, value: string) => {
    setStudentIds((prev) => {
      const nextArr = [...prev];
      nextArr[index] = value;
      return nextArr;
    });
  };

  // 他スロットで選択済みの実生徒は除外（二重発注防止）。見本は重複可。
  const getAvailableStudents = (currentIndex: number) => {
    const taken = new Set(
      studentIds.filter((id, i) => i !== currentIndex && id && id !== SAMPLE_VALUE)
    );
    return students.filter((s) => !taken.has(s.id));
  };

  const filledCount = studentIds.filter(Boolean).length;

  const handleAddToCart = () => {
    const filled = studentIds.filter(Boolean);
    if (filled.length === 0) return;
    // 1冊ごとに1カート項目（= 1発注レコード）として追加する
    for (const sid of filled) {
      if (sid === SAMPLE_VALUE) {
        onAddToCart(textbook, formatTextbookLabel(textbook), SAMPLE_VALUE, '見本', 1);
      } else {
        const student = students.find((s) => s.id === sid);
        if (!student) continue;
        const studentLabel = `${formatGradeLabelOrEmpty(student.grade)} ${student.last_name} ${student.first_name}`;
        onAddToCart(textbook, formatTextbookLabel(textbook), sid, studentLabel, 1);
      }
    }
    setStudentIds(['']);
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
    <div
      className={`rounded-lg border ${stockQuantity !== null && stockQuantity >= 10 ? 'border-red-300' : stockQuantity !== null && stockQuantity >= 5 ? 'border-orange-300' : 'border-gray-200'} hover:shadow-md transition-[box-shadow] duration-150 ease-out flex flex-col overflow-hidden`}
    >
      {/* Header: 学年 + 科目（色付き帯） */}
      <div className={`flex items-center justify-between px-3 py-1.5 ${color.bg}`}>
        {textbook.grade ? (
          <span className="text-xs font-bold text-[#1e3a5f] bg-white/80 px-2 py-0.5 rounded">
            {textbook.grade}
          </span>
        ) : (
          <span className="text-[11px] text-gray-400">-</span>
        )}
        {textbook.subject && (
          <span className={`text-xs font-semibold ${color.text}`}>{textbook.subject}</span>
        )}
      </div>
      {/* Textbook Info */}
      <div className="px-3 pt-2 pb-1">
        <div
          className="text-sm font-semibold text-[#1e3a5f] line-clamp-2 leading-tight"
          title={textbook.name}
        >
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
            className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-[#1e3a5f] transition-[background-color,color] duration-150 ease-out"
          >
            {stockQuantity !== null ? '在庫調整' : '在庫登録'}
          </button>
        )}
      </div>

      {/* Order Section */}
      {canEdit && (
        <div className="border-t border-gray-100 pt-2 px-3 pb-3 flex-1 flex flex-col gap-1.5">
          {/* 冊数ステッパー */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">冊数</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => changeQuantity(quantity - 1)}
                disabled={quantity <= 1}
                aria-label="冊数を減らす"
                className="p-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97]"
              >
                <Minus className="w-3 h-3" />
              </button>
              <input
                type="number"
                min={1}
                max={20}
                value={quantity}
                onChange={(e) => changeQuantity(parseInt(e.target.value) || 1)}
                className="w-12 text-center px-1 py-1 border border-gray-200 rounded-md text-xs"
              />
              <button
                type="button"
                onClick={() => changeQuantity(quantity + 1)}
                disabled={quantity >= 20}
                aria-label="冊数を増やす"
                className="p-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97]"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
            <span className="text-[11px] text-gray-400 ml-auto">
              {filledCount}/{quantity}名
            </span>
          </div>

          {/* 冊数分の生徒スロット（1冊ごとに1名 or 見本） */}
          <div className="space-y-1">
            {studentIds.map((sid, index) => (
              <div key={index} className="flex items-center gap-1">
                {quantity > 1 && (
                  <span className="text-[10px] text-gray-400 w-4 text-right flex-shrink-0">
                    {index + 1}
                  </span>
                )}
                <select
                  value={sid}
                  onChange={(e) => setStudentAt(index, e.target.value)}
                  className="flex-1 min-w-0 px-2 py-1.5 border border-gray-200 rounded-md text-xs bg-white text-gray-700 focus:ring-1 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f] transition-[background-color,color] duration-150 ease-out"
                >
                  <option value="">生徒を選択...</option>
                  <option value={SAMPLE_VALUE} className="font-medium text-purple-700">
                    見本（生徒なし）
                  </option>
                  {getAvailableStudents(index).map((s) => (
                    <option key={s.id} value={s.id}>
                      {formatGradeLabelOrEmpty(s.grade)} {s.last_name} {s.first_name}
                      {isOrdered(s.id) ? '（発注済）' : ''}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <button
            onClick={handleAddToCart}
            disabled={filledCount === 0}
            className={`py-1.5 rounded-md font-medium text-xs transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] ${
              addedSuccess
                ? 'bg-green-600 text-white'
                : 'bg-[#1e3a5f] text-white hover:bg-[#2d4a6f] disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
          >
            {addedSuccess
              ? '追加しました'
              : filledCount > 1
                ? `${filledCount}件をカートに追加`
                : 'カートに追加'}
          </button>
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
      {/* Overlay: opacity フェードのみ（GPU合成） */}
      <div
        className="fixed inset-0 bg-black/30 z-40 animate-[fade-in_200ms_ease-out_forwards]"
        onClick={onClose}
      />
      {/* Drawer: --ease-drawer でスライドイン */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-xl z-50 flex flex-col animate-[drawer-slide-in_300ms_cubic-bezier(0.32,0.72,0,1)_forwards]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <ShoppingCart className="w-5 h-5" />
            発注カート（{items.length}件）
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 transition-[background-color,color] duration-150 ease-out"
          >
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
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {item.textbook.name}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {item.studentLabel} × {item.quantity}冊
                    </div>
                    {item.textbook.subject && (
                      <span
                        className={`inline-block text-[11px] px-1.5 py-0.5 rounded mt-1 ${color.bg} ${color.text}`}
                      >
                        {item.textbook.grade} {item.textbook.subject}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => onRemove(item.id)}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97]"
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
              <span className="font-bold text-gray-900">
                {items.length}件 / {items.reduce((sum, i) => sum + i.quantity, 0)}冊
              </span>
            </div>
            <button
              onClick={onSubmit}
              disabled={isSubmitting}
              className="w-full py-2.5 rounded-lg font-bold text-sm bg-[#1e3a5f] text-white hover:bg-[#2d4a6f] disabled:opacity-50 transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97]"
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

export function TextbookCatalog({
  textbooks,
  students,
  initialStudentId,
  canEdit,
  materials,
  onOrder: _onOrder,
  onBulkOrder,
  onStockAdjust,
  onStockRegister,
  schoolScopeKey,
  existingOrderPairs,
}: TextbookCatalogProps) {
  // Cart state（アンマウントで消えないよう sessionStorage から初期化する）
  const [cartItems, setCartItems] = useState<CartItem[]>(() => loadStoredCart(schoolScopeKey));
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // カートの変更を都度 sessionStorage へ反映する。
  useEffect(() => {
    try {
      if (cartItems.length === 0) {
        sessionStorage.removeItem(CART_STORAGE_KEY);
      } else {
        const payload: StoredCart = { scope: schoolScopeKey, items: cartItems };
        sessionStorage.setItem(CART_STORAGE_KEY, JSON.stringify(payload));
      }
    } catch {
      // 容量超過やプライベートモードでの失敗。保存できなくてもカート自体は使えるので無視する。
    }
  }, [cartItems, schoolScopeKey]);

  // 教室を切り替えたらカートを捨てる（別教室の生徒・教材が混ざるため）。
  // 通常は切替時に本コンポーネントがアンマウントされ初期化側の scope 判定で捨てられるが、
  // マウントされたまま切り替わった場合にここで捨てないと、他教室のカートが新スコープで保存される。
  const prevScopeRef = useRef(schoolScopeKey);
  useEffect(() => {
    if (prevScopeRef.current !== schoolScopeKey) {
      prevScopeRef.current = schoolScopeKey;
      setCartItems([]);
      setIsCartOpen(false);
    }
  }, [schoolScopeKey]);

  const handleAddToCart = useCallback(
    (
      textbook: Textbook,
      textbookName: string,
      studentId: string,
      studentLabel: string,
      quantity: number
    ) => {
      setCartItems((prev) => {
        // カート内二重発注防止: 同一生徒×同一テキストがすでにカートにあれば追加しない。
        // 見本(SAMPLE_VALUE)は複数注文が正当なので重複を許す。
        if (
          studentId !== SAMPLE_VALUE &&
          prev.some((it) => it.studentId === studentId && it.textbookName === textbookName)
        ) {
          return prev;
        }
        const newItem: CartItem = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          textbookName,
          studentId,
          studentLabel,
          quantity,
          textbook,
        };
        return [...prev, newItem];
      });
    },
    []
  );

  const handleRemoveFromCart = useCallback((id: string) => {
    setCartItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleBulkOrder = useCallback(async () => {
    if (cartItems.length === 0) return;
    setIsSubmitting(true);
    try {
      await onBulkOrder(cartItems);
      // 成功したときだけカートを空にする（失敗時に消すと入力し直しになるため）。
      setCartItems([]);
      setIsCartOpen(false);
    } catch {
      // 失敗の通知は呼び出し元がトーストで行う。ここで捕まえないと unhandled rejection になり、
      // カートは残るのに画面には何も出ない（＝無言で失敗する）ため握りつぶさず捕捉だけする。
    } finally {
      setIsSubmitting(false);
    }
  }, [cartItems, onBulkOrder]);

  // Filters
  const [search, setSearch] = useState('');
  const [schoolTypeFilter, setSchoolTypeFilter] = useState<string>('all');
  const [selectedGrades, setSelectedGrades] = useState<Set<string>>(new Set());
  const [selectedSubjects, setSelectedSubjects] = useState<Set<string>>(new Set());
  const [selectedPublishers, setSelectedPublishers] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);

  // Build a stock lookup: textbook label → stock_quantity
  const stockMap = useMemo(() => {
    const map = new Map<string, { quantity: number; material: Material }>();
    for (const m of materials) {
      map.set(m.name, { quantity: m.stock_quantity, material: m });
    }
    return map;
  }, [materials]);

  // Derive available grades, subjects, and publishers from data
  const { grades, subjects, publishers } = useMemo(() => {
    const gradeSet = new Set<string>();
    const subjectSet = new Set<string>();
    const publisherSet = new Set<string>();
    textbooks.forEach((tb) => {
      if (tb.grade) gradeSet.add(tb.grade);
      if (tb.subject) subjectSet.add(tb.subject);
      if (tb.publisher) publisherSet.add(tb.publisher);
    });
    return {
      grades: Array.from(gradeSet).sort(),
      subjects: Array.from(subjectSet).sort(),
      publishers: Array.from(publisherSet).sort((a, b) => a.localeCompare(b, 'ja')),
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

    // Publisher filter
    if (selectedPublishers.size > 0) {
      result = result.filter((tb) => tb.publisher !== null && selectedPublishers.has(tb.publisher));
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
  }, [textbooks, schoolTypeFilter, selectedGrades, selectedSubjects, selectedPublishers, search]);

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

  const togglePublisher = (publisher: string) => {
    setSelectedPublishers((prev) => {
      const next = new Set(prev);
      if (next.has(publisher)) next.delete(publisher);
      else next.add(publisher);
      return next;
    });
    resetPage();
  };

  const clearFilters = () => {
    setSchoolTypeFilter('all');
    setSelectedGrades(new Set());
    setSelectedSubjects(new Set());
    setSelectedPublishers(new Set());
    setSearch('');
    resetPage();
  };

  const hasActiveFilters =
    schoolTypeFilter !== 'all' ||
    selectedGrades.size > 0 ||
    selectedSubjects.size > 0 ||
    selectedPublishers.size > 0 ||
    search.trim() !== '';

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
  const getStockInfo = useCallback(
    (tb: Textbook) => {
      const label = formatTextbookLabel(tb);
      const entry = stockMap.get(label) ?? stockMap.get(tb.name);
      return entry ?? null;
    },
    [stockMap]
  );

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
                <label
                  key={opt.value}
                  className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer"
                >
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
                  <label
                    key={grade}
                    className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer"
                  >
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
                  <label
                    key={subject}
                    className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer"
                  >
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

          {/* Publisher */}
          {publishers.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-700 mb-2">出版社</h4>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {publishers.map((publisher) => (
                  <label
                    key={publisher}
                    className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedPublishers.has(publisher)}
                      onChange={() => togglePublisher(publisher)}
                      className="w-3 h-3 rounded text-[#1e3a5f] focus:ring-[#1e3a5f]"
                    />
                    {publisher}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Clear Filters */}
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="w-full text-xs text-gray-500 hover:text-gray-700 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-[background-color,color] duration-150 ease-out"
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
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white placeholder-gray-400 focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f] transition-[background-color,color] duration-150 ease-out"
            />
          </div>
        </div>

        {/* Subject Legend */}
        <SubjectLegend />

        {/* Results count */}
        <div className="text-xs text-gray-500 mb-2">{filteredTextbooks.length}件の教材</div>

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
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center animate-[stagger-fade-in_240ms_var(--ease-out)_forwards]">
            <Package className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-gray-800 mb-1">
              {textbooks.length === 0
                ? 'テキストが登録されていません'
                : '条件に一致するテキストがありません'}
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
                  initialStudentId={initialStudentId}
                  canEdit={canEdit}
                  stockQuantity={stockInfo ? stockInfo.quantity : null}
                  onAddToCart={handleAddToCart}
                  existingOrderPairs={existingOrderPairs}
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
              className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-[background-color,color] duration-150 ease-out"
            >
              &laquo;
            </button>
            {pageNumbers.map((page) => (
              <button
                key={page}
                onClick={() => setCurrentPage(page)}
                className={`w-7 h-7 text-xs rounded transition-[background-color,color] duration-150 ease-out ${
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
              className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-[background-color,color] duration-150 ease-out"
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
              className="flex items-center gap-2 text-sm text-gray-700 hover:text-[#1e3a5f] transition-[background-color,color] duration-150 ease-out"
            >
              <div className="relative">
                <ShoppingCart className="w-5 h-5" />
                <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[11px] font-bold w-4.5 h-4.5 rounded-full flex items-center justify-center min-w-[18px] px-1">
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
                className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-[background-color,color] duration-150 ease-out"
              >
                全て取消
              </button>
              <button
                onClick={() => setIsCartOpen(true)}
                className="px-4 py-1.5 text-sm rounded-lg font-bold bg-[#1e3a5f] text-white hover:bg-[#2d4a6f] transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97]"
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
