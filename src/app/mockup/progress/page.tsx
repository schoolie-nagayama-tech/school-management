'use client';

/**
 * 進行表まわり UI モック：A/B 2コンセプト × 4タブ
 *   コンセプト A: 現実主義（既存に近い改良版）
 *   コンセプト B: 根本見直し（脱表・脱ダッシュ・脱フォーム・脱静的）
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ChevronLeft, BookOpen, Check, Plus, AlertTriangle,
  TrendingUp, Sparkles, FileText, Inbox, KanbanSquare, Sliders,
  ArrowRight, MessageSquare, Calendar, Zap,
  ChevronDown, ChevronUp,
} from 'lucide-react';

// ─────────────────────── 共通シードデータ ───────────────────────
type Season = 'normal' | 'spring' | 'summer' | 'winter';

const _STUDENTS = [
  { id: 's1', name: '田中 太郎', grade: 8, textbook: '数学 一次方程式' },
  { id: 's2', name: '鈴木 花子', grade: 9, textbook: '英文法 中3' },
  { id: 's3', name: '佐藤 次郎', grade: 8, textbook: '数学 比例反比例' },
  { id: 's4', name: '高橋 三郎', grade: 11, textbook: '数学Ⅱ' },
  { id: 's5', name: '伊藤 美咲', grade: 9, textbook: '理科 中3' },
];

const UNITS = [
  { id: '1-0', label: 'ノートの使い方' },
  { id: '1-1', label: '正負の数の加減' },
  { id: '1-2', label: 'かっこのついた数の加減' },
  { id: '1-3', label: '分数の加減' },
  { id: '1-4', label: '正負の数の乗法' },
  { id: '1-5', label: '除法' },
  { id: '1-6', label: '累乗' },
  { id: '1-7', label: '乗除と累乗の混じった計算' },
  { id: '1-8', label: '四則の混じった計算' },
  { id: '2-1', label: '文字式のきまり' },
  { id: '2-2', label: '文字式の計算' },
  { id: '2-3', label: '一次方程式' },
];

type ColKey = 'lesson1' | 'lesson2' | 'lesson3' | 'school';
interface RowState {
  lesson1: string | null;
  lesson2: string | null;
  lesson3: string | null;
  school: string | null;
  applied_lessons: number;
  applied_season?: Season;
  homework_not_done: boolean;
  tardy: boolean;
}
const DEFAULT_ROW: RowState = {
  lesson1: null, lesson2: null, lesson3: null, school: null,
  applied_lessons: 0, applied_season: undefined,
  homework_not_done: false, tardy: false,
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const fmtMd = (d: string | null) => d ? d.replace(/^\d{4}-/, '').replace('-', '/') : '—';

const SEED_ROWS: Record<string, RowState> = (() => {
  const r: Record<string, RowState> = {};
  for (const u of UNITS) r[u.id] = { ...DEFAULT_ROW };
  r['1-0'] = { ...DEFAULT_ROW, lesson1: '2026-04-15', lesson2: '2026-04-22', lesson3: '2026-04-26', school: '2026-04-22' };
  r['1-1'] = { ...DEFAULT_ROW, lesson1: '2026-04-15', lesson2: '2026-04-22', school: '2026-04-22' };
  r['1-2'] = { ...DEFAULT_ROW, lesson1: '2026-04-22', school: '2026-04-22' };
  r['1-3'] = { ...DEFAULT_ROW, applied_lessons: 2, applied_season: 'summer' };
  r['1-4'] = { ...DEFAULT_ROW, applied_lessons: 1, applied_season: 'summer' };
  r['1-7'] = { ...DEFAULT_ROW, applied_lessons: 2, applied_season: 'summer' };
  return r;
})();

// ─────────────────────── ナビ ───────────────────────
function ConceptSwitch({ value, onChange }: { value: 'A' | 'B'; onChange: (v: 'A' | 'B') => void }) {
  return (
    <div className="inline-flex items-center gap-1 p-1 bg-gradient-to-r from-slate-100 to-slate-200 rounded-2xl shadow-inner">
      {([
        { k: 'A', label: 'A: 現実主義', sub: '既存改良版' },
        { k: 'B', label: 'B: 根本見直し', sub: '脱・既存設計' },
      ] as const).map((c) => (
        <button
          key={c.k}
          onClick={() => onChange(c.k)}
          className={`px-4 py-2 rounded-xl text-left transition-all duration-200 ${
            value === c.k
              ? 'bg-white shadow-md scale-[1.02]'
              : 'opacity-60 hover:opacity-100'
          }`}
        >
          <div className="text-sm font-bold">{c.label}</div>
          <div className="text-[10px] text-gray-500">{c.sub}</div>
        </button>
      ))}
    </div>
  );
}

function TabNav({ active, onChange, concept }: { active: string; onChange: (v: string) => void; concept: 'A'|'B' }) {
  const tabsA = [
    { key: 'teacher',    label: '① 講師UI',           icon: <BookOpen className="w-4 h-4" /> },
    { key: 'overview',   label: '② 教室長：普段使い', icon: <TrendingUp className="w-4 h-4" /> },
    { key: 'curriculum', label: '③ 教室長：講習',     icon: <Sparkles className="w-4 h-4" /> },
    { key: 'proposal',   label: '④ 保護者提案',       icon: <FileText className="w-4 h-4" /> },
  ];
  const tabsB = [
    { key: 'teacher',    label: '① 講師：Kanban',     icon: <KanbanSquare className="w-4 h-4" /> },
    { key: 'overview',   label: '② 教室長：Inbox',    icon: <Inbox className="w-4 h-4" /> },
    { key: 'curriculum', label: '③ 講習：Pipeline',   icon: <ArrowRight className="w-4 h-4" /> },
    { key: 'proposal',   label: '④ 保護者：Sim',      icon: <Sliders className="w-4 h-4" /> },
  ];
  const tabs = concept === 'A' ? tabsA : tabsB;
  return (
    <div className="flex flex-wrap items-center gap-1 mb-6 border-b border-gray-200 pb-3">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-all duration-150 ${
            active === t.key
              ? (concept === 'A' ? 'bg-[#1e3a5f] text-white shadow-sm' : 'bg-fuchsia-700 text-white shadow-sm')
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          {t.icon}{t.label}
        </button>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// コンセプト A: 既存改良版（前回の実装）
// ════════════════════════════════════════════════════════════════

// ─── セッション型 (1コマ=1セッション) ───
interface SessionData {
  id: string;
  date: string;
  teacherName: string;
  schoolProgress: string;
  handover: string;
  homeworkNotDone: boolean;
  tardy: boolean;
  unitActions: Record<string, ColKey | null>; // unitId → stamped column
}

const createSession = (id: string): SessionData => ({
  id,
  date: todayIso(),
  teacherName: '',
  schoolProgress: '',
  handover: '',
  homeworkNotDone: false,
  tardy: false,
  unitActions: {},
});

function A_TeacherView({ rows, setRows }: { rows: Record<string, RowState>; setRows: (fn: (prev: Record<string, RowState>) => Record<string, RowState>) => void }) {
  const prevHandover = {
    date: '2026-04-28', teacher: '田口',
    text: '1-1、1-2の復習完了。計算スピードが改善。分数の加減に入ってOK。',
  };

  const [sessions, setSessions] = useState<SessionData[]>(() => [
    { id: 'ses-1', date: todayIso(), teacherName: '山田', schoolProgress: '', handover: '', homeworkNotDone: false, tardy: false, unitActions: {} },
  ]);
  const [activeSessionIdx, setActiveSessionIdx] = useState(0);
  const [expandedSession, setExpandedSession] = useState<string | null>('ses-1');

  const addSession = () => {
    const newId = `ses-${Date.now()}`;
    setSessions(prev => [...prev, createSession(newId)]);
    setActiveSessionIdx(sessions.length);
    setExpandedSession(newId);
  };
  const updateSession = (idx: number, patch: Partial<SessionData>) => {
    setSessions(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  };

  // 学校列クリック → トグル＋セッションに反映
  const toggleSchool = (unitId: string) => {
    const session = sessions[activeSessionIdx];
    if (!session) return;
    const r = rows[unitId] ?? DEFAULT_ROW;
    setRows(prev => ({
      ...prev, [unitId]: { ...prev[unitId], school: r.school ? null : session.date },
    }));
  };

  // 日付セルクリック → トグル＋セッションに反映
  const toggleDate = (unitId: string, col: ColKey) => {
    const session = sessions[activeSessionIdx];
    if (!session) return;
    const r = rows[unitId] ?? DEFAULT_ROW;
    if (r[col]) {
      // 日付解除
      setRows(prev => ({ ...prev, [unitId]: { ...prev[unitId], [col]: null } }));
      setSessions(prev => prev.map((s, i) => {
        if (i !== activeSessionIdx) return s;
        const next = { ...s.unitActions };
        if (next[unitId] === col) delete next[unitId];
        return { ...s, unitActions: next };
      }));
    } else {
      // 日付セット
      setRows(prev => ({ ...prev, [unitId]: { ...prev[unitId], [col]: session.date } }));
      setSessions(prev => prev.map((s, i) =>
        i === activeSessionIdx ? { ...s, unitActions: { ...s.unitActions, [unitId]: col } } : s
      ));
    }
  };

  const activeSession = sessions[activeSessionIdx];
  const schoolUnitsToday = UNITS.filter(u => (rows[u.id] ?? DEFAULT_ROW).school === activeSession?.date);
  const lessonUnitsThisSession = activeSession
    ? Object.entries(activeSession.unitActions)
        .map(([uid, col]) => ({ unit: UNITS.find(u => u.id === uid), col }))
        .filter((x): x is { unit: (typeof UNITS)[number]; col: ColKey } => !!x.unit)
    : [];
  const requiredMissing = activeSession && (!activeSession.date || !activeSession.teacherName || schoolUnitsToday.length === 0 || !activeSession.handover);

  return (
    <div className="space-y-4">
      <div className="p-3 bg-gray-100 border border-gray-200 rounded-xl text-sm flex items-center justify-between">
        <span className="font-semibold text-gray-900">田中 太郎（中2）／数学 一次方程式</span>
        <span className="text-xs text-gray-500">1コマ = 1セッション</span>
      </div>

      {/* 前回の引継ぎ */}
      <div className="p-3 bg-white border border-gray-200 rounded-xl">
        <div className="flex items-center gap-2 mb-1">
          <MessageSquare className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-[11px] font-semibold text-gray-500">前回の引継ぎ</span>
          <span className="text-[11px] text-gray-400">{prevHandover.date.replace(/-/g,'/')} {prevHandover.teacher}</span>
        </div>
        <p className="text-sm text-gray-800">{prevHandover.text}</p>
      </div>

      {/* セッション一覧 */}
      <div className="space-y-3">
        {sessions.map((session, idx) => {
          const isExpanded = expandedSession === session.id;
          const isActive = activeSessionIdx === idx;
          const isFilled = session.teacherName && schoolUnitsToday.length > 0 && session.handover;
          const hasIssue = session.homeworkNotDone || session.tardy;
          return (
            <div key={session.id} className={`rounded-xl border overflow-hidden ${
              hasIssue ? 'border-amber-400 bg-amber-50/30' :
              isActive ? 'border-[#1e3a5f] ring-1 ring-[#1e3a5f]/20 bg-white' :
              'border-gray-200 bg-white'
            }`}>
              <button
                onClick={() => { setExpandedSession(isExpanded ? null : session.id); setActiveSessionIdx(idx); }}
                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50/50 transition-colors"
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                  hasIssue ? 'bg-amber-500 text-white' : isActive ? 'bg-[#1e3a5f] text-white' : 'bg-gray-100 text-gray-600'
                }`}>{idx + 1}</div>
                <div className="flex-1 text-left">
                  <div className="text-sm font-medium">
                    {session.date.replace(/-/g,'/')}
                    {session.teacherName && <span className="ml-2 text-gray-500">{session.teacherName}</span>}
                  </div>
                  {session.handover && <div className="text-xs text-gray-500 truncate max-w-md">引継: {session.handover}</div>}
                </div>
                <div className="flex items-center gap-2">
                  {session.homeworkNotDone && <span className="px-1.5 py-0.5 text-[10px] bg-amber-200 text-amber-900 rounded font-medium">宿未</span>}
                  {session.tardy && <span className="px-1.5 py-0.5 text-[10px] bg-amber-200 text-amber-900 rounded font-medium">遅刻</span>}
                  {isFilled ? <Check className="w-4 h-4 text-[#1e3a5f]" /> : <AlertTriangle className="w-4 h-4 text-amber-500" />}
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-gray-200 px-4 py-3 space-y-3 bg-white">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-semibold text-gray-500">指導日 <span className="text-amber-600">*</span></label>
                      <input type="date" value={session.date} onChange={e => updateSession(idx, { date: e.target.value })} className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg" />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-gray-500">講師名 <span className="text-amber-600">*</span></label>
                      <div className="mt-1 flex gap-1">
                        <input value={session.teacherName} onChange={e => updateSession(idx, { teacherName: e.target.value })} placeholder="講師名" className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg" />
                        <button onClick={() => updateSession(idx, { teacherName: '山田' })} className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg border border-gray-200 whitespace-nowrap">自分</button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold text-gray-500">学校進度 <span className="text-amber-600">*</span> <span className="text-gray-400 font-normal ml-1">下の表で学校列をクリック</span></label>
                    <div className="mt-1 min-h-[32px] px-2 py-1.5 border border-gray-200 rounded-lg bg-gray-50 flex flex-wrap gap-1">
                      {schoolUnitsToday.length === 0
                        ? <span className="text-xs text-gray-400">下の表で学校列をクリックすると反映されます</span>
                        : schoolUnitsToday.map(u => <span key={u.id} className="px-2 py-0.5 text-[11px] bg-white border border-gray-200 rounded text-gray-700">{u.id} {u.label}</span>)
                      }
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold text-gray-500">指導単元 <span className="text-gray-400 font-normal ml-1">下の表で日付セルをクリック</span></label>
                    <div className="mt-1 min-h-[32px] px-2 py-1.5 border border-gray-200 rounded-lg bg-gray-50 flex flex-wrap gap-1">
                      {lessonUnitsThisSession.length === 0
                        ? <span className="text-xs text-gray-400">下の表で1回目/2回目/3回目をクリックすると反映されます</span>
                        : lessonUnitsThisSession.map(({ unit, col }) => (
                          <span key={unit.id} className="px-2 py-0.5 text-[11px] bg-white border border-gray-200 rounded text-gray-700">
                            {unit.id} {unit.label} <span className="text-gray-400">{col === 'lesson1' ? '1回目' : col === 'lesson2' ? '2回目' : '3回目'}</span>
                          </span>
                        ))
                      }
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold text-gray-500">引継ぎ <span className="text-amber-600">*</span></label>
                    <textarea value={session.handover} onChange={e => updateSession(idx, { handover: e.target.value })} placeholder="次の講師への引継ぎ事項" rows={2} className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg resize-none" />
                  </div>

                  <div className="flex items-center gap-6">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={session.homeworkNotDone} onChange={() => updateSession(idx, { homeworkNotDone: !session.homeworkNotDone })} className="w-4 h-4 rounded" />
                      <span className="text-sm text-gray-700">宿題未実施</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={session.tardy} onChange={() => updateSession(idx, { tardy: !session.tardy })} className="w-4 h-4 rounded" />
                      <span className="text-sm text-gray-700">遅刻</span>
                    </label>
                  </div>

                  {requiredMissing && (
                    <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded-lg">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />未入力の必須項目があります
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button onClick={addSession} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-[#1e3a5f] hover:text-[#1e3a5f] transition-colors">
        <Plus className="w-4 h-4" />もう1コマ追加（同日・同一生徒）
      </button>

      {/* 単元テーブル（日付セル直接クリック方式） */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-2 py-2 text-left w-12">#</th>
              <th className="px-2 py-2 text-left">単元名</th>
              <th className="px-2 py-2 text-left w-20">講習</th>
              <th className="px-2 py-2 text-center w-20">学校</th>
              <th className="px-2 py-2 text-center w-20">1回目</th>
              <th className="px-2 py-2 text-center w-20">2回目</th>
              <th className="px-2 py-2 text-center w-20">3回目</th>
            </tr>
          </thead>
          <tbody>
            {UNITS.map((u) => {
              const r = rows[u.id] ?? DEFAULT_ROW;
              const used = (['lesson1','lesson2','lesson3'] as ColKey[]).filter(k => r[k]).length;
              const remaining = Math.max(0, r.applied_lessons - used);
              const stampedThisSession = activeSession?.unitActions[u.id];
              return (
                <tr key={u.id} className={`border-b border-gray-100 ${
                  stampedThisSession ? 'bg-[#1e3a5f]/5' :
                  r.applied_lessons > 0 ? 'bg-amber-50/30' : 'hover:bg-gray-50'
                }`}>
                  <td className="px-2 py-2 text-gray-400">{u.id}</td>
                  <td className="px-2 py-2 font-medium">{u.label}</td>
                  <td className="px-2 py-2">
                    {r.applied_lessons > 0 ? (
                      <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded">
                        夏期{r.applied_lessons}{remaining > 0 ? ` 残${remaining}` : ''}
                      </span>
                    ) : <span className="text-gray-300">-</span>}
                  </td>
                  {(['school','lesson1','lesson2','lesson3'] as ColKey[]).map(k => {
                    const val = r[k];
                    const isToday = val === activeSession?.date;
                    return (
                      <td key={k} className="px-2 py-1 text-center">
                        <button
                          onClick={() => k === 'school' ? toggleSchool(u.id) : toggleDate(u.id, k)}
                          className={`w-full h-7 px-1 text-xs rounded transition-colors ${
                            isToday ? 'bg-[#1e3a5f] text-white font-medium' :
                            val ? 'bg-gray-100 text-gray-600' :
                            'text-gray-400 hover:bg-gray-100 border border-dashed border-gray-300'
                          }`}
                        >
                          {val ? fmtMd(val) : '+'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500">
        日付セルを直接クリックで入力/解除。今回のセッションで入力したものはハイライト表示。学校列/指導列をクリックするとセッションヘッダーに自動反映。
      </p>
    </div>
  );
}

function A_OverviewView() {
  interface FeedItem {
    id: string;
    student: string;
    grade: string;
    textbook: string;
    teacher: string;
    time: string;
    handover: string;
    homeworkNotDone: boolean;
    tardy: boolean;
    schoolUnits: string[];   // 学校が進んでいる単元
    lessonUnits: string[];   // 塾が指導した単元
  }

  const [filter, setFilter] = useState<'all' | 'alerts'>('all');

  const feed: FeedItem[] = [
    {
      id: 'f1', student: '田中 太郎', grade: '中2',
      textbook: '数学 一次方程式', teacher: '山田', time: '14:35',
      handover: '分数の計算で苦戦中。次回は復習から入ること。',
      homeworkNotDone: false, tardy: false,
      schoolUnits: ['1-0 ノートの使い方', '1-1 正負の数の加減', '1-2 かっこのついた数の加減'],
      lessonUnits: ['1-3 分数の加減 (1回目)', '1-4 正負の数の乗法 (1回目)'],
    },
    {
      id: 'f2', student: '鈴木 花子', grade: '中3',
      textbook: '英文法 中3', teacher: '佐々木', time: '13:10',
      handover: '関係代名詞that節の使い分けが曖昧。宿題は教科書p.52-53。',
      homeworkNotDone: true, tardy: false,
      schoolUnits: ['2-1 接続詞', '2-2 不定詞', '2-3 動名詞', '2-4 分詞', '2-5 関係代名詞（目的格）'],
      lessonUnits: ['3-1 関係代名詞（主格）(2回目)'],
    },
    {
      id: 'f3', student: '佐藤 次郎', grade: '中2',
      textbook: '数学 比例反比例', teacher: '田口', time: '13:05',
      handover: 'テスト前なので過去問演習を中心に。応用問題は解けている。',
      homeworkNotDone: false, tardy: true,
      schoolUnits: ['2-1 比例', '2-2 反比例', '2-3 比例のグラフ'],
      lessonUnits: ['2-4 反比例のグラフ (2回目)', '2-5 比例反比例の利用 (1回目)'],
    },
    {
      id: 'f4', student: '高橋 三郎', grade: '高2',
      textbook: '数学II', teacher: '山田', time: '11:30',
      handover: '微分の公式は理解できたが計算ミスが多い。演習量を増やす。',
      homeworkNotDone: false, tardy: false,
      schoolUnits: ['3-1 極限', '3-2 微分の定義', '3-3 導関数', '3-4 接線', '3-5 増減表', '3-6 極値'],
      lessonUnits: ['4-2 微分係数 (1回目)'],
    },
    {
      id: 'f5', student: '伊藤 美咲', grade: '中3',
      textbook: '理科 中3', teacher: '佐々木', time: '11:25',
      handover: 'イオンの概念は理解OK。次回から化学変化に入る。',
      homeworkNotDone: true, tardy: true,
      schoolUnits: ['5-1 水溶液とイオン'],
      lessonUnits: ['5-3 イオン (3回目)'],
    },
    {
      id: 'f6', student: '田中 太郎', grade: '中2',
      textbook: '数学 一次方程式', teacher: '田口', time: '昨日 16:20',
      handover: '1-1、1-2の復習完了。計算スピードが改善。',
      homeworkNotDone: false, tardy: false,
      schoolUnits: ['1-0 ノートの使い方', '1-1 正負の数の加減', '1-2 かっこのついた数の加減'],
      lessonUnits: ['1-1 正負の数の加減 (2回目)', '1-2 かっこのついた数の加減 (1回目)'],
    },
  ];

  const hasAlert = (item: FeedItem) => item.homeworkNotDone || item.tardy;
  const filtered = filter === 'alerts' ? feed.filter(hasAlert) : feed;

  return (
    <div className="space-y-3">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">指導記録フィード</span>
          <span className="text-xs text-gray-400">新しい順</span>
        </div>
        <div className="flex items-center gap-1">
          {(['all', 'alerts'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                filter === f ? 'bg-[#1e3a5f] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f === 'all' ? 'すべて' : '要注意のみ'}
            </button>
          ))}
        </div>
      </div>

      {/* フィード */}
      <div className="space-y-2">
        {filtered.map((item) => (
          <Link
            key={item.id}
            href={`/students/s1/progress`}
            className={`block p-4 rounded-xl border-2 transition-shadow cursor-pointer ${
              hasAlert(item)
                ? 'border-amber-400 bg-amber-50/40 hover:shadow-md'
                : 'border-gray-200 bg-white hover:shadow-sm'
            }`}
          >
            {/* 1行目 */}
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="text-sm font-semibold text-gray-900">{item.student}</span>
              <span className="text-xs text-gray-400">{item.grade} / {item.textbook}</span>
              <div className="flex-1" />
              {item.homeworkNotDone && <span className="px-1.5 py-0.5 text-[10px] bg-amber-200 text-amber-900 rounded font-medium">宿未</span>}
              {item.tardy && <span className="px-1.5 py-0.5 text-[10px] bg-amber-200 text-amber-900 rounded font-medium">遅刻</span>}
              <span className="text-[11px] text-gray-400">{item.teacher} {item.time}</span>
            </div>

            {/* 学校進度 vs 授業実施 比較 */}
            <div className="grid grid-cols-[40px_1fr] gap-x-2 gap-y-1 text-xs mb-2">
              <div className="text-[10px] font-semibold text-gray-400 py-0.5">学校</div>
              <div className="flex flex-wrap gap-1 py-0.5">
                {item.schoolUnits.map((u, i) => (
                  <span key={i} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px]">{u}</span>
                ))}
              </div>
              <div className="text-[10px] font-semibold text-[#1e3a5f] py-0.5">塾</div>
              <div className="flex flex-wrap gap-1 py-0.5">
                {item.lessonUnits.map((u, i) => (
                  <span key={i} className="px-1.5 py-0.5 bg-[#1e3a5f]/10 text-[#1e3a5f] rounded text-[10px] font-medium">{u}</span>
                ))}
              </div>
            </div>

            {/* 引継ぎ */}
            <div className="text-xs text-gray-600">
              <span className="text-gray-400 mr-1">引継ぎ:</span>{item.handover}
            </div>
          </Link>
        ))}
      </div>

      <p className="text-xs text-gray-500">
        クリックで生徒の進行表詳細へ。学校進度と塾の指導単元を上下で比較して遅れ/先取りを即把握。
      </p>
    </div>
  );
}

function A_CurriculumView() {
  const [tab, setTab] = useState<'curriculum' | 'list'>('curriculum');

  const INTENT_TAGS = ['苦手補強', '既習の定着', '未習の先取り', '学校進度に合わせる', '直前演習', '応用発展'] as const;
  type IntentTag = typeof INTENT_TAGS[number];

  const intentTagStyle = (tag: IntentTag) => {
    switch (tag) {
      case '苦手補強': return 'text-red-600 border-red-300';
      case '既習の定着': return 'text-[#1e3a5f] border-[#1e3a5f]/30';
      case '未習の先取り': return 'text-amber-700 border-amber-300';
      case '学校進度に合わせる': return 'text-gray-600 border-gray-300';
      case '直前演習': return 'text-orange-600 border-orange-300';
      case '応用発展': return 'text-emerald-700 border-emerald-300';
    }
  };

  // カリキュラム作成用の単元データ
  const currUnits = [
    { id: 'c1', label: '英語の語順', done: true, school: true },
    { id: 'c2', label: 'be動詞（現在形）', done: true, school: true },
    { id: 'c3', label: '一般動詞（現在形）', done: true, school: true },
    { id: 'c4', label: 'be動詞と一般動詞（現在形）', done: true, school: true },
    { id: 'c5', label: 'be動詞と一般動詞（過去形）', done: true, school: false },
    { id: 'c6', label: '疑問詞', done: false, school: false },
    { id: 'c7', label: '1〜6章のまとめ', done: false, school: false },
    { id: 'c8', label: '人称代名詞', done: false, school: false },
    { id: 'c9', label: '命令文', done: false, school: false },
    { id: 'c10', label: '進行形', done: false, school: false },
    { id: 'c11', label: 'there is 〜 の文', done: false, school: false },
    { id: 'c12', label: '未来の文', done: false, school: false },
    { id: 'c13', label: '助動詞', done: false, school: false },
    { id: 'c14', label: '7〜12章のまとめ', done: false, school: false },
    { id: 'c15', label: '接続詞', done: false, school: false },
    { id: 'c16', label: '不定詞①', done: false, school: false },
    { id: 'c17', label: '動名詞', done: false, school: false },
  ];

  const [allocations, setAllocations] = useState<Record<string, number>>({
    c6: 1, c7: 0, c8: 0, c9: 0, c10: 1, c11: 0, c12: 1, c13: 0, c14: 1, c15: 0, c16: 1, c17: 1,
  });
  const [intents, setIntents] = useState<Record<string, IntentTag>>({
    c6: '苦手補強', c10: '未習の先取り', c12: '未習の先取り', c16: '応用発展',
  });
  const [intentDropdown, setIntentDropdown] = useState<string | null>(null);

  // グループ: Set of unit ids that are "linked down" to the next row
  // e.g., groups has 'c6' means c6 and c7 form a group
  const [groupLinks, setGroupLinks] = useState<Set<string>>(new Set(['c6']));

  // Build resolved groups: each group is a contiguous run of units linked together
  const resolvedGroups = useMemo(() => {
    const groups: string[][] = [];
    let i = 0;
    while (i < currUnits.length) {
      const group = [currUnits[i].id];
      while (i < currUnits.length - 1 && groupLinks.has(currUnits[i].id)) {
        i++;
        group.push(currUnits[i].id);
      }
      groups.push(group);
      i++;
    }
    return groups;
  }, [groupLinks]);

  // Map each unit id to its group
  const unitToGroup = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const g of resolvedGroups) {
      for (const id of g) map[id] = g;
    }
    return map;
  }, [resolvedGroups]);

  // For a group, the leader is the first unit
  const isGroupLeader = (id: string) => {
    const g = unitToGroup[id];
    return g && g[0] === id;
  };

  const isInGroup = (id: string) => {
    const g = unitToGroup[id];
    return g && g.length > 1;
  };

  const isGroupFollower = (id: string) => {
    const g = unitToGroup[id];
    return g && g.length > 1 && g[0] !== id;
  };

  const getGroupAlloc = (id: string) => {
    const g = unitToGroup[id];
    if (!g || g.length <= 1) return allocations[id] ?? 0;
    // Group shares the leader's allocation
    return allocations[g[0]] ?? 0;
  };

  const setAlloc = (id: string, v: number) => {
    const g = unitToGroup[id];
    const leaderId = g && g.length > 1 ? g[0] : id;
    setAllocations(prev => ({ ...prev, [leaderId]: Math.max(0, Math.min(5, v)) }));
  };

  const toggleGroupLink = (id: string) => {
    setGroupLinks(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Total koma: for grouped units, only count the leader's allocation
  const totalKoma = useMemo(() => {
    let sum = 0;
    for (const g of resolvedGroups) {
      sum += allocations[g[0]] ?? 0;
    }
    return sum;
  }, [resolvedGroups, allocations]);

  const setIntent = (id: string, tag: IntentTag) => {
    setIntents(prev => ({ ...prev, [id]: tag }));
    setIntentDropdown(null);
  };

  const _cycleIntent = (id: string) => {
    const current = intents[id];
    if (!current) {
      setIntents(prev => ({ ...prev, [id]: INTENT_TAGS[0] }));
    } else {
      const idx = INTENT_TAGS.indexOf(current);
      const next = INTENT_TAGS[(idx + 1) % INTENT_TAGS.length];
      setIntents(prev => ({ ...prev, [id]: next }));
    }
  };

  const clearIntent = (id: string) => {
    setIntents(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  // 生徒一覧データ
  const students = [
    { id: 's1', name: '田中 太郎', grade: '中2', textbook: '英文法 中2', koma: 5, status: '提案済' as const },
    { id: 's2', name: '鈴木 花子', grade: '中3', textbook: '英文法 中3', koma: 6, status: '申込済' as const },
    { id: 's3', name: '佐藤 次郎', grade: '中2', textbook: '数学 比例反比例', koma: 8, status: '未作成' as const },
    { id: 's4', name: '高橋 三郎', grade: '高2', textbook: '数学II', koma: 0, status: '未作成' as const },
    { id: 's5', name: '伊藤 美咲', grade: '中3', textbook: '理科 中3', koma: 4, status: '作成中' as const },
  ];

  const statusStyle = (s: string) => {
    if (s === '申込済') return 'bg-[#1e3a5f] text-white';
    if (s === '提案済') return 'bg-[#1e3a5f]/10 text-[#1e3a5f]';
    if (s === '作成中') return 'bg-amber-100 text-amber-800';
    return 'bg-gray-100 text-gray-500';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
          {[{ k: 'curriculum' as const, l: 'カリキュラム作成' }, { k: 'list' as const, l: '生徒一覧' }].map(t => (
            <button key={t.k} onClick={() => setTab(t.k)} className={`px-3 py-1 rounded-md text-xs font-medium ${tab === t.k ? 'bg-white shadow-sm text-[#1e3a5f]' : 'text-gray-600'}`}>{t.l}</button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>夏期講習 2026</span>
        </div>
      </div>

      {tab === 'curriculum' && (
        <div className="space-y-4">
          {/* 生徒・テキスト選択 */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-semibold text-gray-500">生徒</label>
              <select className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg">
                <option>田中 太郎（中2）</option>
                <option>鈴木 花子（中3）</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-gray-500">テキスト</label>
              <select className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg">
                <option>英文法 中2（通常と同じ）</option>
                <option>夏期講習 英語 中2（別テキスト）</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-gray-500">テンプレート</label>
              <select className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg">
                <option>テンプレから読込</option>
                <option>中2英語 標準</option>
                <option>中2英語 弱点集中</option>
              </select>
            </div>
          </div>

          {/* 合計サマリ — Change 1: 割当単元 removed */}
          <div className="flex items-center gap-4 p-3 bg-gray-50 rounded-xl border border-gray-200">
            <div>
              <div className="text-[10px] text-gray-500">合計コマ数</div>
              <div className="text-2xl font-bold text-[#1e3a5f]">{totalKoma}</div>
            </div>
            <div className="flex-1" />
            <button className="px-4 py-2 text-xs bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2c4f7c]">提案資料を作成</button>
          </div>

          {/* 単元×回数テーブル */}
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-1 py-2 text-center w-8"></th>
                  <th className="px-3 py-2 text-left">単元</th>
                  <th className="px-3 py-2 text-center w-16">通常進捗</th>
                  <th className="px-3 py-2 text-center w-16">学校</th>
                  <th className="px-3 py-2 text-center w-24">回数</th>
                  <th className="px-3 py-2 text-left w-40">指導意図</th>
                </tr>
              </thead>
              <tbody>
                {currUnits.map((u, idx) => {
                  const alloc = getGroupAlloc(u.id);
                  const inGroup = isInGroup(u.id);
                  const leader = isGroupLeader(u.id);
                  const follower = isGroupFollower(u.id);
                  const group = unitToGroup[u.id];
                  const groupSize = group ? group.length : 1;
                  // Whether this unit can be linked to the next (both must be not done and next exists)
                  const nextUnit = idx < currUnits.length - 1 ? currUnits[idx + 1] : null;
                  const canLinkDown = !u.done && nextUnit && !nextUnit.done;
                  const isLinkedDown = groupLinks.has(u.id);
                  // For the group bracket: determine position within group
                  const groupIdx = group ? group.indexOf(u.id) : 0;
                  const isGroupFirst = groupIdx === 0;
                  const isGroupLast = group ? groupIdx === group.length - 1 : true;

                  return (
                    <tr key={u.id} className={`border-b border-gray-100 ${alloc > 0 ? 'bg-[#1e3a5f]/5' : ''}`}>
                      {/* Group bracket column */}
                      <td className="px-0 py-0 relative w-8">
                        {inGroup && (
                          <div className="absolute left-2 top-0 bottom-0 flex items-stretch">
                            <div className={`w-[3px] bg-[#1e3a5f]/30 ${isGroupFirst ? 'rounded-t-full mt-2' : ''} ${isGroupLast ? 'rounded-b-full mb-2' : ''}`} />
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 font-medium">
                        <div className="flex items-center gap-1">
                          <span>{u.label}</span>
                          {inGroup && leader && (
                            <span className="text-[9px] text-[#1e3a5f]/60 ml-1">{groupSize}単元/1コマ</span>
                          )}
                        </div>
                        {/* Group link button between this row and next */}
                        {canLinkDown && (
                          <div className="flex items-center mt-1 -mb-1">
                            <button
                              onClick={() => toggleGroupLink(u.id)}
                              className={`flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full border transition-colors ${
                                isLinkedDown
                                  ? 'border-[#1e3a5f]/30 bg-[#1e3a5f]/10 text-[#1e3a5f]'
                                  : 'border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-500'
                              }`}
                            >
                              <Plus className="w-2.5 h-2.5" />
                              {isLinkedDown ? 'グループ解除' : 'グループ化'}
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {u.done ? <Check className="w-4 h-4 text-[#1e3a5f] mx-auto" /> : <span className="text-gray-300">-</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {u.school ? <Check className="w-4 h-4 text-gray-400 mx-auto" /> : <span className="text-gray-300">-</span>}
                      </td>
                      <td className="px-3 py-2">
                        {!u.done && !follower ? (
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => setAlloc(u.id, alloc - 1)} className="w-6 h-6 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm">-</button>
                            <span className={`w-8 text-center text-sm font-bold ${alloc > 0 ? 'text-[#1e3a5f]' : 'text-gray-300'}`}>{alloc}</span>
                            <button onClick={() => setAlloc(u.id, alloc + 1)} className="w-6 h-6 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm">+</button>
                          </div>
                        ) : follower ? (
                          <span className="text-[10px] text-gray-400 text-center block">--</span>
                        ) : (
                          <span className="text-gray-300 text-center block">-</span>
                        )}
                      </td>
                      {/* Change 2: Intent tag chip instead of text input */}
                      <td className="px-3 py-2 relative">
                        {alloc > 0 && !follower && (
                          <div className="relative">
                            {intents[u.id] ? (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => setIntentDropdown(intentDropdown === u.id ? null : u.id)}
                                  className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${intentTagStyle(intents[u.id])}`}
                                >
                                  {intents[u.id]}
                                </button>
                                <button
                                  onClick={() => clearIntent(u.id)}
                                  className="text-gray-300 hover:text-gray-500 text-[10px] leading-none"
                                  title="タグを外す"
                                >
                                  x
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setIntentDropdown(intentDropdown === u.id ? null : u.id)}
                                className="px-2 py-0.5 text-[10px] text-gray-400 border border-dashed border-gray-300 rounded-full hover:border-gray-400 hover:text-gray-500"
                              >
                                + 意図
                              </button>
                            )}
                            {intentDropdown === u.id && (
                              <div className="absolute z-10 top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[140px]">
                                {INTENT_TAGS.map(tag => (
                                  <button
                                    key={tag}
                                    onClick={() => setIntent(u.id, tag)}
                                    className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-gray-50 ${
                                      intents[u.id] === tag ? 'font-semibold bg-gray-50' : ''
                                    } ${intentTagStyle(tag).split(' ')[0]}`}
                                  >
                                    {tag}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'list' && (
        <div className="space-y-2">
          {students.map(s => (
            <div key={s.id} className="flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-200 hover:shadow-sm transition-shadow cursor-pointer">
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-900">{s.name} <span className="text-gray-400 font-normal">{s.grade}</span></div>
                <div className="text-xs text-gray-500">{s.textbook}</div>
              </div>
              {s.koma > 0 && <span className="text-sm font-bold text-[#1e3a5f]">{s.koma}コマ</span>}
              <span className={`px-2 py-0.5 text-[10px] rounded-full font-medium ${statusStyle(s.status)}`}>{s.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function A_ProposalView() {
  // 提案資料：印刷/PDF用

  // テーマ（編集可能）
  const [theme, setTheme] = useState('2学期の先取りと1学期の弱点補強');

  // テキスト全単元 — selected が講習対象
  const allUnits = [
    { id: '1-0', label: 'ノートの使い方', done: true, selected: false },
    { id: '1-1', label: '正負の数の加減', done: true, selected: false },
    { id: '1-2', label: 'かっこのついた数の加減', done: true, selected: false },
    { id: '1-3', label: '分数の加減', done: true, selected: false },
    { id: '1-4', label: '正負の数の乗法', done: true, selected: false },
    { id: '1-5', label: '除法', done: false, selected: false },
    { id: '1-6', label: '累乗', done: false, selected: false },
    { id: '1-7', label: '乗除と累乗の混じった計算', done: false, selected: false },
    { id: '1-8', label: '四則の混じった計算', done: false, selected: false },
    { id: '2-1', label: '文字式のきまり', done: false, selected: true, koma: 1, reason: '1学期の弱点。テストで失点が多い。' },
    { id: '2-2', label: '文字式の計算', done: false, selected: true, koma: 1, reason: '2-1と合わせて定着させる。' },
    { id: '2-3', label: '一次方程式', done: false, selected: true, koma: 2, reason: '2学期最重要単元の先取り。' },
    { id: '3-1', label: '一次方程式の利用', done: false, selected: true, koma: 1, reason: '文章題の演習。応用力UP。' },
    { id: '3-2', label: '比例', done: false, selected: true, koma: 1, reason: '2学期後半の先取り。' },
    { id: '3-3', label: '反比例', done: false, selected: false },
    { id: '3-4', label: '比例・反比例の利用', done: false, selected: false },
    { id: '4-1', label: '平面図形', done: false, selected: false },
  ];

  const selectedUnits = allUnits.filter((u) => u.selected);
  const totalKoma = selectedUnits.reduce((a, b) => a + (b.koma ?? 0), 0);
  const doneCount = allUnits.filter((u) => u.done).length;

  return (
    <div className="max-w-2xl mx-auto space-y-5 print:space-y-4">
      {/* ヘッダー */}
      <div className="p-5 bg-[#1e3a5f] text-white rounded-2xl print:rounded-none print:bg-white print:text-black print:border-b-2 print:border-[#1e3a5f]">
        <div className="text-lg font-bold">夏期講習のご提案</div>
        <div className="text-sm mt-1 opacity-90 print:opacity-100">田中 太郎 さま（中2）・ 英文法 中2</div>
      </div>

      {/* テーマ */}
      <section className="p-4 bg-white rounded-xl border border-gray-200">
        <h2 className="text-sm font-bold text-gray-900 mb-2">講習テーマ</h2>
        <input
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f] print:border-none print:p-0 print:ring-0"
          placeholder="例: 2学期の先取りと弱点補強"
        />
        <p className="text-[10px] text-gray-400 mt-1 print:hidden">
          保護者に見せる提案書のメインテーマ
        </p>
      </section>

      {/* 現状の分析 */}
      <section className="p-4 bg-white rounded-xl border border-gray-200">
        <h2 className="text-sm font-bold text-gray-900 mb-3">現在の学習状況</h2>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="p-3 bg-gray-50 rounded-lg text-center">
            <div className="text-[10px] text-gray-500">テキスト進捗</div>
            <div className="text-xl font-bold text-gray-800">{doneCount}<span className="text-xs font-normal">/{allUnits.length}単元</span></div>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg text-center">
            <div className="text-[10px] text-gray-500">学校進度</div>
            <div className="text-xl font-bold text-gray-800">4<span className="text-xs font-normal">単元</span></div>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg text-center">
            <div className="text-[10px] text-gray-500">塾の先取り</div>
            <div className="text-xl font-bold text-[#1e3a5f]">+1<span className="text-xs font-normal">単元</span></div>
          </div>
        </div>
        <p className="text-xs text-gray-600">
          通常授業で基礎部分は順調に進んでいます。2学期に入ると一次方程式など難易度の高い単元が続きます。夏休みの講習で先取りと弱点補強を行います。
        </p>
      </section>

      {/* 全単元一覧 — 講習対象をハイライト */}
      <section className="p-4 bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-900">テキスト全単元と講習対象</h2>
          <span className="text-sm font-bold text-[#1e3a5f]">講習 {totalKoma}コマ / {selectedUnits.length}単元</span>
        </div>
        <table className="w-full text-xs">
          <thead className="border-b border-gray-200">
            <tr>
              <th className="py-2 text-left font-semibold text-gray-500 w-8">#</th>
              <th className="py-2 text-left font-semibold text-gray-500">単元</th>
              <th className="py-2 text-center w-14 font-semibold text-gray-500">状況</th>
              <th className="py-2 text-center w-12 font-semibold text-gray-500">コマ</th>
              <th className="py-2 text-left font-semibold text-gray-500">講習で扱う理由</th>
            </tr>
          </thead>
          <tbody>
            {allUnits.map((u) => {
              const isTarget = u.selected;
              return (
                <tr
                  key={u.id}
                  className={
                    isTarget
                      ? 'bg-[#1e3a5f]/5 border-b border-[#1e3a5f]/10'
                      : 'border-b border-gray-50'
                  }
                >
                  <td className="py-2 text-gray-400 font-mono text-[10px]">{u.id}</td>
                  <td className={`py-2 ${isTarget ? 'font-bold text-[#1e3a5f]' : u.done ? 'text-gray-400 line-through' : 'text-gray-600'}`}>
                    {u.label}
                  </td>
                  <td className="py-2 text-center">
                    {u.done ? (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-400">
                        <Check className="w-3 h-3" />済
                      </span>
                    ) : isTarget ? (
                      <span className="px-1.5 py-0.5 bg-[#1e3a5f] text-white text-[10px] font-bold rounded">講習</span>
                    ) : (
                      <span className="text-[10px] text-gray-300">--</span>
                    )}
                  </td>
                  <td className="py-2 text-center font-bold text-[#1e3a5f]">
                    {isTarget ? u.koma : ''}
                  </td>
                  <td className={`py-2 ${isTarget ? 'text-gray-700' : 'text-gray-300'}`}>
                    {isTarget && 'reason' in u ? u.reason : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* 到達見通し（1行でシンプルに） */}
      <section className="p-4 bg-gray-50 rounded-xl border border-gray-200">
        <div className="flex items-center gap-3">
          <div className="text-sm text-gray-500">講習後の見通し:</div>
          <div className="text-sm font-bold text-[#1e3a5f]">
            {doneCount}単元完了 → {doneCount + selectedUnits.length}単元完了（2学期中盤まで先取り）
          </div>
        </div>
      </section>

      <div className="flex gap-2 print:hidden">
        <button className="flex-1 px-4 py-2.5 bg-[#1e3a5f] text-white rounded-xl text-sm font-medium hover:bg-[#2c4f7c]">印刷する</button>
        <button className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 border border-gray-200">PDFで保存</button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// コンセプト B: 根本見直し
// ════════════════════════════════════════════════════════════════

// ① 講師UI: Kanban（カードを進める）
function B_TeacherView({ rows, setRows }: { rows: Record<string, RowState>; setRows: (fn: (prev: Record<string, RowState>) => Record<string, RowState>) => void }) {
  const [sessionDate] = useState(todayIso());
  const [handover, setHandover] = useState('');
  const [teacher, setTeacher] = useState('山田');

  const stageOf = (r: RowState): 'todo'|'l1'|'l2'|'done' => {
    if (r.lesson3) return 'done';
    if (r.lesson2) return 'l2';
    if (r.lesson1) return 'l1';
    return 'todo';
  };

  const advance = (id: string) => {
    setRows((prev) => {
      const r = prev[id];
      if (!r.lesson1) return { ...prev, [id]: { ...r, lesson1: sessionDate } };
      if (!r.lesson2) return { ...prev, [id]: { ...r, lesson2: sessionDate } };
      if (!r.lesson3) return { ...prev, [id]: { ...r, lesson3: sessionDate } };
      return prev;
    });
  };

  const stages = [
    { key: 'todo', label: '未着手',   color: 'bg-gray-100 text-gray-600',   ring: 'ring-gray-200' },
    { key: 'l1',   label: '1回目済',  color: 'bg-blue-100 text-blue-700',   ring: 'ring-blue-200' },
    { key: 'l2',   label: '2回目済',  color: 'bg-indigo-100 text-indigo-700',ring: 'ring-indigo-200' },
    { key: 'done', label: '完了',     color: 'bg-emerald-100 text-emerald-700', ring: 'ring-emerald-200' },
  ] as const;

  const todayDoneCount = UNITS.filter((u) => {
    const r = rows[u.id];
    return r.lesson1 === sessionDate || r.lesson2 === sessionDate || r.lesson3 === sessionDate;
  }).length;

  return (
    <div>
      {/* セッションヘッダー（常駐） */}
      <div className="mb-4 p-4 bg-gradient-to-br from-fuchsia-50 to-purple-50 border border-fuchsia-200 rounded-2xl">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-[10px] text-fuchsia-700 uppercase tracking-wider">今日のセッション</div>
            <div className="text-2xl font-bold text-fuchsia-900">{sessionDate.replace(/-/g,'/')}</div>
          </div>
          <div className="flex-1 grid grid-cols-2 gap-2 min-w-[280px]">
            <input value={teacher} onChange={(e)=>setTeacher(e.target.value)} placeholder="講師名" className="px-2 py-1.5 text-sm border border-fuchsia-200 rounded-lg bg-white" />
            <input value={handover} onChange={(e)=>setHandover(e.target.value)} placeholder="今日の引継ぎ（1日1回）" className="px-2 py-1.5 text-sm border border-fuchsia-200 rounded-lg bg-white" />
          </div>
          <div className="px-3 py-1.5 bg-white rounded-lg border border-fuchsia-200">
            <div className="text-[10px] text-fuchsia-600">今日進めた</div>
            <div className="text-lg font-bold text-fuchsia-900">{todayDoneCount} <span className="text-xs font-normal">単元</span></div>
          </div>
        </div>
        <p className="mt-2 text-[10px] text-fuchsia-700">
          💡 単元カードの「→ 進める」ボタンで未→1→2→3に進行。日付は自動で記録（上の日付）。
        </p>
      </div>

      {/* Kanban */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {stages.map((stage) => {
          const items = UNITS.filter((u) => stageOf(rows[u.id] ?? DEFAULT_ROW) === stage.key);
          return (
            <div key={stage.key} className="flex flex-col bg-gray-50 rounded-2xl border border-gray-200 min-h-[400px]">
              <div className="p-3 border-b border-gray-200 flex items-center justify-between">
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${stage.color}`}>{stage.label}</span>
                <span className="text-xs text-gray-500">{items.length}件</span>
              </div>
              <div className="p-2 space-y-2 flex-1">
                {items.length === 0 && <p className="text-center text-xs text-gray-400 py-8">なし</p>}
                {items.map((u) => {
                  const r = rows[u.id] ?? DEFAULT_ROW;
                  const dates = [r.lesson1, r.lesson2, r.lesson3].filter(Boolean) as string[];
                  return (
                    <div key={u.id} className={`p-2.5 bg-white rounded-xl ring-1 ${stage.ring} hover:shadow-md transition-shadow duration-150`}>
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] text-gray-400">{u.id}</div>
                          <div className="text-xs font-medium truncate">{u.label}</div>
                        </div>
                        {r.applied_lessons > 0 && (
                          <span className="px-1 py-0.5 bg-amber-100 text-amber-800 text-[9px] font-bold rounded">夏{r.applied_lessons}</span>
                        )}
                      </div>
                      {dates.length > 0 && (
                        <div className="flex flex-wrap gap-0.5 mb-1.5">
                          {dates.map((d, i) => (
                            <span key={i} className="px-1 py-0.5 bg-blue-50 text-blue-700 text-[9px] rounded">{i+1}:{fmtMd(d)}</span>
                          ))}
                        </div>
                      )}
                      {stage.key !== 'done' && (
                        <button
                          onClick={() => advance(u.id)}
                          className="w-full px-2 py-1 text-[10px] font-medium bg-fuchsia-600 text-white rounded hover:bg-fuchsia-700 transition-colors duration-150 flex items-center justify-center gap-1"
                        >
                          進める <ArrowRight className="w-2.5 h-2.5" />
                        </button>
                      )}
                      {stage.key === 'done' && (
                        <div className="text-center text-[10px] text-emerald-700 font-medium">
                          <Check className="w-3 h-3 inline" /> 完了
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-gray-500">
        💡 Excel から完全脱却。1コマで4単元やったら、4枚のカードを「→進める」で右に流すだけ。日付は自動。
      </p>
    </div>
  );
}

// ② 教室長 普段使い: Triage Inbox
function B_OverviewView() {
  const [filter, setFilter] = useState<'all'|'urgent'|'mid'>('all');
  const items = [
    { id: 1, urgency: 'urgent' as const, student: '高橋 三郎', grade: '高2', icon: <AlertTriangle className="w-4 h-4" />, title: '目標が3週間未設定', detail: '直近の定期テストの目標が未設定。次回 5/12。', time: '30分前', actions: ['進行表で設定','面談を予約','保護者に連絡'] },
    { id: 2, urgency: 'urgent' as const, student: '鈴木 花子', grade: '中3', icon: <Zap className="w-4 h-4" />, title: '塾が学校に追いつかれた', detail: '英文法 中3：学校が4/25に到達、塾の最終指導は4/15で 10日遅延。', time: '2時間前', actions: ['進行表を確認','講師に共有'] },
    { id: 3, urgency: 'mid' as const, student: '佐藤 次郎', grade: '中2', icon: <Calendar className="w-4 h-4" />, title: 'テスト6日前', detail: '比例反比例：5/5 中間テスト。達成率80%、追い込み可能。', time: '今朝', actions: ['対策追加','スケジュール調整'] },
    { id: 4, urgency: 'mid' as const, student: '伊藤 美咲', grade: '中3', icon: <MessageSquare className="w-4 h-4" />, title: '宿題未実施が3回連続', detail: '直近3コマすべて宿題未実施。原因確認が必要かも。', time: '昨日', actions: ['面談を予約','保護者に連絡'] },
  ];
  const filtered = filter === 'all' ? items : items.filter((i) => i.urgency === filter);
  const urgencyClass = (u: 'urgent'|'mid') => u === 'urgent'
    ? 'border-l-4 border-red-500 bg-red-50/30'
    : 'border-l-4 border-amber-400 bg-amber-50/20';
  const iconBg = (u: 'urgent'|'mid') => u === 'urgent' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700';

  return (
    <div className="space-y-4">
      {/* 検索＋フィルタ */}
      <div className="flex items-center gap-2 p-3 bg-white rounded-xl border border-gray-200">
        <Inbox className="w-5 h-5 text-fuchsia-700" />
        <span className="text-sm font-semibold">対応すべき件 {filtered.length}</span>
        <div className="flex-1" />
        {(['all','urgent','mid'] as const).map((f) => (
          <button key={f} onClick={()=>setFilter(f)} className={`px-2.5 py-1 text-xs rounded-full transition-colors duration-150 ${filter===f?'bg-fuchsia-700 text-white':'bg-gray-100 text-gray-600'}`}>
            {f==='all'?'すべて':f==='urgent'?'緊急のみ':'中程度のみ'}
          </button>
        ))}
      </div>

      {/* インボックス */}
      <div className="space-y-2">
        {filtered.map((it) => (
          <div key={it.id} className={`p-4 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow duration-150 ${urgencyClass(it.urgency)}`}>
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg shrink-0 ${iconBg(it.urgency)}`}>{it.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{it.title}</span>
                  <span className="text-xs text-gray-500">{it.student}（{it.grade}）</span>
                  <span className="ml-auto text-[10px] text-gray-400">{it.time}</span>
                </div>
                <p className="text-xs text-gray-600 mt-1">{it.detail}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {it.actions.map((a) => (
                    <button key={a} className="px-2.5 py-1 text-[11px] bg-gray-50 hover:bg-fuchsia-50 hover:text-fuchsia-700 border border-gray-200 hover:border-fuchsia-300 rounded-full transition-colors duration-150">
                      {a}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="p-6 bg-emerald-50 border border-emerald-200 rounded-xl text-center">
        <Check className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
        <p className="text-sm font-semibold text-emerald-900">他は全員順調です</p>
        <p className="text-xs text-emerald-700">対応事項のみ表示する設計。順調な生徒の情報は隠して認知負荷を減らします。</p>
      </div>

      <p className="text-xs text-gray-500">
        💡 ダッシュボードを捨ててメール風受信トレイに。AI が優先度順に並べ、ワンタップで次のアクションへ。
      </p>
    </div>
  );
}

// ③ 教室長 講習: Pipeline（提案 Kanban）
function B_CurriculumView() {
  type Stage = 'draft'|'sent'|'approved'|'inprogress'|'done';
  const [proposals, setProposals] = useState([
    { id: 'p1', stage: 'draft' as Stage,      student: '田中 太郎', grade: '中2', lessons: 5, amount: 17500 },
    { id: 'p2', stage: 'draft' as Stage,      student: '伊藤 美咲', grade: '中3', lessons: 4, amount: 14000 },
    { id: 'p3', stage: 'sent' as Stage,       student: '鈴木 花子', grade: '中3', lessons: 6, amount: 21000 },
    { id: 'p4', stage: 'approved' as Stage,   student: '佐藤 次郎', grade: '中2', lessons: 8, amount: 28000 },
    { id: 'p5', stage: 'inprogress' as Stage, student: '山本 健太', grade: '中3', lessons: 6, amount: 21000 },
    { id: 'p6', stage: 'done' as Stage,       student: '木村 葵',   grade: '中2', lessons: 4, amount: 14000 },
  ]);

  const stages: { key: Stage; label: string; color: string; bg: string }[] = [
    { key: 'draft',      label: '下書き',     color: 'text-gray-700',    bg: 'bg-gray-100' },
    { key: 'sent',       label: '送付済',     color: 'text-blue-700',    bg: 'bg-blue-100' },
    { key: 'approved',   label: '承認',       color: 'text-emerald-700', bg: 'bg-emerald-100' },
    { key: 'inprogress', label: '進行中',     color: 'text-fuchsia-700', bg: 'bg-fuchsia-100' },
    { key: 'done',       label: '完了',       color: 'text-slate-700',   bg: 'bg-slate-100' },
  ];

  const advance = (id: string) => {
    setProposals((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      const order: Stage[] = ['draft','sent','approved','inprogress','done'];
      const idx = order.indexOf(p.stage);
      return idx < order.length - 1 ? { ...p, stage: order[idx + 1] } : p;
    }));
  };

  const totalsByStage = (s: Stage) => {
    const list = proposals.filter((p) => p.stage === s);
    return { count: list.length, lessons: list.reduce((a,b)=>a+b.lessons,0), amount: list.reduce((a,b)=>a+b.amount,0) };
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">講習パイプライン</h2>
        <button className="px-3 py-1.5 text-xs bg-fuchsia-700 text-white rounded-lg hover:bg-fuchsia-800">
          <Plus className="w-3 h-3 inline mr-1" />新規提案
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {stages.map((stage) => {
          const items = proposals.filter((p) => p.stage === stage.key);
          const t = totalsByStage(stage.key);
          return (
            <div key={stage.key} className="bg-gray-50 rounded-xl border border-gray-200 min-h-[400px] flex flex-col">
              <div className={`p-2.5 border-b border-gray-200 ${stage.bg} rounded-t-xl`}>
                <div className={`text-xs font-bold ${stage.color}`}>{stage.label}</div>
                <div className="text-[10px] text-gray-600 mt-0.5">{t.count}件 / {t.lessons}コマ / ¥{t.amount.toLocaleString()}</div>
              </div>
              <div className="p-2 space-y-2 flex-1">
                {items.map((p) => (
                  <div key={p.id} className="p-2.5 bg-white rounded-lg border border-gray-200 hover:shadow-sm transition-shadow duration-150">
                    <div className="text-xs font-semibold">{p.student}</div>
                    <div className="text-[10px] text-gray-500">{p.grade} ・ {p.lessons}コマ</div>
                    <div className="text-xs font-medium text-gray-700 mt-1">¥{p.amount.toLocaleString()}</div>
                    {p.stage !== 'done' && (
                      <button onClick={() => advance(p.id)} className="mt-1.5 w-full px-1.5 py-0.5 text-[10px] bg-fuchsia-600 text-white rounded hover:bg-fuchsia-700">
                        次へ <ArrowRight className="w-2 h-2 inline" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-gray-500">
        💡 タブを捨ててカード化。各ステージのコマ数・売上ヘッダで全体俯瞰、カードを横に流すだけで運営完結。
      </p>
    </div>
  );
}

// ④ 保護者提案: Scenario Simulator
function B_ProposalView() {
  const [lessons, setLessons] = useState(5);
  const [intensity, setIntensity] = useState<'min'|'recommended'|'intensive'>('recommended');
  const presets = {
    min:         { lessons: 3, label: '最小プラン',   note: '苦手1単元だけサポート' },
    recommended: { lessons: 5, label: 'おすすめ',     note: '弱点+予習でバランス' },
    intensive:   { lessons: 8, label: '集中プラン',   note: '弱点克服+1学期予習完成' },
  };
  const unitPrice = 3500;
  const totalPrice = lessons * unitPrice;
  const expectedProgress = Math.min(100, 67 + lessons * 4);
  const expectedScore = Math.min(100, 55 + lessons * 3.5);

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="p-6 bg-gradient-to-br from-fuchsia-600 to-purple-700 text-white rounded-3xl">
        <div className="text-xs uppercase tracking-wider opacity-80">夏期講習プラン・シミュレーター</div>
        <div className="text-2xl font-bold mt-1">田中 太郎 さん（中2）</div>
        <div className="text-xs opacity-80 mt-2">スライダーで「コマ数」を動かすと、進捗・成績の予測が変わります。</div>
      </div>

      {/* スライダー */}
      <section className="p-6 bg-white rounded-3xl border border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-gray-700">コマ数</div>
          <div className="text-3xl font-bold text-fuchsia-700">{lessons}</div>
        </div>
        <input
          type="range"
          min="1"
          max="12"
          value={lessons}
          onChange={(e)=>setLessons(Number(e.target.value))}
          className="w-full accent-fuchsia-600"
        />
        <div className="flex justify-between text-[10px] text-gray-400 mt-1"><span>1コマ</span><span>6コマ</span><span>12コマ</span></div>

        {/* インタラクティブ予測 */}
        <div className="grid grid-cols-2 gap-3 mt-5">
          <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
            <div className="text-[10px] text-emerald-700 uppercase">予想達成率</div>
            <div className="text-2xl font-bold text-emerald-900">{expectedProgress}<span className="text-sm">%</span></div>
            <div className="bg-emerald-100 rounded-full h-1.5 mt-1.5 overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all duration-300 ease-out" style={{width:`${expectedProgress}%`}} />
            </div>
            <div className="text-[10px] text-emerald-700 mt-1">現状67% → +{expectedProgress-67}pt</div>
          </div>
          <div className="p-3 bg-blue-50 rounded-xl border border-blue-200">
            <div className="text-[10px] text-blue-700 uppercase">数学スコア予想</div>
            <div className="text-2xl font-bold text-blue-900">{Math.round(expectedScore)}<span className="text-sm">点</span></div>
            <div className="bg-blue-100 rounded-full h-1.5 mt-1.5 overflow-hidden">
              <div className="h-full bg-blue-500 transition-all duration-300 ease-out" style={{width:`${expectedScore}%`}} />
            </div>
            <div className="text-[10px] text-blue-700 mt-1">直近55点 → +{Math.round(expectedScore-55)}pt</div>
          </div>
        </div>

        <div className="mt-5 p-4 bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl border border-amber-200">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] text-amber-700 uppercase">合計費用</div>
              <div className="text-3xl font-bold text-amber-900">¥{totalPrice.toLocaleString()}</div>
            </div>
            <div className="text-right text-[10px] text-amber-700">
              <div>1コマ ¥{unitPrice.toLocaleString()}</div>
              <div className="text-amber-600">税込・サンプル</div>
            </div>
          </div>
        </div>
      </section>

      {/* プリセット */}
      <section>
        <div className="text-sm font-semibold text-gray-700 mb-2">それともプリセットから選ぶ</div>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(presets) as Array<keyof typeof presets>).map((k) => {
            const p = presets[k];
            const active = intensity === k;
            return (
              <button
                key={k}
                onClick={() => { setIntensity(k); setLessons(p.lessons); }}
                className={`p-3 rounded-2xl border-2 text-left transition-all duration-150 ${active ? 'border-fuchsia-500 bg-fuchsia-50 shadow-md scale-[1.02]' : 'border-gray-200 bg-white hover:border-fuchsia-200'}`}
              >
                <div className="text-xs font-bold text-gray-800">{p.label}</div>
                <div className="text-2xl font-bold text-fuchsia-700 mt-1">{p.lessons}<span className="text-xs">コマ</span></div>
                <div className="text-[10px] text-gray-500 mt-1">{p.note}</div>
              </button>
            );
          })}
        </div>
      </section>

      <button className="w-full px-4 py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-lg shadow-lg hover:shadow-xl transition-all duration-150">
        このプランで申込む
      </button>

      <p className="text-center text-xs text-gray-500">
        💡 静的な提案ではなく、保護者がスライダーで「もし◯コマ追加したら」を体感。納得感が違う。
      </p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// メイン
// ════════════════════════════════════════════════════════════════
export default function ProgressMockupPage() {
  const [concept, setConcept] = useState<'A'|'B'>('A');
  const [tab, setTab] = useState('teacher');
  const [rows, setRows] = useState<Record<string, RowState>>(() => ({ ...SEED_ROWS }));

  const compareRows = useMemo(() => ([
    { axis: 'パラダイム',     a: 'グリッド／ダッシュボード／フォーム／レポート', b: 'Kanban／Inbox／Pipeline／Simulator' },
    { axis: '①講師UI',        a: 'セッション単位（1コマ=1回）＋単元チップ', b: 'カードを右に流す。日付は自動' },
    { axis: '②教室長 普段',   a: '変更フィード（新着順）。引継/宿未/遅刻を簡易表記', b: '要対応のみ Inbox。順調者は隠す' },
    { axis: '③教室長 講習',   a: 'タブ切替フォーム', b: '5ステージ Kanban。カード横送り' },
    { axis: '④保護者提案',    a: 'スクロール1ページレポート', b: 'スライダーで予測を動かせる' },
    { axis: '学習コスト',     a: '低（既存運用そのまま）', b: '中〜高（新パラダイム）' },
    { axis: '入力スピード',   a: '中', b: '高（アクションが減る）' },
    { axis: '伝達力（保護者）',a: '中', b: '高（インタラクティブで納得感）' },
  ]), []);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center justify-between mb-4">
          <Link href="/students" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
            <ChevronLeft className="w-4 h-4 mr-1" />戻る
          </Link>
          <div className="text-xs text-gray-400">DB 書込なし・モック専用</div>
        </div>
        <h1 className="text-xl font-bold text-gray-900">進行表まわり：A vs B コンセプト比較</h1>
        <p className="text-sm text-gray-500 mt-1 mb-4">
          A は既存に近い改良版。B は脱・既存設計のラディカルなコンセプト。
        </p>

        <ConceptSwitch value={concept} onChange={(v)=>{ setConcept(v); setTab('teacher'); }} />

        <div className="mt-6">
          <TabNav active={tab} onChange={setTab} concept={concept} />

          <div className="space-y-4">
            {concept === 'A' && tab === 'teacher'    && <A_TeacherView rows={rows} setRows={setRows} />}
            {concept === 'A' && tab === 'overview'   && <A_OverviewView />}
            {concept === 'A' && tab === 'curriculum' && <A_CurriculumView />}
            {concept === 'A' && tab === 'proposal'   && <A_ProposalView />}

            {concept === 'B' && tab === 'teacher'    && <B_TeacherView rows={rows} setRows={setRows} />}
            {concept === 'B' && tab === 'overview'   && <B_OverviewView />}
            {concept === 'B' && tab === 'curriculum' && <B_CurriculumView />}
            {concept === 'B' && tab === 'proposal'   && <B_ProposalView />}
          </div>
        </div>

        {/* 比較表 */}
        <div className="mt-10 p-5 bg-white rounded-2xl border border-gray-200">
          <h2 className="text-sm font-bold mb-3">A vs B 比較</h2>
          <table className="w-full text-xs">
            <thead className="border-b border-gray-200">
              <tr>
                <th className="text-left py-2 w-32">観点</th>
                <th className="text-left py-2">A: 現実主義</th>
                <th className="text-left py-2">B: 根本見直し</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {compareRows.map((r, i) => (
                <tr key={i}>
                  <td className="py-2 font-medium text-gray-700">{r.axis}</td>
                  <td className="py-2 text-gray-600">{r.a}</td>
                  <td className="py-2 text-fuchsia-700">{r.b}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
              <div className="font-bold text-blue-900 mb-1">A を選ぶべきケース</div>
              <ul className="space-y-0.5 text-blue-800">
                <li>・現場の運用を変えたくない</li>
                <li>・素早くリリースしたい</li>
                <li>・ベテラン講師が多く既存のExcel感覚を維持したい</li>
              </ul>
            </div>
            <div className="p-3 bg-fuchsia-50 rounded-lg border border-fuchsia-200">
              <div className="font-bold text-fuchsia-900 mb-1">B を選ぶべきケース</div>
              <ul className="space-y-0.5 text-fuchsia-800">
                <li>・WEB アプリらしい体験で差別化したい</li>
                <li>・若手講師の入社時の学習コストを下げたい</li>
                <li>・保護者面談での説得力を上げたい</li>
                <li>・教室長の認知負荷を本気で減らしたい</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
