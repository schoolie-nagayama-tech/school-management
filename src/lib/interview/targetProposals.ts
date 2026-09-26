/**
 * ④現状の確認「志望校と提案」の中身を組む（画面に依存しない純粋関数）。
 *
 * 本人のいまの偏差値（直近の模試の5科）から、教室の最寄り駅の近くの公立高校を
 * 挑戦／順当／安全に分けて並べる。登録済みの志望校は区分の範囲外でも必ず並べる。
 *
 * ★1区分は「志望校を含めて」3校（最大9校）。その区分に入る登録済みの公立の志望校が枠を先に使い、
 *   残りを近くの候補で埋める（2026-09-27 教室長）。志望校に候補3校を足すと1区分に最大6校並び、
 *   面談で読み切れない。
 *   - 登録済みが3校を超えても削らない（志望校を表から消すと、面談でその学校の話ができない）。
 *   - 登録済みの私立は数えない。私立は偏差値で区分に入って公立の表に並ぶが、提案の枠は公立の話で、
 *     私立の提案は別の欄（privateProposals.ts「私立（併願優遇）」）が持つ。
 *   - 偏差値が引けない登録済み（区分なし）はどの枠も使わず、従来どおり最後に並べる。
 *
 * ★区分は偏差値の差だけで機械的に決める（本人 − めやす）。
 *   - 挑戦 … あと3〜5足りない
 *   - 順当 … ±2
 *   - 安全 … 3〜6余裕
 *   内申は満点が学校ごとに違う（65・135・75・52）ので区分には使わず、差を添えるだけにする。
 *   差の計算は④の「志望校」の行と同じ targetSchoolDiffs を通す（数字が画面の中で食い違わないように）。
 * ★提案は普通科の本体（course が空文字）だけ。学科・コースまで並べると同じ学校が何行も出て、
 *   面談で話す候補にならない。登録済みの志望校はコースでも並べる。
 * ★通学の目安の起点は教室の最寄り駅（schools.nearest_station_*）。生徒の住所は使わない。
 *   直線距離が 8km までは自転車の分数、それより遠ければ電車として直線距離と沿線だけを出す。
 *   電車の所要時間は出さない（乗り換えを無視した数字は保護者に言えない。docs/data/README.md）。
 */
import { estimateBikeMinutes, haversineKm } from '@/lib/geo/distance';
import type { TargetSchoolMaster } from '@/lib/api/targetSchools';
import { targetSchoolDiffs, type OwnNaishinByScale } from '@/app/interview/interview.shared';

export type ProposalBand = 'challenge' | 'fit' | 'safe';

export const PROPOSAL_BAND_LABEL: Record<ProposalBand, string> = {
  challenge: '挑戦',
  fit: '順当',
  safe: '安全',
};

/** 提案に並べる範囲（本人 − めやす）。登録済みの志望校はこの範囲外でも並べる */
const PROPOSAL_MIN_DIFF = -5;
const PROPOSAL_MAX_DIFF = 6;
/** 1区分に並べる数（登録済みの公立の志望校を含む）。★多いと面談で読み切れない。近い順に切る */
export const PROPOSALS_PER_BAND = 3;
/** 提案に入れる直線距離の上限（km）。通学60分に収まるおおよその範囲 */
export const PROPOSAL_MAX_KM = 15;
/** 自転車の目安を出す直線距離の上限（km）。15km/h で約32分 */
export const BIKE_MAX_KM = 8;

/** 高校マスタ1校ぶん（最新年度のめやす付き） */
export interface ProposalSchool {
  id: string;
  prefecture: string;
  /** 設置区分。省略＝公立 */
  establishment?: '公立' | '私立' | '国立';
  schoolName: string;
  course: string;
  category: string;
  lat: number | null;
  lon: number | null;
  accessLines: string[];
  naishin: number | null;
  naishinMax: number | null;
  hensachi: number | null;
  sourceLabel: string;
  verifiedAt: string | null;
}

/** 通学の起点（教室の最寄り駅） */
export interface ProposalOrigin {
  name: string;
  lat: number;
  lon: number;
}

export interface ProposalRow {
  school: ProposalSchool;
  /** 偏差値が引けない登録済みの志望校は null */
  band: ProposalBand | null;
  /** 本人 − めやす（偏差値）。負＝足りない */
  hensachiDiff: number | null;
  /** 本人 − めやす（内申・学校の満点で比べたもの）。比べられなければ null */
  naishinDiff: number | null;
  /** 教室の最寄り駅からの直線距離（km）。起点か学校の位置が無ければ null */
  km: number | null;
  /** 通学の目安（「自転車 約21分（直線5.2km）」など）。出せなければ null */
  commute: string | null;
  /** 登録済みの志望校なら志望順位（1〜3） */
  rank: number | null;
  /** 登録済みの志望校で「併願」の印が付いているか。提案の行は常に false */
  heigan: boolean;
}

export interface BuildProposalsInput {
  schools: readonly ProposalSchool[];
  own: OwnNaishinByScale;
  ownHensachi: number | null;
  origin: ProposalOrigin | null;
  /** 登録済みの志望校（マスタに当たったものだけ） */
  registered: readonly { highSchoolId: string; rank: number; isHeigan?: boolean }[];
}

/** 偏差値の差（本人 − めやす）から区分を決める。範囲の外は一番近い区分に寄せる */
export function bandOf(diff: number): ProposalBand {
  if (diff <= -3) return 'challenge';
  if (diff >= 3) return 'safe';
  return 'fit';
}

