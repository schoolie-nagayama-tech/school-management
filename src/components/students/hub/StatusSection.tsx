'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMasterData } from '@/contexts/MasterDataContext';
import { getStudentScheduleEntries } from '@/lib/api/schedule';
import { getProposalsByStudent } from '@/lib/api/proposals';
import { getKoushuEnrollmentsByStudent } from '@/lib/api/seasonalCourses';
import { groupStudentKoushu, type StudentKoushuPeriodGroup } from '@/lib/studentKoushuSummary';
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
  buildRegularTestMetric,
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
 * ★色は対応が要るものだけ（停滞がある進行表の黄）。赤は使わない（赤は「注意すること」のアラートが担う）。
 * ★各指標は下の該当セクションへのページ内リンク。数字の中身は下のセクションで確かめる。
 *
 * 取得（2回取らない）:
 * - 成績・面談記録・宿題遅刻・進行表は、下のセクションと1回の取得を共有する（HubDataContext）。
 *   進行表は重いので whenNetworkIdle の後に取り始める。
 * - 授業予定は、予定表の部品（StudentScheduleCalendar）が表示中の月だけを自分で取るので共有しない。
 *   ここでは今日から60日先までに絞って取る。
 * - 講習は、講習欄の StudentKoushuTab が自分で取る（部品は変えない）ので、ここでは同じ関数を別に1回呼ぶ。
 *   ★二重になるのは承知のうえ。StudentKoushuTab は見えてから読み込むので、開いた直後は重ならない。
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
  const [koushu, setKoushu] = useState<StudentKoushuPeriodGroup[] | null>(null);
  const [koushuFailed, setKoushuFailed] = useState(false);

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
      // 取り方とまとめ方は StudentKoushuTab と同じ（今期＝その先頭の期、の判定を揃えるため）
      Promise.all([getProposalsByStudent(studentId), getKoushuEnrollmentsByStudent(studentId)])
        .then(([proposals, enrollments]) => {
          if (!cancelled) setKoushu(groupStudentKoushu(proposals, enrollments));
        })
        .catch(() => {
          if (cancelled) return;
          setKoushuFailed(true);
          setKoushu([]);
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
  const regularTest = scoresLoading ? null : buildRegularTestMetric(assessments);
  const lastInterview = interviewsLoading
    ? null
    : interviewsFailed
      ? failed
      : buildLastInterviewMetric(interviews);
  const discipline = disciplineLoading ? null : buildDisciplineMetric(sessions, now);
  const progressMetric = progressLoading ? null : buildProgressMetric(progress.textbookData);
  const koushuMetric = koushu === null ? null : koushuFailed ? failed : buildKoushuMetric(koushu);

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
        <Tile href="#sec-scores" label="直近の定期テスト" metric={regularTest} />
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
          <div
            className={`mt-px font-bold leading-[1.35] tabular-nums [overflow-wrap:anywhere] ${valueSize} ${valueColor}`}
          >
            {metric.value ?? '—'}
          </div>
          {metric.sub.map((line, i) => (
            <div key={i} className="mt-px text-xs text-text-faint [overflow-wrap:anywhere]">
              {line}
            </div>
          ))}
        </>
      )}
    </a>
  );
}
