/**
 * ⑤プラン提示の説明（今期の講習プランを、科目ごとに「なぜ・何を・どれだけ」で見せる）。
 * 画面に依存しない純粋関数。読み込みは lib/api/seasonalProposalSummary.ts の getCurrentPlanDetail。
 *
 * 教室長が承認したモック（2026-09-27）:
 *   「このプランで目指すこと」（AIの道筋の next）→ 科目ごとのカード（なぜ／やる単元／テーマ）
 *   → 合計のコマと状態 → 話す順の案内。
 *
 * ★数字（コマ数・点数の上下）はここでシステムが組む。AIが書くのは科目ごとの「なぜ」の文だけで、
 *   数字は書かせない（interviewBrief.ts の planReasons の注記）。
 * ★印刷シートには出さない（面談中に画面で指して話すもの。紙は別の決まりで組む）。
 */
import type { AssessmentWithScores } from '@/types/database';
import type { SeasonalProposalStatus } from '@/lib/api/seasonalProposalSummary';
import { PLAN_AI_PREFIX, MAX_PLAN_SUBJECTS } from '@/lib/ai/interviewBrief';
import { sumProposalUnitsKoma } from '@/lib/utils/koushuApplyPure';
import { TEST_SUBJECT_FAMILIES } from '@/lib/interview/story';

/** 提案書1件の単元（seasonal_proposal_units の1行） */
export interface PlanUnitDetail {
  /** 単元名（curriculum_items.title） */
  name: string;
  /** 提案のコマ数 */
  komaCount: number;
  /** 申込のコマ数。★下書きの提案書では 0 に戻されている（2026-05-28 の是正） */
  appliedKoma: number | null;
  /** 提案の結合グループ（0＝結合なし） */
  groupId: number;
  /** 申込の結合グループ（0＝結合なし） */
  appliedGroupId: number;
  sortOrder: number;
  reason: string;
}

/** 提案書1件（生徒×教材×期）。getCurrentPlanDetail の戻り */
export interface PlanProposalDetail {
  id: string;
  /** 科目名（表示用）。期ごとのまとめと同じ出し方（textbooks.subject → subject_id → 科目不明） */
  subject: string;
  textbookName: string;
  status: SeasonalProposalStatus;
  theme: string;
  /** 提案書行の申込コマ（確定値）。下書きは 0 */
  appliedKoma: number | null;
  /** sort_order の順 */
  units: PlanUnitDetail[];
}

/** 単元の札（「不定詞 3」）。結合した単元は「不定詞・動名詞 2」の1枚にまとめる */
export interface PlanUnitChip {
  name: string;
  koma: number;
}

/** 定期テストのその科目の上下（直近2回・両方に点がある科目だけ） */
export interface PlanTestChange {
  /** 札の文（「定期テスト英語 −8」） */
  label: string;
  diff: number;
}

export interface PlanSubjectView {
  subject: string;
  koma: number;
  /** 教材名（重複なし・提案書の順） */
  textbooks: string[];
  testChange: PlanTestChange | null;
  /** 先頭 MAX_UNIT_CHIPS 枚 */
  units: PlanUnitChip[];
  /** 出しきれなかった札の枚数（「ほかN」） */
  moreUnits: number;
  /** テーマ（教材が複数なら重複を除いて「／」でつなぐ）。無ければ空文字 */
  theme: string;
}

export interface PlanExplanation {
  subjects: PlanSubjectView[];
  totalKoma: number;
  /** 期の状態（approved > sent > draft で丸める。見出しのバッジと同じ規則） */
  status: SeasonalProposalStatus;
}

/** 単元の札を何枚まで出すか。★面談中に読み切れる数。残りは「ほかN」で数だけ見せる */
export const MAX_UNIT_CHIPS = 5;

const STATUS_RANK: Record<SeasonalProposalStatus, number> = { draft: 0, sent: 1, approved: 2 };