function toMaster(s: ProposalSchool): TargetSchoolMaster {
  return {
    prefecture: s.prefecture,
    schoolName: s.schoolName,
    course: s.course,
    category: s.category,
    naishin: s.naishin,
    naishinMax: s.naishinMax,
    hensachi: s.hensachi,
    sourceLabel: s.sourceLabel,
    verifiedAt: s.verifiedAt,
    accessLines: s.accessLines,
  };
}

/** 小数1桁の km（「5.2」）。★0.05 の境目で 5.25→5.3 のような揺れは気にしない（目安） */
function formatKm(km: number): string {
  return (Math.round(km * 10) / 10).toFixed(1);
}

/**
 * 沿線を短く。★私立の沿線は「東日本旅客鉄道 中央線」「東京地下鉄 4号線丸ノ内線」のように
 * 会社名と番号付きで入っている（公立は路線名だけ）。会社名と「◯号線」を外して「中央線」「丸ノ内線」にする。
 * ただし「京浜急行電鉄 本線」は「本線」だけでは何線か分からないので、元の書き方のまま残す。
 */
export function shortLineName(line: string): string {
  const name = (line.split(/\s+/).pop() ?? line).replace(/^\d+号線/, '');
  return !name || name === '本線' ? line : name;
}

/**
 * 通学の目安の文。
 * ★「直線」を必ず添える（道のりは直線の1.2〜1.4倍になる。distance.ts の注記）。
 */
export function commuteText(km: number, accessLines: readonly string[]): string {
  if (km <= BIKE_MAX_KM) {
    return `自転車 約${estimateBikeMinutes(km)}分（直線${formatKm(km)}km）`;
  }
  const lines = Array.from(new Set(accessLines.map(shortLineName)))
    .slice(0, 2)
    .join('・');
  return lines ? `電車 直線${formatKm(km)}km・${lines}` : `電車 直線${formatKm(km)}km`;
}

const BAND_ORDER: Record<ProposalBand, number> = { challenge: 0, fit: 1, safe: 2 };

/**
 * 志望校と提案の行を組む。並びは 挑戦→順当→安全、各区分の中は登録済み→近い順。
 * ★本人の偏差値が無ければ提案は作らない（登録済みの志望校だけを返す）。
 *   内申だけで区分を決めると、満点の違う学校を同じ物差しで並べることになる。
 */
export function buildTargetProposals(input: BuildProposalsInput): ProposalRow[] {
  const { schools, own, ownHensachi, origin, registered } = input;
  const rankById = new Map(registered.map((r) => [r.highSchoolId, r.rank]));
  const heiganIds = new Set(registered.filter((r) => r.isHeigan).map((r) => r.highSchoolId));

  const toRow = (s: ProposalSchool): ProposalRow => {
    const { hensachiDiff, naishinDiff } = targetSchoolDiffs(toMaster(s), own, ownHensachi);
    const km =
      origin && s.lat != null && s.lon != null
        ? haversineKm(origin.lat, origin.lon, s.lat, s.lon)
        : null;
    return {
      school: s,
      band: hensachiDiff != null ? bandOf(hensachiDiff) : null,
      hensachiDiff,
      naishinDiff,
      km,
      commute: km != null ? commuteText(km, s.accessLines) : null,
      rank: rankById.get(s.id) ?? null,
      heigan: heiganIds.has(s.id),
    };
  };

  const registeredRows = schools.filter((s) => rankById.has(s.id)).map(toRow);

  const candidates =
    ownHensachi == null
      ? []
      : schools
          .filter((s) => !rankById.has(s.id))
          // 普通科の本体だけ（冒頭の注記）
          .filter((s) => s.course === '')
          .map(toRow)
          .filter(
            (r) =>
              r.hensachiDiff != null &&
              r.hensachiDiff >= PROPOSAL_MIN_DIFF &&
              r.hensachiDiff <= PROPOSAL_MAX_DIFF &&
              // ★起点が無い教室では距離で絞れない。全都県から近い順に選べないので出さない
              r.km != null &&
              r.km <= PROPOSAL_MAX_KM
          );

  const byDistance = (a: ProposalRow, b: ProposalRow) => (a.km ?? Infinity) - (b.km ?? Infinity);
  const picked: ProposalRow[] = [];
  for (const band of ['challenge', 'fit', 'safe'] as const) {
    // ★登録済みの公立の志望校がこの区分の枠を先に使う（冒頭の注記）。私立は数えない。
    //   establishment 省略＝公立（ProposalSchool の注記）
    const used = registeredRows.filter(
      (r) => r.band === band && (r.school.establishment ?? '公立') === '公立'
    ).length;
    picked.push(
      ...candidates
        .filter((r) => r.band === band)
        .sort(byDistance)
        .slice(0, Math.max(0, PROPOSALS_PER_BAND - used))
    );
  }

  return [...registeredRows, ...picked].sort((a, b) => {
    // 区分の無い登録済み（偏差値が引けない）は最後
    const ab = a.band ? BAND_ORDER[a.band] : 3;
    const bb = b.band ? BAND_ORDER[b.band] : 3;
    if (ab !== bb) return ab - bb;
    const ar = a.rank ?? 99;
    const br = b.rank ?? 99;
    if (ar !== br) return ar - br;
    return byDistance(a, b);
  });
}

/** 差の見せ方。偏差値・内申とも「あと4」（足りない）／「3余裕」／「同じ」 */
export function formatGap(
  diff: number | null
): { text: string; tone: 'short' | 'over' | 'even' } | null {
  if (diff == null) return null;
  if (diff < 0) return { text: `あと${-diff}`, tone: 'short' };
  if (diff > 0) return { text: `${diff}余裕`, tone: 'over' };
  return { text: '同じ', tone: 'even' };
}
