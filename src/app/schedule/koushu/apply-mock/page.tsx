'use client';

/**
 * 講習申込のWeb化 モック（検討用）
 * ------------------------------------------------------------------
 * 正典仕様: docs/koushu-auto-allocation-spec.md 第2部（§8〜§13）
 *
 * 紙の提案書申込をWeb化する画面の叩き台。決めたいのは主に次の3点:
 *  1. 保護者フォームで「提案の見せ方」と「コマ数の入れ方」がスマホで成立するか
 *  2. 8週×5コマ（約250枠）の可能日程を375pxでどう入力させるか ← 3案を切替比較
 *  3. 管理側（提案書の入口／自動配置の実行パネル）に足りない項目は無いか
 *
 * すべてダミーデータ直書き・DB接続やAPI呼び出しは一切なし。
 * 検討OKなら本番ルート（/koushu-apply/[token] と /portal/[schoolCode]/koushu）へ昇格する。
 */

import { Fragment, useMemo, useState } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Button } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import AccessDenied from '@/components/AccessDenied';
import { isManagerOrAbove } from '@/lib/utils/roles';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Check,
  X,
  Minus,
  Plus,
  QrCode,
  Link2,
  Lock,
  AlertCircle,
  Info,
  CalendarDays,
  Play,
} from 'lucide-react';

/* ============================================================
 * ダミーデータ
 * ========================================================== */

/** 2026年 夏期講習の想定（日曜・お盆は休講） */
const PERIOD = { label: '2026年 夏期講習', start: '2026-07-21', end: '2026-09-12' };
const CLOSED = new Set([
  '2026-08-10',
  '2026-08-11',
  '2026-08-12',
  '2026-08-13',
  '2026-08-14',
  '2026-08-15',
  '2026-08-16',
]);

/** 個別コマ（実データ 緑園都市校と同じ5コマ） */
const SLOTS = [
  { no: 1, time: '12:50' },
  { no: 2, time: '14:25' },
  { no: 3, time: '16:20' },
  { no: 4, time: '17:55' },
  { no: 5, time: '19:30' },
];

const STUDENT = { name: '宮永 心那', grade: 8, gradeLabel: '中2' };

/**
 * 提案書から読む内容。ratio / duration は教室が提案時に決めた値で、
 * 保護者側は表示のみ（仕様書 決定14）。
 */
const PROPOSALS = [
  {
    subject: '英語',
    textbook: 'フォレスタ 英語 中2',
    units: ['不定詞', '動名詞', '比較'],
    proposedKoma: 8,
    ratio: 2 as const,
    duration: 90 as const,
  },
  {
    subject: '数学',
    textbook: 'フォレスタ 数学 中2',
    units: ['連立方程式', '一次関数'],
    proposedKoma: 6,
    ratio: 1 as const,
    duration: 90 as const,
  },
  {
    subject: '理科',
    textbook: 'フォレスタ 理科 中2',
    units: ['化学変化と原子・分子'],
    proposedKoma: 4,
    ratio: 2 as const,
    duration: 90 as const,
  },
];

const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'];

