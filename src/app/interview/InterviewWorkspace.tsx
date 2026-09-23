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
import {
  getStudentTextbooks,
  getStudentProgress,
  getStudentExamGoalsForInterview,
  type StudentExamGoalWithType,
} from '@/lib/api/progress';
import {
  getStudentDisciplineSessions,
  getFeedGoalsByTextbooks,
  type DisciplineSessionRow,
  type FeedGoalSummary,
} from '@/lib/api/progress-sessions';
import { getRegularPatterns } from '@/lib/api/schedule';
import { getKoushuEnrollmentsByStudent, type KoushuEnrollment } from '@/lib/api/seasonalCourses';
import { getStudentTargetSchools, type TargetSchoolRow } from '@/lib/api/targetSchools';
import { getStudentMockSchools, type MockSchoolRecord } from '@/lib/api/mockTargetSchools';
import { getSubjects } from '@/lib/api/subjects';
import {
  getInterviewMockApplications,
  getInterviewShukaisu,
  getInterviewTestPrep,
} from '@/lib/api/interviewApplications';
import {
  getSeasonalProposalSummaryByStudent,
  type SeasonalProposalSeasonSummary,
} from '@/lib/api/seasonalProposalSummary';
import type { AssessmentWithScores, Student, StudentInterview } from '@/types/database';
import type { ScheduleRegularPattern } from '@/types/schedule';
import { InterviewRecordsCard, InterviewTasksCard, type HandoverInfo } from './InterviewTimeline';
import { ScorePanel } from './ScorePanel';
import { ProgressPanel, type TextbookProgressData } from './ProgressPanel';
import { DisciplinePanel } from './DisciplinePanel';
import { InterviewPrintSheet } from './InterviewPrintSheet';
import { InterviewScriptCard, type ScriptView } from './InterviewScriptCard';
import { TargetSchoolsPanel } from '@/components/interview/TargetSchoolsPanel';
import {
  currentSeason,
  extractHandover,
  formatRegularPatternsSchedule,
  koushuFiscalYear,
  mergeKoushuSeasons,
  stripNottaMeta,
  summarizeCurrentKoushu,
  INTERVIEW_CARD_IDS,
  type MockApplicationForInterview,
  type ShukaisuChangeForInterview,
  type TestPrepProposalForInterview,
} from './interview.shared';
import { InterviewHub } from './InterviewHub';
import { ArrowLeft, History, Printer } from 'lucide-react';

/**
 * 段の区切り帯（「話すこと」「材料（記録）」）。
 * ★行動（話すこと）とデータ（材料）の境目を画面に出すためだけの細い見出し。
 *   カードの見出しより弱く見せたいので、小さな文字＋1本の罫線にしてある。
 */
