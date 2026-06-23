'use client';

/**
 * 生徒進捗ページ UI 提案モック v2
 *
 * 変更点 (2026-04-18):
 * - カード=案D（試験残日 + 行動目標達成数 + 直近履歴）
 * - 試験目標モーダルに行動目標セクション同居（回数カウンター/コピペ/過去折りたたみ）
 * - 試験範囲はスライダー + 項目ピル
 * - ロール切替（講師 / 教室長）で PDF・保護者モード・管理操作を出し分け
 * - カードのドラッグ並び替え
 * - 保護者モード用の別カードデザイン
 *
 * URL: /students/progress-mockup
 */

import { useEffect, useMemo, useRef, useState } from 'react';

// ─────────────────────────────────────────────
// ダミーデータ
// ─────────────────────────────────────────────
type ActionGoal = {
  id: string;
  title: string;
  achieved: boolean;
  /** 回数カウンター（null=カウンターなし） */
  counter?: { current: number; total: number };
};

/**
 * 試験名マスタ（共有）。
 * 「1学期中間」「1学期期末」などはシステム横断で再利用されるため、独立したマスタとして扱う。
 * 試験目標・試験範囲はそれぞれ独立に examNameId を参照する（互いに依存しない）。
 */
type ExamName = { id: string; name: string };

const EXAM_NAMES: ExamName[] = [
  { id: 'en-c1', name: '1学期中間試験' },
  { id: 'en-k1', name: '1学期期末試験' },
  { id: 'en-c2', name: '2学期中間試験' },
  { id: 'en-k2', name: '2学期期末試験' },
  { id: 'en-c3', name: '3学期期末試験' },
  { id: 'en-mogi', name: '模試' },
];

const examNameOf = (id: string) => EXAM_NAMES.find((e) => e.id === id)?.name ?? '';

/**
 * 意図タグのマスタ。教室長はグループ先頭行でこれを1つ選ぶだけ。
 * 面談モードの根拠文はここから自動生成される（自由記述は不要）。
 */
const GROUP_INTENT_TAGS = [
  '苦手補強',
  '既習の定着',
  '未習の先取り',
  '学校進度に合わせる',
  '直前演習',
  '応用発展',
] as const;
type GroupIntentTag = (typeof GROUP_INTENT_TAGS)[number];

/** タグから面談用の根拠文を自動生成（詳細なニュアンスが必要な場合のみ補足テキスト入力可） */
const TAG_RATIONALE: Record<GroupIntentTag, string> = {
  苦手補強: '過去のテストで失点が多い単元。重点的に演習を重ねて定着を図ります。',
  既習の定着: '学校で学習済みの範囲。理解の確認と典型問題の再演習で得点源に。',
  未習の先取り: '学校の進度より前倒しで学習。基礎定着から段階的に進めます。',
  学校進度に合わせる: '学校の授業と並行して進めることで理解を定着させます。',
  直前演習: '試験直前の総仕上げ。類題演習で取りこぼしを防ぎます。',
  応用発展: '基礎が固まった単元の発展問題。得点力の底上げを狙います。',
};

/** タグごとのアクセントカラー（視覚的に見分けやすく） */
const TAG_COLOR: Record<GroupIntentTag, string> = {
  苦手補強: 'bg-red-50 text-red-800 border-red-200',
  既習の定着: 'bg-blue-50 text-blue-800 border-blue-200',
  未習の先取り: 'bg-purple-50 text-purple-800 border-purple-200',
  学校進度に合わせる: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  直前演習: 'bg-amber-50 text-amber-800 border-amber-200',
  応用発展: 'bg-indigo-50 text-indigo-800 border-indigo-200',
};

/** タグが無い場合のみ、データから自動推論（極力こちらにフォールバックしない設計） */
function autoInferRationale(item: Progress, textbook: Textbook): string {
  const inExamRange = textbook.examRanges.some(
    (r) => item.no >= r.rangeStart && item.no <= r.rangeEnd
  );
  const hasHistory = !!item.lesson1Date;
  if (inExamRange && !hasHistory) return '試験範囲内の未学習項目です。';
  if (inExamRange && hasHistory) return '試験範囲の既習項目です。';
  if (!inExamRange) return '試験範囲外ですが、学校進度に合わせて配分します。';
  return '—';
}

function rationale(item: Progress, textbook: Textbook): string {
  if (item.intentTag) return TAG_RATIONALE[item.intentTag];
  return autoInferRationale(item, textbook);
}

/** 範囲を単元名ベースで「L2 過去形 〜 L5-2 応用」のように表記 */
function rangeLabel(textbook: Textbook, start: number, end: number): string {
  const s = textbook.curriculumItems.find((c) => c.no === start)?.title ?? `項目${start}`;
  const e = textbook.curriculumItems.find((c) => c.no === end)?.title ?? `項目${end}`;
  if (start === end) return s;
  return `${s} 〜 ${e}`;
}

/**
 * 試験目標: 試験名・日付・目標点・行動目標。**範囲は持たない**。
 */
type ExamGoal = {
  id: string;
  examNameId: string;
  date: string;
  daysLeft: number;
  targetScore: number;
  actionGoals: ActionGoal[];
  archived?: boolean; // 期間経過後は折りたたみ
  actualScore?: number; // 将来のテスト結果連動
};

/**
 * 試験範囲: 試験名に対して、このテキストのどこからどこまでが範囲か。
 * 試験目標の有無に関わらず単独で存在できる（目標未設定でも範囲は設定可）。
 */
type ExamRange = {
  id: string;
  examNameId: string;
  rangeStart: number;
  rangeEnd: number;
};

type Progress = {
  id: string;
  no: number;
  title: string;
  group?: string;
  /** 提案コマ数 */
  proposal?: number;
  /** 申込コマ数 */
  application?: number;
  /** 意図タグ（グループ先頭行のみに設定。面談用の根拠文を自動生成する元データ） */
  intentTag?: GroupIntentTag;
  lesson1Date?: string;
  lesson1Range?: string;
  lesson2Date?: string;
  lesson2Range?: string;
  lesson3Date?: string;
  note?: string;
};

type Textbook = {
  id: string;
  title: string;
  subject: string;
  total: number;
  done: number;
  lastDate?: string;
  stalled?: boolean;
  season?: 'spring' | 'summer' | 'winter' | null;
  isDraft?: boolean;
  examGoals: ExamGoal[]; // 試験目標（行動目標）
  examRanges: ExamRange[]; // 試験範囲（目標と独立）
  items: Progress[];
  curriculumItems: { no: number; title: string }[]; // スライダー用
};

const CURRICULUM_EN: { no: number; title: string }[] = [
  { no: 1, title: 'L1 be動詞の復習' },
  { no: 2, title: 'L1 演習' },
  { no: 3, title: 'L2 過去形' },
  { no: 4, title: 'L2 演習' },
  { no: 5, title: 'L3 未来形' },
  { no: 6, title: 'L3 演習' },
  { no: 7, title: 'L4 助動詞' },
  { no: 8, title: 'L4 演習' },
  { no: 9, title: 'L5 不定詞' },
  { no: 10, title: 'L5-1 演習' },
  { no: 11, title: 'L5-2 応用' },
  { no: 12, title: 'L6 動名詞' },
  { no: 13, title: 'L6-1 演習' },
  { no: 14, title: 'L6-2 まとめ' },
  { no: 15, title: 'L7 比較' },
  { no: 16, title: 'L7 演習' },
];

const MOCK_TEXTBOOKS: Textbook[] = [
  {
    id: 'tb1',
    title: '中2英語 フォレスタ ステップ',
    subject: '英語',
    total: 40,
    done: 26,
    lastDate: '2026/04/15',
    season: 'spring',
    examGoals: [
      {
        id: 'eg1',
        examNameId: 'en-c1', // 1学期中間試験
        date: '2026/04/21',
        daysLeft: 3,
        targetScore: 80,
        actionGoals: [
          { id: 'a1', title: '毎朝英単語50個', achieved: true, counter: { current: 7, total: 7 } },
          { id: 'a2', title: '文法ワーク周回', achieved: false, counter: { current: 2, total: 3 } },
          { id: 'a3', title: '過去問を解く', achieved: false, counter: { current: 0, total: 3 } },
        ],
      },
      {
        id: 'eg-past1',
        examNameId: 'en-k2', // 3学期期末（過去）
        date: '2026/02/28',
        daysLeft: -49,
        targetScore: 75,
        actualScore: 82,
        archived: true,
        actionGoals: [
          { id: 'pa1', title: '単語練習', achieved: true, counter: { current: 5, total: 5 } },
          { id: 'pa2', title: 'ワーク2周', achieved: true, counter: { current: 2, total: 2 } },
        ],
      },
    ],
    // 試験範囲は目標と独立。1学期中間の範囲だけ設定済、期末は未定
    examRanges: [{ id: 'r1', examNameId: 'en-c1', rangeStart: 3, rangeEnd: 10 }],
    // 業務ルール: 提案/申込・意図タグはグループ先頭行にのみ値を持つ
    items: [
      {
        id: 'p1',
        no: 3,
        title: 'L2 過去形',
        group: 'L2',
        proposal: 3,
        application: 3,
        intentTag: '既習の定着',
        lesson1Date: '2026/04/01',
        lesson2Date: '2026/04/08',
      },
      { id: 'p2', no: 4, title: 'L2 演習', group: 'L2', lesson1Date: '2026/04/15' },
      {
        id: 'p3',
        no: 5,
        title: 'L3 未来形',
        group: 'L3',
        proposal: 2,
        application: 2,
        intentTag: '既習の定着',
      },
      { id: 'p4', no: 6, title: 'L3 演習', group: 'L3' },
      {
        id: 'p5',
        no: 7,
        title: 'L4 助動詞',
        group: 'L4',
        proposal: 5,
        application: 5,
        intentTag: '苦手補強',
      },
      { id: 'p6', no: 8, title: 'L4 演習', group: 'L4' },
      {
        id: 'p7',
        no: 11,
        title: 'L5-2 応用',
        group: 'L5',
        proposal: 2,
        application: 2,
        intentTag: '直前演習',
      },
      {
        id: 'p8',
        no: 12,
        title: 'L6 動名詞',
        group: 'L6',
        proposal: 2,
        application: 2,
        intentTag: '未習の先取り',
      },
    ],
    curriculumItems: CURRICULUM_EN,
  },
  {
    id: 'tb2',
    title: '中2数学 シリウス',
    subject: '数学',
    total: 50,
    done: 38,
    lastDate: '2026/04/14',
    season: 'spring',
    examGoals: [
      {
        id: 'eg2',
        examNameId: 'en-c1',
        date: '2026/04/21',
        daysLeft: 3,
        targetScore: 85,
        actionGoals: [
          { id: 'b1', title: '計算練習', achieved: false, counter: { current: 5, total: 10 } },
        ],
      },
    ],
    examRanges: [{ id: 'r2', examNameId: 'en-c1', rangeStart: 1, rangeEnd: 6 }],
    items: [],
    curriculumItems: CURRICULUM_EN,
  },
  {
    id: 'tb3',
    title: '中2国語 新中問',
    subject: '国語',
    total: 30,
    done: 8,
    lastDate: '2026/03/28',
    stalled: true,
    examGoals: [],
    examRanges: [],
    items: [],
    curriculumItems: CURRICULUM_EN,
  },
  {
    id: 'tb4',
    title: '中2理科 ウィニング',
    subject: '理科',
    total: 45,
    done: 22,
    lastDate: '2026/04/12',
    isDraft: true,
    examGoals: [],
    examRanges: [],
    items: [],
    curriculumItems: CURRICULUM_EN,
  },
];

