import { describe, it, expect } from 'vitest';
import {
  buildPortalPreview,
  toPortalSubjectSpecific,
  type PortalPreviewInput,
} from '@/lib/lesson-reports/portalPreview';
import type { ClassReportFormData } from '@/types/class-report';

/** 何も書いていないフォーム（ここから必要な項目だけ足して境界を確かめる）。 */
const emptyForm = (patch: Partial<ClassReportFormData> = {}): ClassReportFormData => ({
  schedule_entry_id: 'entry-1',
  student_id: 'student-1',
  teacher_id: 'teacher-1',
  lesson_date: '2026-08-21',
  short_term_goal: '',
  mid_term_goal_snapshot: '',
  mid_action_goal_snapshot: '',
  school_progress: '',
  tardy: false,
  homework_not_done: false,
  homework_completion_pct: null,
  homework_correct_pct: null,
  today_correct_pct: null,
  vocab_test_score: null,
  vocab_test_total: null,
  vocab_test_passed: null,
  check_test_score: null,
  check_test_total: null,
  check_test_passed: null,
  review_comment: '',
  homework_assignments: [],
  subject_specific: null,
  status: 'draft',
  units: [],
  ...patch,
});

const build = (patch: Partial<PortalPreviewInput> = {}) =>
  buildPortalPreview({
    form: emptyForm(),
    units: [],
    schoolProgress: '',
    teacherName: null,
    checkTestPassed: null,
    ...patch,
  });

describe('buildPortalPreview（保護者プレビューの組み立て）', () => {
  it('プレビューは既読を作らない（isRead は常に true・IDは実在しない目印）', () => {
    const preview = build();
    expect(preview.isRead).toBe(true);
    expect(preview.id).toBe('preview');
  });

  it('空文字の項目は null にする（保護者面はセクションごと出さないため）', () => {
    const preview = build();
    expect(preview.shortTermGoal).toBeNull();
    expect(preview.midTermGoal).toBeNull();
    expect(preview.schoolProgress).toBeNull();
    expect(preview.reviewComment).toBeNull();
    expect(preview.subjectSpecific).toBeNull();
  });

  it('空白だけの入力も空として扱う', () => {
    const preview = build({
      form: emptyForm({ short_term_goal: '   ', review_comment: '\n\t' }),
      schoolProgress: '  ',
    });
    expect(preview.shortTermGoal).toBeNull();
    expect(preview.reviewComment).toBeNull();
    expect(preview.schoolProgress).toBeNull();
  });

  it('本日の様子マークはフォームの値をそのまま写す', () => {
    const preview = build({ form: emptyForm({ tardy: true, homework_not_done: true }) });
    expect(preview.tardy).toBe(true);
    expect(preview.homeworkNotDone).toBe(true);
  });

  it('確認テストの合否は自動判定の値を使う（フォームの古い値ではない）', () => {
    const preview = build({
      form: emptyForm({ check_test_score: 15, check_test_total: 20, check_test_passed: false }),
      checkTestPassed: true,
    });
    expect(preview.checkTestPassed).toBe(true);
  });

  it('学習内容はメイン教材が先頭・同順位は display_order 順', () => {
    const preview = build({
      units: [
        {
          isMain: false,
          textbookName: 'サブ教材B',
          unitTitles: [],
          pageStart: null,
          pageEnd: null,
          displayOrder: 2,
        },
        {
          isMain: false,
          textbookName: 'サブ教材A',
          unitTitles: [],
          pageStart: null,
          pageEnd: null,
          displayOrder: 1,
        },
        {
          isMain: true,
          textbookName: 'メイン教材',
          unitTitles: ['一次関数の式'],
          pageStart: 54,
          pageEnd: 58,
          displayOrder: 0,
        },
      ],
    });
    expect(preview.units.map((u) => u.textbookName)).toEqual([
      'メイン教材',
      'サブ教材A',
      'サブ教材B',
    ]);
    expect(preview.units[0].unitTitles).toEqual(['一次関数の式']);
    expect(preview.units[0].pageStart).toBe(54);
  });

  it('学習内容の id は重複しない（保護者面の key に使われる）', () => {
    const preview = build({
      units: [
        {
          isMain: true,
          textbookName: 'A',
          unitTitles: [],
          pageStart: null,
          pageEnd: null,
          displayOrder: 0,
        },
        {
          isMain: false,
          textbookName: 'B',
          unitTitles: [],
          pageStart: null,
          pageEnd: null,
          displayOrder: 0,
        },
      ],
    });
    expect(new Set(preview.units.map((u) => u.id)).size).toBe(2);
  });

  it('次回までの宿題は、保存されるのと同じ行（空欄の日は出さない）', () => {
    const preview = build({
      form: emptyForm({
        homework_assignments: [
          { date: '2026-08-22', text: '新中問 p.59' },
          { date: '2026-08-23', text: '   ' },
          { date: '2026-08-24', text: '' },
        ],
      }),
    });
    expect(preview.homeworkAssignments).toEqual([{ date: '2026-08-22', text: '新中問 p.59' }]);
  });
});

describe('toPortalSubjectSpecific（科目別欄の空判定）', () => {
  it('kind=none は extra_materials があるときだけ残す', () => {
    expect(toPortalSubjectSpecific({ kind: 'none' })).toBeNull();
    expect(toPortalSubjectSpecific({ kind: 'none', extra_materials: '  ' })).toBeNull();
    expect(toPortalSubjectSpecific({ kind: 'none', extra_materials: '計算プリント10問' })).toEqual({
      kind: 'none',
      range: null,
      pages: null,
      timesPerDay: null,
      duration: null,
      extraMaterials: '計算プリント10問',
    });
  });

  it('kind が付いていても中身が全部空なら出さない', () => {
    expect(
      toPortalSubjectSpecific({
        kind: 'vocab',
        range: '',
        pages: '',
        times_per_day: null as unknown as number,
        duration: '',
      })
    ).toBeNull();
  });

  it('中身があれば保護者面の形に直す', () => {
    expect(
      toPortalSubjectSpecific({
        kind: 'vocab',
        range: 'Unit 6 単語',
        pages: '46-49',
        times_per_day: 5,
        duration: '1週間',
      })
    ).toEqual({
      kind: 'vocab',
      range: 'Unit 6 単語',
      pages: '46-49',
      timesPerDay: 5,
      duration: '1週間',
      extraMaterials: null,
    });
  });

  it('null はそのまま null', () => {
    expect(toPortalSubjectSpecific(null)).toBeNull();
  });
});
