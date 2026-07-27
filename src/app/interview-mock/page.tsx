'use client';

/**
 * 面談ワークスペース モック（検討用）
 * ------------------------------------------------------------------
 * 教室長が保護者面談・生徒面談をする際、現状バラバラな
 * 「過去の面談記録」「授業の進行表」「成績表」を1画面に集約し、
 * その場で今回の面談記録を書き終えられるワークスペースの叩き台。
 *
 * すべてダミーデータ直書き・DB接続やAPI呼び出しは一切なし。
 * レイアウト・情報の集約の仕方を目で確認するためのモックであり、本番ロジックは未接続。
 * 検討OKなら本番ルートへ昇格し、ダミーを実データ取得（面談記録API・成績API・進行表API）に差し替える。
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { AdminLayout } from '@/components/layouts';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Textarea,
  Input,
} from '@/components/ui';
import { Loading } from '@/components/ui';
import { Select } from '@/components/ui';
import AccessDenied from '@/components/AccessDenied';
import { isManagerOrAbove } from '@/lib/utils/roles';
import {
  Flag,
  ExternalLink,
  Pin,
  CircleCheck,
  Circle,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  Minus,
  Mic,
  X,
  Plus,
  CheckCircle2,
  Phone,
  Users,
  User,
  BookOpen,
  ClipboardList,
  History,
  AlertCircle,
} from 'lucide-react';

/* ============================================================
 * 型定義
 * ========================================================== */

// 面談種別（タイムライン・新規メモの両方で使う）
type InterviewKind = 'parent' | 'student' | 'phone';

const INTERVIEW_KIND_LABELS: Record<InterviewKind, string> = {
  parent: '保護者面談',
  student: '生徒面談',
  phone: '電話',
};

// タイムライン上のバッジの色調（保護者面談=info/生徒面談=success/電話=default(secondary)）
const INTERVIEW_KIND_BADGE: Record<InterviewKind, string> = {
  parent: 'bg-info-subtle text-info',
  student: 'bg-success-subtle text-success',
  phone: 'bg-surface-hover text-text-muted',
};

const INTERVIEW_KIND_ICON: Record<InterviewKind, React.ElementType> = {
  parent: Users,
  student: User,
  phone: Phone,
};

// 過去の面談記録1件
interface MockInterview {
  id: string;
  date: string; // YYYY-MM-DD
  kind: InterviewKind;
  title: string;
  body: string;
  // 本文とは別に持つ「次回への申し送り」抜粋。無ければ左カラムのピン留めカードには出さない
  handover?: string;
}

// 未完了の約束・タスク
interface MockTask {
  id: string;
  label: string;
  done: boolean;
}

// 成績1教科ぶんの直近3回スコア
interface MockScoreRow {
  subject: string;
  scores: (number | null)[]; // [1学期中間, 1学期期末, 2学期中間] の順
}

// 進行表（使用中テキスト）1件
interface MockTextbookProgress {
  id: string;
  name: string;
  subject: string;
  progressPct: number; // 0-100
  stalled: boolean; // 2週間更新なし相当
  lastEntryDate: string; // YYYY-MM-DD
}

// 基本情報
interface MockBasicInfo {
  grade: string;
  school: string;
  schedule: string; // 通塾曜日・コマ
  courseApplication: string; // 講習申込状況
  textbookCount: number; // 所持教材数
  hasGuardianContact: boolean; // 保護者連絡先の有無
}

interface MockStudent {
  id: string;
  name: string;
  grade: string;
  school: string;
  schedule: string;
  interviews: MockInterview[]; // 新しい順である必要はない（表示側でソートする）
  tasks: MockTask[];
  scoreTestNames: string[]; // 直近3回のテスト名 略称
  scores: MockScoreRow[];
  textbooks: MockTextbookProgress[];
  basic: MockBasicInfo;
}

/* ============================================================
 * ダミーデータ
 * 中3=データ豊富、中2=普通、小6=面談履歴が少ない、と差をつける
 * ========================================================== */

