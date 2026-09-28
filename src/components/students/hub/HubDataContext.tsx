'use client';

/**
 * 生徒ハブで複数のセクションが使うデータを、生徒1人につき1回だけ取る場所。
 *
 * ★なぜあるか: 同じデータを複数のセクションが使う。セクションごとに取ると、同じものを2回取りに行き、
 *   同時リクエストが増える（docs/student-hub-plan.md §2）。ここで生徒ごとに1回だけ取り、各セクションはここから読む。
 *   - 成績（listAssessments）: 今の状態・成績・志望校（useTargetProposals が偏差値・内申を成績から読む）
 *   - 面談記録（getStudentInterviews）: 今の状態（前回の面談）・気にすること（未完了の約束）
 *   - 宿題・遅刻のセッション（getStudentDisciplineSessions）: 今の状態・宿題・遅刻・出欠
 *   - 進行表（テキスト・進み具合・目標）: 今の状態・進行表
 *   ★面談欄の InterviewList は自分で面談記録を取る（追加・完了の操作を持つ部品で、中を変えないため）。
 *     そこだけは二重に取っている。
 * ★取り始めるのは「最初に使うセクションがマウントされたとき」。Provider を置いただけでは取らない
 *   （見えてから読み込む方針を崩さないため）。どのセクションが先に来ても、取るのは1回。
 * ★取り方・加工は面談ワークスペース（src/app/interview/InterviewWorkspace.tsx）と同じにする。
 *   違えると同じパネルなのに面談画面とハブで中身が食い違う。直すときは両方を見ること。
 * ★生徒が変わったら Provider ごと作り直す（page.tsx で key={studentId}）。前の生徒のデータを残さない。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { listAssessments } from '@/lib/api/assessments';
import { getStudentTargetSchools, type TargetSchoolRow } from '@/lib/api/targetSchools';
import { getStudentMockSchools, type MockSchoolRecord } from '@/lib/api/mockTargetSchools';
import { getStudentInterviews } from '@/lib/api/interviews';
import { getStudentTextbooks, getStudentProgress } from '@/lib/api/progress';
import {
  getStudentDisciplineSessions,
  getFeedGoalsByTextbooks,
  type DisciplineSessionRow,
  type FeedGoalSummary,
} from '@/lib/api/progress-sessions';
import { treatZeroScoresAsMissing } from '@/lib/interview/story';
import { whenNetworkIdle } from '@/lib/utils/networkIdle';
import type { TextbookProgressData } from '@/app/interview/ProgressPanel';
import type { AssessmentWithScores, StudentInterview } from '@/types/database';

/** 進行表（面談ワークスペースの ProgressPanel に渡す形） */
export interface HubProgressData {
  textbookData: TextbookProgressData[];
  goals: Record<string, FeedGoalSummary>;
}

/**
 * 宿題・遅刻の集計対象の開始日（今日から遡って6ヶ月前の月の1日）。
 * 面談画面（InterviewWorkspace）と同じ期間。DisciplinePanel は6ヶ月分を表に出す
 */
function disciplineFromDate(): string {
  const from = new Date();
  from.setDate(1);
  from.setMonth(from.getMonth() - 5);
  return `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-01`;
}

interface HubData {
  /** null = まだ取っていない／取得中 */
  assessments: AssessmentWithScores[] | null;
  targetSchools: TargetSchoolRow[] | null;
  mockSchools: MockSchoolRecord[] | null;
  interviews: StudentInterview[] | null;
  interviewsFailed: boolean;
  disciplineSessions: DisciplineSessionRow[] | null;
  progress: HubProgressData | null;
  ensureAssessments: () => void;
  ensureTargetSchools: () => void;
  ensureInterviews: () => void;
  ensureDiscipline: () => void;
  ensureProgress: () => void;
  /** 志望校だけ取り直す（TargetSchoolsPanel の保存直後。面談の refetchTargetSchools と同じ） */
  refetchTargetSchools: () => Promise<void>;
}

const HubDataContext = createContext<HubData | null>(null);

