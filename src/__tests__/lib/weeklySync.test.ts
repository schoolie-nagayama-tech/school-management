import { describe, it, expect } from 'vitest';
import { planWeeklySync, isFrozenEntry, type ExistingWeekEntry } from '@/lib/schedule/weeklySync';
import type { PlannedEntry } from '@/lib/schedule/specialCourseOverride';

const SCHOOL = 'school-1';

function planned(over: Partial<PlannedEntry> = {}): PlannedEntry {
  return {
    source: 'regular',
    date: '2026-10-06',
    timeSlotId: 'slot-1',
    studentId: 'stu-1',
    teacherId: 't1',
    subjectIds: ['sub-math'],
    seatLabel: null,
    formation: 'individual',
    kind: 'regular',
    ratio: 2,
    durationMinutes: null,
    halfPosition: null,
    regularPatternId: 'pat-1',
    specialCourseId: null,
    ...over,
  };
}

/** planned() と同じ中身の既存行（＝差分なし） */
function existing(over: Partial<ExistingWeekEntry> = {}): ExistingWeekEntry {
  return {
    id: 'e-1',
    entry_date: '2026-10-06',
    time_slot_id: 'slot-1',
    student_id: 'stu-1',
    teacher_id: 't1',
    kind: 'regular',
    status: 'scheduled',
    subject_ids: ['sub-math'],
    seat_label: null,
    regular_pattern_id: 'pat-1',
    formation: 'individual',
    ratio: 2,
    duration_minutes: null,
    half_position: null,
    ...over,
  };
}

const NO_REPORTS = new Set<string>();

describe('planWeeklySync', () => {
  it('同じ中身の行があれば何もしない（id を保つ＝報告書が消えない）', () => {
    const plan = planWeeklySync({
      schoolId: SCHOOL,
      planned: [planned()],
      existing: [existing()],
      reportedEntryIds: NO_REPORTS,
    });
    expect(plan.inserts).toEqual([]);
    expect(plan.updates).toEqual([]);
    expect(plan.deleteIds).toEqual([]);
    expect(plan.matchedCount).toBe(1);
  });

  it('あるべきコマが無ければ追加する', () => {
    const plan = planWeeklySync({
      schoolId: SCHOOL,
      planned: [planned()],
      existing: [],
      reportedEntryIds: NO_REPORTS,
    });
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]).toMatchObject({
      school_id: SCHOOL,
      entry_date: '2026-10-06',
      teacher_id: 't1',
      status: 'scheduled',
      regular_pattern_id: 'pat-1',
    });
  });

  it('通塾日程の科目や講師が変わったら、行を消さずに変わった列だけ更新する', () => {
    const plan = planWeeklySync({
      schoolId: SCHOOL,
      planned: [planned({ teacherId: 't2', subjectIds: ['sub-eng'] })],
      existing: [existing()],
      reportedEntryIds: NO_REPORTS,
    });
    expect(plan.inserts).toEqual([]);
    expect(plan.deleteIds).toEqual([]);
    expect(plan.updates).toEqual([
      { id: 'e-1', patch: { teacher_id: 't2', subject_ids: ['sub-eng'] } },
    ]);
  });

  it('通塾日程に講師が無ければ、行に手で割り当てた講師を残す', () => {
    const plan = planWeeklySync({
      schoolId: SCHOOL,
      planned: [planned({ teacherId: null })],
      existing: [existing({ teacher_id: 't-manual' })],
      reportedEntryIds: NO_REPORTS,
    });
    expect(plan.updates).toEqual([]);
  });

  it('もう要らない行は消す', () => {
    const plan = planWeeklySync({
      schoolId: SCHOOL,
      planned: [],
      existing: [existing()],
      reportedEntryIds: NO_REPORTS,
    });
    expect(plan.deleteIds).toEqual(['e-1']);
  });

  describe('凍結（報告書付き・出欠済み）', () => {
    it('報告書付きの行は、要らなくなっても消さない', () => {
      const plan = planWeeklySync({
        schoolId: SCHOOL,
        planned: [],
        existing: [existing()],
        reportedEntryIds: new Set(['e-1']),
      });
      expect(plan.deleteIds).toEqual([]);
      expect(plan.keptFrozenCount).toBe(1);
    });

    it('報告書付きの行は、通塾日程の講師が変わっても書き換えない', () => {
      const plan = planWeeklySync({
        schoolId: SCHOOL,
        planned: [planned({ teacherId: 't2' })],
        existing: [existing()],
        reportedEntryIds: new Set(['e-1']),
      });
      expect(plan.updates).toEqual([]);
      expect(plan.inserts).toEqual([]);
      expect(plan.matchedCount).toBe(1);
    });

    it('出欠済み（completed）の行は消さず、scheduled にも戻さない', () => {
      const plan = planWeeklySync({
        schoolId: SCHOOL,
        planned: [planned({ teacherId: 't2' })],
        existing: [
          existing({ status: 'completed' }),
          existing({ id: 'e-2', status: 'completed', time_slot_id: 'slot-9' }),
        ],
        reportedEntryIds: NO_REPORTS,
      });
      expect(plan.updates).toEqual([]);
      expect(plan.deleteIds).toEqual([]);
      expect(plan.inserts).toEqual([]);
      expect(plan.keptFrozenCount).toBe(1);
    });
  });

  describe('差し替えない行が押さえている枠（全削除方式のときと同じ）', () => {
    it.each([
      ['振替元', { status: 'transferred_out' }],
      ['振替先', { status: 'transferred_in' }],
      ['キャンセル', { status: 'cancelled' }],
      ['講習コマ', { kind: 'koushu' }],
      ['追加授業', { kind: 'additional' }],
    ])('%s がある枠には通常授業を作らず、その行も消さない', (_label, over) => {
      const plan = planWeeklySync({
        schoolId: SCHOOL,
        planned: [planned()],
        existing: [existing(over)],
        reportedEntryIds: NO_REPORTS,
      });
      expect(plan.inserts).toEqual([]);
      expect(plan.updates).toEqual([]);
      expect(plan.deleteIds).toEqual([]);
    });
  });

  it('同じ枠に講師違いの行が2つあれば、講師が一致する行どうしで対応づける', () => {
    const plan = planWeeklySync({
      schoolId: SCHOOL,
      planned: [planned({ teacherId: 't2' }), planned({ teacherId: 't1' })],
      existing: [
        existing({ id: 'e-t1', teacher_id: 't1' }),
        existing({ id: 'e-t2', teacher_id: 't2' }),
      ],
      reportedEntryIds: NO_REPORTS,
    });
    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toEqual([]);
    expect(plan.deleteIds).toEqual([]);
    expect(plan.matchedCount).toBe(2);
  });

  it('講習期上書き由来のコマは regular_pattern_id を持たない', () => {
    const plan = planWeeklySync({
      schoolId: SCHOOL,
      planned: [planned({ source: 'override', kind: 'koushu' })],
      existing: [],
      reportedEntryIds: NO_REPORTS,
    });
    expect(plan.inserts[0]).toMatchObject({ kind: 'koushu', regular_pattern_id: null });
  });
});

describe('isFrozenEntry', () => {
  it('出欠済みか報告書付きなら凍結', () => {
    expect(isFrozenEntry({ id: 'a', status: 'completed' }, NO_REPORTS)).toBe(true);
    expect(isFrozenEntry({ id: 'a', status: 'scheduled' }, new Set(['a']))).toBe(true);
    expect(isFrozenEntry({ id: 'a', status: 'scheduled' }, NO_REPORTS)).toBe(false);
  });
});
