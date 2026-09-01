'use client';

/**
 * 授業報告書「入力フォーム」のUIモック（検討用・admin限定・DBアクセス一切なし）
 *
 * 目的:
 *   ログインした状態のまま、実データに触れずに「いまの入力フォームの仕様」を触って、
 *   細かい調整点（文言・並び順・入力UI・ガイドの効き方）を洗い出すための画面。
 *   ここで決めた調整を本体（/lesson-reports/[scheduleEntryId]）へ反映していく。
 *
 * 再現元:
 *   src/app/lesson-reports/[scheduleEntryId]/page.tsx（セクション構成・見出し文言・並び順）
 *   docs/lesson-report-flow-plan.md §3・§4（ゆるいガイドバーの設計）
 *
 * ★ 実物を作り直さない:
 *   ガイドバーは実物の <ReportGuideBar> を、判定は実物の computeGuideSteps を、
 *   宿題マークの同期は実物の homeworkMark.ts をそのまま import して使う。
 *   モック側でロジックを二重実装すると「モックでは直ったのに本番では直っていない」が起きる。
 *
 * ★ モックとして意図的に簡略化した点（本物との差）:
 *   - 下段の進行表グリッドは巨大なので、単元チップのトグルだけの簡易版に置き換えている。
 *   - 前回の授業カード・保護者プレビュー・提出前チェックパネル・自動保存は出していない。
 *   - ガイドの表示状態を localStorage に保存しない（毎回同じ初期状態で触れるようにするため）。
 *   - 保存は一切しない（ボタンを押すとトーストを出すだけ）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { isSystemAdmin } from '@/lib/utils/roles';
import { AdminLayout } from '@/components/layouts';
import { Button, Card, CardContent, Loading, ToastContainer } from '@/components/ui';
import AccessDenied from '@/components/AccessDenied';
import { useToast } from '@/hooks/useToast';
import { ReportGuideBar } from '@/components/lesson-reports/ReportGuideBar';
import { computeGuideSteps, type GuideStepInput } from '@/lib/lesson-reports/guideSteps';
import { applyHomeworkCompletionPct, applyHomeworkMark } from '@/lib/lesson-reports/homeworkMark';
import { judgeCheckTestPassed } from '@/lib/lesson-reports/reportSchedule';
import {
  ArrowUp,
  CalendarClock,
  ChevronLeft,
  ClipboardList,
  Compass,
  Eye,
  Info,
  Lock,
  RotateCcw,
  Save,
  Send,
  SkipForward,
  Undo2,
  Wand2,
} from 'lucide-react';

/* ============================================================
 * ダミーデータ（このファイルの中だけで完結。API/DB には触らない）
 * ========================================================== */

const STUDENT_NAME = '山田 太郎';
const GRADE_LABEL = '中2';
const TEACHER_NAME = '佐藤';
const LESSON_DATE = '2026-09-01';
const SLOT_LABEL = '3限';
const TIME_LABEL = '16:20〜17:50';
const NEXT_LESSON_DATE = '2026-09-05';

interface MockUnit {
  /** 進行表のカリキュラム単元ID相当 */
  id: number;
  title: string;
  /** 指導範囲チップに出す「n回目」（本物は進行表の実施回数から数える） */
  lessonNumber: number;
}

interface MockTextbook {
  id: string;
  name: string;
  isMain: boolean;
  units: MockUnit[];
}

// メイン教材＋サブ教材の2セット。本物と同じく「メイン／サブ」のバッジで区別する
const TEXTBOOKS: MockTextbook[] = [
  {
    id: 'tb-main',
    name: '新中学問題集 英語2年',
    isMain: true,
    units: [
      { id: 101, title: '不定詞（名詞的用法）', lessonNumber: 1 },
      { id: 102, title: '不定詞（副詞的用法）', lessonNumber: 1 },
      { id: 103, title: '不定詞（形容詞的用法）', lessonNumber: 2 },
      { id: 104, title: '動名詞', lessonNumber: 1 },
      { id: 105, title: '比較（原級）', lessonNumber: 1 },
    ],
  },
  {
    id: 'tb-sub',
    name: '英文法パターンドリル2',
    isMain: false,
    units: [
      { id: 201, title: '現在完了（経験）', lessonNumber: 2 },
      { id: 202, title: '現在完了（継続）', lessonNumber: 1 },
      { id: 203, title: '受け身', lessonNumber: 1 },
      { id: 204, title: '助動詞', lessonNumber: 1 },
    ],
  },
];

