import { describe, it, expect } from 'vitest';
import { groupStudentKoushu } from '@/lib/studentKoushuSummary';
import type { SeasonalProposalWithDetails, SeasonalProposalUnit } from '@/types/database';
import type { KoushuEnrollment } from '@/lib/api/seasonalCourses';

function unit(partial: Partial<SeasonalProposalUnit>): SeasonalProposalUnit {
  return {
    id: Math.random().toString(36).slice(2),
    proposal_id: 'p',
    curriculum_item_id: 1,
    koma_count: 0,
    applied_koma: null,
    reason: '',
    sort_order: 0,
    group_id: 0,
    applied_group_id: 0,
    intent_tag: null,
    created_at: '2026-01-01',
    ...partial,
  };
}

function proposal(partial: Partial<SeasonalProposalWithDetails>): SeasonalProposalWithDetails {
  return {
    id: 'p1',
    student_id: 's1',
    textbook_id: 1,
    student_textbook_id: null,
    school_id: 'school1',
    season: 'summer',
    year: 2026,
    theme: 'テーマ',
    status: 'sent',
    applied_koma: null,
    notes: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    units: [],
    ...partial,
  };
}

function enrollment(partial: Partial<KoushuEnrollment>): KoushuEnrollment {
  return {
    id: 'e1',
    course_id: null,
    school_id: 'school1',
    season: 'summer',
    student_id: 's1',
    formation: 'individual',
    koma_count: 0,
    subject_ids: [],
    koma_by_subject: {},
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...partial,
  };
}

describe('groupStudentKoushu', () => {
  it('提案コマ/申込コマを group_id・applied_group_id で dedup して合算する', () => {
    const p = proposal({
      units: [
        // 提案: group_id=1 の2単元で1コマ（dedupで2ではなく2コマ1回）
        unit({ koma_count: 2, group_id: 1, applied_koma: 2, applied_group_id: 5 }),
        unit({ koma_count: 2, group_id: 1, applied_koma: 2, applied_group_id: 5 }),
        // 提案: 単独3コマ
        unit({ koma_count: 3, group_id: 0, applied_koma: 3, applied_group_id: 0 }),
      ],
    });
    const groups = groupStudentKoushu([p], []);
    expect(groups).toHaveLength(1);
    // 提案 = 2(group1) + 3 = 5
    expect(groups[0].totalProposedKoma).toBe(5);
    // 申込 = 2(applied_group5) + 3 = 5
    expect(groups[0].totalAppliedKoma).toBe(5);
    expect(groups[0].proposals[0].proposedKoma).toBe(5);
    expect(groups[0].proposals[0].appliedKoma).toBe(5);
  });

  it('申込(年度なし)は同シーズンの最大年度グループに寄せる', () => {
    const p2025 = proposal({ id: 'p2025', year: 2025, season: 'summer' });
    const p2026 = proposal({ id: 'p2026', year: 2026, season: 'summer' });
    const e = enrollment({ season: 'summer', koma_count: 8 });
    const groups = groupStudentKoushu([p2025, p2026], [e]);
    const g2026 = groups.find((g) => g.year === 2026)!;
    const g2025 = groups.find((g) => g.year === 2025)!;
    expect(g2026.enrollments).toHaveLength(1);
    expect(g2025.enrollments).toHaveLength(0);
    // 新しい期が先頭
    expect(groups[0].year).toBe(2026);
  });

  it('提案書が無いシーズンの申込は年度なしグループになる', () => {
    const e = enrollment({ season: 'winter', koma_count: 4 });
    const groups = groupStudentKoushu([], [e]);
    expect(groups).toHaveLength(1);
    expect(groups[0].year).toBeNull();
    expect(groups[0].season).toBe('winter');
    expect(groups[0].enrollments[0].komaCount).toBe(4);
  });
});
