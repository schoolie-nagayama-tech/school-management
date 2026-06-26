import type { SeasonType, ProposalStatus, SeasonalProposalWithDetails } from '@/types/database';
import { SEASON_LABELS } from '@/types/database';
import type { ScheduleEntryFormation } from '@/types/schedule';
import type { KoushuEnrollment } from '@/lib/api/seasonalCourses';
import { calcTotalKoma, calcTotalAppliedKoma } from '@/lib/api/proposals';

/**
 * 生徒詳細「講習」タブ用の集計ヘルパー（純関数）。
 * 講習提案書（年度あり）と講習申込（koushu_enrollments, 年度なし）を期（season+year）ごとに束ねる。
 *
 * 注意: koushu_enrollments は年度カラムを持たない（school+season+student+formation で一意）。
 * そのため申込は「同シーズンで最も新しい年度の提案グループ」に寄せる。該当が無ければ年度なしの
 * グループを作る。提案/申込コマの数え方は既存の calcTotalKoma / calcTotalAppliedKoma に合わせる。
 */

export interface StudentKoushuProposal {
  id: string;
  textbookName: string;
  subject: string | null;
  theme: string;
  status: ProposalStatus;
  // group_id ベースの実質提案コマ数
  proposedKoma: number;
  // applied_group_id ベースの実質申込コマ数（未入力は null）
  appliedKoma: number | null;
}

export interface StudentKoushuEnrollment {
  formation: ScheduleEntryFormation;
  komaCount: number;
  // { subject_id: コマ数 }
  komaBySubject: Record<string, number>;
}

export interface StudentKoushuPeriodGroup {
  key: string;
  season: SeasonType;
  // 年度。提案書が無く申込だけのグループは null。
  year: number | null;
  label: string;
  proposals: StudentKoushuProposal[];
  enrollments: StudentKoushuEnrollment[];
  totalProposedKoma: number;
  totalAppliedKoma: number;
}

const SEASON_ORDER: Record<SeasonType, number> = { spring: 1, summer: 2, winter: 3 };

function periodLabel(season: SeasonType, year: number | null): string {
  const s = SEASON_LABELS[season] ?? season;
  return year ? `${year} ${s}講習` : `${s}講習`;
}

export function groupStudentKoushu(
  proposals: SeasonalProposalWithDetails[],
  enrollments: KoushuEnrollment[]
): StudentKoushuPeriodGroup[] {
  const groups = new Map<string, StudentKoushuPeriodGroup>();

  const ensureGroup = (season: SeasonType, year: number | null): StudentKoushuPeriodGroup => {
    const key = `${season}-${year ?? 'none'}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        season,
        year,
        label: periodLabel(season, year),
        proposals: [],
        enrollments: [],
        totalProposedKoma: 0,
        totalAppliedKoma: 0,
      };
      groups.set(key, g);
    }
    return g;
  };

  // 提案書を期ごとに振り分ける
  for (const p of proposals) {
    const g = ensureGroup(p.season, p.year);
    const proposedKoma = calcTotalKoma(p.units);
    const appliedKoma = calcTotalAppliedKoma(p.units);
    g.proposals.push({
      id: p.id,
      textbookName: p.textbook?.name ?? '（教材未設定）',
      subject: p.textbook?.subject ?? null,
      theme: p.theme,
      status: p.status,
      proposedKoma,
      appliedKoma,
    });
    g.totalProposedKoma += proposedKoma;
    g.totalAppliedKoma += appliedKoma ?? 0;
  }

  // 申込（年度なし）を「同シーズンの最大年度グループ」に寄せる。無ければ年度なしグループ。
  const maxYearBySeason = new Map<SeasonType, number>();
  for (const g of Array.from(groups.values())) {
    if (g.year != null) {
      const cur = maxYearBySeason.get(g.season);
      if (cur == null || g.year > cur) maxYearBySeason.set(g.season, g.year);
    }
  }
  for (const e of enrollments) {
    const season = (e.season ?? '') as SeasonType;
    if (!SEASON_ORDER[season]) continue; // season 不明な行はスキップ
    const targetYear = maxYearBySeason.get(season) ?? null;
    const g = ensureGroup(season, targetYear);
    g.enrollments.push({
      formation: e.formation,
      komaCount: e.koma_count,
      komaBySubject: e.koma_by_subject ?? {},
    });
  }

  // 年度降順 → シーズン降順（冬→夏→春）で新しい期を上に
  return Array.from(groups.values()).sort((a, b) => {
    const ay = a.year ?? -Infinity;
    const by = b.year ?? -Infinity;
    if (ay !== by) return by - ay;
    return SEASON_ORDER[b.season] - SEASON_ORDER[a.season];
  });
}
