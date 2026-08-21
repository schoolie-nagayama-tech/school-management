'use client';

import { useEffect } from 'react';
import {
  AlertTriangle,
  Award,
  BookOpen,
  Gauge,
  PencilLine,
  Quote,
  Repeat,
  School,
  SkipForward,
  Target,
} from 'lucide-react';
import type {
  PortalReportDetail,
  PortalReportUnit,
  PortalSubjectSpecific,
} from '@/types/mypage-report';

/**
 * 授業報告書の詳細 — 保護者側（§7-4・UIモック セクション2）。
 *
 * 並び（モック準拠・変えないこと。モックに無い項目は講師フォームの公開ゾーンの並びに合わせる）:
 *   今日の目標／試験目標 → 学習内容（教材×単元×ページ）＋学校の進度＋プリント等の教材 →
 *   本日の様子（遅刻／宿題未実施マーク） → 次回の予定 → 宿題の取り組み（3項目のバー） →
 *   テスト → 講師より（講評） → 次回までの宿題（日付ごと） →
 *   科目別欄（単語・計算・漢字の反復練習）
 *
 * ★ ここに出るのは限定公開ビューが返した列だけ:
 *   差し戻し理由・行動目標・承認者などの内部列はビューに存在しないので、
 *   この画面から参照しようとしても型・DBの両方で弾かれる。
 *
 * 空のセクションは出さない（講師が埋めなかった項目で画面が水増しされないように）。
 */

/**
 * 科目別欄の kind → 表示ラベル。講師フォームの SubjectSpecificField（種別セレクト）と
 * 一言一句合わせる（ここだけ別の呼び方をすると保護者と講師で話が噛み合わなくなる）。
 * sample/page.tsx の「保護者の見え方」タブでも同じ表記を使う。
 */
export const SUBJECT_SPECIFIC_KIND_LABELS: Record<
  Exclude<PortalSubjectSpecific['kind'], 'none'>,
  string
> = {
  vocab: '英語：単語練習',
  calc: '数学：計算練習',
  kanji: '国語：漢字練習',
};

/**
 * @param preview 講師の「保護者の見え方」プレビューから描くとき true。
 *   既読APIを叩かない（講師が開いただけで保護者が読んだことになってしまうため）。
 *   既定 false なので、保護者側の呼び出し（app/mypage/reports/[reportId]）は無変更で従来どおり。
 */