/**
 * 科目名から空白を詰める。★AIとの突き合わせキーにもなる（interviewBrief.ts の
 * planSubjectsFromSections は「プラン: 」の直後から最初の空白までを科目名として読む）。
 */
function normalizeSubject(subject: string): string {
  return subject.replace(/\s+/g, '') || '科目不明';
}

/**
 * 申込の値を使うか。★下書きは申込が未確定で applied_koma が 0 に戻されているので、提案の値を使う。
 * 申込の値が入っていない（null）単元も提案の値に倒す。
 */
function takesAppliedValue(status: SeasonalProposalStatus, unit: PlanUnitDetail): boolean {
  return status !== 'draft' && unit.appliedKoma != null;
}

function effectiveUnit(
  status: SeasonalProposalStatus,
  unit: PlanUnitDetail
): { name: string; koma: number; group: number; sortOrder: number } {
  const applied = takesAppliedValue(status, unit);
  return {
    name: unit.name,
    koma: applied ? (unit.appliedKoma as number) : unit.komaCount,
    group: applied ? unit.appliedGroupId : unit.groupId,
    sortOrder: unit.sortOrder,
  };
}

/**
 * 提案書1件の単元を札にする。
 * ★結合グループ（group>0）は1枚にまとめ、コマ数は先頭の単元の値を1回だけ使う。
 *   単元ごとに同じコマ数を出すと、足し算したときに倍に見える（koushuApplyPure の
 *   sumProposalUnitsKoma と同じ数え方。数え方を画面ごとに変えない）。
 * ★0コマの単元（申込で外したもの）は出さない。
 */
function unitChips(proposal: PlanProposalDetail): PlanUnitChip[] {
  const units = proposal.units
    .map((u) => effectiveUnit(proposal.status, u))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const chips: PlanUnitChip[] = [];
  const chipByGroup = new Map<number, PlanUnitChip>();
  for (const u of units) {
    const name = u.name.trim();
    if (!name) continue;
    if (u.group > 0) {
      const found = chipByGroup.get(u.group);
      if (found) {
        found.name = `${found.name}・${name}`;
        continue;
      }
      const chip = { name, koma: u.koma };
      chipByGroup.set(u.group, chip);
      chips.push(chip);
      continue;
    }
    chips.push({ name, koma: u.koma });
  }
  return chips.filter((c) => c.koma > 0);
}

/**
 * 提案書1件のコマ数。★申込が確定していれば提案書行の applied_koma（期ごとのまとめと同じ値）。
 * 下書き・未確定なら単元の合計（結合グループは1回だけ数える）に倒す。
 */
function proposalKoma(proposal: PlanProposalDetail): number {
  if (proposal.status !== 'draft' && proposal.appliedKoma != null && proposal.appliedKoma > 0) {
    return proposal.appliedKoma;
  }
  return sumProposalUnitsKoma(
    proposal.units.map((u) => {
      const e = effectiveUnit(proposal.status, u);
      return { groupId: e.group, komaCount: e.koma };
    })
  );
}

/**
 * 定期テストの直近2回で、その科目がどれだけ動いたか。
 * ★科目名から成績の科目コードに直すのは story.ts の TEST_SUBJECT_FAMILIES（見立ての札と同じ読み替え）。
 * ★両方の回に点がある科目コードだけで比べる（片方にしか無いと、それだけで大きく動いて見える。
 *   story.ts の compareLatestTwo と同じ理由）。0点は呼び出し元で未入力（null）にしてある前提。
 * ★assessments は新しい順（listAssessments の並び）。
 */