const MOCK_STUDENTS: MockStudent[] = [
  {
    id: 'sato-hanako',
    name: '佐藤 花子',
    grade: '中3',
    school: '永山中学校',
    schedule: '火19:00 / 木19:00',
    interviews: [
      {
        id: 'sato-1',
        date: '2026-01-18',
        kind: 'parent',
        title: '冬期講習の振り返り・受験校相談',
        body: '冬期講習の成果を確認。数学の応用問題の正答率が上がってきている一方、英語の長文読解にまだ時間がかかりすぎる傾向。保護者からは志望校を1つ上げたいという相談があり、模試の判定を見ながら2月末までに最終決定する方針で合意。家庭学習は平日1時間、休日3時間を目安に継続。',
        handover:
          '次回までに：直近の模試結果（2月実施分）を見て志望校の最終判定を行う。英語の長文読解は音読トレーニングを毎日5分追加する提案をする。',
      },
      {
        id: 'sato-2',
        date: '2026-02-22',
        kind: 'student',
        title: '模試結果の共有・英語の学習法見直し',
        body: '2月の模試結果を本人と確認。数学・理科は目標偏差値を上回ったが、英語が伸び悩んでいることを本人も自覚していた。音読トレーニングは3週間ほど継続できていて、長文の読むスピードは体感で上がってきているとのこと。単語力の不足が根本原因と判断し、単熟語帳を1日10個ずつ進める課題を出した。',
        handover:
          '次回までに：単語帳の進捗（1日10個ペース）を確認する。英語の小テストの点数推移をチェックし、必要なら課題量を調整。',
      },
      {
        id: 'sato-3',
        date: '2026-03-15',
        kind: 'parent',
        title: '志望校の最終決定・春期講習の提案',
        body: '2月模試の判定（第一志望A判定・第二志望A判定）を踏まえ、志望校を第一志望のまま確定。保護者も納得。春期講習では理科・社会の総復習コースを提案し、受講することで合意。単語帳の進捗も順調で、直近の小テストの点数が安定してきた。',
      },
      {
        id: 'sato-4',
        date: '2026-04-26',
        kind: 'student',
        title: '春期講習後の状況・数学の弱点補強',
        body: '春期講習を終えての状況確認。理科・社会は総復習の効果が出ていて模試の得点が安定。一方で数学は図形分野（相似・円周角）でつまずきが見られ、演習量を増やす必要がある。本人のモチベーションは高く、自主的に過去問演習を始めたいという希望あり。ワークP42までを次回までの目標に設定。',
        handover:
          '次回までに：数学ワークP42までの進捗確認。過去問演習は数学から始めるサポートをする。',
      },
      {
        id: 'sato-5',
        date: '2026-06-07',
        kind: 'parent',
        title: '夏期講習の提案・志望校別対策の相談',
        body: '1学期期末の成績と模試結果を踏まえ、夏期講習で志望校別の演習コースを提案。保護者からは費用面の質問があり、コース内容と回数を丁寧に説明。過去問演習は数学・英語から着手し、良いペースで進んでいる。図形分野の弱点はワーク演習でだいぶ改善が見られた。',
        handover:
          '次回までに：夏期講習の申込手続き案内。過去問演習の進捗を教科ごとに一覧化して次回共有する。',
      },
      {
        id: 'sato-6',
        date: '2026-07-10',
        kind: 'student',
        title: '夏休みの学習計画・過去問演習の進め方',
        body: '夏休みの学習計画を本人と一緒に立てた。過去問演習は週2年分のペースを目安にし、間違えた問題は単元に戻って復習するサイクルを確認。英語は単語帳をほぼ一周し終え、長文問題集に移行。数学は苦手だった図形分野の演習を継続し、得点が安定してきている。次回は8月の模試結果を見ながら最終調整を行う予定。',
        handover:
          '次回への申し送り：8月模試の結果を見て過去問演習の教科配分を再調整する。英語の長文問題集の進捗（週2〜3題ペース）を確認すること。志望校の出願書類の準備スケジュールも案内する。',
      },
    ],
    tasks: [
      { id: 'sato-t1', label: '英語の単語帳を毎日10個', done: false },
      { id: 'sato-t2', label: '数学ワークP42まで', done: true },
      { id: 'sato-t3', label: '過去問演習（週2年分ペース）', done: false },
      { id: 'sato-t4', label: '夏期講習の申込手続き', done: false },
    ],
    scoreTestNames: ['3学期学年末', '1学期中間', '1学期期末'],
    scores: [
      { subject: '国語', scores: [72, 75, 78] },
      { subject: '数学', scores: [58, 66, 74] },
      { subject: '英語', scores: [61, 64, 63] },
      { subject: '理科', scores: [69, 73, 80] },
      { subject: '社会', scores: [75, 79, 82] },
    ],
    textbooks: [
      {
        id: 'sato-b1',
        name: '中3数学 応用問題集',
        subject: '数学',
        progressPct: 68,
        stalled: false,
        lastEntryDate: '2026-07-18',
      },
      {
        id: 'sato-b2',
        name: '英語長文読解トレーニング',
        subject: '英語',
        progressPct: 45,
        stalled: false,
        lastEntryDate: '2026-07-16',
      },
      {
        id: 'sato-b3',
        name: '理科 総合問題集',
        subject: '理科',
        progressPct: 82,
        stalled: false,
        lastEntryDate: '2026-07-19',
      },
      {
        id: 'sato-b4',
        name: '社会 一問一答',
        subject: '社会',
        progressPct: 90,
        stalled: false,
        lastEntryDate: '2026-07-15',
      },
      {
        id: 'sato-b5',
        name: '国語 読解演習ドリル',
        subject: '国語',
        progressPct: 30,
        stalled: true,
        lastEntryDate: '2026-06-28',
      },
    ],
    basic: {
      grade: '中3',
      school: '永山中学校',
      schedule: '火19:00 / 木19:00',
      courseApplication: '夏期: 申込済 16コマ',
      textbookCount: 6,
      hasGuardianContact: true,
    },
  },
  {
    id: 'tanaka-taro',
    name: '田中 太郎',
    grade: '中2',
    school: '多摩中学校',
    schedule: '月19:00 / 水19:00',
    interviews: [
      {
        id: 'tanaka-1',
        date: '2026-02-14',
        kind: 'parent',
        title: '定期テストの結果共有',
        body: '1学期期末の結果を保護者と確認。全体的に平均点前後で安定しているが、数学の証明問題への苦手意識があるとのこと。家庭学習の時間が不定期になりがちなので、曜日を決めて学習時間を固定する提案をした。部活動との両立についても相談があり、テスト前2週間は部活の量が減るタイミングに合わせて講習を組む方向で調整。',
        handover: '次回までに：数学の証明問題の理解度を授業内で確認し、必要なら補習を検討する。',
      },
      {
        id: 'tanaka-2',
        date: '2026-04-20',
        kind: 'student',
        title: '新学年スタート・学習習慣の相談',
        body: '中2に進級してからの様子を本人と確認。部活動（サッカー部）が本格化し帰宅が遅くなる日が増えたため、学習時間の確保が課題。家庭学習は21時以降になることが多いとのことで、無理のない範囲で平日30分・休日1時間のペースを提案し、本人も納得した様子。数学の証明問題は少しずつ慣れてきている。',
      },
      {
        id: 'tanaka-3',
        date: '2026-06-25',
        kind: 'parent',
        title: '1学期期末に向けた学習計画',
        body: '1学期期末テストに向けての学習計画を保護者と相談。部活の大会が7月上旬にあり、テスト前でも練習が続く見込み。短時間でも毎日続けられる暗記系の学習（英単語・社会の用語）を優先し、数学は授業内演習で補う方針とした。保護者からは「無理をさせすぎず、続けられるペースで」との要望あり。',
        handover:
          '次回への申し送り：期末テストの結果を確認し、部活と両立できる学習ペースを再調整する。',
      },
    ],
    tasks: [
      { id: 'tanaka-t1', label: '英単語プリント毎日1枚', done: false },
      { id: 'tanaka-t2', label: '数学 証明問題の類題演習', done: false },
    ],
    scoreTestNames: ['3学期学年末', '1学期中間', '1学期期末'],
    scores: [
      { subject: '国語', scores: [65, 68, null] },
      { subject: '数学', scores: [52, 55, null] },
      { subject: '英語', scores: [60, 58, null] },
      { subject: '理科', scores: [63, 66, null] },
      { subject: '社会', scores: [70, 71, null] },
    ],
    textbooks: [
      {
        id: 'tanaka-b1',
        name: '中2数学 基礎ワーク',
        subject: '数学',
        progressPct: 55,
        stalled: false,
        lastEntryDate: '2026-07-17',
      },
      {
        id: 'tanaka-b2',
        name: '英単語帳(中学必修)',
        subject: '英語',
        progressPct: 40,
        stalled: true,
        lastEntryDate: '2026-07-02',
      },
      {
        id: 'tanaka-b3',
        name: '理科 定期テスト対策',
        subject: '理科',
        progressPct: 60,
        stalled: false,
        lastEntryDate: '2026-07-14',
      },
    ],
    basic: {
      grade: '中2',
      school: '多摩中学校',
      schedule: '月19:00 / 水19:00',
      courseApplication: '夏期: 検討中',
      textbookCount: 3,
      hasGuardianContact: true,
    },
  },
  {
    id: 'suzuki-ichiro',
    name: '鈴木 一郎',
    grade: '小6',
    school: '南永山小学校',
    schedule: '土10:00',
    interviews: [
      {
        id: 'suzuki-1',
        date: '2026-05-09',
        kind: 'parent',
        title: '入会後はじめての面談',
        body: '入会して1ヶ月ほど経過したタイミングでの初回面談。算数の文章題に苦手意識があるとのことで、まずは基礎的な計算力の定着から始めることを説明。保護者は中学受験を視野に入れているが、まだ検討段階とのこと。無理のないペースで通塾を続け、本人が楽しく学べることを優先したいという希望があった。',
        handover:
          '次回への申し送り：夏前をめどに算数の基礎定着の進み具合を確認し、受験対応コースへの切り替えを検討する。',
      },
    ],
    tasks: [{ id: 'suzuki-t1', label: '計算ドリル1日1ページ', done: false }],
    scoreTestNames: ['3学期学年末', '1学期中間', '1学期期末'],
    scores: [
      { subject: '国語', scores: [null, 70, null] },
      { subject: '算数', scores: [null, 62, null] },
      { subject: '理科', scores: [null, null, null] },
      { subject: '社会', scores: [null, null, null] },
      { subject: '英語', scores: [null, null, null] },
    ],
    textbooks: [
      {
        id: 'suzuki-b1',
        name: '算数 計算ドリル',
        subject: '算数',
        progressPct: 25,
        stalled: false,
        lastEntryDate: '2026-07-19',
      },
      {
        id: 'suzuki-b2',
        name: '国語 読解入門',
        subject: '国語',
        progressPct: 15,
        stalled: false,
        lastEntryDate: '2026-07-12',
      },
    ],
    basic: {
      grade: '小6',
      school: '南永山小学校',
      schedule: '土10:00',
      courseApplication: '夏期: 未案内',
      textbookCount: 2,
      hasGuardianContact: true,
    },
  },
];