export function HubDataProvider({
  studentId,
  children,
}: {
  studentId: string;
  children: ReactNode;
}) {
  const [assessments, setAssessments] = useState<AssessmentWithScores[] | null>(null);
  const [targetSchools, setTargetSchools] = useState<TargetSchoolRow[] | null>(null);
  const [mockSchools, setMockSchools] = useState<MockSchoolRecord[] | null>(null);
  const [interviews, setInterviews] = useState<StudentInterview[] | null>(null);
  const [interviewsFailed, setInterviewsFailed] = useState(false);
  const [disciplineSessions, setDisciplineSessions] = useState<DisciplineSessionRow[] | null>(null);
  const [progress, setProgress] = useState<HubProgressData | null>(null);
  // 取り始めたかどうか。state ではなく ref で持つ（同じ描画中に2つのセクションが同時に
  // ensure を呼んでも、2本目を出さないため）
  const assessmentsStarted = useRef(false);
  const targetsStarted = useRef(false);
  const interviewsStarted = useRef(false);
  const disciplineStarted = useRef(false);
  const progressStarted = useRef(false);
  // アンマウント後（生徒の切り替え・ページ離脱）に結果を書き込まない
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const ensureAssessments = useCallback(() => {
    if (assessmentsStarted.current) return;
    assessmentsStarted.current = true;
    listAssessments(studentId)
      .catch(() => [] as AssessmentWithScores[])
      .then((asm) => {
        if (!alive.current) return;
        // ★0点は未入力として扱う（テストが無かった回に0を入れる運用のため）。面談画面と同じ読み替えで、
        //   保存されている値は変えない（lib/interview/story.ts の treatZeroScoresAsMissing）
        setAssessments(treatZeroScoresAsMissing(asm));
      });
  }, [studentId]);

  const ensureTargetSchools = useCallback(() => {
    if (targetsStarted.current) return;
    targetsStarted.current = true;
    Promise.all([
      getStudentTargetSchools(studentId).catch(() => [] as TargetSchoolRow[]),
      // ★表がまだ無い環境（マイグレーション未適用）でも開けるよう、失敗は空で受ける（面談と同じ）
      getStudentMockSchools(studentId).catch(() => [] as MockSchoolRecord[]),
    ]).then(([schools, mocks]) => {
      if (!alive.current) return;
      setTargetSchools(schools);
      setMockSchools(mocks);
    });
  }, [studentId]);

  const ensureInterviews = useCallback(() => {
    if (interviewsStarted.current) return;
    interviewsStarted.current = true;
    getStudentInterviews(studentId)
      .then((rows) => {
        if (alive.current) setInterviews(rows);
      })
      .catch((e) => {
        console.error('Error fetching interviews for hub:', e);
        if (!alive.current) return;
        // 失敗は「空」と区別して持つ（約束が0件なのか読めなかったのかを画面で言い分けるため）
        setInterviewsFailed(true);
        setInterviews([]);
      });
  }, [studentId]);

  const ensureDiscipline = useCallback(() => {
    if (disciplineStarted.current) return;
    disciplineStarted.current = true;
    getStudentDisciplineSessions(studentId, disciplineFromDate())
      .catch(() => [] as DisciplineSessionRow[])
      .then((rows) => {
        if (alive.current) setDisciplineSessions(rows);
      });
  }, [studentId]);

  const ensureProgress = useCallback(() => {
    if (progressStarted.current) return;
    progressStarted.current = true;
    (async () => {
      try {
        const raw = await getStudentTextbooks(studentId);
        // 進行表パネルに出すのは「進行表で管理中」のテキストのみ（/progress ページ・面談画面と同じ絞り込み）
        const tracked = raw.filter((t) => t.track_progress);
        // 進行記録はテキストごとに取るが、目標・行動目標は全テキストまとめて1回で取れる
        const [textbookData, goals] = await Promise.all([
          Promise.all(
            tracked.map(async (textbook) => ({
              textbook,
              rows: await getStudentProgress(textbook.id).catch(() => []),
            }))
          ),
          getFeedGoalsByTextbooks(tracked.map((t) => t.id)).catch(
            () => ({}) as Record<string, FeedGoalSummary>
          ),
        ]);
        if (alive.current) setProgress({ textbookData, goals });
      } catch (e) {
        // 面談画面と同じく、失敗は空で見せる（パネルは進行表なしの表示になる）
        console.error('Error fetching progress:', e);
        if (alive.current) setProgress({ textbookData: [], goals: {} });
      }
    })();
  }, [studentId]);

  const refetchTargetSchools = useCallback(async () => {
    try {
      const schools = await getStudentTargetSchools(studentId);
      if (alive.current) setTargetSchools(schools);
    } catch (e) {
      console.error('Error fetching target schools:', e);
    }
  }, [studentId]);

  const value = useMemo<HubData>(
    () => ({
      assessments,
      targetSchools,
      mockSchools,
      interviews,
      interviewsFailed,
      disciplineSessions,
      progress,
      ensureAssessments,
      ensureTargetSchools,
      ensureInterviews,
      ensureDiscipline,
      ensureProgress,
      refetchTargetSchools,
    }),
    [
      assessments,
      targetSchools,
      mockSchools,
      interviews,
      interviewsFailed,
      disciplineSessions,
      progress,
      ensureAssessments,
      ensureTargetSchools,
      ensureInterviews,
      ensureDiscipline,
      ensureProgress,
      refetchTargetSchools,
    ]
  );

  return <HubDataContext.Provider value={value}>{children}</HubDataContext.Provider>;
}

