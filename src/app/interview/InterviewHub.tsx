'use client';

/**
 * 面談ワークスペース 入口一覧
 * ------------------------------------------------------------------
 * /interview に ?studentId= 無しでアクセスしたときに表示する、
 * 「次に面談すべき生徒」を選ぶための一覧画面。
 * 行クリック（または「面談を始める」ボタン）で /interview?studentId={id} に遷移すると
 * InterviewWorkspace（3カラムの面談画面）が開く。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import {
  Card,
  CardContent,
  Input,
  Select,
  Switch,
  InlineLoading,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';
import { getStudents, type EnrichedStudent } from '@/lib/api/students';
import { getInterviewsBySchool } from '@/lib/api/interviews';
import { getSchools } from '@/lib/api/schools';
import {
  getSchoolDisciplineSessions,
  type SchoolDisciplineSessionRow,
} from '@/lib/api/progress-sessions';
import type { StudentInterview } from '@/types/database';
import { DEFAULT_ALERT_THRESHOLDS } from '@/types/alerts';
import {
  daysSince,
  fmtDateJa,
  computeDisciplineMonthly,
  computeDisciplineMonthlyByStudent,
  DISCIPLINE_ALERT_RATIO_THRESHOLD,
  type DisciplineMonth,
} from './interview.shared';
import { Search, Users, MessageSquareWarning, ListTodo } from 'lucide-react';

type SortKey = 'overdue' | 'grade' | 'name';
type HubView = 'list' | 'discipline';
type DisciplineSortKey = 'homework' | 'tardy' | 'name';

// ソートUIのラベル（Select の options 用）
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'overdue', label: '面談が古い順' },
  { value: 'grade', label: '学年順' },
  { value: 'name', label: '名前順' },
];

// 宿題・遅刻集計ビュー専用のソートUIラベル（一覧ビューの SORT_OPTIONS とは意味が異なるため別定義）
const DISCIPLINE_SORT_OPTIONS: { value: DisciplineSortKey; label: string }[] = [
  { value: 'homework', label: '宿題忘れ多い順' },
  { value: 'tardy', label: '遅刻多い順' },
  { value: 'name', label: '名前順' },
];

/** 宿題・遅刻パネル（DisciplinePanel）と同じ集計対象期間（直近6ヶ月） */
const DISCIPLINE_MONTHS_BACK = 6;

/** 全生徒集計1行分 */
interface DisciplineRow {
  student: EnrichedStudent;
  schoolName: string | null;
  months: DisciplineMonth[]; // 新しい月が先頭
  totalLessonDays: number;
  totalHomework: number;
  totalTardy: number;
}

/** 月セルの文字色。0件は薄字、割合が閾値以上は赤字強調、それ以外は通常色 */
function disciplineCellClass(count: number, lessonDays: number): string {
  if (count === 0) return 'text-text-faint';
  if (lessonDays > 0 && count / lessonDays >= DISCIPLINE_ALERT_RATIO_THRESHOLD) {
    return 'font-semibold text-red-600';
  }
  return 'text-text-body';
}

interface StudentRow {
  student: EnrichedStudent;
  schoolName: string | null;
  lastInterviewDate: string | null; // 面談記録なしなら null
  daysElapsed: number | null; // 面談記録なしなら null（ソート・表示では「最も古い」扱い）
  pendingTaskCount: number;
}