function SectionBand({ label }: { label: string }) {
  return (
    <div className="mb-2.5 mt-6 flex items-center gap-3 first:mt-0">
      <span className="shrink-0 text-[11px] font-bold tracking-[0.24em] text-text-muted">
        {label}
      </span>
      <span className="h-px flex-1 bg-border-subtle" aria-hidden="true" />
    </div>
  );
}

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
  /**
   * 講習の提案書（期ごとのまとめ）。★⑤プラン提示と講習バッジの主材料。
   *   koushu_enrollments は本番0行（2027-02公開のWeb申込の入力源）なので、
   *   これを読まないと全生徒が「講習: 申込なし」になる。
   */
  const [koushuSummaries, setKoushuSummaries] = useState<SeasonalProposalSeasonSummary[]>([]);
  // 宿題・遅刻の月次集計（DisciplinePanel）用の生セッション行。集計自体は computeDisciplineMonthly に任せる
  const [disciplineSessions, setDisciplineSessions] = useState<DisciplineSessionRow[]>([]);
  // 試験目標（②ヒアリング「目標の達成度」の材料）
  const [examGoals, setExamGoals] = useState<StudentExamGoalWithType[]>([]);
  // 志望校（④現状の確認「志望校との差」の材料。TargetSchoolsPanel の保存後に反映するため refetch も持つ）
  const [targetSchools, setTargetSchools] = useState<TargetSchoolRow[]>([]);
  // 模試の志望校と合格可能性（④現状の確認「直近の模試」の材料。模試の取り込みで入る）
  const [mockSchools, setMockSchools] = useState<MockSchoolRecord[]>([]);
  /**
   * 申込から見えること（2026-09-23 教室長）。④テスト対策の提案書と増コマ申込・
   * ②週回数変更の申込・④模試の申込。★台本と印刷シートの両方に渡す
   */
  const [testPrep, setTestPrep] = useState<TestPrepProposalForInterview[]>([]);
  const [shukaisu, setShukaisu] = useState<ShukaisuChangeForInterview | null>(null);
  const [mockApplications, setMockApplications] = useState<MockApplicationForInterview[]>([]);
  /**
   * 科目ID→科目名。⑤プラン提示の「講習の履歴」で科目名を出すために使う。
   * ★生徒に依存しないマスタなので、生徒の切り替えでは取り直さない。
   */
  const [subjectNames, setSubjectNames] = useState<Record<string, string>>({});
  const [lightLoading, setLightLoading] = useState(false);

  // 進行表の生データ（テキスト×そのテキストの進行記録行）をテキストぶん保持する。
  // 集計（進捗％・直近履歴・次単元など）は ProgressPanel / 印刷シート側で summarizeTextbookDetail に任せる。
  const [textbookProgressData, setTextbookProgressData] = useState<TextbookProgressData[]>([]);
  // student_textbook_id → 目標（試験目標）と行動目標。進行表パネルで進捗バーの代わりに出す
  const [textbookGoals, setTextbookGoals] = useState<Record<string, FeedGoalSummary>>({});
  const [progressLoading, setProgressLoading] = useState(false);

  /**
   * 面談で話すこと（AI）の結果。★カードではなくここで持つ。印刷シートにも同じものを出すため。
   * 保存はしない（生徒を切り替えるとカード側から null が上がってきて消える）。
   */
  const [script, setScript] = useState<ScriptView | null>(null);
  const handleScriptResult = useCallback((v: ScriptView | null) => setScript(v), []);

  /**
   * ヘッダー帯の「講習: …」。★⑤のバッジ・⑥の「申込の状況」と同じ関数で組む
   *   （片方だけ直して食い違うのを防ぐ。interview.shared.ts の summarizeCurrentKoushu）。
   */
  const koushuSummary = useMemo(() => {
    const today = new Date();
    return summarizeCurrentKoushu(
      mergeKoushuSeasons(koushuSummaries, koushuEnrollments, subjectNames),
      koushuFiscalYear(today),
      currentSeason(today)
    );
  }, [koushuSummaries, koushuEnrollments, subjectNames]);

  // 科目マスタ（講習の履歴の科目名）。生徒に依存しないので最初に1回だけ取る
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const subjects = await getSubjects();
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const s of subjects) map[s.id] = s.name;
        setSubjectNames(map);
      } catch (e) {
        // 科目名が引けなくても講習の履歴以外は出せる。ここで画面を止めない
        console.error('Error fetching subjects:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  // 志望校だけの再取得。TargetSchoolsPanel で保存した直後に呼び、④現状の確認の
  // 「志望校との差」を保存内容に合わせて即座に更新する（ページ再読み込みを待たせない）
  const refetchTargetSchools = useCallback(async () => {
    if (!selectedStudentId) return;
    try {
      setTargetSchools(await getStudentTargetSchools(selectedStudentId));
    } catch (e) {
      console.error('Error fetching target schools:', e);
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
        // 宿題・遅刻パネルの集計対象期間（直近6ヶ月）の開始日 = 今日から遡って6ヶ月前の月の1日
        const disciplineFrom = new Date();
        disciplineFrom.setDate(1);
        disciplineFrom.setMonth(disciplineFrom.getMonth() - 5);
        const disciplineFromStr = `${disciplineFrom.getFullYear()}-${String(
          disciplineFrom.getMonth() + 1
        ).padStart(2, '0')}-01`;

        const [
          iv,
          asm,
          patterns,
          koushu,
          koushuProposals,
          discipline,
          goals,
          schools,
          mocks,
          prep,
          weekly,
          mockApps,
        ] = await Promise.all([
          getStudentInterviews(selectedStudentId).catch(() => []),
          listAssessments(selectedStudentId).catch(() => []),
          getRegularPatterns(student.school_id, { studentId: selectedStudentId }).catch(() => []),
          getKoushuEnrollmentsByStudent(selectedStudentId).catch(() => []),
          getSeasonalProposalSummaryByStudent(selectedStudentId).catch(() => []),
          getStudentDisciplineSessions(selectedStudentId, disciplineFromStr).catch(() => []),
          getStudentExamGoalsForInterview(selectedStudentId).catch(() => []),
          getStudentTargetSchools(selectedStudentId).catch(() => []),
          // ★表がまだ無い環境（マイグレーション未適用）でも面談画面は開けるよう、失敗は空で受ける
          getStudentMockSchools(selectedStudentId).catch(() => []),
          // ★申込が読めなくても面談画面は開けるよう、失敗は空で受ける（lib/api/interviewApplications.ts）
          getInterviewTestPrep(selectedStudentId).catch(() => []),
          getInterviewShukaisu(selectedStudentId).catch(() => null),
          getInterviewMockApplications(selectedStudentId).catch(() => []),
        ]);
        if (cancelled) return;
        setInterviews(iv);
        setAssessments(asm);
        setRegularPatterns(patterns);
        setKoushuEnrollments(koushu);
        setKoushuSummaries(koushuProposals);
        setDisciplineSessions(discipline);
        setExamGoals(goals);
        setTargetSchools(schools);
        setMockSchools(mocks);
        setTestPrep(prep);
        setShukaisu(weekly);
        setMockApplications(mockApps);
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
      setTextbookGoals({});
      return;
    }
    let cancelled = false;
    (async () => {
      setProgressLoading(true);
      try {
        const raw = await getStudentTextbooks(selectedStudentId);
        // 進行表パネルに出すのは「進行表で管理中」のテキストのみ（/progress ページと同じ絞り込み）
        const tracked = raw.filter((t) => t.track_progress);
        // 進行記録はテキストごとに取るが、目標・行動目標は全テキストまとめて1回で取れる
        const [data, goals] = await Promise.all([
          Promise.all(
            tracked.map(async (textbook) => ({
              textbook,
              rows: await getStudentProgress(textbook.id).catch(() => []),
            }))
          ),
          getFeedGoalsByTextbooks(tracked.map((t) => t.id)).catch(() => ({})),
        ]);
        if (cancelled) return;
        setTextbookProgressData(data);
        setTextbookGoals(goals);
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
      // ★見出しが無いときも先頭200字をそのまま出さない。Notta取込の本文は
      //   【タイトル】【録音日時】【音声URL】で始まるので、ピン留めが録音日時とURLで埋まる。
      //   buildTellSections（台本の「前回の面談から」）と同じ受け皿に揃える。
      text: extracted ?? stripNottaMeta(latest.content).slice(0, 200),
      isFallback: !extracted,
      // ★本文そのものも渡す。「## 次回への申し送り」が無いNotta記録は、ピン留め側で
      //   タイムラインと同じ構造化（空の見出しを畳む）をして出すため。
      content: latest.content,
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
                    {koushuSummary.label}
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
          {/* ★並びは「上＝話すこと、下＝材料」。正典: docs/interview-workspace-layout-2026-09.md
              ①面談で話すこと（全幅）→②成績｜面談記録→③進行表｜授業の様子→④タスク（最下段）。
              以前は左440pxの列に「タスク→面談記録→（その中に）話すこと」と入れ子にしていたが、
              話すことが材料の中に埋まって何をすればよいか分からない、と教室長から指摘があった。 */}
          <div className="print:hidden">
            {/* 帯はカード側に渡す。教室でAIがオフのときカードごと消えるので、帯だけ残らないように */}
            <InterviewScriptCard
              student={student}
              assessments={assessments}
              interviews={interviews}
              textbookData={textbookProgressData}
              disciplineSessions={disciplineSessions}
              koushuEnrollments={koushuEnrollments}
              koushuSummaries={koushuSummaries}
              regularPatterns={regularPatterns}
              examGoals={examGoals}
              targetSchools={targetSchools}
              mockSchools={mockSchools}
              testPrep={testPrep}
              shukaisu={shukaisu}
              mockApplications={mockApplications}
              subjectNames={subjectNames}
              loading={lightLoading || progressLoading}
              onResult={handleScriptResult}
              band={<SectionBand label="話すこと" />}
            />

            <SectionBand label="材料（記録）" />

            {/* 成績 ｜ 面談記録（半々）。台本の「事実」の行からここへ飛ぶので id を付ける */}
            <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
              <div className="flex flex-col gap-5">
                <div id={INTERVIEW_CARD_IDS.score} className="scroll-mt-4">
                  <ScorePanel assessments={assessments} loading={lightLoading} />
                </div>
                {/* 志望校（第1〜3志望）。②のヒアリングで聞いてその場で入れる想定。
                    保存後に onSaved で④「志望校との差」を再取得し、その場で反映する */}
                <TargetSchoolsPanel
                  studentId={student.id}
                  schoolId={student.school_id}
                  onSaved={refetchTargetSchools}
                />
              </div>
              <div id={INTERVIEW_CARD_IDS.records} className="scroll-mt-4">
                <InterviewRecordsCard
                  studentId={student.id}
                  schoolId={student.school_id}
                  interviews={interviews}
                  loading={lightLoading}
                  handover={handover}
                  onChanged={refetchInterviews}
                />
              </div>
            </div>

            {/* 進行表 ｜ 授業の様子（二次的な材料） */}
            <div className="mt-5 grid gap-5 lg:grid-cols-2 lg:items-start">
              <div id={INTERVIEW_CARD_IDS.progress} className="scroll-mt-4">
                <ProgressPanel
                  textbookData={textbookProgressData}
                  goals={textbookGoals}
                  loading={progressLoading}
                />
              </div>
              <div id={INTERVIEW_CARD_IDS.discipline} className="scroll-mt-4">
                <DisciplinePanel sessions={disciplineSessions} loading={lightLoading} />
              </div>
            </div>

            {/* ★タスクは最下段。ほとんど使われていないのに最上段を占めていた */}
            <div className="mt-5">
              <InterviewTasksCard
                studentId={student.id}
                schoolId={student.school_id}
                interviews={interviews}
                loading={lightLoading}
                onChanged={refetchInterviews}
              />
            </div>
          </div>

          {/* 印刷シート（画面には出ない。印刷時のみ表示。globals.css の interviewreport ページを使用） */}
          <InterviewPrintSheet
            student={student}
            today={today}
            interviews={interviews}
            assessments={assessments}
            textbookData={textbookProgressData}
            disciplineSessions={disciplineSessions}
            koushuEnrollments={koushuEnrollments}
            koushuSummaries={koushuSummaries}
            regularPatterns={regularPatterns}
            examGoals={examGoals}
            targetSchools={targetSchools}
            mockSchools={mockSchools}
            testPrep={testPrep}
            shukaisu={shukaisu}
            mockApplications={mockApplications}
            subjectNames={subjectNames}
            script={script}
          />
        </>
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}
