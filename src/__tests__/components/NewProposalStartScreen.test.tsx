/**
 * コンポーネントテスト: 提案書の新規作成の入口（作り方の2択 / テンプレート選択）
 *
 * ★テンプレから作る道は、これまでテキストを選んだ後にしか無かった。
 *   入口で選ばせるようにしたので、2択が出ること・テンプレの一覧が選べることを固定する。
 *
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CreateMethodScreen,
  TemplatePickerScreen,
  filterTemplates,
  sortTemplates,
  subjectOptions,
} from '@/components/proposals/NewProposalStartScreen';
import type { SeasonalCourseListItem } from '@/types/database';

const TEMPLATE = {
  id: 'course-1',
  school_id: 'school-1',
  name: '中2数学 図形の証明 総仕上げ',
  season: 'winter',
  target_grades: [8],
  total_koma: 14,
  comment: null,
  is_active: true,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  textbooks: [
    {
      id: 'ct-1',
      course_id: 'course-1',
      textbook_id: 1,
      sort_order: 0,
      created_at: '2026-09-01T00:00:00Z',
      textbook: { id: 1, name: '中2 数学 ステップバイステップ' },
    },
  ],
  curriculum_count: 10,
  application_count: 0,
} as unknown as SeasonalCourseListItem;

describe('CreateMethodScreen', () => {
  it('2つの作り方を出し、押したほうを返す', async () => {
    const onPickTextbook = vi.fn();
    const onPickTemplate = vi.fn();
    render(
      <CreateMethodScreen
        studentName="高橋 英佑"
        backHref="/students/s1/proposals"
        onPickTextbook={onPickTextbook}
        onPickTemplate={onPickTemplate}
      />
    );

    expect(screen.getByText('どうやって作りますか')).toBeInTheDocument();
    expect(screen.getByText('高橋 英佑 の講習提案書')).toBeInTheDocument();

    await userEvent.click(screen.getByText('テンプレートから作る'));
    expect(onPickTemplate).toHaveBeenCalledTimes(1);
    expect(onPickTextbook).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText('テキストから作る'));
    expect(onPickTextbook).toHaveBeenCalledTimes(1);
  });
});

/** 絞り込みのテスト用に、季節・学年・科目・書名を差し替えたテンプレを作る */
function tpl(
  id: string,
  opts: {
    name?: string;
    season?: string;
    grades?: number[];
    books?: { name: string; subject: string | null }[];
  } = {}
): SeasonalCourseListItem {
  return {
    ...TEMPLATE,
    id,
    name: opts.name ?? `テンプレ${id}`,
    season: opts.season ?? 'winter',
    target_grades: opts.grades ?? [8],
    textbooks: (opts.books ?? [{ name: '中2 数学', subject: '数学' }]).map((b, i) => ({
      id: `${id}-${i}`,
      course_id: id,
      textbook_id: i,
      sort_order: i,
      created_at: '2026-09-01T00:00:00Z',
      textbook: { id: i, name: b.name, subject: b.subject },
    })),
  } as unknown as SeasonalCourseListItem;
}