// 話題チップ（クリックでメモ末尾に見出しを挿入）
const TOPIC_CHIPS = [
  '成績について',
  '宿題・家庭学習',
  '講習の提案',
  '進路・受験',
  '学校での様子',
  '次回への申し送り',
];

/* ============================================================
 * 汎用ヘルパー
 * ========================================================== */

// 今日を基準とした経過日数
function daysSince(dateStr: string): number {
  const d = new Date(dateStr);
  const today = new Date();
  d.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - d.getTime()) / 86400000);
}

function fmtDate(dateStr: string): string {
  return dateStr;
}

// 面談タイムラインを新しい順に並べる
function sortInterviewsDesc(interviews: MockInterview[]): MockInterview[] {
  return [...interviews].sort((a, b) => (a.date < b.date ? 1 : -1));
}

// 「前回の申し送り」= 最新の面談のうち handover を持つものを探す
function findLatestHandover(interviews: MockInterview[]): { date: string; text: string } | null {
  const withHandover = sortInterviewsDesc(interviews).find((i) => i.handover);
  if (!withHandover?.handover) return null;
  return { date: withHandover.date, text: withHandover.handover };
}

/* ============================================================
 * 小コンポーネント
 * ========================================================== */

// セクション見出し（home-mock の様式を踏襲）
function SectionLabel({
  icon: Icon,
  children,
  right,
}: {
  icon: React.ElementType;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-2 mt-5 flex items-center gap-2 first:mt-0">
      <Icon className="h-4 w-4 text-text-muted" />
      <h3 className="text-sm font-bold text-text-heading">{children}</h3>
      {right && <div className="ml-auto shrink-0">{right}</div>}
    </div>
  );
}

