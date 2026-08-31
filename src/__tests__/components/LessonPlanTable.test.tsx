/**
 * コンポーネントテスト: LessonPlanTable（通塾日程の一覧＋期間バー）
 *
 * ★ なぜ要るか:
 *  - 「同じ曜日×コマの版は続けて縦に並べ、2行目以降に ↳ を付ける」は rowSpan と絡むので、
 *    純関数のテストだけでは崩れに気づけない（曜日・コマが1回しか出ないこと自体が仕様）。
 *  - 「終了した授業も表示」トグルをオンにしても直近1年より古い行は出さない、という運用上の決定は
 *    表示側で握りつぶすと静かに破れる。トグル操作込みで固定する。
 *  - ★この表は生徒詳細モーダル（幅が限られる）の中で開かれるが、実機での見え方はテストから
 *    確かめられない。「ヘッダーの月ラベルと本文のバーが同じグリッドを共有する」「列は4つ」など、
 *    崩れの根因になった構造だけを DOM で固定する。
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LessonPlanTable } from '@/components/students/LessonPlanTable';
import type { ScheduleRegularPattern, ScheduleTimeSlot } from '@/types/schedule';

const TODAY = '2026-08-28';

function timeSlot(slotNumber: number): ScheduleTimeSlot {
  return {
    id: `slot-${slotNumber}`,
    school_id: 'school-1',
    slot_number: slotNumber,
    start_time: '16:20:00',
    end_time: '17:50:00',
    is_active: true,
    display_order: slotNumber,
    formation: 'individual',
    created_at: '',
    updated_at: '',
  };
}

function pattern(overrides: Partial<ScheduleRegularPattern> & { id: string }) {
  return {
    school_id: 'school-1',
    student_id: 'student-1',
    day_of_week: 3,
    time_slot_id: 'slot-4',
    teacher_id: null,
    subject_ids: [],
    seat_label: null,
    period_type: 'regular',
    is_active: true,
    effective_from: '2026-04-01',
    effective_until: null,
    formation: 'individual',
    ratio: 2,
    duration_minutes: 90,
    half_position: null,
    created_at: '',
    updated_at: '',
    time_slot: timeSlot(4),
    ...overrides,
  } as ScheduleRegularPattern;
}

/** 授業名はテスト内で id から作る（科目マスタの解決は呼び出し側の責務なので固定でよい） */
const labels: Record<string, string> = {
  shakai: '社会',
  rika: '理科',
  old: '英語',
  ancient: '国語',
};

function renderTable(patterns: ScheduleRegularPattern[], canEdit = true) {
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  const onAdd = vi.fn();
  const view = render(
    <LessonPlanTable
      patterns={patterns}
      today={TODAY}
      canEdit={canEdit}
      lessonLabelOf={(p) => labels[p.id] ?? p.id}
      teacherLabelOf={() => '山田'}
      onEdit={onEdit}
      onDelete={onDelete}
      onAdd={onAdd}
    />
  );
  return { onEdit, onDelete, onAdd, container: view.container };
}

