'use client';

/**
 * 面談④の右: 私立・国立の志望校の「推薦・併願優遇の条件」を、本人の通知表に当てて見せる。
 * ------------------------------------------------------------------
 * 正典: docs/private-high-school-master.md ／ モック: docs/mockups/private-school-judgment.html
 *
 * ④の「志望校」の行には代表の区分（既定は併願優遇（公私））の判定を1行で出している
 * （interview.shared.ts の privateAdmissionBlock）。ここはその中身。
 * ★どの条件のどこが足りないか・何を面談で確かめるか・冊子の原文を並べる。判定だけ見せて
 *   理由を隠すと、保護者に「なぜ届かないのか」を説明できない。
 * ★学校ごとに畳んで出す。④の右は他の材料（模試・テスト対策）も並ぶので、開いたままだと埋まる。
 */

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { TargetSchoolRow } from '@/lib/api/targetSchools';
import type { Region } from '@/lib/interview/region';
import {
  ADMISSION_STATUS_LABEL,
  evaluateRule,
  pickPrimaryRule,
  provisionalNote,
  ruleHeading,
  scopeApplies,
  type AdmissionJudgment,
  type AdmissionRule,
  type AdmissionStatus,
  type ClauseResult,
  type StudentReportCards,
} from '@/lib/interview/privateAdmission';

/** 判定の色。★意味の色（良い・注意・不可）だけを使い、アクセント色は使わない */
const STATUS_CLASS: Record<AdmissionStatus, string> = {
  ok: 'bg-success-subtle text-success',
  ok_with_bonus: 'bg-success-subtle text-success',
  conditional: 'bg-info-subtle text-info',
  bonus: 'bg-info-subtle text-info',
  short: 'bg-warning-subtle text-warning',
  ng: 'bg-danger-subtle text-danger',
  na: 'bg-surface-hover text-text-muted',
  nodata: 'bg-surface-hover text-text-muted',
};

