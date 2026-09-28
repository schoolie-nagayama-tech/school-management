'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMasterData } from '@/contexts/MasterDataContext';
import { getStudentScheduleEntries } from '@/lib/api/schedule';
import { getKoushuEnrollmentsByStudent, type KoushuEnrollment } from '@/lib/api/seasonalCourses';
import {
  getSeasonalProposalSummaryByStudent,
  type SeasonalProposalSeasonSummary,
} from '@/lib/api/seasonalProposalSummary';
import { koushuFiscalYear, mergeKoushuSeasons } from '@/app/interview/interview.shared';
import { whenNetworkIdle } from '@/lib/utils/networkIdle';
import type { ScheduleEntry } from '@/types/schedule';
import { HubSection } from './HubSection';
import { V2Tag } from './V2Tag';
import {
  useHubAssessments,
  useHubDisciplineSessions,
  useHubInterviews,
  useHubProgress,
} from './HubDataContext';
import { toDateStr } from './hubSummary';
import {
  buildDisciplineMetric,
  buildKoushuMetric,
  buildLastInterviewMetric,
  buildNextLessonMetric,
  buildProgressMetric,
  buildRecentTestMetric,
  type HubStatusMetric,
} from './hubStatus';

/**
 * 次回授業を探す範囲（今日から何日先まで）。
 * ★生徒で絞った取得でも範囲を切らないと行数が伸び続ける（未ページングの .select() は1000行で静かに切れる）。
 *   通常授業は週1〜3回なので、長期休みや講習の切れ目をまたいでも60日あれば次回は見つかる。
 */
const NEXT_LESSON_RANGE_DAYS = 60;

/**
 * 今の状態（上部の左カラムの先頭）。6つの指標を3列×2段で出す。
 *
 * 正典: docs/student-hub-plan.md §3 ／ 見た目: public/student-hub-mock.html の「今の状態」
 * ★カード1枚の中を罫線で区切るだけにし、中にカードを作らない（モックの方針）。
 * ★色は対応が要るものだけ（進行表の停滞している科目の行の黄）。赤は使わない（赤は「注意すること」のアラートが担う）。
 * ★各指標は下の該当セクションへのページ内リンク。数字の中身は下のセクションで確かめる。
 *
 * 取得（2回取らない）:
 * - 成績・面談記録・宿題遅刻・進行表は、下のセクションと1回の取得を共有する（HubDataContext）。
 *   進行表は重いので whenNetworkIdle の後に取り始める。
 * - 授業予定は、予定表の部品（StudentScheduleCalendar）が表示中の月だけを自分で取るので共有しない。
 *   ここでは今日から60日先までに絞って取る。
 * - 講習は、面談の受講の枠と同じ材料（提案書の期のまとめ getSeasonalProposalSummaryByStudent ＋
 *   koushu_enrollments）を取り、同じ mergeKoushuSeasons で期ごとにまとめる。
 *   ★講習欄の StudentKoushuTab とは共有しない。あちらは提案書を1件ずつ（テキスト・テーマ・状態）出す部品で、
 *     別の関数（getProposalsByStudent）で行そのものを取る。ここで要るのは期ごとの科目×コマの合計で、
 *     面談と同じ数字にするには面談と同じ関数で取るほうが確か。
 *   ページ上部の取得が捌けてから取る（講習は急いで見るものではない）。
 */