describe('LessonPlanTable', () => {
  it('同じ曜日×コマの版を続けて並べ、2行目以降に ↳ を付ける（曜日・コマは1回だけ）', () => {
    renderTable([
      // いま社会、10月から理科（同じ 水曜4限）
      pattern({ id: 'shakai', effective_from: '2026-04-01', effective_until: '2026-09-30' }),
      pattern({ id: 'rika', effective_from: '2026-10-01' }),
    ]);

    expect(screen.getByText('社会')).toBeDefined();
    expect(screen.getByText('理科')).toBeDefined();
    // 曜日「水」とコマ「4限 16:20」は鎖の先頭にだけ出る（rowSpan で縦に結合）
    expect(screen.getAllByText('水')).toHaveLength(1);
    expect(screen.getAllByText('4限 16:20')).toHaveLength(1);
    expect(screen.getAllByText('↳')).toHaveLength(1);
  });

  it('終了した授業は既定で出さず、トグルで直近1年ぶんだけ出す', async () => {
    const user = userEvent.setup();
    renderTable([
      pattern({ id: 'shakai' }),
      // 直近1年以内に終了
      pattern({
        id: 'old',
        day_of_week: 2,
        time_slot_id: 'slot-5',
        time_slot: timeSlot(5),
        effective_from: '2025-04-01',
        effective_until: '2026-03-31',
      }),
      // 1年より前に終了（トグルをオンにしても出さない）
      pattern({
        id: 'ancient',
        day_of_week: 1,
        time_slot_id: 'slot-3',
        time_slot: timeSlot(3),
        effective_from: '2024-04-01',
        effective_until: '2025-03-31',
      }),
    ]);

    expect(screen.queryByText('英語')).toBeNull();
    expect(screen.queryByText('国語')).toBeNull();

    await user.click(screen.getByLabelText('終了した授業も表示'));

    expect(screen.getByText('英語')).toBeDefined();
    expect(screen.queryByText('国語')).toBeNull();
  });

  it('年度は3月始まり。前の年度に送ると当年度だけの授業は消える', async () => {
    const user = userEvent.setup();
    renderTable([pattern({ id: 'shakai', effective_from: '2026-04-01' })]);

    expect(screen.getByText('2026年度')).toBeDefined();
    expect(screen.getByText('社会')).toBeDefined();

    await user.click(screen.getByLabelText('前の年度'));

    // 2025年度 = 2025-03-01 〜 2026-02-28。2026-04-01 開始の行はかからない
    expect(screen.getByText('2025年度')).toBeDefined();
    expect(screen.queryByText('社会')).toBeNull();
  });

  it('行の「変更」で編集を、ゴミ箱で削除を呼ぶ', async () => {
    const user = userEvent.setup();
    const { onEdit, onDelete } = renderTable([pattern({ id: 'shakai' })]);

    await user.click(screen.getByRole('button', { name: '変更' }));
    expect(onEdit).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'この授業を外す' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('編集できないロールには操作の入り口を出さない', () => {
    renderTable([pattern({ id: 'shakai' })], false);
    expect(screen.queryByRole('button', { name: '変更' })).toBeNull();
    expect(screen.queryByRole('button', { name: '授業を追加' })).toBeNull();
  });

  it('ヘッダーの月ラベルと本文のバーが同じグリッド（12列）を共有する', () => {
    // ★ ここが崩れると月とバーの位置が対応せず「いつから変わるか」が読めなくなる。
    //   以前はヘッダーだけ別の列定義を参照していて、月ラベルが縦一列に落ちていた。
    const { container } = renderTable([pattern({ id: 'shakai' })]);
    const grids = Array.from(container.querySelectorAll<HTMLElement>('[data-lp-grid="months"]'));
    // ヘッダーの月ラベル1つ ＋ 本文の行1つ
    expect(grids).toHaveLength(2);
    for (const grid of grids) {
      expect(grid.children).toHaveLength(12);
    }
    // 同じCSSクラス＝同じ grid-template-columns。別々に幅を決めさせない
    expect(grids[0].className.split(' ')).toContain(grids[1].className.split(' ')[0]);
  });

  it('月ラベルは3月始まりの12ヶ月を横並びで出す', () => {
    const { container } = renderTable([pattern({ id: 'shakai' })]);
    const head = container.querySelector<HTMLElement>('thead [data-lp-grid="months"]');
    expect(head).not.toBeNull();
    expect(Array.from(head!.children).map((el) => el.textContent)).toEqual([
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
      '12',
      '1',
      '2',
    ]);
  });

  it('モーダル幅でも成立するよう「曜日・コマ / 内容 / 期間 / 操作」の4列に畳む', () => {
    const { container } = renderTable([pattern({ id: 'shakai' })]);
    const headerCells = container.querySelectorAll('thead th');
    expect(headerCells).toHaveLength(4);
    expect(screen.getByText('曜日・コマ')).toBeDefined();
    expect(screen.getByText('内容')).toBeDefined();
    // 本文も4セル。コマ・比率・講師は独立した列を持たず、主要素の下に添える
    const bodyRow = container.querySelector('tbody tr')!;
    expect(bodyRow.querySelectorAll('td')).toHaveLength(4);
    expect(within(bodyRow as HTMLElement).getByText('1対2・山田')).toBeDefined();
  });
});
