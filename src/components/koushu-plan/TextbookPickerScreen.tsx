'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, Search, Star } from 'lucide-react';
import {
  DEFAULT_SUBJECT_BADGE,
  SUBJECT_BADGE_COLORS,
} from '@/components/proposals/proposalEditor.shared';
import {
  filterAndSortTextbooks,
  textbookFilterOptions,
  type PickableTextbook,
} from './textbookPicker';

/**
 * テキスト（教材）選択画面。提案書エディタと講習テンプレートの編集画面で共有する。
 *
 * 絞り込み・並び替え・お気に入り境界の区切り線は、この部品の内部で完結させている。
 * 生徒に依存するもの（戻り先リンク・サブタイトル）は必ず props で受け取り、
 * 講習テンプレート側でも同じ見た目のまま使えるようにする。
 * トースト（ToastContainer）は画面ごとに置き場所が違うので、この部品には含めない。
 */
export function TextbookPickerScreen<T extends PickableTextbook>({
  textbooks,
  search,
  onSearchChange,
  schoolType,
  onSchoolTypeChange,
  subject,
  onSubjectChange,
  grade,
  onGradeChange,
  onClearFilters,
  favoriteIds,
  favoritePendingId,
  onToggleFavorite,
  onSelect,
  backHref,
  backLabel,
  title = 'テキストを選択',
  subtitle,
}: {
  textbooks: T[];
  search: string;
  onSearchChange: (value: string) => void;
  schoolType: string;
  onSchoolTypeChange: (value: string) => void;
  subject: string;
  onSubjectChange: (value: string) => void;
  grade: string;
  onGradeChange: (value: string) => void;
  /** 絞り込みの「クリア」。学校種別・教科・学年をまとめて空に戻す */
  onClearFilters: () => void;
  favoriteIds: Set<number>;
  /** お気に入り更新中のID（連打防止でボタンを無効化する） */
  favoritePendingId: number | null;
  onToggleFavorite: (textbookId: number) => void;
  onSelect: (textbook: T) => void;
  backHref: string;
  backLabel: string;
  title?: string;
  subtitle?: ReactNode;
}) {
  // 絞り込みと並び順（お気に入り→教科→学年→名前）は講習テンプレートの編集画面と共有する
  const { schoolTypes, subjects, grades } = textbookFilterOptions(
    textbooks,
    schoolType || undefined
  );

  const filtered = filterAndSortTextbooks(
    textbooks,
    {
      schoolType: schoolType || undefined,
      subject: subject || undefined,
      grade: grade || undefined,
      search: search || undefined,
    },
    favoriteIds
  );

  // お気に入りとそれ以外の境界 index（区切り線を入れるため）
  const favoriteEndIdx = filtered.findIndex((tb) => !favoriteIds.has(tb.id));

  return (
    <div>
      <div className="mb-6">
        <Link
          href={backHref}
          className="text-sm text-text-muted hover:text-text-heading inline-flex items-center gap-1 mb-2 transition-[color] duration-150 ease-out"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {backLabel}
        </Link>
        <h1 className="text-lg font-bold text-text-heading">{title}</h1>
        <p className="text-sm text-text-muted mt-0.5">{subtitle}</p>
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-9 pr-3 py-2 text-sm border border-border-default rounded-lg bg-surface-raised focus:ring-2 focus:ring-primary/20 focus:border-primary"
          placeholder="テキスト名・教科・出版社で検索"
          autoFocus
        />
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <select
          value={schoolType}
          onChange={(e) => onSchoolTypeChange(e.target.value)}
          className="px-2 py-1 border border-border-default rounded-lg text-xs bg-surface-raised text-text-body"
        >
          <option value="">学校種別</option>
          {schoolTypes.map((st) => (
            <option key={st} value={st}>
              {st}
            </option>
          ))}
        </select>
        <select
          value={subject}
          onChange={(e) => onSubjectChange(e.target.value)}
          className="px-2 py-1 border border-border-default rounded-lg text-xs bg-surface-raised text-text-body"
        >
          <option value="">教科</option>
          {subjects.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={grade}
          onChange={(e) => onGradeChange(e.target.value)}
          className="px-2 py-1 border border-border-default rounded-lg text-xs bg-surface-raised text-text-body"
        >
          <option value="">学年</option>
          {grades.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        {(schoolType || subject || grade) && (
          <button
            onClick={onClearFilters}
            className="text-xs text-text-muted hover:text-text-heading transition-[color] duration-150 ease-out"
          >
            クリア
          </button>
        )}
        <span className="text-xs text-text-faint ml-auto">{filtered.length}件</span>
      </div>

      <div className="space-y-1 max-h-[60vh] overflow-y-auto">
        {filtered.map((tb, idx) => {
          const isFav = favoriteIds.has(tb.id);
          // お気に入り群の最後と通常群の境目に区切り線を出す（お気に入りが1件以上ありかつ非お気に入りも存在する場合のみ）
          const showDivider = favoriteEndIdx > 0 && idx === favoriteEndIdx;
          return (
            <div key={tb.id}>
              {showDivider && (
                <div className="my-2 border-t border-border-subtle" aria-hidden="true" />
              )}
              <div className="relative">
                <button
                  onClick={() => onSelect(tb)}
                  className="w-full text-left pl-4 pr-12 py-3 bg-surface-raised rounded-lg border border-border-default hover:border-accent-ink/30 hover:bg-accent-ink-subtle active:scale-[0.99] transition-[background-color,border-color,transform] duration-150 ease-out"
                >
                  <div className="flex items-center gap-1.5">
                    {tb.subject &&
                      (() => {
                        const c = SUBJECT_BADGE_COLORS[tb.subject] ?? DEFAULT_SUBJECT_BADGE;
                        return (
                          <span
                            className={`inline-flex px-1.5 py-0.5 text-[10px] font-bold rounded shrink-0 ${c.bg} ${c.text}`}
                          >
                            {tb.subject}
                          </span>
                        );
                      })()}
                    <span className="text-sm font-medium text-text-heading">{tb.name}</span>
                  </div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {[tb.publisher, tb.grade].filter(Boolean).join(' / ')}
                  </div>
                </button>
                {/* お気に入りトグル。row 本体の onClick とは独立させたいので絶対配置の別ボタンにする */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite(tb.id);
                  }}
                  disabled={favoritePendingId === tb.id}
                  aria-label={isFav ? 'お気に入りを解除' : 'お気に入りに追加'}
                  title={isFav ? 'お気に入りを解除' : 'お気に入りに追加'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-surface-hover active:scale-90 transition-[background-color,transform] duration-150 disabled:opacity-50"
                >
                  <Star
                    className={`w-4 h-4 transition-colors duration-150 ${
                      isFav
                        ? 'fill-amber-400 text-amber-400'
                        : 'text-text-faint hover:text-amber-400'
                    }`}
                  />
                </button>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="py-8 text-center text-sm text-text-faint">
            該当するテキストがありません
          </div>
        )}
      </div>
    </div>
  );
}
