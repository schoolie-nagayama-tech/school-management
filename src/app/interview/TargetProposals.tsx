'use client';

/**
 * ④現状の確認「志望校と提案」（左＝表）と「勉強の仕方」のカード。地図は TargetSchoolMap.tsx（右）。
 *
 * ★1校1行の表にする（2026-09-25 教室長レビュー「もっとコンパクトに」）。区分（挑戦・順当・安全）は
 *   行頭の色と文字で見せ、差は「あと4」「3余裕」と面談でそのまま読める形で出す。
 *   行を押すと右の地図がその学校に寄る。
 * ★区分の決め方・通学の目安の出し方は src/lib/interview/targetProposals.ts の注記。
 */
import { useEffect, useMemo, useState } from 'react';
import type { AssessmentWithScores } from '@/types/database';
import type { TargetSchoolRow } from '@/lib/api/targetSchools';
import { getClassroomOrigin, getProposalSchools } from '@/lib/api/targetProposals';
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
import { latestOwnHensachi, latestOwnKanagawaNaishin, latestOwnNaishin } from './interview.shared';

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
  assessments: AssessmentWithScores[]
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

  return { rows, origin, ownHensachi, loading, error };
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

export function TargetProposalTable({
  state,
  selectedId,
  onSelect,
}: {
  state: TargetProposalsState;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { rows, origin, ownHensachi, loading, error } = state;
  if (loading) {
    return <p className="text-[12px] text-text-faint">志望校と提案を読み込み中…</p>;
  }
  if (error) {
    return <p className="text-[12px] text-text-faint">志望校と提案を読み込めませんでした</p>;
  }
  if (rows.length === 0) {
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
                  onClick={() => onSelect(r.school.id)}
                  aria-selected={selected}
                  className={`cursor-pointer border-b border-border-subtle hover:bg-surface-hover ${
                    selected ? 'bg-surface-hover' : ''
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
                    {r.school.naishin ?? '—'}
                    <Gap diff={r.naishinDiff} />
                  </td>
                  <td className="py-1 text-text-muted">{r.commute ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10.5px] leading-snug text-text-faint">
        挑戦＝偏差値あと3〜5／順当＝±2／安全＝3〜6余裕（普通科・直線15km以内から近い順に3校ずつ）。
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