function StatusChip({ status }: { status: AdmissionStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_CLASS[status]}`}
    >
      {ADMISSION_STATUS_LABEL[status]}
    </span>
  );
}

function clauseTail(c: ClauseResult): string {
  switch (c.state) {
    case 'met':
      return c.have != null ? `本人 ${c.have}` : '満たす';
    case 'short':
      return `本人 ${c.have} → あと ${c.gap}`;
    case 'fail':
      return c.reason ?? '満たさない';
    case 'nodata':
      return '評定が未入力';
    case 'cert':
      return '検定はNESTに無い。面談で聞く';
    case 'manual':
      return '面談で確かめる';
  }
}

const CLAUSE_MARK: Record<ClauseResult['state'], { text: string; className: string }> = {
  met: { text: '満たす', className: 'text-success' },
  short: { text: '不足', className: 'text-warning' },
  fail: { text: '不可', className: 'text-danger' },
  nodata: { text: '未入力', className: 'text-text-muted' },
  cert: { text: '要確認', className: 'text-info' },
  manual: { text: '要確認', className: 'text-info' },
};

function ClauseRow({ c }: { c: ClauseResult }) {
  const mark = CLAUSE_MARK[c.state];
  return (
    <div className="flex items-baseline gap-2 text-[12px] leading-snug">
      <span className={`w-10 shrink-0 font-bold ${mark.className}`}>{mark.text}</span>
      <span className="text-text-heading">{c.label}</span>
      <span className="text-text-muted">（{clauseTail(c)}）</span>
    </div>
  );
}

const ALT_MARKS = ['①', '②', '③', '④', '⑤', '⑥'];

function RuleBody({ rule, judgment }: { rule: AdmissionRule; judgment: AdmissionJudgment }) {
  const prov = provisionalNote(judgment.provisional);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-start gap-2">
        <StatusChip status={judgment.status} />
        <span className="text-[12.5px] leading-snug text-text-heading">{judgment.summary}</span>
      </div>
      {prov && judgment.status !== 'na' && <p className="text-[11.5px] text-text-muted">{prov}</p>}

      {judgment.alternatives.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-[11px] text-text-muted">
            {judgment.alternatives.length > 1 ? 'いずれかを満たせばよい' : '基準'}
            {rule.strength ? `（数値は${rule.strength}）` : ''}
          </p>
          {judgment.alternatives.map((alt, i) => (
            <div
              key={i}
              className={`flex gap-2 rounded-md border px-2 py-1.5 ${
                alt.met ? 'border-success bg-success-subtle' : 'border-border'
              }`}
            >
              {judgment.alternatives.length > 1 && (
                <span className="text-[12px] font-bold text-text-muted">
                  {ALT_MARKS[i] ?? '・'}
                </span>
              )}
              <div className="flex flex-col gap-0.5">
                {alt.clauses.map((c, j) => (
                  <ClauseRow key={j} c={c} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {judgment.gates.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <p className="text-[11px] text-text-muted">出願の前提（満たさないと不可）</p>
          {judgment.gates.map((g, i) => (
            <ClauseRow key={i} c={g} />
          ))}
        </div>
      )}

      {judgment.bonuses.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <p className="text-[11px] text-text-muted">
            内申への加点{judgment.bonusMax != null ? `（最大 +${judgment.bonusMax}）` : ''}
          </p>
          {judgment.bonuses.map((b, i) => (
            <div key={i} className="flex items-baseline gap-2 text-[12px] leading-snug">
              <span className="w-10 shrink-0 font-bold text-info">
                {b.points > 0 ? `+${b.points}` : '+?'}
              </span>
              <span className="text-text-body">{b.label}</span>
              <span className="text-text-muted">
                （
                {b.state === 'auto'
                  ? '本人の評定で満たす'
                  : b.state === 'unmet'
                    ? '該当しない'
                    : '面談で聞く'}
                ）
              </span>
            </div>
          ))}
        </div>
      )}

      {judgment.checks.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <p className="text-[11px] text-text-muted">面談で確かめること</p>
          <ul className="flex flex-col gap-0.5">
            {judgment.checks.map((c, i) => (
              <li key={i} className="text-[12px] leading-snug text-text-body">
                ・{c}
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="text-[11.5px]">
        <summary className="cursor-pointer text-text-muted">冊子の原文</summary>
        <pre className="mt-1 whitespace-pre-wrap rounded-md bg-surface-hover px-2 py-1.5 font-sans text-[11.5px] leading-relaxed text-text-body">
          {rule.rawText}
        </pre>
      </details>
      <p className="text-[11px] text-text-faint">
        出典: {rule.sourceLabel}
        {rule.verifiedAt == null && '（紙の原本と未照合。AIの書き起こしのまま）'}
      </p>
    </div>
  );
}

function SchoolBlock({
  target,
  cards,
  region,
}: {
  target: TargetSchoolRow;
  cards: StudentReportCards;
  region: Region | null;
}) {
  const master = target.master;
  const rules = (master?.admissionRules ?? []).filter((r) =>
    scopeApplies(r.applicantScope, region)
  );
  const primary = master ? pickPrimaryRule(master.admissionRules ?? [], region) : null;
  const [selectedId, setSelectedId] = useState<string | null>(primary?.id ?? null);
  if (!master || rules.length === 0) return null;

  const selected = rules.find((r) => r.id === selectedId) ?? primary ?? rules[0];
  const judgment = evaluateRule(selected, cards);
  const hiddenCount = (master.admissionRules?.length ?? 0) - rules.length;
  const name = `${master.schoolName}${master.course ? `（${master.course}）` : ''}`;

  return (
    <details className="group rounded-md border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-[12.5px]">
        <ChevronRight
          className="h-3.5 w-3.5 shrink-0 text-text-muted transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        <span className="font-bold text-text-heading">
          第{target.rank} {name}
        </span>
        <span className="text-text-muted">推薦・併願の条件</span>
      </summary>
      <div className="flex flex-col gap-2.5 border-t border-border px-2.5 py-2">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="入試区分">
          {rules.map((r) => {
            const active = r.id === selected.id;
            return (
              <button
                key={r.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSelectedId(r.id)}
                className={`rounded-md border px-2 py-0.5 text-[11.5px] transition-colors ${
                  active
                    ? 'border-text-heading bg-text-heading text-surface'
                    : 'border-border text-text-body hover:bg-surface-hover'
                }`}
              >
                {ruleHeading(r)}
              </button>
            );
          })}
        </div>
        <RuleBody rule={selected} judgment={judgment} />
        {hiddenCount > 0 && (
          <p className="text-[11px] text-text-faint">
            他県生向けの区分（{hiddenCount}件）は、この教室の生徒は受けられないので出していない
          </p>
        )}
      </div>
    </details>
  );
}

interface Props {
  targetSchools: readonly TargetSchoolRow[];
  cards: StudentReportCards;
  region: Region | null;
}

/** 志望校のうち、推薦・併願優遇の基準を持つ学校（私立・国立）だけを並べる。無ければ何も出さない */
export function PrivateAdmissionDetails({ targetSchools, cards, region }: Props) {
  const withRules = targetSchools.filter((t) => (t.master?.admissionRules?.length ?? 0) > 0);
  if (withRules.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {withRules.map((t) => (
        <SchoolBlock key={t.id} target={t} cards={cards} region={region} />
      ))}
    </div>
  );
}