/** 期間の稼働日を列挙（日曜・休講日は除外） */
function buildDates(): string[] {
  const out: string[] = [];
  const cur = new Date(PERIOD.start + 'T12:00:00');
  const end = new Date(PERIOD.end + 'T12:00:00');
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    const iso = `${y}-${m}-${d}`;
    if (cur.getDay() !== 0 && !CLOSED.has(iso)) out.push(iso);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

const cellKey = (date: string, slotNo: number) => `${date}_${slotNo}`;
const dow = (date: string) => new Date(date + 'T12:00:00').getDay();
const mmdd = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/** 期間を週（月曜始まり）で区切る */
function groupByWeek(dates: string[]): { label: string; dates: string[] }[] {
  const weeks: { label: string; dates: string[] }[] = [];
  let cur: string[] = [];
  for (const d of dates) {
    if (dow(d) === 1 && cur.length > 0) {
      weeks.push({ label: `${mmdd(cur[0])}〜${mmdd(cur[cur.length - 1])}`, dates: cur });
      cur = [];
    }
    cur.push(d);
  }
  if (cur.length > 0)
    weeks.push({ label: `${mmdd(cur[0])}〜${mmdd(cur[cur.length - 1])}`, dates: cur });
  return weeks;
}

/* ============================================================
 * ページ本体
 * ========================================================== */

type Tab = 'parent' | 'admin';

export default function KoushuApplyMockPage() {
  const { profile, isLoading } = useAuth();
  const [tab, setTab] = useState<Tab>('parent');

  if (isLoading) return null;
  if (!isManagerOrAbove(profile?.role)) return <AccessDenied />;

  return (
    <AdminLayout>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-[var(--headline)]">講習申込のWeb化 モック</h1>
          <p className="text-sm text-[var(--paragraph)] mt-1">
            検討用。ダミーデータのみでDBには一切触れません。正典仕様は
            <code className="mx-1 px-1 rounded bg-gray-100 text-xs">
              docs/koushu-auto-allocation-spec.md
            </code>
            第2部。
          </p>
        </div>

        <div className="flex gap-2 border-b border-[var(--stroke)]">
          {(
            [
              ['parent', '保護者フォーム（スマホ）'],
              ['admin', '管理側（入口・実行パネル）'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                tab === k
                  ? 'border-ink text-[var(--headline)] font-medium'
                  : 'border-transparent text-[var(--paragraph)] hover:text-[var(--headline)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'parent' ? <ParentFormMock /> : <AdminMock />}
      </div>
    </AdminLayout>
  );
}

/* ============================================================
 * 保護者フォーム（375px のスマホ枠に描画）
 * ========================================================== */

/** 可能日程の入力方式。どれが実用に耐えるか比べるためモックでは切替できる */
type AvailLayout = 'list' | 'week' | 'pattern';

const AVAIL_LAYOUTS: { key: AvailLayout; name: string; note: string }[] = [
  {
    key: 'list',
    name: 'A 日別リスト',
    note: '1行1日で縦スクロール。押しやすく日付が読めるが約40行と長い',
  },
  {
    key: 'week',
    name: 'B 週アコーディオン',
    note: '週ごとに折りたたむ。全体像が掴めるが開閉の手間がある',
  },
  {
    key: 'pattern',
    name: 'C 曜日パターン＋個別',
    note: '毎週の予定を先に指定して残りを微調整。入力量は最小',
  },
];

function ParentFormMock() {
  const dates = useMemo(() => buildDates(), []);
  const [step, setStep] = useState(1);
  const [layout, setLayout] = useState<AvailLayout>('list');
  const [koma, setKoma] = useState<Record<string, number>>(
    Object.fromEntries(PROPOSALS.map((p) => [p.subject, p.proposedKoma]))
  );
  /** ×を付けた枠。全○初期なのでここに入っているものだけが「出られない」 */
  const [ng, setNg] = useState<Set<string>>(new Set());

  const totalKoma = Object.values(koma).reduce((s, n) => s + n, 0);
  const totalCells = dates.length * SLOTS.length;
  const okCells = totalCells - ng.size;

  const toggle = (key: string) =>
    setNg((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleDay = (date: string) =>
    setNg((prev) => {
      const next = new Set(prev);
      const keys = SLOTS.map((s) => cellKey(date, s.no));
      const allNg = keys.every((k) => next.has(k));
      for (const k of keys) {
        if (allNg) next.delete(k);
        else next.add(k);
      }
      return next;
    });

  return (
    <div className="grid lg:grid-cols-[375px_1fr] gap-6 items-start">
      {/* スマホ枠 */}
      <div className="rounded-[28px] border-[10px] border-gray-800 bg-white overflow-hidden shadow-lg">
        <div className="h-[720px] overflow-y-auto">
          {/* ヘッダ */}
          <div className="sticky top-0 z-10 bg-white border-b border-[var(--stroke)] px-4 py-3">
            <p className="text-[11px] text-[var(--paragraph)]">{PERIOD.label}</p>
            <p className="text-sm font-semibold text-[var(--headline)]">
              {STUDENT.name} <span className="text-xs font-normal">（{STUDENT.gradeLabel}）</span>
            </p>
            <div className="flex gap-1 mt-2">
              {['申込内容', '通える日', '確認'].map((label, i) => (
                <div key={label} className="flex-1">
                  <div
                    className={`h-1 rounded-full ${step >= i + 1 ? 'bg-ink' : 'bg-gray-200'}`}
                    aria-hidden
                  />
                  <p
                    className={`text-[10px] mt-1 ${step >= i + 1 ? 'text-[var(--headline)]' : 'text-[var(--paragraph)]'}`}
                  >
                    {label}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="px-4 py-4 pb-24">
            {step === 1 && <StepSubjects koma={koma} setKoma={setKoma} totalKoma={totalKoma} />}
            {step === 2 && (
              <StepAvailability
                dates={dates}
                layout={layout}
                ng={ng}
                toggle={toggle}
                toggleDay={toggleDay}
                okCells={okCells}
                totalKoma={totalKoma}
              />
            )}
            {step === 3 && <StepConfirm koma={koma} totalKoma={totalKoma} okCells={okCells} />}
          </div>

          {/* 固定フッタ */}
          <div className="sticky bottom-0 bg-white border-t border-[var(--stroke)] px-4 py-3 flex gap-2">
            {step > 1 && (
              <button
                onClick={() => setStep(step - 1)}
                className="px-3 py-2.5 rounded-lg border border-[var(--stroke)] text-sm text-[var(--headline)] flex items-center gap-1"
              >
                <ChevronLeft className="w-4 h-4" />
                戻る
              </button>
            )}
            <button
              onClick={() => setStep(Math.min(3, step + 1))}
              disabled={step === 3}
              className="flex-1 px-3 py-2.5 rounded-lg bg-ink text-white text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-1"
            >
              {step === 3 ? 'この内容で申し込む' : '次へ'}
              {step < 3 && <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* 右: 切替と確認事項 */}
      <div className="space-y-4">
        <div className="rounded-lg border border-[var(--stroke)] bg-white p-4">
          <h2 className="text-sm font-semibold text-[var(--headline)] mb-2">
            通える日の入力方式（ステップ2で反映）
          </h2>
          <div className="space-y-2">
            {AVAIL_LAYOUTS.map((l) => (
              <label
                key={l.key}
                className={`flex gap-2 items-start p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  layout === l.key
                    ? 'border-ink bg-gray-50'
                    : 'border-[var(--stroke)] hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="layout"
                  checked={layout === l.key}
                  onChange={() => {
                    setLayout(l.key);
                    setStep(2);
                  }}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm text-[var(--headline)]">{l.name}</span>
                  <span className="block text-xs text-[var(--paragraph)]">{l.note}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-info bg-info-subtle p-4 text-sm text-[var(--headline)] space-y-2">
          <div className="flex items-center gap-2 font-semibold text-info">
            <Info className="w-4 h-4 shrink-0" />
            確認したいこと
          </div>
          <ul className="text-xs space-y-1.5 list-disc pl-4 text-[var(--paragraph)]">
            <li>提案の見せ方は「科目＋教材名＋単元」で足りるか。単元ごとのコマ数まで出すべきか</li>
            <li>
              形式（1対1／1対2）と90分は表示のみでよいか。保護者から変更希望が来る運用をどうするか
            </li>
            <li>
              <strong>全○初期の副作用</strong>: 何も触らず送信されると「全部通える」ことになる。
              実際に来られない日に配置され当日欠席が増えるおそれ。1件も×が無いとき確認を挟むか
            </li>
            <li>
              期間全体で {dates.length}日 × {SLOTS.length}コマ = {totalCells}
              枠。案A〜Cで入力量が見合うか
            </li>
            <li>申込コマ数は提案より増やせてよいか（上限を設けるか）</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ---------- ステップ1: 申込内容 ---------- */

function StepSubjects({
  koma,
  setKoma,
  totalKoma,
}: {
  koma: Record<string, number>;
  setKoma: (v: Record<string, number>) => void;
  totalKoma: number;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--paragraph)]">
        教室からの提案です。コマ数を確認して、変更があれば増減してください。
      </p>

      {PROPOSALS.map((p) => (
        <div key={p.subject} className="rounded-xl border border-[var(--stroke)] p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--headline)]">{p.subject}</p>
              <p className="text-[11px] text-[var(--paragraph)] truncate">{p.textbook}</p>
            </div>
            {/* 形式・時間は教室が決めた値。保護者は表示のみ（決定14） */}
            {/* 形式・時間は教室が決めた値なので、押せない見た目にする */}
            <div className="flex gap-1 shrink-0">
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  p.ratio === 1
                    ? 'bg-warning-subtle text-warning'
                    : 'bg-gray-100 text-[var(--paragraph)]'
                }`}
              >
                {p.ratio === 1 ? '1対1' : '1対2'}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-[var(--paragraph)]">
                {p.duration}分
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-1 mt-2">
            {p.units.map((u) => (
              <span
                key={u}
                className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-[var(--paragraph)]"
              >
                {u}
              </span>
            ))}
          </div>

          <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--stroke)]">
            <span className="text-xs text-[var(--paragraph)]">提案 {p.proposedKoma}コマ</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setKoma({ ...koma, [p.subject]: Math.max(0, koma[p.subject] - 1) })}
                className="w-9 h-9 rounded-full border border-[var(--stroke)] flex items-center justify-center active:scale-95"
                aria-label={`${p.subject}を1コマ減らす`}
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="w-12 text-center text-lg font-semibold text-[var(--headline)] tabular-nums">
                {koma[p.subject]}
              </span>
              <button
                onClick={() => setKoma({ ...koma, [p.subject]: koma[p.subject] + 1 })}
                className="w-9 h-9 rounded-full border border-[var(--stroke)] flex items-center justify-center active:scale-95"
                aria-label={`${p.subject}を1コマ増やす`}
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      ))}

      <div className="rounded-xl bg-gray-50 p-3 flex items-center justify-between">
        <span className="text-sm text-[var(--headline)]">合計</span>
        <span className="text-lg font-semibold text-[var(--headline)] tabular-nums">
          {totalKoma}コマ
        </span>
      </div>
    </div>
  );
}

/* ---------- ステップ2: 通える日 ---------- */

function StepAvailability({
  dates,
  layout,
  ng,
  toggle,
  toggleDay,
  okCells,
  totalKoma,
}: {
  dates: string[];
  layout: AvailLayout;
  ng: Set<string>;
  toggle: (key: string) => void;
  toggleDay: (date: string) => void;
  okCells: number;
  totalKoma: number;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-warning-subtle border border-warning p-3">
        <p className="text-xs text-[var(--headline)] leading-relaxed">
          <strong>最初はすべて「通える」</strong>になっています。
          旅行・部活・習い事などで来られない枠を選んで×にしてください。
        </p>
      </div>

      {/* 進捗: 申込コマ数に対して十分な枠が残っているか */}
      <div
        className={`rounded-lg p-3 flex items-center justify-between ${
          okCells >= totalKoma * 2 ? 'bg-success-subtle' : 'bg-danger-subtle'
        }`}
      >
        <span className="text-xs text-[var(--headline)]">通える枠</span>
        <span className="text-sm font-semibold text-[var(--headline)] tabular-nums">
          {okCells}枠 <span className="text-xs font-normal">/ 申込 {totalKoma}コマ</span>
        </span>
      </div>

      {layout === 'list' && (
        <AvailList dates={dates} ng={ng} toggle={toggle} toggleDay={toggleDay} />
      )}
      {layout === 'week' && <AvailWeek dates={dates} ng={ng} toggle={toggle} />}
      {layout === 'pattern' && <AvailPattern dates={dates} ng={ng} toggle={toggle} />}
    </div>
  );
}

/** セル1つ。○=通える / ×=通えない */
function Cell({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`h-9 rounded-md text-[11px] font-medium border transition-colors flex items-center justify-center gap-0.5 ${
        on
          ? 'bg-success-subtle border-success text-success'
          : 'bg-gray-100 border-[var(--stroke)] text-gray-400'
      }`}
      aria-pressed={!on}
    >
      {on ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
      {label}
    </button>
  );
}

/** 案A: 1行1日の縦リスト */
function AvailList({
  dates,
  ng,
  toggle,
  toggleDay,
}: {
  dates: string[];
  ng: Set<string>;
  toggle: (k: string) => void;
  toggleDay: (d: string) => void;
}) {
  const weeks = useMemo(() => groupByWeek(dates), [dates]);
  return (
    <div className="space-y-4">
      {weeks.map((w, wi) => (
        <div key={w.label}>
          <p className="text-[11px] font-medium text-[var(--paragraph)] mb-1.5">
            第{wi + 1}週 {w.label}
          </p>
          <div className="space-y-1.5">
            {w.dates.map((d) => {
              const allNg = SLOTS.every((s) => ng.has(cellKey(d, s.no)));
              return (
                <div key={d} className="flex items-center gap-1.5">
                  <button
                    onClick={() => toggleDay(d)}
                    className={`w-12 shrink-0 text-[11px] py-1 rounded ${
                      allNg ? 'text-gray-400 line-through' : 'text-[var(--headline)]'
                    }`}
                    title="この日をまとめて切替"
                  >
                    {mmdd(d)}
                    <span className={dow(d) === 6 ? 'text-blue-500' : ''}>({WEEKDAY[dow(d)]})</span>
                  </button>
                  <div className="grid grid-cols-5 gap-1 flex-1">
                    {SLOTS.map((s) => (
                      <Cell
                        key={s.no}
                        on={!ng.has(cellKey(d, s.no))}
                        label={`${s.no}`}
                        onClick={() => toggle(cellKey(d, s.no))}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 案B: 週アコーディオン */
function AvailWeek({
  dates,
  ng,
  toggle,
}: {
  dates: string[];
  ng: Set<string>;
  toggle: (k: string) => void;
}) {
  const weeks = useMemo(() => groupByWeek(dates), [dates]);
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="space-y-2">
      {weeks.map((w, wi) => {
        const ngCount = w.dates.reduce(
          (n, d) => n + SLOTS.filter((s) => ng.has(cellKey(d, s.no))).length,
          0
        );
        const isOpen = open === wi;
        return (
          <div key={w.label} className="rounded-lg border border-[var(--stroke)] overflow-hidden">
            <button
              onClick={() => setOpen(isOpen ? null : wi)}
              className="w-full flex items-center justify-between px-3 py-2.5 text-left"
            >
              <span className="text-sm text-[var(--headline)]">
                第{wi + 1}週 <span className="text-[11px] text-[var(--paragraph)]">{w.label}</span>
              </span>
              <span className="flex items-center gap-2">
                {ngCount > 0 ? (
                  <span className="text-[11px] text-danger">{ngCount}枠 ×</span>
                ) : (
                  <span className="text-[11px] text-success">全部OK</span>
                )}
                <ChevronDown
                  className={`w-4 h-4 text-[var(--paragraph)] transition-transform ${isOpen ? 'rotate-180' : ''}`}
                />
              </span>
            </button>
            {isOpen && (
              <div className="px-2 pb-2">
                <div className="grid grid-cols-[28px_repeat(5,1fr)] gap-1">
                  <div />
                  {SLOTS.map((s) => (
                    <div key={s.no} className="text-[9px] text-center text-[var(--paragraph)]">
                      {s.time}
                    </div>
                  ))}
                  {w.dates.map((d) => (
                    // key は Fragment 側に付ける（内側の要素に付けても兄弟を識別できない）
                    <Fragment key={d}>
                      <div className="text-[10px] flex items-center text-[var(--paragraph)]">
                        {Number(d.slice(8, 10))}
                        {WEEKDAY[dow(d)]}
                      </div>
                      {SLOTS.map((s) => (
                        <Cell
                          key={s.no}
                          on={!ng.has(cellKey(d, s.no))}
                          label=""
                          onClick={() => toggle(cellKey(d, s.no))}
                        />
                      ))}
                    </Fragment>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 案C: 曜日パターンで一括 → 個別で微調整 */
function AvailPattern({
  dates,
  ng,
  toggle,
}: {
  dates: string[];
  ng: Set<string>;
  toggle: (k: string) => void;
}) {
  const [showDetail, setShowDetail] = useState(false);
  /** 曜日×コマ の一括×。実データでは各日付に展開して保存する */
  const [pattern, setPattern] = useState<Set<string>>(new Set());
  const togglePattern = (d: number, slotNo: number) =>
    setPattern((prev) => {
      const next = new Set(prev);
      const k = `${d}_${slotNo}`;
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const patternNg = pattern.size * 7; // 表示用のざっくり見積り
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium text-[var(--headline)] mb-1.5">
          毎週きまって来られない曜日・コマ
        </p>
        <div className="grid grid-cols-[28px_repeat(5,1fr)] gap-1">
          <div />
          {SLOTS.map((s) => (
            <div key={s.no} className="text-[9px] text-center text-[var(--paragraph)]">
              {s.time}
            </div>
          ))}
          {[1, 2, 3, 4, 5, 6].map((d) => (
            <Fragment key={d}>
              <div className="text-[11px] flex items-center text-[var(--headline)]">
                {WEEKDAY[d]}
              </div>
              {SLOTS.map((s) => (
                <Cell
                  key={s.no}
                  on={!pattern.has(`${d}_${s.no}`)}
                  label=""
                  onClick={() => togglePattern(d, s.no)}
                />
              ))}
            </Fragment>
          ))}
        </div>
        <p className="text-[11px] text-[var(--paragraph)] mt-1.5">
          {pattern.size > 0
            ? `毎週${pattern.size}コマ（期間全体で約${patternNg}枠）を除外`
            : '部活や習い事で毎週きまって来られない枠があれば×にしてください'}
        </p>
      </div>

      <button
        onClick={() => setShowDetail(!showDetail)}
        className="w-full py-2.5 rounded-lg border border-[var(--stroke)] text-sm text-[var(--headline)] flex items-center justify-center gap-1"
      >
        <CalendarDays className="w-4 h-4" />
        旅行など特定の日を追加で外す
        <ChevronDown className={`w-4 h-4 transition-transform ${showDetail ? 'rotate-180' : ''}`} />
      </button>

      {showDetail && (
        <div className="space-y-1.5 pt-1">
          {dates.slice(0, 12).map((d) => (
            <div key={d} className="flex items-center gap-1.5">
              <span className="w-12 shrink-0 text-[11px] text-[var(--headline)]">
                {mmdd(d)}({WEEKDAY[dow(d)]})
              </span>
              <div className="grid grid-cols-5 gap-1 flex-1">
                {SLOTS.map((s) => (
                  <Cell
                    key={s.no}
                    on={!ng.has(cellKey(d, s.no)) && !pattern.has(`${dow(d)}_${s.no}`)}
                    label={`${s.no}`}
                    onClick={() => toggle(cellKey(d, s.no))}
                  />
                ))}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-[var(--paragraph)] text-center pt-1">
            （モックでは先頭12日のみ表示）
          </p>
        </div>
      )}
    </div>
  );
}

/* ---------- ステップ3: 確認 ---------- */

function StepConfirm({
  koma,
  totalKoma,
  okCells,
}: {
  koma: Record<string, number>;
  totalKoma: number;
  okCells: number;
}) {
  const tight = okCells < totalKoma * 2;
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[var(--stroke)] overflow-hidden">
        <div className="px-3 py-2 bg-gray-50 text-xs font-medium text-[var(--headline)]">
          申込内容
        </div>
        {PROPOSALS.map((p) => (
          <div
            key={p.subject}
            className="px-3 py-2.5 flex items-center justify-between border-t border-[var(--stroke)]"
          >
            <div>
              <p className="text-sm text-[var(--headline)]">{p.subject}</p>
              <p className="text-[11px] text-[var(--paragraph)]">
                {p.ratio === 1 ? '1対1' : '1対2'} / {p.duration}分
              </p>
            </div>
            <span className="text-sm font-semibold text-[var(--headline)] tabular-nums">
              {koma[p.subject]}コマ
            </span>
          </div>
        ))}
        <div className="px-3 py-2.5 flex items-center justify-between border-t border-[var(--stroke)] bg-gray-50">
          <span className="text-sm text-[var(--headline)]">合計</span>
          <span className="text-base font-semibold text-[var(--headline)] tabular-nums">
            {totalKoma}コマ
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--stroke)] px-3 py-2.5 flex items-center justify-between">
        <span className="text-sm text-[var(--headline)]">通える枠</span>
        <span className="text-sm font-semibold text-[var(--headline)] tabular-nums">
          {okCells}枠
        </span>
      </div>

      {tight && (
        <div className="rounded-lg border border-warning bg-warning-subtle p-3 flex gap-2">
          <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <p className="text-xs text-[var(--headline)]">
            通える枠が申込コマ数に対して少なめです。ご希望どおりに組めない場合があります。
          </p>
        </div>
      )}

      <p className="text-[11px] text-[var(--paragraph)]">
        送信後の変更は教室までご連絡ください。日程は教室で組み、決まり次第お知らせします。
      </p>
    </div>
  );
}

/* ============================================================
 * 管理側
 * ========================================================== */

const MOCK_STUDENTS = [
  { name: '宮永 心那', grade: '中2', status: 'applied' as const, koma: 18 },
  { name: '稲田 葵', grade: '中3', status: 'applied' as const, koma: 24 },
  { name: '園田 あいり', grade: '小5', status: 'opened' as const, koma: 0 },
  { name: '大橋 穂乃梨', grade: '中1', status: 'none' as const, koma: 0 },
  { name: '大崎 透', grade: '小6', status: 'none' as const, koma: 0 },
];

const GRADES = [
  { v: 1, label: '小1' },
  { v: 2, label: '小2' },
  { v: 3, label: '小3' },
  { v: 4, label: '小4' },
  { v: 5, label: '小5' },
  { v: 6, label: '小6' },
  { v: 7, label: '中1' },
  { v: 8, label: '中2' },
  { v: 9, label: '中3' },
  { v: 10, label: '高1' },
  { v: 11, label: '高2' },
  { v: 12, label: '高3' },
  { v: 13, label: '既卒' },
];

function AdminMock() {
  const [published, setPublished] = useState(false);
  const [grades, setGrades] = useState<Set<number>>(new Set([7, 8, 9]));
  const [mode, setMode] = useState<'overwrite' | 'diff'>('diff');

  const toggleGrade = (v: number) =>
    setGrades((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });

  return (
    <div className="space-y-5">
      {/* 公開期間のスイッチ（非公開の担保を確かめる） */}
      <div className="rounded-lg border border-[var(--stroke)] bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--headline)]">
              申込の公開期間（ポータル設定）
            </h2>
            <p className="text-xs text-[var(--paragraph)] mt-0.5">
              期間が無い間は保護者向けURLが404になり、リンク発行も無効。
              フラグを新設せずこれで非公開を担保する（仕様書 §12）。
            </p>
          </div>
          <button
            onClick={() => setPublished(!published)}
            className={`px-3 py-1.5 rounded-lg text-sm shrink-0 border ${
              published
                ? 'bg-success-subtle border-success text-success'
                : 'bg-gray-100 border-[var(--stroke)] text-[var(--paragraph)]'
            }`}
          >
            {published ? '公開中' : '未公開'}
          </button>
        </div>
      </div>

      {/* 提案書の入口 */}
      <div className="rounded-lg border border-[var(--stroke)] bg-white p-4">
        <h2 className="text-sm font-semibold text-[var(--headline)] mb-1">
          講習提案書（申込リンクの配布と状況）
        </h2>
        <p className="text-xs text-[var(--paragraph)] mb-3">
          生徒ごとにトークンURL／QRを発行して配る。申込状況をここで追う。
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--paragraph)] border-b border-[var(--stroke)]">
              <th className="py-1.5 pr-3 font-medium">生徒</th>
              <th className="py-1.5 pr-3 font-medium">学年</th>
              <th className="py-1.5 pr-3 font-medium">申込</th>
              <th className="py-1.5 font-medium">配布</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_STUDENTS.map((s) => (
              <tr key={s.name} className="border-b border-gray-100 last:border-0">
                <td className="py-2 pr-3 text-[var(--headline)]">{s.name}</td>
                <td className="py-2 pr-3 text-[var(--paragraph)]">{s.grade}</td>
                <td className="py-2 pr-3">
                  {s.status === 'applied' ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-success-subtle text-success">
                      済 {s.koma}コマ
                    </span>
                  ) : s.status === 'opened' ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-warning-subtle text-warning">
                      閲覧のみ
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-[var(--paragraph)]">
                      未
                    </span>
                  )}
                </td>
                <td className="py-2">
                  <div className="flex gap-1">
                    <button
                      disabled={!published}
                      className="text-xs px-2 py-1 rounded border border-[var(--stroke)] text-[var(--headline)] disabled:opacity-40 flex items-center gap-1"
                    >
                      {published ? <Link2 className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                      リンク
                    </button>
                    <button
                      disabled={!published}
                      className="text-xs px-2 py-1 rounded border border-[var(--stroke)] text-[var(--headline)] disabled:opacity-40 flex items-center gap-1"
                    >
                      <QrCode className="w-3 h-3" />
                      QR
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!published && (
          <p className="text-xs text-[var(--paragraph)] mt-2">
            公開期間が無いため配布ボタンは無効。上のスイッチで切り替えて確認できます。
          </p>
        )}
      </div>

      {/* 実行パネル */}
      <div className="rounded-lg border border-[var(--stroke)] bg-white p-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-[var(--headline)]">
            自動コマ割りの実行（/schedule 講習モード）
          </h2>
          <p className="text-xs text-[var(--paragraph)] mt-0.5">
            学年を選んで実行する。学年ごとに順に回しても、既に置いた分は既存配置として尊重される。
          </p>
        </div>

        <div>
          <p className="text-xs font-medium text-[var(--headline)] mb-1.5">対象学年</p>
          <div className="flex gap-1.5 mb-2">
            {(
              [
                ['小学生', [1, 2, 3, 4, 5, 6]],
                ['中学生', [7, 8, 9]],
                ['受験生', [9, 12]],
                ['高校生', [10, 11, 12]],
              ] as const
            ).map(([label, vs]) => (
              <button
                key={label}
                onClick={() => setGrades(new Set(vs))}
                className="text-xs px-2 py-1 rounded border border-[var(--stroke)] text-[var(--headline)] hover:bg-gray-50"
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {GRADES.map((g) => (
              <button
                key={g.v}
                onClick={() => toggleGrade(g.v)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                  grades.has(g.v)
                    ? 'bg-ink text-white border-ink'
                    : 'border-[var(--stroke)] text-[var(--headline)] hover:bg-gray-50'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-xs text-[var(--headline)]">
            1日上限コマ数
            <select className="mt-1 w-full text-sm border border-[var(--stroke)] rounded-lg px-2 py-1.5">
              <option>1</option>
              <option selected>2</option>
              <option>3</option>
            </select>
          </label>
          <label className="text-xs text-[var(--headline)]">
            再実行モード
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as 'overwrite' | 'diff')}
              className="mt-1 w-full text-sm border border-[var(--stroke)] rounded-lg px-2 py-1.5"
            >
              <option value="diff">下書きを維持して差分だけ埋める</option>
              <option value="overwrite">下書きを破棄して組み直す</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-3">
          {['連続優先', '同日同科目を許可', '科目を均等分散'].map((label, i) => (
            <label key={label} className="flex items-center gap-1.5 text-xs text-[var(--headline)]">
              <input type="checkbox" defaultChecked={i !== 1} className="w-4 h-4 rounded" />
              {label}
            </label>
          ))}
        </div>

        <div className="pt-1 border-t border-[var(--stroke)] flex items-center justify-between">
          <p className="text-xs text-[var(--paragraph)]">
            対象 {grades.size}学年 / 申込済み 2名・42コマ（ダミー）
          </p>
          <Button size="sm" disabled>
            <Play className="w-3.5 h-3.5 mr-1" />
            自動配置を実行
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-info bg-info-subtle p-4 text-sm text-[var(--headline)] space-y-2">
        <div className="flex items-center gap-2 font-semibold text-info">
          <Info className="w-4 h-4 shrink-0" />
          確認したいこと
        </div>
        <ul className="text-xs space-y-1.5 list-disc pl-4 text-[var(--paragraph)]">
          <li>申込状況は「未／閲覧のみ／済」の3段階でよいか。督促の導線は要るか</li>
          <li>トークンURLの有効期限・再発行の運用（きょうだいで使い回されないか）</li>
          <li>「受験生」ショートカットは中3＋高3でよいか（既卒13を含めるか）</li>
          <li>
            実行後の結果表示（達成率・未割当理由・科目バランス）はシミュレータと同じ形でよいか
          </li>
          <li>紙で申し込んだ生徒を教室が代行入力する導線は本当に不要か</li>
        </ul>
      </div>
    </div>
  );
}
