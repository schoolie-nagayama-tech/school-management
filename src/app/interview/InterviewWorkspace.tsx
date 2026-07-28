'use client';

/**
 * 面談ワークスペース 本体
 * ------------------------------------------------------------------
 * 検討用モック（src/app/interview-mock/page.tsx）を実データ化した本番ページ。
 * 面談記録はNotta（文字起こし）から取り込む運用になり「今回の面談メモ」入力が不要になったため、
 * 2カラム（左＝過去の面談記録・約束/タスク、右＝成績・進行表）＋ヘッダー帯（生徒切替・印刷）で構成する。
 *
 * データ取得は「軽いもの」（面談記録・成績）を先にまとめて取得して左右カラムを先に描画し、
 * N+1になりがちな進行表（テキストごとに getStudentProgress を呼ぶ）は後追いで並列取得する。
 * courses/progress ページの段階表示と同じ考え方。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent, Button, Select, Loading, ToastContainer } from '@/components/ui';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';
import { getStudents, getStudent, type EnrichedStudent } from '@/lib/api/students';
import { getStudentInterviews } from '@/lib/api/interviews';
import { listAssessments } from '@/lib/api/assessments';
import { getStudentTextbooks, getStudentProgress } from '@/lib/api/progress';
import { getRegularPatterns } from '@/lib/api/schedule';
import { getKoushuEnrollmentsByStudent, type KoushuEnrollment } from '@/lib/api/seasonalCourses';
import type { AssessmentWithScores, Student, StudentInterview } from '@/types/database';
import type { ScheduleRegularPattern } from '@/types/schedule';
import { InterviewTimeline, type HandoverInfo } from './InterviewTimeline';
import { ScorePanel } from './ScorePanel';
import { ProgressPanel, type TextbookProgressData } from './ProgressPanel';
import { InterviewPrintSheet } from './InterviewPrintSheet';
import {
  extractHandover,
  formatKoushuEnrollments,
  formatRegularPatternsSchedule,
} from './interview.shared';
import { InterviewHub } from './InterviewHub';
import { ArrowLeft, History, Printer } from 'lucide-react';

export function InterviewWorkspace() {
  const { profile, isLoading: authLoading, getSelectedSchoolIds, selectedSchoolId } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toasts, removeToast, error: toastError } = useToast();

  const [students, setStudents] = useState<EnrichedStudent[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  // 教室切替の検知用（初回マウント時は何もしない）
  const prevSchoolIdRef = useRef(selectedSchoolId);

  const [student, setStudent] = useState<Student | null>(null);

  const [interviews, setInterviews] = useState<StudentInterview[]>([]);
  const [assessments, setAssessments] = useState<AssessmentWithScores[]>([]);
  // 通塾日程・講習申込はヘッダー帯に1行で添える（面談で必ず話題に出るため）
  const [regularPatterns, setRegularPatterns] = useState<ScheduleRegularPattern[]>([]);
  const [koushuEnrollments, setKoushuEnrollments] = useState<KoushuEnrollment[]>([]);
  const [lightLoading, setLightLoading] = useState(false);

  // 進行表の生データ（テキスト×そのテキストの進行記録行）をテキストぶん保持する。
  // 集計（進捗％・直近履歴・次単元など）は ProgressPanel / 印刷シート側で summarizeTextbookDetail に任せる。
  const [textbookProgressData, setTextbookProgressData] = useState<TextbookProgressData[]>([]);
  const [progressLoading, setProgressLoading] = useState(false);

  // 生徒一覧（在籍中のみ、学年→氏名かな順）
  useEffect(() => {
    let cancelled = false;
    async function loadStudents() {
      setStudentsLoading(true);
      try {
        const schoolIds = getSelectedSchoolIds();
        const all = await getStudents(undefined, schoolIds.length > 0 ? schoolIds : undefined);
        const active = all
          .filter((s) => s.status === 'active')
          .sort((a, b) => {
            if (a.grade !== b.grade) return a.grade - b.grade;
            const aKana = `${a.last_name_kana}${a.first_name_kana}`;
            const bKana = `${b.last_name_kana}${b.first_name_kana}`;
            return aKana.localeCompare(bKana, 'ja');
          });
        if (cancelled) return;
        setStudents(active);

        // 初期ロード時のみ URL クエリ ?studentId= を反映する（同一コミットで反映し
        // Hub→ワークスペースの1フレームのちらつきを避ける）。無ければ何もせず
        // studentsLoading=false・selectedStudentId='' のまま → 下の入口一覧表示に落ちる。
        const queryId = searchParams.get('studentId');
        if (queryId) {
          const found = active.find((s) => s.id === queryId);
          if (found) setSelectedStudentId(found.id);
        }
      } catch (e) {
        console.error('Error fetching students:', e);
        toastError('生徒一覧の取得に失敗しました');
      } finally {
        if (!cancelled) setStudentsLoading(false);
      }
    }
    loadStudents();
    return () => {
      cancelled = true;
    };
    // searchParams/toastError は初回ロードにのみ使うため依存に含めない
    // （searchParams の変化は下の同期 useEffect が別途処理する）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getSelectedSchoolIds]);

  // 初期ロード後の URL クエリ ?studentId= と選択状態を同期する（初期ロード自体は上の effect が担当）。
  // - 入口一覧（InterviewHub）の行クリック/「面談を始める」で studentId 付きに遷移した場合
  //   → 生徒一覧に実在すれば選択状態に反映してワークスペースを開く
  // - ヘッダーの「一覧へ戻る」でクエリを外した場合 → 選択解除して入口一覧に戻す
  // - 生徒一覧ロード前、または該当生徒が見つからない場合は何もしない（入口一覧の表示に任せる）
  //
  // 以前はクエリが無ければ先頭の生徒を自動選択していたが、入口一覧を新設したのに伴い廃止した
  // （未選択のまま一覧に留まり、選んでから開く設計にする）。
  useEffect(() => {
    const queryId = searchParams.get('studentId');
    if (queryId) {
      if (students.length === 0) return;
      const found = students.find((s) => s.id === queryId);
      if (found && found.id !== selectedStudentId) {
        setSelectedStudentId(found.id);
      }
    } else if (selectedStudentId) {
      setSelectedStudentId('');
    }
  }, [searchParams, students, selectedStudentId]);

  // 教室切替時は選択中の生徒をリセットする（選べる生徒集合自体が変わるため）。
  // URLに古い studentId が残っていると上の同期効果と噛み合わないため、クエリも一覧に戻す。
  useEffect(() => {
    if (prevSchoolIdRef.current !== selectedSchoolId) {
      prevSchoolIdRef.current = selectedSchoolId;
      setSelectedStudentId('');
      router.replace('/interview', { scroll: false });
    }
  }, [selectedSchoolId, router]);

  const handleSelectStudent = useCallback(
    (id: string) => {
      setSelectedStudentId(id);
      router.replace(`/interview?studentId=${id}`, { scroll: false });
    },
    [router]
  );

  // 選択中生徒の詳細（学年・学校名などの表示用）
  useEffect(() => {
    if (!selectedStudentId) {
      setStudent(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const schoolIds = getSelectedSchoolIds();
        const s = await getStudent(selectedStudentId, schoolIds.length > 0 ? schoolIds : undefined);
        if (!cancelled) setStudent(s);
      } catch (e) {
        console.error('Error fetching student:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedStudentId, getSelectedSchoolIds]);

  // 面談記録だけの再取得（タスク完了・面談編集・新規保存のあとに呼ぶ軽量パス）
  const refetchInterviews = useCallback(async () => {
    if (!selectedStudentId) return;
    try {
      setInterviews(await getStudentInterviews(selectedStudentId));
    } catch (e) {
      console.error('Error fetching interviews:', e);
    }
  }, [selectedStudentId]);

  // 軽いデータ（面談記録・成績・通塾日程・講習申込）をまとめて取得。進行表より先に描画する。
  // 通塾日程と講習申込は面談で必ず話題に出る（曜日の相談・講習の案内）ため、
  // 専用カードは持たずヘッダー帯に1行で添える。
  useEffect(() => {
    if (!selectedStudentId || !student) return;
    let cancelled = false;
    (async () => {
      setLightLoading(true);
      try {
        const [iv, asm, patterns, koushu] = await Promise.all([
          getStudentInterviews(selectedStudentId).catch(() => []),
          listAssessments(selectedStudentId).catch(() => []),
          getRegularPatterns(student.school_id, { studentId: selectedStudentId }).catch(() => []),
          getKoushuEnrollmentsByStudent(selectedStudentId).catch(() => []),
        ]);
        if (cancelled) return;
        setInterviews(iv);
        setAssessments(asm);
        setRegularPatterns(patterns);
        setKoushuEnrollments(koushu);
      } finally {
        if (!cancelled) setLightLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedStudentId, student]);

  // 重いデータ（進行表）は後追いで取得。生徒IDが決まり次第、テキストごとに並列で進行記録を取る。
  useEffect(() => {
    if (!selectedStudentId) {
      setTextbookProgressData([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setProgressLoading(true);
      try {
        const raw = await getStudentTextbooks(selectedStudentId);
        // 進行表パネルに出すのは「進行表で管理中」のテキストのみ（/progress ページと同じ絞り込み）
        const tracked = raw.filter((t) => t.track_progress);
        const data = await Promise.all(
          tracked.map(async (textbook) => ({
            textbook,
            rows: await getStudentProgress(textbook.id).catch(() => []),
          }))
        );
        if (cancelled) return;
        setTextbookProgressData(data);
      } catch (e) {
        console.error('Error fetching progress:', e);
      } finally {
        if (!cancelled) setProgressLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedStudentId]);

  // 「前回の申し送り」= 面談タイムライン最新（非タスク）の抜粋。左カラム・印刷シート共通で使う。
  const nonTaskInterviews = useMemo(
    () => interviews.filter((i) => i.interview_type !== 'task'),
    [interviews]
  );
  const handover: HandoverInfo | null = useMemo(() => {
    const latest = nonTaskInterviews[0];
    if (!latest) return null;
    const extracted = extractHandover(latest.content);
    return {
      date: latest.interview_date,
      text: extracted ?? latest.content.slice(0, 200),
      isFallback: !extracted,
    };
  }, [nonTaskInterviews]);

  const today = new Date().toISOString().slice(0, 10);

  if (authLoading) {
    return (
      <AdminLayout headerTitle="面談">
        <Loading className="min-h-[60vh]" />
      </AdminLayout>
    );
  }

  if (!isManagerOrAbove(profile?.role)) {
    return (
      <AdminLayout headerTitle="面談">
        <AccessDenied message="このページは教室長以上のみアクセス可能です" />
      </AdminLayout>
    );
  }

  // 生徒未選択（?studentId= なし）→ 入口一覧（InterviewHub）を表示する。
  // 生徒一覧のロード中は判定を保留し、下の通常レンダリングパスで読み込み中表示を出す。
  if (!studentsLoading && !selectedStudentId) {
    return <InterviewHub />;
  }

  return (
    <AdminLayout headerTitle="面談" fullWidth>
      {/* ヘッダー帯（一覧へ戻る・生徒切替・印刷） */}
      <Card className="mb-5 print:hidden">
        <CardContent className="py-4">
          <button
            type="button"
            onClick={() => router.push('/interview', { scroll: false })}
            className="mb-3 inline-flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text-heading"
          >
            <ArrowLeft className="h-4 w-4" />
            一覧へ戻る
          </button>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="w-full sm:w-64">
                <Select
                  aria-label="生徒切替"
                  value={selectedStudentId}
                  onChange={(e) => handleSelectStudent(e.target.value)}
                  disabled={studentsLoading || students.length === 0}
                  options={
                    students.length > 0
                      ? students.map((s) => ({
                          value: s.id,
                          label: `${s.last_name} ${s.first_name}（${formatGradeLabel(s.grade)}・${
                            s.school_name ?? '学校未登録'
                          }）`,
                        }))
                      : [
                          {
                            value: '',
                            label: studentsLoading ? '読み込み中...' : '在籍生徒がいません',
                          },
                        ]
                  }
                />
              </div>
              {student && (
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-xl font-bold text-text-heading">
                    {student.last_name} {student.first_name}
                  </span>
                  <span className="text-sm text-text-muted">
                    {formatGradeLabel(student.grade)}
                    {student.school_name ? `・${student.school_name}` : ''}
                  </span>
                  {/* 通塾日程・講習申込。専用カードは持たせず、面談中に目に入る位置へ添える */}
                  <span className="text-xs text-text-faint">
                    通塾: {formatRegularPatternsSchedule(regularPatterns)} ／ 講習:{' '}
                    {formatKoushuEnrollments(koushuEnrollments)}
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {handover && (
                <span className="inline-flex items-center gap-1 rounded-full bg-info-subtle px-2.5 py-1 text-xs font-medium text-info">
                  <History className="h-3.5 w-3.5" />
                  前回面談: {handover.date}
                </span>
              )}
              {student && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.print()}
                  className="gap-1.5"
                >
                  <Printer className="h-3.5 w-3.5" />
                  印刷
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {!student ? (
        <Card className="print:hidden">
          <CardContent className="py-12 text-center text-text-muted">
            {studentsLoading ? '読み込み中...' : '生徒を選択してください'}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* 2カラム本体（左＝過去の面談記録・約束/タスク、右＝成績・進行表） */}
          <div className="grid gap-5 print:hidden lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">
            <InterviewTimeline
              studentId={student.id}
              schoolId={student.school_id}
              interviews={interviews}
              loading={lightLoading}
              handover={handover}
              onChanged={refetchInterviews}
            />
            <div className="flex flex-col gap-5">
              <ScorePanel assessments={assessments} loading={lightLoading} />
              <ProgressPanel textbookData={textbookProgressData} loading={progressLoading} />
            </div>
          </div>

          {/* 印刷シート（画面には出ない。印刷時のみ表示。globals.css の interviewreport ページを使用） */}
          <InterviewPrintSheet
            student={student}
            today={today}
            handover={handover}
            recentInterviews={nonTaskInterviews}
            assessments={assessments}
            textbookData={textbookProgressData}
          />
        </>
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}
