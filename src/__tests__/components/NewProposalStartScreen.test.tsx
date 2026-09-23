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
  sortTemplates,
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

describe('TemplatePickerScreen', () => {
  const base = {
    studentName: '高橋 英佑',
    loading: false,
    season: 'winter' as const,
    grade: 8,
    applying: false,
    onSelect: vi.fn(),
    onClearFilters: vi.fn(),
    onBack: vi.fn(),
  };

  it('テンプレートの中身（テキスト・単元数）を出し、選んだIDを返す', async () => {
    const onSelect = vi.fn();
    render(<TemplatePickerScreen {...base} templates={[TEMPLATE]} filtered onSelect={onSelect} />);

    expect(screen.getByText('中2数学 図形の証明 総仕上げ')).toBeInTheDocument();
    expect(screen.getByText(/中2 数学 ステップバイステップ/)).toBeInTheDocument();
    expect(screen.getByText(/10単元/)).toBeInTheDocument();

    await userEvent.click(screen.getByText('中2数学 図形の証明 総仕上げ'));
    expect(onSelect).toHaveBeenCalledWith('course-1');
  });

  it('0件のときは絞りを外す道を出す', async () => {
    const onClearFilters = vi.fn();
    render(
      <TemplatePickerScreen {...base} templates={[]} filtered onClearFilters={onClearFilters} />
    );

    expect(screen.getByText('この条件に合うテンプレートがありません')).toBeInTheDocument();
    await userEvent.click(screen.getByText('季節・学年の絞り込みを外す'));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('絞りを外したあとの0件では「外す」を出さない（押せる先が無い）', () => {
    render(<TemplatePickerScreen {...base} templates={[]} filtered={false} />);
    expect(screen.queryByText('季節・学年の絞り込みを外す')).not.toBeInTheDocument();
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
    render(<TemplatePickerScreen {...base} templates={list} filtered />);
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

describe('sortTemplates', () => {
  it('使われている順の同点は新しい順で並べる', () => {
    const t = (id: string, created: string) =>
      ({ ...TEMPLATE, id, created_at: created, application_count: 0 }) as SeasonalCourseListItem;
    const out = sortTemplates([t('old', '2026-01-01'), t('new', '2026-09-01')], 'popular');
    expect(out.map((c) => c.id)).toEqual(['new', 'old']);
  });
});
