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
import { ArrowLeft, BookOpen, LayoutTemplate, Loader2, Search } from 'lucide-react';
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

/** 絞り込みの条件。'all' は絞らない */
export interface TemplateFilter {
  season: SeasonType | 'all';
  grade: number | 'all';
  subject: string | 'all';
  keyword: string;
}

/** 科目ボタンの並び。よく使う順に固定し、それ以外は後ろに名前順で足す */
const SUBJECT_ORDER = ['英語', '数学', '算数', '国語', '理科', '社会'];

/**
 * テンプレの科目＝入っているテキストの科目。
 * ★過去問のように教材の科目が空のものは数えない（科目は単元側に持っているため）。
 *   過去問だけのテンプレは科目が空になり、どの科目で絞っても出す（テキスト選択と同じ扱い）。
 */
export function templateSubjects(c: SeasonalCourseListItem): string[] {
  const set = new Set<string>();
  for (const ct of c.textbooks) {
    const s = (ct.textbook?.subject ?? '').trim();
    if (s) set.add(s);
  }
  return Array.from(set);
}

/** 画面に出す科目ボタンの一覧（テンプレに実在する科目だけ） */
export function subjectOptions(list: SeasonalCourseListItem[]): string[] {
  const set = new Set<string>();
  for (const c of list) for (const s of templateSubjects(c)) set.add(s);
  return Array.from(set).sort((a, b) => {
    const ia = SUBJECT_ORDER.indexOf(a);
    const ib = SUBJECT_ORDER.indexOf(b);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return a.localeCompare(b, 'ja');
  });
}

/** 全角・半角や大文字小文字の違いで取りこぼさないようにそろえる */
function normalize(s: string): string {
  return s.normalize('NFKC').toLowerCase();
}

/**
 * 絞り込み。
 * - 学年: 対象学年が空のテンプレは「学年を問わない」扱いで残す（従来どおり）
 * - キーワード: 空白で区切った語をすべて含むもの。講習名とテキスト名のどちらに入っていてもよい
 */
