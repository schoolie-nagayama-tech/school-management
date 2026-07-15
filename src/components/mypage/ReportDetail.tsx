'use client';

import { useEffect } from 'react';
import { Award, BookOpen, Gauge, PencilLine, Quote, School, Target } from 'lucide-react';
import type { PortalReportDetail, PortalReportUnit } from '@/types/mypage-report';

/**
 * 授業報告書の詳細 — 保護者側（§7-4・UIモック セクション2）。
 *
 * 並び（モック準拠・変えないこと）:
 *   今日の目標／今月の目標 → 学習内容（教材×単元×ページ）＋学校の進度 →
 *   宿題の取り組み（3項目のバー） → テスト → 講師より（講評） → 次回までの宿題（日付ごと）
 *
 * ★ ここに出るのは限定公開ビューが返した列だけ:
 *   差し戻し理由・行動目標・承認者などの内部列はビューに存在しないので、
 *   この画面から参照しようとしても型・DBの両方で弾かれる。
 *
 * 空のセクションは出さない（講師が埋めなかった項目で画面が水増しされないように）。
 */
export function ReportDetail({ report }: { report: PortalReportDetail }) {
  // 開いた＝既読。未読だったときだけ叩く（§7-4「タップで既読」）。
  useEffect(() => {
    if (report.isRead) return;
    void fetch('/api/mypage/reports/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report_id: report.id }),
    }).catch(() => {
      /* 既読記録の失敗は致命的でないので無視 */
    });
  }, [report.id, report.isRead]);

  const hasGoals = !!(report.shortTermGoal || report.midTermGoal);
  const hasLearning = report.units.length > 0 || !!report.schoolProgress;
  const hasHomeworkMeters =
    report.homeworkCompletionPct != null ||
    report.homeworkCorrectPct != null ||
    report.todayCorrectPct != null;
  const hasTests =
    (report.vocabTestScore != null && report.vocabTestTotal != null) ||
    (report.checkTestScore != null && report.checkTestTotal != null);

  return (
    <div className="space-y-3">
      {/* 目標 */}
      {hasGoals && (
        <Section>
          {report.shortTermGoal && (
            <>
              <SectionTitle icon={<Target className="h-[13px] w-[13px]" />}>
                今日の目標
              </SectionTitle>
              <p className="text-sm text-text-body">{report.shortTermGoal}</p>
            </>
          )}
          {report.midTermGoal && (
            <>
              <SectionTitle
                icon={<Target className="h-[13px] w-[13px]" />}
                className={report.shortTermGoal ? 'mt-3' : undefined}
              >
                今月の目標
              </SectionTitle>
              <p className="text-sm text-text-body">{report.midTermGoal}</p>
            </>
          )}
        </Section>
      )}

      {/* 学習内容・学校の進度 */}
      {hasLearning && (
        <Section>
          {report.units.length > 0 && (
            <>
              <SectionTitle icon={<BookOpen className="h-[13px] w-[13px]" />}>
                学習内容
              </SectionTitle>
              <ul className="space-y-1.5">
                {report.units.map((u) => (
                  <li key={u.id}>
                    <UnitRow unit={u} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {report.schoolProgress && (
            <>
              <SectionTitle
                icon={<School className="h-[13px] w-[13px]" />}
                className={report.units.length > 0 ? 'mt-3' : undefined}
              >
                学校の進度
              </SectionTitle>
              <p className="text-sm text-text-body">{report.schoolProgress}</p>
            </>
          )}
        </Section>
      )}

      {/* 宿題の取り組み（3項目のバー） */}
      {hasHomeworkMeters && (
        <Section>
          <SectionTitle icon={<Gauge className="h-[13px] w-[13px]" />}>宿題の取り組み</SectionTitle>
          <Meter label="やってきた量" value={report.homeworkCompletionPct} />
          <Meter label="宿題の正答率" value={report.homeworkCorrectPct} />
          <Meter label="今日の演習の正答率" value={report.todayCorrectPct} last />
        </Section>
      )}

      {/* テスト */}
      {hasTests && (
        <Section>
          <SectionTitle icon={<Award className="h-[13px] w-[13px]" />}>テスト</SectionTitle>
          <div className="flex flex-wrap gap-2">
            <TestCard
              name="英単語テスト"
              score={report.vocabTestScore}
              total={report.vocabTestTotal}
              passed={report.vocabTestPassed}
            />
            <TestCard
              name="確認テスト"
              score={report.checkTestScore}
              total={report.checkTestTotal}
              passed={report.checkTestPassed}
            />
          </div>
        </Section>
      )}

      {/* 講師より（講評） */}
      {report.reviewComment && (
        <Section>
          <SectionTitle icon={<Quote className="h-[13px] w-[13px]" />}>講師より</SectionTitle>
          {/* 講評は改行を保って表示（講師が段落を分けて書くため）。 */}
          <p className="whitespace-pre-wrap text-sm leading-7 text-text-body">
            {report.reviewComment}
          </p>
        </Section>
      )}

      {/* 次回までの宿題（日付ごと） */}
      {report.homeworkAssignments.length > 0 && (
        <Section>
          <SectionTitle icon={<PencilLine className="h-[13px] w-[13px]" />}>
            次回までの宿題
          </SectionTitle>
          <ul>
            {report.homeworkAssignments.map((h, i) => (
              <li
                key={`${h.date ?? 'nodate'}-${i}`}
                className="flex items-start gap-2 border-b border-dashed border-border-subtle py-1.5 last:border-b-0 last:pb-0"
              >
                {h.date && (
                  <span className="mt-[1px] flex-none rounded-md bg-primary-subtle px-1.5 py-0.5 text-[10.5px] font-bold text-primary-dark">
                    {formatShortDate(h.date)}
                  </span>
                )}
                <span className="text-xs text-text-body">{h.text}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

/** カード（モックの .dsec）。 */
function Section({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border-subtle bg-surface-raised px-3.5 py-3">
      {children}
    </section>
  );
}

/** セクション見出し（アイコン＋ラベル）。 */
function SectionTitle({
  icon,
  children,
  className,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={`mb-1.5 flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-text-muted ${className ?? ''}`}
    >
      {icon}
      {children}
    </h2>
  );
}

/** 学習内容1行（メインバッジ／教材名／ページ・単元）。 */
function UnitRow({ unit }: { unit: PortalReportUnit }) {
  const pages = formatPages(unit.pageStart, unit.pageEnd);
  const detail = [pages, unit.unitTitles.join('・')].filter(Boolean).join(' ・ ');
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      {unit.isMain && (
        <span className="rounded-full bg-primary-subtle px-1.5 py-[1px] text-[9px] font-bold text-primary-dark">
          メイン
        </span>
      )}
      <span className="text-[12.5px] font-semibold text-text-heading">
        {unit.textbookName ?? '教材'}
      </span>
      {detail && <span className="text-[11px] tabular-nums text-text-muted">{detail}</span>}
    </div>
  );
}

/** 宿題の取り組みのバー1本。値が無ければ何も出さない。 */
function Meter({ label, value, last }: { label: string; value: number | null; last?: boolean }) {
  if (value == null) return null;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={last ? '' : 'mb-2'}>
      <div className="mb-0.5 flex justify-between text-[11.5px] text-text-muted">
        <span>{label}</span>
        <b className="tabular-nums text-text-heading">{value}%</b>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-hover"
        role="img"
        aria-label={`${label} ${value}%`}
      >
        <div className="h-full rounded-full bg-ink" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** テストカード1枚。点数が無ければ出さない。 */
function TestCard({
  name,
  score,
  total,
  passed,
}: {
  name: string;
  score: number | null;
  total: number | null;
  passed: boolean | null;
}) {
  if (score == null || total == null) return null;
  return (
    <div className="min-w-[120px] flex-1 rounded-lg border border-border-subtle px-2.5 py-2">
      <p className="text-[10.5px] text-text-muted">{name}</p>
      <p className="flex items-baseline gap-1 text-[15px] font-bold tabular-nums text-text-heading">
        {score}
        <small className="text-[11px] font-medium text-text-muted">/ {total}</small>
        {passed != null && (
          <span
            className={`rounded-full px-2 py-[1.5px] text-[9.5px] font-bold ${
              passed ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning'
            }`}
          >
            {passed ? '合格' : '不合格'}
          </span>
        )}
      </p>
    </div>
  );
}

/** 'p.54–58' / 'p.12'。両方無ければ空文字。 */
function formatPages(start: number | null, end: number | null): string {
  if (start == null && end == null) return '';
  if (start != null && end != null && start !== end) return `p.${start}–${end}`;
  return `p.${start ?? end}`;
}

/** 'YYYY-MM-DD' → '7/16'。 */
function formatShortDate(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  if (!m || !d) return date;
  return `${m}/${d}`;
}
