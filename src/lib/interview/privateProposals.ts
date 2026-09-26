/**
 * ④「志望校と提案」の私立（併願優遇）。画面に依存しない純粋関数。
 *
 * 教室長の決め（2026-09-25・モックで確認）:
 *   - 私立は「いまの内申±1」で出す（併願優遇の内申基準が本人の内申の −1〜+1 の学校）
 *   - 行を押すと、右に基準を並べて比べる（比べたいときもあるから）
 *   - 区分の条件（第2志望のみ・英4・9科に2は不可 など）は行に出しておく
 *
 * ★区分は代表の区分（pickPrimaryRule＝併願優遇（公私）が先）。併願の区分が無い学校（推薦・単願だけ）は
 *   ここには出さない（「併願で押さえる私立」の話なので）。登録済みの志望校なら公立と同じ表に並ぶ。
 * ★差（±1）は admissionMargin（合計の基準だけで見る）。平均の基準しか無い学校は出さない。
 * ★距離は教室の最寄り駅から直線20km以内（公立の15kmより広い。私立は遠くから通う生徒が多い）。
 * ★本人の性別（students.gender・2026-09-27〜）が入っていれば、入れない学校（女子生徒に男子校、
 *   男子生徒に女子校）を外し、偏差値は本人の性別の表の値だけを出す。区分も男女別の基準なら本人の側を使う。
 *   未設定なら従来どおり男子校・女子校も外さず、学校名の横に出して教室長が判断する（偏差値も男女両方）。
 */
import { commuteText, type ProposalOrigin, type ProposalSchool } from './targetProposals';
import { haversineKm } from '@/lib/geo/distance';
import type { NearbyPrivateSchool } from '@/lib/api/targetProposals';
import type { Region } from './region';
import {
  admissionMargin,
  ADMISSION_STATUS_LABEL,
  evaluateRule,
  pickPrimaryRule,
  provisionalNote,
  ruleConditionChips,
  ruleCriterionText,
  ruleHeading,
  type AdmissionJudgment,
  type AdmissionRule,
  type StudentReportCards,
} from './privateAdmission';

/** 私立の提案に入れる直線距離の上限（km） */
export const PRIVATE_MAX_KM = 20;
/** 「いまの内申±1」 */
export const PRIVATE_MARGIN_RANGE = 1;
/** 1つの差（あと1／ちょうど／1余裕）に並べる数。★多いと面談で読み切れない */
export const PRIVATE_PER_BAND = 3;

export type PrivateBand = 'near' | 'even' | 'over';

export const PRIVATE_BAND_LABEL: Record<PrivateBand, string> = {
  near: 'あと1',
  even: 'ちょうど',
  over: '1余裕',
};

export function privateBandOf(margin: number): PrivateBand {
  if (margin < 0) return 'near';
  if (margin > 0) return 'over';
  return 'even';
}

/** 右で比べるときの1校ぶん（表の行を押したら右に足す） */
export interface PrivateCompareItem {
  id: string;
  name: string;
  course: string;
  heading: string;
  criterion: string;
  /** 本人の値（「5科22・9科38」）。評定が無ければ「未入力」 */
  own: string;
  judgment: string;
  chips: string[];
  checks: string[];
  hensachi: string;
  commute: string | null;
  /** 基準が紙の原本と未照合 */
  unverified: boolean;
  provisional: string | null;
}

export interface PrivateProposalRow {
  school: ProposalSchool;
  band: PrivateBand;
  margin: number;
  /** 表の「内申めやす」欄に出す短い判定（「5科 あと1」「5科22 ちょうど」） */
  judgmentText: string;
  chips: string[];
  /** 「男57／女56」または「60」 */
  hensachiText: string;
  genderType: string | null;
  km: number;
  commute: string;
  compare: PrivateCompareItem;
}

/**
 * 偏差値の見せ方。
 * - 生徒の性別が分かっていて、その性別の値があればそれだけ（男女別の表の学校で、関係ない側を出さない）
 * - 未設定なら、男女で違えば両方
 */
export function privateHensachiText(
  hensachi: number | null,
  byGender: { 男子?: number; 女子?: number },
  gender: 'male' | 'female' | null = null
): string {
  if (hensachi != null) return String(hensachi);
  const m = byGender['男子'];
  const f = byGender['女子'];
  const own = gender === 'male' ? m : gender === 'female' ? f : undefined;
  if (own != null) return String(own);
  // ★男子表・女子表で同じ値なら1つにまとめる（違うときだけ両方を並べる）
  if (m != null && f != null) return m === f ? String(m) : `男${m}／女${f}`;
  if (m != null) return `男${m}`;
  if (f != null) return `女${f}`;
  return '—';
}

/** 判定の行が一番きつい合計（「5科」）の名前。表に「5科 あと1」と出す用 */
function tightestSumLabel(j: AdmissionJudgment): string {
  const sums = j.alternatives
    .filter((a) => a.gap != null && !a.clauses.some((c) => c.type === 'avg'))
    .flatMap((a) => a.clauses.filter((c) => c.type === 'sum' && c.have != null && c.need != null));
  if (sums.length === 0) return '内申';
  const best = sums.reduce((a, b) =>
    (b.have as number) - (b.need as number) > (a.have as number) - (a.need as number) ? b : a
  );
  return best.label.replace(/\s[\d./]+\s以上$/, '').replace(/\s/g, '');
}