// ─────────────────────────────────────────────
// メインページ
// ─────────────────────────────────────────────
type View = 'cards' | 'table';
// admin: 講師・教室長の日常編集ビュー / meeting: 教室長が保護者面談で見せるプレゼン用ビュー
type ViewMode = 'admin' | 'meeting';
type Role = 'teacher' | 'manager';

export default function ProgressMockupPage() {
  const [view, setView] = useState<View>('cards');
  const [viewMode, setViewMode] = useState<ViewMode>('admin');
  const [role, setRole] = useState<Role>('manager');
  const [goalModalOpen, setGoalModalOpen] = useState<string | null>(null); // textbook id
  const [rangeModalOpen, setRangeModalOpen] = useState<string | null>(null); // textbook id
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const [selectedTextbook, setSelectedTextbook] = useState<string>('tb1');
  const [textbooks, setTextbooks] = useState<Textbook[]>(MOCK_TEXTBOOKS);
  /** カードの「＋記録」からテーブル遷移時に記録モードONで開くためのフラグ */
  const [startRecording, setStartRecording] = useState(false);

  const tb = useMemo(
    () => textbooks.find((t) => t.id === selectedTextbook) ?? textbooks[0],
    [selectedTextbook, textbooks]
  );

  const showToast = (msg: string) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, msg }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setGoalModalOpen(null);
        setRangeModalOpen(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ロール: 講師は面談用モードを使えない
  const isTeacher = role === 'teacher';
  const effectiveViewMode = isTeacher ? 'admin' : viewMode;

  const openTableWithRecording = (id: string) => {
    setSelectedTextbook(id);
    setStartRecording(true);
    setView('table');
  };

  return (
    <div className="min-h-screen bg-[#f3f4f6]">
      {/* ヘッダ */}
      <header className="bg-white border-b border-[#e5e7eb] sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-xs text-[#6b7280]">生徒詳細 › 進捗管理</div>
            <h1 className="text-lg font-bold text-[#1f2937] truncate">
              山田 太郎 <span className="text-sm font-normal text-[#6b7280] ml-2">中学2年生</span>
            </h1>
          </div>

          <RoleSwitcher role={role} onChange={setRole} />
          {!isTeacher && <ModeSwitcher mode={viewMode} onChange={setViewMode} />}
          <ViewSwitcher view={view} onChange={setView} />
        </div>

        <div className="max-w-7xl mx-auto px-6 pb-2">
          <div className="text-xs text-[#6b7280] bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5">
            UI提案モック（ダミーデータ）。現在「{role === 'teacher' ? '講師' : '教室長'}」ビュー・「
            {viewMode === 'admin' ? '管理' : '面談用'}」モード。
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {view === 'cards' && (
          <CardsView
            textbooks={textbooks}
            setTextbooks={setTextbooks}
            role={role}
            viewMode={effectiveViewMode}
            onSelectTextbook={(id) => {
              setSelectedTextbook(id);
              setStartRecording(false);
              setView('table');
            }}
            onStartRecording={openTableWithRecording}
            onOpenGoalModal={(id) => setGoalModalOpen(id)}
            showToast={showToast}
          />
        )}
        {view === 'table' && (
          <TableView
            key={tb.id + (startRecording ? '-rec' : '')}
            textbook={tb}
            role={role}
            viewMode={effectiveViewMode}
            recordingInitial={startRecording}
            onBack={() => {
              setStartRecording(false);
              setView('cards');
            }}
            onOpenGoalModal={() => setGoalModalOpen(tb.id)}
            onOpenRangeModal={() => setRangeModalOpen(tb.id)}
            showToast={showToast}
          />
        )}
      </main>

      {goalModalOpen && (
        <ExamGoalModal
          textbook={textbooks.find((t) => t.id === goalModalOpen)!}
          onClose={() => setGoalModalOpen(null)}
          onSave={(msg) => {
            setGoalModalOpen(null);
            showToast(msg);
          }}
        />
      )}
      {rangeModalOpen && (
        <ExamRangeModal
          textbook={textbooks.find((t) => t.id === rangeModalOpen)!}
          onClose={() => setRangeModalOpen(null)}
          onSave={(msg) => {
            setRangeModalOpen(null);
            showToast(msg);
          }}
        />
      )}

      {/* Undoトースト */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto bg-[#1f2937] text-white text-sm px-4 py-3 rounded-lg shadow-xl flex items-center gap-3 min-w-[320px] animate-[slideUp_.2s_ease-out]"
          >
            <span className="text-green-400">✓</span>
            <span className="flex-1">{t.msg}</span>
            <button
              className="text-[#93c5fd] hover:text-white font-medium text-xs"
              onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))}
            >
              ↩ 元に戻す
            </button>
          </div>
        ))}
      </div>

      <style jsx global>{`
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(16px) translateX(-50%);
          }
          to {
            opacity: 1;
            transform: translateY(0) translateX(-50%);
          }
        }
        @keyframes slideRight {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────
// スイッチャー類
// ─────────────────────────────────────────────
function RoleSwitcher({ role, onChange }: { role: Role; onChange: (r: Role) => void }) {
  return (
    <div
      className="inline-flex rounded-lg border border-dashed border-[#d1d5db] bg-[#fef3c7] overflow-hidden text-xs"
      title="モック用: 実装時はログインロールで自動判定"
    >
      <span className="px-2 py-1.5 text-amber-800 font-medium">表示ロール</span>
      {(['teacher', 'manager'] as const).map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className={`px-2.5 py-1.5 transition-colors ${role === r ? 'bg-amber-600 text-white' : 'text-amber-800 hover:bg-amber-100'}`}
        >
          {r === 'teacher' ? '講師' : '教室長'}
        </button>
      ))}
    </div>
  );
}

function ModeSwitcher({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-[#e5e7eb] bg-white overflow-hidden text-sm">
      {(['admin', 'meeting'] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`px-2.5 py-1.5 transition-colors ${mode === m ? 'bg-[#1e3a5f] text-white' : 'text-[#4b5563] hover:bg-[#f3f4f6]'}`}
        >
          {m === 'admin' ? '管理' : '面談用'}
        </button>
      ))}
    </div>
  );
}

function ViewSwitcher({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const items: { v: View; label: string }[] = [
    { v: 'cards', label: 'カード' },
    { v: 'table', label: 'テーブル' },
  ];
  return (
    <div className="inline-flex rounded-lg border border-[#e5e7eb] bg-white overflow-hidden text-sm">
      {items.map((it) => (
        <button
          key={it.v}
          onClick={() => onChange(it.v)}
          className={`px-3 py-1.5 transition-colors ${view === it.v ? 'bg-[#1e3a5f] text-white' : 'text-[#4b5563] hover:bg-[#f3f4f6]'}`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// カードビュー
// ─────────────────────────────────────────────
function CardsView({
  textbooks,
  setTextbooks,
  role,
  viewMode,
  onSelectTextbook,
  onStartRecording,
  onOpenGoalModal,
  showToast,
}: {
  textbooks: Textbook[];
  setTextbooks: (t: Textbook[]) => void;
  role: Role;
  viewMode: ViewMode;
  onSelectTextbook: (id: string) => void;
  /** カード上「＋記録」ボタン → テーブルに遷移＆記録モードON */
  onStartRecording: (id: string) => void;
  onOpenGoalModal: (id: string) => void;
  showToast: (msg: string) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const isMeeting = viewMode === 'meeting';

  const onDragStart = (id: string) => setDragId(id);
  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const src = textbooks.findIndex((t) => t.id === dragId);
    const dst = textbooks.findIndex((t) => t.id === targetId);
    const next = [...textbooks];
    const [moved] = next.splice(src, 1);
    next.splice(dst, 0, moved);
    setTextbooks(next);
    setDragId(null);
    showToast('教科書の並び順を変更しました');
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-[#1f2937]">
            {isMeeting ? '面談用表示（保護者提示）' : '教科書一覧'}
          </h2>
          <p className="text-xs text-[#6b7280] mt-0.5">
            {isMeeting
              ? '保護者面談で画面共有 / PDF配布するためのプレゼンビュー'
              : role === 'teacher'
                ? 'クリックで詳細テーブルへ'
                : 'ドラッグ&ドロップで並び替え可 / クリックで詳細テーブルへ'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isMeeting && (
            <>
              <button
                onClick={() => showToast('PDF出力（面談用・全教科書）')}
                className="px-3 py-1.5 bg-white border border-[#e5e7eb] rounded-lg text-sm hover:bg-[#f3f4f6]"
              >
                PDF出力
              </button>
              <button
                onClick={() => showToast('講習ごとPDF出力')}
                className="px-3 py-1.5 bg-white border border-[#e5e7eb] rounded-lg text-sm hover:bg-[#f3f4f6]"
              >
                講習ごと
              </button>
            </>
          )}
          {!isMeeting && <AddMenu role={role} showToast={showToast} />}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {textbooks.map((tb) => {
          if (isMeeting)
            return <MeetingCard key={tb.id} textbook={tb} onOpen={() => onSelectTextbook(tb.id)} />;
          // 講師はドラッグ並び替え不可
          const canDrag = role !== 'teacher';
          return (
            <div
              key={tb.id}
              draggable={canDrag}
              onDragStart={canDrag ? () => onDragStart(tb.id) : undefined}
              onDragOver={canDrag ? onDragOver : undefined}
              onDrop={canDrag ? () => onDrop(tb.id) : undefined}
              className={dragId === tb.id ? 'opacity-40' : ''}
            >
              <AdminCard
                textbook={tb}
                role={role}
                onOpen={() => onSelectTextbook(tb.id)}
                onStartRecording={() => onStartRecording(tb.id)}
                onOpenGoalModal={() => onOpenGoalModal(tb.id)}
                showToast={showToast}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-8 p-4 bg-white border border-dashed border-[#e5e7eb] rounded-lg text-sm text-[#4b5563]">
        <p className="font-medium text-[#1f2937] mb-2">このビューのポイント</p>
        <ul className="list-disc list-inside space-y-0.5">
          <li>試験までの残日数と行動目標達成数を前面に（進捗%は意図的に非表示）</li>
          <li>停滞中の教科書はカード枠を警告色に</li>
          {!isMeeting && role !== 'teacher' && <li>ドラッグ&ドロップで並び替え（教室長のみ）</li>}
          {!isMeeting && <li>カード上の「試験目標」ブロックから目標と行動目標を編集</li>}
          {isMeeting && (
            <li>
              面談用モードは保護者に見せる前提で情報量を絞ったプレゼン表示。PDFでそのまま配布可。
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

function AddMenu({ role, showToast }: { role: Role; showToast: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  // 講師: 教科書追加のみ / 教室長: 教科書追加 + コース一括適用
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="px-3 py-1.5 rounded-lg bg-white border border-[#e5e7eb] text-sm hover:bg-[#f3f4f6] flex items-center gap-1"
      >
        ＋ 追加 <span className="text-xs text-[#9ca3af]">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-56 bg-white border border-[#e5e7eb] rounded-lg shadow-lg z-20 overflow-hidden">
            <button
              onClick={() => {
                setOpen(false);
                showToast('教科書追加モーダルを開く');
              }}
              className="w-full px-3 py-2 text-left text-sm hover:bg-[#f3f4f6]"
            >
              教科書を追加
            </button>
            {role !== 'teacher' && (
              <button
                onClick={() => {
                  setOpen(false);
                  showToast('コース一括適用モーダルを開く');
                }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-[#f3f4f6]"
              >
                コースから一括適用
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 管理用カード（案D）
// ─────────────────────────────────────────────
function AdminCard({
  textbook,
  role,
  onOpen,
  onStartRecording,
  onOpenGoalModal,
  showToast,
}: {
  textbook: Textbook;
  role: Role;
  onOpen: () => void;
  onStartRecording: () => void;
  onOpenGoalModal: () => void;
  showToast: (m: string) => void;
}) {
  const activeGoal = textbook.examGoals.find((g) => !g.archived);
  const seasonColor =
    textbook.season === 'spring'
      ? 'border-l-[#f472b6]'
      : textbook.season === 'summer'
        ? 'border-l-[#fbbf24]'
        : textbook.season === 'winter'
          ? 'border-l-[#60a5fa]'
          : 'border-l-transparent';
  const last3 = textbook.items.filter((i) => i.lesson1Range).slice(-3);

  const achievedCount = activeGoal?.actionGoals.filter((a) => a.achieved).length ?? 0;
  const totalCount = activeGoal?.actionGoals.length ?? 0;

  return (
    <div
      className={`bg-white rounded-xl border border-l-4 ${seasonColor} ${textbook.stalled ? 'border-amber-300' : 'border-[#e5e7eb]'} p-5 shadow-sm hover:shadow-md transition-all ${role !== 'teacher' ? 'cursor-move' : ''}`}
    >
      {/* ヘッダ */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-xs text-[#6b7280]">{textbook.subject}</span>
            {textbook.isDraft && (
              <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
                下書き
              </span>
            )}
            {textbook.season && (
              <span className="text-[10px] px-1.5 py-0.5 bg-[#fef3c7] text-[#92400e] rounded">
                {textbook.season === 'spring'
                  ? '春期'
                  : textbook.season === 'summer'
                    ? '夏期'
                    : '冬期'}
              </span>
            )}
          </div>
          <h3 className="font-semibold text-[#1f2937] truncate">{textbook.title}</h3>
        </div>
        {/* ⋯メニュー: 講師はアーカイブのみ許可 / 教室長は全項目 */}
        <CardMoreMenu role={role} showToast={showToast} />
      </div>

      {/* 試験目標（active） */}
      {activeGoal ? (
        <div className="mb-3 p-4 bg-gradient-to-br from-[#eff6ff] to-[#dbeafe]/50 border border-[#1e40af]/25 rounded-xl shadow-sm">
          {/* ヘッダ */}
          <div className="flex items-center justify-between mb-2.5">
            <div>
              <div className="text-[10px] font-bold text-[#1e40af] uppercase tracking-widest mb-0.5">
                試験目標
              </div>
              <div className="text-sm font-bold text-[#1e3a5f]">
                {examNameOf(activeGoal.examNameId)}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenGoalModal();
              }}
              className="text-xs text-[#1e40af] hover:bg-white px-2 py-1 rounded transition-colors"
            >
              編集
            </button>
          </div>
          {/* 主要KPI */}
          <div className="grid grid-cols-3 gap-2 mb-2.5">
            <div className="bg-white rounded-lg px-2 py-1.5 text-center">
              <div className="text-[9px] text-[#6b7280] uppercase tracking-wider">残り</div>
              <div>
                <span className="text-xl font-bold text-[#1e3a5f] leading-tight">
                  {activeGoal.daysLeft}
                </span>
                <span className="text-[10px] text-[#6b7280] ml-0.5">日</span>
              </div>
            </div>
            <div className="bg-white rounded-lg px-2 py-1.5 text-center">
              <div className="text-[9px] text-[#6b7280] uppercase tracking-wider">目標</div>
              <div>
                <span className="text-xl font-bold text-[#1e3a5f] leading-tight">
                  {activeGoal.targetScore}
                </span>
                <span className="text-[10px] text-[#6b7280] ml-0.5">点</span>
              </div>
            </div>
            <div className="bg-white rounded-lg px-2 py-1.5 text-center">
              <div className="text-[9px] text-[#6b7280] uppercase tracking-wider">行動目標</div>
              <div>
                <span className="text-xl font-bold text-[#1e3a5f] leading-tight">
                  {achievedCount}
                </span>
                <span className="text-sm text-[#6b7280] ml-0.5">/{totalCount}</span>
              </div>
            </div>
          </div>
          {/* 行動目標プレビュー */}
          {activeGoal.actionGoals.length > 0 && (
            <div className="space-y-1 pt-2 border-t border-[#1e40af]/15">
              {activeGoal.actionGoals.slice(0, 3).map((a) => (
                <div key={a.id} className="flex items-center gap-1.5 text-xs">
                  <span
                    className={`w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0 text-[9px] ${a.achieved ? 'bg-green-500 text-white' : 'bg-white border border-[#d1d5db]'}`}
                  >
                    {a.achieved ? '✓' : ''}
                  </span>
                  <span
                    className={`flex-1 ${a.achieved ? 'line-through text-[#9ca3af]' : 'text-[#1f2937] font-medium'}`}
                  >
                    {a.title}
                  </span>
                  {a.counter && (
                    <span className="text-[10px] text-[#6b7280] font-mono">
                      {a.counter.current}/{a.counter.total}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpenGoalModal();
          }}
          className="mb-3 w-full p-4 border border-dashed border-[#d1d5db] rounded-xl text-xs text-[#6b7280] hover:bg-[#f9fafb] hover:border-[#1e3a5f] hover:text-[#1e3a5f] transition-colors"
        >
          ＋ 試験目標を設定
        </button>
      )}

      {textbook.stalled && (
        <div className="mb-3 px-2.5 py-1.5 bg-amber-50 text-amber-800 text-xs rounded-md border border-amber-200 flex items-center gap-1.5">
          直近進捗なし <span className="text-amber-600">({textbook.lastDate} 以降)</span>
        </div>
      )}

      {/* 直近3コマ */}
      {last3.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] text-[#6b7280] mb-1">直近の授業</div>
          <div className="flex items-center gap-1 flex-wrap text-xs">
            {last3.map((it, i) => (
              <div key={it.id} className="flex items-center gap-1">
                {i > 0 && <span className="text-[#9ca3af]">→</span>}
                <span className="px-2 py-0.5 bg-[#f3f4f6] rounded text-[#4b5563]">
                  {it.lesson1Range}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* アクション */}
      <div className="flex gap-2">
        <button
          onClick={onOpen}
          className="flex-1 px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm text-[#4b5563] hover:bg-[#f3f4f6]"
        >
          詳細
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStartRecording();
          }}
          className="px-3 py-2 bg-[#1e3a5f] text-white rounded-lg text-sm hover:bg-[#2a4d7a]"
          title="テーブルに移動して授業を記録"
        >
          ＋ 授業を記録
        </button>
      </div>
    </div>
  );
}

function CardMoreMenu({ role, showToast }: { role: Role; showToast: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const isTeacher = role === 'teacher';
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen(!open)}
        className="w-7 h-7 rounded hover:bg-[#f3f4f6] text-[#6b7280] text-sm flex items-center justify-center"
        title="メニュー"
      >
        ⋯
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-44 bg-white border border-[#e5e7eb] rounded-lg shadow-lg z-20 overflow-hidden text-sm">
            {/* 教室長のみ: 下書き切替・季節タグ */}
            {!isTeacher && (
              <>
                <button
                  onClick={() => {
                    setOpen(false);
                    showToast('下書き切替');
                  }}
                  className="w-full px-3 py-2 text-left hover:bg-[#f3f4f6]"
                >
                  下書き切替
                </button>
                <button
                  onClick={() => {
                    setOpen(false);
                    showToast('季節タグ設定');
                  }}
                  className="w-full px-3 py-2 text-left hover:bg-[#f3f4f6]"
                >
                  季節タグ
                </button>
              </>
            )}
            {/* 全ロール: アーカイブ */}
            <button
              onClick={() => {
                setOpen(false);
                showToast('アーカイブしました');
              }}
              className="w-full px-3 py-2 text-left hover:bg-[#f3f4f6]"
            >
              アーカイブ
            </button>
            {/* 教室長のみ: 削除 */}
            {!isTeacher && (
              <button
                onClick={() => {
                  setOpen(false);
                  showToast('削除');
                }}
                className="w-full px-3 py-2 text-left hover:bg-[#fee2e2] text-red-600"
              >
                削除
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 面談用カード（教室長が保護者に提示するプレゼンビュー）
// ─────────────────────────────────────────────
function MeetingCard({ textbook, onOpen }: { textbook: Textbook; onOpen: () => void }) {
  const activeGoal = textbook.examGoals.find((g) => !g.archived);
  const achievedCount = activeGoal?.actionGoals.filter((a) => a.achieved).length ?? 0;
  const totalCount = activeGoal?.actionGoals.length ?? 0;
  const subjectAbbr = textbook.subject.charAt(0); // 「英」「数」「国」「理」…

  return (
    <div className="bg-gradient-to-br from-white to-[#f9fafb] rounded-2xl border border-[#e5e7eb] p-6 shadow-sm">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 rounded-full bg-[#1e3a5f] flex items-center justify-center text-white font-bold text-lg">
          {subjectAbbr}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-[#6b7280]">{textbook.subject}</div>
          <h3 className="font-semibold text-[#1f2937] truncate">{textbook.title}</h3>
        </div>
      </div>

      {activeGoal ? (
        <div className="space-y-3">
          <div className="bg-[#fef3c7] border border-[#fde68a] rounded-xl p-4">
            <div className="text-xs text-[#92400e] mb-1">次のテスト</div>
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-bold text-[#92400e]">
                {examNameOf(activeGoal.examNameId)}
              </span>
              <span className="text-sm text-[#92400e]">まで{activeGoal.daysLeft}日</span>
            </div>
            <div className="mt-1 text-xs text-[#92400e]">目標: {activeGoal.targetScore}点</div>
          </div>

          <div>
            <div className="text-xs text-[#6b7280] mb-2">取り組み中</div>
            <div className="space-y-1.5">
              {activeGoal.actionGoals.map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-sm">
                  <span
                    className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${a.achieved ? 'bg-green-100 text-green-700' : 'bg-[#f3f4f6] text-[#9ca3af]'}`}
                  >
                    {a.achieved ? '✓' : ''}
                  </span>
                  <span className={a.achieved ? 'text-[#9ca3af] line-through' : 'text-[#1f2937]'}>
                    {a.title}
                  </span>
                  {a.counter && (
                    <span className="ml-auto text-xs text-[#6b7280]">
                      {a.counter.current}/{a.counter.total}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-2 text-xs text-[#6b7280]">
              行動目標{' '}
              <span className="font-bold text-[#1f2937]">
                {achievedCount}/{totalCount}
              </span>{' '}
              達成
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-6 text-sm text-[#9ca3af]">
          現在、目標は設定されていません
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-[#f3f4f6] flex items-center justify-between gap-2">
        <div className="text-xs text-[#6b7280]">最終授業: {textbook.lastDate ?? '—'}</div>
        <button
          onClick={onOpen}
          className="px-3 py-1.5 bg-[#1e3a5f] text-white text-xs font-medium rounded-lg hover:bg-[#2a4d7a]"
        >
          学習プランを見る
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// テーブルビュー（ロール別表示 + 記録モード）
//
// 設計前提:
// - 1コマの授業で 3〜4 単元進むのが通常ケース
// - よって「1件ずつ記録」ではなく、テーブル上で複数行を選んで
//   授業日・講師名・引継ぎを一括スタンプする「記録モード」を用意
// - 進め方・宿題の出し方は常時表示（折りたたみなし）
// ─────────────────────────────────────────────
function TableView({
  textbook,
  role,
  viewMode,
  recordingInitial,
  onBack,
  onOpenGoalModal,
  onOpenRangeModal,
  showToast,
}: {
  textbook: Textbook;
  role: Role;
  viewMode: ViewMode;
  /** カードからの遷移時に記録モードONで入る場合 true */
  recordingInitial?: boolean;
  onBack: () => void;
  onOpenGoalModal: () => void;
  onOpenRangeModal: () => void;
  showToast: (m: string) => void;
}) {
  const today = new Date()
    .toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
    .replaceAll('/', '/');

  // 記録モード state
  const [recording, setRecording] = useState<boolean>(!!recordingInitial);
  const [recordDate, setRecordDate] = useState<string>(today);
  const [recordTeacher, setRecordTeacher] = useState<string>('高山');
  const [recordNote, setRecordNote] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!recording) setSelectedIds(new Set());
  }, [recording]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyStamp = (slot: 1 | 2 | 3) => {
    if (selectedIds.size === 0) {
      showToast('記録する行を選択してください');
      return;
    }
    showToast(
      `${selectedIds.size}件を${slot}回目に記録しました（${recordDate} / ${recordTeacher}）`
    );
    setSelectedIds(new Set());
  };

  const activeGoal = textbook.examGoals.find((g) => !g.archived);
  const isTeacher = role === 'teacher';
  const isMeeting = viewMode === 'meeting';

  // 合計: グループ先頭行（proposal/application が存在する行）のみ集計
  const totalProposal = textbook.items.reduce((sum, it) => sum + (it.proposal ?? 0), 0);
  const totalApplication = textbook.items.reduce((sum, it) => sum + (it.application ?? 0), 0);
  // グループ数（プランの粒度）
  const groupCount = new Set(textbook.items.filter((it) => it.group).map((it) => it.group)).size;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-sm text-[#4b5563] hover:text-[#1f2937]">
            ← 教科書一覧
          </button>
          <h2 className="text-base font-semibold text-[#1f2937]">{textbook.title}</h2>
          {isMeeting && (
            <span className="px-2 py-0.5 bg-[#fef3c7] text-[#92400e] rounded-full text-[10px] font-semibold uppercase tracking-wider">
              面談用・プラン表示
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isMeeting && !isTeacher && (
            <>
              <button
                onClick={() => showToast('PDF出力')}
                className="px-3 py-1.5 bg-white border border-[#e5e7eb] rounded-lg text-sm hover:bg-[#f3f4f6]"
              >
                PDF出力
              </button>
              <button
                onClick={() => showToast('講習ごとPDF出力')}
                className="px-3 py-1.5 bg-white border border-[#e5e7eb] rounded-lg text-sm hover:bg-[#f3f4f6]"
              >
                講習ごと
              </button>
            </>
          )}
          {!isMeeting && (
            <>
              <button
                onClick={() => showToast('列表示の切替')}
                className="px-3 py-1.5 bg-white border border-[#e5e7eb] rounded-lg text-sm hover:bg-[#f3f4f6]"
              >
                列の表示
              </button>
              <button
                onClick={() => setRecording((v) => !v)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  recording
                    ? 'bg-[#dc2626] text-white hover:bg-[#b91c1c]'
                    : 'bg-[#1e3a5f] text-white hover:bg-[#2a4d7a]'
                }`}
              >
                {recording ? '記録モード終了' : '＋ 授業を記録'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 試験目標 + 試験範囲 */}
      {(activeGoal || textbook.examRanges.length > 0) && (
        <div className="mb-4 bg-gradient-to-br from-[#eff6ff] to-[#dbeafe]/50 border border-[#1e40af]/25 rounded-xl shadow-sm overflow-hidden">
          {activeGoal && (
            <div className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-[10px] font-bold text-[#1e40af] uppercase tracking-widest mb-0.5">
                    試験目標
                  </div>
                  <div className="text-base font-bold text-[#1e3a5f]">
                    {examNameOf(activeGoal.examNameId)}
                  </div>
                  <div className="text-[11px] text-[#6b7280] mt-0.5">試験日: {activeGoal.date}</div>
                </div>
                <button
                  onClick={onOpenGoalModal}
                  className="px-2.5 py-1 text-xs bg-white border border-[#1e40af]/20 rounded text-[#1e40af] hover:bg-[#1e40af] hover:text-white transition-colors"
                >
                  目標を編集
                </button>
              </div>
              {/* 主要KPI（少し控えめなサイズ） */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-white rounded-lg px-3 py-2 text-center shadow-sm">
                  <div className="text-[10px] text-[#6b7280] uppercase tracking-wider font-semibold">
                    残り
                  </div>
                  <div>
                    <span className="text-2xl font-bold text-[#1e3a5f] leading-tight">
                      {activeGoal.daysLeft}
                    </span>
                    <span className="text-[11px] text-[#6b7280] ml-0.5">日</span>
                  </div>
                </div>
                <div className="bg-white rounded-lg px-3 py-2 text-center shadow-sm">
                  <div className="text-[10px] text-[#6b7280] uppercase tracking-wider font-semibold">
                    目標
                  </div>
                  <div>
                    <span className="text-2xl font-bold text-[#1e3a5f] leading-tight">
                      {activeGoal.targetScore}
                    </span>
                    <span className="text-[11px] text-[#6b7280] ml-0.5">点</span>
                  </div>
                </div>
                <div className="bg-white rounded-lg px-3 py-2 text-center shadow-sm">
                  <div className="text-[10px] text-[#6b7280] uppercase tracking-wider font-semibold">
                    行動目標
                  </div>
                  <div>
                    <span className="text-2xl font-bold text-[#1e3a5f] leading-tight">
                      {activeGoal.actionGoals.filter((a) => a.achieved).length}
                    </span>
                    <span className="text-sm text-[#6b7280] ml-0.5">
                      / {activeGoal.actionGoals.length}
                    </span>
                  </div>
                </div>
              </div>
              {/* 行動目標リスト */}
              {activeGoal.actionGoals.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[#1e40af]/15 grid grid-cols-1 md:grid-cols-3 gap-1.5">
                  {activeGoal.actionGoals.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-1.5 text-xs bg-white/60 rounded px-2 py-1"
                    >
                      <span
                        className={`w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0 text-[9px] ${a.achieved ? 'bg-green-500 text-white' : 'bg-white border border-[#d1d5db]'}`}
                      >
                        {a.achieved ? '✓' : ''}
                      </span>
                      <span
                        className={`flex-1 truncate ${a.achieved ? 'line-through text-[#9ca3af]' : 'text-[#1f2937] font-medium'}`}
                      >
                        {a.title}
                      </span>
                      {a.counter && (
                        <span className="text-[10px] text-[#6b7280] font-mono">
                          {a.counter.current}/{a.counter.total}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* 試験範囲: 単元名で「L2 過去形 〜 L5-2 応用」形式表示 */}
          <div className="px-4 py-2.5 bg-white/60 border-t border-[#1e40af]/15 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-[#1e40af] font-bold uppercase tracking-widest">
                試験範囲
              </span>
              {textbook.examRanges.length > 0 ? (
                textbook.examRanges.map((r) => (
                  <span
                    key={r.id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-[#1e40af]/20 rounded-full text-xs"
                  >
                    <strong className="text-[#1e3a5f]">{examNameOf(r.examNameId)}</strong>
                    <span className="text-[#6b7280]">
                      {rangeLabel(textbook, r.rangeStart, r.rangeEnd)}
                    </span>
                  </span>
                ))
              ) : (
                <span className="text-xs text-[#9ca3af] italic">未設定</span>
              )}
            </div>
            <button
              onClick={onOpenRangeModal}
              className="px-2.5 py-1 text-xs bg-white border border-[#1e40af]/20 rounded text-[#1e40af] hover:bg-[#1e40af] hover:text-white transition-colors"
            >
              範囲を設定
            </button>
          </div>
        </div>
      )}

      {/* 管理モード: 進め方/宿題は講師向け業務メモとして残す（面談モードには出さない）
          面談モード: ご提案の狙いは「意図タグの構成」から自動生成（教室長の記述は不要） */}
      {isMeeting ? (
        <MeetingPlanHeader
          textbook={textbook}
          activeGoal={activeGoal}
          totalProposal={totalProposal}
          groupCount={groupCount}
        />
      ) : (
        <div className="mb-3 bg-white border border-[#e5e7eb] rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1.5">
              進め方（講師向け業務メモ）
            </label>
            <textarea
              className="w-full px-2 py-1.5 border border-[#e5e7eb] rounded text-sm"
              rows={2}
              defaultValue="ワーク→応用の順。間違えた問題は必ず翌週再演習。"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1.5">
              宿題の出し方
            </label>
            <textarea
              className="w-full px-2 py-1.5 border border-[#e5e7eb] rounded text-sm"
              rows={2}
              defaultValue="次回範囲の予習 + 前回ワークの復習"
            />
          </div>
        </div>
      )}

      {/* 記録モード: 一括入力バー（面談モード時は表示しない） */}
      {recording && !isMeeting && (
        <div className="mb-3 bg-[#fff7ed] border-2 border-[#fb923c] rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-bold text-[#9a3412]">記録モード</div>
            <div className="text-xs text-[#9a3412]">
              1コマで複数単元を進める想定。行にチェック → 「N回目に記録」で一括スタンプ
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-[#9a3412] uppercase mb-1">
                授業日
              </label>
              <input
                type="text"
                value={recordDate}
                onChange={(e) => setRecordDate(e.target.value)}
                className="w-full px-2 py-1.5 border border-[#fb923c] bg-white rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-[#9a3412] uppercase mb-1">
                担当講師
              </label>
              <input
                type="text"
                value={recordTeacher}
                onChange={(e) => setRecordTeacher(e.target.value)}
                className="w-full px-2 py-1.5 border border-[#fb923c] bg-white rounded text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-[10px] font-semibold text-[#9a3412] uppercase mb-1">
                引継ぎメモ（選択行に共通・空欄可）
              </label>
              <input
                type="text"
                value={recordNote}
                onChange={(e) => setRecordNote(e.target.value)}
                className="w-full px-2 py-1.5 border border-[#fb923c] bg-white rounded text-sm"
                placeholder="全員理解度高め。次回は演習多めで。"
              />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm text-[#9a3412]">
              選択中 <strong className="text-lg">{selectedIds.size}</strong> 件
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => applyStamp(1)}
                disabled={selectedIds.size === 0}
                className="px-3 py-1.5 bg-[#1e3a5f] text-white text-sm rounded-lg hover:bg-[#2a4d7a] disabled:bg-[#9ca3af] disabled:cursor-not-allowed"
              >
                1回目に記録
              </button>
              <button
                onClick={() => applyStamp(2)}
                disabled={selectedIds.size === 0}
                className="px-3 py-1.5 bg-[#1e3a5f] text-white text-sm rounded-lg hover:bg-[#2a4d7a] disabled:bg-[#9ca3af] disabled:cursor-not-allowed"
              >
                2回目に記録
              </button>
              <button
                onClick={() => applyStamp(3)}
                disabled={selectedIds.size === 0}
                className="px-3 py-1.5 bg-[#1e3a5f] text-white text-sm rounded-lg hover:bg-[#2a4d7a] disabled:bg-[#9ca3af] disabled:cursor-not-allowed"
              >
                3回目に記録
              </button>
            </div>
          </div>
        </div>
      )}

      {/* グループ化（講師・面談モード時は非表示） */}
      {!isTeacher && !isMeeting && !recording && (
        <div className="mb-2 flex gap-2">
          <button
            onClick={() => showToast('グループ化')}
            className="px-3 py-1.5 text-sm bg-white border border-[#e5e7eb] rounded-lg hover:bg-[#f3f4f6]"
          >
            グループ化
          </button>
          <button
            onClick={() => showToast('グループ解除')}
            className="px-3 py-1.5 text-sm bg-white border border-[#e5e7eb] rounded-lg hover:bg-[#f3f4f6]"
          >
            グループ解除
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[1100px]">
          <thead className="bg-[#f9fafb] border-b border-[#e5e7eb] text-[#6b7280] text-xs">
            <tr>
              {recording && !isMeeting && <th className="px-3 py-2 text-left w-10"></th>}
              <th className="px-3 py-2 text-left w-10">#</th>
              <th className="px-3 py-2 text-left min-w-[180px]">単元名</th>
              <th className="px-3 py-2 text-left w-20">提案</th>
              {!isMeeting && <th className="px-3 py-2 text-left w-20">申込</th>}
              <th className="px-3 py-2 text-left w-32">試験範囲</th>
              <th className="px-3 py-2 text-left w-28">学校進度</th>
              <th className="px-3 py-2 text-left w-24">1回目</th>
              <th className="px-3 py-2 text-left w-24">2回目</th>
              <th className="px-3 py-2 text-left w-24">3回目</th>
              {!isMeeting && <th className="px-3 py-2 text-left min-w-[160px]">引継ぎ</th>}
              {!isMeeting && <th className="px-3 py-2 text-left w-24">講師名</th>}
              {!recording && !isMeeting && <th className="px-3 py-2 text-right w-24">操作</th>}
            </tr>
          </thead>
          <tbody>
            {textbook.items.map((it, idx) => {
              // 試験範囲タグ
              const examTags = textbook.examRanges
                .filter((r) => it.no >= r.rangeStart && it.no <= r.rangeEnd)
                .map((r) => examNameOf(r.examNameId));
              // グループ先頭判定: 先頭行 or 前行と group が違う
              const prev = idx > 0 ? textbook.items[idx - 1] : null;
              const groupStart = !prev || prev.group !== it.group;
              return (
                <ProgressRow
                  key={it.id}
                  item={it}
                  examTags={examTags}
                  groupStart={groupStart}
                  recording={recording && !isMeeting}
                  isMeeting={isMeeting}
                  selected={selectedIds.has(it.id)}
                  onToggleSelect={() => toggleSelect(it.id)}
                  onAction={(msg) => showToast(msg)}
                />
              );
            })}
          </tbody>
          {/* 合計フッター（グループ先頭行の値のみ集計） */}
          <tfoot className="bg-[#f9fafb] border-t-2 border-[#e5e7eb]">
            <tr className="text-xs text-[#4b5563]">
              {recording && !isMeeting && <td />}
              <td />
              <td className="px-3 py-2 text-right font-medium">合計</td>
              <td className="px-3 py-2 font-bold text-[#1f2937]">{totalProposal}コマ</td>
              {!isMeeting && (
                <td className="px-3 py-2 font-bold text-[#1f2937]">{totalApplication}コマ</td>
              )}
              <td colSpan={isMeeting ? 5 : recording ? 6 : 7} className="px-3 py-2 text-[#6b7280]">
                {totalProposal !== totalApplication && !isMeeting && (
                  <span className="text-amber-700">
                    ※ 提案と申込に{Math.abs(totalProposal - totalApplication)}コマの差
                  </span>
                )}
                {isMeeting && (
                  <span className="text-[#6b7280]">{groupCount}グループに分けて配分</span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* 面談モード: 「なぜこの配分か」を保護者に説明する根拠ブロック（自動生成） */}
      {isMeeting && (
        <div className="mt-4 bg-white border-2 border-[#fb923c]/30 rounded-xl p-5">
          <div className="text-[11px] font-bold text-[#9a3412] uppercase tracking-widest mb-3">
            なぜこのコマ数になったか
          </div>
          <div className="space-y-3">
            {textbook.items
              .filter((it) => (it.proposal ?? 0) > 0)
              .map((it) => (
                <div key={it.id} className="flex items-start gap-3 text-sm">
                  <span className="inline-flex items-center justify-center w-14 h-9 rounded-lg bg-[#fff7ed] text-[#9a3412] font-bold text-xs flex-shrink-0">
                    {it.proposal}コマ
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-[#1f2937]">
                        {it.group} · {it.title}
                      </span>
                      {it.intentTag && (
                        <span
                          className={`inline-block px-2 py-0.5 border rounded-full text-[10px] ${TAG_COLOR[it.intentTag]}`}
                        >
                          {it.intentTag}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[#6b7280] mt-1 leading-relaxed">
                      {rationale(it, textbook)}
                    </div>
                  </div>
                </div>
              ))}
          </div>
          <div className="mt-4 pt-3 border-t border-[#fb923c]/20 text-xs text-[#6b7280]">
            ※ 上の文章は意図タグから自動生成されています。詳しい状況は面談時に口頭で補足します。
          </div>
        </div>
      )}

      {!isMeeting && (
        <div className="mt-4 p-4 bg-white border border-dashed border-[#e5e7eb] rounded-lg text-sm text-[#4b5563]">
          <p className="font-medium text-[#1f2937] mb-1">使い方</p>
          <ul className="list-disc list-inside space-y-0.5 text-xs">
            <li>
              <strong>授業を記録</strong>: 右上のボタンで記録モードON → 行にチェック →
              「N回目に記録」で一括スタンプ
            </li>
            <li>
              提案・申込コマ数は<strong>グループ先頭行にのみ入力</strong>
              （同グループ他行は「↑」で集約表示）
            </li>
            <li>
              試験範囲・学校進度・引継ぎ・講師名は<strong>セルを直接クリックして編集</strong>
              （自動保存）
            </li>
            {isTeacher && (
              <li className="text-amber-700">
                現在「講師」ロール表示中: PDF/面談用モード/下書き切替/削除は非表示
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function ProgressRow({
  item,
  examTags,
  groupStart,
  recording,
  isMeeting,
  selected,
  onToggleSelect,
  onAction,
}: {
  item: Progress;
  examTags: string[];
  /** グループの先頭行か（提案・申込コマ数はグループ先頭行にのみ表示） */
  groupStart: boolean;
  recording: boolean;
  isMeeting: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onAction: (m: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const rowClick = () => {
    if (recording) onToggleSelect();
  };
  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={rowClick}
      className={`border-b border-[#f3f4f6] transition-colors ${recording ? 'cursor-pointer' : ''} ${
        selected ? 'bg-[#fff7ed]' : hovered ? 'bg-[#f9fafb]' : ''
      }`}
    >
      {/* 記録モード時のみチェックボックス */}
      {recording && (
        <td className="px-3 py-2.5">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            className="w-4 h-4 accent-[#fb923c] cursor-pointer"
          />
        </td>
      )}
      <td className="px-3 py-2.5 text-[#6b7280] text-xs">{item.no}</td>
      <td className="px-3 py-2.5 text-[#1f2937]">
        <div className="flex items-center gap-1.5 flex-wrap">
          {item.group && (
            <span className="inline-block px-1.5 py-0.5 bg-[#eff6ff] text-[#1e40af] text-[10px] rounded">
              {item.group}
            </span>
          )}
          <span>{item.title}</span>
          {/* 意図タグ: グループ先頭行のみ。管理モードでは選択可、面談モードでは読み取り表示 */}
          {groupStart &&
            (isMeeting ? (
              item.intentTag && (
                <span
                  className={`inline-block px-2 py-0.5 border rounded-full text-[10px] ${TAG_COLOR[item.intentTag]}`}
                >
                  {item.intentTag}
                </span>
              )
            ) : (
              <IntentTagPicker currentTag={item.intentTag} />
            ))}
        </div>
      </td>
      {/* 提案コマ数 — グループ先頭のみ表示・編集可 */}
      <td className={`px-3 py-2.5 ${!groupStart ? 'bg-[#fafafa]' : ''}`}>
        {!groupStart ? (
          <span className="text-[#d1d5db] text-xs">↑</span>
        ) : isMeeting ? (
          <span className="text-[#1f2937] text-xs font-medium">
            {item.proposal != null ? `${item.proposal}コマ` : '—'}
          </span>
        ) : (
          <input
            type="number"
            min={0}
            defaultValue={item.proposal ?? ''}
            placeholder="—"
            onClick={(e) => e.stopPropagation()}
            className="w-14 px-1.5 py-1 text-xs bg-transparent border border-transparent hover:border-[#e5e7eb] focus:border-[#1e3a5f] focus:bg-white rounded outline-none text-center"
          />
        )}
      </td>
      {/* 申込コマ数 — 管理モードのみ、グループ先頭のみ */}
      {!isMeeting && (
        <td className={`px-3 py-2.5 ${!groupStart ? 'bg-[#fafafa]' : ''}`}>
          {!groupStart ? (
            <span className="text-[#d1d5db] text-xs">↑</span>
          ) : (
            <input
              type="number"
              min={0}
              defaultValue={item.application ?? ''}
              placeholder="—"
              onClick={(e) => e.stopPropagation()}
              className="w-14 px-1.5 py-1 text-xs bg-transparent border border-transparent hover:border-[#e5e7eb] focus:border-[#1e3a5f] focus:bg-white rounded outline-none text-center"
            />
          )}
        </td>
      )}
      {/* 試験範囲 — 読み取り専用（試験範囲モーダルで設定された範囲から自動反映） */}
      <td className="px-3 py-2.5 text-xs">
        {examTags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {examTags.map((t, i) => (
              <span
                key={i}
                className="inline-block px-2 py-0.5 bg-[#eff6ff] text-[#1e40af] rounded-full border border-[#dbeafe] text-[11px] whitespace-nowrap"
              >
                {t}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-[#d1d5db]">—</span>
        )}
      </td>
      {/* 学校進度 */}
      <td className="px-3 py-2.5 text-[#4b5563] text-xs">
        <span className="text-[#d1d5db] italic">—</span>
      </td>
      {/* 1〜3回目: 日付のみを簡潔表示 */}
      <DateStampCell date={item.lesson1Date} />
      <DateStampCell date={item.lesson2Date} />
      <DateStampCell date={item.lesson3Date} />
      {/* 引継ぎ・講師名・操作 は面談モードで非表示 */}
      {!isMeeting && (
        <>
          <td className="px-3 py-2.5">
            <input
              type="text"
              defaultValue={item.note ?? ''}
              placeholder="引継ぎメモ"
              onClick={(e) => e.stopPropagation()}
              className="w-full px-1.5 py-1 text-xs bg-transparent border border-transparent hover:border-[#e5e7eb] focus:border-[#1e3a5f] focus:bg-white rounded outline-none"
            />
          </td>
          <td className="px-3 py-2.5">
            <input
              type="text"
              placeholder="講師"
              onClick={(e) => e.stopPropagation()}
              className="w-full px-1.5 py-1 text-xs bg-transparent border border-transparent hover:border-[#e5e7eb] focus:border-[#1e3a5f] focus:bg-white rounded outline-none"
            />
          </td>
          {!recording && (
            <td className="px-3 py-2.5 text-right">
              <div
                className={`inline-flex items-center gap-1 transition-opacity ${hovered ? 'opacity-100' : 'opacity-0'}`}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAction(`行 ${item.no} を複製しました`);
                  }}
                  className="px-2 h-7 rounded hover:bg-[#e5e7eb] text-[#6b7280] text-[11px]"
                  title="複製"
                >
                  複製
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAction(`行 ${item.no} をアーカイブしました`);
                  }}
                  className="px-2 h-7 rounded hover:bg-[#fee2e2] text-[#6b7280] hover:text-[#dc2626] text-[11px]"
                  title="アーカイブ"
                >
                  アーカイブ
                </button>
              </div>
            </td>
          )}
        </>
      )}
    </tr>
  );
}

/**
 * 面談モードの「ご提案の狙い」ヘッダ。教室長の自由記述は不要で、
 * 以下のデータだけから自動生成する:
 * - 有効な試験目標（あれば）: 試験名・残日数・目標点
 * - 教科書内の意図タグ構成: 各グループが担っている役割と提案コマ数
 */
function MeetingPlanHeader({
  textbook,
  activeGoal,
  totalProposal,
  groupCount,
}: {
  textbook: Textbook;
  activeGoal: ExamGoal | undefined;
  totalProposal: number;
  groupCount: number;
}) {
  // グループ先頭行 = intent が設定されうる行のみ集める
  const tagRows = textbook.items.filter((it) => it.intentTag);
  // 意図タグ別にコマ数を集計
  const byTag = new Map<GroupIntentTag, number>();
  for (const r of tagRows) {
    if (!r.intentTag) continue;
    byTag.set(r.intentTag, (byTag.get(r.intentTag) ?? 0) + (r.proposal ?? 0));
  }
  const tagSummary = Array.from(byTag.entries()); // [['苦手補強', 5], ...]

  // 見出し文の自動生成
  const headline = activeGoal
    ? `${examNameOf(activeGoal.examNameId)}まで残${activeGoal.daysLeft}日・目標${activeGoal.targetScore}点の達成に向けたご提案`
    : 'これからの学習プランのご提案';

  // タグ構成から本文を1行だけ生成
  const tagPhrase =
    tagSummary.length > 0 ? tagSummary.map(([t, c]) => `${t}に${c}コマ`).join(' / ') : '';

  return (
    <div className="mb-3 bg-gradient-to-br from-[#fff7ed] to-white border-2 border-[#fb923c]/30 rounded-xl p-5">
      <div className="text-[11px] font-bold text-[#9a3412] uppercase tracking-widest mb-2">
        今回のご提案の狙い
      </div>
      <p className="text-base text-[#1f2937] leading-relaxed font-semibold">{headline}</p>
      {tagPhrase && (
        <p className="text-sm text-[#4b5563] mt-2">
          合計<strong className="text-[#1f2937]">{totalProposal}コマ</strong>を
          <strong className="text-[#1f2937]">{groupCount}グループ</strong>に分けて配分しています。
        </p>
      )}
      {/* タグ構成を視覚的に */}
      {tagSummary.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[#fb923c]/20 flex flex-wrap gap-1.5">
          {tagSummary.map(([t, c]) => (
            <span
              key={t}
              className={`inline-flex items-center gap-1 px-2.5 py-1 border rounded-full text-xs ${TAG_COLOR[t]}`}
            >
              <span>{t}</span>
              <span className="font-bold">{c}コマ</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 意図タグピッカー（管理モード用）
 * クリックでタグ一覧ポップアップ → 選択するだけ。自由記述なし。
 */
function IntentTagPicker({ currentTag }: { currentTag?: GroupIntentTag }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      {currentTag ? (
        <button
          onClick={() => setOpen(!open)}
          className={`inline-block px-2 py-0.5 border rounded-full text-[10px] hover:shadow-sm transition-shadow ${TAG_COLOR[currentTag]}`}
        >
          {currentTag}
        </button>
      ) : (
        <button
          onClick={() => setOpen(!open)}
          className="inline-block px-2 py-0.5 border border-dashed border-[#d1d5db] rounded-full text-[10px] text-[#9ca3af] hover:border-[#1e3a5f] hover:text-[#1e3a5f]"
        >
          ＋意図タグ
        </button>
      )}
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 w-44 bg-white border border-[#e5e7eb] rounded-lg shadow-lg z-20 overflow-hidden">
            <div className="px-3 py-1.5 text-[10px] text-[#6b7280] uppercase tracking-wider border-b border-[#f3f4f6]">
              意図タグを選ぶ
            </div>
            {GROUP_INTENT_TAGS.map((t) => (
              <button
                key={t}
                onClick={() => setOpen(false)}
                className={`w-full px-3 py-1.5 text-left text-xs hover:bg-[#f9fafb] ${currentTag === t ? 'bg-[#eff6ff] font-semibold' : ''}`}
              >
                {t}
              </button>
            ))}
            {currentTag && (
              <button
                onClick={() => setOpen(false)}
                className="w-full px-3 py-1.5 text-left text-[11px] text-[#6b7280] hover:bg-red-50 border-t border-[#f3f4f6]"
              >
                タグを外す
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 日付スタンプセル
 * - 値あり → コンパクトに日付のみ表示
 * - 値なし → セルクリックで記録モードに促すプレースホルダ
 */
function DateStampCell({ date }: { date?: string }) {
  return (
    <td className="px-3 py-2.5 text-xs">
      {date ? (
        <span className="text-[#1f2937]">{date.replace(/^\d{4}\//, '')}</span>
      ) : (
        <span className="text-[#d1d5db]">—</span>
      )}
    </td>
  );
}

// ─────────────────────────────────────────────
// 試験目標 + 行動目標 モーダル（F16 + 行動目標）
// ─────────────────────────────────────────────
function ExamGoalModal({
  textbook,
  onClose,
  onSave,
}: {
  textbook: Textbook;
  onClose: () => void;
  onSave: (msg: string) => void;
}) {
  const activeGoal = textbook.examGoals.find((g) => !g.archived);
  const pastGoals = textbook.examGoals.filter((g) => g.archived);
  const [actionGoals, setActionGoals] = useState<ActionGoal[]>(activeGoal?.actionGoals ?? []);
  const [showPast, setShowPast] = useState(false);
  const [showCopyMenu, setShowCopyMenu] = useState(false);

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col pointer-events-auto">
          <header className="px-6 py-4 border-b border-[#e5e7eb] flex items-center justify-between">
            <div>
              <h2 className="font-bold text-[#1f2937] text-lg">試験目標と行動目標</h2>
              <p className="text-xs text-[#6b7280] mt-0.5">{textbook.title}</p>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded hover:bg-[#f3f4f6] text-[#6b7280]">
              ✕
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* 目標コピペメニュー */}
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-[#1f2937]">試験目標</div>
              <div className="relative">
                <button
                  onClick={() => setShowCopyMenu(!showCopyMenu)}
                  className="px-3 py-1.5 text-xs bg-[#eff6ff] text-[#1e40af] rounded-lg hover:bg-[#dbeafe] border border-[#dbeafe]"
                >
                  過去の目標から複製 ▾
                </button>
                {showCopyMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowCopyMenu(false)} />
                    <div className="absolute right-0 mt-1 w-72 bg-white border border-[#e5e7eb] rounded-lg shadow-lg z-20 overflow-hidden">
                      {pastGoals.length === 0 && (
                        <div className="p-4 text-xs text-[#6b7280]">過去の目標はありません</div>
                      )}
                      {pastGoals.map((g) => (
                        <button
                          key={g.id}
                          onClick={() => {
                            setActionGoals(
                              g.actionGoals.map((a) => ({
                                ...a,
                                id: `new-${a.id}`,
                                achieved: false,
                                counter: a.counter ? { ...a.counter, current: 0 } : undefined,
                              }))
                            );
                            setShowCopyMenu(false);
                            onSave(`${examNameOf(g.examNameId)}の行動目標テンプレをコピーしました`);
                          }}
                          className="w-full p-3 text-left hover:bg-[#f9fafb] border-b border-[#f3f4f6] last:border-0"
                        >
                          <div className="text-sm font-medium text-[#1f2937]">
                            {examNameOf(g.examNameId)}
                          </div>
                          <div className="text-[11px] text-[#6b7280] mt-0.5">
                            目標{g.targetScore}点 / 行動目標{g.actionGoals.length}件 /{' '}
                            {g.actualScore ? `実際${g.actualScore}点` : '結果未入力'}
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* 試験名・日付・目標点 */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#6b7280] mb-1">
                  試験名（共通マスタから選択）
                </label>
                <select
                  defaultValue={activeGoal?.examNameId ?? ''}
                  className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white"
                >
                  <option value="">選択してください</option>
                  {EXAM_NAMES.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6b7280] mb-1">試験日</label>
                <input
                  type="text"
                  defaultValue={activeGoal?.date ?? ''}
                  className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm"
                  placeholder="2026/04/21"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6b7280] mb-1">目標点</label>
                <input
                  type="number"
                  defaultValue={activeGoal?.targetScore ?? ''}
                  className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm"
                  placeholder="80"
                />
              </div>
            </div>

            {/* 試験範囲は別モーダルで設定（目標を設定する段階では範囲が不明なことが多いため切り離し） */}
            <div className="p-3 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-xs text-[#6b7280]">
              試験範囲は後日、別画面で設定できます（目標を決める段階では学校の試験範囲は未発表のケースが多いため切り離し）。
            </div>

            {/* 行動目標セクション */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-[#1f2937]">
                  行動目標{' '}
                  <span className="text-xs text-[#6b7280] font-normal">
                    （目標達成のための日々の行動）
                  </span>
                </label>
                <button
                  onClick={() =>
                    setActionGoals([
                      ...actionGoals,
                      { id: `new-${Date.now()}`, title: '', achieved: false },
                    ])
                  }
                  className="text-xs px-2 py-1 text-[#1e40af] hover:bg-[#eff6ff] rounded"
                >
                  ＋ 追加
                </button>
              </div>

              <div className="space-y-2">
                {actionGoals.map((a, idx) => (
                  <ActionGoalRow
                    key={a.id}
                    goal={a}
                    onChange={(next) => {
                      const copy = [...actionGoals];
                      copy[idx] = next;
                      setActionGoals(copy);
                    }}
                    onDelete={() => setActionGoals(actionGoals.filter((_, i) => i !== idx))}
                  />
                ))}
                {actionGoals.length === 0 && (
                  <div className="p-4 border border-dashed border-[#e5e7eb] rounded-lg text-xs text-center text-[#9ca3af]">
                    まだ行動目標がありません。目標達成のための具体的な行動を追加しましょう。
                  </div>
                )}
              </div>
            </div>

            {/* 過去の目標 */}
            {pastGoals.length > 0 && (
              <div>
                <button
                  onClick={() => setShowPast(!showPast)}
                  className="text-xs text-[#6b7280] hover:text-[#1f2937] flex items-center gap-1"
                >
                  <span
                    className="transition-transform inline-block"
                    style={{ transform: showPast ? 'rotate(90deg)' : 'none' }}
                  >
                    ▸
                  </span>
                  過去の目標 ({pastGoals.length})
                </button>
                {showPast && (
                  <div className="mt-2 space-y-2">
                    {pastGoals.map((g) => (
                      <div
                        key={g.id}
                        className="p-3 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-medium text-[#4b5563]">
                              {examNameOf(g.examNameId)}
                            </div>
                            <div className="text-[11px] text-[#6b7280] mt-0.5">
                              {g.date} / 目標{g.targetScore}点
                              {g.actualScore && (
                                <span
                                  className={`ml-2 font-bold ${g.actualScore >= g.targetScore ? 'text-green-600' : 'text-red-600'}`}
                                >
                                  → 実際{g.actualScore}点{' '}
                                  {g.actualScore >= g.targetScore ? '✓達成' : '未達'}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-xs text-[#6b7280]">
                            行動目標 {g.actionGoals.filter((a) => a.achieved).length}/
                            {g.actionGoals.length} 達成
                          </div>
                        </div>
                        <div className="mt-2 space-y-0.5">
                          {g.actionGoals.map((a) => (
                            <div
                              key={a.id}
                              className="flex items-center gap-1.5 text-[11px] text-[#6b7280]"
                            >
                              <span>{a.achieved ? '✓' : '✗'}</span>
                              <span className={a.achieved ? '' : 'text-[#9ca3af]'}>{a.title}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <footer className="px-6 py-4 border-t border-[#e5e7eb] flex items-center justify-between bg-[#f9fafb]">
            <div className="text-xs text-[#6b7280]">
              試験結果を登録すると、自動で達成/未達を判定する機能は将来実装予定
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-sm text-[#4b5563] hover:bg-[#f3f4f6] rounded-lg"
              >
                キャンセル
              </button>
              <button
                onClick={() => onSave('試験目標と行動目標を保存しました')}
                className="px-4 py-1.5 bg-[#1e3a5f] text-white text-sm font-medium rounded-lg hover:bg-[#2a4d7a]"
              >
                保存
              </button>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}

function ActionGoalRow({
  goal,
  onChange,
  onDelete,
}: {
  goal: ActionGoal;
  onChange: (next: ActionGoal) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2 p-2 bg-white border border-[#e5e7eb] rounded-lg group">
      {/* 達成チェック */}
      <button
        onClick={() => onChange({ ...goal, achieved: !goal.achieved })}
        className={`w-6 h-6 rounded flex items-center justify-center text-sm transition-colors ${
          goal.achieved
            ? 'bg-green-100 text-green-700 border border-green-300'
            : 'bg-white border border-[#d1d5db] hover:border-[#1e3a5f]'
        }`}
        title="達成"
      >
        {goal.achieved ? '✓' : ''}
      </button>

      {/* タイトル */}
      <input
        type="text"
        value={goal.title}
        onChange={(e) => onChange({ ...goal, title: e.target.value })}
        placeholder="例: 毎朝英単語50個を覚える"
        className={`flex-1 px-2 py-1 border-0 bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-[#1e3a5f] rounded ${goal.achieved ? 'line-through text-[#9ca3af]' : ''}`}
      />

      {/* 回数カウンター */}
      {goal.counter ? (
        <div className="flex items-center gap-1 bg-[#f3f4f6] rounded px-1.5 py-0.5">
          <button
            onClick={() =>
              goal.counter &&
              onChange({
                ...goal,
                counter: { ...goal.counter, current: Math.max(0, goal.counter.current - 1) },
              })
            }
            className="w-5 h-5 rounded hover:bg-white text-[#6b7280] text-xs"
          >
            −
          </button>
          <span className="text-xs font-medium text-[#1f2937] min-w-[40px] text-center">
            {goal.counter.current}/{goal.counter.total}
          </span>
          <button
            onClick={() =>
              goal.counter &&
              onChange({
                ...goal,
                counter: {
                  ...goal.counter,
                  current: Math.min(goal.counter.total, goal.counter.current + 1),
                },
              })
            }
            className="w-5 h-5 rounded hover:bg-white text-[#6b7280] text-xs"
          >
            ＋
          </button>
        </div>
      ) : (
        <button
          onClick={() => onChange({ ...goal, counter: { current: 0, total: 3 } })}
          className="text-[11px] px-1.5 py-0.5 text-[#6b7280] hover:bg-[#f3f4f6] rounded"
          title="回数カウンターを追加"
        >
          回数
        </button>
      )}

      {/* 削除 */}
      <button
        onClick={onDelete}
        className="w-6 h-6 rounded hover:bg-red-50 text-[#9ca3af] hover:text-red-600 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
        title="削除"
      >
        ✕
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────
// ダブルハンドルのレンジスライダー
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// 試験範囲設定モーダル（試験目標から独立）
// ─────────────────────────────────────────────
function ExamRangeModal({
  textbook,
  onClose,
  onSave,
}: {
  textbook: Textbook;
  onClose: () => void;
  onSave: (msg: string) => void;
}) {
  // 対象の試験: 試験名マスタから選択（目標有無に関係なく選べる）
  const existingRange = (id: string) => textbook.examRanges.find((r) => r.examNameId === id);
  const [selectedExamNameId, setSelectedExamNameId] = useState<string>(
    textbook.examRanges[0]?.examNameId ?? EXAM_NAMES[0].id
  );
  const existing = existingRange(selectedExamNameId);
  const [rangeStart, setRangeStart] = useState(existing?.rangeStart ?? 1);
  const [rangeEnd, setRangeEnd] = useState(existing?.rangeEnd ?? textbook.curriculumItems.length);

  useEffect(() => {
    const e = existingRange(selectedExamNameId);
    if (e) {
      setRangeStart(e.rangeStart);
      setRangeEnd(e.rangeEnd);
    } else {
      setRangeStart(1);
      setRangeEnd(textbook.curriculumItems.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExamNameId]);

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col pointer-events-auto">
          <header className="px-6 py-4 border-b border-[#e5e7eb] flex items-center justify-between">
            <div>
              <h2 className="font-bold text-[#1f2937] text-lg">試験範囲を設定</h2>
              <p className="text-xs text-[#6b7280] mt-0.5">{textbook.title}</p>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded hover:bg-[#f3f4f6] text-[#6b7280]">
              ✕
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* 対象の試験（マスタから選択） */}
            <div>
              <label className="block text-xs font-medium text-[#6b7280] mb-1.5">
                対象の試験（マスタから選択）
              </label>
              <select
                value={selectedExamNameId}
                onChange={(e) => setSelectedExamNameId(e.target.value)}
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white"
              >
                {EXAM_NAMES.map((e) => {
                  const r = existingRange(e.id);
                  return (
                    <option key={e.id} value={e.id}>
                      {e.name}
                      {r ? ` （設定済: 項目${r.rangeStart}〜${r.rangeEnd}）` : ' （未設定）'}
                    </option>
                  );
                })}
              </select>
              <p className="text-[11px] text-[#6b7280] mt-1">
                試験目標の有無に関わらず、試験名に対して独立に範囲を設定できます。
              </p>
            </div>

            {selectedExamNameId && (
              <>
                {/* スライダー */}
                <div>
                  <label className="block text-xs font-medium text-[#6b7280] mb-2">
                    範囲{' '}
                    <span className="text-[#1f2937] ml-1">
                      項目 {rangeStart} 〜 {rangeEnd}（{rangeEnd - rangeStart + 1}項目）
                    </span>
                  </label>
                  <RangeSlider
                    min={1}
                    max={textbook.curriculumItems.length}
                    start={rangeStart}
                    end={rangeEnd}
                    onChange={(s, e) => {
                      setRangeStart(s);
                      setRangeEnd(e);
                    }}
                  />
                  <div className="mt-3 flex flex-wrap gap-1">
                    {textbook.curriculumItems.map((ci) => {
                      const inRange = ci.no >= rangeStart && ci.no <= rangeEnd;
                      return (
                        <button
                          key={ci.no}
                          onClick={() => {
                            if (ci.no < rangeStart) setRangeStart(ci.no);
                            else if (ci.no > rangeEnd) setRangeEnd(ci.no);
                            else if (ci.no - rangeStart < rangeEnd - ci.no) setRangeStart(ci.no);
                            else setRangeEnd(ci.no);
                          }}
                          className={`px-2 py-1 text-[11px] rounded border transition-colors ${
                            inRange
                              ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                              : 'bg-white text-[#4b5563] border-[#e5e7eb] hover:bg-[#f3f4f6]'
                          }`}
                          title={ci.title}
                        >
                          {ci.no}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex gap-1">
                    <button
                      onClick={() => {
                        setRangeStart(1);
                        setRangeEnd(textbook.curriculumItems.length);
                      }}
                      className="text-[11px] px-2 py-0.5 bg-[#f3f4f6] rounded hover:bg-[#e5e7eb]"
                    >
                      全範囲
                    </button>
                    <button
                      onClick={() => {
                        setRangeStart(Math.max(1, textbook.curriculumItems.length - 7));
                        setRangeEnd(textbook.curriculumItems.length);
                      }}
                      className="text-[11px] px-2 py-0.5 bg-[#f3f4f6] rounded hover:bg-[#e5e7eb]"
                    >
                      直近8項目
                    </button>
                  </div>
                </div>

                {/* プレビュー */}
                <div className="bg-[#f9fafb] border border-[#e5e7eb] rounded-lg p-3">
                  <div className="text-[10px] text-[#6b7280] font-semibold uppercase tracking-wider mb-1.5">
                    プレビュー
                  </div>
                  <div className="flex flex-wrap gap-1 text-[11px]">
                    {textbook.curriculumItems.slice(rangeStart - 1, rangeEnd).map((ci) => (
                      <span
                        key={ci.no}
                        className="px-1.5 py-0.5 bg-white border border-[#e5e7eb] rounded"
                      >
                        {ci.no}. {ci.title}
                      </span>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <footer className="px-6 py-4 border-t border-[#e5e7eb] flex items-center justify-end gap-2 bg-[#f9fafb]">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-[#4b5563] hover:bg-[#f3f4f6] rounded-lg"
            >
              キャンセル
            </button>
            <button
              onClick={() =>
                onSave(
                  `「${examNameOf(selectedExamNameId)}」の範囲を項目${rangeStart}〜${rangeEnd}に設定しました`
                )
              }
              disabled={!selectedExamNameId}
              className="px-4 py-1.5 bg-[#1e3a5f] text-white text-sm font-medium rounded-lg hover:bg-[#2a4d7a] disabled:bg-[#9ca3af]"
            >
              範囲を保存
            </button>
          </footer>
        </div>
      </div>
    </>
  );
}

function RangeSlider({
  min,
  max,
  start,
  end,
  onChange,
}: {
  min: number;
  max: number;
  start: number;
  end: number;
  onChange: (s: number, e: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);

  const pct = (v: number) => ((v - min) / (max - min)) * 100;

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const val = Math.round(min + ratio * (max - min));
    if (dragging === 'start') {
      onChange(Math.min(val, end), end);
    } else {
      onChange(start, Math.max(val, start));
    }
  };

  useEffect(() => {
    if (!dragging) return;
    const up = () => setDragging(null);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, start, end]);

  return (
    <div className="relative h-10 select-none" ref={trackRef}>
      <div className="absolute top-1/2 -translate-y-1/2 w-full h-1.5 bg-[#e5e7eb] rounded-full" />
      <div
        className="absolute top-1/2 -translate-y-1/2 h-1.5 bg-[#1e3a5f] rounded-full"
        style={{ left: `${pct(start)}%`, width: `${pct(end) - pct(start)}%` }}
      />
      <button
        onPointerDown={() => setDragging('start')}
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 bg-white border-2 border-[#1e3a5f] rounded-full cursor-grab active:cursor-grabbing shadow-md hover:scale-110 transition-transform"
        style={{ left: `${pct(start)}%` }}
        title={`開始: 項目${start}`}
      />
      <button
        onPointerDown={() => setDragging('end')}
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 bg-white border-2 border-[#1e3a5f] rounded-full cursor-grab active:cursor-grabbing shadow-md hover:scale-110 transition-transform"
        style={{ left: `${pct(end)}%` }}
        title={`終了: 項目${end}`}
      />
    </div>
  );
}

// ─────────────────────────────────────────────
// （旧: クイック入力ドロワー は削除。記録はテーブル上の「授業を記録」から）
// ─────────────────────────────────────────────
