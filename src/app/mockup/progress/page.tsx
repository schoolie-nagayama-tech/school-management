'use client';

/**
 * 進行表 UI モック比較用ページ
 * /mockup/progress でアクセス。データは self-contained（DB アクセスなし）。
 *
 * 5パターン：
 *   1. Current  : 現状の Excel ライクな表
 *   2. Brush    : 日付ペン（ドラッグで一括塗り）
 *   3. Record   : 「指導記録モード」— ワンタップで今日を記入
 *   4. Bands    : 列順入替 + 進度ステータスバッジ
 *   5. Cards    : 非 Excel の単元カードビュー（最も大胆）
 */

import { useState } from 'react';
import { Calendar, ChevronLeft, Paintbrush, GraduationCap, BookOpen, Check } from 'lucide-react';
import Link from 'next/link';

// ─────────────────────── ダミーデータ ───────────────────────
const SEED_UNITS = [
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
  { id: '2-4', label: '比例と反比例' },
];

type ColKey = 'lesson1' | 'lesson2' | 'lesson3' | 'school';

interface RowState {
  lesson1: string | null;
  lesson2: string | null;
  lesson3: string | null;
  school: string | null;
  homework_not_done: boolean;
  tardy: boolean;
  handover: string;
  teacher: string;
}

const DEFAULT_ROW: RowState = {
  lesson1: null, lesson2: null, lesson3: null, school: null,
  homework_not_done: false, tardy: false, handover: '', teacher: '',
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const fmtMd = (d: string | null) => d ? d.replace(/^\d{4}-/, '').replace('-', '/') : '—';

// ─────────────────────── 共通: 比較ヘッダー ───────────────────────
function VariantSwitcher({ active, onChange }: { active: string; onChange: (v: string) => void }) {
  const variants = [
    { key: 'current', label: '① 現状' },
    { key: 'brush',   label: '② ペン入力（ドラッグ）' },
    { key: 'record',  label: '③ 指導記録モード' },
    { key: 'bands',   label: '④ 列入替＋ステータス' },
    { key: 'cards',   label: '⑤ カードビュー（脱Excel）' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-6 border-b border-gray-200 pb-3">
      {variants.map((v) => (
        <button
          key={v.key}
          onClick={() => onChange(v.key)}
          className={`px-3 py-1.5 rounded-full text-sm transition-all duration-150 ${
            active === v.key
              ? 'bg-[#1e3a5f] text-white shadow-sm'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────── ① 現状（再現） ───────────────────────
function VariantCurrent({ rows, setRows }: { rows: Record<string, RowState>; setRows: (fn: (prev: Record<string, RowState>) => Record<string, RowState>) => void }) {
  const setDate = (id: string, key: ColKey) => {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], [key]: prev[id][key] ? null : todayIso() } }));
  };
  const toggle = (id: string, key: 'homework_not_done' | 'tardy') => {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], [key]: !prev[id][key] } }));
  };
  const setHandover = (id: string, val: string) => {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], handover: val } }));
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-2 py-2 text-left">#</th>
            <th className="px-2 py-2 text-left">単元名</th>
            <th className="px-2 py-2 text-left w-24">学校進度</th>
            <th className="px-2 py-2 text-left w-24">1回目</th>
            <th className="px-2 py-2 text-left w-24">2回目</th>
            <th className="px-2 py-2 text-left w-24">3回目</th>
            <th className="px-2 py-2 text-left min-w-[120px]">引継ぎ</th>
            <th className="px-2 py-2 text-center w-12">宿題未</th>
            <th className="px-2 py-2 text-center w-12">遅刻</th>
            <th className="px-2 py-2 text-left w-20">講師名</th>
          </tr>
        </thead>
        <tbody>
          {SEED_UNITS.map((u) => {
            const r = rows[u.id] ?? DEFAULT_ROW;
            return (
              <tr key={u.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-2 py-2 text-gray-400">{u.id}</td>
                <td className="px-2 py-2">{u.label}</td>
                {(['school','lesson1','lesson2','lesson3'] as ColKey[]).map((k) => (
                  <td key={k} className="px-2 py-1">
                    <button
                      onClick={() => setDate(u.id, k)}
                      className={`w-full h-7 px-1 text-xs rounded transition-colors duration-150 ${r[k] ? 'bg-blue-50 text-blue-700' : 'text-gray-400 hover:bg-gray-100 border border-dashed border-gray-300'}`}
                    >
                      {r[k] ? fmtMd(r[k]) : '＋'}
                    </button>
                  </td>
                ))}
                <td className="px-2 py-1">
                  <input
                    type="text"
                    value={r.handover}
                    onChange={(e) => setHandover(u.id, e.target.value)}
                    placeholder="引継ぎメモ"
                    className="w-full h-7 px-1.5 text-xs border border-transparent hover:border-gray-200 focus:border-[#1e3a5f] focus:bg-white rounded outline-none"
                  />
                </td>
                <td className="px-2 py-1 text-center">
                  <input type="checkbox" checked={r.homework_not_done} onChange={() => toggle(u.id, 'homework_not_done')} className="w-4 h-4 accent-[#d97706]" />
                </td>
                <td className="px-2 py-1 text-center">
                  <input type="checkbox" checked={r.tardy} onChange={() => toggle(u.id, 'tardy')} className="w-4 h-4 accent-[#d97706]" />
                </td>
                <td className="px-2 py-1">
                  <span className="text-gray-400">講師</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────── ② ペン入力（ドラッグで一括） ───────────────────────
function VariantBrush({ rows, setRows }: { rows: Record<string, RowState>; setRows: (fn: (prev: Record<string, RowState>) => Record<string, RowState>) => void }) {
  const [activeCol, setActiveCol] = useState<ColKey>('lesson1');
  const [brushDate, setBrushDate] = useState(todayIso());
  const [isDragging, setIsDragging] = useState(false);

  const apply = (id: string) => {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], [activeCol]: brushDate } }));
  };

  return (
    <div>
      {/* ツールバー */}
      <div className="mb-3 flex flex-wrap items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
        <Paintbrush className="w-5 h-5 text-amber-700" />
        <span className="text-sm font-medium text-amber-900">日付ペン</span>
        <div className="flex items-center gap-1">
          {(['lesson1','lesson2','lesson3','school'] as ColKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setActiveCol(k)}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors duration-150 ${activeCol === k ? 'bg-[#1e3a5f] text-white' : 'bg-white text-gray-600 border border-gray-300'}`}
            >
              {k === 'school' ? '学校進度' : k === 'lesson1' ? '1回目' : k === 'lesson2' ? '2回目' : '3回目'}
            </button>
          ))}
        </div>
        <input
          type="date"
          value={brushDate}
          onChange={(e) => setBrushDate(e.target.value)}
          className="px-2 py-1 text-xs border border-amber-300 rounded bg-white"
        />
        <span className="text-xs text-amber-700">
          ↓ 行をクリックまたはドラッグでまとめて記入
        </span>
      </div>

      <div
        className="overflow-x-auto rounded-xl border border-gray-200 bg-white select-none"
        onMouseUp={() => setIsDragging(false)}
        onMouseLeave={() => setIsDragging(false)}
      >
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-2 py-2 text-left">#</th>
              <th className="px-2 py-2 text-left">単元名</th>
              <th className={`px-2 py-2 text-left w-24 ${activeCol==='school' ? 'bg-amber-100' : ''}`}>学校進度</th>
              <th className={`px-2 py-2 text-left w-24 ${activeCol==='lesson1' ? 'bg-amber-100' : ''}`}>1回目</th>
              <th className={`px-2 py-2 text-left w-24 ${activeCol==='lesson2' ? 'bg-amber-100' : ''}`}>2回目</th>
              <th className={`px-2 py-2 text-left w-24 ${activeCol==='lesson3' ? 'bg-amber-100' : ''}`}>3回目</th>
            </tr>
          </thead>
          <tbody>
            {SEED_UNITS.map((u) => {
              const r = rows[u.id] ?? DEFAULT_ROW;
              return (
                <tr
                  key={u.id}
                  className="border-b border-gray-100 hover:bg-amber-50 cursor-pointer"
                  onMouseDown={() => { setIsDragging(true); apply(u.id); }}
                  onMouseEnter={() => isDragging && apply(u.id)}
                >
                  <td className="px-2 py-2 text-gray-400">{u.id}</td>
                  <td className="px-2 py-2">{u.label}</td>
                  {(['school','lesson1','lesson2','lesson3'] as ColKey[]).map((k) => (
                    <td key={k} className={`px-2 py-2 text-center ${k===activeCol ? 'bg-amber-50/80' : ''}`}>
                      {r[k] ? <span className="text-blue-700">{fmtMd(r[k])}</span> : <span className="text-gray-300">—</span>}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        💡 1日4単元なら、1〜4行目をマウスでスーッと撫でるだけで全部に同じ日付が入ります。
      </p>
    </div>
  );
}

// ─────────────────────── ③ 指導記録モード（セッション中心） ───────────────────────
/**
 * 1回の指導を「1セッション」として扱う：
 *   - セッションヘッダー（必須）: 指導日 / 講師名 / 学校進度 / 引継ぎ
 *   - 単元行: チップを叩いた回（1/2/3）にセッション日付を埋める
 *   - 引継ぎは1日に1回書けばよい → 単元ごとには出さない
 */
function VariantRecord({ rows, setRows }: { rows: Record<string, RowState>; setRows: (fn: (prev: Record<string, RowState>) => Record<string, RowState>) => void }) {
  const [sessionDate, setSessionDate] = useState(todayIso());
  const [sessionTeacher, setSessionTeacher] = useState('');
  const [sessionHandover, setSessionHandover] = useState('');
  const [schoolReachedUnitId, setSchoolReachedUnitId] = useState<string>('');
  const [submitted, setSubmitted] = useState(false);

  const recordChip = (id: string, k: ColKey) => {
    if (!sessionDate) return;
    setRows((prev) => {
      const cur = prev[id]?.[k];
      // 同じセッション日付ならトグル取消、違う日付なら上書き
      const next = cur === sessionDate ? null : sessionDate;
      return {
        ...prev,
        [id]: {
          ...prev[id],
          [k]: next,
          // セッション講師名・引継ぎを単元行にも保持（編集モードで参照可）
          teacher: sessionTeacher || prev[id].teacher,
          handover: sessionHandover || prev[id].handover,
        },
      };
    });
  };

  // 「学校がここまで進んだ」セレクタ：その単元〜上のすべてに学校進度日を入れる（典型運用）
  const applySchoolReached = (unitId: string) => {
    if (!sessionDate || !unitId) return;
    const upToIndex = SEED_UNITS.findIndex((u) => u.id === unitId);
    if (upToIndex < 0) return;
    setRows((prev) => {
      const next = { ...prev };
      for (let i = 0; i <= upToIndex; i++) {
        const u = SEED_UNITS[i];
        if (!next[u.id].school) next[u.id] = { ...next[u.id], school: sessionDate };
      }
      return next;
    });
  };

  const requiredMissing = {
    date: !sessionDate,
    teacher: !sessionTeacher.trim(),
    school: !schoolReachedUnitId,
    handover: !sessionHandover.trim(),
  };
  const missingCount = Object.values(requiredMissing).filter(Boolean).length;

  // セッションで記録した単元を集計
  const recordedUnits = useMemoCounts(rows, sessionDate);

  const finalize = () => {
    setSubmitted(true);
    if (missingCount > 0) return;
    if (schoolReachedUnitId) applySchoolReached(schoolReachedUnitId);
    // demo: セッション内容をリセット
    alert(`セッション保存しました\n指導日 ${sessionDate}\n講師 ${sessionTeacher}\n学校進度 ~${SEED_UNITS.find(u=>u.id===schoolReachedUnitId)?.label}\n引継ぎ ${sessionHandover}\n記録単元 ${recordedUnits.length}件`);
  };

  return (
    <div>
      {/* ───────── セッションヘッダー（必須項目） ───────── */}
      <div className="mb-4 p-4 bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-700" />
            <span className="text-sm font-semibold text-blue-900">本日の指導セッション</span>
          </div>
          <span className="text-[11px] text-blue-700">
            必須 {Object.values(requiredMissing).filter((v)=>!v).length} / 4
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <FieldLabel label="指導日" required missing={submitted && requiredMissing.date}>
            <input
              type="date"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              className="w-full px-2.5 py-1.5 text-sm border border-blue-300 rounded-lg bg-white"
            />
          </FieldLabel>
          <FieldLabel label="講師名" required missing={submitted && requiredMissing.teacher}>
            <input
              type="text"
              value={sessionTeacher}
              onChange={(e) => setSessionTeacher(e.target.value)}
              placeholder="例：山田"
              className="w-full px-2.5 py-1.5 text-sm border border-blue-300 rounded-lg bg-white"
            />
          </FieldLabel>
          <FieldLabel label="学校進度（最後に進んだ単元）" required missing={submitted && requiredMissing.school}>
            <select
              value={schoolReachedUnitId}
              onChange={(e) => setSchoolReachedUnitId(e.target.value)}
              className="w-full px-2.5 py-1.5 text-sm border border-blue-300 rounded-lg bg-white"
            >
              <option value="">選択してください</option>
              {SEED_UNITS.map((u) => (
                <option key={u.id} value={u.id}>{u.id}　{u.label}</option>
              ))}
            </select>
          </FieldLabel>
          <FieldLabel label="引継ぎ（1日1回）" required missing={submitted && requiredMissing.handover}>
            <textarea
              value={sessionHandover}
              onChange={(e) => setSessionHandover(e.target.value)}
              placeholder="今日のセッション全体での引継ぎを1か所に書けば OK"
              className="w-full h-16 px-2.5 py-1.5 text-sm border border-blue-300 rounded-lg bg-white resize-y"
            />
          </FieldLabel>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[11px] text-blue-800">
            💡 引継ぎは <b>1日1回でOK</b>。単元ごとに書く必要はありません。
          </p>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-blue-700">記録した単元 {recordedUnits.length} 件</span>
            <button
              onClick={finalize}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors duration-150 ${missingCount > 0 ? 'bg-blue-200 text-blue-700' : 'bg-blue-700 text-white hover:bg-blue-800'}`}
            >
              {missingCount > 0 ? `必須あと${missingCount}項目` : 'セッションを確定'}
            </button>
          </div>
        </div>
      </div>

      {/* ───────── 単元リスト ───────── */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-gray-500">
            単元を 1回目／2回目／3回目 のチップでタップ → 上の指導日が入ります（同じ日付ならトグルで取消）
          </span>
        </div>
        {SEED_UNITS.map((u) => {
          const r = rows[u.id] ?? DEFAULT_ROW;
          const Chip = ({ k, label }: { k: ColKey; label: string }) => {
            const filled = !!r[k];
            const isThisSession = r[k] === sessionDate;
            return (
              <button
                onClick={() => recordChip(u.id, k)}
                disabled={!sessionDate}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-150 ${
                  isThisSession
                    ? 'bg-emerald-600 text-white scale-105 shadow-sm'
                    : filled
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200 disabled:opacity-50'
                }`}
                title={filled ? r[k] ?? '' : '未記入'}
              >
                {label}{filled && <span className="ml-1 opacity-80">{fmtMd(r[k])}</span>}
                {isThisSession && <Check className="inline w-3 h-3 ml-0.5" />}
              </button>
            );
          };
          // 学校進度のチップ = 上の picker で選んだ単元以下なら自動的に塗られる
          const schoolReached = !!r.school;
          return (
            <div
              key={u.id}
              className={`flex items-center gap-3 px-3 py-2 border rounded-lg transition-colors duration-150 ${
                recordedUnits.includes(u.id)
                  ? 'bg-emerald-50/60 border-emerald-200'
                  : 'bg-white border-gray-200 hover:border-gray-300'
              }`}
            >
              <span className="text-xs text-gray-400 w-10 shrink-0">{u.id}</span>
              <span className="text-sm font-medium flex-1 min-w-0 truncate">{u.label}</span>
              <div className="flex items-center gap-1 shrink-0">
                <Chip k="lesson1" label="1回目" />
                <Chip k="lesson2" label="2回目" />
                <Chip k="lesson3" label="3回目" />
                <span className="mx-1 w-px h-4 bg-gray-200" />
                <span
                  className={`px-2 py-1 rounded-full text-xs font-medium ${schoolReached ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-400'}`}
                  title={schoolReached ? `学校到達: ${r.school}` : '学校未到達'}
                >
                  学{schoolReached && <span className="ml-1 opacity-80">{fmtMd(r.school)}</span>}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-gray-500">
        💡 必須項目（指導日／講師／学校進度／引継ぎ）はヘッダーで1か所にまとめて入力。<br/>
        💡 単元ごとの「学校進度」セルは上の「学校進度（最後に進んだ単元）」から自動で塗られます。
      </p>
    </div>
  );
}

/** セッション日付に該当する単元 ID 一覧 */
function useMemoCounts(rows: Record<string, RowState>, sessionDate: string): string[] {
  const ids: string[] = [];
  for (const id of Object.keys(rows)) {
    const r = rows[id];
    if (r.lesson1 === sessionDate || r.lesson2 === sessionDate || r.lesson3 === sessionDate) {
      ids.push(id);
    }
  }
  return ids;
}

function FieldLabel({ label, required, missing, children }: { label: string; required?: boolean; missing?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-blue-900 mb-1">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
        {missing && <span className="ml-2 text-[10px] text-red-600">必須です</span>}
      </label>
      {children}
    </div>
  );
}

// ─────────────────────── ④ 列入替＋ステータスバッジ ───────────────────────
function VariantBands({ rows, setRows }: { rows: Record<string, RowState>; setRows: (fn: (prev: Record<string, RowState>) => Record<string, RowState>) => void }) {
  const setDate = (id: string, key: ColKey) => {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], [key]: prev[id][key] ? null : todayIso() } }));
  };
  const setHandover = (id: string, val: string) => {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], handover: val } }));
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-2 py-2 text-left">単元名</th>
            <th className="px-2 py-2 text-center w-32">塾の指導</th>
            <th className="px-2 py-2 text-left w-24">1回目</th>
            <th className="px-2 py-2 text-left w-24">2回目</th>
            <th className="px-2 py-2 text-left w-24">3回目</th>
            <th className="px-2 py-2 text-left w-24">学校進度</th>
            <th className="px-2 py-2 text-left min-w-[160px]">引継ぎ（focus で展開）</th>
          </tr>
        </thead>
        <tbody>
          {SEED_UNITS.map((u) => {
            const r = rows[u.id] ?? DEFAULT_ROW;
            const lessonCount = (['lesson1','lesson2','lesson3'] as ColKey[]).filter((k) => r[k]).length;
            const schoolDone = !!r.school;
            const ahead = lessonCount > 0 && !schoolDone;
            const behind = lessonCount === 0 && schoolDone;
            const statusBadge = behind
              ? { label: '塾未着手', cls: 'bg-red-100 text-red-700' }
              : ahead
                ? { label: `塾${lessonCount}回／学校未`, cls: 'bg-emerald-100 text-emerald-700' }
                : schoolDone
                  ? { label: `塾${lessonCount}回／学校到達`, cls: 'bg-blue-100 text-blue-700' }
                  : { label: '未着手', cls: 'bg-gray-100 text-gray-500' };
            return (
              <tr key={u.id} className={`border-b border-gray-100 ${behind ? 'bg-red-50/40' : 'hover:bg-gray-50'}`}>
                <td className="px-2 py-2">{u.label}</td>
                <td className="px-2 py-2 text-center">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${statusBadge.cls}`}>{statusBadge.label}</span>
                </td>
                {(['lesson1','lesson2','lesson3','school'] as ColKey[]).map((k) => (
                  <td key={k} className="px-2 py-1">
                    <button
                      onClick={() => setDate(u.id, k)}
                      className={`w-full h-7 px-1 text-xs rounded transition-colors duration-150 ${
                        r[k] ? (k === 'school' ? 'bg-purple-50 text-purple-700' : 'bg-blue-50 text-blue-700') : 'text-gray-400 hover:bg-gray-100 border border-dashed border-gray-300'
                      }`}
                    >
                      {r[k] ? fmtMd(r[k]) : '＋'}
                    </button>
                  </td>
                ))}
                <td className="px-2 py-1">
                  <ExpandingNote value={r.handover} onChange={(v) => setHandover(u.id, v)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="m-3 text-xs text-gray-500">
        💡 列順を「1回目→2回目→3回目→学校進度」に並べ替え、学校が塾を追い越した行は薄赤背景。引継ぎ欄は focus 時に textarea へ拡大。
      </p>
    </div>
  );
}

/** focus で textarea に展開する引継ぎメモ */
function ExpandingNote({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [focused, setFocused] = useState(false);
  return focused ? (
    <textarea
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => setFocused(false)}
      placeholder="引継ぎメモ（複数行 OK）"
      className="w-full h-20 px-2 py-1.5 text-xs border border-[#1e3a5f] focus:bg-white rounded outline-none resize-y"
    />
  ) : (
    <button
      onClick={() => setFocused(true)}
      className="w-full h-7 px-1.5 text-left text-xs border border-transparent hover:border-gray-200 rounded truncate"
    >
      {value || <span className="text-gray-400">引継ぎメモ（クリックで拡大）</span>}
    </button>
  );
}

// ─────────────────────── ⑤ カードビュー（脱 Excel） ───────────────────────
function VariantCards({ rows, setRows }: { rows: Record<string, RowState>; setRows: (fn: (prev: Record<string, RowState>) => Record<string, RowState>) => void }) {
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const recordLesson = (id: string) => {
    setRows((prev) => {
      const r = prev[id] ?? DEFAULT_ROW;
      // 空いている1回目→2回目→3回目に自動で日付を入れる
      const nextKey: ColKey = !r.lesson1 ? 'lesson1' : !r.lesson2 ? 'lesson2' : 'lesson3';
      return { ...prev, [id]: { ...r, [nextKey]: selectedDate } };
    });
  };
  const recordSchool = (id: string) => {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], school: selectedDate } }));
  };
  const undo = (id: string, k: ColKey) => {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], [k]: null } }));
  };

  return (
    <div>
      <div className="mb-4 p-4 bg-gradient-to-br from-slate-50 to-blue-50 border border-slate-200 rounded-2xl">
        <div className="flex items-center gap-3 flex-wrap">
          <Calendar className="w-5 h-5 text-slate-700" />
          <span className="text-sm font-medium text-slate-700">記入日付:</span>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-2 py-1 text-sm border border-slate-300 rounded bg-white"
          />
          <span className="text-xs text-slate-500">→ カードの「指導した」「学校で進んだ」をタップ</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {SEED_UNITS.map((u) => {
          const r = rows[u.id] ?? DEFAULT_ROW;
          const lessonDates = [r.lesson1, r.lesson2, r.lesson3].filter(Boolean) as string[];
          const lessonCount = lessonDates.length;
          const schoolDone = !!r.school;
          const ringClass = schoolDone && lessonCount === 0
            ? 'ring-2 ring-red-300'
            : lessonCount > 0 && !schoolDone
              ? 'ring-2 ring-emerald-300'
              : 'ring-1 ring-gray-200';
          return (
            <div key={u.id} className={`p-3 rounded-2xl bg-white ${ringClass} hover:shadow-md transition-all duration-150`}>
              {/* ヘッダー */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] text-gray-400">{u.id}</div>
                  <div className="text-sm font-semibold truncate">{u.label}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-2 h-2 rounded-full ${i < lessonCount ? 'bg-emerald-500' : 'bg-gray-200'}`}
                      title={`${i + 1}回目`}
                    />
                  ))}
                </div>
              </div>

              {/* タイムライン */}
              <div className="flex items-center gap-2 mb-2 px-2 py-1.5 bg-slate-50 rounded-lg">
                {lessonDates.length === 0 ? (
                  <span className="text-[10px] text-gray-400">塾の指導記録なし</span>
                ) : (
                  lessonDates.map((d, i) => (
                    <span key={i} className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] rounded">
                      {i + 1}：{fmtMd(d)}
                    </span>
                  ))
                )}
                <span className="ml-auto text-[10px] text-gray-400">→</span>
                {schoolDone ? (
                  <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 text-[10px] rounded">学：{fmtMd(r.school)}</span>
                ) : (
                  <span className="text-[10px] text-gray-400">学校未到達</span>
                )}
              </div>

              {/* アクション */}
              <div className="flex gap-1.5 mb-2">
                <button
                  onClick={() => recordLesson(u.id)}
                  disabled={lessonCount >= 3}
                  className="flex-1 px-2 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:bg-gray-200 disabled:text-gray-400 transition-colors duration-150"
                >
                  <BookOpen className="w-3 h-3 inline mr-1" />
                  指導した{lessonCount > 0 && `（${lessonCount + 1}回目）`}
                </button>
                <button
                  onClick={() => recordSchool(u.id)}
                  className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-lg transition-colors duration-150 ${
                    schoolDone ? 'bg-purple-100 text-purple-700' : 'bg-purple-600 text-white hover:bg-purple-700'
                  }`}
                >
                  <GraduationCap className="w-3 h-3 inline mr-1" />
                  {schoolDone ? '学校済' : '学校で進んだ'}
                </button>
              </div>

              {/* 取り消し */}
              {(lessonCount > 0 || schoolDone) && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {(['lesson1','lesson2','lesson3'] as ColKey[]).filter((k) => r[k]).map((k) => (
                    <button
                      key={k}
                      onClick={() => undo(u.id, k)}
                      className="px-1.5 py-0.5 text-[10px] text-gray-500 bg-gray-100 rounded hover:bg-gray-200"
                    >
                      ✕ {k === 'lesson1' ? '1回目' : k === 'lesson2' ? '2回目' : '3回目'}
                    </button>
                  ))}
                  {schoolDone && (
                    <button
                      onClick={() => undo(u.id, 'school')}
                      className="px-1.5 py-0.5 text-[10px] text-gray-500 bg-gray-100 rounded hover:bg-gray-200"
                    >
                      ✕ 学校
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-gray-500">
        💡 完全に Excel から脱却。各単元がカード化、ワンタップで進捗を加える。塾と学校の前後関係はカードの色（緑＝塾先行／赤＝塾遅延）で一発判定。
      </p>
    </div>
  );
}

// ─────────────────────── メイン ───────────────────────
export default function ProgressMockupPage() {
  const [variant, setVariant] = useState('current');
  const [rows, setRows] = useState<Record<string, RowState>>(() => {
    const init: Record<string, RowState> = {};
    for (const u of SEED_UNITS) init[u.id] = { ...DEFAULT_ROW };
    return init;
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center justify-between mb-4">
          <Link href="/students" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
            <ChevronLeft className="w-4 h-4 mr-1" />
            戻る
          </Link>
          <div className="text-xs text-gray-400">
            データはローカル保持・DB 書込なし
          </div>
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-1">進行表 UI モック比較</h1>
        <p className="text-sm text-gray-500 mb-4">
          1日4単元入力する作業を 5 パターンで比較。サンプルデータで自由に操作できます。
        </p>

        <VariantSwitcher active={variant} onChange={setVariant} />

        <div className="space-y-4">
          {variant === 'current' && <VariantCurrent rows={rows} setRows={setRows} />}
          {variant === 'brush'   && <VariantBrush   rows={rows} setRows={setRows} />}
          {variant === 'record'  && <VariantRecord  rows={rows} setRows={setRows} />}
          {variant === 'bands'   && <VariantBands   rows={rows} setRows={setRows} />}
          {variant === 'cards'   && <VariantCards   rows={rows} setRows={setRows} />}
        </div>

        <div className="mt-8 p-4 bg-white border border-gray-200 rounded-xl">
          <h2 className="text-sm font-semibold mb-2">パターンの特徴比較</h2>
          <table className="w-full text-xs">
            <thead className="border-b border-gray-200">
              <tr>
                <th className="text-left py-1.5">パターン</th>
                <th className="text-left py-1.5">1日4単元の入力</th>
                <th className="text-left py-1.5">塾↔学校の前後</th>
                <th className="text-left py-1.5">引継ぎ</th>
                <th className="text-left py-1.5">学習コスト</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <tr><td className="py-1.5">① 現状</td><td>4回クリック</td><td>列順で見る</td><td>1行 input</td><td>低</td></tr>
              <tr><td className="py-1.5">② ペン入力</td><td>ドラッグ1回</td><td>列順で見る</td><td>1行 input</td><td>中</td></tr>
              <tr><td className="py-1.5">③ 指導記録モード</td><td>4回タップ（チップ）</td><td>列順 1→2→3→学校</td><td>従来のまま</td><td>低</td></tr>
              <tr><td className="py-1.5">④ 列入替＋バッジ</td><td>4回クリック</td><td>列順＋バッジ＋背景色</td><td>focus 拡大</td><td>低</td></tr>
              <tr><td className="py-1.5">⑤ カードビュー</td><td>4回タップ（自動次回判定）</td><td>カード色＋タイムライン</td><td>—（別画面想定）</td><td>高</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
