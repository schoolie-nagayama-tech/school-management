'use client';

/**
 * 授業報告書フォーム（P1-14 で進行表と統合・上下2段構成）
 *
 * URL: /lesson-reports/[scheduleEntryId]
 *
 * 入力コンセプト（要件定義 §7-4）:
 *   「選ぶものはクリック、質が要る文章だけ手書き」。
 *   講師の仕事を楽にして、授業とコミュニケーションに時間を使えるようにする。
 *   定型文の自動組み立ては陳腐になるため使わない（却下済み）。
 *
 * 画面構成（正典: docs/lesson-report-session-merge-plan.md）:
 *   上段＝報告書の内容 / 下段＝進行表 の2段構成。
 *   - ヘッダー行（生徒・学年・教材・授業日時・講師・次回授業日）
 *   - 目標ヘッダー（試験目標／行動目標／期日カウントダウン）… 進行表と同期・表示のみ
 *   - 保護者に公開されるゾーン（緑）
 *       今日の目標 / 本日の指導範囲（★下段の進行表から自動反映）/ 学校の進度（自動反映）/
 *       本日の様子（遅刻・宿題未実施のトグルピル）/ 次回の予定（★進行表の続きを自動提案）/
 *       宿題・演習の達成度 / 確認テスト / 講評 / 次回までの宿題（日割り）/ 科目別欄
 *   - 教室内のみのゾーン（グレー破線）: 引継ぎ
 *   - スティッキーバー（公開ゾーンが画面上端から消えたら出る・指導範囲の要約＋報告書へ戻る）
 *   - 下段: 進行表（教材セットの切替・追加・削除もここ）
 *
 * ★ 「本日の指導範囲」は手入力させない:
 *   下段の進行表グリッドでセルをクリックした結果を上段にチップで自動反映するだけ。
 *   上段のチップは読み取り専用で、解除は下段の同じセルをもう一度クリックする
 *   （選択状態の正典を1か所（selections）に保つため、上段からは編集させない）。
 *
 * ★ 遅刻・宿題未実施は保護者公開:
 *   従来は内部ゾーンのチェックボックスだったが、保護者にとっては「今日どうだったか」の
 *   一次情報なので公開ゾーンのトグルピルに変更した（決定4）。宿題未実施マークと
 *   「やってきた量(%)」は双方向同期する（規則は lib/lesson-reports/homeworkMark.ts）。
 *
 * 記入支援4機能（フェーズ2・正典は同じ計画書の「フェーズ2」節）:
 *   A. 前回の授業 … 進行表の授業記録（progress_sessions）を一次情報にした折りたたみカード。
 *      報告書がまだ運用されていないため class_reports だけでは空になる（§A の表を参照）。
 *   G. 下書きの自動保存 … 手動の「下書き保存」と同じ persist() を、黙って・間引いて呼ぶだけ。
 *      別経路を作らない。提出済み・承認済みは動かさない（裏で書き換えない）。
 *   E. 保護者プレビュー … 保護者が実際に見る ReportDetail をそのまま 375px 幅で描く。
 *   F. 提出前チェック … 提出ボタンは押せるまま。足りない項目を挙げてその欄へ連れて行く。
 *
 * 機能D「次回の予定」（正典: docs/lesson-report-next-plan.md）:
 *   既定は「進行表通り」＝今日やった単元より後ろで、まだ3回とも埋まっていない先頭の1単元を
 *   自動で入れる（実データの引継ぎに「次回：進行表通り」の手打ちが多数あり、それを置き換える）。
 *   講師が「変更」で選び直したらその教材セットは自動追従をやめる（selections.nextPlanManual）。
 *   保存されるのは最終的に表示されている単元IDで、「自動か手動か」はDBに持たない。
 *   進行表側は progress_sessions.next_plan_curriculum_item_ids（ID）、保護者側は
 *   class_reports.next_plan（名前のスナップショット）。
 *
 * 保存の二系統（どちらも既存の経路をそのまま使う。新しい保存先は作らない）:
 *   1. class_reports … upsertClassReport（提出→室長承認→差し戻しのワークフローは変更なし）
 *   2. 進行表 … recordSession（progress-sessions.ts）。学習単元・学校進度・引継ぎ・フラグは
 *      授業記録パネルとまったく同じ組み立て方で渡す。進行表側から見ても従来どおり読める。
 *      保存した報告書の id を reportId として渡し、progress_sessions.report_id に紐づける。
 *      ★ 引継ぎの「セッション/行」分離は意図的な既存設計。ここで独自同期を作らないこと。
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent } from '@/components/ui';
import { Button } from '@/components/ui';
import { ToastContainer, Loading } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useAuth } from '@/contexts/AuthContext';
import {
  getPreviousLessonForStudent,
  getReportByScheduleEntry,
  upsertClassReport,
  type PreviousLessonSummary,
} from '@/lib/api/class-reports';
import type {
  ClassReport,
  ClassReportFormData,
  NextPlanSnapshotItem,
  SubjectSpecific,
} from '@/types/class-report';
import { supabase } from '@/lib/supabase';
import { getStudentTextbooks, getStudentProgress } from '@/lib/api/progress';
import { getCurriculumItems } from '@/lib/api/textbooks';
import {
  getFeedGoalsByTextbooks,
  getSessionsByScheduleEntry,
  getSessionsForEdit,
  recordSession,
  type SessionUnitAction,
} from '@/lib/api/progress-sessions';
import type { CurriculumItemWithProgress, StudentTextbookWithDetails } from '@/types/database';
import type { PortalReportDetail } from '@/types/mypage-report';
import {
  AlertCircle,
  ArrowUp,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ClipboardList,
  Compass,
  Eye,
  History,
  Lock,
  Plus,
  RotateCcw,
  Save,
  Send,
  SkipForward,
  Target,
  X,
} from 'lucide-react';
import { DemoProgressPreview } from '@/components/lesson-reports/DemoProgressPreview';
import { LessonReportProgressGrid } from '@/components/lesson-reports/LessonReportProgressGrid';
import { ReportGuideBar } from '@/components/lesson-reports/ReportGuideBar';
import { LessonTaskPopup } from '@/components/bulletin/LessonTaskPopup';
import { computeGuideSteps, type GuideStepInput } from '@/lib/lesson-reports/guideSteps';
import { ReportDetail } from '@/components/mypage/ReportDetail';
import { formatGradeLabelOrEmpty } from '@/lib/utils/gradeLabel';
import { getSurname } from '@/lib/utils/teacherName';
import { applyHomeworkCompletionPct, applyHomeworkMark } from '@/lib/lesson-reports/homeworkMark';
import {
  computeAutoNextPlan,
  resolveNextPlan,
  toNextPlanRows,
  toggleNextPlanUnit,
} from '@/lib/lesson-reports/nextLessonPlan';
import { buildPortalPreview } from '@/lib/lesson-reports/portalPreview';
import {
  validateForSubmit,
  type SubmitCheckField,
  type SubmitCheckIssue,
} from '@/lib/lesson-reports/submitValidation';
import {
  buildHomeworkDateRows,
  compactHomeworkRows,
  computeExamCountdown,
  formatCountdownDays,
  judgeCheckTestPassed,
  mergeHomeworkRows,
  todayInJst,
  type ExamCountdown,
} from '@/lib/lesson-reports/reportSchedule';

// 座席表系テーブルは Database 型未登録なので any でクエリ
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface ScheduleEntryInfo {
  id: string;
  school_id: string;
  entry_date: string;
  student_id: string;
  teacher_id: string;
  subject_ids: string[];
  /** 45分授業のときだけ入る（NULL=コマ丸ごと）。講師のAIサポートの経過の計算に使う */
  duration_minutes?: number | null;
  /** 45分授業がコマのどちら側を使うか。'second' なら授業の開始はコマ開始の45分後 */
  half_position?: 'first' | 'second' | null;
  time_slot?: { slot_number: number; start_time: string; end_time: string };
  student?: { id: string; last_name: string; first_name: string; grade: number };
  /** last_name は報告書に苗字だけを出すために取る（getSurname のフォールバックより確実） */
  teacher?: {
    id: string;
    display_name: string | null;
    last_name?: string | null;
    email: string | null;
  };
}

interface StudentTextbookOption {
  id: string;
  textbook_id: number;
  textbook_name: string;
  curriculum_items: Array<{ id: number; title: string; sort_order: number }>;
}

/** 目標ヘッダーに出す中期目標（進行表と同期・この画面では編集しない） */
interface GoalHeader {
  examLabel: string;
  examDate: string | null;
  targetScore: number | null;
  examRange: string | null;
  actionGoals: string[];
}

/** 教材（student_textbook）ごとの進行表グリッド選択状態 */
interface GridSelectionState {
  unitActions: Record<number, 1 | 2 | 3>;
  schoolUnits: Set<number>;
  /** 読込時点で学校進度がついていた単元ID（外されたものを検出してクリアするため） */
  origSchoolUnitIds: number[];
  /** 既存セッションID（再保存時に上書き更新して二重作成を防ぐ） */
  sessionId: string | null;
  /**
   * 機能D「次回の予定」の手動値。null = 自動（進行表通り・今日の選択に追従）。
   * 講師が一度でもピッカーを触ったら配列になり、以後この教材セットは自動追従をやめる。
   * 手で全部外した「空」も [] として保持する（自動に戻すのはピッカーの
   * 「進行表通りに戻す」だけ）。
   */
  nextPlanManual: number[] | null;
}

/** 上段「本日の指導範囲」に出すチップ1つ */
interface TaughtChip {
  curriculumItemId: number;
  title: string;
  lessonNumber: 1 | 2 | 3;
}

const emptySelection = (): GridSelectionState => ({
  unitActions: {},
  schoolUnits: new Set(),
  origSchoolUnitIds: [],
  sessionId: null,
  nextPlanManual: null,
});

/**
 * ガイドバーの表示/非表示を覚えるキー（既定=表示。× を押したときだけ 'hidden' を書く）。
 * 手動の「済」は保存しない（設計書 §3）。ここで持つのは見せるか見せないかだけ。
 */
const GUIDE_STORAGE_KEY = 'lesson_report_guide';

/** 自動保存: 最後の変更からこの時間だけ何も起きなければ1回だけ走らせる（ミリ秒）。 */
const AUTO_SAVE_DELAY_MS = 3000;

/** 自動保存の表示状態。トーストは出さず、フッターの文言だけを変える。 */
type AutoSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/**
 * 自動保存の「無変更なら叩かない」判定に使うスナップショット（内容だけの指紋）。
 *
 * ★ 何を入れないかが重要:
 *   - `sessionId` / `origSchoolUnitIds` … 保存が成功したときにサーバから返ってきて
 *     selections に書き戻される値。これを含めると「保存 → 状態が変わる → また保存」の
 *     無限ループになる。
 *   - 宿題の空行 … 授業日が確定した瞬間に日割り行が自動生成されるだけで、講師が
 *     何かを書いたわけではない。保存時も compactHomeworkRows で落としているので、
 *     ここでも同じ圧縮をかけて「開いただけで自動保存が走る」のを防ぐ。
 *   - 次回の予定の **自動値** … 進行表グリッドの行（gridRows）が非同期で届いた瞬間に
 *     [] → [単元] と変わるだけで、講師は何も触っていない。これを含めると
 *     「開いただけで自動保存が走る」（＝下書きが勝手に作られる）。
 *     自動値は今日の選択（unitActions）から一意に決まり、その unitActions は
 *     下でちゃんと指紋に入っているので、追従ぶんの変更は取りこぼさない。
 *   ★ 逆に、次回の予定の **手動値**（nextPlanManual）は必ず入れること。
 *     ピッカーで選び直しただけのときに自動保存が走らなくなる。
 *     手動値は保存成功時に書き戻されないので、無限ループにはならない。
 *   Set は JSON にできないので、並びを固定した配列に直してから文字列にする。
 */
function buildAutoSaveSnapshot(
  form: ClassReportFormData,
  handover: string,
  selections: Record<string, GridSelectionState>
): string {
  return JSON.stringify({
    form: { ...form, homework_assignments: compactHomeworkRows(form.homework_assignments) },
    handover,
    selections: Object.keys(selections)
      .sort()
      .map((key) => ({
        key,
        unitActions: selections[key].unitActions,
        schoolUnits: Array.from(selections[key].schoolUnits).sort((a, b) => a - b),
        // 手動値は null（自動）と [] （手動で空）を区別したいので、そのまま載せる
        nextPlanManual: selections[key].nextPlanManual,
      })),
  });
}

/**
 * 実行中のフラグ（ref）が下りるまで待つ。
 * 手動保存が自動保存とかち合ったときに、押した操作を捨てずに順番待ちさせるために使う
 * （同じ upsert 経路を同時に走らせると、報告書を二重に作りにいくレースになる）。
 */