// 成績セルの前回比インジケーター（▲▼、変化なしは横棒）
function ScoreTrend({ prev, curr }: { prev: number | null; curr: number | null }) {
  if (curr == null) return <span className="text-text-faint">—</span>;
  if (prev == null) {
    return <span className="text-sm font-semibold text-text-heading">{curr}</span>;
  }
  const diff = curr - prev;
  if (diff === 0) {
    return (
      <span className="inline-flex items-center gap-0.5">
        <span className="text-sm font-semibold text-text-heading">{curr}</span>
        <Minus className="h-3 w-3 text-text-faint" />
      </span>
    );
  }
  const up = diff > 0;
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="text-sm font-semibold text-text-heading">{curr}</span>
      {up ? (
        <TrendingUp className="h-3 w-3 text-success" />
      ) : (
        <TrendingDown className="h-3 w-3 text-danger" />
      )}
    </span>
  );
}

// 合計点推移の簡易棒グラフ（divの高さで表現。rechartsは使わない）
function SimpleBarChart({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(...values, 1);
  return (
    <div className="flex items-end gap-3 px-1 pt-2">
      {values.map((v, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-xs font-semibold text-text-heading">{v > 0 ? v : '—'}</span>
          <div className="flex h-16 w-full items-end rounded-sm bg-surface-hover">
            <div
              className="w-full rounded-sm bg-ink transition-all"
              style={{ height: v > 0 ? `${Math.max((v / max) * 100, 4)}%` : '0%' }}
            />
          </div>
          <span className="text-[10px] leading-tight text-text-faint text-center">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

// 定義リスト1行（右カラム「基本情報」用）
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border-subtle py-2 last:border-0">
      <span className="shrink-0 text-xs text-text-muted">{label}</span>
      <span className="text-right text-sm text-text-body">{value}</span>
    </div>
  );
}

/* ============================================================
 * ページ本体
 * ========================================================== */

function InterviewWorkspace() {
  // 選択中の生徒（切替でダミーデータも切り替わる）
  const [studentId, setStudentId] = useState(MOCK_STUDENTS[0].id);
  const student = useMemo(
    () => MOCK_STUDENTS.find((s) => s.id === studentId) ?? MOCK_STUDENTS[0],
    [studentId]
  );

  // 生徒が切り替わったタイミングで、面談種別依存の一覧を作り直す（新しい順）
  const timeline = useMemo(() => sortInterviewsDesc(student.interviews), [student]);
  const handover = useMemo(() => findLatestHandover(student.interviews), [student]);
  const lastInterviewDate = timeline[0]?.date;
  const daysSinceLast = lastInterviewDate ? daysSince(lastInterviewDate) : null;

  // 未完了の約束・タスク（生徒切替時に初期化。チェックはローカル state のみ）
  const [taskState, setTaskState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(student.tasks.map((t) => [t.id, t.done]))
  );
  const handleSelectStudent = (id: string) => {
    setStudentId(id);
    const next = MOCK_STUDENTS.find((s) => s.id === id) ?? MOCK_STUDENTS[0];
    setTaskState(Object.fromEntries(next.tasks.map((t) => [t.id, t.done])));
    // メモ・話題チップ・クイック登録タスクも生徒切替でリセットする
    setMemo('');
    setInsertedTopics(new Set());
    setQuickTasks([]);
    setSaveMessage(null);
    setNewTaskLabel('');
  };
  const toggleTask = (id: string) => setTaskState((prev) => ({ ...prev, [id]: !prev[id] }));

  // タイムラインの全文展開トグル
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /* ---- 中央カラム：今回の面談メモ ---- */
  const [interviewDate, setInterviewDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [interviewKind, setInterviewKind] = useState<InterviewKind>('parent');
  const [memo, setMemo] = useState('');
  const [insertedTopics, setInsertedTopics] = useState<Set<string>>(new Set());
  const insertTopic = (topic: string) => {
    if (insertedTopics.has(topic)) return;
    setMemo((prev) => (prev ? `${prev}\n\n## ${topic}\n` : `## ${topic}\n`));
    setInsertedTopics((prev) => new Set(prev).add(topic));
  };

  // 約束・宿題クイック登録
  const [quickTasks, setQuickTasks] = useState<string[]>([]);
  const [newTaskLabel, setNewTaskLabel] = useState('');
  const addQuickTask = () => {
    const label = newTaskLabel.trim();
    if (!label) return;
    setQuickTasks((prev) => [...prev, label]);
    setNewTaskLabel('');
  };
  const removeQuickTask = (idx: number) =>
    setQuickTasks((prev) => prev.filter((_, i) => i !== idx));

  // 保存（モックのため実際の保存はしない。カード内に一時的な成功メッセージを表示するのみ）
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const handleSave = () => {
    setSaveMessage('面談記録を保存しました（モックのため実際には保存されません）');
    window.setTimeout(() => setSaveMessage(null), 4000);
  };

  // 前回面談からの経過日数に応じた Badge トーン（90日超=danger / 60日超=warning / それ以外=secondary系）
  const overdueBadgeClass =
    daysSinceLast == null
      ? 'bg-surface-hover text-text-muted'
      : daysSinceLast > 90
        ? 'bg-danger-subtle text-danger'
        : daysSinceLast > 60
          ? 'bg-warning-subtle text-warning'
          : 'bg-info-subtle text-info';

  return (
    <AdminLayout headerTitle="面談ワークスペース（モック）" fullWidth>
      {/* モック明示バナー */}
      <div className="mb-4 flex items-center gap-2 rounded-lg border border-warning bg-warning-subtle px-4 py-2 text-sm text-warning">
        <Flag className="h-4 w-4 shrink-0" />
        これは検討用モックです。すべてダミーデータです。
      </div>

      {/* ===== ヘッダー帯 ===== */}
      <Card className="mb-5">
        <CardContent className="py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            {/* 生徒切替 + 選択中生徒の帯 */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="w-full sm:w-64">
                <Select
                  aria-label="生徒切替"
                  value={studentId}
                  onChange={(e) => handleSelectStudent(e.target.value)}
                  options={MOCK_STUDENTS.map((s) => ({
                    value: s.id,
                    label: `${s.name}（${s.grade}・${s.school}）`,
                  }))}
                />
              </div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-xl font-bold text-text-heading">{student.name}</span>
                <span className="text-sm text-text-muted">
                  {student.grade}・{student.school}
                </span>
                <span className="text-sm text-text-muted">{student.schedule}</span>
              </div>
            </div>

            {/* 前回面談日・経過日数バッジ + 実ページへのリンク */}
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${overdueBadgeClass}`}
              >
                <History className="h-3.5 w-3.5" />
                {lastInterviewDate ? (
                  <>
                    前回面談: {fmtDate(lastInterviewDate)}（{daysSinceLast}日前）
                  </>
                ) : (
                  '面談記録なし'
                )}
              </span>
              <Link href={`/students/${student.id}/progress`} target="_blank">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <ExternalLink className="h-3.5 w-3.5" />
                  進行表を開く
                </Button>
              </Link>
              <Link href={`/students/${student.id}/scores`} target="_blank">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <ExternalLink className="h-3.5 w-3.5" />
                  成績を開く
                </Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ===== 3カラム本体 ===== */}
      <div className="grid gap-5 lg:grid-cols-[320px_1fr_360px] lg:items-start">
        {/* ── 左カラム：過去の面談記録 ── */}
        <div className="flex flex-col gap-5">
          {/* 前回の申し送り（ピン留め） */}
          <Card className="border-l-4 border-l-warning">
            <CardHeader className="flex flex-row items-center gap-2 border-b-0 pb-0">
              <Pin className="h-4 w-4 text-warning" />
              <CardTitle className="text-sm">前回の申し送り</CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              {handover ? (
                <>
                  <p className="mb-1 text-xs text-text-faint">{fmtDate(handover.date)}</p>
                  <p className="whitespace-pre-wrap text-sm text-text-body">{handover.text}</p>
                </>
              ) : (
                <p className="text-sm text-text-muted">申し送りの記録はありません</p>
              )}
            </CardContent>
          </Card>

          {/* 未完了の約束・タスク */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-2 border-b-0 pb-0">
              <CircleCheck className="h-4 w-4 text-text-muted" />
              <CardTitle className="text-sm">未完了の約束・タスク</CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              {student.tasks.length === 0 ? (
                <p className="text-sm text-text-muted">登録されているタスクはありません</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {student.tasks.map((t) => {
                    const done = taskState[t.id];
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => toggleTask(t.id)}
                          className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-surface-hover"
                        >
                          {done ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                          ) : (
                            <Circle className="h-4 w-4 shrink-0 text-text-faint" />
                          )}
                          <span
                            className={`text-sm ${done ? 'text-text-faint line-through' : 'text-text-body'}`}
                          >
                            {t.label}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* 面談タイムライン（新しい順） */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-2 border-b-0 pb-0">
              <History className="h-4 w-4 text-text-muted" />
              <CardTitle className="text-sm">面談タイムライン</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[600px] overflow-y-auto pt-2">
              {timeline.length === 0 ? (
                <p className="text-sm text-text-muted">面談記録はまだありません</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {timeline.map((iv) => {
                    const expanded = expandedIds.has(iv.id);
                    const Icon = INTERVIEW_KIND_ICON[iv.kind];
                    return (
                      <button
                        key={iv.id}
                        type="button"
                        onClick={() => toggleExpanded(iv.id)}
                        className="rounded-lg border border-border-subtle p-3 text-left transition-colors hover:bg-surface-hover"
                      >
                        <div className="mb-1.5 flex items-center gap-2">
                          <span className="text-xs text-text-faint">{fmtDate(iv.date)}</span>
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${INTERVIEW_KIND_BADGE[iv.kind]}`}
                          >
                            <Icon className="h-3 w-3" />
                            {INTERVIEW_KIND_LABELS[iv.kind]}
                          </span>
                        </div>
                        <p className="mb-1 text-sm font-semibold text-text-heading">{iv.title}</p>
                        <p
                          className={`text-xs leading-relaxed text-text-body ${expanded ? '' : 'line-clamp-3'}`}
                        >
                          {iv.body}
                        </p>
                        <span className="mt-1 inline-flex items-center gap-0.5 text-xs text-text-muted">
                          {expanded ? (
                            <>
                              閉じる <ChevronUp className="h-3 w-3" />
                            </>
                          ) : (
                            <>
                              全文を見る <ChevronDown className="h-3 w-3" />
                            </>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── 中央カラム：今回の面談メモ（メイン作業領域） ── */}
        <div>
          <Card>
            <CardHeader className="flex flex-col gap-3 border-b border-border-subtle pb-4 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>今回の面談</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="date"
                  value={interviewDate}
                  onChange={(e) => setInterviewDate(e.target.value)}
                  className="w-40"
                />
                <Select
                  aria-label="面談種別"
                  value={interviewKind}
                  onChange={(e) => setInterviewKind(e.target.value as InterviewKind)}
                  className="w-36"
                  options={[
                    { value: 'parent', label: '保護者面談' },
                    { value: 'student', label: '生徒面談' },
                    { value: 'phone', label: '電話' },
                  ]}
                />
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {/* 話題チップ */}
              <div className="mb-3">
                <p className="mb-1.5 text-xs text-text-muted">クリックでメモに見出しを挿入します</p>
                <div className="flex flex-wrap gap-1.5">
                  {TOPIC_CHIPS.map((topic) => {
                    const inserted = insertedTopics.has(topic);
                    return (
                      <button
                        key={topic}
                        type="button"
                        disabled={inserted}
                        onClick={() => insertTopic(topic)}
                        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          inserted
                            ? 'cursor-not-allowed border-border-subtle bg-surface text-text-faint'
                            : 'border-border bg-surface text-text-body hover:border-primary hover:text-primary'
                        }`}
                      >
                        {inserted ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <Plus className="h-3 w-3" />
                        )}
                        {topic}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* メモ本体 */}
              <Textarea
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="面談の内容を記録します。話題チップを押すと見出しが挿入されます。"
                className="min-h-[320px]"
              />

              {/* 約束・宿題クイック登録 */}
              <div className="mt-4 rounded-lg border border-border-subtle p-3">
                <div className="mb-2 flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-text-muted" />
                  <span className="text-sm font-semibold text-text-heading">
                    約束・宿題クイック登録
                  </span>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newTaskLabel}
                    onChange={(e) => setNewTaskLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addQuickTask();
                      }
                    }}
                    placeholder="例：英語ワークP10まで"
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addQuickTask}
                    className="gap-1 shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    追加
                  </Button>
                </div>
                {quickTasks.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {quickTasks.map((label, idx) => (
                      <li
                        key={idx}
                        className="flex items-center gap-2 rounded-md bg-surface-hover px-2 py-1.5"
                      >
                        <Circle className="h-3.5 w-3.5 shrink-0 text-text-faint" />
                        <span className="flex-1 text-sm text-text-body">{label}</span>
                        <button
                          type="button"
                          onClick={() => removeQuickTask(idx)}
                          className="shrink-0 text-text-faint transition-colors hover:text-danger"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-xs text-text-faint">
                  保存時にタスクとして登録されます（このモックでは実際には登録されません）
                </p>
              </div>

              {/* フッター */}
              <div className="mt-4 flex flex-col gap-2 border-t border-border-subtle pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-2">
                  <Button onClick={handleSave} className="gap-1.5">
                    <CheckCircle2 className="h-4 w-4" />
                    面談記録を保存
                  </Button>
                  <Button
                    variant="outline"
                    disabled
                    title="今後 Notta の文字起こしを取り込めるようにする予定です（モックでは未実装）"
                    className="gap-1.5"
                  >
                    <Mic className="h-4 w-4" />
                    Nottaから取込
                  </Button>
                </div>
                {saveMessage && (
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
                    <CheckCircle2 className="h-4 w-4" />
                    {saveMessage}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── 右カラム：データ参照 ── */}
        <div className="flex flex-col gap-5">
          {/* 成績サマリ */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-2 border-b-0 pb-0">
              <TrendingUp className="h-4 w-4 text-text-muted" />
              <CardTitle className="text-sm">成績サマリ</CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-subtle text-left text-text-muted">
                      <th className="pb-1.5 pr-2 font-medium">教科</th>
                      {student.scoreTestNames.map((name) => (
                        <th key={name} className="pb-1.5 px-1 text-right font-medium">
                          <span className="block text-[10px] leading-tight">{name}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {student.scores.map((row) => (
                      <tr key={row.subject} className="border-b border-border-subtle last:border-0">
                        <td className="py-1.5 pr-2 text-text-body">{row.subject}</td>
                        {row.scores.map((s, i) => (
                          <td key={i} className="py-1.5 px-1 text-right">
                            <ScoreTrend prev={row.scores[i - 1] ?? null} curr={s} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 合計点の推移（簡易棒グラフ） */}
              <p className="mb-1 mt-3 text-xs text-text-muted">合計点の推移</p>
              <SimpleBarChart
                labels={student.scoreTestNames}
                values={student.scoreTestNames.map((_, i) =>
                  student.scores.reduce((sum, row) => sum + (row.scores[i] ?? 0), 0)
                )}
              />
            </CardContent>
          </Card>

          {/* 進行表サマリ */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-2 border-b-0 pb-0">
              <BookOpen className="h-4 w-4 text-text-muted" />
              <CardTitle className="text-sm">進行表サマリ</CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              {student.textbooks.length === 0 ? (
                <p className="text-sm text-text-muted">使用中のテキストはありません</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {student.textbooks.map((tb) => (
                    <div key={tb.id}>
                      <div className="mb-1 flex items-center gap-1.5">
                        <span className="flex-1 truncate text-sm font-medium text-text-body">
                          {tb.name}
                        </span>
                        <Badge variant="secondary" className="shrink-0">
                          {tb.subject}
                        </Badge>
                        {tb.stalled && (
                          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-danger-subtle px-1.5 py-0.5 text-[10px] font-medium text-danger">
                            <AlertCircle className="h-3 w-3" />
                            停滞
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-hover">
                          <div
                            className="h-full rounded-full bg-ink"
                            style={{ width: `${tb.progressPct}%` }}
                          />
                        </div>
                        <span className="w-9 shrink-0 text-right text-xs text-text-muted">
                          {tb.progressPct}%
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10px] text-text-faint">
                        最終記入: {fmtDate(tb.lastEntryDate)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 基本情報 */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-2 border-b-0 pb-0">
              <ClipboardList className="h-4 w-4 text-text-muted" />
              <CardTitle className="text-sm">基本情報</CardTitle>
            </CardHeader>
            <CardContent className="pt-1">
              <InfoRow label="学年" value={student.basic.grade} />
              <InfoRow label="学校" value={student.basic.school} />
              <InfoRow label="通塾" value={student.basic.schedule} />
              <InfoRow label="講習申込" value={student.basic.courseApplication} />
              <InfoRow label="所持教材数" value={`${student.basic.textbookCount}冊`} />
              <InfoRow
                label="保護者連絡先"
                value={
                  student.basic.hasGuardianContact ? (
                    <span className="text-success">登録あり</span>
                  ) : (
                    <span className="text-text-faint">未登録</span>
                  )
                }
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}

export default function InterviewMockPage() {
  const { profile, isLoading } = useAuth();

  if (isLoading) {
    return (
      <AdminLayout>
        <Loading />
      </AdminLayout>
    );
  }

  if (!isManagerOrAbove(profile?.role)) {
    return (
      <AdminLayout>
        <AccessDenied message="このページは教室長以上のみアクセス可能です" />
      </AdminLayout>
    );
  }

  return <InterviewWorkspace />;
}
