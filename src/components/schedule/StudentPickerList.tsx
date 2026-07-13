'use client';

/**
 * StudentPickerList（Phase P2）
 *
 * 提案書ページ（courses/proposals）の生徒ピッカー仕様を複製した共通生徒選択リスト。
 *   - 初回に active な全生徒を一括ロード（fetchAllPaged で 1000 行上限を回避）
 *   - クライアント側フィルタ（姓名＋ふりがな連結の部分一致・デバウンスなし）
 *   - 学年グルーピング＋sticky 見出し
 *   - 行クリックで onSelect
 *
 * インラインのリスト（モーダル内に埋め込む前提）。ドロップダウンではない。
 * 検索 API を都度叩く StudentSearchInput と違い、一覧性を優先する用途で使う。
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchAllPaged } from '@/lib/utils/supabasePaging';
import { GRADE_LABELS } from '@/types/database';

/** ピッカーが扱う軽量な生徒レコード（表示・検索・選択に必要な最小限）。 */
export interface StudentPickerItem {
  id: string;
  last_name: string;
  first_name: string;
  last_name_kana: string | null;
  first_name_kana: string | null;
  grade: number | null;
}

export interface StudentPickerListProps {
  /** 取得対象の学校ID（active のみ）。空なら何も出さない。 */
  schoolIds: string[];
  onSelect: (student: StudentPickerItem) => void;
  /** 選択中の生徒ID（ハイライト用）。 */
  selectedId?: string | null;
}

export function StudentPickerList({ schoolIds, onSelect, selectedId }: StudentPickerListProps) {
  const [students, setStudents] = useState<StudentPickerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // schoolIds は配列参照が毎回変わりうるので、内容を文字列化して依存に使う（無限ループ防止）。
  const schoolIdsKey = schoolIds.join(',');

  const loadStudents = useCallback(async () => {
    if (schoolIds.length === 0) {
      setStudents([]);
      return;
    }
    setLoading(true);
    try {
      // 提案書ピッカーと同じ全件ページング取得。ふりがな昇順＋id で安定ソート。
      const data = await fetchAllPaged<StudentPickerItem>((from, to) =>
        supabase
          .from('students')
          .select('id, last_name, first_name, last_name_kana, first_name_kana, grade')
          .in('school_id', schoolIds)
          .eq('status', 'active')
          .is('deleted_at', null)
          .order('last_name_kana', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
      );
      setStudents(data);
    } catch {
      setStudents([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolIdsKey]);

  useEffect(() => {
    loadStudents();
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [loadStudents]);

  // 氏名・ふりがな両方にヒットさせる（カナ入力にも対応）。
  const filtered = useMemo(() => {
    if (!query.trim()) return students;
    const q = query.trim();
    return students.filter((s) => {
      const haystack = `${s.last_name}${s.first_name}${s.last_name_kana ?? ''}${s.first_name_kana ?? ''}`;
      return haystack.includes(q);
    });
  }, [students, query]);

  // 学年で降順グルーピング（高3=12 が上、未設定は末尾）。
  const groupedByGrade = useMemo(() => {
    const groups = new Map<number | null, StudentPickerItem[]>();
    for (const s of filtered) {
      const key = s.grade ?? null;
      const list = groups.get(key) ?? [];
      list.push(s);
      groups.set(key, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === null) return 1;
      if (b === null) return -1;
      return b - a;
    });
  }, [filtered]);

  return (
    <div className="border border-[var(--stroke)] rounded-lg overflow-hidden">
      <div className="p-2 border-b border-border-subtle">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="氏名・ふりがなで検索..."
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-border-default rounded-lg bg-white text-text-body placeholder:text-text-faint focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
          />
        </div>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {loading ? (
          <div className="py-4 text-center text-xs text-text-faint">読み込み中...</div>
        ) : filtered.length === 0 ? (
          <div className="py-4 text-center text-xs text-text-faint">該当する生徒がいません</div>
        ) : (
          groupedByGrade.map(([grade, list]) => (
            <div key={grade ?? 'unknown'}>
              <div className="sticky top-0 px-3 py-1 bg-surface-hover/95 backdrop-blur text-[10px] font-bold text-text-muted border-b border-border-subtle flex items-center gap-1">
                <span>{grade != null ? (GRADE_LABELS[grade] ?? `${grade}年`) : '学年未設定'}</span>
                <span className="font-normal text-text-faint">{list.length}名</span>
              </div>
              {list.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSelect(s)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-hover transition-[background-color] duration-150 ease-out flex items-center gap-2 ${
                    selectedId === s.id ? 'bg-info-subtle text-info' : 'text-text-body'
                  }`}
                >
                  <span className="px-1.5 py-0.5 text-[11px] font-medium rounded bg-gray-100 text-gray-500 shrink-0">
                    {s.grade != null ? (GRADE_LABELS[s.grade] ?? `${s.grade}年`) : '—'}
                  </span>
                  <span className="truncate flex-1">
                    {s.last_name} {s.first_name}
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