export function StatusSection({ studentId }: { studentId: string }) {
  // 「今」は開いた時点で固定する（描画のたびに変わると、次回授業が動いて見えるため）
  const [now] = useState(() => new Date());
  const { subjects } = useMasterData();
  // 科目名は全体で読み込み済みのマスタから引く（予定表の部品のように getSubjects を取り直さない）
  const subjectNames = useMemo(
    () => new Map(subjects.map((s): [string, string] => [s.id, s.name])),
    [subjects]
  );

  const { assessments, loading: scoresLoading } = useHubAssessments();
  const { interviews, loading: interviewsLoading, failed: interviewsFailed } = useHubInterviews();
  const { sessions, loading: disciplineLoading } = useHubDisciplineSessions();
  const { progress, loading: progressLoading } = useHubProgress(true);

  const [entries, setEntries] = useState<ScheduleEntry[] | null>(null);
  const [entriesFailed, setEntriesFailed] = useState(false);
  const [koushu, setKoushu] = useState<{
    summaries: SeasonalProposalSeasonSummary[];
    enrollments: KoushuEnrollment[];
  } | null>(null);
  const [koushuFailed, setKoushuFailed] = useState(false);
  // 年度は4月始まり（1〜3月は前年度）。面談の受講の枠と同じ規則
  const fiscalYear = koushuFiscalYear(now);

  useEffect(() => {
    let cancelled = false;
    const to = new Date(now);
    to.setDate(to.getDate() + NEXT_LESSON_RANGE_DAYS);
    // ★教室で絞らない関数。他教室の振替・講習もその生徒の授業（#196 の判断）
    getStudentScheduleEntries(studentId, toDateStr(now), toDateStr(to))
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch(() => {
        if (cancelled) return;
        setEntriesFailed(true);
        setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId, now]);

  useEffect(() => {
    let cancelled = false;
    void whenNetworkIdle().then(() => {
      if (cancelled) return;
      // 取り方は面談（InterviewWorkspace）と同じ。受講の枠と同じ数字にするため
      Promise.all([
        getSeasonalProposalSummaryByStudent(studentId),
        getKoushuEnrollmentsByStudent(studentId),
      ])
        .then(([summaries, enrollments]) => {
          if (!cancelled) setKoushu({ summaries, enrollments });
        })
        .catch(() => {
          if (cancelled) return;
          setKoushuFailed(true);
          setKoushu({ summaries: [], enrollments: [] });
        });
    });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  const failed: HubStatusMetric = { value: null, sub: ['読み込めませんでした'], tone: 'neutral' };

  const nextLesson =
    entries === null
      ? null
      : entriesFailed
        ? failed
        : buildNextLessonMetric(entries, now, subjectNames, NEXT_LESSON_RANGE_DAYS);
  const recentTest = scoresLoading ? null : buildRecentTestMetric(assessments);
  const lastInterview = interviewsLoading
    ? null
    : interviewsFailed
      ? failed
      : buildLastInterviewMetric(interviews);
  const discipline = disciplineLoading ? null : buildDisciplineMetric(sessions, now);
  const progressMetric = progressLoading ? null : buildProgressMetric(progress.textbookData);
  // koushu_enrollments の科目は id で入っているので、名前は全体のマスタから引く（面談と同じ）
  const koushuMetric =
    koushu === null
      ? null
      : koushuFailed
        ? failed
        : buildKoushuMetric(
            mergeKoushuSeasons(
              koushu.summaries,
              koushu.enrollments,
              Object.fromEntries(subjectNames)
            ),
            fiscalYear
          );

  return (
    <HubSection
      id="sec-status"
      title="今の状態"
      extra={<span className="text-xs text-text-muted">{toDateStr(now)} 時点</span>}
      flush
    >
      {/* 罫線は gap-px ＋ 背景色で引く。列数が変わっても（3列→2列→1列）縦横の罫線が崩れない */}
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-b-[10px] bg-border-subtle min-[420px]:grid-cols-2 min-[640px]:grid-cols-3">
        <Tile
          href="#sec-schedule"
          label={
            <>
              次回授業
              {/* 座席表（schedule_entries）由来なので、座席表の運用が始まる2月までは当てにならない */}
              <V2Tag />
            </>
          }
          metric={nextLesson}
        />
        <Tile href="#sec-scores" label="直近のテスト" metric={recentTest} />
        <Tile href="#sec-interview" label="前回の面談" metric={lastInterview} />
        <Tile href="#sec-discipline" label="今月の宿題・遅刻" metric={discipline} />
        <Tile href="#sec-progress" label="進行表" metric={progressMetric} />
        <Tile href="#sec-koushu" label="講習" metric={koushuMetric} />
      </div>
    </HubSection>
  );
}

/** 指標1つ。metric=null は読み込み中 */
function Tile({
  href,
  label,
  metric,
}: {
  href: string;
  label: ReactNode;
  metric: HubStatusMetric | null;
}) {
  const valueColor =
    metric?.tone === 'warning'
      ? 'text-warning'
      : metric?.value == null
        ? 'text-text-faint'
        : 'text-text-heading';
  // 数字は大きい等幅（桁が揃う）、文（「冬期講習」「宿題 3回・遅刻 1回」）は一段小さい本文書体
  const valueSize =
    metric && metric.value != null && metric.textValue
      ? 'text-[17px] font-sans'
      : 'text-[22px] font-mono';

  return (
    <a
      href={href}
      className="block min-w-0 bg-surface px-3 py-2.5 text-inherit no-underline hover:bg-surface-hover"
    >
      <div className="flex items-center gap-1.5 text-xs text-text-muted">{label}</div>
      {metric === null ? (
        <div className="mt-px text-[22px] leading-[1.35] text-text-faint" aria-busy="true">
          …
        </div>
      ) : (
        <>
          {metric.rows && metric.rows.length > 0 ? (
            // 進行表の科目ごとの行。1行が長い（科目・テキスト名・単元）ので、大きな数字の代わりに本文の大きさで並べる
            <ul className="mt-0.5 space-y-0.5">
              {metric.rows.map((row, i) => (
                <li
                  key={i}
                  className={`text-[13px] font-medium leading-snug [overflow-wrap:anywhere] ${
                    row.tone === 'warning' ? 'text-warning' : 'text-text-heading'
                  }`}
                >
                  {row.text}
                  {row.note && <span className="ml-1.5 text-[11px] font-bold">{row.note}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <div
              className={`mt-px font-bold leading-[1.35] tabular-nums [overflow-wrap:anywhere] ${valueSize} ${valueColor}`}
            >
              {metric.value ?? '—'}
            </div>
          )}
          {metric.sub.map((line, i) => (
            <div key={i} className="mt-px text-xs text-text-faint [overflow-wrap:anywhere]">
              {line}
            </div>
          ))}
          {/* 別の話題の行（模試）。上の定期テストの補足と続けて読まないよう、少し間を空ける */}
          {metric.secondary && metric.secondary.length > 0 && (
            <div className="mt-1.5">
              {metric.secondary.map((line, i) => (
                <div
                  key={i}
                  className={`text-xs [overflow-wrap:anywhere] ${
                    i === 0 ? 'font-medium text-text-body' : 'mt-px text-text-faint'
                  }`}
                >
                  {line}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </a>
  );
}
