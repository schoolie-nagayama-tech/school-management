'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search } from 'lucide-react';
import { getInquiries } from '@/lib/api/inquiries';
import type { Inquiry, InquiryStatus } from '@/types/database';
import { getInquiryDisplayName } from '@/app/admin/inquiries/inquiryConstants';

export interface InquirySearchInputProps {
  schoolId: string;
  onSelect: (inquiry: Inquiry) => void;
  placeholder?: string;
  disabled?: boolean;
}

const SEARCH_DEBOUNCE_MS = 300;
const LIMIT = 20;

/**
 * 体験対象になりやすいステータスを上位に、失注・入会済みは下位（除外扱い）にするための優先度。
 * 体験の見込み客は主に in_progress / trial_waiting。lost/trial_lost/enrolled は候補から外す。
 */
const STATUS_PRIORITY: Record<InquiryStatus, number> = {
  trial_waiting: 0,
  in_progress: 1,
  trial_done: 2,
  unreachable: 3,
  // 以下は体験の追加登録には通常出さない（除外する）
  enrolled: 90,
  lost: 91,
  trial_lost: 92,
};

/** 体験の追加登録で候補から外すステータス（入会済み＝生徒化済み / 失注）。 */
const EXCLUDED_STATUSES = new Set<InquiryStatus>(['enrolled', 'lost', 'trial_lost']);

/**
 * 問合せ名簿から見込み客を検索するコンボボックス（Phase T）。
 * StudentSearchInput と同じ UI 構造。氏名・かな・電話・メールで部分一致検索する。
 * 表示は「氏名（保護者名・学年）」。入会済み・失注は候補から除外し、体験候補を上位に並べる。
 */
export function InquirySearchInput({
  schoolId,
  onSelect,
  placeholder = '問合せを検索...',
  disabled = false,
}: InquirySearchInputProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const runSearch = useCallback(
    async (q: string) => {
      if (!schoolId) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const list = await getInquiries(schoolId, { search: q });
        const filtered = list
          .filter((i) => !EXCLUDED_STATUSES.has(i.status))
          .sort((a, b) => (STATUS_PRIORITY[a.status] ?? 50) - (STATUS_PRIORITY[b.status] ?? 50))
          .slice(0, LIMIT);
        setResults(filtered);
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

  const handleSelect = (inquiry: Inquiry) => {
    onSelect(inquiry);
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
          aria-label="問合せを検索"
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
                {query.trim() ? '該当する問合せがいません' : '氏名・かな・電話で検索'}
              </div>
            ) : (
              <ul className="py-1">
                {results.map((i) => {
                  const { name } = getInquiryDisplayName(i);
                  // 保護者名・学年を補助情報として添える（識別しやすさのため）。
                  const meta = [i.guardian_name, i.grade].filter(Boolean).join('・');
                  return (
                    <li key={i.id}>
                      <button
                        type="button"
                        onClick={() => handleSelect(i)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--surface)] flex justify-between items-center gap-2"
                      >
                        <span className="font-medium truncate">
                          {name}
                          {meta && (
                            <span className="text-[var(--paragraph)] font-normal ml-1">
                              （{meta}）
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