function useHubData(): HubData {
  const ctx = useContext(HubDataContext);
  if (!ctx) throw new Error('HubDataProvider の内側で使ってください');
  return ctx;
}

/** 成績。使うセクションがマウントされたときに（まだなら）取り始める */
export function useHubAssessments(): { assessments: AssessmentWithScores[]; loading: boolean } {
  const { assessments, ensureAssessments } = useHubData();
  useEffect(() => {
    ensureAssessments();
  }, [ensureAssessments]);
  return { assessments: assessments ?? EMPTY_ASSESSMENTS, loading: assessments === null };
}

/** 志望校と模試の志望校。使うセクションがマウントされたときに（まだなら）取り始める */
export function useHubTargetSchools(): {
  targetSchools: TargetSchoolRow[];
  mockSchools: MockSchoolRecord[];
  loading: boolean;
  refetchTargetSchools: () => Promise<void>;
} {
  const { targetSchools, mockSchools, ensureTargetSchools, refetchTargetSchools } = useHubData();
  useEffect(() => {
    ensureTargetSchools();
  }, [ensureTargetSchools]);
  return {
    targetSchools: targetSchools ?? EMPTY_TARGETS,
    mockSchools: mockSchools ?? EMPTY_MOCKS,
    loading: targetSchools === null,
    refetchTargetSchools,
  };
}

/** 面談記録（約束＝task を含む全件・新しい順）。使うセクションがマウントされたときに（まだなら）取り始める */
export function useHubInterviews(): {
  interviews: StudentInterview[];
  loading: boolean;
  failed: boolean;
} {
  const { interviews, interviewsFailed, ensureInterviews } = useHubData();
  useEffect(() => {
    ensureInterviews();
  }, [ensureInterviews]);
  return {
    interviews: interviews ?? EMPTY_INTERVIEWS,
    loading: interviews === null,
    failed: interviewsFailed,
  };
}

/** 宿題・遅刻のセッション（直近6ヶ月）。使うセクションがマウントされたときに（まだなら）取り始める */
export function useHubDisciplineSessions(): { sessions: DisciplineSessionRow[]; loading: boolean } {
  const { disciplineSessions, ensureDiscipline } = useHubData();
  useEffect(() => {
    ensureDiscipline();
  }, [ensureDiscipline]);
  return { sessions: disciplineSessions ?? EMPTY_SESSIONS, loading: disciplineSessions === null };
}

/**
 * 進行表（テキスト・進み具合・目標）。
 *
 * afterIdle=true なら、ページ上部の取得の群れが捌けてから（whenNetworkIdle）取り始める。
 * ★進行表はテキストの数だけ取得が走る重い取得なので、ページを開いてすぐ見える「今の状態」からは
 *   後回しにする（同時リクエストで接続プールを飽和させないため。networkIdle.ts の冒頭コメント）。
 *   下の進行表セクションは見えてから読み込む（LazySection）ので、待たずに取り始めてよい。
 *   どちらが先でも取るのは1回。
 */
export function useHubProgress(afterIdle = false): {
  progress: HubProgressData;
  loading: boolean;
} {
  const { progress, ensureProgress } = useHubData();
  useEffect(() => {
    if (!afterIdle) {
      ensureProgress();
      return;
    }
    let disposed = false;
    void whenNetworkIdle().then(() => {
      if (!disposed) ensureProgress();
    });
    return () => {
      disposed = true;
    };
  }, [afterIdle, ensureProgress]);
  return { progress: progress ?? EMPTY_PROGRESS, loading: progress === null };
}

// ★空配列は定数で持つ。描画のたびに新しい [] を返すと、useTargetProposals などの
//   useMemo／useEffect の依存が毎回変わり、取り直しや再計算が走る
const EMPTY_ASSESSMENTS: AssessmentWithScores[] = [];
const EMPTY_TARGETS: TargetSchoolRow[] = [];
const EMPTY_MOCKS: MockSchoolRecord[] = [];
const EMPTY_INTERVIEWS: StudentInterview[] = [];
const EMPTY_SESSIONS: DisciplineSessionRow[] = [];
const EMPTY_PROGRESS: HubProgressData = { textbookData: [], goals: {} };