export function InterviewHub() {
  const router = useRouter();
  const { getSelectedSchoolIds } = useAuth();
  const { error: toastError } = useToast();

  const [rows, setRows] = useState<StudentRow[]>([]);
  const [schoolCount, setSchoolCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('overdue');
  const [overdueOnly, setOverdueOnly] = useState(false);

  // 「面談一覧」/「宿題・遅刻」の表示切替。氏名検索(search)は両ビュー共通で使う
  const [view, setView] = useState<HubView>('list');
  const [disciplineSortKey, setDisciplineSortKey] = useState<DisciplineSortKey>('homework');
  // null = 未取得（「宿題・遅刻」ビューを開くまで取りに行かない）。取得後は再取得しない
  const [disciplineSessions, setDisciplineSessions] = useState<SchoolDisciplineSessionRow[] | null>(
    null
  );
  const [disciplineLoading, setDisciplineLoading] = useState(false);

  const overdueDays = DEFAULT_ALERT_THRESHOLDS.interview_overdue_days;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const schoolIds = getSelectedSchoolIds();
        const [students, interviewsByStudent, schools] = await Promise.all([
          getStudents(undefined, schoolIds),
          getInterviewsBySchool(schoolIds),
          getSchools(),
        ]);
        if (cancelled) return;

        const schoolNameById = new Map(schools.map((s) => [s.id, s.name] as const));
        const active = students.filter((s) => s.status === 'active');

        const built: StudentRow[] = active.map((student) => {
          const interviews = interviewsByStudent.get(student.id) ?? [];

          // 「最終面談日」は面談種別 'task'（約束・宿題）を除いた最新レコードの interview_date。
          // タスクは面談そのものではないため、面談の要否判断には含めない。
          // ※ alerts.ts の buildInterviewOverdueCandidates は種別を問わず最新レコードを見ており、
          //   この画面（面談実績のみで数える）とはあえて意味論を分けている。
          //   「次に面談すべき生徒を選ぶ」目的である以上、面談以外の記録で経過日数がリセットされる
          //   のは違和感があるため、ここでは面談記録のみを対象にする判断とした。
          const latestInterview = interviews.find((i) => i.interview_type !== 'task');
          const pendingTaskCount = interviews.filter(
            (i: StudentInterview) => i.interview_type === 'task' && !i.is_completed
          ).length;

          return {
            student,
            schoolName: schoolNameById.get(student.school_id) ?? null,
            lastInterviewDate: latestInterview?.interview_date ?? null,
            daysElapsed: latestInterview ? daysSince(latestInterview.interview_date) : null,
            pendingTaskCount,
          };
        });

        setRows(built);
        setSchoolCount(schoolIds.length);
      } catch (e) {
        console.error('Error loading interview hub:', e);
        toastError('生徒一覧の取得に失敗しました');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // toastError は初回ロードにのみ使うため依存に含めない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getSelectedSchoolIds]);

  // 「宿題・遅刻」ビューを初めて開いたときだけ全生徒ぶんのセッションを取得する（遅延取得）。
  // disciplineSessions が一度 non-null になれば、以後 view を行き来しても再取得しない。
  useEffect(() => {
    if (view !== 'discipline' || disciplineSessions !== null) return;
    let cancelled = false;
    (async () => {
      setDisciplineLoading(true);
      try {
        const schoolIds = getSelectedSchoolIds();
        // 宿題・遅刻パネル（InterviewWorkspace）と同じ計算式: 今日から遡って6ヶ月前の月の1日
        const disciplineFrom = new Date();
        disciplineFrom.setDate(1);
        disciplineFrom.setMonth(disciplineFrom.getMonth() - (DISCIPLINE_MONTHS_BACK - 1));
        const dateFrom = `${disciplineFrom.getFullYear()}-${String(
          disciplineFrom.getMonth() + 1
        ).padStart(2, '0')}-01`;

        const sessions = await getSchoolDisciplineSessions(schoolIds, dateFrom);
        if (!cancelled) setDisciplineSessions(sessions);
      } catch (e) {
        console.error('Error loading discipline sessions:', e);
        toastError('宿題・遅刻の集計データの取得に失敗しました');
      } finally {
        if (!cancelled) setDisciplineLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // toastError は依存に含めない（初回取得の失敗通知にのみ使う）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, disciplineSessions, getSelectedSchoolIds]);

  // 「要面談」判定: 面談記録が無い、または経過日数がしきい値を超えている生徒
  const isOverdue = useCallback(
    (row: StudentRow) => row.daysElapsed === null || row.daysElapsed > overdueDays,
    [overdueDays]
  );

  const overdueCount = useMemo(() => rows.filter(isOverdue).length, [rows, isOverdue]);

  const filteredSorted = useMemo(() => {
    const trimmed = search.trim();
    let list = rows;

    if (trimmed) {
      list = list.filter((row) => {
        const s = row.student;
        const fullName = `${s.last_name}${s.first_name}`;
        const fullKana = `${s.last_name_kana ?? ''}${s.first_name_kana ?? ''}`;
        return fullName.includes(trimmed) || fullKana.includes(trimmed);
      });
    }
    if (overdueOnly) {
      list = list.filter(isOverdue);
    }

    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sortKey === 'grade') {
        if (a.student.grade !== b.student.grade) return a.student.grade - b.student.grade;
      } else if (sortKey === 'name') {
        const aKana = `${a.student.last_name_kana ?? ''}${a.student.first_name_kana ?? ''}`;
        const bKana = `${b.student.last_name_kana ?? ''}${b.student.first_name_kana ?? ''}`;
        const cmp = aKana.localeCompare(bKana, 'ja');
        if (cmp !== 0) return cmp;
      } else {
        // overdue: 記録なし(null)を最も古い扱いにして最上位に出す
        const aDays = a.daysElapsed ?? Infinity;
        const bDays = b.daysElapsed ?? Infinity;
        if (aDays !== bDays) return bDays - aDays;
      }
      // 同値時は氏名かな順で安定させる
      const aKana = `${a.student.last_name_kana ?? ''}${a.student.first_name_kana ?? ''}`;
      const bKana = `${b.student.last_name_kana ?? ''}${b.student.first_name_kana ?? ''}`;
      return aKana.localeCompare(bKana, 'ja');
    });
    return sorted;
  }, [rows, search, sortKey, overdueOnly, isOverdue]);

  // 全生徒ぶんのセッションを生徒ごとに月次集計する。対象は既存一覧と同じ在籍中の生徒（rows）。
  // セッション記録が1件も無い生徒（Map にエントリが無い生徒）も、全月 lessonDays:0 の行として出す。
  const disciplineRows: DisciplineRow[] = useMemo(() => {
    const byStudent = computeDisciplineMonthlyByStudent(
      disciplineSessions ?? [],
      DISCIPLINE_MONTHS_BACK,
      new Date()
    );
    // 記録が1件も無い生徒向けの「全月 lessonDays:0」の穴埋め配列（空セッションから計算するのと同じ形）
    const emptyMonths = computeDisciplineMonthly([], DISCIPLINE_MONTHS_BACK, new Date());

    return rows.map((row): DisciplineRow => {
      const months = byStudent.get(row.student.id) ?? emptyMonths;
      const totalLessonDays = months.reduce((sum, m) => sum + m.lessonDays, 0);
      const totalHomework = months.reduce((sum, m) => sum + m.homeworkMissedDays, 0);
      const totalTardy = months.reduce((sum, m) => sum + m.tardyDays, 0);
      return {
        student: row.student,
        schoolName: row.schoolName,
        months,
        totalLessonDays,
        totalHomework,
        totalTardy,
      };
    });
  }, [rows, disciplineSessions]);

  const disciplineFilteredSorted = useMemo(() => {
    const trimmed = search.trim();
    let list = disciplineRows;
    if (trimmed) {
      list = list.filter((row) => {
        const s = row.student;
        const fullName = `${s.last_name}${s.first_name}`;
        const fullKana = `${s.last_name_kana ?? ''}${s.first_name_kana ?? ''}`;
        return fullName.includes(trimmed) || fullKana.includes(trimmed);
      });
    }

    const sorted = [...list];
    sorted.sort((a, b) => {
      if (disciplineSortKey === 'homework') {
        if (a.totalHomework !== b.totalHomework) return b.totalHomework - a.totalHomework;
      } else if (disciplineSortKey === 'tardy') {
        if (a.totalTardy !== b.totalTardy) return b.totalTardy - a.totalTardy;
      }
      // name のとき、および同数のときの安定ソートは氏名かな順
      const aKana = `${a.student.last_name_kana ?? ''}${a.student.first_name_kana ?? ''}`;
      const bKana = `${b.student.last_name_kana ?? ''}${b.student.first_name_kana ?? ''}`;
      return aKana.localeCompare(bKana, 'ja');
    });
    return sorted;
  }, [disciplineRows, search, disciplineSortKey]);

  // 集計ビューの月列ヘッダー（新しい月が左）。行データに依存しないので空セッションから作る
  const disciplineMonthHeaders = useMemo(
    () =>
      computeDisciplineMonthly([], DISCIPLINE_MONTHS_BACK, new Date()).map((m) => ({
        month: m.month,
        shortLabel: `${Number(m.month.slice(5, 7))}月`,
      })),
    []
  );

  const showSchoolColumn = schoolCount > 1;

  const goToWorkspace = (studentId: string) => {
    router.push(`/interview?studentId=${studentId}`);
  };

  return (
    <AdminLayout headerTitle="面談">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-text-heading">面談ワークスペース</h1>
        <p className="mt-1 text-sm text-text-muted">
          次に面談すべき生徒を選んでください。行をクリックすると、その生徒の面談画面が開きます。
        </p>
      </div>

      {/* 要約 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-subtle px-3 py-1 text-sm font-medium text-danger">
          <MessageSquareWarning className="h-4 w-4" />
          要面談 {overdueCount}名
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-hover px-3 py-1 text-sm text-text-muted">
          <Users className="h-4 w-4" />全 {rows.length}名
        </span>
      </div>

      {/* ビュー切替: 面談一覧 / 宿題・遅刻の全生徒集計 */}
      <div className="mb-4 inline-flex rounded-lg border border-border bg-surface-hover p-1 text-sm">
        {(
          [
            { key: 'list', label: '面談一覧' },
            { key: 'discipline', label: '宿題・遅刻' },
          ] as const
        ).map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setView(v.key)}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors duration-150 ${
              view === v.key
                ? 'bg-surface-raised text-text-heading shadow-sm'
                : 'text-text-muted hover:text-text-body'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="py-4">
          {/* ツールバー */}
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
              <Input
                aria-label="氏名で検索"
                placeholder="氏名で検索"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            {view === 'list' ? (
              <div className="flex flex-wrap items-center gap-3">
                <div className="w-40">
                  <Select
                    aria-label="並び替え"
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as SortKey)}
                    options={SORT_OPTIONS}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-text-body">
                  <Switch checked={overdueOnly} onCheckedChange={setOverdueOnly} />
                  要面談のみ表示
                </label>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <div className="w-44">
                  <Select
                    aria-label="並び替え"
                    value={disciplineSortKey}
                    onChange={(e) => setDisciplineSortKey(e.target.value as DisciplineSortKey)}
                    options={DISCIPLINE_SORT_OPTIONS}
                  />
                </div>
              </div>
            )}
          </div>

          {view === 'list' ? (
            loading ? (
              <InlineLoading className="justify-center py-12" />
            ) : rows.length === 0 ? (
              <div className="py-12 text-center text-text-muted">在籍中の生徒がいません</div>
            ) : filteredSorted.length === 0 ? (
              <div className="py-12 text-center text-text-muted">
                条件に一致する生徒が見つかりません
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>生徒名</TableHead>
                    <TableHead>学年</TableHead>
                    {showSchoolColumn && <TableHead>教室</TableHead>}
                    <TableHead>最終面談日</TableHead>
                    <TableHead>経過</TableHead>
                    <TableHead>未完了タスク</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSorted.map((row) => {
                    const overdue = isOverdue(row);
                    const half = row.daysElapsed !== null && row.daysElapsed > overdueDays / 2;
                    return (
                      <TableRow key={row.student.id} onClick={() => goToWorkspace(row.student.id)}>
                        <TableCell className="font-medium text-text-heading">
                          {row.student.last_name} {row.student.first_name}
                        </TableCell>
                        <TableCell>{formatGradeLabel(row.student.grade)}</TableCell>
                        {showSchoolColumn && <TableCell>{row.schoolName ?? '－'}</TableCell>}
                        <TableCell>
                          {row.lastInterviewDate
                            ? fmtDateJa(row.lastInterviewDate)
                            : '面談記録なし'}
                        </TableCell>
                        <TableCell>
                          {row.daysElapsed === null ? (
                            <span className="inline-flex items-center whitespace-nowrap rounded-full bg-danger-subtle px-2.5 py-0.5 text-xs font-medium text-danger">
                              面談記録なし
                            </span>
                          ) : overdue ? (
                            <span className="inline-flex items-center whitespace-nowrap rounded-full bg-danger-subtle px-2.5 py-0.5 text-xs font-medium text-danger">
                              {row.daysElapsed}日経過
                            </span>
                          ) : half ? (
                            <span className="inline-flex items-center whitespace-nowrap rounded-full bg-warning-subtle px-2.5 py-0.5 text-xs font-medium text-warning">
                              {row.daysElapsed}日経過
                            </span>
                          ) : (
                            <span className="inline-flex items-center whitespace-nowrap rounded-full bg-info-subtle px-2.5 py-0.5 text-xs font-medium text-info">
                              {row.daysElapsed}日経過
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.pendingTaskCount > 0 ? (
                            <span className="inline-flex items-center gap-1 text-text-body">
                              <ListTodo className="h-3.5 w-3.5 text-text-muted" />
                              {row.pendingTaskCount}件
                            </span>
                          ) : (
                            <span className="text-text-faint">－</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => goToWorkspace(row.student.id)}
                            className="text-sm font-medium text-info hover:underline"
                          >
                            面談を始める
                          </button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )
          ) : disciplineLoading ? (
            <InlineLoading className="justify-center py-12" label="宿題・遅刻の記録を読み込み中…" />
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-text-muted">在籍中の生徒がいません</div>
          ) : disciplineFilteredSorted.length === 0 ? (
            <div className="py-12 text-center text-text-muted">
              条件に一致する生徒が見つかりません
            </div>
          ) : (
            <>
              {/* 表が横に広い（生徒情報＋6ヶ月分＋合計）ため横スクロール可能なコンテナで包む */}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">生徒名</TableHead>
                      <TableHead className="whitespace-nowrap">学年</TableHead>
                      {showSchoolColumn && (
                        <TableHead className="whitespace-nowrap">教室</TableHead>
                      )}
                      {disciplineMonthHeaders.map((h) => (
                        <TableHead key={h.month} className="whitespace-nowrap text-center">
                          {h.shortLabel}
                        </TableHead>
                      ))}
                      <TableHead className="whitespace-nowrap text-center">合計</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {disciplineFilteredSorted.map((row) => (
                      <TableRow key={row.student.id} onClick={() => goToWorkspace(row.student.id)}>
                        <TableCell className="whitespace-nowrap font-medium text-text-heading">
                          {row.student.last_name} {row.student.first_name}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {formatGradeLabel(row.student.grade)}
                        </TableCell>
                        {showSchoolColumn && (
                          <TableCell className="whitespace-nowrap">
                            {row.schoolName ?? '－'}
                          </TableCell>
                        )}
                        {row.months.map((m) => (
                          <TableCell
                            key={m.month}
                            className="whitespace-nowrap text-center text-xs"
                          >
                            {m.lessonDays === 0 ? (
                              <span className="text-text-faint">—</span>
                            ) : (
                              <div className="leading-tight">
                                <div
                                  className={disciplineCellClass(
                                    m.homeworkMissedDays,
                                    m.lessonDays
                                  )}
                                >
                                  宿 {m.homeworkMissedDays}
                                </div>
                                <div className={disciplineCellClass(m.tardyDays, m.lessonDays)}>
                                  遅 {m.tardyDays}
                                </div>
                              </div>
                            )}
                          </TableCell>
                        ))}
                        <TableCell className="whitespace-nowrap text-center text-xs text-text-body">
                          授業{row.totalLessonDays}日・宿{row.totalHomework}・遅{row.totalTardy}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="mt-3 text-[11px] text-text-faint">
                進行表の記録に基づく（未入力は数えられません）
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </AdminLayout>
  );
}
