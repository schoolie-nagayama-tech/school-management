'use client';

/**
 * 新規作成の最初の画面。「テキストから作る」か「テンプレートから作る」かを選ばせる。
 *
 * ★テンプレを使う道はこれまで、テキストを選んだ後にエディタの中の「ひな形を取り込む」
 *   しか無かった。テンプレが既にあるのに単元を選び直している運用があり、
 *   入口の時点で選ばせる（テンプレの存在に気付ける位置に置く）。
 *
 * ★URLでテキストが決まっている導線（教材マスタから）はここを通さない。
 *   もう選ぶものが無いので、2択を出しても片方しか押せない。
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpen, LayoutTemplate, Loader2 } from 'lucide-react';
import { GRADE_LABELS, SEASON_LABELS, type SeasonType } from '@/types/database';
import type { SeasonalCourseListItem } from '@/types/database';

/** どうやって作るかの2択 */
export function CreateMethodScreen({
  studentName,
  backHref,
  onPickTextbook,
  onPickTemplate,
}: {
  studentName: string;
  backHref: string;
  onPickTextbook: () => void;
  onPickTemplate: () => void;
}) {
  return (
    <div className="pb-20">
      <div className="mb-6">
        <Link
          href={backHref}
          className="inline-flex items-center text-sm text-text-muted hover:text-text-heading transition-colors duration-150"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          提案書一覧に戻る
        </Link>
        <p className="mt-3 text-xs text-text-muted">{studentName} の講習提案書</p>
        <h1 className="text-lg font-bold text-text-heading">どうやって作りますか</h1>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={onPickTextbook}
          className="rounded-xl border border-border bg-surface-raised p-4 text-left transition-[background-color,border-color,transform] duration-150 ease-out hover:border-border-strong hover:bg-surface-hover active:scale-[0.99]"
        >
          <p className="flex items-center gap-2 text-sm font-bold text-text-heading">
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            テキストから作る
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-text-muted">
            テキストを選んで、単元とコマ数を自分で決めます
          </p>
        </button>

        <button
          type="button"
          onClick={onPickTemplate}
          className="rounded-xl border border-border bg-surface-raised p-4 text-left transition-[background-color,border-color,transform] duration-150 ease-out hover:border-border-strong hover:bg-surface-hover active:scale-[0.99]"
        >
          <p className="flex items-center gap-2 text-sm font-bold text-text-heading">
            <LayoutTemplate className="h-4 w-4" aria-hidden="true" />
            テンプレートから作る
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-text-muted">
            講習のひな形を選ぶと、テキストと単元・結合が入った状態から始まります
          </p>
        </button>
      </div>
    </div>
  );
}

/** テンプレ一覧の並べ替え */
export type TemplateSortKey = 'newest' | 'name' | 'popular';

const SORT_OPTIONS: { key: TemplateSortKey; label: string }[] = [
  { key: 'newest', label: '新しい順' },
  { key: 'name', label: '名前順' },
  { key: 'popular', label: '使われている順' },
];

// 講師は同じ並べ方で何度も作るので、選んだ並べ方を端末に覚えておく（個人の好みなのでDBには持たない）
const SORT_STORAGE_KEY = 'nest:proposal-template-sort';

function readStoredSort(): TemplateSortKey {
  try {
    const v = window.localStorage.getItem(SORT_STORAGE_KEY);
    if (v === 'newest' || v === 'name' || v === 'popular') return v;
  } catch (_e) {
    // プライベートウィンドウ等で読めなくても既定で動けばよい
  }
  return 'newest';
}

/**
 * 並べ替え。
 * ★名前順は numeric 比較にする。「第2回」「第10回」や「中1」「中2」が
 *   文字コード順だと 10 が 2 より前に来てしまう。
 * ★同点は新しい順で決める（使われている順で0人が大量に並ぶため、順番が揺れないように）。
 */
export function sortTemplates(
  list: SeasonalCourseListItem[],
  key: TemplateSortKey
): SeasonalCourseListItem[] {
  const byNewest = (a: SeasonalCourseListItem, b: SeasonalCourseListItem) =>
    b.created_at.localeCompare(a.created_at);
  const sorted = [...list];
  if (key === 'name') {
    sorted.sort(
      (a, b) =>
        a.name.localeCompare(b.name, 'ja', { numeric: true, sensitivity: 'base' }) || byNewest(a, b)
    );
  } else if (key === 'popular') {
    sorted.sort((a, b) => b.application_count - a.application_count || byNewest(a, b));
  } else {
    sorted.sort(byNewest);
  }
  return sorted;
}