export function ReportDetail({
  report,
  preview = false,
}: {
  report: PortalReportDetail;
  preview?: boolean;
}) {
  // 開いた＝既読。未読だったときだけ叩く（§7-4「タップで既読」）。
  useEffect(() => {
    if (preview) return;
    if (report.isRead) return;
    void fetch('/api/mypage/reports/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report_id: report.id }),
    }).catch(() => {
      /* 既読記録の失敗は致命的でないので無視 */
    });
  }, [report.id, report.isRead, preview]);

  const hasGoals = !!(report.shortTermGoal || report.midTermGoal);
  const extraMaterials = report.subjectSpecific?.extraMaterials ?? null;
  const hasLearning = report.units.length > 0 || !!report.schoolProgress || !!extraMaterials;
  const hasHomeworkMeters =
    report.homeworkCompletionPct != null ||
    report.homeworkCorrectPct != null ||
    report.todayCorrectPct != null;
  // テストは確認テストの1本のみ（英単語テストは廃止）。理由は types/mypage-report.ts の注記。
  const hasTests = report.checkTestScore != null && report.checkTestTotal != null;
  // 科目別欄（単語・計算・漢字の反復練習）。kind='none' はデータ無し扱いなので出さない。
  const hasSubjectPractice = !!report.subjectSpecific && report.subjectSpecific.kind !== 'none';
  // 本日の様子: 該当したときだけ出す。両方 false なら「遅刻していません」を書くことになり
  // 情報量ゼロで画面を水増しするだけなので、セクションごと出さない。
  const hasMarks = report.tardy || report.homeworkNotDone;

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
                試験目標
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
          {extraMaterials && (
            <>
              <SectionTitle
                icon={<PencilLine className="h-[13px] w-[13px]" />}
                className={report.units.length > 0 || report.schoolProgress ? 'mt-3' : undefined}
              >
                プリント・テキスト外の教材
              </SectionTitle>
              <p className="text-sm text-text-body">{extraMaterials}</p>
            </>
          )}
        </Section>
      )}

      {/* 本日の様子（遅刻／宿題未実施）。講師フォームの公開ゾーンと同じ位置・同じ呼び方。 */}
      {hasMarks && (
        <Section>
          <SectionTitle icon={<AlertTriangle className="h-[13px] w-[13px]" />}>
            本日の様子
          </SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {report.tardy && <MarkPill label="遅刻" />}
            {report.homeworkNotDone && <MarkPill label="宿題未実施" />}
          </div>
        </Section>
      )}

      {/* 次回の予定（機能D）。講師が決めていなければセクションごと出さない。
          375px 幅前提: 教材名は小さく上に、単元名を主役にして折り返す。 */}
      {report.nextPlan.length > 0 && (
        <Section>
          <SectionTitle icon={<SkipForward className="h-[13px] w-[13px]" />}>
            次回の予定
          </SectionTitle>
          <ul className="space-y-1.5">
            {report.nextPlan.map((plan, i) => (
              <li key={`${plan.textbookName ?? 'tb'}-${i}`}>
                {/* 教材が1つのときは教材名を出さない（保護者にとっては単元名が本題） */}
                {report.nextPlan.length > 1 && plan.textbookName && (
                  <p className="text-[10.5px] text-text-muted">{plan.textbookName}</p>
                )}
                <p className="text-sm text-text-body">{plan.unitTitles.join('・')}</p>
              </li>
            ))}
          </ul>
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

      {/* 科目別欄（単語・計算・漢字の反復練習）。講師フォームでは公開ゾーンの末尾にあるので合わせる。 */}
      {hasSubjectPractice && report.subjectSpecific && (
        <Section>
          <SectionTitle icon={<Repeat className="h-[13px] w-[13px]" />}>
            {
              SUBJECT_SPECIFIC_KIND_LABELS[
                report.subjectSpecific.kind as Exclude<PortalSubjectSpecific['kind'], 'none'>
              ]
            }
          </SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            <SubjectField label="練習範囲" value={report.subjectSpecific.range} />
            <SubjectField
              label="ページ"
              value={report.subjectSpecific.pages ? `p.${report.subjectSpecific.pages}` : null}
            />
            <SubjectField
              label="1日の練習回数"
              value={
                report.subjectSpecific.timesPerDay != null
                  ? `${report.subjectSpecific.timesPerDay}回`
                  : null
              }
            />
            <SubjectField label="期間" value={report.subjectSpecific.duration} />
          </div>
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

/**
 * 本日の様子のピル1つ（遅刻／宿題未実施）。
 * 講師フォームのトグルピルと同じ warning 系の色にして、講師が押したものがそのまま
 * 保護者に見えていることを両者の画面で一致させる。
 */
function MarkPill({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-warning-subtle px-2.5 py-1 text-[11.5px] font-bold text-warning">
      {label}
    </span>
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

/** 科目別欄の1項目（ラベル＋値）。値が無ければ出さない。 */
function SubjectField({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[10.5px] text-text-muted">{label}</p>
      <p className="text-sm font-semibold text-text-body">{value}</p>
    </div>
  );
}

/**
 * 'YYYY-MM-DD' → '7/16(木)'。
 * 講師フォームの formatDateLabel（app/lesson-reports/[scheduleEntryId]/page.tsx）と
 * 表記を合わせる（曜日なしだと講師とのやり取りで日付を指しにくいという指摘があった）。
 */
function formatShortDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${w})`;
}
