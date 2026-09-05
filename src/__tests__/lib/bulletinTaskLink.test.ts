/**
 * 種別 → 「どこを開けば作業できるか」のテスト。
 *
 * ★ここで守りたいのは3点:
 *  - 生徒が決まっている作業を、生徒のページまで開くこと
 *    （「生徒管理を開いてください」で止めると、生徒を探す→タブを選ぶ、で授業が終わる）
 *  - 行き先が分からないときにボタンを出さないこと（押しても何も始まらないボタンを置かない）
 *  - 13種すべてに行き先があること（種別を足したときに、行き先の追加を忘れたら落ちる）
 */
import { describe, expect, it } from 'vitest';
import { taskActionText, taskLink } from '@/lib/bulletin/taskLink';
import { TASK_KINDS, type TaskKind } from '@/lib/bulletin/taskCatalog';

const SID = '11111111-1111-4111-8111-111111111111';
const EID = '22222222-2222-4222-8222-222222222222';

describe('taskLink', () => {
  it('生徒が決まっている作業は、その生徒のページまで開く', () => {
    expect(taskLink('report_card_entry', { studentId: SID })?.href).toBe(`/students/${SID}/scores`);
    expect(taskLink('test_result_entry', { studentId: SID })?.href).toBe(`/students/${SID}/scores`);
    expect(taskLink('goal_setting', { studentId: SID })?.href).toBe(`/students/${SID}/progress`);
    expect(taskLink('progress_entry', { studentId: SID })?.href).toBe(`/students/${SID}/progress`);
    expect(taskLink('owned_material_check', { studentId: SID })?.href).toBe(
      `/students/${SID}/progress`
    );
  });

  it('生徒が分からないときはボタンを出さない（生徒管理の入口へ放り出さない）', () => {
    for (const kind of [
      'report_card_entry',
      'test_result_entry',
      'goal_setting',
      'progress_entry',
      'owned_material_check',
    ] as TaskKind[]) {
      expect(taskLink(kind, {})).toBeNull();
      expect(taskLink(kind, { studentId: null })).toBeNull();
    }
  });

  it('報告書は、いま開いているコマがあればそのコマへ行く', () => {
    expect(taskLink('report_deadline', { scheduleEntryId: EID })?.href).toBe(
      `/lesson-reports/${EID}`
    );
    expect(taskLink('report_title_format', { scheduleEntryId: EID })?.href).toBe(
      `/lesson-reports/${EID}`
    );
  });

  it('コマが分からない報告書は、未提出の一覧へ落とす（行き先が消えない）', () => {
    expect(taskLink('report_deadline', {})?.href).toBe('/lesson-reports/pending');
  });

  it('講師自身の作業は、生徒が分からなくても行き先がある', () => {
    expect(taskLink('shift_submit', {})?.href).toBe('/my-schedule');
    expect(taskLink('shift_check', {})?.href).toBe('/my-schedule');
    expect(taskLink('timesheet_entry', {})?.href).toBe('/my-schedule');
  });

  it('13種すべてに行き先がある（生徒とコマが分かっていれば穴が無い）', () => {
    for (const kind of TASK_KINDS) {
      const link = taskLink(kind, { studentId: SID, scheduleEntryId: EID });
      expect(link, `${kind} の行き先が無い`).not.toBeNull();
      expect(link?.href.startsWith('/'), `${kind} の行き先が相対パスでない`).toBe(true);
      expect(link?.label.length, `${kind} のボタン文言が空`).toBeGreaterThan(0);
    }
  });
});

describe('taskActionText', () => {
  it('生徒が決まっていれば、名前を付けて「やること」を書く', () => {
    expect(taskActionText('report_card_entry', '佐々木 花')).toBe(
      '佐々木 花さんの1学期の内申を入力'
    );
  });

  it('生徒が分からないときも文として成立する（名前を推測して補わない）', () => {
    expect(taskActionText('report_card_entry')).toBe('1学期の内申を入力');
    expect(taskActionText('report_card_entry', null)).toBe('1学期の内申を入力');
  });

  it('講師自身の作業には生徒名を付けない', () => {
    expect(taskActionText('shift_submit', '佐々木 花')).toBe('シフトを提出');
    expect(taskActionText('timesheet_entry', '佐々木 花')).toBe('出勤簿を入力');
  });

  it('13種すべてに文言がある', () => {
    for (const kind of TASK_KINDS) {
      expect(taskActionText(kind).length, `${kind} の文言が空`).toBeGreaterThan(0);
    }
  });
});
