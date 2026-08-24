'use client';

/**
 * 申込管理の生徒選択。
 *
 * ★ 講習提案書の新規作成ピッカー（app/courses/proposals/page.tsx）と同じ作りにする:
 *   - 打たなくても一覧が出ている（検索は絞り込みであって、入力の前提ではない）
 *   - 学年で見出しを付けてまとめ、見出しに「何名 / 未申込n名」を出す
 *   - 行に状態バッジ（申込済みのコマ数 / 未申込）を出し、誰が残っているか一目で分かる
 *   同じ「生徒を選ぶ」操作が画面ごとに違うと、室長は都度やり方を覚え直すことになる。
 *
 * 名前を打たせる検索ボックス単体（従来の StudentSearchInput）をやめた理由は、
 * 打つまで何も出ず、「誰がまだ登録されていないか」がこの画面から分からなかったため。
 */

import { useEffect, useMemo, useState } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchAllPaged } from '@/lib/utils/supabasePaging';
import { GRADE_LABELS } from '@/types/database';

export interface PickerStudent {
  id: string;
  last_name: string;
  first_name: string;
  last_name_kana: string | null;
  first_name_kana: string | null;
  grade: number | null;
}

interface KoushuStudentPickerProps {
  schoolId: string;
  /** 既に申込を登録済みの生徒ID → 合計コマ数。バッジ表示に使う（未登録なら未申込） */
  appliedKomaByStudent: Record<string, number>;
  onSelect: (student: PickerStudent) => void;
  /** 選択中の生徒（選び直しできるよう一覧は開いたままにする） */
  selectedId?: string | null;
}

export function KoushuStudentPicker({
  schoolId,
  appliedKomaByStudent,
  onSelect,
  selectedId,
}: KoushuStudentPickerProps) {
  const [students, setStudents] = useState<PickerStudent[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;
    setLoading(true);
    // 並び順はふりがな昇順。学年グループ表示の前提として安定させたいので id も添える。
    // 1000行上限に当たらないよう全件ページングで取る。
    fetchAllPaged<PickerStudent>((from, to) =>
      supabase
        .from('students')
        .select('id, last_name, first_name, last_name_kana, first_name_kana, grade')
        .eq('school_id', schoolId)
        .eq('status', 'active')
        .is('deleted_at', null)
        .order('last_name_kana', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
    )
      .then((rows) => {
        if (!cancelled) setStudents(rows);
      })
      .catch(() => {
        if (!cancelled) setStudents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return students;
    return students.filter((s) =>
      `${s.last_name}${s.first_name}${s.last_name_kana ?? ''}${s.first_name_kana ?? ''}`.includes(q)
    );
  }, [students, query]);

  /** 学年ごとにまとめる。学年の値が大きいほど上級なので降順、未設定は末尾。 */
  const groupedByGrade = useMemo(() => {
    const groups = new Map<number | null, PickerStudent[]>();
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
    <div className="rounded-md border border-[var(--stroke)] overflow-hidden">
      <div className="border-b border-[var(--stroke)] p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="氏名・ふりがなで絞り込み..."
            className="w-full rounded border border-[var(--stroke)] py-1.5 pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
          />
        </div>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-[var(--paragraph)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            読み込み中...
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-6 text-center text-xs text-[var(--paragraph)]">
            該当する生徒がいません
          </div>
        ) : (
          groupedByGrade.map(([grade, list]) => {
            // まだ申込を登録していない人数。残り作業の目安として見出しに出す。
            const pending = list.filter((s) => !appliedKomaByStudent[s.id]).length;
            return (
              <div key={grade ?? 'unknown'}>
                <div className="sticky top-0 flex items-center gap-1 border-b border-[var(--stroke)] bg-gray-50/95 px-3 py-1 text-[10px] font-bold text-[var(--paragraph)] backdrop-blur">
                  <span>
                    {grade != null ? (GRADE_LABELS[grade] ?? `${grade}年`) : '学年未設定'}
                  </span>
                  <span className="font-normal text-gray-400">{list.length}名</span>
                  {pending > 0 && (
                    <span className="ml-auto font-normal text-gray-400">未申込 {pending}名</span>
                  )}
                </div>
                {list.map((s) => {
                  const koma = appliedKomaByStudent[s.id];
                  const isSelected = selectedId === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onSelect(s)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                        isSelected
                          ? 'bg-blue-50 font-medium text-[var(--headline)]'
                          : 'text-[var(--headline)] hover:bg-gray-50'
                      }`}
                    >
                      <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">
                        {s.grade != null ? (GRADE_LABELS[s.grade] ?? `${s.grade}年`) : '—'}
                      </span>
                      <span className="flex-1 truncate">
                        {s.last_name} {s.first_name}
                      </span>
                      {koma ? (
                        <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                          {koma}コマ
                        </span>
                      ) : (
                        <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-400">
                          未申込
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
