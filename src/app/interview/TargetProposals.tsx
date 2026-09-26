'use client';

/**
 * ④現状の確認「志望校と提案」（左＝表）と「勉強の仕方」のカード。地図は TargetSchoolMap.tsx（右）。
 *
 * ★1校1行の表にする（2026-09-25 教室長レビュー「もっとコンパクトに」）。区分（挑戦・順当・安全）は
 *   行頭の色と文字で見せ、差は「あと4」「3余裕」と面談でそのまま読める形で出す。
 *   行を押すと右の地図がその学校に寄る。
 * ★区分の決め方・通学の目安の出し方は src/lib/interview/targetProposals.ts の注記。
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AssessmentWithScores } from '@/types/database';
import type { TargetSchoolRow } from '@/lib/api/targetSchools';
import {
  getClassroomOrigin,
  getNearbyPrivateSchools,
  getProposalSchools,
  type NearbyPrivateSchool,
} from '@/lib/api/targetProposals';
import {
  buildPrivateCompareItem,
  buildPrivateProposals,
  PRIVATE_BAND_LABEL,
  PRIVATE_MAX_KM,
  privateHensachiText,
  type PrivateBand,
  type PrivateCompareItem,
  type PrivateProposalRow,
} from '@/lib/interview/privateProposals';
import { X } from 'lucide-react';
import {
  buildTargetProposals,
  formatGap,
  PROPOSAL_BAND_LABEL,
  type ProposalOrigin,
  type ProposalRow,
} from '@/lib/interview/targetProposals';
import { REGION_LABEL, regionOfSchool } from '@/lib/interview/region';
import { studyTipById } from '@/lib/interview/studyTips';
import type { BriefStudyTip } from '@/lib/ai/interviewBrief';
import {
  latestOwnHensachi,
  latestOwnKanagawaNaishin,
  latestOwnNaishin,
  privateAdmissionBlock,
} from './interview.shared';
import {
  ADMISSION_STATUS_LABEL,
  buildStudentReportCards,
  type AdmissionStatus,
} from '@/lib/interview/privateAdmission';

/** 私立・国立の行に「内申めやす」の代わりに出す、推薦・併願優遇の判定（代表の区分） */
export interface PrivateJudgmentCell {
  heading: string;
  status: AdmissionStatus;
  summary: string;
}

/** 判定の色（PrivateAdmissionDetails と同じ意味の色） */
const JUDGMENT_TEXT_CLASS: Record<AdmissionStatus, string> = {
  ok: 'text-success',
  ok_with_bonus: 'text-success',
  conditional: 'text-info',
  bonus: 'text-info',
  short: 'text-warning',
  ng: 'text-danger',
  na: 'text-text-muted',
  nodata: 'text-text-muted',
};

/** 区分の色。★地図のピン（TargetSchoolMap）と同じ組み合わせにする */
export const BAND_TEXT_CLASS = {
  challenge: 'text-danger',
  fit: 'text-info',
  safe: 'text-success',
} as const;
const BAND_BORDER_CLASS = {
  challenge: 'border-l-danger',
  fit: 'border-l-info',
  safe: 'border-l-success',
} as const;

export interface TargetProposalsState {
  rows: ProposalRow[];
  /** high_schools.id → 私立の判定。私立・国立の登録済みの志望校だけ入る */
  privateJudgments: Map<string, PrivateJudgmentCell>;
  /** 私立（併願優遇）の提案。いまの内申±1の学校（privateProposals.ts） */
  privateRows: PrivateProposalRow[];
  /** high_schools.id → 右で比べる1校ぶん。私立の提案と、登録済みの私立の志望校の両方 */
  compareById: Map<string, PrivateCompareItem>;
  origin: ProposalOrigin | null;
  ownHensachi: number | null;
  loading: boolean;
  error: boolean;
}

/**
 * 提案の材料を読み、行を組む。
 * ★教室の都県の学校（約200校）を生徒ごとに読み直さないよう、教室が変わったときだけ読む。
 *   登録済みの志望校が他県ならそれも足す。
 */