async function waitForIdle(flag: React.MutableRefObject<boolean>, timeoutMs: number) {
  const start = Date.now();
  while (flag.current) {
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
}

/**
 * 生徒の授業予定日を取得する。
 * - nextLessonDate: 宿題の日割り生成に使う「次回授業日」（振替で入ったコマも授業なので含める）
 * - scheduledDates: 期日カウントダウンの「授業あと◯回」に使う（要件どおり status='scheduled' のみ）
 *
 * 1生徒の未来の予定は多くても数十件なので PostgREST の1000行上限には触れない。
 */
async function getLessonDates(
  studentId: string,
  fromDate: string
): Promise<{ nextLessonDate: string | null; scheduledDates: string[] }> {
  const { data } = await db
    .from('schedule_entries')
    .select('entry_date, status')
    .eq('student_id', studentId)
    .gte('entry_date', fromDate)
    .in('status', ['scheduled', 'transferred_in'])
    .order('entry_date', { ascending: true });

  const rows = (data || []) as Array<{ entry_date: string; status: string }>;
  return {
    nextLessonDate: rows.find((r) => r.entry_date > fromDate)?.entry_date ?? null,
    scheduledDates: rows.filter((r) => r.status === 'scheduled').map((r) => r.entry_date),
  };
}

export default function LessonReportFormPage() {
  const params = useParams();
  const router = useRouter();
  const { profile } = useAuth();
  const { toasts, removeToast, success, error: toastError } = useToast();
  const scheduleEntryId = params.scheduleEntryId as string;
  // デモモード: /lesson-reports/demo でアクセスすると、DBを使わずダミーデータで
  // 実際の入力フォームを開く。保存・提出は無効化（見本のため）。
  const isDemo = scheduleEntryId === 'demo';

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [entry, setEntry] = useState<ScheduleEntryInfo | null>(null);
  const [existingReport, setExistingReport] = useState<ClassReport | null>(null);
  const [textbookOptions, setTextbookOptions] = useState<StudentTextbookOption[]>([]);
  const [nextLessonDate, setNextLessonDate] = useState<string | null>(null);
  const [scheduledDates, setScheduledDates] = useState<string[]>([]);
  const [goalHeader, setGoalHeader] = useState<GoalHeader | null>(null);

  // 進行表グリッド（教材ごとの単元行）と、その選択状態
  const [gridRows, setGridRows] = useState<Record<string, CurriculumItemWithProgress[]>>({});
  const [selections, setSelections] = useState<Record<string, GridSelectionState>>({});

  // 引継ぎ（進行表の授業記録と同じ保存先へ書く内部項目。class_reports には列が無い）
  const [handover, setHandover] = useState('');

  // フォーム状態
  const [form, setForm] = useState<ClassReportFormData>({
    schedule_entry_id: scheduleEntryId,
    student_id: '',
    teacher_id: '',
    lesson_date: '',
    short_term_goal: '',
    mid_term_goal_snapshot: '',
    mid_action_goal_snapshot: '',
    school_progress: '',
    tardy: false,
    homework_not_done: false,
    homework_completion_pct: null,
    homework_correct_pct: null,
    today_correct_pct: null,
    vocab_test_score: null,
    vocab_test_total: null,
    vocab_test_passed: null,
    check_test_score: null,
    check_test_total: null,
    check_test_passed: null,
    review_comment: '',
    homework_assignments: [],
    // ★ 次回の予定は state では常に空。表示・保存の正典は selections（進行表グリッドの選択）
    //   から毎回組み立てる。ここに実値を入れると自動保存の指紋が保存のたびに揺れる。
    next_plan: [],
    subject_specific: null,
    status: 'draft',
    units: [],
  });

  // スティッキーバー: 公開ゾーンが画面上端から消えたら出す。
  // センチネル（公開ゾーンの直後に置いた高さ0の目印）が上へ抜けたかどうかで判定する。
  const publicZoneRef = useRef<HTMLDivElement>(null);
  const publicZoneEndRef = useRef<HTMLDivElement>(null);
  const [showStickyBar, setShowStickyBar] = useState(false);

  // ---- A: 前回の授業（進行表の授業記録が一次情報。無ければカードごと出さない） ----
  const [previousLesson, setPreviousLesson] = useState<PreviousLessonSummary | null>(null);

  // ---- D: 次回の予定（ピッカーを開いている教材セットのID。null = 閉じている） ----
  const [nextPlanPickerFor, setNextPlanPickerFor] = useState<string | null>(null);

  // ---- E: 保護者プレビュー ----
  const [showPortalPreview, setShowPortalPreview] = useState(false);

  // ---- F: 提出前チェック（不足項目からその入力欄へ飛ばすための参照） ----
  const [showSubmitIssues, setShowSubmitIssues] = useState(false);
  const progressSectionRef = useRef<HTMLElement>(null);
  const extraMaterialsRef = useRef<HTMLInputElement>(null);
  const handoverRef = useRef<HTMLTextAreaElement>(null);
  const reviewRef = useRef<HTMLTextAreaElement>(null);

  // ---- ガイドバー（正典: docs/lesson-report-flow-plan.md §3）----
  // 見せ方だけの機能。フォーム state・保存経路には一切関与しない。
  const [guideVisible, setGuideVisible] = useState(true);
  // 「該当なし」等で手動で済にした質問。★保存しない（ページ内だけ・設計書§3の判断）
  const [guideManualDone, setGuideManualDone] = useState<ReadonlySet<string>>(new Set<string>());
  // 「ここに答える」で光らせている要素と、その消灯タイマー（アンマウント時に片付ける）
  const guideHighlightElRef = useRef<HTMLElement | null>(null);
  const guideHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- G: 下書きの自動保存 ----
  const [autoSaveState, setAutoSaveState] = useState<AutoSaveState>('idle');
  const [autoSavedAt, setAutoSavedAt] = useState<string | null>(null);
  // ★ ミューテックスは ref（useState ではない）:
  //   state は次のレンダーまで反映されないため、3秒タイマーと手動クリックが重なると
  //   「どちらもまだ保存中ではない」と判定して二重に走る。ref なら同期的に立つ。
  const savingRef = useRef(false);
  // 最後に保存できた時点のスナップショット。これと同じなら自動保存を叩かない。
  // null の間（＝初期ロード完了前）は自動保存そのものを動かさない。
  const lastSavedSnapshotRef = useRef<string | null>(null);

  // ---- 初期データ取得 ----
  const load = useCallback(async () => {
    setIsLoading(true);
    // デモモード: DBを使わずダミーデータで実フォームを表示
    if (isDemo) {
      loadDemo({
        setEntry,
        setNextLessonDate,
        setScheduledDates,
        setGoalHeader,
        setTextbookOptions,
        setGridRows,
        setSelections,
        setHandover,
        setForm,
        setPreviousLesson,
      });
      setIsLoading(false);
      return;
    }
    try {
      // 1. schedule_entry を取得
      const { data: entryRow, error: entryErr } = await db
        .from('schedule_entries')
        .select(
          '*, time_slot:schedule_time_slots(slot_number, start_time, end_time), student:students(id, last_name, first_name, grade), teacher:user_profiles!schedule_entries_teacher_id_fkey(id, display_name, last_name, email)'
        )
        .eq('id', scheduleEntryId)
        .single();
      if (entryErr || !entryRow) {
        toastError('授業情報の取得に失敗しました');
        return;
      }
      const e = entryRow as ScheduleEntryInfo & {
        time_slot?:
          | { slot_number: number; start_time: string; end_time: string }
          | Array<{ slot_number: number; start_time: string; end_time: string }>;
        student?: ScheduleEntryInfo['student'] | Array<NonNullable<ScheduleEntryInfo['student']>>;
        teacher?: ScheduleEntryInfo['teacher'] | Array<NonNullable<ScheduleEntryInfo['teacher']>>;
      };
      const info: ScheduleEntryInfo = {
        id: e.id,
        school_id: e.school_id,
        entry_date: e.entry_date,
        student_id: e.student_id,
        teacher_id: e.teacher_id,
        subject_ids: e.subject_ids || [],
        time_slot: Array.isArray(e.time_slot) ? e.time_slot[0] : e.time_slot,
        student: Array.isArray(e.student) ? e.student[0] : e.student,
        teacher: Array.isArray(e.teacher) ? e.teacher[0] : e.teacher,
      };
      setEntry(info);

      // 2. 授業予定日（次回授業日＝宿題の日割り / 予定件数＝カウントダウン）。
      //    報告書を後日書くこともあるので、授業日と今日の早いほうから拾う。
      //    前回の授業（記入支援）は独立した読み取りなので同時に投げる。
      const today = todayInJst();
      const fromDate = info.entry_date < today ? info.entry_date : today;
      const [lessonDates, previous] = await Promise.all([
        getLessonDates(info.student_id, fromDate),
        getPreviousLessonForStudent(info.student_id, info.entry_date),
      ]);
      setNextLessonDate(lessonDates.nextLessonDate);
      setScheduledDates(lessonDates.scheduledDates);
      setPreviousLesson(previous);

      // 3. 生徒の student_textbooks + 各 textbook の curriculum_items を取得
      const textbooks = await getStudentTextbooks(info.student_id);
      const trackable = textbooks.filter((st) => st.track_progress !== false);
      const options: StudentTextbookOption[] = await Promise.all(
        trackable.map(async (st) => {
          const items = await getCurriculumItems(st.textbook_id);
          return {
            id: st.id,
            textbook_id: st.textbook_id,
            textbook_name: st.textbook?.name ?? `教材#${st.textbook_id}`,
            curriculum_items: items.map((it) => ({
              id: it.id,
              title: it.title,
              sort_order: it.sort_order,
            })),
          };
        })
      );
      setTextbookOptions(options);

      // 4. 既存報告書を取得（あれば編集モード）
      const report = await getReportByScheduleEntry(scheduleEntryId);
      setExistingReport(report);

      const units = report
        ? (report.units ?? []).map((u, idx) => ({
            id: u.id,
            student_textbook_id: u.student_textbook_id,
            is_main: u.is_main,
            curriculum_item_ids: u.curriculum_item_ids,
            page_start: u.page_start,
            page_end: u.page_end,
            display_order: u.display_order ?? idx,
          }))
        : options.length > 0
          ? [
              {
                student_textbook_id: options[0].id,
                is_main: true,
                curriculum_item_ids: [] as number[],
                page_start: null,
                page_end: null,
                display_order: 0,
              },
            ]
          : [];

      if (report) {
        setForm({
          schedule_entry_id: scheduleEntryId,
          student_id: report.student_id,
          teacher_id: report.teacher_id,
          lesson_date: report.lesson_date,
          short_term_goal: report.short_term_goal ?? '',
          mid_term_goal_snapshot: report.mid_term_goal_snapshot ?? '',
          mid_action_goal_snapshot: report.mid_action_goal_snapshot ?? '',
          school_progress: report.school_progress ?? '',
          // 本日の様子マーク。列追加前に保存された古い行は null で返るので false に倒す。
          tardy: report.tardy ?? false,
          homework_not_done: report.homework_not_done ?? false,
          homework_completion_pct: report.homework_completion_pct,
          homework_correct_pct: report.homework_correct_pct,
          today_correct_pct: report.today_correct_pct,
          // 単語テストは UI から外したが、過去データを消さないよう値はそのまま持ち回る
          vocab_test_score: report.vocab_test_score,
          vocab_test_total: report.vocab_test_total,
          vocab_test_passed: report.vocab_test_passed,
          check_test_score: report.check_test_score,
          check_test_total: report.check_test_total,
          check_test_passed: report.check_test_passed,
          review_comment: report.review_comment ?? '',
          homework_assignments: report.homework_assignments ?? [],
          // 次回の予定は保存直前に組み立てる項目なので state には戻さない
          //（表示の正典は下の restoreSessions が復元する selections.nextPlanManual）
          next_plan: [],
          subject_specific: report.subject_specific ?? null,
          status: report.status,
          units,
        });
      } else {
        setForm((f) => ({
          ...f,
          student_id: info.student_id,
          teacher_id: info.teacher_id,
          lesson_date: info.entry_date,
          units,
        }));
      }

      // 5. 目標ヘッダー（メイン教材の試験目標＋行動目標）。既存の一括取得関数を再利用する。
      const mainStbId = (units.find((u) => u.is_main) ?? units[0])?.student_textbook_id ?? null;
      setGoalHeader(mainStbId ? await loadGoalHeader(mainStbId, trackable) : null);

      // 6. このコマに既に紐づいているセッションを復元（下書き保存の再開・再提出で
      //    セッションが増殖しないよう sessionId を握っておく）。
      //    セッションがあればマークの正典はそちら（進行表側で直された可能性があるため）。
      await restoreSessions(
        scheduleEntryId,
        units,
        setSelections,
        setHandover,
        (v) => setForm((f) => ({ ...f, homework_not_done: v })),
        (v) => setForm((f) => ({ ...f, tardy: v }))
      );
    } catch (err) {
      toastError(err instanceof Error ? err.message : '初期化に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [scheduleEntryId, toastError, isDemo]);

  useEffect(() => {
    load();
  }, [load]);

  // ---- ガイドバー: 前回「×」で閉じていたら閉じたまま開く（既定は表示） ----
  // localStorage はサーバー側に無いので、初期値は表示にしておいてマウント後に読み直す。
  useEffect(() => {
    try {
      if (window.localStorage.getItem(GUIDE_STORAGE_KEY) === 'hidden') setGuideVisible(false);
    } catch {
      // 読めない環境（プライベートモード等）では既定の「表示」のままにする
    }
  }, []);

  // ---- 進行表グリッドの行を、フォームで選ばれている教材ぶんだけ取得 ----
  const wantedTextbookIds = useMemo(
    () => form.units.map((u) => u.student_textbook_id).filter(Boolean),
    [form.units]
  );
  // 取得済み／取得中の教材IDを覚えて二重フェッチを防ぐ
  const fetchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (isDemo) return;
    const missing = wantedTextbookIds.filter((id) => !fetchedRef.current.has(id));
    if (missing.length === 0) return;
    missing.forEach((id) => fetchedRef.current.add(id));
    (async () => {
      for (const id of missing) {
        try {
          const rows = await getStudentProgress(id);
          setGridRows((prev) => ({ ...prev, [id]: rows }));
        } catch (err) {
          console.error('進行表グリッドの取得に失敗:', err);
          fetchedRef.current.delete(id); // 失敗したら次の描画で再試行できるようにする
        }
      }
    })();
  }, [wantedTextbookIds, isDemo]);

  // ---- 次回までの宿題: 授業翌日〜次回授業日の日付行を自動生成 ----
  useEffect(() => {
    if (isDemo || !form.lesson_date) return;
    setForm((f) => ({
      ...f,
      homework_assignments: mergeHomeworkRows(
        buildHomeworkDateRows({ lessonDate: f.lesson_date, nextLessonDate }),
        f.homework_assignments
      ),
    }));
    // lesson_date と nextLessonDate が確定したときだけ組み直す（入力中は触らない）
  }, [form.lesson_date, nextLessonDate, isDemo]);

  // ---- スティッキーバーの出し入れ ----
  // 読み込み完了後に初めて DOM が生えるので、isLoading をトリガに監視を張り直す。
  useEffect(() => {
    const sentinel = publicZoneEndRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([e]) => {
        // 「画面内に無い」かつ「上へ抜けた」ときだけ出す。
        // 下端から出ていく（＝まだ読み進めていない）ときに出すと、開いた瞬間から
        // バーが被って邪魔になる。
        setShowStickyBar(!e.isIntersecting && e.boundingClientRect.top < 0);
      },
      { threshold: 0 }
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [isLoading]);

  const scrollToReport = useCallback(() => {
    publicZoneRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // ---- 期日カウントダウン ----
  const countdown: ExamCountdown | null = useMemo(
    () =>
      computeExamCountdown({
        examDate: goalHeader?.examDate,
        today: todayInJst(),
        lessonDates: scheduledDates,
      }),
    [goalHeader?.examDate, scheduledDates]
  );

  // 確認テストの合否は得点から自動判定する（講師が合否ボタンを押さなくて済むように）
  const checkTestPassed = useMemo(
    () => judgeCheckTestPassed(form.check_test_score, form.check_test_total),
    [form.check_test_score, form.check_test_total]
  );

  const reviewLineCount = useMemo(
    () => (form.review_comment ? form.review_comment.split('\n').length : 0),
    [form.review_comment]
  );

  // ---- グリッドのセルクリック（進行表の授業記録とまったく同じ操作） ----
  const handleCellToggle = useCallback(
    (studentTextbookId: string, curriculumItemId: number, column: 'school' | 1 | 2 | 3) => {
      setSelections((prev) => {
        const cur = prev[studentTextbookId] ?? emptySelection();
        if (column === 'school') {
          const next = new Set(cur.schoolUnits);
          if (next.has(curriculumItemId)) next.delete(curriculumItemId);
          else next.add(curriculumItemId);
          return { ...prev, [studentTextbookId]: { ...cur, schoolUnits: next } };
        }
        const next = { ...cur.unitActions };
        if (next[curriculumItemId] === column) delete next[curriculumItemId];
        else next[curriculumItemId] = column;
        return { ...prev, [studentTextbookId]: { ...cur, unitActions: next } };
      });
    },
    []
  );

  // ---- 本日の様子マーク ⇄ 宿題のやってきた量（％）の同期 ----
  // 規則は純関数（lib/lesson-reports/homeworkMark.ts）に集約。ここは state に載せるだけ。
  const toggleHomeworkNotDone = useCallback(() => {
    setForm((f) => {
      const next = applyHomeworkMark(
        { homeworkNotDone: f.homework_not_done, completionPct: f.homework_completion_pct },
        !f.homework_not_done
      );
      return {
        ...f,
        homework_not_done: next.homeworkNotDone,
        homework_completion_pct: next.completionPct,
      };
    });
  }, []);

  const changeHomeworkCompletionPct = useCallback((v: number | null) => {
    setForm((f) => {
      const next = applyHomeworkCompletionPct(
        { homeworkNotDone: f.homework_not_done, completionPct: f.homework_completion_pct },
        v
      );
      return {
        ...f,
        homework_not_done: next.homeworkNotDone,
        homework_completion_pct: next.completionPct,
      };
    });
  }, []);

  // 教材セット操作
  const usedTextbookIds = new Set(form.units.map((u) => u.student_textbook_id));
  const addUnit = () => {
    // 同じ教材を2つのセットに入れると選択状態（教材IDで保持）が二重になるため、未使用の教材だけ追加できる
    const free = textbookOptions.find((o) => !usedTextbookIds.has(o.id));
    if (!free) {
      toastError('追加できる教材がありません');
      return;
    }
    setForm((f) => ({
      ...f,
      units: [
        ...f.units,
        {
          student_textbook_id: free.id,
          is_main: false,
          curriculum_item_ids: [],
          page_start: null,
          page_end: null,
          display_order: f.units.length,
        },
      ],
    }));
  };
  const removeUnit = (idx: number) =>
    setForm((f) => ({ ...f, units: f.units.filter((_, i) => i !== idx) }));
  const updateUnit = (idx: number, patch: Partial<ClassReportFormData['units'][number]>) =>
    setForm((f) => ({
      ...f,
      units: f.units.map((u, i) => (i === idx ? { ...u, ...patch } : u)),
    }));

  const updateHomeworkText = (idx: number, text: string) =>
    setForm((f) => ({
      ...f,
      homework_assignments: f.homework_assignments.map((a, i) => (i === idx ? { ...a, text } : a)),
    }));

  // プリント等テキスト外の教材の自由記述。専用の列が無いので subject_specific(jsonb) に同居させる
  const extraMaterials = form.subject_specific?.extra_materials ?? '';
  const setExtraMaterials = (v: string) =>
    setForm((f) => ({
      ...f,
      subject_specific: { ...(f.subject_specific ?? { kind: 'none' }), extra_materials: v },
    }));

  // ---- 上段への自動反映（進行表グリッドの選択 → チップ表示） ----
  /**
   * 教材セット1つぶんの「単元名の解決」と「カリキュラム順の順位」。
   * 単元名はグリッド行（進行表の実データ）が正だが、まだ読み込めていないときは
   * 教材の目次から拾う。指導範囲チップ・次回の予定チップ・ピッカーで共通して使う。
   */
  const unitIndexOf = useCallback(
    (studentTextbookId: string) => {
      const rows = gridRows[studentTextbookId] ?? [];
      const opt = textbookOptions.find((o) => o.id === studentTextbookId);
      const titleById = new Map<number, string>();
      for (const it of opt?.curriculum_items ?? []) titleById.set(it.id, it.title);
      for (const r of rows) titleById.set(r.id, r.title);
      const order =
        rows.length > 0 ? rows.map((r) => r.id) : (opt?.curriculum_items ?? []).map((i) => i.id);
      const rank = (id: number) => {
        const i = order.indexOf(id);
        return i < 0 ? Number.MAX_SAFE_INTEGER : i;
      };
      const title = (id: number) => titleById.get(id) ?? `単元#${id}`;
      return { rank, title };
    },
    [gridRows, textbookOptions]
  );

  /** 教材セット1つぶんの「今日やった単元」チップ。カリキュラム順に並べる。 */
  const taughtChipsOf = useCallback(
    (studentTextbookId: string): TaughtChip[] => {
      const sel = selections[studentTextbookId];
      if (!sel) return [];
      const { rank, title } = unitIndexOf(studentTextbookId);
      return Object.entries(sel.unitActions)
        .map(([cid, lessonNumber]) => ({
          curriculumItemId: Number(cid),
          title: title(Number(cid)),
          lessonNumber,
        }))
        .sort((a, b) => rank(a.curriculumItemId) - rank(b.curriculumItemId));
    },
    [selections, unitIndexOf]
  );

  // ---- D: 次回の予定 ----
  /**
   * 教材セットごとの「進行表通り」の自動値。今日の選択（unitActions）に追従する。
   * 判定規則は純関数（lib/lesson-reports/nextLessonPlan.ts）に集約。
   */
  const autoNextPlanOf = useCallback(
    (studentTextbookId: string): number[] =>
      computeAutoNextPlan(
        toNextPlanRows(gridRows[studentTextbookId] ?? []),
        Object.keys(selections[studentTextbookId]?.unitActions ?? {}).map(Number)
      ),
    [gridRows, selections]
  );

  /** 教材セットごとの、実際に画面に出す（＝保存する）次回の予定。カリキュラム順に並べる。 */
  const nextPlanIdsOf = useCallback(
    (studentTextbookId: string): number[] => {
      const { rank } = unitIndexOf(studentTextbookId);
      return resolveNextPlan(
        autoNextPlanOf(studentTextbookId),
        selections[studentTextbookId]?.nextPlanManual ?? null
      ).sort((a, b) => rank(a) - rank(b));
    },
    [autoNextPlanOf, selections, unitIndexOf]
  );

  /**
   * ピッカーで単元をトグルする。初回は今出ている自動値を土台にするので、
   * 「1件足したつもりが自動値ごと消える」ことがない。
   * 触った時点でこの教材セットは自動追従をやめる（手で決めた値を勝手に書き換えない）。
   */
  const handleNextPlanToggle = useCallback(
    (studentTextbookId: string, curriculumItemId: number) => {
      const auto = autoNextPlanOf(studentTextbookId);
      setSelections((prev) => {
        const cur = prev[studentTextbookId] ?? emptySelection();
        return {
          ...prev,
          [studentTextbookId]: {
            ...cur,
            nextPlanManual: toggleNextPlanUnit(cur.nextPlanManual, auto, curriculumItemId),
          },
        };
      });
    },
    [autoNextPlanOf]
  );

  /** 「進行表通りに戻す」= 手動値を捨てて自動追従に戻す。 */
  const handleNextPlanReset = useCallback((studentTextbookId: string) => {
    setSelections((prev) => ({
      ...prev,
      [studentTextbookId]: {
        ...(prev[studentTextbookId] ?? emptySelection()),
        nextPlanManual: null,
      },
    }));
  }, []);

  /**
   * 保護者面（class_reports.next_plan）に写すスナップショット。
   * 単元が1つも無い教材セットは出さない（保護者面で空の見出しを作らないため）。
   */
  const nextPlanSnapshot = useMemo(
    (): NextPlanSnapshotItem[] =>
      form.units
        .map((u) => {
          const { title } = unitIndexOf(u.student_textbook_id);
          return {
            textbookName:
              textbookOptions.find((o) => o.id === u.student_textbook_id)?.textbook_name ?? '教材',
            unitTitles: nextPlanIdsOf(u.student_textbook_id).map(title),
          };
        })
        .filter((item) => item.unitTitles.length > 0),
    [form.units, textbookOptions, unitIndexOf, nextPlanIdsOf]
  );

  /** 学校進度チップ（保存する school_progress 文字列と同じ材料・同じ順序）。 */
  const schoolProgressLabels = useMemo(
    () => buildSchoolProgressLabels(form.units, selections, gridRows, textbookOptions),
    [form.units, selections, gridRows, textbookOptions]
  );

  /** スティッキーバーの要約に使う、全教材セット横断のチップ。 */
  const allTaughtChips = useMemo(
    () => form.units.flatMap((u) => taughtChipsOf(u.student_textbook_id)),
    [form.units, taughtChipsOf]
  );

  // ---- G: 自動保存の変更検知 ----
  // 中身の指紋。これが前回保存時と同じなら自動保存は叩かない。
  const snapshot = useMemo(
    () => buildAutoSaveSnapshot(form, handover, selections),
    [form, handover, selections]
  );
  // 非同期処理の途中から最新の指紋を読むための鏡。レンダーのたびに同じ値を書くだけなので
  // 副作用は無い（effect に持ち込むと1レンダーぶん古い値を掴む）。
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  // ---- F: 提出前チェック ----
  const selectedUnitCount = useMemo(
    () =>
      form.units.reduce(
        (sum, u) => sum + Object.keys(selections[u.student_textbook_id]?.unitActions ?? {}).length,
        0
      ),
    [form.units, selections]
  );
  const submitIssues: SubmitCheckIssue[] = useMemo(
    () =>
      validateForSubmit({
        hasTextbooks: form.units.length > 0,
        selectedUnitCount,
        extraMaterials,
        handover,
        reviewComment: form.review_comment,
      }),
    [form.units.length, selectedUnitCount, extraMaterials, handover, form.review_comment]
  );

  // ---- ガイドバー: いまの入力から「次に答える質問」を出す ----
  /**
   * 判定に使う材料を既存の state から組み立てる。
   * ★ ここに新しい state を足さない。ガイドは既存の入力を読み直しているだけ。
   *   指導範囲・引継ぎ・講評の3つは提出前チェック（validateForSubmit）と同じ条件式になる。
   */
  const guideInput: GuideStepInput = useMemo(
    () => ({
      tardy: form.tardy,
      homeworkNotDone: form.homework_not_done,
      hasTextbooks: form.units.length > 0,
      selectedUnitCount,
      extraMaterials,
      // 達成度スライダーは常に出している（教材の有無に依存しない）ので available は常に true。
      // 「今日は測っていない」は手動の「該当なし」で進める。
      homeworkAchievementAvailable: true,
      homeworkAchievementFilled:
        form.homework_completion_pct != null ||
        form.homework_correct_pct != null ||
        form.today_correct_pct != null,
      checkTestScoreFilled: form.check_test_score != null,
      schoolProgressFilled: schoolProgressLabels.length > 0,
      goal: form.short_term_goal,
      // 次回の予定は進行表の続きが自動提案されるので、たいてい開いた時点で済になる
      nextPlanFilled: nextPlanSnapshot.length > 0,
      // 授業日が未確定だと日割り行そのものが作れない＝答える対象が無い（スキップ）
      homeworkRowsAvailable: form.homework_assignments.length > 0,
      homeworkRowsFilled: form.homework_assignments.some((a) => a.text.trim() !== ''),
      handover,
      review: form.review_comment,
    }),
    [
      form.tardy,
      form.homework_not_done,
      form.units.length,
      selectedUnitCount,
      extraMaterials,
      form.homework_completion_pct,
      form.homework_correct_pct,
      form.today_correct_pct,
      form.check_test_score,
      schoolProgressLabels.length,
      form.short_term_goal,
      nextPlanSnapshot.length,
      form.homework_assignments,
      handover,
      form.review_comment,
    ]
  );
  const guideSteps = useMemo(
    () => computeGuideSteps(guideInput, guideManualDone),
    [guideInput, guideManualDone]
  );

  /** ハイライトを消す（タイマーも止める）。ジャンプのたび・アンマウント時に呼ぶ。 */
  const clearGuideHighlight = useCallback(() => {
    if (guideHighlightTimerRef.current) {
      clearTimeout(guideHighlightTimerRef.current);
      guideHighlightTimerRef.current = null;
    }
    const el = guideHighlightElRef.current;
    if (el) {
      el.classList.remove('ring-2', 'ring-info', 'ring-offset-2', 'rounded-md');
      guideHighlightElRef.current = null;
    }
  }, []);

  /** 「ここに答える」: その質問のセクションへ運んで2秒だけ光らせる（入力はフォーム本体で行う）。 */
  const handleGuideJump = useCallback(
    (targetId: string) => {
      const el = document.getElementById(targetId);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      clearGuideHighlight();
      el.classList.add('ring-2', 'ring-info', 'ring-offset-2', 'rounded-md');
      guideHighlightElRef.current = el;
      guideHighlightTimerRef.current = setTimeout(clearGuideHighlight, 2000);
    },
    [clearGuideHighlight]
  );

  useEffect(() => clearGuideHighlight, [clearGuideHighlight]);

  /** 「該当なし」等: 自動判定できない質問を手動で済にする（保存はしない）。 */
  const handleGuideManualDone = useCallback((id: string) => {
    setGuideManualDone((prev) => {
      // ★ Set のスプレッド展開は ES5 ターゲットで壊れるので Array.from を使う
      const next = new Set(Array.from(prev));
      next.add(id);
      return next;
    });
  }, []);

  /** ×: バーを閉じる。次に開いたときも閉じたままにする。 */
  const handleGuideDismiss = useCallback(() => {
    setGuideVisible(false);
    try {
      window.localStorage.setItem(GUIDE_STORAGE_KEY, 'hidden');
    } catch {
      // プライベートモード等で localStorage が使えなくても機能は止めない
    }
  }, []);

  /** ヘッダーの「ガイドを表示」: 一度消した人が戻せるようにする。 */
  const handleGuideRestore = useCallback(() => {
    setGuideVisible(true);
    try {
      window.localStorage.setItem(GUIDE_STORAGE_KEY, 'shown');
    } catch {
      // 同上
    }
  }, []);

  /** 全問済みのときの「提出へ」: フッター（提出ボタン・提出前チェック）まで運ぶ。 */
  const handleGuideSubmitJump = useCallback(() => {
    document.getElementById('guide-submit')?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, []);

  /**
   * 報告書に出す講師名。フルネームではなく苗字のみにする
   * （報告書は保護者にも渡るため、講師の下の名前まで出さない）。
   * 表示・保存・進行表への転記・保護者プレビューすべてこの1つを使う。
   */
  const teacherSurname = useMemo(() => {
    const fromEntry = entry?.teacher ? getSurname(entry.teacher) : '';
    if (fromEntry) return fromEntry;
    return getSurname(profile ?? null);
  }, [entry?.teacher, profile]);

  // ---- E: 保護者プレビュー ----
  // 保護者が実際に見るコンポーネント（ReportDetail）へそのまま渡すデータ。
  // 「保存したらこう出る」と一致させるため、保存時と同じ整形（試験目標のスナップショット・
  // 学校進度の連結・確認テストの自動判定）をここでも通す。
  const portalPreview = useMemo(() => {
    if (!showPortalPreview) return null;
    return buildPortalPreview({
      form: {
        ...form,
        mid_term_goal_snapshot: goalHeader
          ? formatExamGoal(goalHeader)
          : form.mid_term_goal_snapshot,
      },
      units: form.units.map((u, idx) => ({
        isMain: u.is_main,
        textbookName:
          textbookOptions.find((o) => o.id === u.student_textbook_id)?.textbook_name ?? '教材',
        unitTitles: taughtChipsOf(u.student_textbook_id).map((c) => c.title),
        pageStart: u.page_start,
        pageEnd: u.page_end,
        displayOrder: u.display_order ?? idx,
      })),
      schoolProgress: schoolProgressLabels.join('、'),
      // 次回の予定も保存時とまったく同じ材料（表示中の値）を渡す
      nextPlan: nextPlanSnapshot.map((item) => ({
        textbookName: item.textbookName,
        unitTitles: item.unitTitles,
      })),
      teacherName: teacherSurname || null,
      checkTestPassed,
    });
  }, [
    showPortalPreview,
    form,
    goalHeader,
    textbookOptions,
    taughtChipsOf,
    schoolProgressLabels,
    nextPlanSnapshot,
    teacherSurname,
    checkTestPassed,
  ]);

  // ---- 保存（手動・自動で共有する唯一の経路） ----
  /**
   * 報告書（class_reports）と進行表（progress_sessions）を保存する。
   * 手動の「下書き保存 / 提出」も自動保存もこの関数を呼ぶ。★別経路を作らないこと。
   *
   * @param nextStatus 保存後の状態
   * @param opts.silent 自動保存。トーストを出さず、**load() も呼ばない**
   *   （再読込するとフォーカス・スクロール位置・入力途中の値が飛ぶ）。
   *   返ってきた報告書は existingReport に差し替えるだけにする。
   * @returns 保存できたら true
   */
  const persist = async (
    nextStatus: 'draft' | 'submitted',
    opts?: { silent?: boolean }
  ): Promise<boolean> => {
    const silent = opts?.silent === true;
    if (!entry) return false;
    if (isDemo) {
      if (!silent) {
        toastError('これは入力画面の見本です。実際の授業からはここで保存・提出できます。');
      }
      return false;
    }
    // 二重実行の防止。自動保存は黙って見送り、手動は相手が終わるのを待ってから続ける
    // （押した操作を捨てない）。
    if (savingRef.current) {
      if (silent) return false;
      const idle = await waitForIdle(savingRef, 8000);
      if (!idle) {
        toastError('保存処理が終わりません。少し待ってからもう一度お試しください');
        return false;
      }
    }
    savingRef.current = true;
    // 保存を始めた時点の中身を「保存した内容」として覚える。
    // 保存中に打たれたぶんは指紋が変わるので、次の自動保存で拾われる。
    const snapshotAtStart = snapshotRef.current;
    if (!silent) setIsSaving(true);
    try {
      // 学習単元は進行表グリッドの選択が正。保存直前に units へ反映する
      const units = form.units.map((u) => ({
        ...u,
        curriculum_item_ids: Object.keys(selections[u.student_textbook_id]?.unitActions ?? {}).map(
          Number
        ),
      }));

      // 学校進度（class_reports 側は text 列）は、グリッドで選ばれた学校単元から組み立てる
      const schoolProgressText = buildSchoolProgressText(
        form.units,
        selections,
        gridRows,
        textbookOptions
      );

      const payload: ClassReportFormData = {
        ...form,
        units,
        school_progress: schoolProgressText || form.school_progress,
        // 中期目標は保存時点の進行表内容をスナップショットする（この画面では編集しない）
        mid_term_goal_snapshot: goalHeader
          ? formatExamGoal(goalHeader)
          : form.mid_term_goal_snapshot,
        mid_action_goal_snapshot: goalHeader
          ? goalHeader.actionGoals.join(' ・ ')
          : form.mid_action_goal_snapshot,
        // 合否は得点からの自動判定を保存する
        check_test_passed: checkTestPassed,
        // 空欄の日は保存しない
        homework_assignments: compactHomeworkRows(form.homework_assignments),
        // 次回の予定（保護者公開）。表示と同じ材料から保存直前に組み立てる
        next_plan: nextPlanSnapshot,
        status: nextStatus,
      };

      const saved = await upsertClassReport(entry.school_id, payload);

      // 進行表への転記（学習単元・学校進度・引継ぎ・マーク）。
      // 授業記録パネルと同じ組み立てで既存の recordSession をそのまま呼ぶ。
      await syncToProgress({
        entry,
        units: form.units,
        selections,
        gridRows,
        handover,
        homeworkNotDone: form.homework_not_done,
        tardy: form.tardy,
        teacherName: teacherSurname,
        reportId: saved.id,
        // 次回の予定は教材セットごとに違うので、関数として渡して各セッションで解決する
        nextPlanIdsOf,
        onSessionSaved: (stbId, sessionId) =>
          setSelections((prev) => ({
            ...prev,
            [stbId]: {
              ...(prev[stbId] ?? emptySelection()),
              sessionId,
              origSchoolUnitIds: Array.from(prev[stbId]?.schoolUnits ?? []),
            },
          })),
      });

      // ここまで来たら「この指紋の内容は保存済み」。自動保存の無変更判定に使う。
      lastSavedSnapshotRef.current = snapshotAtStart;

      if (silent) {
        // ★ load() を呼ばない。再取得した報告書だけ差し替える（更新日時・IDの反映）。
        setExistingReport(saved);
        return true;
      }

      success(nextStatus === 'draft' ? '下書き保存しました' : '提出しました（室長承認待ち）');
      setAutoSaveState('idle');
      if (nextStatus === 'submitted') {
        router.push('/today');
      } else {
        await load();
      }
      return true;
    } catch (err) {
      // 自動保存の失敗はトーストにしない（入力のたびに再試行して連打になる）。
      // フッターの文言だけで伝え、手動保存を促す。
      if (!silent) toastError(err instanceof Error ? err.message : '保存に失敗しました');
      return false;
    } finally {
      savingRef.current = false;
      if (!silent) setIsSaving(false);
    }
  };

  // persist はレンダーごとに作り直される（常に最新の state を見るため）。
  // タイマーから呼ぶときに古い関数を掴まないよう、毎レンダー ref に載せ替える。
  const persistRef = useRef(persist);
  useEffect(() => {
    persistRef.current = persist;
  });

  // ---- G: 自動保存 ----
  // 初期ロードが終わった時点の中身を基準にする。開いただけで自動保存が走らないように。
  // ★ この effect は下の自動保存 effect より前に置くこと（同じコミットで先に走る必要がある）。
  useEffect(() => {
    if (isLoading) return;
    lastSavedSnapshotRef.current = snapshotRef.current;
    setAutoSaveState('idle');
  }, [isLoading]);

  // 変更を検知して AUTO_SAVE_DELAY_MS 後に1回だけ下書き保存する。
  // 実行しない条件（計画書 §G。どれか1つでも当てはまれば見送る）:
  //   - デモ / 初期ロード中 / 基準未確定
  //   - 既存報告書が submitted・approved（提出済みを裏で書き換えない）
  //   - 手動・自動のどちらかが実行中（ミューテックスは savingRef）
  //   - 前回保存時と中身が同じ（無変更では叩かない）
  const reportStatus = existingReport?.status ?? null;

  /**
   * ガイドバーを出してよいか。
   * 「これから書く人」だけに出す。デモ（見本）と、もう書き換えない提出済み・公開済みでは出さない
   * （＝自動保存を動かさない条件と同じ。編集できない画面で「次はこれを書こう」と言わない）。
   */
  const guideAvailable = !isDemo && reportStatus !== 'submitted' && reportStatus !== 'approved';

  useEffect(() => {
    if (isDemo || isLoading) return;
    if (reportStatus === 'submitted' || reportStatus === 'approved') return;
    if (lastSavedSnapshotRef.current === null) return;
    if (snapshot === lastSavedSnapshotRef.current) return;

    setAutoSaveState('dirty');
    const timer = setTimeout(() => {
      void (async () => {
        // タイマー発火時点でもう一度条件を見る（この3秒の間に手動保存が走っていることがある）
        if (savingRef.current) return;
        if (snapshotRef.current === lastSavedSnapshotRef.current) return;
        setAutoSaveState('saving');
        const ok = await persistRef.current('draft', { silent: true });
        if (ok) {
          setAutoSavedAt(
            new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
          );
          // 保存中に打たれた変更があれば、指紋が違うので次の effect が拾って再度走る
          setAutoSaveState(
            snapshotRef.current === lastSavedSnapshotRef.current ? 'saved' : 'dirty'
          );
        } else {
          setAutoSaveState('error');
        }
      })();
    }, AUTO_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [snapshot, isDemo, isLoading, reportStatus]);

  // 未保存の変更が残ったままページを離れようとしたときだけ確認を出す。
  useEffect(() => {
    if (isDemo) return;
    if (autoSaveState !== 'dirty' && autoSaveState !== 'error') return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [autoSaveState, isDemo]);

  /** 手動の「下書き保存」 */
  const handleSave = (nextStatus: 'draft' | 'submitted') => {
    void persist(nextStatus);
  };

  /**
   * F: 提出。ボタンは常に押せる。足りない項目があればその場で一覧を出して止める
   * （黙って無効化すると、講師は何が足りないのか分からないまま画面を往復することになる）。
   */
  const handleSubmit = () => {
    if (submitIssues.length > 0) {
      setShowSubmitIssues(true);
      return;
    }
    setShowSubmitIssues(false);
    void persist('submitted');
  };

  /** 不足項目のボタンから、その入力欄へスクロールしてフォーカスする。 */
  const focusSubmitIssue = (field: SubmitCheckField) => {
    if (field === 'taught-range') {
      // 指導範囲は下段の進行表でセルを押して埋めるものなので、進行表まで連れて行く。
      // 進行表に教材が無い生徒は、プリント等の自由記述が入力先になる。
      if (form.units.length === 0) {
        focusElement(extraMaterialsRef.current);
        return;
      }
      progressSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (field === 'handover') focusElement(handoverRef.current);
    if (field === 'review') focusElement(reviewRef.current);
  };

  if (isLoading) {
    return (
      <AdminLayout>
        <Loading />
      </AdminLayout>
    );
  }

  if (!entry) {
    return (
      <AdminLayout>
        <div className="p-6">授業情報が見つかりませんでした</div>
      </AdminLayout>
    );
  }

  const studentName = entry.student
    ? `${entry.student.last_name} ${entry.student.first_name}`
    : entry.student_id;
  const gradeLabel = formatGradeLabelOrEmpty(entry.student?.grade);
  const teacherName = teacherSurname || entry.teacher?.email || '';
  const slotLabel = entry.time_slot ? `${entry.time_slot.slot_number}限` : '';
  const timeLabel = entry.time_slot
    ? `${entry.time_slot.start_time.slice(0, 5)}〜${entry.time_slot.end_time.slice(0, 5)}`
    : '';
  // ヘッダーの「教科」欄はメイン教材の名前で代替する（教科名より教材名のほうが講師に通じる）
  const mainTextbookName =
    textbookOptions.find(
      (o) => o.id === (form.units.find((u) => u.is_main) ?? form.units[0])?.student_textbook_id
    )?.textbook_name ?? '';

  return (
    <AdminLayout documentTitle={`${studentName}｜授業報告書`}>
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* 講師のAIサポート: 授業中のお願い（正典: docs/bulletin-ai-assist.html §3）。
          ★このコマの講師本人・AIサポートON・今日のコマ、のときだけ出る。判断はすべてAPI側。
          ここでは仕掛けるだけで、出す出さないをフォームが決めることはない。 */}
      <LessonTaskPopup
        scheduleEntryId={entry.id}
        lessonDate={entry.entry_date}
        startTime={entry.time_slot?.start_time ?? null}
        endTime={entry.time_slot?.end_time ?? null}
        durationMinutes={entry.duration_minutes}
        halfPosition={entry.half_position}
      />

      <div className="space-y-4">
        {/* スティッキーバー（高さ0の入れ物に浮かせるので、出し入れしてもレイアウトが動かない）。
            このページは AppHeader を出さない（AdminLayout に headerTitle を渡していない）ので
            オフセットは進行表のヘッダー固定と同じ top-0。 */}
        <div className="sticky top-0 z-30 h-0">
          <div
            className={`transition-opacity duration-150 ${
              showStickyBar ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          >
            <div className="flex items-center gap-2 rounded-lg border border-info/40 bg-white/95 px-3 py-2 shadow-md backdrop-blur">
              <span className="shrink-0 text-[10px] font-bold tracking-wide text-text-muted">
                今日の指導範囲
              </span>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 overflow-hidden">
                {allTaughtChips.length === 0 ? (
                  <span className="text-[11px] text-text-faint">まだ選ばれていません</span>
                ) : (
                  <>
                    {allTaughtChips.slice(0, 3).map((c) => (
                      <UnitChip key={c.curriculumItemId} chip={c} compact />
                    ))}
                    {allTaughtChips.length > 3 && (
                      <span className="text-[11px] font-bold text-text-muted">
                        他{allTaughtChips.length - 3}件
                      </span>
                    )}
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={scrollToReport}
                className="shrink-0 rounded-md border border-info px-2 py-1 text-[11px] font-bold text-info transition-colors duration-150 hover:bg-info-subtle active:scale-[0.97]"
              >
                <ArrowUp className="mr-1 inline h-3 w-3" />
                報告書へ戻る
              </button>
            </div>
          </div>
        </div>

        {isDemo && (
          <div className="rounded-lg bg-warning-subtle border border-warning/30 px-3 py-2 text-xs text-warning">
            <strong>入力画面の見本（ダミーデータ）</strong>
            です。実際の授業からはここで記入して保存・提出します。このページでは保存されません。
          </div>
        )}

        {/* ヘッダー */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            <ChevronLeft className="w-4 h-4 mr-1" />
            戻る
          </Button>
          <h1 className="text-lg font-bold">授業報告書</h1>
          {existingReport && (
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${
                existingReport.status === 'draft'
                  ? 'bg-surface text-text-body'
                  : existingReport.status === 'submitted'
                    ? 'bg-warning-subtle text-warning'
                    : existingReport.status === 'approved'
                      ? 'bg-success-subtle text-success'
                      : 'bg-danger-subtle text-danger'
              }`}
            >
              {existingReport.status === 'draft'
                ? '下書き'
                : existingReport.status === 'submitted'
                  ? '承認待ち'
                  : existingReport.status === 'approved'
                    ? '公開済み'
                    : '差し戻し'}
            </span>
          )}
          {/* ガイドを×で消した人が戻すための小さな入口（消したきり戻せないのを避ける） */}
          {guideAvailable && !guideVisible && (
            <button
              type="button"
              onClick={handleGuideRestore}
              className="ml-auto flex items-center gap-1 text-[11px] font-bold text-info transition-colors duration-150 hover:underline"
            >
              <Compass className="h-3.5 w-3.5" />
              ガイドを表示
            </button>
          )}
        </div>

        {/* ── ゆるいガイドバー（正典: docs/lesson-report-flow-plan.md §3）──
            拘束しない案内役。次の未完了の質問を指すだけで、入力はフォーム本体で行う。
            提出前チェックとは独立なので、閉じても提出時の判定は従来どおり動く。 */}
        {guideAvailable && guideVisible && (
          <ReportGuideBar
            steps={guideSteps}
            onJump={handleGuideJump}
            onManualDone={handleGuideManualDone}
            onDismiss={handleGuideDismiss}
            onSubmitJump={handleGuideSubmitJump}
          />
        )}

        {/* 授業情報サマリ（生徒・学年・教材・授業日時・講師・次回授業日） */}
        <Card>
          <CardContent className="p-4 bg-ink text-white rounded-md">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs opacity-70 uppercase tracking-wide">
                  {[form.lesson_date, slotLabel, timeLabel].filter(Boolean).join(' ')}
                </div>
                <div className="text-xl font-bold mt-1">
                  {studentName}{' '}
                  <span className="text-sm font-normal opacity-80">（{gradeLabel}）</span>
                </div>
                <div className="text-sm mt-1 opacity-80 truncate">
                  {mainTextbookName && <>{mainTextbookName} ・ </>}講師: {teacherName}
                </div>
              </div>
              {/* 次回授業日は宿題の日割りの締切そのものなので常に見えるようにする */}
              <div className="shrink-0 text-right">
                <div className="text-[10px] opacity-70 tracking-wide">次回授業日</div>
                <div className="text-sm font-bold tabular-nums mt-0.5">
                  {nextLessonDate ? formatDateLabel(nextLessonDate) : '未定'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* A: 前回の授業（今日のコマ → 前回どうだったか → 今日書く、の順） */}
        <PreviousLessonCard lesson={previousLesson} />

        {existingReport?.status === 'rejected' && existingReport.rejection_reason && (
          <div className="bg-danger-subtle border border-danger rounded p-3 text-sm text-danger">
            <div className="font-medium">差し戻し理由:</div>
            <div className="mt-1 whitespace-pre-wrap">{existingReport.rejection_reason}</div>
          </div>
        )}

        {/* 目標ヘッダー（進行表と同期の中期目標＋期日カウントダウン） */}
        <GoalHeaderCard goal={goalHeader} countdown={countdown} />

        {/* ── 保護者に公開されるゾーン ── */}
        <div ref={publicZoneRef} className="scroll-mt-16">
          <Zone
            kind="public"
            title="保護者に公開される内容（承認後にマイページへ）"
            icon={<Eye className="w-3.5 h-3.5" />}
          >
            {/* id はガイドバーのスクロール先（lib/lesson-reports/guideSteps.ts の targetId） */}
            <div id="guide-goal">
              <Field
                label="今日の目標（手入力）"
                hint="↑ 上の中期目標を踏まえて、この授業のゴールを1文で"
              >
                <input
                  type="text"
                  className="w-full px-3 py-2 border-2 border-info rounded-md text-sm"
                  value={form.short_term_goal}
                  onChange={(e) => setForm((f) => ({ ...f, short_term_goal: e.target.value }))}
                  placeholder="例：不定詞の名詞用法を5問以上正しく訳せる"
                />
              </Field>
            </div>

            {/* 本日の指導範囲（下段の進行表から自動反映・ここでは編集しない） */}
            <div id="guide-taught">
              <label className="block text-xs font-semibold text-text-muted mb-1">
                本日の指導範囲
                <span className="ml-2 px-2 py-0.5 rounded-full bg-info-subtle text-info text-[10px] font-bold">
                  下の進行表から自動反映
                </span>
              </label>
              {form.units.length === 0 ? (
                <p className="text-xs text-text-faint">
                  この生徒には進行表で管理中の教材がありません。下の自由記述に入力してください。
                </p>
              ) : (
                <div className="space-y-2">
                  {form.units.map((u, idx) => {
                    const opt = textbookOptions.find((o) => o.id === u.student_textbook_id);
                    const chips = taughtChipsOf(u.student_textbook_id);
                    return (
                      <div
                        key={u.student_textbook_id || idx}
                        className={`p-3 border rounded-md ${
                          u.is_main ? 'border-info border-2 bg-info-subtle/30' : 'bg-surface'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <MainSubBadge isMain={u.is_main} />
                          <span className="text-sm font-semibold text-text-heading truncate">
                            {opt?.textbook_name ?? '教材'}
                          </span>
                        </div>
                        {chips.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {chips.map((c) => (
                              <UnitChip key={c.curriculumItemId} chip={c} />
                            ))}
                          </div>
                        ) : (
                          <p className="text-[11px] text-text-faint">
                            下の進行表で今日やった単元をクリックしてください
                          </p>
                        )}
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <Field label="開始ページ">
                            <PageInput
                              value={u.page_start}
                              onChange={(v) => updateUnit(idx, { page_start: v })}
                            />
                          </Field>
                          <Field label="終了ページ">
                            <PageInput
                              value={u.page_end}
                              onChange={(v) => updateUnit(idx, { page_end: v })}
                            />
                          </Field>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="text-[10px] text-text-faint mt-2 mb-1">
                プリント・テキスト外の教材はこちらに（自由記述）
              </p>
              <input
                ref={extraMaterialsRef}
                type="text"
                className="w-full px-3 py-2 border rounded-md text-sm"
                value={extraMaterials}
                onChange={(e) => setExtraMaterials(e.target.value)}
                placeholder="例: 計算プリント（分数係数）を10問"
              />
            </div>

            {/* 学校の進度（下段の学校進度列から自動反映） */}
            <div id="guide-school-progress">
              <label className="block text-xs font-semibold text-text-muted mb-1">
                学校の進度
                <span className="ml-2 px-2 py-0.5 rounded-full bg-info-subtle text-info text-[10px] font-bold">
                  下の進行表から自動反映
                </span>
              </label>
              {schoolProgressLabels.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {schoolProgressLabels.map((label) => (
                    <span
                      key={label}
                      className="rounded-full bg-surface px-2.5 py-1 text-[11.5px] font-semibold text-text-body"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-text-faint">
                  下の進行表の「学校進度」列をクリックすると、学校が進んだ単元がここに出ます
                </p>
              )}
            </div>

            {/* 本日の様子（トグルピル・保護者にも表示される） */}
            <div id="guide-mood">
              <label className="block text-xs font-semibold text-text-muted mb-1">本日の様子</label>
              <div className="flex flex-wrap items-center gap-2">
                <MarkToggle
                  label="遅刻"
                  active={form.tardy}
                  onToggle={() => setForm((f) => ({ ...f, tardy: !f.tardy }))}
                />
                <MarkToggle
                  label="宿題未実施"
                  active={form.homework_not_done}
                  onToggle={toggleHomeworkNotDone}
                />
              </div>
              <p className="text-[10px] text-text-faint mt-1">
                該当するときだけ押します。保護者の報告書にも表示されます
              </p>
            </div>

            {/* D: 次回の予定（既定は進行表通り・自動。変更したいときだけピッカーを開く） */}
            <div id="guide-next-plan">
              <label className="block text-xs font-semibold text-text-muted mb-1">
                次回の予定
                <span className="ml-2 px-2 py-0.5 rounded-full bg-info-subtle text-info text-[10px] font-bold">
                  進行表の続きを自動で提案
                </span>
              </label>
              {form.units.length === 0 ? (
                <p className="text-[11px] text-text-faint">
                  この生徒には進行表で管理中の教材がありません
                </p>
              ) : (
                <div className="space-y-2">
                  {form.units.map((u, idx) => (
                    <NextPlanUnitBlock
                      key={u.student_textbook_id || idx}
                      textbookName={
                        textbookOptions.find((o) => o.id === u.student_textbook_id)
                          ?.textbook_name ?? '教材'
                      }
                      isMain={u.is_main}
                      isManual={selections[u.student_textbook_id]?.nextPlanManual != null}
                      unitTitles={nextPlanIdsOf(u.student_textbook_id).map(
                        unitIndexOf(u.student_textbook_id).title
                      )}
                      pickerOpen={nextPlanPickerFor === u.student_textbook_id}
                      onTogglePicker={() =>
                        setNextPlanPickerFor((cur) =>
                          cur === u.student_textbook_id ? null : u.student_textbook_id
                        )
                      }
                      candidates={(gridRows[u.student_textbook_id] ?? []).map((r) => ({
                        id: r.id,
                        title: r.title,
                      }))}
                      selectedIds={nextPlanIdsOf(u.student_textbook_id)}
                      onToggleUnit={(cid) => handleNextPlanToggle(u.student_textbook_id, cid)}
                      onReset={() => handleNextPlanReset(u.student_textbook_id)}
                    />
                  ))}
                </div>
              )}
              <p className="text-[10px] text-text-faint mt-1">
                次回やる単元です。保護者の報告書と、次回の授業の「前回の授業」に表示されます
              </p>
            </div>

            {/* 宿題・演習（すべてスライダー） */}
            <div id="guide-homework-check">
              <label className="block text-xs font-semibold text-text-muted mb-2">
                宿題・演習（すべてスライダー）
              </label>
              <div className="space-y-2">
                <SliderField
                  label="やってきた量"
                  value={form.homework_completion_pct}
                  onChange={changeHomeworkCompletionPct}
                  hint="0% にすると「宿題未実施」マークが自動で付きます"
                />
                <SliderField
                  label="宿題の正答率"
                  value={form.homework_correct_pct}
                  onChange={(v) => setForm((f) => ({ ...f, homework_correct_pct: v }))}
                />
                <SliderField
                  label="今日の演習の正答率"
                  value={form.today_correct_pct}
                  onChange={(v) => setForm((f) => ({ ...f, today_correct_pct: v }))}
                />
              </div>
            </div>

            {/* 確認テスト（1本に統合・合否は自動判定） */}
            <div id="guide-check-test">
              <CheckTestField
                score={form.check_test_score}
                total={form.check_test_total}
                passed={checkTestPassed}
                onScoreChange={(v) => setForm((f) => ({ ...f, check_test_score: v }))}
                onTotalChange={(v) => setForm((f) => ({ ...f, check_test_total: v }))}
              />
            </div>

            {/* 講評（手書き） */}
            <div id="guide-review">
              <Field label="講評（手書き・保護者が読む文章）">
                <textarea
                  ref={reviewRef}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                  rows={5}
                  value={form.review_comment}
                  onChange={(e) => setForm((f) => ({ ...f, review_comment: e.target.value }))}
                  placeholder="5行程度で記入"
                />
                <div className="text-xs text-text-muted mt-1">
                  現在 {reviewLineCount} 行 / 推奨 5 行
                </div>
              </Field>
            </div>

            {/* 次回までの宿題（日割り） */}
            <div id="guide-homework-assign">
              <label className="block text-xs font-semibold text-text-muted mb-1">
                {nextLessonDate
                  ? `次回までの宿題（次回授業日 ${formatDateLabel(nextLessonDate)} まで）`
                  : '次回までの宿題（次回授業日 未定）'}
                <span className="ml-2 px-2 py-0.5 rounded-full bg-info-subtle text-info text-[10px] font-bold">
                  次回授業日までの日付を自動生成
                </span>
              </label>
              {nextLessonDate ? (
                <p className="text-[10px] text-text-faint mb-2">次回授業日の行は入力なしでOKです</p>
              ) : (
                <p className="text-[10px] text-text-faint mb-2">
                  次回授業日が未定のため、翌日から7日分の行を出しています
                </p>
              )}
              <div className="space-y-1">
                {form.homework_assignments.map((a, idx) => {
                  const isNext = !!nextLessonDate && a.date === nextLessonDate;
                  return (
                    <div
                      key={a.date || idx}
                      className="grid grid-cols-[92px_1fr] gap-2 items-center"
                    >
                      <span
                        className={`px-2 py-1 rounded text-[11px] font-bold text-center tabular-nums ${
                          isNext ? 'bg-surface text-text-muted' : 'bg-info-subtle text-info'
                        }`}
                      >
                        {formatDateLabel(a.date)}
                      </span>
                      <input
                        type="text"
                        value={a.text}
                        onChange={(e) => updateHomeworkText(idx, e.target.value)}
                        className="px-2 py-1 border rounded text-sm"
                        placeholder={isNext ? '（次回授業日・入力なしでOK）' : '例: ワーク p.30-31'}
                      />
                    </div>
                  );
                })}
                {form.homework_assignments.length === 0 && (
                  <p className="text-xs text-text-faint">
                    授業日が未確定のため日割り行を作れません
                  </p>
                )}
              </div>
            </div>

            {/* 科目別欄（既存機能。保護者に見える宿題の一部として公開ゾーンに置く） */}
            <Field label="科目別欄（単語・計算・漢字の反復練習）">
              <SubjectSpecificField
                value={form.subject_specific}
                onChange={(v) => setForm((f) => ({ ...f, subject_specific: v }))}
              />
            </Field>
          </Zone>
        </div>

        {/* スティッキーバーの出し入れを判定するセンチネル（公開ゾーンの直後） */}
        <div ref={publicZoneEndRef} aria-hidden className="h-px" />

        {/* ── 教室内のみのゾーン ── */}
        <Zone
          kind="internal"
          title="教室内のみ（保護者には出ません）"
          icon={<Lock className="w-3.5 h-3.5" />}
        >
          <div id="guide-handover">
            <Field
              label="引継ぎ（手書き・次の担当講師・室長へ）"
              hint="進行表の授業記録と同じ保存先（progress_sessions）に書き込まれます"
            >
              <textarea
                ref={handoverRef}
                className="w-full px-3 py-2 border rounded-md text-sm"
                rows={3}
                value={handover}
                onChange={(e) => setHandover(e.target.value)}
                placeholder="次の講師への引継ぎを入力..."
              />
            </Field>
          </div>
        </Zone>

        {/* ── 下段: 進行表 ── */}
        <section
          ref={progressSectionRef}
          className="rounded-lg border border-border overflow-hidden scroll-mt-16"
        >
          <div className="flex items-center gap-1.5 px-4 py-2 bg-surface text-[11px] font-bold tracking-wide text-text-muted">
            <ClipboardList className="w-3.5 h-3.5" />
            進行表
          </div>
          <div className="bg-white p-4 space-y-3">
            <p className="text-[11px] text-text-faint">
              セルをクリックすると今日の日付が入り、上の指導範囲に反映されます
            </p>
            {form.units.map((u, idx) => {
              const opt = textbookOptions.find((o) => o.id === u.student_textbook_id);
              const sel = selections[u.student_textbook_id] ?? emptySelection();
              return (
                <div
                  key={u.student_textbook_id || idx}
                  className={`p-3 border rounded-md ${
                    u.is_main ? 'border-info border-2 bg-info-subtle/30' : 'bg-surface'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <MainSubBadge isMain={u.is_main} />
                    <select
                      value={u.student_textbook_id}
                      onChange={(e) => updateUnit(idx, { student_textbook_id: e.target.value })}
                      className="flex-1 px-2 py-1 border rounded text-sm font-semibold"
                    >
                      {textbookOptions
                        // 他のセットで使っている教材は選ばせない（選択状態は教材IDで持つため）
                        .filter((o) => o.id === u.student_textbook_id || !usedTextbookIds.has(o.id))
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.textbook_name}
                          </option>
                        ))}
                    </select>
                    {!u.is_main && (
                      <button
                        type="button"
                        className="text-text-faint hover:text-danger transition-colors duration-150 active:scale-[0.90]"
                        onClick={() => removeUnit(idx)}
                        title="このセットを削除"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <LessonReportProgressGrid
                    textbookName={opt?.textbook_name ?? '教材'}
                    rows={gridRows[u.student_textbook_id] ?? []}
                    selection={{
                      unitActions: sel.unitActions,
                      schoolUnits: sel.schoolUnits,
                      sessionDate: form.lesson_date,
                    }}
                    onCellToggle={(cid, col) => handleCellToggle(u.student_textbook_id, cid, col)}
                    isTeacher={profile?.role === 'teacher'}
                    // D: 次回の予定の行に「次回」バッジを出す（ProgressRow には手を入れない）
                    nextPlanUnitIds={nextPlanIdsOf(u.student_textbook_id)}
                  />
                </div>
              );
            })}
            {textbookOptions.length > usedTextbookIds.size && (
              <button
                type="button"
                onClick={addUnit}
                className="w-full py-2 border-2 border-dashed border-info rounded-md text-sm text-info hover:bg-info-subtle transition-colors duration-150 active:scale-[0.98] ease-[cubic-bezier(0.23,1,0.32,1)]"
              >
                <Plus className="inline w-4 h-4 mr-1" />
                サブ教材を追加（補助教材）
              </button>
            )}
          </div>
        </section>

        {/* フッター（提出前チェックの一覧はこの真上に出す）。
            id はガイドバーの「提出へ」のスクロール先。 */}
        <div id="guide-submit" className="sticky bottom-0 bg-white border-t -mx-4 px-4">
          {showSubmitIssues && submitIssues.length > 0 && (
            <SubmitIssuePanel
              issues={submitIssues}
              onJump={focusSubmitIssue}
              onClose={() => setShowSubmitIssues(false)}
            />
          )}
          <div className="flex flex-wrap items-center gap-2 py-3">
            <span className="text-xs text-text-muted flex-1 min-w-[140px]">
              <SaveStatusText
                autoSaveState={autoSaveState}
                autoSavedAt={autoSavedAt}
                updatedAt={existingReport?.updated_at ?? null}
              />
            </span>
            {submitIssues.length > 0 && (
              // 押してから驚かせないよう、不足件数は常時出しておく
              <span className="rounded-full bg-warning-subtle px-2.5 py-1 text-[11px] font-bold text-warning">
                未入力 {submitIssues.length}件
              </span>
            )}
            <Button variant="outline" onClick={() => router.back()} disabled={isSaving}>
              キャンセル
            </Button>
            <Button variant="outline" onClick={() => setShowPortalPreview(true)}>
              <Eye className="w-4 h-4 mr-1" />
              保護者の見え方
            </Button>
            <Button variant="outline" onClick={() => handleSave('draft')} disabled={isSaving}>
              <Save className="w-4 h-4 mr-1" />
              下書き保存
            </Button>
            {/* ★ 不足があっても押せるままにする（押したときに何が足りないかを言う） */}
            <Button onClick={handleSubmit} disabled={isSaving}>
              <Send className="w-4 h-4 mr-1" />
              {isSaving ? '保存中...' : '提出 (室長承認待ち)'}
            </Button>
          </div>
        </div>

        {/* E: 保護者プレビュー（保護者が実際に見るコンポーネントをそのまま375px幅で描く） */}
        {showPortalPreview && portalPreview && (
          <PortalPreviewModal report={portalPreview} onClose={() => setShowPortalPreview(false)} />
        )}

        {isDemo && <DemoProgressPreview />}
      </div>
    </AdminLayout>
  );
}

// ---------- 保存ヘルパー ----------

/** 目標ヘッダーの試験目標を1行のテキストにする（class_reports のスナップショット列用） */
function formatExamGoal(g: GoalHeader): string {
  const parts = [g.examLabel];
  if (g.targetScore != null) parts.push(`${g.targetScore}点`);
  const head = parts.join(' ');
  return g.examRange ? `${head}（範囲: ${g.examRange}）` : head;
}

/**
 * 入力欄まで運んでフォーカスする（提出前チェックの「この欄へ」用）。
 * スクロールは自分で滑らかに行い、focus 側は preventScroll で二重移動を止める。
 */
function focusElement(el: HTMLElement | null) {
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.focus({ preventScroll: true });
}

/** 日付ラベル 'YYYY-MM-DD' → 'M/D(曜)' */
function formatDateLabel(date: string): string {
  if (!date) return '';
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${w})`;
}

/**
 * グリッドで学校進度としてマークされた単元のラベル（`教材名 / 単元名`）を並べる。
 * 画面のチップ表示と、保存する school_progress 文字列の両方がこの1か所から出るので、
 * 「画面に出ている内容」と「保護者に届く内容」が構造的にズレない。
 */
function buildSchoolProgressLabels(
  units: ClassReportFormData['units'],
  selections: Record<string, GridSelectionState>,
  gridRows: Record<string, CurriculumItemWithProgress[]>,
  textbookOptions: StudentTextbookOption[]
): string[] {
  const labels: string[] = [];
  for (const u of units) {
    const sel = selections[u.student_textbook_id];
    if (!sel || sel.schoolUnits.size === 0) continue;
    const rows = gridRows[u.student_textbook_id] ?? [];
    const tbName =
      textbookOptions.find((o) => o.id === u.student_textbook_id)?.textbook_name ?? '教材';
    for (const row of rows) {
      if (sel.schoolUnits.has(row.id)) labels.push(`${tbName} / ${row.title}`);
    }
  }
  return labels;
}

/**
 * class_reports.school_progress（text列）の表示文字列を組み立てる。
 * 進行表側の実データ（student_progress.school_progress_date）は recordSession が書くので、
 * ここは保護者に見せる文言だけを作る。
 */
function buildSchoolProgressText(
  units: ClassReportFormData['units'],
  selections: Record<string, GridSelectionState>,
  gridRows: Record<string, CurriculumItemWithProgress[]>,
  textbookOptions: StudentTextbookOption[]
): string {
  return buildSchoolProgressLabels(units, selections, gridRows, textbookOptions).join('、');
}

/**
 * 進行表への転記。教材（student_textbook）ごとに既存の recordSession をそのまま呼ぶ。
 * primaryCurriculumItemId の算出も授業記録パネル（SessionRecordingPanel）と同じ規則:
 * 触れた単元のうちカリキュラム順で一番下の行に引継ぎ・マークを書く。
 */
async function syncToProgress(params: {
  entry: ScheduleEntryInfo;
  units: ClassReportFormData['units'];
  selections: Record<string, GridSelectionState>;
  gridRows: Record<string, CurriculumItemWithProgress[]>;
  handover: string;
  homeworkNotDone: boolean;
  tardy: boolean;
  teacherName: string;
  /** 保存した授業報告書のID。progress_sessions.report_id に紐づける */
  reportId: string;
  /** 教材セットごとの「次回の予定」単元ID（機能D）。表示と同じ値をそのまま保存する */
  nextPlanIdsOf: (studentTextbookId: string) => number[];
  onSessionSaved: (studentTextbookId: string, sessionId: string) => void;
}): Promise<void> {
  const {
    entry,
    units,
    selections,
    gridRows,
    handover,
    homeworkNotDone,
    tardy,
    teacherName,
    reportId,
    nextPlanIdsOf,
    onSessionSaved,
  } = params;

  for (const u of units) {
    const stbId = u.student_textbook_id;
    const sel = selections[stbId];
    if (!sel) continue;

    const hasContent =
      Object.keys(sel.unitActions).length > 0 ||
      sel.schoolUnits.size > 0 ||
      !!handover ||
      homeworkNotDone ||
      tardy;
    // 何も入力が無い教材で空のセッションを作らない。ただし既にセッションがある場合は
    // 「入力を消した」編集なので更新は通す
    if (!hasContent && !sel.sessionId) continue;

    const unitActions: SessionUnitAction[] = Object.entries(sel.unitActions).map(([cid, ln]) => ({
      curriculumItemId: Number(cid),
      lessonNumber: ln,
    }));

    // 触れた単元のうちカリキュラム順で最後のものを primary にする
    const rows = gridRows[stbId] ?? [];
    const touched = new Set([
      ...Object.keys(sel.unitActions).map(Number),
      ...Array.from(sel.schoolUnits),
    ]);
    let primaryCurriculumItemId: number | null = null;
    for (const row of rows) {
      if (touched.has(row.id)) primaryCurriculumItemId = row.id;
    }

    // 編集で学校進度から外された単元を検出してクリアする
    const clearSchoolProgressUnits = sel.origSchoolUnitIds.filter((id) => !sel.schoolUnits.has(id));

    const session = await recordSession({
      studentTextbookId: stbId,
      sessionDate: entry.entry_date,
      teacherId: entry.teacher_id,
      teacherName,
      handover,
      homeworkNotDone,
      tardy,
      unitActions,
      schoolProgressUnits: Array.from(sel.schoolUnits),
      scheduleEntryId: entry.id,
      reportId,
      // ★ 報告書から呼ぶときだけ渡す（進行表の授業記録パネルからは undefined のまま）
      nextPlanCurriculumItemIds: nextPlanIdsOf(stbId),
      sessionId: sel.sessionId,
      primaryCurriculumItemId,
      clearSchoolProgressUnits,
    });
    onSessionSaved(stbId, session.id);
  }
}

/** 目標ヘッダーを組み立てる。試験目標・行動目標は既存の一括取得関数を再利用する */
async function loadGoalHeader(
  mainStbId: string,
  textbooks: StudentTextbookWithDetails[]
): Promise<GoalHeader | null> {
  const goals = await getFeedGoalsByTextbooks([mainStbId]);
  const summary = goals[mainStbId];
  if (!summary?.exam) return null;
  // exam_range は getFeedGoalsByTextbooks が返さないので、取得済みの教材の exams から拾う
  const examRow = textbooks
    .find((tb) => tb.id === mainStbId)
    ?.exams?.find((e) => e.id === summary.exam!.id);
  return {
    examLabel: summary.exam.label,
    examDate: summary.exam.examDate,
    targetScore: summary.exam.targetScore,
    examRange: examRow?.exam_range ?? null,
    actionGoals: summary.actionGoals.map((g) => g.title),
  };
}

/**
 * このコマに紐づく既存セッションから、グリッド選択・引継ぎ・マークを復元する。
 * - セッションの識別は schedule_entry_id（下書きを何度保存してもセッションを増やさない）
 * - 指導単元 / 学校進度は既存の getSessionsForEdit で復元する
 */
async function restoreSessions(
  scheduleEntryId: string,
  units: ClassReportFormData['units'],
  setSelections: (v: Record<string, GridSelectionState>) => void,
  setHandover: (v: string) => void,
  setHomeworkNotDone: (v: boolean) => void,
  setTardy: (v: boolean) => void
): Promise<void> {
  const byTextbook = await getSessionsByScheduleEntry(scheduleEntryId);
  const next: Record<string, GridSelectionState> = {};
  let handoverSet = false;

  for (const u of units) {
    const stbId = u.student_textbook_id;
    const session = byTextbook[stbId];
    if (!session) {
      next[stbId] = emptySelection();
      continue;
    }
    // 指導単元・学校進度の復元（既存関数を利用。取りこぼしても sessionId があるので
    // セッションが増殖することはない）
    let unitActions: Record<number, 1 | 2 | 3> = {};
    let schoolUnitIds: number[] = [];
    try {
      const editable = await getSessionsForEdit(stbId, 50);
      const hit = editable.find((e) => e.session.id === session.id);
      if (hit) {
        unitActions = hit.unitActions;
        schoolUnitIds = hit.schoolUnitIds;
      }
    } catch (err) {
      console.error('セッションの復元に失敗:', err);
    }
    next[stbId] = {
      unitActions,
      schoolUnits: new Set(schoolUnitIds),
      origSchoolUnitIds: schoolUnitIds,
      sessionId: session.id,
      // 次回の予定は保存済み＝確定値なので、そのまま手動値として復元する（自動追従させない）。
      // 空配列も「そのとき確定した空」として尊重する。列がまだ無い環境（マイグレーション
      // 未適用）では undefined が返るので、その場合だけ自動（null）に倒す。
      nextPlanManual: Array.isArray(session.next_plan_curriculum_item_ids)
        ? session.next_plan_curriculum_item_ids
        : null,
    };
    // 引継ぎ・マークはコマ単位の情報。最初に見つかったセッションの値を採用する
    if (!handoverSet) {
      setHandover(session.handover ?? '');
      setHomeworkNotDone(session.homework_not_done);
      setTardy(session.tardy);
      handoverSet = true;
    }
  }
  setSelections(next);
}

// ---------- 小コンポーネント ----------

/**
 * ゾーンUI: 書いた内容が保護者に出るか／教室内に留まるかを視覚的に分ける。
 * 緑＝公開（承認後にマイページへ）／グレー破線＝内部。
 */
function Zone({
  kind,
  title,
  icon,
  children,
}: {
  kind: 'public' | 'internal';
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const isPublic = kind === 'public';
  return (
    <div
      className={`rounded-lg border overflow-hidden ${
        isPublic ? 'border-success/40' : 'border-border border-dashed'
      }`}
    >
      <div
        className={`flex items-center gap-1.5 px-4 py-2 text-[11px] font-bold tracking-wide ${
          isPublic ? 'bg-success-subtle text-success' : 'bg-surface text-text-muted'
        }`}
      >
        {icon}
        {title}
      </div>
      <div className="bg-white p-4 space-y-4">{children}</div>
    </div>
  );
}

/**
 * A: 前回の授業（折りたたみ）。
 *
 * 一次情報は進行表の授業記録（progress_sessions）。閉じていても
 * 「いつ・引継ぎの1行・遅刻/宿題未実施」までは見えるようにして、開かなくても
 * 前回の様子が掴めるようにする（既定は閉じた状態）。
 * 前回が無ければカードごと出さない。空の項目も出さない。
 */
function PreviousLessonCard({ lesson }: { lesson: PreviousLessonSummary | null }) {
  const [open, setOpen] = useState(false);
  if (!lesson) return null;

  // 引継ぎは教材ごとに別内容。閉じているときは最初の1件を1行だけ見せる（全文は展開時）。
  const handoverPreview = lesson.textbooks.find((t) => t.handover)?.handover ?? null;
  const report = lesson.report;
  const hasMeters =
    report != null &&
    (report.homeworkCompletionPct != null ||
      report.homeworkCorrectPct != null ||
      report.todayCorrectPct != null);
  const homeworkRows = report ? report.homeworkAssignments.filter((h) => h.text?.trim()) : [];

  return (
    <div className="rounded-lg border border-border bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-surface"
      >
        <History className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        <span className="shrink-0 text-[11px] font-bold tracking-wide text-text-muted tabular-nums">
          前回の授業 {formatDateLabel(lesson.lessonDate)}
        </span>
        {lesson.tardy && <PreviousMarkPill label="遅刻" />}
        {lesson.homeworkNotDone && <PreviousMarkPill label="宿題未実施" />}
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-text-faint">
          {handoverPreview ?? '引継ぎはありません'}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-text-muted transition-transform duration-150 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div className="border-t border-border-subtle bg-surface/50 px-4 py-3 space-y-3">
          {/* 教材ごと（＝セッションごと）。引継ぎは連結せず、その教材の下に出す */}
          {lesson.textbooks.map((tb) => (
            <div key={tb.studentTextbookId} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] font-semibold text-text-heading">
                  {tb.textbookName}
                </span>
                {tb.teacherName && (
                  <span className="text-[10.5px] text-text-faint">担当: {tb.teacherName}</span>
                )}
              </div>
              {tb.units.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tb.units.map((u, i) => (
                    <span
                      key={`${u.title}-${u.lessonNumber}-${i}`}
                      className="inline-flex items-center gap-1 rounded-full bg-info-subtle px-2.5 py-1 text-[11.5px] font-semibold text-info"
                    >
                      {u.title}
                      <span className="rounded-full bg-info px-1.5 text-[9.5px] font-bold text-white tabular-nums">
                        {u.lessonNumber}回目
                      </span>
                    </span>
                  ))}
                </div>
              )}
              {/* D: 前回そのとき決めた「次回の予定」＝今日やる予定だったもの。
                  空なら行ごと出さない（機能D以前の授業記録には入っていない）。 */}
              {tb.nextPlanUnits.length > 0 && (
                <p className="flex flex-wrap items-baseline gap-1 text-[12px] text-text-body">
                  <span className="font-bold text-text-muted">前回の予定:</span>
                  <span className="font-semibold text-text-heading">
                    {tb.nextPlanUnits.join('・')}
                  </span>
                </p>
              )}
              {tb.handover && (
                <p className="whitespace-pre-wrap rounded-md bg-white px-3 py-2 text-[12.5px] leading-6 text-text-body">
                  {tb.handover}
                </p>
              )}
            </div>
          ))}

          {/* 報告書があったときだけ上乗せ（本番では無いことのほうが多い） */}
          {report?.schoolProgress && (
            <PreviousBlock label="学校の進度">
              <p className="text-[12.5px] text-text-body">{report.schoolProgress}</p>
            </PreviousBlock>
          )}
          {report?.reviewComment && (
            <PreviousBlock label="講評">
              <p className="whitespace-pre-wrap text-[12.5px] leading-6 text-text-body">
                {report.reviewComment}
              </p>
            </PreviousBlock>
          )}
          {homeworkRows.length > 0 && (
            <PreviousBlock label="出した宿題">
              <ul className="space-y-1">
                {homeworkRows.map((h, i) => (
                  <li key={`${h.date}-${i}`} className="flex items-start gap-2">
                    {h.date && (
                      <span className="mt-[1px] shrink-0 rounded bg-info-subtle px-1.5 py-0.5 text-[10px] font-bold text-info tabular-nums">
                        {formatDateLabel(h.date)}
                      </span>
                    )}
                    <span className="text-[12.5px] text-text-body">{h.text}</span>
                  </li>
                ))}
              </ul>
            </PreviousBlock>
          )}
          {hasMeters && report && (
            <PreviousBlock label="達成度">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-text-body tabular-nums">
                <PreviousPct label="やってきた量" value={report.homeworkCompletionPct} />
                <PreviousPct label="宿題の正答率" value={report.homeworkCorrectPct} />
                <PreviousPct label="今日の演習の正答率" value={report.todayCorrectPct} />
              </div>
            </PreviousBlock>
          )}
        </div>
      )}
    </div>
  );
}

/** 前回カードの見出し付きブロック（報告書があったときだけ出る項目）。 */
function PreviousBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-bold tracking-wide text-text-muted">{label}</div>
      {children}
    </div>
  );
}

/** 前回カードの達成度1項目。値が無ければ出さない。 */
function PreviousPct({ label, value }: { label: string; value: number | null }) {
  if (value == null) return null;
  return (
    <span>
      {label} <b className="text-text-heading">{value}%</b>
    </span>
  );
}

/** 前回カードのマーク（遅刻／宿題未実施）。公開ゾーンのトグルピルと同じ warning 系の色。 */
function PreviousMarkPill({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded-full bg-warning-subtle px-2 py-0.5 text-[10px] font-bold text-warning">
      {label}
    </span>
  );
}

/**
 * F: 提出前チェックの一覧パネル（フッターの真上）。
 * 各項目はボタンで、押すとその入力欄までスクロールしてフォーカスする。
 */
function SubmitIssuePanel({
  issues,
  onJump,
  onClose,
}: {
  issues: SubmitCheckIssue[];
  onJump: (field: SubmitCheckField) => void;
  onClose: () => void;
}) {
  return (
    <div className="mt-2 rounded-lg border border-warning/50 bg-warning-subtle px-3 py-2.5">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-warning">
            提出前に {issues.length} 件の入力が必要です
          </p>
          <ul className="mt-1.5 space-y-1">
            {issues.map((issue) => (
              <li key={issue.field}>
                <button
                  type="button"
                  onClick={() => onJump(issue.field)}
                  className="flex w-full items-baseline gap-2 rounded-md bg-white px-2.5 py-1.5 text-left transition-colors duration-150 hover:bg-warning-subtle active:scale-[0.99]"
                >
                  <span className="shrink-0 text-[12px] font-bold text-text-heading">
                    {issue.label}
                  </span>
                  <span className="min-w-0 flex-1 text-[11.5px] text-text-muted">
                    {issue.message}
                  </span>
                  <span className="shrink-0 text-[11px] font-bold text-info">この欄へ →</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          className="shrink-0 text-warning/70 transition-colors duration-150 hover:text-warning"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * G: フッターの保存状態表示。
 * 自動保存はトーストを出さず、この1行だけで伝える（作業中に通知を積み上げない）。
 */
function SaveStatusText({
  autoSaveState,
  autoSavedAt,
  updatedAt,
}: {
  autoSaveState: AutoSaveState;
  autoSavedAt: string | null;
  updatedAt: string | null;
}) {
  if (autoSaveState === 'saving') return <>保存中…</>;
  if (autoSaveState === 'dirty') return <>未保存の変更があります</>;
  if (autoSaveState === 'error') {
    return <span className="text-danger">自動保存に失敗しました（手動で保存してください）</span>;
  }
  if (autoSaveState === 'saved' && autoSavedAt) return <>自動保存 {autoSavedAt}</>;
  return <>{updatedAt ? `最終保存: ${new Date(updatedAt).toLocaleString('ja-JP')}` : '未保存'}</>;
}

/**
 * E: 保護者プレビューのモーダル。
 *
 * ★ 中身は保護者が実際に見る ReportDetail をそのまま描く（見た目を作り直さない）。
 *   保護者ポータルは100%スマホ前提なので、幅375pxの枠に収めて実機の見え方に合わせる。
 *   preview を渡して既読APIを叩かせない（講師が開いただけで既読にしない）。
 */
function PortalPreviewModal({
  report,
  onClose,
}: {
  report: PortalReportDetail;
  onClose: () => void;
}) {
  // Escape で閉じられるようにする（モーダルの基本動作）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="保護者にはこう表示されます"
      onClick={onClose}
    >
      <div
        className="mt-6 w-[375px] max-w-full overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2 border-b border-border-subtle px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-text-heading">保護者にはこう表示されます</p>
            <p className="mt-0.5 text-[10.5px] text-text-faint">
              室長の承認後にマイページへ公開されます
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="shrink-0 text-text-faint transition-colors duration-150 hover:text-text-body"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[80vh] overflow-y-auto bg-surface px-3 py-3">
          <ReportDetail report={report} preview />
        </div>
      </div>
    </div>
  );
}

/** 目標ヘッダー: 中期目標（試験・行動）は表示のみ。期日カウントダウンを横に出す */
function GoalHeaderCard({
  goal,
  countdown,
}: {
  goal: GoalHeader | null;
  countdown: ExamCountdown | null;
}) {
  if (!goal) {
    return (
      <div className="rounded-lg border border-border bg-white px-4 py-3 text-xs text-text-muted">
        <Target className="inline w-3.5 h-3.5 mr-1.5 -mt-0.5" />
        この生徒のメイン教材に試験目標が未設定です（目標は進行表で設定します）
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-white px-4 py-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap text-[13px]">
        <span className="text-[10px] font-bold tracking-wide text-text-muted w-14 shrink-0">
          試験目標
        </span>
        <span className="font-semibold text-text-heading">{formatExamGoal(goal)}</span>
        {/* 期日カウントダウン（試験目標が無い生徒には出ない） */}
        {countdown && (
          <span className="ml-auto flex gap-1.5 shrink-0">
            <span
              className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold tabular-nums ${
                countdown.expired ? 'bg-surface text-text-muted' : 'bg-warning-subtle text-warning'
              }`}
            >
              <CalendarClock className="inline w-3 h-3 mr-1 -mt-0.5" />
              {goal.examDate?.slice(5).replace('-', '/')} ・ {formatCountdownDays(countdown)}
            </span>
            {!countdown.expired && (
              <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold tabular-nums bg-info-subtle text-info">
                授業あと{countdown.lessonsLeft}回
              </span>
            )}
          </span>
        )}
      </div>
      {goal.actionGoals.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-[13px]">
          <span className="text-[10px] font-bold tracking-wide text-text-muted w-14 shrink-0">
            行動目標
          </span>
          <span className="font-semibold text-text-heading">{goal.actionGoals.join(' ・ ')}</span>
          <span className="ml-auto px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-ink-subtle text-ink shrink-0">
            進行表と同期
          </span>
        </div>
      )}
    </div>
  );
}

/** メイン／サブのバッジ（上段の指導範囲と下段の進行表で同じ見た目にする） */
function MainSubBadge({ isMain }: { isMain: boolean }) {
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-bold shrink-0 ${
        isMain ? 'bg-info text-white' : 'bg-gray-500 text-white'
      }`}
    >
      {isMain ? 'メイン' : 'サブ'}
    </span>
  );
}

/**
 * 指導範囲のチップ（単元名 ＋ n回目）。
 * ★ 読み取り専用。解除は下段の進行表で同じセルをもう一度クリックする
 *   （選択の正典を進行表グリッド1か所に保つため、ここからは編集させない）。
 */
function UnitChip({ chip, compact }: { chip: TaughtChip; compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-info-subtle font-semibold text-info ${
        compact ? 'px-2 py-0.5 text-[10.5px]' : 'px-2.5 py-1 text-[11.5px]'
      }`}
    >
      <span className={compact ? 'max-w-[120px] truncate' : ''}>{chip.title}</span>
      <span className="rounded-full bg-info px-1.5 text-[9.5px] font-bold text-white tabular-nums">
        {chip.lessonNumber}回目
      </span>
    </span>
  );
}

/**
 * D: 次回の予定（教材セット1つぶん）。
 *
 * 既定は「進行表通り」＝今日やった単元の次の未実施単元が自動で入る。実データの
 * 引継ぎに「次回：進行表通り」という手打ちが多数あったので、それを既定にした
 * （講師が何もしなくても正しい状態になる）。
 * 変えたいときだけ「変更」でピッカーを開いて選び直す。一度触ったら自動追従は止まり、
 * 「進行表通りに戻す」で戻せる。
 */
function NextPlanUnitBlock({
  textbookName,
  isMain,
  isManual,
  unitTitles,
  pickerOpen,
  onTogglePicker,
  candidates,
  selectedIds,
  onToggleUnit,
  onReset,
}: {
  textbookName: string;
  isMain: boolean;
  /** 講師が手で選び直したか（＝自動追従を止めているか） */
  isManual: boolean;
  unitTitles: string[];
  pickerOpen: boolean;
  onTogglePicker: () => void;
  /** ピッカーに並べる単元（進行表グリッドの行＝カリキュラム順） */
  candidates: Array<{ id: number; title: string }>;
  selectedIds: number[];
  onToggleUnit: (curriculumItemId: number) => void;
  onReset: () => void;
}) {
  const selected = new Set(selectedIds);
  return (
    <div
      className={`p-3 border rounded-md ${isMain ? 'border-info bg-info-subtle/20' : 'bg-surface'}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <MainSubBadge isMain={isMain} />
        <span className="text-sm font-semibold text-text-heading truncate">{textbookName}</span>
        <span
          className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
            isManual ? 'bg-warning-subtle text-warning' : 'bg-ink-subtle text-ink'
          }`}
        >
          {isManual ? '変更あり' : '進行表通り'}
        </span>
        <button
          type="button"
          onClick={onTogglePicker}
          aria-expanded={pickerOpen}
          className="shrink-0 rounded-md border border-info px-2 py-1 text-[11px] font-bold text-info transition-colors duration-150 hover:bg-info-subtle active:scale-[0.97]"
        >
          {pickerOpen ? '閉じる' : '変更'}
        </button>
      </div>

      {unitTitles.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {unitTitles.map((title, i) => (
            <span
              key={`${title}-${i}`}
              className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11.5px] font-semibold text-text-body ring-1 ring-inset ring-border"
            >
              <SkipForward className="h-3 w-3 text-info" />
              {title}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-text-faint">
          {isManual
            ? '次回の予定は入れていません（「変更」から選び直せます）'
            : 'この教材は進行表の単元がすべて終わっています'}
        </p>
      )}

      {pickerOpen && (
        <div className="mt-2 rounded-md border border-border bg-white p-2">
          {candidates.length === 0 ? (
            <p className="text-[11px] text-text-faint">
              この教材には単元（目次）が登録されていません
            </p>
          ) : (
            // 単元が多い教材でもフォームが縦に伸びきらないよう、ピッカー内でスクロールさせる
            <div className="max-h-[200px] overflow-y-auto flex flex-wrap gap-1.5">
              {candidates.map((c) => {
                const on = selected.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onToggleUnit(c.id)}
                    className={`rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors duration-150 active:scale-[0.97] ${
                      on
                        ? 'border-info bg-info text-white'
                        : 'border-border bg-white text-text-muted hover:bg-surface'
                    }`}
                  >
                    {c.title}
                  </button>
                );
              })}
            </div>
          )}
          <button
            type="button"
            onClick={onReset}
            className="mt-2 rounded-md border border-border px-2 py-1 text-[11px] font-bold text-text-muted transition-colors duration-150 hover:bg-surface active:scale-[0.97]"
          >
            <RotateCcw className="mr-1 inline h-3 w-3" />
            進行表通りに戻す
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 本日の様子のトグルピル（遅刻／宿題未実施）。
 * チェックボックスではなく「押すと色が付くマーク」にして、講師が1タップで入れられるようにする。
 * 押下状態は aria-pressed で伝える（見た目の色だけに頼らない）。
 */
function MarkToggle({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      className={`rounded-full border px-3.5 py-1.5 text-sm font-bold transition-colors duration-150 active:scale-[0.97] ${
        active
          ? 'border-warning bg-warning-subtle text-warning'
          : 'border-border bg-white text-text-muted hover:bg-surface'
      }`}
    >
      {label}
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-text-muted mb-1">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-text-faint mt-1">{hint}</p>}
    </div>
  );
}

function PageInput({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="relative">
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted text-sm font-semibold pointer-events-none">
        p.
      </span>
      <input
        type="number"
        className="w-full pl-7 pr-2 py-1 border rounded text-sm"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : parseInt(e.target.value, 10))}
      />
    </div>
  );
}

/** ％入力はすべてスライダー（5%刻み・値をラベル表示） */
function SliderField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  hint?: string;
}) {
  return (
    <div>
      <div className="text-[10.5px] text-text-faint mb-1">{label}</div>
      <div className="grid grid-cols-[1fr_60px] gap-3 items-center">
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={value ?? 0}
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
          className="w-full"
          aria-label={label}
        />
        <div className="text-lg font-bold text-info text-right tabular-nums">
          {value ?? '-'}
          <span className="text-xs text-text-muted font-medium">%</span>
        </div>
      </div>
      {hint && <p className="text-[10px] text-text-faint mt-0.5">{hint}</p>}
    </div>
  );
}

/** 数値ステッパー（タイピングを減らす。直接入力も残す） */
function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  label,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  step?: number;
  min?: number;
  label: string;
}) {
  const bump = (d: number) => onChange(Math.max(min, (value ?? 0) + d));
  return (
    <div className="inline-flex items-center border rounded-lg overflow-hidden bg-white">
      <button
        type="button"
        onClick={() => bump(-step)}
        aria-label={`${label}を減らす`}
        className="w-8 h-8 flex items-center justify-center text-text-muted hover:bg-surface transition-colors duration-150 active:scale-[0.95]"
      >
        −
      </button>
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : parseInt(e.target.value, 10))}
        aria-label={label}
        className="w-12 px-1 py-1 text-sm text-center border-x outline-none tabular-nums"
      />
      <button
        type="button"
        onClick={() => bump(step)}
        aria-label={`${label}を増やす`}
        className="w-8 h-8 flex items-center justify-center text-text-muted hover:bg-surface transition-colors duration-150 active:scale-[0.95]"
      >
        ＋
      </button>
    </div>
  );
}