export function filterTemplates(
  list: SeasonalCourseListItem[],
  f: TemplateFilter
): SeasonalCourseListItem[] {
  const words = normalize(f.keyword).split(/\s+/).filter(Boolean);
  return list.filter((c) => {
    if (f.season !== 'all' && c.season !== f.season) return false;
    if (f.grade !== 'all') {
      const grades = c.target_grades ?? [];
      if (grades.length > 0 && !grades.includes(f.grade)) return false;
    }
    if (f.subject !== 'all') {
      const subjects = templateSubjects(c);
      if (subjects.length > 0 && !subjects.includes(f.subject)) return false;
    }
    if (words.length > 0) {
      const hay = normalize(
        [c.name, ...c.textbooks.map((ct) => ct.textbook?.name ?? '')].join(' ')
      );
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

const SEASON_OPTIONS: SeasonType[] = ['winter', 'summer', 'spring'];

/** 絞り込みの1行（ラベル＋ボタン群）。選ぶものはすべてクリックで選べるようにする */
function FilterRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0 text-[11px] text-text-faint">{label}</span>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            aria-pressed={value === o.key}
            onClick={() => onChange(o.key)}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-[background-color,border-color,color] duration-150 ${
              value === o.key
                ? 'border-ink bg-ink font-bold text-text-on-primary'
                : 'border-border text-text-body hover:bg-surface-hover'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * テンプレートを選ぶ画面。
 *
 * ★既定は「準備中の季節 ＋ その生徒の学年」で絞る。教室のテンプレは1,265件あり、
 *   全部出すと選べない。季節・学年・科目・キーワードはいつでも切り替えられる
 *   （以前は0件になったときだけ「外す」が出て、件数があると絞りを変えられなかった）。
 * ★単元がゼロのテンプレ（空殻が33%ある）は呼び出し側で除いてある。選んでも何も入らない。
 */
export function TemplatePickerScreen({
  studentName,
  templates,
  loading,
  season,
  grade,
  applying,
  onSelect,
  onBack,
}: {
  studentName: string;
  /** 単元の入っているテンプレ全部。絞り込みはこの画面の中で行う */
  templates: SeasonalCourseListItem[];
  loading: boolean;
  /** 既定で選んでおく季節（準備中の季節） */
  season: SeasonType;
  /** 生徒の学年。分からなければ学年の絞り込みは出さない */
  grade: number | null;
  /** 選んだテンプレを取り込み中 */
  applying: boolean;
  onSelect: (courseId: string) => void;
  onBack: () => void;
}) {
  const [filter, setFilter] = useState<TemplateFilter>(() => ({
    season,
    grade: grade ?? 'all',
    subject: 'all',
    keyword: '',
  }));
  const [sortKey, setSortKey] = useState<TemplateSortKey>(readStoredSort);

  const subjects = useMemo(() => subjectOptions(templates), [templates]);
  const visible = useMemo(
    () => sortTemplates(filterTemplates(templates, filter), sortKey),
    [templates, filter, sortKey]
  );
  const isNarrowed =
    filter.season !== 'all' ||
    filter.grade !== 'all' ||
    filter.subject !== 'all' ||
    filter.keyword.trim() !== '';

  const patch = (p: Partial<TemplateFilter>) => setFilter((prev) => ({ ...prev, ...p }));

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
          {!loading && <span className="text-[11px] text-text-muted">{visible.length}件</span>}
        </div>

        {!loading && templates.length > 0 && (
          <div className="mt-3 flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface-raised p-3">
            <FilterRow
              label="季節"
              value={filter.season}
              onChange={(k) => patch({ season: k as TemplateFilter['season'] })}
              options={[
                ...SEASON_OPTIONS.map((s) => ({ key: s, label: SEASON_LABELS[s] })),
                { key: 'all', label: 'すべて' },
              ]}
            />
            {grade != null && (
              <FilterRow
                label="学年"
                value={String(filter.grade)}
                onChange={(k) => patch({ grade: k === 'all' ? 'all' : Number(k) })}
                options={[
                  {
                    key: String(grade),
                    label: `${GRADE_LABELS[grade] ?? `学年${grade}`}（この生徒）`,
                  },
                  { key: 'all', label: 'すべて' },
                ]}
              />
            )}
            {subjects.length > 1 && (
              <FilterRow
                label="科目"
                value={filter.subject}
                onChange={(k) => patch({ subject: k })}
                options={[
                  { key: 'all', label: 'すべて' },
                  ...subjects.map((s) => ({ key: s, label: s })),
                ]}
              />
            )}
            <div className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-[11px] text-text-faint">検索</span>
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={filter.keyword}
                  onChange={(e) => patch({ keyword: e.target.value })}
                  placeholder="講習名・テキスト名で探す"
                  aria-label="講習名・テキスト名で探す"
                  className="w-full rounded-lg border border-border bg-surface-raised py-1.5 pl-7 pr-2 text-xs text-text-body"
                />
              </div>
            </div>
            {templates.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="w-8 shrink-0 text-[11px] text-text-faint">並び</span>
                <div
                  role="group"
                  aria-label="並べ替え"
                  className="inline-flex rounded-lg border border-border p-0.5"
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
              </div>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          読み込んでいます
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-raised p-6 text-center">
          <p className="text-sm text-text-body">
            {templates.length === 0
              ? '単元の入ったテンプレートがありません'
              : 'この条件に合うテンプレートがありません'}
          </p>
          {templates.length > 0 && isNarrowed && (
            <button
              type="button"
              onClick={() =>
                setFilter({ season: 'all', grade: 'all', subject: 'all', keyword: '' })
              }
              className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-body transition-[background-color,transform] duration-150 ease-out hover:bg-surface-hover active:scale-[0.97]"
            >
              絞り込みをすべて外す
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((c) => {
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