/** 本人の合計（基準に出てくる合計だけ。「5科22・9科38」） */
function ownSums(j: AdmissionJudgment): string {
  const seen = new Map<string, number>();
  for (const a of j.alternatives) {
    for (const c of a.clauses) {
      if (c.type !== 'sum' || c.have == null) continue;
      const key = c.label.replace(/\s[\d./]+\s以上$/, '').replace(/\s/g, '');
      if (!seen.has(key)) seen.set(key, c.have);
    }
  }
  return seen.size > 0
    ? Array.from(seen.entries())
        .map(([k, v]) => `${k}${v}`)
        .join('・')
    : '未入力';
}

/** 比べる1校ぶんを組む（提案の行・登録済みの私立の志望校の両方で使う） */
export function buildPrivateCompareItem(args: {
  id: string;
  school: Pick<ProposalSchool, 'schoolName' | 'course'>;
  rule: AdmissionRule;
  judgment: AdmissionJudgment;
  hensachiText: string;
  commute: string | null;
}): PrivateCompareItem {
  const { rule, judgment } = args;
  return {
    id: args.id,
    name: args.school.schoolName,
    course: args.school.course,
    heading: ruleHeading(rule),
    criterion: ruleCriterionText(rule),
    own: ownSums(judgment),
    judgment: `${ADMISSION_STATUS_LABEL[judgment.status]}・${judgment.summary}`,
    chips: ruleConditionChips(rule),
    checks: judgment.checks,
    hensachi: args.hensachiText,
    commute: args.commute,
    unverified: rule.verifiedAt == null,
    provisional: provisionalNote(judgment.provisional),
  };
}

/**
 * 近くの私立から「いまの内申±1」の学校を並べる。
 * 並び: あと1 → ちょうど → 1余裕、同じ差の中は偏差値の高い順（男女で違えば高いほう）→ 近い順。
 * ★登録済みの志望校（registeredIds）は公立と同じ表に並ぶので、ここからは外す（同じ学校を2行出さない）。
 * ★gender（生徒の性別）が分かれば、入れない男子校・女子校を外し、偏差値は本人の性別の値で並べる。
 */
export function buildPrivateProposals(input: {
  candidates: readonly NearbyPrivateSchool[];
  cards: StudentReportCards;
  region: Region | null;
  origin: ProposalOrigin | null;
  registeredIds: ReadonlySet<string>;
  /** 生徒の性別。null（未設定）なら男子校・女子校も外さない */
  gender?: 'male' | 'female' | null;
}): PrivateProposalRow[] {
  const { candidates, cards, region, origin, registeredIds } = input;
  const gender = input.gender ?? null;
  if (!origin || !cards.grade3) return [];
  // 本人が入れない学校の gender_type（'男子'|'女子'|'共学'）
  const closedType = gender === 'female' ? '男子' : gender === 'male' ? '女子' : null;

  const rows: PrivateProposalRow[] = [];
  for (const c of candidates) {
    const s = c.school;
    if (registeredIds.has(s.id) || s.lat == null || s.lon == null) continue;
    if (closedType && c.genderType === closedType) continue;
    const km = haversineKm(origin.lat, origin.lon, s.lat, s.lon);
    if (km > PRIVATE_MAX_KM) continue;
    const rule = pickPrimaryRule(c.rules, region, gender);
    if (!rule || rule.kind !== '併願') continue;
    const judgment = evaluateRule(rule, cards);
    const margin = admissionMargin(judgment);
    if (margin == null || Math.abs(margin) > PRIVATE_MARGIN_RANGE) continue;

    const band = privateBandOf(margin);
    const sumLabel = tightestSumLabel(judgment);
    const judgmentText =
      band === 'near'
        ? `${sumLabel} あと${-margin}`
        : band === 'even'
          ? `${sumLabel} ちょうど`
          : `${sumLabel} ${margin}余裕`;
    const hensachiText = privateHensachiText(s.hensachi, c.hensachiByGender, gender);
    const commute = commuteText(km, s.accessLines);
    rows.push({
      school: s,
      band,
      margin,
      judgmentText,
      chips: ruleConditionChips(rule),
      hensachiText,
      genderType: c.genderType,
      km,
      commute,
      compare: buildPrivateCompareItem({
        id: s.id,
        school: s,
        rule,
        judgment,
        hensachiText,
        commute,
      }),
    });
  }

  const topHensachi = (r: PrivateProposalRow) =>
    Math.max(
      r.school.hensachi ?? -1,
      ...(r.hensachiText.match(/\d+/g) ?? []).map((v) => Number(v))
    );
  const order: PrivateBand[] = ['near', 'even', 'over'];
  return order.flatMap((band) =>
    rows
      .filter((r) => r.band === band)
      .sort((a, b) => topHensachi(b) - topHensachi(a) || a.km - b.km)
      .slice(0, PRIVATE_PER_BAND)
  );
}
