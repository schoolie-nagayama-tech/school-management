'use client';

/**
 * 生徒ハブで複数のセクションが使うデータを、生徒1人につき1回だけ取る場所。
 *
 * ★なぜあるか: 成績（listAssessments）は「成績」セクションと「志望校」セクション
 *   （useTargetProposals が本人の偏差値・内申を成績から読む）の両方が要る。セクションごとに取ると、
 *   同じ成績を2回取りに行き、同時リクエストが増える（docs/student-hub-plan.md §2）。
 *   ここで生徒ごとに1回だけ取り、両方のセクションはここから読む。
 * ★取り始めるのは「最初に使うセクションが画面に近づいたとき」。Provider を置いただけでは取らない
 *   （見えてから読み込む方針を崩さないため）。どちらのセクションが先に見えても、取るのは1回。
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
import { treatZeroScoresAsMissing } from '@/lib/interview/story';
import type { AssessmentWithScores } from '@/types/database';

interface HubData {
  /** null = まだ取っていない／取得中 */
  assessments: AssessmentWithScores[] | null;
  targetSchools: TargetSchoolRow[] | null;
  mockSchools: MockSchoolRecord[] | null;
  ensureAssessments: () => void;
  ensureTargetSchools: () => void;
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
  // 取り始めたかどうか。state ではなく ref で持つ（同じ描画中に2つのセクションが同時に
  // ensure を呼んでも、2本目を出さないため）
  const assessmentsStarted = useRef(false);
  const targetsStarted = useRef(false);
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
      ensureAssessments,
      ensureTargetSchools,
      refetchTargetSchools,
    }),
    [
      assessments,
      targetSchools,
      mockSchools,
      ensureAssessments,
      ensureTargetSchools,
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

// ★空配列は定数で持つ。描画のたびに新しい [] を返すと、useTargetProposals などの
//   useMemo／useEffect の依存が毎回変わり、取り直しや再計算が走る
const EMPTY_ASSESSMENTS: AssessmentWithScores[] = [];
const EMPTY_TARGETS: TargetSchoolRow[] = [];
const EMPTY_MOCKS: MockSchoolRecord[] = [];
