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
import type { StudentInterview } from '@/types/database';
import { DEFAULT_ALERT_THRESHOLDS } from '@/types/alerts';
import { daysSince, fmtDateJa } from './interview.shared';
import { Search, Users, MessageSquareWarning, ListTodo } from 'lucide-react';

type SortKey = 'overdue' | 'grade' | 'name';

// ソートUIのラベル（Select の options 用）
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'overdue', label: '面談が古い順' },
  { value: 'grade', label: '学年順' },
  { value: 'name', label: '名前順' },
];

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
          </div>

          {loading ? (
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
                        {row.lastInterviewDate ? fmtDateJa(row.lastInterviewDate) : '面談記録なし'}
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
          )}
        </CardContent>
      </Card>
    </AdminLayout>
  );
}