describe('TemplatePickerScreen', () => {
  const base = {
    studentName: '高橋 英佑',
    loading: false,
    season: 'winter' as const,
    grade: 8,
    applying: false,
    onSelect: vi.fn(),
    onBack: vi.fn(),
  };

  it('テンプレートの中身（テキスト・単元数）を出し、選んだIDを返す', async () => {
    const onSelect = vi.fn();
    render(<TemplatePickerScreen {...base} templates={[TEMPLATE]} onSelect={onSelect} />);

    expect(screen.getByText('中2数学 図形の証明 総仕上げ')).toBeInTheDocument();
    expect(screen.getByText(/中2 数学 ステップバイステップ/)).toBeInTheDocument();
    expect(screen.getByText(/10単元/)).toBeInTheDocument();

    await userEvent.click(screen.getByText('中2数学 図形の証明 総仕上げ'));
    expect(onSelect).toHaveBeenCalledWith('course-1');
  });

  it('既定は準備中の季節＋生徒の学年。季節は件数があってもいつでも切り替えられる', async () => {
    const list = [
      tpl('w', { name: '冬の講習', season: 'winter' }),
      tpl('s', { name: '夏の講習', season: 'summer' }),
    ];
    render(<TemplatePickerScreen {...base} templates={list} />);
    expect(screen.getByText('冬の講習')).toBeInTheDocument();
    expect(screen.queryByText('夏の講習')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '夏期' }));
    expect(screen.getByText('夏の講習')).toBeInTheDocument();
    expect(screen.queryByText('冬の講習')).not.toBeInTheDocument();
  });

  it('0件のときは絞り込みをすべて外す道を出す', async () => {
    const list = [tpl('s', { name: '夏の講習', season: 'summer' })];
    render(<TemplatePickerScreen {...base} templates={list} />);

    expect(screen.getByText('この条件に合うテンプレートがありません')).toBeInTheDocument();
    await userEvent.click(screen.getByText('絞り込みをすべて外す'));
    expect(screen.getByText('夏の講習')).toBeInTheDocument();
  });

  it('テンプレが1件も無いときは「外す」を出さない（外しても出てこない）', () => {
    render(<TemplatePickerScreen {...base} templates={[]} />);
    expect(screen.getByText('単元の入ったテンプレートがありません')).toBeInTheDocument();
    expect(screen.queryByText('絞り込みをすべて外す')).not.toBeInTheDocument();
  });

  it('キーワードは講習名とテキスト名のどちらでも当たる', async () => {
    const list = [
      tpl('a', { name: '図形の証明', books: [{ name: '必勝シリーズ', subject: '数学' }] }),
      tpl('b', { name: '英文法', books: [{ name: 'サミングアップ', subject: '英語' }] }),
    ];
    render(<TemplatePickerScreen {...base} templates={list} />);

    await userEvent.type(screen.getByLabelText('講習名・テキスト名で探す'), '必勝');
    expect(screen.getByText('図形の証明')).toBeInTheDocument();
    expect(screen.queryByText('英文法')).not.toBeInTheDocument();
  });

  it('並べ替えボタンで一覧の順番が変わる', async () => {
    window.localStorage.clear();
    const make = (id: string, name: string, created: string, applied: number) =>
      ({
        ...TEMPLATE,
        id,
        name,
        created_at: created,
        application_count: applied,
      }) as SeasonalCourseListItem;
    const list = [
      make('a', '第2回 数学', '2026-09-01T00:00:00Z', 0),
      make('b', '第10回 数学', '2026-09-03T00:00:00Z', 5),
      make('c', '第1回 数学', '2026-09-02T00:00:00Z', 12),
    ];
    render(<TemplatePickerScreen {...base} templates={list} />);
    const names = () => screen.getAllByText(/^第\d+回 数学$/).map((el) => el.textContent);

    // 既定は新しい順
    expect(names()).toEqual(['第10回 数学', '第1回 数学', '第2回 数学']);

    // 名前順は数字を数として比べる（10 が 2 より前に来ない）
    await userEvent.click(screen.getByText('名前順'));
    expect(names()).toEqual(['第1回 数学', '第2回 数学', '第10回 数学']);

    await userEvent.click(screen.getByText('使われている順'));
    expect(names()).toEqual(['第1回 数学', '第10回 数学', '第2回 数学']);
    expect(screen.getByText(/12人に適用/)).toBeInTheDocument();
  });
});

describe('filterTemplates', () => {
  const all = { season: 'all', grade: 'all', subject: 'all', keyword: '' } as const;

  it('対象学年が空のテンプレは学年で絞っても残す（学年を問わない扱い）', () => {
    const out = filterTemplates(
      [tpl('any', { grades: [] }), tpl('g9', { grades: [9] }), tpl('g8', { grades: [8] })],
      { ...all, grade: 8 }
    );
    expect(out.map((c) => c.id)).toEqual(['any', 'g8']);
  });

  it('科目はテキストの科目で絞る。過去問だけ（科目が空）のテンプレはどの科目でも残す', () => {
    const out = filterTemplates(
      [
        tpl('math', { books: [{ name: '数学A', subject: '数学' }] }),
        tpl('eng', { books: [{ name: '英語A', subject: '英語' }] }),
        tpl('kakomon', { books: [{ name: '都立入試過去問', subject: null }] }),
        tpl('mix', {
          books: [
            { name: '数学A', subject: '数学' },
            { name: '都立入試過去問', subject: null },
          ],
        }),
      ],
      { ...all, subject: '英語' }
    );
    expect(out.map((c) => c.id)).toEqual(['eng', 'kakomon']);
  });

  it('キーワードは空白区切りの全語を含むもの。全角半角・大文字小文字をそろえて比べる', () => {
    const list = [
      tpl('a', { name: '中3 ＥＮＧＬＩＳＨ 総復習' }),
      tpl('b', { name: '中3 数学 総復習' }),
    ];
    expect(filterTemplates(list, { ...all, keyword: 'english　総復習' }).map((c) => c.id)).toEqual([
      'a',
    ]);
  });
});

describe('subjectOptions', () => {
  it('テンプレに実在する科目だけを、英数国理社の順で出す', () => {
    const out = subjectOptions([
      tpl('a', { books: [{ name: '社会A', subject: '社会' }] }),
      tpl('b', { books: [{ name: '英語A', subject: '英語' }] }),
      tpl('c', { books: [{ name: '過去問', subject: null }] }),
    ]);
    expect(out).toEqual(['英語', '社会']);
  });
});

describe('sortTemplates', () => {
  it('使われている順の同点は新しい順で並べる', () => {
    const t = (id: string, created: string) =>
      ({ ...TEMPLATE, id, created_at: created, application_count: 0 }) as SeasonalCourseListItem;
    const out = sortTemplates([t('old', '2026-01-01'), t('new', '2026-09-01')], 'popular');
    expect(out.map((c) => c.id)).toEqual(['new', 'old']);
  });
});
