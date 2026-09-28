import type { Database } from '@/types/database';
import type { AdmissionRule, AdmissionRuleBody } from './privateAdmission';

/**
 * high_school_admission_rules の行 → 判定ロジックの型（AdmissionRule）。
 *
 * ★もとは src/lib/api/targetSchools.ts にあった。AIヘルプ（src/lib/ai/schoolMaster.ts・server-only）からも
 *   使うためにここへ移した。targetSchools.ts はブラウザ用の supabase クライアントを import 時に作るので、
 *   サーバーのルートから import するとサーバーでブラウザ用クライアントが生まれてしまう。
 *   このファイルは型しか import しない（どこから読んでも副作用が無い）。
 *   targetSchools.ts からは再輸出しているので、既存の呼び出し元はそのまま動く。
 */

type AdmissionRuleDbRow = Database['public']['Tables']['high_school_admission_rules']['Row'];

/**
 * 変換に要る列だけ。★raw_text（冊子の原文）は重いので、一覧で読むとき（AIヘルプは全校ぶん読む）は
 *   選ばずに済むよう省略可にしてある。省略時は空文字。
 */
export type AdmissionRuleRowLike = Pick<
  AdmissionRuleDbRow,
  | 'id'
  | 'kind'
  | 'exam_label'
  | 'public_only'
  | 'applicant_scope'
  | 'gender'
  | 'strength'
  | 'rule'
  | 'checks'
  | 'source_label'
  | 'verified_at'
  | 'sort_order'
> & { raw_text?: string };

/** DBの1行 → 判定ロジックの型。rule（jsonb）の中身は取込スクリプトで形を検めてある */
export function toAdmissionRule(row: AdmissionRuleRowLike): AdmissionRule {
  const body = row.rule as unknown as Partial<AdmissionRuleBody>;
  return {
    id: row.id,
    kind: row.kind,
    examLabel: row.exam_label,
    publicOnly: row.public_only,
    applicantScope: row.applicant_scope,
    gender: row.gender,
    strength: row.strength,
    body: {
      any: body.any ?? [],
      gates: body.gates ?? [],
      bonus: body.bonus ?? null,
      no_criterion: body.no_criterion ?? null,
    },
    checks: row.checks ?? [],
    rawText: row.raw_text ?? '',
    sourceLabel: row.source_label,
    verifiedAt: row.verified_at,
    sortOrder: row.sort_order,
  };
}

/** 学校ごとに最新年度の基準だけを残す（古い年度は過去の面談の再現用に残してあるだけ） */
export function latestRulesBySchool(
  rows: Array<AdmissionRuleRowLike & Pick<AdmissionRuleDbRow, 'high_school_id' | 'source_year'>>
): Map<string, AdmissionRule[]> {
  const latestYear = new Map<string, number>();
  for (const r of rows) {
    latestYear.set(
      r.high_school_id,
      Math.max(latestYear.get(r.high_school_id) ?? 0, r.source_year)
    );
  }
  const out = new Map<string, AdmissionRule[]>();
  for (const r of rows) {
    if (r.source_year !== latestYear.get(r.high_school_id)) continue;
    const list = out.get(r.high_school_id) ?? [];
    list.push(toAdmissionRule(r));
    out.set(r.high_school_id, list);
  }
  for (const list of Array.from(out.values())) list.sort((a, b) => a.sortOrder - b.sortOrder);
  return out;
}