function testChangeOf(
  subject: string,
  assessments: readonly AssessmentWithScores[]
): PlanTestChange | null {
  const family = TEST_SUBJECT_FAMILIES.find((f) => f.re.test(subject));
  if (!family) return null;
  const tests = assessments.filter((a) => a.category === 'regular_test');
  if (tests.length < 2) return null;
  const [curr, prev] = tests;
  const pick = (a: AssessmentWithScores) => {
    const m = new Map<string, number>();
    for (const s of a.scores) {
      if (family.codes.includes(s.subject) && s.value != null) m.set(s.subject, s.value);
    }
    return m;
  };
  const c = pick(curr);
  const p = pick(prev);
  const common = Array.from(c.keys()).filter((k) => p.has(k));
  if (common.length === 0) return null;
  const diff = common.reduce((sum, k) => sum + (c.get(k) as number) - (p.get(k) as number), 0);
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±';
  return { label: `定期テスト${subject} ${sign}${Math.abs(diff)}`, diff };
}

/**
 * 今期の提案書から⑤の科目カードを組む。提案書が1件も無ければ null（⑤に何も足さない）。
 * ★科目でまとめる（1科目に教材が複数ありうる）。並びはコマ数の多い順 → 科目名
 *  （komaBySubjectText と同じ並び。受講の枠の行と順番をそろえる）。
 */
export function buildPlanExplanation(
  details: readonly PlanProposalDetail[],
  assessments: readonly AssessmentWithScores[]
): PlanExplanation | null {
  if (details.length === 0) return null;

  let status: SeasonalProposalStatus = 'draft';
  const bySubject = new Map<
    string,
    { koma: number; textbooks: string[]; chips: PlanUnitChip[]; themes: string[] }
  >();
  for (const d of details) {
    if (STATUS_RANK[d.status] > STATUS_RANK[status]) status = d.status;
    const subject = normalizeSubject(d.subject);
    const bucket = bySubject.get(subject) ?? { koma: 0, textbooks: [], chips: [], themes: [] };
    bucket.koma += proposalKoma(d);
    const book = d.textbookName.trim();
    if (book && !bucket.textbooks.includes(book)) bucket.textbooks.push(book);
    bucket.chips.push(...unitChips(d));
    const theme = d.theme.trim();
    if (theme && !bucket.themes.includes(theme)) bucket.themes.push(theme);
    bySubject.set(subject, bucket);
  }

  const subjects: PlanSubjectView[] = Array.from(bySubject.entries())
    .sort((a, b) => b[1].koma - a[1].koma || a[0].localeCompare(b[0]))
    .map(([subject, b]) => ({
      subject,
      koma: b.koma,
      textbooks: b.textbooks,
      testChange: testChangeOf(subject, assessments),
      units: b.chips.slice(0, MAX_UNIT_CHIPS),
      moreUnits: Math.max(0, b.chips.length - MAX_UNIT_CHIPS),
      theme: b.themes.join('／'),
    }));

  return {
    subjects,
    totalKoma: subjects.reduce((sum, s) => sum + s.koma, 0),
    status,
  };
}

/**
 * AIへ koushu セクションに混ぜて送る行（科目ごと1行）。
 * 「プラン: 英語 10コマ：教材「…」／テーマ：…／単元：不定詞・比較」
 * ★単元は名前だけ（コマ数は科目の合計だけで足りる。AIは数字を書かないので細かい数は要らない）。
 * ★表示側は PLAN_AI_PREFIX の行を外す（stripTargetSchoolFactLines）。⑤の科目カードが別の形で出すため。
 */
export function buildPlanAiLines(plan: PlanExplanation | null): string[] {
  if (!plan) return [];
  return plan.subjects.slice(0, MAX_PLAN_SUBJECTS).map((s) => {
    const parts = [
      s.textbooks.length > 0 ? `教材${s.textbooks.map((t) => `「${t}」`).join('')}` : null,
      s.theme ? `テーマ：${s.theme}` : null,
      s.units.length > 0 ? `単元：${s.units.map((u) => u.name).join('・')}` : null,
    ].filter(Boolean);
    return `${PLAN_AI_PREFIX} ${s.subject} ${s.koma}コマ${parts.length > 0 ? `：${parts.join('／')}` : ''}`;
  });
}