export function useTargetProposals(
  schoolId: string | null | undefined,
  targetSchools: TargetSchoolRow[],
  assessments: AssessmentWithScores[],
  /**
   * 生徒の性別（students.gender）。分かれば私立の提案から入れない男子校・女子校を外し、
   * 偏差値・男女別の基準を本人の側で出す。未設定（null）なら従来どおり両方。
   */
  gender: 'male' | 'female' | null = null
): TargetProposalsState {
  const registered = useMemo(
    () =>
      targetSchools
        .filter((t) => t.highSchoolId)
        .map((t) => ({ highSchoolId: t.highSchoolId as string, rank: t.rank })),
    [targetSchools]
  );
  const registeredKey = registered.map((r) => r.highSchoolId).join(',');

  const [schools, setSchools] = useState<Awaited<ReturnType<typeof getProposalSchools>>>([]);
  const [origin, setOrigin] = useState<ProposalOrigin | null>(null);
  const [privates, setPrivates] = useState<NearbyPrivateSchool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!schoolId) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(false);
    const region = regionOfSchool(schoolId);
    void (async () => {
      try {
        const [list, o] = await Promise.all([
          getProposalSchools(
            region ? REGION_LABEL[region] : null,
            registeredKey ? registeredKey.split(',') : []
          ),
          getClassroomOrigin(schoolId),
        ]);
        if (!alive) return;
        setSchools(list);
        setOrigin(o);
        // ★私立は起点（教室の最寄り駅）が無いと距離で絞れないので読まない。
        //   読めなくても公立の表は出す（私立の欄が空になるだけ）
        setPrivates(o ? await getNearbyPrivateSchools(o, PRIVATE_MAX_KM).catch(() => []) : []);
      } catch {
        if (alive) setError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [schoolId, registeredKey]);

  const ownHensachi = useMemo(() => latestOwnHensachi(assessments), [assessments]);
  const rows = useMemo(
    () =>
      buildTargetProposals({
        schools,
        own: {
          tokyo: latestOwnNaishin(assessments),
          kanagawa: latestOwnKanagawaNaishin(assessments),
        },
        ownHensachi,
        origin,
        registered,
      }),
    [schools, assessments, ownHensachi, origin, registered]
  );

  /**
   * 私立の志望校の判定。④の「志望校」の行と同じ関数（privateAdmissionBlock）を通し、
   * 表と根拠の行で判定が食い違わないようにする。
   */
  const privateJudgments = useMemo(() => {
    const cards = buildStudentReportCards(assessments);
    const region = schoolId ? regionOfSchool(schoolId) : null;
    const map = new Map<string, PrivateJudgmentCell>();
    for (const t of targetSchools) {
      if (!t.highSchoolId || !t.master) continue;
      const block = privateAdmissionBlock(t.master, cards, region, gender);
      if (!block) continue;
      map.set(t.highSchoolId, {
        heading: block.rule.examLabel,
        status: block.judgment.status,
        summary: block.judgment.summary,
      });
    }
    return map;
  }, [targetSchools, assessments, schoolId, gender]);

  const cards = useMemo(() => buildStudentReportCards(assessments), [assessments]);
  const privateRows = useMemo(
    () =>
      buildPrivateProposals({
        candidates: privates,
        cards,
        region: schoolId ? regionOfSchool(schoolId) : null,
        origin,
        registeredIds: new Set(registered.map((r) => r.highSchoolId)),
        gender,
      }),
    [privates, cards, schoolId, origin, registered, gender]
  );

  /**
   * 右で比べる材料。私立の提案に加え、登録済みの私立の志望校も押せば比べられるようにする
   * （志望校と併願の候補を並べて見たい、が一番多い使い方のため）。判定は④の「志望校」の行と同じ関数。
   */
  const compareById = useMemo(() => {
    const map = new Map<string, PrivateCompareItem>();
    for (const r of privateRows) map.set(r.school.id, r.compare);
    const region = schoolId ? regionOfSchool(schoolId) : null;
    for (const t of targetSchools) {
      if (!t.highSchoolId || !t.master) continue;
      const block = privateAdmissionBlock(t.master, cards, region, gender);
      if (!block) continue;
      const row = rows.find((r) => r.school.id === t.highSchoolId);
      map.set(
        t.highSchoolId,
        buildPrivateCompareItem({
          id: t.highSchoolId,
          school: { schoolName: t.master.schoolName, course: t.master.course },
          rule: block.rule,
          judgment: block.judgment,
          hensachiText: privateHensachiText(
            t.master.hensachi,
            t.master.hensachiByGender ?? {},
            gender
          ),
          commute: row?.commute ?? null,
        })
      );
    }
    return map;
  }, [privateRows, targetSchools, cards, schoolId, rows, gender]);

  return {
    rows,
    privateJudgments,
    privateRows,
    compareById,
    origin,
    ownHensachi,
    loading,
    error,
  };
}

function Gap({ diff }: { diff: number | null }) {
  const g = formatGap(diff);
  if (!g) return null;
  const cls =
    g.tone === 'short' ? 'text-danger' : g.tone === 'over' ? 'text-success' : 'text-text-muted';
  return <span className={`ml-1 ${cls}`}>{g.text}</span>;
}

/** 学校名（コースがあれば小さく添える） */
function schoolLabel(r: ProposalRow): string {
  return r.school.course ? `${r.school.schoolName}（${r.school.course}）` : r.school.schoolName;
}

/** 私立の差の色。★地図のピンの枠と同じ組み合わせ */
export const PRIVATE_BAND_TEXT: Record<PrivateBand, string> = {
  near: 'text-warning',
  even: 'text-info',
  over: 'text-success',
};
const PRIVATE_BAND_BORDER: Record<PrivateBand, string> = {
  near: 'border-l-warning',
  even: 'border-l-info',
  over: 'border-l-success',
};

export function TargetProposalTable({
  state,
  selectedId,
  onSelect,
  compareIds,
  onToggleCompare,
}: {
  state: TargetProposalsState;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** 右で比べている学校（押した順） */
  compareIds: readonly string[];
  /** 私立の行を押したとき。比べる列に足す／外す */
  onToggleCompare: (id: string) => void;
}) {
  const { rows, privateJudgments, privateRows, compareById, origin, ownHensachi, loading, error } =
    state;
  const press = (id: string) => {
    onSelect(id);
    if (compareById.has(id)) onToggleCompare(id);
  };
  if (loading) {
    return <p className="text-[12px] text-text-faint">志望校と提案を読み込み中…</p>;
  }
  if (error) {
    return <p className="text-[12px] text-text-faint">志望校と提案を読み込めませんでした</p>;
  }
  if (rows.length === 0 && privateRows.length === 0) {
    // ★何も出さないと「機能が無い」に見える。なぜ出ないかを1行で言う
    return (
      <p className="text-[12px] text-text-faint">
        {ownHensachi == null
          ? '模試の偏差値（5科）が入ると、近くの高校を挑戦・順当・安全に分けて出します'
          : origin == null
            ? '教室設定で最寄り駅を登録すると、近くの高校を挑戦・順当・安全に分けて出します'
            : '条件に合う高校が見つかりませんでした'}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[13px] font-bold text-text-heading">志望校と提案</span>
        <span className="text-[11px] text-text-muted">
          {ownHensachi != null ? `いまの偏差値${ownHensachi}から ／ ` : ''}行を押すと地図で位置
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-[10.5px] text-text-muted">
              <th className="whitespace-nowrap py-0.5 pr-2 font-normal" />
              <th className="whitespace-nowrap py-0.5 pr-3 font-normal">学校</th>
              <th className="whitespace-nowrap py-0.5 pr-3 font-normal">偏差値めやす</th>
              <th className="whitespace-nowrap py-0.5 pr-3 font-normal">内申めやす</th>
              <th className="whitespace-nowrap py-0.5 font-normal">
                {origin ? `${origin.name}から` : '通学'}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const selected = selectedId === r.school.id;
              return (
                <tr
                  key={r.school.id}
                  onClick={() => press(r.school.id)}
                  aria-selected={selected || compareIds.includes(r.school.id)}
                  className={`cursor-pointer border-b border-border-subtle hover:bg-surface-hover ${
                    selected || compareIds.includes(r.school.id) ? 'bg-surface-hover' : ''
                  }`}
                >
                  <td
                    className={`whitespace-nowrap border-l-[3px] py-1 pl-1.5 pr-2 text-[10.5px] font-bold ${
                      r.band
                        ? `${BAND_BORDER_CLASS[r.band]} ${BAND_TEXT_CLASS[r.band]}`
                        : 'border-l-border-strong text-text-muted'
                    }`}
                  >
                    {r.band ? PROPOSAL_BAND_LABEL[r.band] : '—'}
                  </td>
                  <td className="whitespace-nowrap py-1 pr-3">
                    <span className="font-bold text-text-heading">{schoolLabel(r)}</span>
                    {r.school.establishment && r.school.establishment !== '公立' && (
                      <span className="ml-1 text-[10.5px] text-text-muted">
                        {r.school.establishment}
                      </span>
                    )}
                    {r.rank != null && (
                      <span className="ml-1.5 rounded-full border border-text-heading px-1.5 text-[10px] text-text-heading">
                        第{r.rank}志望
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-1 pr-3 tabular-nums">
                    {r.school.hensachi ?? '—'}
                    <Gap diff={r.hensachiDiff} />
                  </td>
                  <td className="whitespace-nowrap py-1 pr-3 tabular-nums">
                    {(() => {
                      /**
                       * ★私立は内申の「めやす1つ」が無い（コース・入試区分ごとに条件がばらばら）。
                       *   代わりに代表の区分（既定は併願優遇（公私））の判定を出す。中身は根拠の
                       *   「推薦・併願の条件」で開く。
                       */
                      const j = privateJudgments.get(r.school.id);
                      if (j) {
                        return (
                          <span title={j.summary}>
                            <span className="text-text-muted">{j.heading} </span>
                            <span className={`font-bold ${JUDGMENT_TEXT_CLASS[j.status]}`}>
                              {ADMISSION_STATUS_LABEL[j.status]}
                            </span>
                          </span>
                        );
                      }
                      return (
                        <>
                          {r.school.naishin ?? '—'}
                          <Gap diff={r.naishinDiff} />
                        </>
                      );
                    })()}
                  </td>
                  <td className="py-1 text-text-muted">{r.commute ?? '—'}</td>
                </tr>
              );
            })}
            {privateRows.length > 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="border-b border-border pb-0.5 pt-2.5 text-[11px] font-bold text-text-heading"
                >
                  私立（併願優遇）
                  <span className="ml-1.5 font-normal text-text-muted">
                    内申の基準がいまの内申±1の学校。行を押すと右で基準を比べられる
                  </span>
                </td>
              </tr>
            )}
            {privateRows.map((r) => {
              const on = compareIds.includes(r.school.id) || selectedId === r.school.id;
              return (
                <tr
                  key={`pv-${r.school.id}`}
                  onClick={() => press(r.school.id)}
                  aria-selected={on}
                  data-private-proposal
                  className={`cursor-pointer border-b border-border-subtle hover:bg-surface-hover ${
                    on ? 'bg-surface-hover' : ''
                  }`}
                >
                  {/* ★私立は行頭の線を点線にして公立と見分ける */}
                  <td
                    className={`whitespace-nowrap border-l-[3px] border-dashed py-1 pl-1.5 pr-2 text-[10.5px] font-bold ${PRIVATE_BAND_BORDER[r.band]} ${PRIVATE_BAND_TEXT[r.band]}`}
                  >
                    {PRIVATE_BAND_LABEL[r.band]}
                  </td>
                  <td className="whitespace-nowrap py-1 pr-3">
                    <span className="font-bold text-text-heading">{r.school.schoolName}</span>
                    {r.school.course && (
                      <span className="ml-1 rounded border border-border-subtle px-1 text-[10px] text-text-muted">
                        {r.school.course}
                      </span>
                    )}
                    {r.genderType && r.genderType !== '共学' && (
                      <span className="ml-1 text-[10.5px] text-text-muted">{r.genderType}校</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-1 pr-3 tabular-nums">{r.hensachiText}</td>
                  <td className="py-1 pr-3">
                    <span className={`whitespace-nowrap font-bold ${PRIVATE_BAND_TEXT[r.band]}`}>
                      {r.judgmentText}
                    </span>
                    {r.chips.slice(0, 3).map((c) => (
                      <span
                        key={c}
                        className="ml-1 whitespace-nowrap rounded bg-surface-hover px-1 text-[10px] text-text-muted"
                      >
                        {c}
                      </span>
                    ))}
                  </td>
                  <td className="py-1 text-text-muted">{r.commute}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10.5px] leading-snug text-text-faint">
        挑戦＝偏差値あと3〜5／順当＝±2／安全＝3〜6余裕（普通科・直線15km以内から近い順に3校ずつ）。
        私立＝併願優遇の内申の基準がいまの内申±1（直線20km以内・差ごとに偏差値の高い順に3校まで）。
        自転車は直線距離からの目安
      </p>
    </div>
  );
}

/**
 * 勉強の仕方（教室長の引き出し）。AIが選んだ id の中身を studyTips.ts から出す。
 * ★AIが1件も選ばなかった・AIが使えない日は何も出さない（決まった2件で埋めると、
 *   この生徒に合わせて選んだものと見分けが付かなくなる）。
 */
export function StudyTipCards({ tips }: { tips: BriefStudyTip[] }) {
  const picked = tips
    .map((t) => ({ tip: studyTipById(t.id), reason: t.reason }))
    .filter((t): t is { tip: NonNullable<typeof t.tip>; reason: string } => Boolean(t.tip));
  if (picked.length === 0) return null;
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[13px] font-bold text-text-heading">勉強の仕方</span>
        <span className="text-[11px] text-text-muted">教室長の引き出しからAIが選んだもの</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {picked.map(({ tip, reason }) => (
          <div key={tip.id} className="flex flex-col rounded-lg border border-border px-3 py-2">
            <span className="text-[13px] font-bold text-text-heading">{tip.title}</span>
            <span className="mt-0.5 text-[11.5px] text-text-muted">こういう生徒に：{tip.who}</span>
            {reason && <span className="mt-0.5 text-[11.5px] text-info">選んだ理由：{reason}</span>}
            <span className="mt-1 text-[11px] font-bold text-text-heading">方法</span>
            <ol className="list-decimal pl-5 text-[12px] text-text-body">
              {tip.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <span className="mt-1 text-[11px] font-bold text-text-heading">効いたかの確かめ方</span>
            <span className="text-[12px] text-text-body">{tip.check}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 私立の基準を横に並べて比べる（右の列・地図の上）。押した順に右へ足し、3校まで。
 * ★2026-09-25 教室長「クリックで横にだそう、比較したいときもあるからね」。
 */
export function PrivateComparePanel({
  items,
  onRemove,
  onClear,
}: {
  items: PrivateCompareItem[];
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  if (items.length === 0) return null;
  const rows: { label: string; render: (p: PrivateCompareItem) => ReactNode }[] = [
    { label: '区分', render: (p) => p.heading },
    { label: '内申基準', render: (p) => p.criterion },
    { label: '本人', render: (p) => p.own },
    {
      label: '判定',
      render: (p) => <span className="font-bold text-text-heading">{p.judgment}</span>,
    },
    { label: '前提', render: (p) => (p.chips.length > 0 ? p.chips.join('／') : '—') },
    { label: '確かめる', render: (p) => (p.checks.length > 0 ? p.checks.join('／') : '—') },
    { label: '偏差値', render: (p) => p.hensachi },
    { label: '通学', render: (p) => p.commute ?? '—' },
  ];
  return (
    <div className="flex flex-col gap-1" data-private-compare>
      <div className="flex items-center">
        <span className="text-[10px] font-bold tracking-[0.14em] text-text-muted">
          基準を比べる
        </span>
        <button
          type="button"
          onClick={onClear}
          className="ml-auto rounded px-1 text-[11px] text-text-muted hover:bg-surface-hover"
        >
          すべて閉じる
        </button>
      </div>
      <table className="w-full table-fixed border-collapse text-[11.5px]">
        <thead>
          <tr className="border-b border-border">
            <th className="w-14" />
            {items.map((p) => (
              <th
                key={p.id}
                className="px-1 pb-0.5 text-left align-top font-bold text-text-heading"
              >
                <span className="flex items-start gap-1">
                  <span className="min-w-0 flex-1">
                    {p.name}
                    {p.course && (
                      <span className="block text-[10.5px] font-normal text-text-muted">
                        {p.course}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemove(p.id)}
                    aria-label={`${p.name}を比べるのをやめる`}
                    className="shrink-0 rounded text-text-muted hover:bg-surface-hover"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-border-subtle">
              <td className="py-1 pr-1 align-top text-[10.5px] text-text-muted">{r.label}</td>
              {items.map((p) => (
                <td
                  key={p.id}
                  className="break-words px-1 py-1 align-top leading-snug text-text-body"
                >
                  {r.render(p)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {items.some((p) => p.unverified || p.provisional) && (
        <span className="text-[10.5px] leading-snug text-text-faint">
          {items
            .flatMap((p) => [
              p.unverified ? `${p.name}の基準は原本と未照合` : null,
              p.provisional ? `${p.name}は${p.provisional}` : null,
            ])
            .filter(Boolean)
            .join('／')}
        </span>
      )}
    </div>
  );
}