/**
 * テンプレートを選ぶ画面。
 *
 * ★既定は「準備中の季節 ＋ その生徒の学年」で絞る。教室のテンプレは1,265件あり、
 *   全部出すと選べない。ただし0件になりやすいので、絞りを外す道を必ず出す。
 * ★単元がゼロのテンプレ（空殻が33%ある）は出さない。選んでも何も入らない。
 */
export function TemplatePickerScreen({
  studentName,
  templates,
  loading,
  season,
  grade,
  filtered,
  applying,
  onSelect,
  onClearFilters,
  onBack,
}: {
  studentName: string;
  templates: SeasonalCourseListItem[];
  loading: boolean;
  season: SeasonType;
  grade: number | null;
  /** 絞り込みが効いているか。外せる状態のときだけ「外す」を出す */
  filtered: boolean;
  /** 選んだテンプレを取り込み中 */
  applying: boolean;
  onSelect: (courseId: string) => void;
  onClearFilters: () => void;
  onBack: () => void;
}) {
  const [sortKey, setSortKey] = useState<TemplateSortKey>(readStoredSort);
  const sortedTemplates = useMemo(() => sortTemplates(templates, sortKey), [templates, sortKey]);

  const changeSort = (key: TemplateSortKey) => {
    setSortKey(key);
    try {
      window.localStorage.setItem(SORT_STORAGE_KEY, key);
    } catch (_e) {
      // 覚えられなくても並べ替え自体はできる
    }
  };

  return (
    <div className="pb-20">
      <div className="mb-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center text-sm text-text-muted hover:text-text-heading transition-colors duration-150"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          作り方の選択に戻る
        </button>
        <p className="mt-3 text-xs text-text-muted">{studentName} の講習提案書</p>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-bold text-text-heading">テンプレートを選ぶ</h1>
          {filtered && (
            <>
              <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-text-body">
                {SEASON_LABELS[season]}
              </span>
              {grade != null && (
                <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-text-body">
                  {GRADE_LABELS[grade] ?? `学年${grade}`}
                </span>
              )}
            </>
          )}
          {!loading && <span className="text-[11px] text-text-muted">{templates.length}件</span>}
        </div>
        {!loading && templates.length > 1 && (
          <div
            role="group"
            aria-label="並べ替え"
            className="mt-3 inline-flex rounded-lg border border-border bg-surface-raised p-0.5"
          >
            {SORT_OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                aria-pressed={sortKey === o.key}
                onClick={() => changeSort(o.key)}
                className={`rounded-md px-3 py-1 text-xs transition-[background-color,color] duration-150 ${
                  sortKey === o.key
                    ? 'bg-surface-hover font-bold text-text-heading'
                    : 'text-text-muted hover:text-text-heading'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          読み込んでいます
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-raised p-6 text-center">
          <p className="text-sm text-text-body">この条件に合うテンプレートがありません</p>
          {filtered && (
            <button
              type="button"
              onClick={onClearFilters}
              className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-body transition-[background-color,transform] duration-150 ease-out hover:bg-surface-hover active:scale-[0.97]"
            >
              季節・学年の絞り込みを外す
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {sortedTemplates.map((c) => {
            const bookNames = c.textbooks
              .map((ct) => ct.textbook?.name ?? '')
              .filter(Boolean)
              .join(' / ');
            const grades = (c.target_grades ?? [])
              .map((g) => GRADE_LABELS[g] ?? `学年${g}`)
              .join('・');
            return (
              <button
                key={c.id}
                type="button"
                disabled={applying}
                onClick={() => onSelect(c.id)}
                className="rounded-lg border border-border bg-surface-raised p-3 text-left transition-[background-color,border-color,transform] duration-150 ease-out hover:border-border-strong hover:bg-surface-hover active:scale-[0.99] disabled:opacity-50"
              >
                <p className="text-sm font-bold text-text-heading">{c.name}</p>
                <p className="mt-1 text-[11px] text-text-muted">
                  {[
                    SEASON_LABELS[c.season as SeasonType],
                    grades,
                    `テキスト${c.textbooks.length}冊${bookNames ? `（${bookNames}）` : ''}`,
                    `${c.curriculum_count}単元`,
                    // 「使われている順」の根拠が見えないと並びを信用できないので数も出す
                    c.application_count > 0 ? `${c.application_count}人に適用` : '',
                  ]
                    .filter(Boolean)
                    .join(' ・ ')}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