/** 目標ヘッダー（本物は進行表と同期。モックでは表示のみの固定値） */
const GOAL_EXAM_LABEL = '2学期中間テスト';
const GOAL_TARGET_SCORE = 80;
const GOAL_EXAM_RANGE = 'Lesson3〜4';
const GOAL_EXAM_DATE = '2026-10-06';
const GOAL_ACTION_GOALS = ['毎日30分の単語練習', '宿題を提出日までに終わらせる'];
const GOAL_DAYS_LEFT = 35;
const GOAL_LESSONS_LEFT = 10;

/* ============================================================
 * ページ本体
 * ========================================================== */

/** 教材ID → 選んだ単元IDの配列。今日やった単元・学校進度・次回の予定で同じ形を使う */
type UnitSelection = Record<string, number[]>;

/** 次回までの宿題の日割り1行 */
interface HomeworkRow {
  date: string;
  text: string;
}

/** 教材ごとのページ数（開始・終了） */
interface PageRange {
  start: number | null;
  end: number | null;
}

const emptySelection = (): UnitSelection => ({ 'tb-main': [], 'tb-sub': [] });
const emptyPages = (): Record<string, PageRange> => ({
  'tb-main': { start: null, end: null },
  'tb-sub': { start: null, end: null },
});

/** 授業日の翌日から次回授業日までの日割り行を作る（本物と同じ考え方） */
function buildHomeworkRows(): HomeworkRow[] {
  const rows: HomeworkRow[] = [];
  const cursor = new Date(`${LESSON_DATE}T12:00:00Z`);
  const end = new Date(`${NEXT_LESSON_DATE}T12:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor.getTime() <= end.getTime()) {
    rows.push({ date: cursor.toISOString().slice(0, 10), text: '' });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return rows;
}

function MockFormPage() {
  const { toasts, removeToast, info } = useToast();

  // ---- フォーム state（本物の form/selections をモック用に平たくしたもの） ----
  const [goal, setGoal] = useState('');
  const [taught, setTaught] = useState<UnitSelection>(emptySelection);
  const [schoolUnits, setSchoolUnits] = useState<UnitSelection>(emptySelection);
  const [pages, setPages] = useState<Record<string, PageRange>>(emptyPages);
  const [extraMaterials, setExtraMaterials] = useState('');
  const [tardy, setTardy] = useState(false);
  const [homeworkNotDone, setHomeworkNotDone] = useState(false);
  /** 次回の予定を手で選び直したか（null＝進行表通りの自動追従） */
  const [nextPlanManual, setNextPlanManual] = useState<Record<string, number[] | null>>({
    'tb-main': null,
    'tb-sub': null,
  });
  const [nextPlanPickerFor, setNextPlanPickerFor] = useState<string | null>(null);
  const [homeworkCompletionPct, setHomeworkCompletionPct] = useState<number | null>(null);
  const [homeworkCorrectPct, setHomeworkCorrectPct] = useState<number | null>(null);
  const [todayCorrectPct, setTodayCorrectPct] = useState<number | null>(null);
  const [checkTestScore, setCheckTestScore] = useState<number | null>(null);
  const [checkTestTotal, setCheckTestTotal] = useState<number | null>(10);
  const [reviewComment, setReviewComment] = useState('');
  const [homeworkRows, setHomeworkRows] = useState<HomeworkRow[]>(buildHomeworkRows);
  const [subjectKind, setSubjectKind] = useState<'none' | 'vocab' | 'calc' | 'kanji'>('none');
  const [subjectRange, setSubjectRange] = useState('');
  const [handover, setHandover] = useState('');

  // ---- ガイドバー（見せ方だけの機能。フォーム state には関与しない） ----
  const [guideVisible, setGuideVisible] = useState(true);
  // 「該当なし」等で手動で済にした質問。★モックでも保存しない（設計書 §3 と同じ）
  const [guideManualDone, setGuideManualDone] = useState<ReadonlySet<string>>(new Set<string>());
  const guideHighlightElRef = useRef<HTMLElement | null>(null);
  const guideHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- スティッキーバー（公開ゾーンが画面上端から消えたら出す） ----
  const publicZoneRef = useRef<HTMLDivElement>(null);
  const publicZoneEndRef = useRef<HTMLDivElement>(null);
  const [showStickyBar, setShowStickyBar] = useState(false);

  useEffect(() => {
    const sentinel = publicZoneEndRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([e]) => {
        // 「画面内に無い」かつ「上へ抜けた」ときだけ出す（本物と同じ判定）
        setShowStickyBar(!e.isIntersecting && e.boundingClientRect.top < 0);
      },
      { threshold: 0 }
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, []);

  const scrollToReport = useCallback(() => {
    publicZoneRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // ---- 派生値 ----

  /** 今日やった単元のチップ（教材ごと） */
  const taughtChipsOf = useCallback(
    (tbId: string) => {
      const tb = TEXTBOOKS.find((t) => t.id === tbId);
      if (!tb) return [];
      const ids = taught[tbId] ?? [];
      return tb.units.filter((u) => ids.indexOf(u.id) >= 0);
    },
    [taught]
  );

  /** スティッキーバー用に全教材ぶんを1列に並べたチップ */
  const allTaughtChips = useMemo(
    () => TEXTBOOKS.reduce<MockUnit[]>((acc, tb) => acc.concat(taughtChipsOf(tb.id)), []),
    [taughtChipsOf]
  );

  const selectedUnitCount = allTaughtChips.length;

  /** 学校の進度ラベル（`教材名 / 単元名`）。本物と同じ組み立て方 */
  const schoolProgressLabels = useMemo(() => {
    const labels: string[] = [];
    TEXTBOOKS.forEach((tb) => {
      const ids = schoolUnits[tb.id] ?? [];
      tb.units.forEach((u) => {
        if (ids.indexOf(u.id) >= 0) labels.push(`${tb.name} / ${u.title}`);
      });
    });
    return labels;
  }, [schoolUnits]);

  /**
   * 次回の予定の自動提案。
   * 本物は「今日やった単元より後ろで、まだ3回とも埋まっていない先頭の1単元」。
   * モックでは「今日やっていない先頭の1単元」に単純化している。
   */
  const nextPlanIdsOf = useCallback(
    (tbId: string): number[] => {
      const manual = nextPlanManual[tbId];
      if (manual != null) return manual;
      const tb = TEXTBOOKS.find((t) => t.id === tbId);
      if (!tb) return [];
      const done = taught[tbId] ?? [];
      const next = tb.units.find((u) => done.indexOf(u.id) < 0);
      return next ? [next.id] : [];
    },
    [nextPlanManual, taught]
  );

  const nextPlanCount = useMemo(
    () => TEXTBOOKS.reduce((n, tb) => n + nextPlanIdsOf(tb.id).length, 0),
    [nextPlanIdsOf]
  );

  // 確認テストの合否は得点から自動判定する（実物の純関数をそのまま使う）
  const checkTestPassed = useMemo(
    () => judgeCheckTestPassed(checkTestScore, checkTestTotal),
    [checkTestScore, checkTestTotal]
  );

  const reviewLineCount = useMemo(
    () => (reviewComment.trim() === '' ? 0 : reviewComment.split('\n').length),
    [reviewComment]
  );

  // ---- ガイドバー: いまの入力から「次に答える質問」を出す ----
  // ★ 本物と同じ材料を同じ意味で組み立てる（ここがモックの主目的）
  const guideInput: GuideStepInput = useMemo(
    () => ({
      tardy,
      homeworkNotDone,
      hasTextbooks: TEXTBOOKS.length > 0,
      selectedUnitCount,
      extraMaterials,
      homeworkAchievementAvailable: true,
      homeworkAchievementFilled:
        homeworkCompletionPct != null || homeworkCorrectPct != null || todayCorrectPct != null,
      checkTestScoreFilled: checkTestScore != null,
      schoolProgressFilled: schoolProgressLabels.length > 0,
      goal,
      nextPlanFilled: nextPlanCount > 0,
      homeworkRowsAvailable: homeworkRows.length > 0,
      homeworkRowsFilled: homeworkRows.some((r) => r.text.trim() !== ''),
      handover,
      review: reviewComment,
    }),
    [
      tardy,
      homeworkNotDone,
      selectedUnitCount,
      extraMaterials,
      homeworkCompletionPct,
      homeworkCorrectPct,
      todayCorrectPct,
      checkTestScore,
      schoolProgressLabels.length,
      goal,
      nextPlanCount,
      homeworkRows,
      handover,
      reviewComment,
    ]
  );

  const guideSteps = useMemo(
    () => computeGuideSteps(guideInput, guideManualDone),
    [guideInput, guideManualDone]
  );

  /** ハイライトを消す（タイマーも止める） */
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

  /** 「ここに答える」: その質問のセクションへ運んで2秒だけ光らせる（本物と同じ挙動） */
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

  /** 「該当なし」等: 自動判定できない質問を手動で済にする */
  const handleGuideManualDone = useCallback((id: string) => {
    setGuideManualDone((prev) => {
      // ★ Set のスプレッド展開は ES5 ターゲットで壊れるので Array.from を使う
      const next = new Set(Array.from(prev));
      next.add(id);
      return next;
    });
  }, []);

  /** ×: バーを閉じる。★モックでは localStorage に覚えさせない */
  const handleGuideDismiss = useCallback(() => setGuideVisible(false), []);
  const handleGuideRestore = useCallback(() => setGuideVisible(true), []);

  const handleGuideSubmitJump = useCallback(() => {
    document.getElementById('guide-submit')?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, []);

  // ---- 入力ハンドラ ----

  /** 簡易進行表で「今日やった単元」をトグルする（本物はグリッドのセルクリック） */
  const toggleTaught = useCallback((tbId: string, unitId: number) => {
    setTaught((prev) => {
      const cur = prev[tbId] ?? [];
      const next =
        cur.indexOf(unitId) >= 0 ? cur.filter((id) => id !== unitId) : cur.concat(unitId);
      return { ...prev, [tbId]: next };
    });
  }, []);

  /** 簡易進行表で「学校が進んだ単元」をトグルする（本物はグリッドの学校進度列） */
  const toggleSchoolUnit = useCallback((tbId: string, unitId: number) => {
    setSchoolUnits((prev) => {
      const cur = prev[tbId] ?? [];
      const next =
        cur.indexOf(unitId) >= 0 ? cur.filter((id) => id !== unitId) : cur.concat(unitId);
      return { ...prev, [tbId]: next };
    });
  }, []);

  /** 次回の予定を手で選び直す（触った時点で自動追従をやめる） */
  const handleNextPlanToggle = useCallback(
    (tbId: string, unitId: number) => {
      const cur = nextPlanIdsOf(tbId);
      const next =
        cur.indexOf(unitId) >= 0 ? cur.filter((id) => id !== unitId) : cur.concat(unitId);
      setNextPlanManual((prev) => ({ ...prev, [tbId]: next }));
    },
    [nextPlanIdsOf]
  );

  const handleNextPlanReset = useCallback((tbId: string) => {
    setNextPlanManual((prev) => ({ ...prev, [tbId]: null }));
  }, []);

  /** 「宿題未実施」マーク⇄「やってきた量(%)」の双方向同期（実物の純関数を使う） */
  const toggleHomeworkNotDone = useCallback(() => {
    const result = applyHomeworkMark(
      { homeworkNotDone, completionPct: homeworkCompletionPct },
      !homeworkNotDone
    );
    setHomeworkNotDone(result.homeworkNotDone);
    setHomeworkCompletionPct(result.completionPct);
  }, [homeworkNotDone, homeworkCompletionPct]);

  const changeHomeworkCompletionPct = useCallback(
    (v: number | null) => {
      const result = applyHomeworkCompletionPct(
        { homeworkNotDone, completionPct: homeworkCompletionPct },
        v
      );
      setHomeworkNotDone(result.homeworkNotDone);
      setHomeworkCompletionPct(result.completionPct);
    },
    [homeworkNotDone, homeworkCompletionPct]
  );

  const updateHomeworkText = useCallback((idx: number, text: string) => {
    setHomeworkRows((prev) => prev.map((r, i) => (i === idx ? { ...r, text } : r)));
  }, []);

  const updatePage = useCallback((tbId: string, key: keyof PageRange, v: number | null) => {
    setPages((prev) => ({ ...prev, [tbId]: { ...prev[tbId], [key]: v } }));
  }, []);

  // ---- モック操作（調整用の仕掛け。本物には無い） ----

  /** 全部入力済みにする: ガイドバーが完了状態になるところまで一気に埋める */
  const fillAll = useCallback(() => {
    setGoal('不定詞の名詞用法を5問以上正しく訳せる');
    setTaught({ 'tb-main': [101, 102], 'tb-sub': [201] });
    setSchoolUnits({ 'tb-main': [101], 'tb-sub': [] });
    setPages({ 'tb-main': { start: 42, end: 45 }, 'tb-sub': { start: 12, end: 13 } });
    setExtraMaterials('');
    setTardy(false);
    setHomeworkNotDone(false);
    setNextPlanManual({ 'tb-main': null, 'tb-sub': null });
    setHomeworkCompletionPct(80);
    setHomeworkCorrectPct(70);
    setTodayCorrectPct(75);
    setCheckTestScore(8);
    setCheckTestTotal(10);
    setReviewComment(
      '今日は不定詞の名詞的用法を扱いました。\n和訳は最初つまずきましたが、主語になる形を図で整理すると自分で直せるようになりました。\n宿題の量は十分こなせています。\n次回は副詞的用法に進みます。\nご家庭では音読を続けていただけると定着が早まります。'
    );
    setHomeworkRows((prev) =>
      prev.map((r, i) => ({
        ...r,
        text: i === prev.length - 1 ? '' : `ワーク p.${30 + i * 2}-${31 + i * 2}`,
      }))
    );
    setSubjectKind('vocab');
    setSubjectRange('Lesson3の単語 60語');
    setHandover(
      '不定詞は名詞的用法まで完了。副詞的用法は未着手なので次回そこから。宿題の正答率がやや低いので解き直しを見てください。'
    );
    // 「本日の様子」は押さないのが正解のことも多いので、手動の「該当なし」で済にする
    setGuideManualDone(new Set<string>(['mood']));
    setGuideVisible(true);
    info('すべてダミー値で埋めました（保存はされません）');
  }, [info]);

  /** 最初からやり直す: すべて初期化してガイドをQ1へ戻す */
  const resetAll = useCallback(() => {
    setGoal('');
    setTaught(emptySelection());
    setSchoolUnits(emptySelection());
    setPages(emptyPages());
    setExtraMaterials('');
    setTardy(false);
    setHomeworkNotDone(false);
    setNextPlanManual({ 'tb-main': null, 'tb-sub': null });
    setNextPlanPickerFor(null);
    setHomeworkCompletionPct(null);
    setHomeworkCorrectPct(null);
    setTodayCorrectPct(null);
    setCheckTestScore(null);
    setCheckTestTotal(10);
    setReviewComment('');
    setHomeworkRows(buildHomeworkRows());
    setSubjectKind('none');
    setSubjectRange('');
    setHandover('');
    setGuideManualDone(new Set<string>());
    setGuideVisible(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const notSaved = useCallback(() => info('モックなので保存されません'), [info]);

  const mainTextbookName = TEXTBOOKS.find((t) => t.isMain)?.name ?? '';

  return (
    <AdminLayout documentTitle="授業報告書フォーム（モック）">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div className="space-y-4">
        {/* スティッキーバー（高さ0の入れ物に浮かせるので、出し入れしてもレイアウトが動かない） */}
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
                      <UnitChip key={c.id} unit={c} compact />
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

        {/* モック明示バナー */}
        <div className="flex items-start gap-2 rounded-lg border border-info bg-info-subtle px-4 py-3 text-sm text-info">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            これは入力フォームのUIモックです（ダミーデータ・保存されません）。触って気になった点を調整していくための画面です。
          </p>
        </div>

        {/* ヘッダー */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={notSaved}>
            <ChevronLeft className="w-4 h-4 mr-1" />
            戻る
          </Button>
          <h1 className="text-lg font-bold">授業報告書</h1>
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-surface text-text-body">
            下書き
          </span>
          {/* ガイドを×で消した人が戻すための小さな入口 */}
          {!guideVisible && (
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

        {/* ── ゆるいガイドバー（実物のコンポーネント・実物の判定をそのまま使う）── */}
        {guideVisible && (
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
                  {`${LESSON_DATE} ${SLOT_LABEL} ${TIME_LABEL}`}
                </div>
                <div className="text-xl font-bold mt-1">
                  {STUDENT_NAME}{' '}
                  <span className="text-sm font-normal opacity-80">（{GRADE_LABEL}）</span>
                </div>
                <div className="text-sm mt-1 opacity-80 truncate">
                  {mainTextbookName} ・ 講師: {TEACHER_NAME}
                </div>
              </div>
              {/* 次回授業日は宿題の日割りの締切そのものなので常に見えるようにする */}
              <div className="shrink-0 text-right">
                <div className="text-[10px] opacity-70 tracking-wide">次回授業日</div>
                <div className="text-sm font-bold tabular-nums mt-0.5">
                  {formatDateLabel(NEXT_LESSON_DATE)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 目標ヘッダー（本物は進行表と同期。モックでは表示のみの固定値） */}
        <div className="rounded-lg border border-border bg-white px-4 py-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap text-[13px]">
            <span className="text-[10px] font-bold tracking-wide text-text-muted w-14 shrink-0">
              試験目標
            </span>
            <span className="font-semibold text-text-heading">
              {`${GOAL_EXAM_LABEL} ${GOAL_TARGET_SCORE}点（範囲: ${GOAL_EXAM_RANGE}）`}
            </span>
            <span className="ml-auto flex gap-1.5 shrink-0">
              <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold tabular-nums bg-warning-subtle text-warning">
                <CalendarClock className="inline w-3 h-3 mr-1 -mt-0.5" />
                {GOAL_EXAM_DATE.slice(5).replace('-', '/')} ・ あと{GOAL_DAYS_LEFT}日
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold tabular-nums bg-info-subtle text-info">
                授業あと{GOAL_LESSONS_LEFT}回
              </span>
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap text-[13px]">
            <span className="text-[10px] font-bold tracking-wide text-text-muted w-14 shrink-0">
              行動目標
            </span>
            <span className="font-semibold text-text-heading">
              {GOAL_ACTION_GOALS.join(' ・ ')}
            </span>
            <span className="ml-auto px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-ink-subtle text-ink shrink-0">
              進行表と同期
            </span>
          </div>
        </div>

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
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
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
              <div className="space-y-2">
                {TEXTBOOKS.map((tb) => {
                  const chips = taughtChipsOf(tb.id);
                  return (
                    <div
                      key={tb.id}
                      className={`p-3 border rounded-md ${
                        tb.isMain ? 'border-info border-2 bg-info-subtle/30' : 'bg-surface'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <MainSubBadge isMain={tb.isMain} />
                        <span className="text-sm font-semibold text-text-heading truncate">
                          {tb.name}
                        </span>
                      </div>
                      {chips.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {chips.map((c) => (
                            <UnitChip key={c.id} unit={c} />
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
                            value={pages[tb.id]?.start ?? null}
                            onChange={(v) => updatePage(tb.id, 'start', v)}
                          />
                        </Field>
                        <Field label="終了ページ">
                          <PageInput
                            value={pages[tb.id]?.end ?? null}
                            onChange={(v) => updatePage(tb.id, 'end', v)}
                          />
                        </Field>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-text-faint mt-2 mb-1">
                プリント・テキスト外の教材はこちらに（自由記述）
              </p>
              <input
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
                <MarkToggle label="遅刻" active={tardy} onToggle={() => setTardy((v) => !v)} />
                <MarkToggle
                  label="宿題未実施"
                  active={homeworkNotDone}
                  onToggle={toggleHomeworkNotDone}
                />
              </div>
              <p className="text-[10px] text-text-faint mt-1">
                該当するときだけ押します。保護者の報告書にも表示されます
              </p>
            </div>

            {/* 次回の予定（既定は進行表通り・自動。変更したいときだけピッカーを開く） */}
            <div id="guide-next-plan">
              <label className="block text-xs font-semibold text-text-muted mb-1">
                次回の予定
                <span className="ml-2 px-2 py-0.5 rounded-full bg-info-subtle text-info text-[10px] font-bold">
                  進行表の続きを自動で提案
                </span>
              </label>
              <div className="space-y-2">
                {TEXTBOOKS.map((tb) => (
                  <NextPlanUnitBlock
                    key={tb.id}
                    textbookName={tb.name}
                    isMain={tb.isMain}
                    isManual={nextPlanManual[tb.id] != null}
                    unitTitles={nextPlanIdsOf(tb.id).map(
                      (id) => tb.units.find((u) => u.id === id)?.title ?? ''
                    )}
                    pickerOpen={nextPlanPickerFor === tb.id}
                    onTogglePicker={() =>
                      setNextPlanPickerFor((cur) => (cur === tb.id ? null : tb.id))
                    }
                    candidates={tb.units}
                    selectedIds={nextPlanIdsOf(tb.id)}
                    onToggleUnit={(cid) => handleNextPlanToggle(tb.id, cid)}
                    onReset={() => handleNextPlanReset(tb.id)}
                  />
                ))}
              </div>
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
                  value={homeworkCompletionPct}
                  onChange={changeHomeworkCompletionPct}
                  hint="0% にすると「宿題未実施」マークが自動で付きます"
                />
                <SliderField
                  label="宿題の正答率"
                  value={homeworkCorrectPct}
                  onChange={setHomeworkCorrectPct}
                />
                <SliderField
                  label="今日の演習の正答率"
                  value={todayCorrectPct}
                  onChange={setTodayCorrectPct}
                />
              </div>
            </div>

            {/* 確認テスト（1本に統合・合否は自動判定） */}
            <div id="guide-check-test">
              <CheckTestField
                score={checkTestScore}
                total={checkTestTotal}
                passed={checkTestPassed}
                onScoreChange={setCheckTestScore}
                onTotalChange={setCheckTestTotal}
              />
            </div>

            {/* 講評（手書き） */}
            <div id="guide-review">
              <Field label="講評（手書き・保護者が読む文章）">
                <textarea
                  className="w-full px-3 py-2 border rounded-md text-sm"
                  rows={5}
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
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
                {`次回までの宿題（次回授業日 ${formatDateLabel(NEXT_LESSON_DATE)} まで）`}
                <span className="ml-2 px-2 py-0.5 rounded-full bg-info-subtle text-info text-[10px] font-bold">
                  次回授業日までの日付を自動生成
                </span>
              </label>
              <p className="text-[10px] text-text-faint mb-2">次回授業日の行は入力なしでOKです</p>
              <div className="space-y-1">
                {homeworkRows.map((a, idx) => {
                  const isNext = a.date === NEXT_LESSON_DATE;
                  return (
                    <div key={a.date} className="grid grid-cols-[92px_1fr] gap-2 items-center">
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
              </div>
            </div>

            {/* 科目別欄（モックでは種別＋範囲だけの簡略版） */}
            <Field label="科目別欄（単語・計算・漢字の反復練習）">
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <label htmlFor="mock-subject-kind">種別:</label>
                <select
                  id="mock-subject-kind"
                  value={subjectKind}
                  onChange={(e) =>
                    setSubjectKind(e.target.value as 'none' | 'vocab' | 'calc' | 'kanji')
                  }
                  className="px-2 py-1 border rounded text-sm"
                >
                  <option value="none">なし</option>
                  <option value="vocab">英語：単語練習</option>
                  <option value="calc">数学：計算練習</option>
                  <option value="kanji">国語：漢字練習</option>
                </select>
                {subjectKind !== 'none' && (
                  <input
                    type="text"
                    value={subjectRange}
                    onChange={(e) => setSubjectRange(e.target.value)}
                    className="flex-1 min-w-[180px] px-2 py-1 border rounded text-sm"
                    placeholder="例: Lesson3の単語 60語"
                  />
                )}
              </div>
              <p className="text-[10px] text-text-faint mt-1">
                モックでは範囲のみ。本物は回数・期間などの入力もあります
              </p>
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
                className="w-full px-3 py-2 border rounded-md text-sm"
                rows={3}
                value={handover}
                onChange={(e) => setHandover(e.target.value)}
                placeholder="次の講師への引継ぎを入力..."
              />
            </Field>
          </div>
        </Zone>

        {/* ── 下段: 進行表グリッド（モックでは簡略表示）── */}
        <section className="rounded-lg border border-border overflow-hidden">
          <div className="flex items-center gap-1.5 px-4 py-2 bg-surface text-[11px] font-bold tracking-wide text-text-muted">
            <ClipboardList className="w-3.5 h-3.5" />
            下段：進行表グリッド（モックでは簡略表示）
          </div>
          <div className="bg-white p-4 space-y-3">
            <p className="text-[11px] text-text-faint">
              本物はここに単元×3回ぶんのグリッドが並びます。モックでは上のセクションへの自動反映を確かめるため、単元チップのトグルだけを置いています
            </p>
            {TEXTBOOKS.map((tb) => (
              <div
                key={tb.id}
                className={`p-3 border rounded-md ${
                  tb.isMain ? 'border-info border-2 bg-info-subtle/30' : 'bg-surface'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <MainSubBadge isMain={tb.isMain} />
                  <span className="text-sm font-semibold text-text-heading truncate">
                    {tb.name}
                  </span>
                </div>

                <p className="text-[10px] font-bold text-text-muted mb-1">今日やった単元</p>
                <div className="flex flex-wrap gap-1.5">
                  {tb.units.map((u) => {
                    const on = (taught[tb.id] ?? []).indexOf(u.id) >= 0;
                    return (
                      <button
                        key={u.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleTaught(tb.id, u.id)}
                        className={`rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors duration-150 active:scale-[0.97] ${
                          on
                            ? 'border-info bg-info text-white'
                            : 'border-border bg-white text-text-muted hover:bg-surface'
                        }`}
                      >
                        {u.title}
                      </button>
                    );
                  })}
                </div>

                <p className="text-[10px] font-bold text-text-muted mt-3 mb-1">学校が進んだ単元</p>
                <div className="flex flex-wrap gap-1.5">
                  {tb.units.map((u) => {
                    const on = (schoolUnits[tb.id] ?? []).indexOf(u.id) >= 0;
                    return (
                      <button
                        key={u.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleSchoolUnit(tb.id, u.id)}
                        className={`rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors duration-150 active:scale-[0.97] ${
                          on
                            ? 'border-text-muted bg-text-muted text-white'
                            : 'border-border bg-white text-text-muted hover:bg-surface'
                        }`}
                      >
                        {u.title}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* フッター（提出エリア）。id はガイドバーの「提出へ」のスクロール先 */}
        <div id="guide-submit" className="sticky bottom-0 bg-white border-t -mx-4 px-4">
          <div className="flex flex-wrap items-center gap-2 py-3">
            <span className="text-xs text-text-muted flex-1 min-w-[140px]">
              モックのため保存されません
            </span>
            <Button variant="outline" onClick={notSaved}>
              キャンセル
            </Button>
            <Button variant="outline" onClick={notSaved}>
              <Eye className="w-4 h-4 mr-1" />
              保護者の見え方
            </Button>
            <Button variant="outline" onClick={notSaved}>
              <Save className="w-4 h-4 mr-1" />
              下書き保存
            </Button>
            <Button onClick={notSaved}>
              <Send className="w-4 h-4 mr-1" />
              提出 (室長承認待ち)
            </Button>
          </div>
        </div>

        {/* モック限定の操作（調整用の仕掛け。本物には無い） */}
        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-text-muted mb-2">
            <Wand2 className="h-3.5 w-3.5" />
            モック操作
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={fillAll}>
              <Wand2 className="w-4 h-4 mr-1" />
              全部入力済みにする
            </Button>
            <Button variant="outline" size="sm" onClick={resetAll}>
              <Undo2 className="w-4 h-4 mr-1" />
              最初からやり直す
            </Button>
            <span className="text-[11px] text-text-faint">
              ガイドバーが完了状態になるところまで一気に埋めたり、初期状態へ戻したりできます
            </span>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

/* ============================================================
 * 表示ヘルパー（本物の同名コンポーネントの見た目に合わせた簡易版）
 * ========================================================== */

/** 日付ラベル 'YYYY-MM-DD' → 'M/D(曜)' */
function formatDateLabel(date: string): string {
  if (!date) return '';
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${w})`;
}

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

/** メイン／サブのバッジ */
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

/** 指導範囲のチップ（単元名 ＋ n回目）。本物と同じく読み取り専用 */
function UnitChip({ unit, compact }: { unit: MockUnit; compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-info-subtle font-semibold text-info ${
        compact ? 'px-2 py-0.5 text-[10.5px]' : 'px-2.5 py-1 text-[11.5px]'
      }`}
    >
      <span className={compact ? 'max-w-[120px] truncate' : ''}>{unit.title}</span>
      <span className="rounded-full bg-info px-1.5 text-[9.5px] font-bold text-white tabular-nums">
        {unit.lessonNumber}回目
      </span>
    </span>
  );
}

/** 次回の予定（教材セット1つぶん）。既定は「進行表通り」で、変えたいときだけピッカーを開く */
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
  isManual: boolean;
  unitTitles: string[];
  pickerOpen: boolean;
  onTogglePicker: () => void;
  candidates: MockUnit[];
  selectedIds: number[];
  onToggleUnit: (curriculumItemId: number) => void;
  onReset: () => void;
}) {
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
          <div className="max-h-[200px] overflow-y-auto flex flex-wrap gap-1.5">
            {candidates.map((c) => {
              const on = selectedIds.indexOf(c.id) >= 0;
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

/** 本日の様子のトグルピル（遅刻／宿題未実施） */
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

/** 確認テスト（1本に統合・合否は得点から自動判定） */
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

/* ============================================================
 * ゲート（admin 限定。モック画面なので他ロールには出さない）
 * ========================================================== */

export default function LessonReportFormMockPage() {
  const { profile, isLoading } = useAuth();

  if (isLoading) {
    return (
      <AdminLayout>
        <Loading />
      </AdminLayout>
    );
  }

  if (!isSystemAdmin(profile?.role)) {
    return (
      <AdminLayout>
        <AccessDenied message="このページはシステム管理者のみアクセス可能です" />
      </AdminLayout>
    );
  }

  return <MockFormPage />;
}