/**
 * 確認テスト（単語/確認は運用上分けられないため1本に統合）。
 * 合否は得点から自動判定するので、講師は点数だけ入れればよい。
 */
function CheckTestField({
  score,
  total,
  passed,
  onScoreChange,
  onTotalChange,
}: {
  score: number | null;
  total: number | null;
  passed: boolean | null;
  onScoreChange: (v: number | null) => void;
  onTotalChange: (v: number | null) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-text-muted mb-1">
        確認テスト（1本に統合）
      </label>
      <div className="flex items-center gap-2 flex-wrap">
        <Stepper value={score} onChange={onScoreChange} label="確認テストの得点" />
        <span className="text-sm text-text-muted">/</span>
        <Stepper value={total} onChange={onTotalChange} label="確認テストの満点" />
        {passed === null ? (
          <span className="text-[11px] text-text-faint">点数を入れると合否を自動判定します</span>
        ) : (
          <span
            className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold ${
              passed ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning'
            }`}
          >
            {passed ? '合格' : '不合格'}（自動判定）
          </span>
        )}
      </div>
    </div>
  );
}

function SubjectSpecificField({
  value,
  onChange,
}: {
  value: SubjectSpecific | null;
  onChange: (v: SubjectSpecific | null) => void;
}) {
  const kind = value?.kind ?? 'none';
  // 'none' 以外は { kind, range, pages, times_per_day, duration } を持つ統一構造
  const v = (value && value.kind !== 'none' ? value : null) as Exclude<
    SubjectSpecific,
    { kind: 'none' }
  > | null;
  // プリント自由記述（extra_materials）は kind に依らず保持する
  const extra = value?.extra_materials;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <label>種別:</label>
        <select
          value={kind}
          onChange={(e) => {
            const k = e.target.value as SubjectSpecific['kind'];
            if (k === 'none') onChange({ kind: 'none', extra_materials: extra });
            else
              onChange({
                kind: k,
                range: v?.range ?? '',
                pages: v?.pages ?? '',
                times_per_day: v?.times_per_day ?? 5,
                duration: v?.duration ?? '1週間',
                extra_materials: extra,
              });
          }}
          className="px-2 py-1 border rounded text-sm"
        >
          <option value="none">なし</option>
          <option value="vocab">英語：単語練習</option>
          <option value="calc">数学：計算練習</option>
          <option value="kanji">国語：漢字練習</option>
        </select>
      </div>

      {kind !== 'none' && v && (
        <div className="p-3 bg-warning-subtle border border-warning rounded-md grid grid-cols-2 md:grid-cols-4 gap-2">
          <Field label="練習範囲">
            <input
              type="text"
              value={v.range}
              onChange={(e) => onChange({ ...v, range: e.target.value } as SubjectSpecific)}
              className="w-full px-2 py-1 border rounded text-sm"
            />
          </Field>
          <Field label="ページ">
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted text-xs pointer-events-none">
                p.
              </span>
              <input
                type="text"
                value={v.pages}
                onChange={(e) => onChange({ ...v, pages: e.target.value } as SubjectSpecific)}
                className="w-full pl-7 pr-2 py-1 border rounded text-sm"
              />
            </div>
          </Field>
          <Field label="1日の練習回数">
            <select
              value={v.times_per_day}
              onChange={(e) =>
                onChange({ ...v, times_per_day: parseInt(e.target.value, 10) } as SubjectSpecific)
              }
              className="w-full px-2 py-1 border rounded text-sm"
            >
              <option value={3}>3回</option>
              <option value={5}>5回</option>
              <option value={10}>10回</option>
            </select>
          </Field>
          <Field label="期間">
            <select
              value={v.duration}
              onChange={(e) => onChange({ ...v, duration: e.target.value } as SubjectSpecific)}
              className="w-full px-2 py-1 border rounded text-sm"
            >
              <option value="3日間">3日間</option>
              <option value="1週間">1週間</option>
            </select>
          </Field>
        </div>
      )}
    </div>
  );
}

// ---------- デモモード ----------

/**
 * /lesson-reports/demo 用のダミーデータ。DBを引かずに実フォームの見た目を確認するため、
 * 進行表グリッドの行も合成する（保存・提出は無効）。
 */
function loadDemo(setters: {
  setEntry: (v: ScheduleEntryInfo) => void;
  setNextLessonDate: (v: string | null) => void;
  setScheduledDates: (v: string[]) => void;
  setGoalHeader: (v: GoalHeader | null) => void;
  setTextbookOptions: (v: StudentTextbookOption[]) => void;
  setGridRows: (v: Record<string, CurriculumItemWithProgress[]>) => void;
  setSelections: (v: Record<string, GridSelectionState>) => void;
  setHandover: (v: string) => void;
  setForm: (v: ClassReportFormData) => void;
  setPreviousLesson: (v: PreviousLessonSummary | null) => void;
}) {
  const lessonDate = todayInJst();
  const next = buildHomeworkDateRows({ lessonDate, nextLessonDate: null });
  const nextLessonDate = next[next.length - 1] ?? null;

  setters.setEntry({
    id: 'demo',
    school_id: 'demo',
    entry_date: lessonDate,
    student_id: 'demo-student',
    teacher_id: 'demo-teacher',
    subject_ids: ['demo-math'],
    time_slot: { slot_number: 5, start_time: '18:00', end_time: '19:30' },
    student: { id: 'demo-student', last_name: '山田', first_name: '花子', grade: 8 },
    teacher: { id: 'demo-teacher', display_name: '佐々木 先生', email: null },
  });
  setters.setNextLessonDate(nextLessonDate);
  // 期日カウントダウンの見本用に、試験日までの授業予定を数件置く
  setters.setScheduledDates([1, 4, 8, 11].map((d) => addDaysLocal(lessonDate, d)));
  setters.setGoalHeader({
    examLabel: '期末テスト 数学',
    examDate: addDaysLocal(lessonDate, 14),
    targetScore: 80,
    examRange: '一次関数まで',
    actionGoals: ['ノートに途中式を残す', '宿題は日割りでその日のうちに'],
  });

  const options: StudentTextbookOption[] = [
    {
      id: 'tb-main',
      textbook_id: 1,
      textbook_name: '新中学問題集 数学2年',
      curriculum_items: [
        { id: 1, title: '連立方程式の利用', sort_order: 1 },
        { id: 2, title: '一次関数の式', sort_order: 2 },
        { id: 3, title: '一次関数の利用', sort_order: 3 },
        { id: 4, title: '一次関数のグラフ', sort_order: 4 },
      ],
    },
  ];
  setters.setTextbookOptions(options);
  setters.setGridRows({
    'tb-main': options[0].curriculum_items.map((it) => ({
      id: it.id,
      textbook_id: 1,
      title: it.title,
      item_number: it.sort_order,
      item_type: null,
      sort_order: it.sort_order,
      created_at: '',
      progress: null,
    })) as unknown as CurriculumItemWithProgress[],
  });
  setters.setSelections({
    'tb-main': {
      unitActions: { 2: 1 },
      schoolUnits: new Set([3]),
      origSchoolUnitIds: [3],
      sessionId: null,
      // 見本でも既定は自動（進行表通り）。セルをクリックすると次回の予定が追従する
      nextPlanManual: null,
    },
  });
  setters.setHandover(
    '符号ミスは減ってきたが、分数係数が入ると手が止まる。次回は分数係数の変化の割合から。丸付けは自走OK。'
  );

  // 前回の授業（見本）。本番と同じく「セッションが一次情報・報告書は上乗せ」の形で作る。
  setters.setPreviousLesson({
    lessonDate: addDaysLocal(lessonDate, -4),
    textbooks: [
      {
        studentTextbookId: 'tb-main',
        textbookName: '新中学問題集 数学2年',
        units: [{ title: '連立方程式の利用', lessonNumber: 2 }],
        handover:
          '文章題の立式は自力でできるようになった。代入法の計算ミスが残るので、次回は一次関数へ入る前に5分だけ復習を挟む。',
        teacherName: '佐々木 先生',
        // 前回そのとき決めた次回の予定＝今日やる予定だった単元
        nextPlanUnits: ['一次関数の式'],
      },
    ],
    tardy: false,
    homeworkNotDone: true,
    report: {
      reportId: 'demo-previous-report',
      status: 'approved',
      schoolProgress: '新中学問題集 数学2年 / 一次関数の式',
      reviewComment:
        '連立方程式の文章題を中心に演習しました。式は立てられるようになったので、次は計算の正確さを上げていきます。',
      homeworkAssignments: [
        { date: addDaysLocal(lessonDate, -3), text: '新中問 p.52-53' },
        { date: addDaysLocal(lessonDate, -2), text: '新中問 p.54 ＋ 間違い直し' },
      ],
      homeworkCompletionPct: 0,
      homeworkCorrectPct: null,
      todayCorrectPct: 70,
    },
  });
  setters.setForm({
    schedule_entry_id: 'demo',
    student_id: 'demo-student',
    teacher_id: 'demo-teacher',
    lesson_date: lessonDate,
    short_term_goal: '一次関数の変化の割合を自力で求められるようにする',
    mid_term_goal_snapshot: '',
    mid_action_goal_snapshot: '',
    school_progress: '',
    // 見本では「遅刻あり・宿題はやってきた」状態にして、マークの見え方を確認できるようにする
    tardy: true,
    homework_not_done: false,
    homework_completion_pct: 90,
    homework_correct_pct: 75,
    today_correct_pct: 85,
    vocab_test_score: null,
    vocab_test_total: null,
    vocab_test_passed: null,
    check_test_score: 15,
    check_test_total: 20,
    check_test_passed: true,
    review_comment:
      '変化の割合の意味をグラフと式の両方から確認しました。符号ミスがまだ出ますが、後半は自力で正確に求められています。次回は式からグラフを描く練習に進みます。',
    homework_assignments: next.map((d, i) => ({
      date: d,
      text: i === 0 ? '新中問 p.59 の基本問題' : i === 1 ? '新中問 p.60 ＋ 昨日の間違い直し' : '',
    })),
    // 次回の予定は保存直前に組み立てる項目なので、state は本番と同じく空で持つ
    next_plan: [],
    subject_specific: { kind: 'none', extra_materials: '計算プリント（分数係数）を10問' },
    status: 'draft',
    units: [
      {
        student_textbook_id: 'tb-main',
        is_main: true,
        curriculum_item_ids: [2],
        page_start: 54,
        page_end: 58,
        display_order: 0,
      },
    ],
  });
}

/** デモ用の日付加算（reportSchedule の addDays を使うと import が循環しないので直接利用） */
function addDaysLocal(date: string, n: number): string {
  const t = Date.parse(`${date}T12:00:00Z`);
  return new Date(t + n * 86400000).toISOString().slice(0, 10);
}
