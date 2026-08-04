'use client';

/**
 * 講習申込のWeb化 モック（検討用）
 * ------------------------------------------------------------------
 * 正典仕様: docs/koushu-auto-allocation-spec.md 第2部（§8〜§16）＋ §17。
 * §16「設計レビュー（2026-08-04）」の決定29〜35に加え、
 * §17「小集団・プログラミングの追加＋学年別の講習期間」の決定36〜44を反映した。
 *
 * 紙の提案書申込をWeb化する画面の叩き台。決めたいのは主に次の3点:
 *  1. 保護者フォームで「提案の見せ方」と「コマ数の入れ方」がスマホで成立するか
 *  2. 8週×5コマ（約250枠）の可能日程を375pxでどう入力させるか ← 3案を切替比較
 *  3. 管理側（提案書の入口／自動配置の実行パネル／公開期間・単価の設定）に足りない項目は無いか
 *
 * タブ構成:
 *  - 保護者フォーム（スマホ）: 個別4ステップ（申込内容→小集団・プログラミング→通える日→確認）に加え、
 *    「生徒コード入口」「申込済み（読み取り専用）」の表示状態を切り替えて確認できる（決定19・決定30）。
 *    小集団・プログラミングは固定開催・振替不可のため、可能日程は聞かず「参加する/しない」だけを選ぶ（決定36・37）
 *  - 管理側（入口・実行パネル）: 配布・失効再発行・再提出許可（決定30）
 *  - 設定（期間・単価）: `course_prep_periods` に持つ公開期間・3軸単価表・学年別終了日（決定44）、
 *    `seasonal_courses` のコース単価・開催予定（決定40・42）のモック
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
  RotateCcw,
  Unlock,
  KeyRound,
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
 * 45分の選択肢を出してよいかの判定（決定17・48）。小1〜小4のみ対象。
 * 現在のダミー生徒は中2（grade=8）なので常に false＝時間セレクトは非表示になる。
 * 小1〜小4の生徒なら true になり、保護者が追加した科目に 90分/45分 のセレクトも出る。
 */
const ALLOW_45 = STUDENT.grade <= 4;

/**
 * 提案書から読む内容。ratio / duration は教室が提案時に決めた値で、
 * 保護者側は表示のみ（仕様書 決定14）。
 * `theme` は提案書のテーマ（1行）。単元リスト・単元別コマ数は出さない
 * （詳細は提案書本体を見れば足りる。決定47）。
 */
const PROPOSALS = [
  {
    subject: '英語',
    textbook: 'フォレスタ 英語 中2',
    theme: '夏期の総復習と2学期の先取り',
    proposedKoma: 12,
    ratio: 2 as const,
    duration: 90 as const,
    regularKoma: 8, // 週1回 × 8週（お盆の休講週も暦どおり数える）
  },
  {
    subject: '数学',
    textbook: 'フォレスタ 数学 中2',
    theme: '連立方程式の完成と一次関数の導入',
    proposedKoma: 10,
    ratio: 1 as const,
    duration: 90 as const,
    regularKoma: 8,
  },
  {
    subject: '理科',
    textbook: 'フォレスタ 理科 中2',
    theme: '化学変化の基礎固め',
    proposedKoma: 4,
    ratio: 2 as const,
    duration: 90 as const,
    regularKoma: 0, // 通常授業では取っていない科目
  },
];

/**
 * 保護者が提案外に追加できる科目（決定: 提案した科目以外もやりたい場合がある）。
 * 本番では subjects テーブルから、生徒の grade_category に合う行を出す。
 */
const EXTRA_SUBJECTS = ['社会', '国語'];

/**
 * 小集団・プログラミングのダミーコース（仕様書 §17-1・決定36〜40）。
 * `seasonal_courses.session_dates` が配布する予定表そのもの＝正典（決定40）。
 * 固定開催・振替不可（決定37）なので、個別のような可能日程の入力はさせず
 * 「参加する/しない」だけを選ばせる。座席表配置は自動配置の対象外・手動のまま（決定2・§17-4）。
 */
interface CourseSession {
  date: string;
  start: string;
  end: string;
}

interface Course {
  name: string;
  /** 動的形態（schedule_formations）のラベル */
  formation: string;
  /** コース単価。学年別にしない（決定42） */
  unitPrice: number;
  sessions: CourseSession[];
}

const COURSES: Course[] = [
  {
    name: '中3 理社特訓',
    formation: '小集団',
    unitPrice: 2200,
    sessions: [
      { date: '2026-07-21', start: '19:30', end: '21:00' },
      { date: '2026-07-23', start: '19:30', end: '21:00' },
      { date: '2026-07-28', start: '19:30', end: '21:00' },
      { date: '2026-07-30', start: '19:30', end: '21:00' },
      { date: '2026-08-04', start: '19:30', end: '21:00' },
      { date: '2026-08-06', start: '19:30', end: '21:00' },
      { date: '2026-08-18', start: '19:30', end: '21:00' },
      { date: '2026-08-20', start: '19:30', end: '21:00' },
    ],
  },
  {
    name: 'プログラミング講座',
    formation: 'プログラミング',
    unitPrice: 2750,
    sessions: [
      { date: '2026-07-25', start: '10:00', end: '11:30' },
      { date: '2026-08-01', start: '10:00', end: '11:30' },
      { date: '2026-08-08', start: '10:00', end: '11:30' },
      { date: '2026-08-22', start: '10:00', end: '11:30' },
    ],
  },
];

/**
 * モック用の「今日」（仕様書 §17-5・決定45）。
 * 本番では実日時（Date.now()）で判定するが、モックでは途中参加の見え方
 * （開催済みのグレー表示・開始回セレクト・残り回数ぶんの料金再計算）を
 * 固定して確認できるよう日付を決め打ちする。
 * 中3理社特訓（全8回）のうち 7/21・7/23・7/28 の3回が「開催済み」になる日付を選んだ
 * （残り5回＝8/4起算ではなく7/30から。¥2,200 × 残り5回 = ¥11,000）。
 */
const MOCK_TODAY = '2026-07-29';

/** セッションが MOCK_TODAY より前＝開催済みかどうか */
function isSessionHeld(date: string): boolean {
  return date < MOCK_TODAY;
}

/** コースの未開催セッション一覧（開始回セレクトの選択肢はここから作る） */
function upcomingSessions(course: Course): CourseSession[] {
  return course.sessions.filter((s) => !isSessionHeld(s.date));
}

/**
 * 参加開始日（`course_start_date`相当）から残りのセッション一覧を返す。
 * 開始日が見つからない・先頭回が開始日＝これまでどおり全回参加として扱う。
 */
function remainingSessions(course: Course, startDate: string): CourseSession[] {
  const idx = course.sessions.findIndex((s) => s.date === startDate);
  return idx <= 0 ? course.sessions : course.sessions.slice(idx);
}

/** 参加開始セッションの番号（1始まり）。見つからなければ第1回扱い */
function startSessionNumber(course: Course, startDate: string): number {
  const idx = course.sessions.findIndex((s) => s.date === startDate);
  return idx === -1 ? 1 : idx + 1;
}

/**
 * 単価テーブル（仕様書 決定26・§15-2）。
 * 学年 × 形式(1対1/1対2) × 時間(45/90) の3軸。
 * 増コマの price_table は「学年 → 円」だけなので、講習では持てない。
 *
 * 45分は小1〜小4のみ（決定17）。それ以外の学年には "45" キーを置かない
 * ＝選択肢に出さず、APIでも弾く。値が無い組み合わせは申込できない。
 */
type PriceTable = Record<
  string,
  Partial<Record<'1on1' | '1on2', Partial<Record<45 | 90, number>>>>
>;

const PRICE_TABLE: PriceTable = {
  小3: { '1on2': { 90: 3200, 45: 1900 }, '1on1': { 90: 5200, 45: 3100 } },
  中2: { '1on2': { 90: 3980 }, '1on1': { 90: 6400 } },
  中3: { '1on2': { 90: 4300 }, '1on1': { 90: 6900 } },
};

/** 単価を引く。組み合わせが無ければ 0（本番では申込不可として弾く） */
function unitPrice(gradeLabel: string, ratio: 1 | 2, duration: 45 | 90): number {
  return PRICE_TABLE[gradeLabel]?.[ratio === 1 ? '1on1' : '1on2']?.[duration] ?? 0;
}

/**
 * 設定タブ（§16-1・決定29）の3軸単価エディタ用データ。
 * 行=学年13行（GRADESと同じ v をキーに使う）、列=1対2/1対1 × 90分/45分。
 * 45分は小1〜小4（grade v<=4）のみ持つ（決定17）。それ以外の学年はキー自体を持たない。
 */
type SettingsPriceRow = {
  '1on2_90': number;
  '1on1_90': number;
  '1on2_45'?: number;
  '1on1_45'?: number;
};
type SettingsPriceTable = Record<number, SettingsPriceRow>;

/** 初期値。学年が上がるほど高くなる程度のダミー金額 */
const INITIAL_SETTINGS_PRICE_TABLE: SettingsPriceTable = {
  1: { '1on2_90': 2600, '1on1_90': 4200, '1on2_45': 1600, '1on1_45': 2500 },
  2: { '1on2_90': 2700, '1on1_90': 4300, '1on2_45': 1650, '1on1_45': 2600 },
  3: { '1on2_90': 2900, '1on1_90': 4600, '1on2_45': 1750, '1on1_45': 2750 },
  4: { '1on2_90': 3100, '1on1_90': 4900, '1on2_45': 1850, '1on1_45': 2900 },
  5: { '1on2_90': 3300, '1on1_90': 5200 },
  6: { '1on2_90': 3500, '1on1_90': 5500 },
  7: { '1on2_90': 3700, '1on1_90': 5800 },
  8: { '1on2_90': 3980, '1on1_90': 6400 },
  9: { '1on2_90': 4300, '1on1_90': 6900 },
  10: { '1on2_90': 4500, '1on1_90': 7200 },
  11: { '1on2_90': 4700, '1on1_90': 7500 },
  12: { '1on2_90': 4900, '1on1_90': 7800 },
  13: { '1on2_90': 5200, '1on1_90': 8200 },
};

/**
 * 講習費の対象コマ数。
 *
 * 期間中の通常授業は月謝で別途もらっているので、申込コマ数からその分を差し引く
 * （進行表の「増コマ」と同じ考え方）。通常授業は科目ごとに決まっているため、
 * 科目単位で引く。申込が通常授業の回数を下回る場合は 0 に丸める。
 *
 * 差し引く数は**請求ベース**（科目ごとの週回数 × 期間の暦上の週数）で決める。
 * 授業を実施したかは関係ない ＝ 振替が期間外に出ても・休講でも・欠席でも引く。
 * 月謝は契約どおり請求しているので、実施の有無で差し引く数が動いてはいけない。
 */
function chargeableKoma(applied: number, regular: number): number {
  return Math.max(0, applied - regular);
}

const yen = (n: number) => `¥${n.toLocaleString()}`;

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

type Tab = 'parent' | 'admin' | 'settings';

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
              ['settings', '設定（期間・単価）'],
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

        {tab === 'parent' && <ParentFormMock />}
        {tab === 'admin' && <AdminMock />}
        {tab === 'settings' && <SettingsMock />}
      </div>
    </AdminLayout>
  );
}

/* ============================================================
 * 保護者フォーム（375px のスマホ枠に描画）
 * ========================================================== */

/** 申込1行。提案書由来と保護者が追加したものを同じ形で扱う */
interface ApplyLine {
  subject: string;
  textbook: string | null;
  /** 提案書のテーマ（1行）。保護者が追加した科目は未定なので null（決定47） */
  theme: string | null;
  /** 提案コマ数。保護者が追加した科目は 0 */
  proposedKoma: number;
  ratio: 1 | 2;
  duration: 45 | 90;
  /** 期間中の通常授業コマ数。月謝に含まれるので講習費からは差し引く */
  regularKoma: number;
  addedByParent?: boolean;
}

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
    name: 'B 週アコーディオン（採用）',
    note: '週ごとに畳んで「その週に何枠×か」を見出しに出す。8週でも一覧が1画面強に収まる',
  },
  {
    key: 'pattern',
    name: 'C 曜日パターン＋個別',
    note: '毎週の予定を先に指定して残りを微調整。入力量は最小',
  },
];

/**
 * スマホ枠の表示状態。通常の3ステップに加え、入口（本人確認前）と
 * 送信後の読み取り専用表示を切り替えて見た目を確認できるようにする
 * （決定19: student_code 入口／決定30: 再提出は教室許可制）。
 */
type DisplayState = 'normal' | 'entry' | 'applied';

const DISPLAY_STATES: { key: DisplayState; name: string; note: string }[] = [
  { key: 'normal', name: '通常', note: '現状どおり3ステップで申込む' },
  {
    key: 'entry',
    name: '生徒コード入口',
    note: 'ポータル経由（/portal/[schoolCode]/koushu）で開いたときの本人確認画面',
  },
  {
    key: 'applied',
    name: '申込済み（読み取り専用）',
    note: '送信後に同じリンクを開いたときの見え方。再提出は教室許可制（決定30）',
  },
];

function ParentFormMock() {
  const dates = useMemo(() => buildDates(), []);
  const [step, setStep] = useState(1);
  // 採用案は B（週アコーディオン）。A・C は比較用に残している
  const [layout, setLayout] = useState<AvailLayout>('week');
  // スマホ枠の中身を切り替えて、入口画面・送信後の見え方を比較する
  const [displayState, setDisplayState] = useState<DisplayState>('normal');
  const [koma, setKoma] = useState<Record<string, number>>(
    Object.fromEntries(PROPOSALS.map((p) => [p.subject, p.proposedKoma]))
  );
  /** 保護者が提案外に追加した科目 */
  const [extra, setExtra] = useState<string[]>([]);
  /**
   * 保護者が追加した科目の形式（決定48・決定25改訂）。科目名 → 選択したratio/duration。
   * 追加科目は既定で受けて教室が後から調整、ではなく保護者が選ぶ。既定値は1対2・90分。
   */
  const [extraFormat, setExtraFormat] = useState<
    Record<string, { ratio: 1 | 2; duration: 45 | 90 }>
  >({});
  /** ×を付けた枠。全○初期なのでここに入っているものだけが「出られない」 */
  const [ng, setNg] = useState<Set<string>>(new Set());
  /** 参加を選んだ小集団・プログラミングのコース名（決定36・37: 日時固定・全回参加が既定） */
  const [courseJoin, setCourseJoin] = useState<Set<string>>(new Set());
  /**
   * コースごとの参加開始日（決定45: 途中参加）。既定は次の未開催回。
   * コース名 → session.date。参加を外しても選択状態は保持する（再度参加したときに戻すため）。
   */
  const [courseStart, setCourseStart] = useState<Record<string, string>>(
    Object.fromEntries(
      COURSES.map((c) => [c.name, upcomingSessions(c)[0]?.date ?? c.sessions[0].date])
    )
  );

  /**
   * 申込の明細。提案書の科目＋保護者が追加した科目。
   * 追加分は形式（1対1/1対2・90分/45分）を保護者自身が選べる（決定48・決定25改訂）。
   * 選択は extraFormat に持ち、既定は1対2・90分。
   */
  const lines: ApplyLine[] = useMemo(
    () => [
      ...PROPOSALS,
      ...extra.map((s) => {
        const fmt = extraFormat[s] ?? { ratio: 2 as const, duration: 90 as const };
        return {
          subject: s,
          textbook: null,
          theme: null,
          proposedKoma: 0,
          ratio: fmt.ratio,
          duration: fmt.duration,
          // 提案外に追加した科目は通常授業で取っていない前提（全コマが講習費の対象）
          regularKoma: 0,
          addedByParent: true,
        };
      }),
    ],
    [extra, extraFormat]
  );

  const addSubject = (s: string) => {
    setExtra((prev) => [...prev, s]);
    setKoma((prev) => ({ ...prev, [s]: 2 }));
    setExtraFormat((prev) => ({ ...prev, [s]: { ratio: 2, duration: 90 } }));
  };
  const removeSubject = (s: string) => {
    setExtra((prev) => prev.filter((x) => x !== s));
    setKoma((prev) => {
      const next = { ...prev };
      delete next[s];
      return next;
    });
    setExtraFormat((prev) => {
      const next = { ...prev };
      delete next[s];
      return next;
    });
  };
  /** 保護者が追加した科目の形式を変更する（決定48） */
  const setSubjectFormat = (subject: string, patch: Partial<{ ratio: 1 | 2; duration: 45 | 90 }>) =>
    setExtraFormat((prev) => ({
      ...prev,
      [subject]: { ...(prev[subject] ?? { ratio: 2, duration: 90 }), ...patch },
    }));

  const totalKoma = lines.reduce((s, l) => s + (koma[l.subject] ?? 0), 0);
  // 月謝に含まれる通常授業ぶん（申込コマを超えては引かない）
  const totalRegular = lines.reduce((s, l) => s + Math.min(koma[l.subject] ?? 0, l.regularKoma), 0);
  const totalChargeable = lines.reduce(
    (s, l) => s + chargeableKoma(koma[l.subject] ?? 0, l.regularKoma),
    0
  );
  const totalFee = lines.reduce(
    (s, l) =>
      s +
      chargeableKoma(koma[l.subject] ?? 0, l.regularKoma) *
        unitPrice(STUDENT.gradeLabel, l.ratio, l.duration),
    0
  );
  const totalCells = dates.length * SLOTS.length;
  const okCells = totalCells - ng.size;

  /**
   * 小集団・プログラミングは参加コースの単価×回数をそのまま合算する。
   * 通常授業の差し引き（chargeableKoma）は個別のみに掛かるので、ここでは一切使わない（決定43）。
   * 途中参加の場合は開始回からの残り回数だけを数える（決定45）。
   */
  const joinedCourses = COURSES.filter((c) => courseJoin.has(c.name));
  const totalCourseFee = joinedCourses.reduce((s, c) => {
    const start = courseStart[c.name] ?? c.sessions[0].date;
    return s + c.unitPrice * remainingSessions(c, start).length;
  }, 0);
  const grandTotal = totalFee + totalCourseFee;

  const toggleCourse = (name: string) =>
    setCourseJoin((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const setCourseStartDate = (name: string, date: string) =>
    setCourseStart((prev) => ({ ...prev, [name]: date }));

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
          {displayState === 'entry' && <EntryScreenMock />}

          {displayState === 'applied' && (
            <AppliedSummaryMock
              lines={lines}
              koma={koma}
              totalKoma={totalKoma}
              totalRegular={totalRegular}
              totalChargeable={totalChargeable}
              totalFee={totalFee}
              joinedCourses={joinedCourses}
              courseStart={courseStart}
              totalCourseFee={totalCourseFee}
              grandTotal={grandTotal}
            />
          )}

          {displayState === 'normal' && (
            <>
              {/* ヘッダ */}
              <div className="sticky top-0 z-10 bg-white border-b border-[var(--stroke)] px-4 py-3">
                <p className="text-[11px] text-[var(--paragraph)]">{PERIOD.label}</p>
                <p className="text-sm font-semibold text-[var(--headline)]">
                  {STUDENT.name}{' '}
                  <span className="text-xs font-normal">（{STUDENT.gradeLabel}）</span>
                </p>
                <div className="flex gap-1 mt-2">
                  {['申込内容', '小集団・プログラミング', '通える日', '確認'].map((label, i) => (
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
                {step === 1 && (
                  <StepSubjects
                    lines={lines}
                    koma={koma}
                    setKoma={setKoma}
                    extra={extra}
                    addSubject={addSubject}
                    removeSubject={removeSubject}
                    setSubjectFormat={setSubjectFormat}
                    totalKoma={totalKoma}
                    totalRegular={totalRegular}
                    totalChargeable={totalChargeable}
                    totalFee={totalFee}
                  />
                )}
                {step === 2 && (
                  <StepCourses
                    courseJoin={courseJoin}
                    toggleCourse={toggleCourse}
                    courseStart={courseStart}
                    setCourseStartDate={setCourseStartDate}
                    totalCourseFee={totalCourseFee}
                  />
                )}
                {step === 3 && (
                  <StepAvailability
                    dates={dates}
                    layout={layout}
                    ng={ng}
                    toggle={toggle}
                    toggleDay={toggleDay}
                    setNg={setNg}
                    okCells={okCells}
                    totalKoma={totalKoma}
                  />
                )}
                {step === 4 && (
                  <StepConfirm
                    lines={lines}
                    koma={koma}
                    totalKoma={totalKoma}
                    totalRegular={totalRegular}
                    totalChargeable={totalChargeable}
                    totalFee={totalFee}
                    okCells={okCells}
                    joinedCourses={joinedCourses}
                    courseStart={courseStart}
                    totalCourseFee={totalCourseFee}
                    grandTotal={grandTotal}
                  />
                )}
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
                  onClick={() => setStep(Math.min(4, step + 1))}
                  disabled={step === 4}
                  className="flex-1 px-3 py-2.5 rounded-lg bg-ink text-white text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-1"
                >
                  {step === 4 ? 'この内容で申し込む' : '次へ'}
                  {step < 4 && <ChevronRight className="w-4 h-4" />}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 右: 切替と確認事項 */}
      <div className="space-y-4">
        <div className="rounded-lg border border-[var(--stroke)] bg-white p-4">
          <h2 className="text-sm font-semibold text-[var(--headline)] mb-2">表示状態</h2>
          <div className="space-y-2">
            {DISPLAY_STATES.map((d) => (
              <label
                key={d.key}
                className={`flex gap-2 items-start p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  displayState === d.key
                    ? 'border-ink bg-gray-50'
                    : 'border-[var(--stroke)] hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="displayState"
                  checked={displayState === d.key}
                  onChange={() => setDisplayState(d.key)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm text-[var(--headline)]">{d.name}</span>
                  <span className="block text-xs text-[var(--paragraph)]">{d.note}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

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
                    setStep(3);
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
            <li>
              コースの開催時間が個別コマの時間帯とズレる場合の座席表上の見え方（決定41は重複判定のみ担保。表示の見せ方は未検討）
            </li>
            <li>
              開始回セレクトの選択肢を保護者に開放してよいか（帰省などの事情がある場合のみ教室に相談してからにするか）（決定45）
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

/**
 * 表示状態「生徒コード入口」（決定19・§10-1）。
 * ポータル経由（/portal/[schoolCode]/koushu）で開いたときに最初に出す本人確認画面。
 * トークン付きURL（/koushu-apply/[token]）から開いた場合はこの画面を経由しない。
 */
function EntryScreenMock() {
  const [code, setCode] = useState('');
  return (
    <div className="h-full flex flex-col justify-center px-6 py-10 space-y-5">
      <div className="text-center space-y-1.5">
        <KeyRound className="w-8 h-8 mx-auto text-[var(--paragraph)]" />
        <h2 className="text-base font-semibold text-[var(--headline)]">生徒コードで開く</h2>
        <p className="text-xs text-[var(--paragraph)]">
          教室から伝えられた生徒コードを入力してください
        </p>
      </div>
      <label className="block text-xs text-[var(--headline)]">
        生徒コード
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="例）A1234"
          className="mt-1 w-full text-sm border border-[var(--stroke)] rounded-lg px-3 py-2.5"
        />
      </label>
      <button className="w-full py-2.5 rounded-lg bg-ink text-white text-sm font-medium">
        開く
      </button>
      <p className="text-[11px] text-[var(--paragraph)] text-center leading-relaxed">
        教室から配られたQR・リンクから開いた場合、この画面は表示されません。
      </p>
    </div>
  );
}

/**
 * 表示状態「申込済み（読み取り専用）」（決定30・§16-2）。
 * 初回送信後に同じリンクを開くと、内容は StepConfirm 相当の見た目で読み取り専用のまま出す。
 * 再提出は教室が「再提出を許可」した場合のみ可能になる（管理側タブ参照）。
 */
function AppliedSummaryMock({
  lines,
  koma,
  totalKoma,
  totalRegular,
  totalChargeable,
  totalFee,
  joinedCourses,
  courseStart,
  totalCourseFee,
  grandTotal,
}: {
  lines: ApplyLine[];
  koma: Record<string, number>;
  totalKoma: number;
  totalRegular: number;
  totalChargeable: number;
  totalFee: number;
  joinedCourses: Course[];
  courseStart: Record<string, string>;
  totalCourseFee: number;
  grandTotal: number;
}) {
  return (
    <div className="px-4 py-4 space-y-3">
      <div className="rounded-lg border border-info bg-info-subtle p-3 flex gap-2">
        <Info className="w-4 h-4 text-info shrink-0 mt-0.5" />
        <p className="text-xs text-[var(--headline)] leading-relaxed">
          申込を受け付けています。変更は教室までご連絡ください（再提出は教室が許可した場合のみ可能になります）。
        </p>
      </div>

      <div className="rounded-xl border border-[var(--stroke)] overflow-hidden">
        <div className="px-3 py-2 bg-gray-50 text-xs font-medium text-[var(--headline)]">
          申込内容
        </div>

        <div className="px-3 pt-2 text-[11px] font-medium text-[var(--paragraph)]">個別</div>
        {lines
          .filter((p) => (koma[p.subject] ?? 0) > 0)
          .map((p) => {
            const n = koma[p.subject] ?? 0;
            const price = unitPrice(STUDENT.gradeLabel, p.ratio, p.duration);
            return (
              <div
                key={p.subject}
                className="px-3 py-2.5 flex items-center justify-between border-t border-[var(--stroke)]"
              >
                <div>
                  <p className="text-sm text-[var(--headline)] flex items-center gap-1.5">
                    {p.subject}
                    {p.addedByParent && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-info-subtle text-info">
                        追加
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-[var(--paragraph)]">
                    {p.ratio === 1 ? '1対1' : '1対2'} / {p.duration}分 ・ {n}コマ
                    {p.regularKoma > 0 && `（うち通常 ${Math.min(n, p.regularKoma)}コマ）`}
                  </p>
                  <p className="text-[11px] text-[var(--paragraph)]">
                    講習費 {chargeableKoma(n, p.regularKoma)}コマ × {yen(price)}
                  </p>
                </div>
                <span className="text-sm font-semibold text-[var(--headline)] tabular-nums">
                  {yen(chargeableKoma(n, p.regularKoma) * price)}
                </span>
              </div>
            );
          })}
        <div className="px-3 py-2.5 border-t border-[var(--stroke)] bg-gray-50 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--headline)]">合計コマ数</span>
            <span className="text-sm font-semibold text-[var(--headline)] tabular-nums">
              {totalKoma}コマ
            </span>
          </div>
          {totalRegular > 0 && (
            <div className="flex items-center justify-between text-xs text-[var(--paragraph)]">
              <span>うち通常授業（月謝に含む）</span>
              <span className="tabular-nums">−{totalRegular}コマ</span>
            </div>
          )}
          <div className="flex items-center justify-between text-xs text-[var(--paragraph)]">
            <span>講習費の対象</span>
            <span className="tabular-nums">{totalChargeable}コマ</span>
          </div>
          <div className="flex items-center justify-between pt-1.5 border-t border-[var(--stroke)]">
            <span className="text-sm text-[var(--headline)]">個別 小計</span>
            <span className="text-base font-semibold text-[var(--headline)] tabular-nums">
              {yen(totalFee)}
            </span>
          </div>
        </div>

        {joinedCourses.length > 0 && (
          <>
            <div className="px-3 pt-2 border-t border-[var(--stroke)] text-[11px] font-medium text-[var(--paragraph)]">
              小集団・プログラミング（差引対象外）
            </div>
            {joinedCourses.map((c) => {
              const start = courseStart[c.name] ?? c.sessions[0].date;
              const remaining = remainingSessions(c, start);
              const fee = c.unitPrice * remaining.length;
              const fullyJoined = startSessionNumber(c, start) === 1;
              return (
                <div
                  key={c.name}
                  className="px-3 py-2.5 flex items-center justify-between border-t border-[var(--stroke)]"
                >
                  <div>
                    <p className="text-sm text-[var(--headline)]">{c.name}</p>
                    <p className="text-[11px] text-[var(--paragraph)]">
                      {fullyJoined
                        ? `${c.formation} ・ ${c.sessions.length}回 × ${yen(c.unitPrice)}`
                        : `${c.formation} ・ 第${startSessionNumber(c, start)}回から参加・残り${remaining.length}回 × ${yen(c.unitPrice)}`}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-[var(--headline)] tabular-nums">
                    {yen(fee)}
                  </span>
                </div>
              );
            })}
            <div className="px-3 py-2.5 border-t border-[var(--stroke)] bg-gray-50 flex items-center justify-between">
              <span className="text-sm text-[var(--headline)]">小集団・プログラミング 小計</span>
              <span className="text-base font-semibold text-[var(--headline)] tabular-nums">
                {yen(totalCourseFee)}
              </span>
            </div>
          </>
        )}

        <div className="px-3 py-3 border-t border-[var(--stroke)] flex items-center justify-between">
          <span className="text-sm font-semibold text-[var(--headline)]">合計</span>
          <span className="text-lg font-semibold text-[var(--headline)] tabular-nums">
            {yen(grandTotal)}
          </span>
        </div>
      </div>

      <p className="text-[11px] text-[var(--paragraph)]">
        通える日の入力内容も送信済みです。日程は教室で組み、決まり次第お知らせします。
      </p>
    </div>
  );
}

/* ---------- ステップ1: 申込内容 ---------- */

function StepSubjects({
  lines,
  koma,
  setKoma,
  extra,
  addSubject,
  removeSubject,
  setSubjectFormat,
  totalKoma,
  totalRegular,
  totalChargeable,
  totalFee,
}: {
  lines: ApplyLine[];
  koma: Record<string, number>;
  setKoma: (updater: (prev: Record<string, number>) => Record<string, number>) => void;
  extra: string[];
  addSubject: (s: string) => void;
  removeSubject: (s: string) => void;
  setSubjectFormat: (subject: string, patch: Partial<{ ratio: 1 | 2; duration: 45 | 90 }>) => void;
  totalKoma: number;
  totalRegular: number;
  totalChargeable: number;
  totalFee: number;
}) {
  const [picking, setPicking] = useState(false);
  const bump = (subject: string, delta: number) =>
    setKoma((prev) => ({ ...prev, [subject]: Math.max(0, (prev[subject] ?? 0) + delta) }));

  const addable = EXTRA_SUBJECTS.filter((s) => !extra.includes(s));

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--paragraph)]">
        教室からの提案です。コマ数を確認して、変更があれば増減してください。
      </p>

      {lines.map((p) => {
        const n = koma[p.subject] ?? 0;
        const price = unitPrice(STUDENT.gradeLabel, p.ratio, p.duration);
        return (
          <div
            key={p.subject}
            className={`rounded-xl border p-3 ${
              p.addedByParent ? 'border-info bg-info-subtle' : 'border-[var(--stroke)]'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--headline)] flex items-center gap-1.5">
                  {p.subject}
                  {p.addedByParent && (
                    <span className="text-[10px] font-normal px-1.5 py-0.5 rounded-full bg-info text-white">
                      追加
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-[var(--paragraph)] truncate">
                  {p.textbook ?? '教材は教室で選びます'}
                </p>
                {p.theme && <p className="text-[11px] text-[var(--paragraph)] mt-0.5">{p.theme}</p>}
              </div>
              {p.addedByParent ? (
                /* 保護者が追加した科目は形式を自分で選べる（決定48・決定25改訂）。
                   単価が0（=価格表に無い組み合わせ）の選択肢は出さない */
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <div className="flex rounded-full border border-[var(--stroke)] overflow-hidden">
                    {([2, 1] as const)
                      .filter((r) => unitPrice(STUDENT.gradeLabel, r, p.duration) > 0)
                      .map((r) => (
                        <button
                          key={r}
                          onClick={() => setSubjectFormat(p.subject, { ratio: r })}
                          className={`px-2 py-0.5 text-[10px] ${
                            p.ratio === r ? 'bg-ink text-white' : 'bg-white text-[var(--paragraph)]'
                          }`}
                        >
                          {r === 1 ? '1対1' : '1対2'}
                        </button>
                      ))}
                  </div>
                  {/* 45分は小1〜小4のみ選択肢に出す（決定17・48）。中2の今は非表示 */}
                  {ALLOW_45 && (
                    <div className="flex rounded-full border border-[var(--stroke)] overflow-hidden">
                      {([90, 45] as const)
                        .filter((d) => unitPrice(STUDENT.gradeLabel, p.ratio, d) > 0)
                        .map((d) => (
                          <button
                            key={d}
                            onClick={() => setSubjectFormat(p.subject, { duration: d })}
                            className={`px-2 py-0.5 text-[10px] ${
                              p.duration === d
                                ? 'bg-ink text-white'
                                : 'bg-white text-[var(--paragraph)]'
                            }`}
                          >
                            {d}分
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              ) : (
                /* 提案由来の科目は教室が決めた形式の表示のみ（決定14。変更希望の運用は用意しない） */
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
              )}
            </div>

            <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--stroke)]">
              <div>
                {!p.addedByParent && (
                  <p className="text-xs text-[var(--paragraph)]">{`提案 ${p.proposedKoma}コマ`}</p>
                )}
                <p className="text-[11px] text-[var(--paragraph)] mt-0.5">1コマ {yen(price)}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => bump(p.subject, -1)}
                  className="w-9 h-9 rounded-full border border-[var(--stroke)] bg-white flex items-center justify-center active:scale-95"
                  aria-label={`${p.subject}を1コマ減らす`}
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="w-10 text-center text-lg font-semibold text-[var(--headline)] tabular-nums">
                  {n}
                </span>
                <button
                  onClick={() => bump(p.subject, 1)}
                  className="w-9 h-9 rounded-full border border-[var(--stroke)] bg-white flex items-center justify-center active:scale-95"
                  aria-label={`${p.subject}を1コマ増やす`}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* 通常授業ぶんは月謝で受け取っているので講習費から差し引く */}
            <div className="mt-2 pt-2 border-t border-[var(--stroke)] space-y-1">
              {p.regularKoma > 0 && (
                <div className="flex items-center justify-between text-[11px] text-[var(--paragraph)]">
                  <span>うち通常授業（月謝に含む）</span>
                  <span className="tabular-nums">−{Math.min(n, p.regularKoma)}コマ</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[var(--paragraph)]">
                  講習費の対象 {chargeableKoma(n, p.regularKoma)}コマ
                </span>
                <span className="text-sm text-[var(--headline)] tabular-nums">
                  {yen(chargeableKoma(n, p.regularKoma) * price)}
                </span>
              </div>
            </div>

            {p.addedByParent && (
              <button
                onClick={() => removeSubject(p.subject)}
                className="mt-2 w-full py-1.5 rounded-lg border border-[var(--stroke)] bg-white text-[11px] text-[var(--paragraph)]"
              >
                この科目をやめる
              </button>
            )}
          </div>
        );
      })}

      {/* 提案外の科目を保護者が足せる（決定: 提案科目以外もやりたい場合がある） */}
      {addable.length > 0 &&
        (picking ? (
          <div className="rounded-xl border border-[var(--stroke)] p-3">
            <p className="text-xs text-[var(--headline)] mb-2">追加する科目を選んでください</p>
            <div className="flex flex-wrap gap-1.5">
              {addable.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    addSubject(s);
                    setPicking(false);
                  }}
                  className="px-3 py-2 rounded-lg border border-[var(--stroke)] text-sm text-[var(--headline)] active:scale-95"
                >
                  {s}
                </button>
              ))}
            </div>
            <button
              onClick={() => setPicking(false)}
              className="mt-2 w-full py-1.5 text-[11px] text-[var(--paragraph)]"
            >
              やめる
            </button>
          </div>
        ) : (
          <button
            onClick={() => setPicking(true)}
            className="w-full py-2.5 rounded-xl border border-dashed border-[var(--stroke)] text-sm text-[var(--headline)] flex items-center justify-center gap-1"
          >
            <Plus className="w-4 h-4" />
            他の科目も追加する
          </button>
        ))}

      <div className="rounded-xl bg-gray-50 p-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--headline)]">合計コマ数</span>
          <span className="text-base font-semibold text-[var(--headline)] tabular-nums">
            {totalKoma}コマ
          </span>
        </div>
        {totalRegular > 0 && (
          <div className="flex items-center justify-between text-xs text-[var(--paragraph)]">
            <span>うち通常授業（月謝に含む）</span>
            <span className="tabular-nums">−{totalRegular}コマ</span>
          </div>
        )}
        <div className="flex items-center justify-between text-xs text-[var(--paragraph)]">
          <span>講習費の対象</span>
          <span className="tabular-nums">{totalChargeable}コマ</span>
        </div>
        <div className="flex items-center justify-between pt-1.5 border-t border-[var(--stroke)]">
          <span className="text-sm text-[var(--headline)]">講習費</span>
          <span className="text-lg font-semibold text-[var(--headline)] tabular-nums">
            {yen(totalFee)}
          </span>
        </div>
        <p className="text-[10px] text-[var(--paragraph)]">
          税込。期間中の通常授業ぶんはお月謝に含まれるため、講習費からは差し引いています。
        </p>
      </div>
    </div>
  );
}

/* ---------- ステップ2: 小集団・プログラミング ---------- */

/**
 * 小集団・プログラミングは日時が固定（決定37）なので、個別のように可能日程を
 * 聞かない。コースカードを見て「参加する」を選ぶだけの単純な操作にする（決定36）。
 * コース料金には通常授業の差し引きを掛けない（決定43）ので、このステップの合計は
 * そのままステップ4の内訳へ乗せる。
 *
 * 途中参加（決定45）: MOCK_TODAY より前の回は開催済みとしてグレー表示し自動で対象外。
 * 参加を選ぶと「参加開始」セレクトが出て、未開催の回から選べる（既定は次の回）。
 * 料金は単価×開始回からの残り回数で再計算する。
 */
function StepCourses({
  courseJoin,
  toggleCourse,
  courseStart,
  setCourseStartDate,
  totalCourseFee,
}: {
  courseJoin: Set<string>;
  toggleCourse: (name: string) => void;
  courseStart: Record<string, string>;
  setCourseStartDate: (name: string, date: string) => void;
  totalCourseFee: number;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--paragraph)]">
        小集団・プログラミングの開催予定です。日程は選べません。参加する講座があれば「参加する」を選んでください。
      </p>

      {COURSES.map((c) => {
        const joined = courseJoin.has(c.name);
        const start = courseStart[c.name] ?? c.sessions[0].date;
        const remaining = remainingSessions(c, start);
        const fee = c.unitPrice * remaining.length;
        const fullyJoined = startSessionNumber(c, start) === 1;
        const options = upcomingSessions(c);
        return (
          <div
            key={c.name}
            className={`rounded-xl border p-3 ${
              joined ? 'border-ink bg-gray-50' : 'border-[var(--stroke)]'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--headline)]">{c.name}</p>
                <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-[var(--paragraph)]">
                  {c.formation}
                </span>
              </div>
            </div>

            <div className="mt-2 rounded-lg border border-warning bg-warning-subtle px-2.5 py-2 flex gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
              <p className="text-[11px] text-[var(--headline)] leading-relaxed">
                日時は決まっており、変更・振替はできません
                <br />
                途中からのご参加もできます（参加回ぶんのみのご請求）
              </p>
            </div>

            {/* 開催予定表。session_dates が配布する予定表そのもの（決定40）。
                開催済み＝グレー＋ラベル、開始回より前（未開催）＝参加しない回として薄く出す（決定45） */}
            <div className="mt-2 rounded-lg border border-[var(--stroke)] overflow-hidden">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="bg-gray-50 text-[var(--paragraph)]">
                    <th className="py-1 px-2 text-left font-medium">日程</th>
                    <th className="py-1 px-2 text-left font-medium">時間</th>
                    <th className="py-1 px-2 text-left font-medium w-16">状態</th>
                  </tr>
                </thead>
                <tbody>
                  {c.sessions.map((s, i) => {
                    const held = isSessionHeld(s.date);
                    const skipped = joined && !held && s.date < start;
                    const rowMuted = held || skipped;
                    return (
                      <tr
                        key={s.date}
                        className={`border-t border-gray-100 ${rowMuted ? 'bg-gray-50' : ''}`}
                      >
                        <td
                          className={`py-1 px-2 ${rowMuted ? 'text-gray-400' : 'text-[var(--headline)]'}`}
                        >
                          第{i + 1}回 {mmdd(s.date)}({WEEKDAY[dow(s.date)]})
                        </td>
                        <td
                          className={`py-1 px-2 tabular-nums ${rowMuted ? 'text-gray-400' : 'text-[var(--headline)]'}`}
                        >
                          {s.start}〜{s.end}
                        </td>
                        <td className="py-1 px-2">
                          {held && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-500">
                              開催済み
                            </span>
                          )}
                          {skipped && (
                            <span className="text-[10px] text-gray-400">参加しない回</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 参加開始セレクト。参加を選んだときだけ出す。選択肢は未開催の回のみ（決定45） */}
            {joined && (
              <label className="block mt-2 text-[11px] text-[var(--paragraph)]">
                参加開始
                <select
                  value={start}
                  onChange={(e) => setCourseStartDate(c.name, e.target.value)}
                  className="mt-1 w-full text-xs border border-[var(--stroke)] rounded-lg px-2 py-1.5 text-[var(--headline)]"
                >
                  {options.map((s) => {
                    const idx = c.sessions.findIndex((x) => x.date === s.date);
                    return (
                      <option key={s.date} value={s.date}>
                        第{idx + 1}回 {mmdd(s.date)}({WEEKDAY[dow(s.date)]})〜
                      </option>
                    );
                  })}
                </select>
              </label>
            )}

            <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--stroke)]">
              <p className="text-[11px] text-[var(--paragraph)]">
                {joined && !fullyJoined ? (
                  <>
                    {yen(c.unitPrice)} × 残り{remaining.length}回（全{c.sessions.length}回中） ={' '}
                    <span className="text-[var(--headline)] font-medium">{yen(fee)}</span>
                  </>
                ) : (
                  <>
                    {yen(c.unitPrice)} × {c.sessions.length}回 ={' '}
                    <span className="text-[var(--headline)] font-medium">{yen(fee)}</span>
                  </>
                )}
              </p>
              <button
                onClick={() => toggleCourse(c.name)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 active:scale-95 ${
                  joined
                    ? 'bg-ink text-white'
                    : 'border border-[var(--stroke)] text-[var(--headline)]'
                }`}
              >
                {joined && <Check className="w-3.5 h-3.5" />}
                {joined ? '参加します' : '参加する'}
              </button>
            </div>
          </div>
        );
      })}

      <div className="rounded-xl bg-gray-50 p-3 flex items-center justify-between">
        <span className="text-sm text-[var(--headline)]">小集団・プログラミング 合計</span>
        <span className="text-base font-semibold text-[var(--headline)] tabular-nums">
          {yen(totalCourseFee)}
        </span>
      </div>
      <p className="text-[10px] text-[var(--paragraph)]">
        税込。通常授業の差し引きはコース料金には適用されません（決定43）。
      </p>
    </div>
  );
}

/* ---------- ステップ3: 通える日 ---------- */

function StepAvailability({
  dates,
  layout,
  ng,
  toggle,
  toggleDay,
  setNg,
  okCells,
  totalKoma,
}: {
  dates: string[];
  layout: AvailLayout;
  ng: Set<string>;
  toggle: (key: string) => void;
  toggleDay: (date: string) => void;
  setNg: (updater: (prev: Set<string>) => Set<string>) => void;
  okCells: number;
  totalKoma: number;
}) {
  return (
    <div className="space-y-3">
      {/* 小集団・プログラミングの枠は自動で避けられるので、個別の可能日程では意識しなくてよい（決定41） */}
      <div className="rounded-lg border border-info bg-info-subtle p-3 flex gap-2">
        <Info className="w-4 h-4 text-info shrink-0 mt-0.5" />
        <p className="text-xs text-[var(--headline)] leading-relaxed">
          小集団・プログラミングの開催枠は自動で回避されます（個別の授業はその時間に入りません）。
        </p>
      </div>

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
      {layout === 'week' && (
        <AvailWeek dates={dates} ng={ng} toggle={toggle} toggleDay={toggleDay} setNg={setNg} />
      )}
      {layout === 'pattern' && <AvailPattern dates={dates} ng={ng} toggle={toggle} />}
    </div>
  );
}

/** セル1つ。○=通える / ×=通えない */
function Cell({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`h-10 rounded-md text-[11px] font-medium border transition-colors flex items-center justify-center gap-0.5 ${
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

/**
 * 案B: 週アコーディオン（採用案）
 *
 * 週ごとに畳んで「その週に何枠×を付けたか」を見出しに出す。8週あっても
 * 一覧の高さが1画面強に収まり、触った週・触っていない週が一目でわかる。
 *
 * 設計上の要点:
 *  - 週は複数同時に開ける（帰省の週と部活の週を見比べたいので単一開閉にしない）
 *  - 週見出しの「まとめて×」で旅行・帰省の週を1タップで落とせる
 *  - 日付ラベルもボタン。その日をまとめて切り替える
 *  - 休講日は注記として残す（日付が飛ぶだけだと入力し忘れと区別できない）
 */
function AvailWeek({
  dates,
  ng,
  toggle,
  toggleDay,
  setNg,
}: {
  dates: string[];
  ng: Set<string>;
  toggle: (k: string) => void;
  toggleDay: (d: string) => void;
  setNg: (updater: (prev: Set<string>) => Set<string>) => void;
}) {
  const weeks = useMemo(() => groupByWeek(dates), [dates]);
  // 初期は第1週だけ開く。以降は保護者が開いた週を保持する
  const [open, setOpen] = useState<Set<number>>(new Set([0]));

  const toggleWeekOpen = (wi: number) =>
    setOpen((prev) => {
      const nextOpen = new Set(prev);
      if (nextOpen.has(wi)) nextOpen.delete(wi);
      else nextOpen.add(wi);
      return nextOpen;
    });

  /**
   * 渡した枠をまとめて×／解除する。
   * 全部×なら解除、そうでなければ全部×（＝押すたびに意味が反転しないよう
   * 「まだ○が残っていれば×にする」を優先する）。
   */
  const toggleKeys = (keys: string[]) =>
    setNg((prev) => {
      const nextNg = new Set(prev);
      const allNg = keys.every((k) => nextNg.has(k));
      for (const k of keys) {
        if (allNg) nextNg.delete(k);
        else nextNg.add(k);
      }
      return nextNg;
    });

  /** 週まるごと（旅行・帰省の週を1タップで落とす用） */
  const toggleWeekAll = (weekDates: string[]) =>
    toggleKeys(weekDates.flatMap((d) => SLOTS.map((s) => cellKey(d, s.no))));

  /** 列＝その週のその時限をまとめて（「1限はいつも部活」を1タップで落とす用） */
  const toggleSlotInWeek = (weekDates: string[], slotNo: number) =>
    toggleKeys(weekDates.map((d) => cellKey(d, slotNo)));

  return (
    <div className="space-y-2">
      {weeks.map((w, wi) => {
        const total = w.dates.length * SLOTS.length;
        const ngCount = w.dates.reduce(
          (n, d) => n + SLOTS.filter((s) => ng.has(cellKey(d, s.no))).length,
          0
        );
        const isOpen = open.has(wi);
        const allNg = ngCount === total;
        // 直前の週との間に空いた休講期間（お盆など）を先に差し込む
        const prev = weeks[wi - 1];
        const gap = prev ? gapBetween(prev.dates[prev.dates.length - 1], w.dates[0]) : null;
        return (
          <Fragment key={w.label}>
            {gap && <ClosedWeekCard from={gap.from} to={gap.to} />}
            <div
              className={`rounded-xl border border-[var(--stroke)] overflow-hidden ${
                allNg ? 'bg-gray-50' : 'bg-white'
              }`}
            >
              <button
                onClick={() => toggleWeekOpen(wi)}
                className="w-full flex items-center justify-between gap-2 px-3 py-3 text-left"
              >
                <span className="min-w-0">
                  <span
                    className={`block text-sm ${allNg ? 'text-gray-400' : 'text-[var(--headline)]'}`}
                  >
                    第{wi + 1}週
                    <span className="ml-1.5 text-[11px] text-[var(--paragraph)]">{w.label}</span>
                  </span>
                  <span className="block text-[11px] mt-0.5">
                    {allNg ? (
                      <span className="text-[var(--paragraph)]">この週は通えない</span>
                    ) : ngCount > 0 ? (
                      <span className="text-warning">
                        {total - ngCount}枠 通える（{ngCount}枠 ×）
                      </span>
                    ) : (
                      <span className="text-success">すべて通える（{total}枠）</span>
                    )}
                  </span>
                </span>
                <ChevronDown
                  className={`w-4 h-4 shrink-0 text-[var(--paragraph)] transition-transform ${isOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {isOpen && (
                <div className="px-2.5 pb-3">
                  <button
                    onClick={() => toggleWeekAll(w.dates)}
                    className="w-full mb-2 py-1.5 rounded-lg border border-[var(--stroke)] text-[11px] text-[var(--headline)] active:scale-[0.99]"
                  >
                    {allNg
                      ? 'この週をすべて「通える」に戻す'
                      : 'この週はすべて通えない（旅行・帰省）'}
                  </button>

                  <div className="grid grid-cols-[46px_repeat(5,1fr)] gap-1">
                    {/* 見出しはどれも押せる＝行と列の一括切替であることを示す */}
                    <div className="text-[9px] text-[var(--paragraph)] flex items-end justify-center pb-1">
                      一括
                    </div>
                    {/* 列の一括: その週のその時限をまとめて（「1限はいつも部活」を1タップ） */}
                    {SLOTS.map((s) => {
                      const colNg = w.dates.every((d) => ng.has(cellKey(d, s.no)));
                      return (
                        <button
                          key={s.no}
                          onClick={() => toggleSlotInWeek(w.dates, s.no)}
                          className={`text-center leading-tight rounded py-0.5 active:scale-95 ${
                            colNg ? 'bg-gray-100' : ''
                          }`}
                          title="この時限をこの週まとめて切替"
                        >
                          <span
                            className={`block text-[10px] ${
                              colNg ? 'text-gray-400 line-through' : 'text-[var(--headline)]'
                            }`}
                          >
                            {s.no}限
                          </span>
                          <span className="block text-[9px] text-[var(--paragraph)]">{s.time}</span>
                        </button>
                      );
                    })}

                    {w.dates.map((d) => {
                      const dayNg = SLOTS.every((s) => ng.has(cellKey(d, s.no)));
                      return (
                        // key は Fragment 側に付ける（内側の要素に付けても兄弟を識別できない）
                        <Fragment key={d}>
                          {/* 行の一括: その日をまとめて切替 */}
                          <button
                            onClick={() => toggleDay(d)}
                            className={`text-[11px] flex items-center justify-center rounded active:scale-95 ${
                              dayNg
                                ? 'text-gray-400 line-through bg-gray-100'
                                : 'text-[var(--headline)] hover:bg-gray-50'
                            }`}
                            title="この日をまとめて切替"
                          >
                            {Number(d.slice(8, 10))}
                            <span className={dow(d) === 6 ? 'text-blue-500' : ''}>
                              ({WEEKDAY[dow(d)]})
                            </span>
                          </button>
                          {SLOTS.map((s) => (
                            <Cell
                              key={s.no}
                              on={!ng.has(cellKey(d, s.no))}
                              label=""
                              onClick={() => toggle(cellKey(d, s.no))}
                            />
                          ))}
                        </Fragment>
                      );
                    })}
                  </div>

                  <ClosedDaysNote weekDates={w.dates} />
                </div>
              )}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * 週と週の間に空いた休講期間（お盆など）を1枚のカードで出す。
 *
 * 稼働日だけを並べるとお盆の1週間が丸ごと消え、第3週(8/3〜8/8)の次が
 * いきなり8/17になる。保護者からは「入力し忘れ？」に見えるので、
 * 選べない期間であることを明示する。
 */
function ClosedWeekCard({ from, to }: { from: string; to: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--stroke)] bg-gray-50 px-3 py-2.5">
      <p className="text-xs text-[var(--paragraph)]">
        {mmdd(from)}〜{mmdd(to)} は休講のため授業がありません
      </p>
    </div>
  );
}

/** その週の中に混ざっている休講日を注記として出す（週まるごとではない場合） */
function ClosedDaysNote({ weekDates }: { weekDates: string[] }) {
  if (weekDates.length === 0) return null;
  const closed: string[] = [];
  const cur = new Date(weekDates[0] + 'T12:00:00');
  const last = new Date(weekDates[weekDates.length - 1] + 'T12:00:00');
  while (cur <= last) {
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const dd = String(cur.getDate()).padStart(2, '0');
    const iso = `${cur.getFullYear()}-${m}-${dd}`;
    if (CLOSED.has(iso)) closed.push(`${Number(m)}/${Number(dd)}`);
    cur.setDate(cur.getDate() + 1);
  }
  if (closed.length === 0) return null;
  return (
    <p className="text-[10px] text-[var(--paragraph)] mt-2 px-1">
      {closed.join('・')} は休講日のため選べません
    </p>
  );
}

/** 直前の週の最終日と次の週の初日の間に空いた休講期間を返す（無ければ null） */
function gapBetween(prevLast: string, nextFirst: string): { from: string; to: string } | null {
  const from = new Date(prevLast + 'T12:00:00');
  from.setDate(from.getDate() + 1);
  const to = new Date(nextFirst + 'T12:00:00');
  to.setDate(to.getDate() - 1);
  if (from > to) return null;
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // 日曜だけの隙間は毎週あるので出さない。2日以上空いたときだけ休講期間とみなす
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (days < 2) return null;
  return { from: iso(from), to: iso(to) };
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

/* ---------- ステップ4: 確認 ---------- */

/**
 * 内訳は「個別（差引後）」と「小集団・プログラミング（差引対象外）」を分けて出し、
 * 最後に合算する（決定43）。コース料金には通常授業の差し引きを一切掛けない。
 */
function StepConfirm({
  lines,
  koma,
  totalKoma,
  totalRegular,
  totalChargeable,
  totalFee,
  okCells,
  joinedCourses,
  courseStart,
  totalCourseFee,
  grandTotal,
}: {
  lines: ApplyLine[];
  koma: Record<string, number>;
  totalKoma: number;
  totalRegular: number;
  totalChargeable: number;
  totalFee: number;
  okCells: number;
  joinedCourses: Course[];
  courseStart: Record<string, string>;
  totalCourseFee: number;
  grandTotal: number;
}) {
  const tight = okCells < totalKoma * 2;
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[var(--stroke)] overflow-hidden">
        <div className="px-3 py-2 bg-gray-50 text-xs font-medium text-[var(--headline)]">
          申込内容
        </div>

        <div className="px-3 pt-2 text-[11px] font-medium text-[var(--paragraph)]">個別</div>
        {lines
          .filter((p) => (koma[p.subject] ?? 0) > 0)
          .map((p) => {
            const n = koma[p.subject] ?? 0;
            const price = unitPrice(STUDENT.gradeLabel, p.ratio, p.duration);
            return (
              <div
                key={p.subject}
                className="px-3 py-2.5 flex items-center justify-between border-t border-[var(--stroke)]"
              >
                <div>
                  <p className="text-sm text-[var(--headline)] flex items-center gap-1.5">
                    {p.subject}
                    {p.addedByParent && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-info-subtle text-info">
                        追加
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-[var(--paragraph)]">
                    {p.ratio === 1 ? '1対1' : '1対2'} / {p.duration}分 ・ {n}コマ
                    {p.regularKoma > 0 && `（うち通常 ${Math.min(n, p.regularKoma)}コマ）`}
                  </p>
                  <p className="text-[11px] text-[var(--paragraph)]">
                    講習費 {chargeableKoma(n, p.regularKoma)}コマ × {yen(price)}
                  </p>
                </div>
                <span className="text-sm font-semibold text-[var(--headline)] tabular-nums">
                  {yen(chargeableKoma(n, p.regularKoma) * price)}
                </span>
              </div>
            );
          })}
        <div className="px-3 py-2.5 border-t border-[var(--stroke)] bg-gray-50 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--headline)]">合計コマ数</span>
            <span className="text-sm font-semibold text-[var(--headline)] tabular-nums">
              {totalKoma}コマ
            </span>
          </div>
          {totalRegular > 0 && (
            <div className="flex items-center justify-between text-xs text-[var(--paragraph)]">
              <span>うち通常授業（月謝に含む）</span>
              <span className="tabular-nums">−{totalRegular}コマ</span>
            </div>
          )}
          <div className="flex items-center justify-between text-xs text-[var(--paragraph)]">
            <span>講習費の対象</span>
            <span className="tabular-nums">{totalChargeable}コマ</span>
          </div>
          <div className="flex items-center justify-between pt-1.5 border-t border-[var(--stroke)]">
            <span className="text-sm text-[var(--headline)]">個別 小計</span>
            <span className="text-base font-semibold text-[var(--headline)] tabular-nums">
              {yen(totalFee)}
            </span>
          </div>
          <p className="text-[10px] text-[var(--paragraph)]">
            税込。期間中の通常授業ぶんはお月謝に含まれるため、講習費からは差し引いています。
          </p>
        </div>

        {joinedCourses.length > 0 && (
          <>
            <div className="px-3 pt-2 border-t border-[var(--stroke)] text-[11px] font-medium text-[var(--paragraph)]">
              小集団・プログラミング（差引対象外）
            </div>
            {joinedCourses.map((c) => {
              const start = courseStart[c.name] ?? c.sessions[0].date;
              const remaining = remainingSessions(c, start);
              const fee = c.unitPrice * remaining.length;
              const fullyJoined = startSessionNumber(c, start) === 1;
              return (
                <div
                  key={c.name}
                  className="px-3 py-2.5 flex items-center justify-between border-t border-[var(--stroke)]"
                >
                  <div>
                    <p className="text-sm text-[var(--headline)]">{c.name}</p>
                    <p className="text-[11px] text-[var(--paragraph)]">
                      {fullyJoined
                        ? `${c.formation} ・ ${c.sessions.length}回 × ${yen(c.unitPrice)}`
                        : `${c.formation} ・ 第${startSessionNumber(c, start)}回から参加・残り${remaining.length}回 × ${yen(c.unitPrice)}`}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-[var(--headline)] tabular-nums">
                    {yen(fee)}
                  </span>
                </div>
              );
            })}
            <div className="px-3 py-2.5 border-t border-[var(--stroke)] bg-gray-50 flex items-center justify-between">
              <span className="text-sm text-[var(--headline)]">小集団・プログラミング 小計</span>
              <span className="text-base font-semibold text-[var(--headline)] tabular-nums">
                {yen(totalCourseFee)}
              </span>
            </div>
          </>
        )}

        <div className="px-3 py-3 border-t border-[var(--stroke)] flex items-center justify-between">
          <span className="text-sm font-semibold text-[var(--headline)]">合計</span>
          <span className="text-lg font-semibold text-[var(--headline)] tabular-nums">
            {yen(grandTotal)}
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

/** 申込はすべて保護者本人によるもの（代行入力は作らない＝決定24） */
const MOCK_STUDENTS = [
  { name: '宮永 心那', grade: '中2', status: 'applied' as const, koma: 26 },
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
  /** 失効・再発行／再提出許可の結果を一時的に出すだけの表示（決定30。ダミーなので状態は持たない） */
  const [notice, setNotice] = useState<string | null>(null);

  const toggleGrade = (v: number) =>
    setGrades((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });

  const flashNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2000);
  };

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
        <div className="flex items-center justify-between gap-2 mb-1">
          <h2 className="text-sm font-semibold text-[var(--headline)]">
            講習提案書（申込リンクの配布と状況）
          </h2>
          {notice && <span className="text-xs text-success shrink-0">{notice}</span>}
        </div>
        <p className="text-xs text-[var(--paragraph)] mb-3">
          生徒ごとにトークンURL／QRを発行して配る。申込状況をここで追う。
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--paragraph)] border-b border-[var(--stroke)]">
              <th className="py-1.5 pr-3 font-medium">生徒</th>
              <th className="py-1.5 pr-3 font-medium">学年</th>
              <th className="py-1.5 pr-3 font-medium">申込</th>
              <th className="py-1.5 pr-3 font-medium">配布</th>
              <th className="py-1.5 font-medium">再提出</th>
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
                <td className="py-2 pr-3">
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
                    <button
                      disabled={!published}
                      onClick={() =>
                        flashNotice(`${s.name}のリンクを失効・再発行しました（モック）`)
                      }
                      className="text-xs px-2 py-1 rounded border border-[var(--stroke)] text-[var(--headline)] disabled:opacity-40 flex items-center gap-1"
                    >
                      <RotateCcw className="w-3 h-3" />
                      失効・再発行
                    </button>
                  </div>
                </td>
                <td className="py-2">
                  {s.status === 'applied' ? (
                    <button
                      onClick={() => flashNotice(`${s.name}の再提出を許可しました（モック）`)}
                      className="text-xs px-2 py-1 rounded border border-[var(--stroke)] text-[var(--headline)] flex items-center gap-1"
                    >
                      <Unlock className="w-3 h-3" />
                      再提出を許可
                    </button>
                  ) : (
                    <span className="text-xs text-[var(--paragraph)]">—</span>
                  )}
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

        {/*
          代行入力は作らない（決定24）。
          教室長が自分で申し込んで取ったように見せる不正を避けるため、機能ごと持たない。
          スマホを使わない家庭には教室の端末を貸し、保護者自身に入力してもらう運用。
        */}
        <p className="text-[11px] text-[var(--paragraph)] mt-3 pt-3 border-t border-[var(--stroke)]">
          教室スタッフによる代行入力は用意しません（不正防止）。スマホを使わない家庭には
          教室の端末を貸し、保護者自身に入力してもらいます。
        </p>
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
            <select
              defaultValue="2"
              className="mt-1 w-full text-sm border border-[var(--stroke)] rounded-lg px-2 py-1.5"
            >
              <option>1</option>
              <option>2</option>
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
          <li>「受験生」ショートカットは中3＋高3でよいか（既卒13を含めるか）</li>
          <li>申込状況は「未／閲覧のみ／済」の3段階でよいか</li>
          <li>再提出許可の通知方法（許可したことを保護者へどう伝えるか）</li>
        </ul>
      </div>
    </div>
  );
}

/* ============================================================
 * 設定（期間・単価）
 * ========================================================== */

/** 公開期間の状態チップ。開始が無ければ未公開、期間内なら公開中、それ以外は終了 */
function publishState(start: string, end: string): 'none' | 'open' | 'closed' {
  if (!start) return 'none';
  const now = new Date();
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : null;
  if (now < startDate) return 'closed';
  if (endDate && now > endDate) return 'closed';
  return 'open';
}

function SettingsMock() {
  /**
   * 公開期間（決定29）。course_prep_periods.apply_publish_start / apply_publish_end のモック。
   * 開始が空＝未公開。フラグを新設せずこの2列だけで非公開を担保する（§12・§16-1）。
   */
  const [publishStart, setPublishStart] = useState('');
  const [publishEnd, setPublishEnd] = useState('');
  /** 3軸単価表（決定26・§15-2）。course_prep_periods.apply_price_table のモック */
  const [priceTable, setPriceTable] = useState<SettingsPriceTable>(INITIAL_SETTINGS_PRICE_TABLE);
  const [saved, setSaved] = useState(false);
  /**
   * 講習期間（決定44）。course_prep_periods.schedule_start_date / schedule_end_date のモック。
   * 開始は全学年共通。終了だけ学年別に上書きできる。
   */
  const [scheduleStart, setScheduleStart] = useState(PERIOD.start);
  const [scheduleEnd, setScheduleEnd] = useState(PERIOD.end);
  /**
   * 学年別の終了日上書き（決定44）。course_prep_periods.schedule_end_by_grade jsonb のモック。
   * grade番号(1〜13) → 'YYYY-MM-DD'。キーが無い学年は scheduleEnd にフォールバックする。
   * 初期値は例として中3・高3だけ入れている。
   */
  const [gradeEndOverrides, setGradeEndOverrides] = useState<Record<number, string>>({
    9: '2026-08-31', // 中3: 過去問演習へ早めに切り替えるため共通より前倒し
    12: '2026-09-05', // 高3: 二次対策の都合で数日短縮
  });
  /** コース設定（決定40・42）。seasonal_courses.unit_price のモック。回数・開催予定は表示のみ */
  const [courseSettings, setCourseSettings] = useState<Course[]>(COURSES);

  const state = publishState(publishStart, publishEnd);

  const updatePrice = (grade: number, key: keyof SettingsPriceRow, raw: string) => {
    const n = Number(raw);
    setPriceTable((prev) => ({
      ...prev,
      [grade]: { ...prev[grade], [key]: Number.isNaN(n) ? 0 : n },
    }));
  };

  const updateGradeEnd = (grade: number, raw: string) =>
    setGradeEndOverrides((prev) => {
      const next = { ...prev };
      if (raw) next[grade] = raw;
      else delete next[grade];
      return next;
    });

  const updateCoursePrice = (name: string, raw: string) => {
    const n = Number(raw);
    setCourseSettings((prev) =>
      prev.map((c) => (c.name === name ? { ...c, unitPrice: Number.isNaN(n) ? 0 : n } : c))
    );
  };

  const handleSave = () => {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-5">
      {/* 公開期間 */}
      <div className="rounded-lg border border-[var(--stroke)] bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--headline)]">公開期間</h2>
            <p className="text-xs text-[var(--paragraph)] mt-0.5">
              course_prep_periods の apply_publish_start / apply_publish_end のモック（決定29）。
              開始が未設定のうちは保護者向けURLが404になり非公開が担保される。
            </p>
          </div>
          <span
            className={`text-xs px-2 py-1 rounded-full shrink-0 ${
              state === 'open'
                ? 'bg-success-subtle text-success'
                : 'bg-gray-100 text-[var(--paragraph)]'
            }`}
          >
            {state === 'open' ? '公開中' : state === 'closed' ? '終了' : '未公開'}
          </span>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-xs text-[var(--headline)]">
            開始
            <input
              type="datetime-local"
              value={publishStart}
              onChange={(e) => setPublishStart(e.target.value)}
              className="mt-1 w-full text-sm border border-[var(--stroke)] rounded-lg px-2 py-1.5"
            />
          </label>
          <label className="text-xs text-[var(--headline)]">
            終了
            <input
              type="datetime-local"
              value={publishEnd}
              onChange={(e) => setPublishEnd(e.target.value)}
              className="mt-1 w-full text-sm border border-[var(--stroke)] rounded-lg px-2 py-1.5"
            />
          </label>
        </div>
      </div>

      {/* 講習期間（学年別終了日） */}
      <div className="rounded-lg border border-[var(--stroke)] bg-white p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--headline)]">講習期間（学年別終了日）</h2>
          <p className="text-xs text-[var(--paragraph)] mt-0.5">
            course_prep_periods.schedule_end_by_grade jsonb のモック（決定44）。
            開始は全学年共通。終了日だけ学年別に上書きできる（決定44）。書いていない学年は共通の終了日。
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-xs text-[var(--headline)]">
            共通の開始日
            <input
              type="date"
              value={scheduleStart}
              onChange={(e) => setScheduleStart(e.target.value)}
              className="mt-1 w-full text-sm border border-[var(--stroke)] rounded-lg px-2 py-1.5"
            />
          </label>
          <label className="text-xs text-[var(--headline)]">
            共通の終了日
            <input
              type="date"
              value={scheduleEnd}
              onChange={(e) => setScheduleEnd(e.target.value)}
              className="mt-1 w-full text-sm border border-[var(--stroke)] rounded-lg px-2 py-1.5"
            />
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--paragraph)] border-b border-[var(--stroke)]">
                <th className="py-1.5 pr-3 font-medium">学年</th>
                <th className="py-1.5 font-medium">終了日（上書き）</th>
              </tr>
            </thead>
            <tbody>
              {GRADES.map((g) => {
                const override = gradeEndOverrides[g.v];
                return (
                  <tr key={g.v} className="border-b border-gray-100 last:border-0">
                    <td className="py-1.5 pr-3 text-[var(--headline)]">{g.label}</td>
                    <td className="py-1.5">
                      <div className="flex items-center gap-2">
                        <input
                          type="date"
                          value={override ?? ''}
                          onChange={(e) => updateGradeEnd(g.v, e.target.value)}
                          className="w-40 text-sm border border-[var(--stroke)] rounded px-1.5 py-1"
                        />
                        {!override && (
                          <span className="text-[11px] text-[var(--paragraph)]">
                            共通どおり（{scheduleEnd}）
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3軸単価エディタ */}
      <div className="rounded-lg border border-[var(--stroke)] bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--headline)]">
              単価（学年 × 形式 × 時間）
            </h2>
            <p className="text-xs text-[var(--paragraph)] mt-0.5">
              45分は小1〜小4のみ（決定17）。それ以外の学年は入力欄を出さない。
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {saved && <span className="text-xs text-success">保存しました（モック）</span>}
            <Button size="sm" onClick={handleSave}>
              保存
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--paragraph)] border-b border-[var(--stroke)]">
                <th className="py-1.5 pr-3 font-medium">学年</th>
                <th className="py-1.5 pr-3 font-medium">1対2 90分</th>
                <th className="py-1.5 pr-3 font-medium">1対1 90分</th>
                <th className="py-1.5 pr-3 font-medium">1対2 45分</th>
                <th className="py-1.5 font-medium">1対1 45分</th>
              </tr>
            </thead>
            <tbody>
              {GRADES.map((g) => {
                const row = priceTable[g.v];
                const allow45 = g.v <= 4;
                return (
                  <tr key={g.v} className="border-b border-gray-100 last:border-0">
                    <td className="py-1.5 pr-3 text-[var(--headline)]">{g.label}</td>
                    <td className="py-1.5 pr-3">
                      <input
                        type="number"
                        value={row['1on2_90']}
                        onChange={(e) => updatePrice(g.v, '1on2_90', e.target.value)}
                        className="w-20 text-sm border border-[var(--stroke)] rounded px-1.5 py-1"
                      />
                    </td>
                    <td className="py-1.5 pr-3">
                      <input
                        type="number"
                        value={row['1on1_90']}
                        onChange={(e) => updatePrice(g.v, '1on1_90', e.target.value)}
                        className="w-20 text-sm border border-[var(--stroke)] rounded px-1.5 py-1"
                      />
                    </td>
                    <td className="py-1.5 pr-3">
                      {allow45 ? (
                        <input
                          type="number"
                          value={row['1on2_45'] ?? 0}
                          onChange={(e) => updatePrice(g.v, '1on2_45', e.target.value)}
                          className="w-20 text-sm border border-[var(--stroke)] rounded px-1.5 py-1"
                        />
                      ) : (
                        <span className="text-[var(--paragraph)]">—</span>
                      )}
                    </td>
                    <td className="py-1.5">
                      {allow45 ? (
                        <input
                          type="number"
                          value={row['1on1_45'] ?? 0}
                          onChange={(e) => updatePrice(g.v, '1on1_45', e.target.value)}
                          className="w-20 text-sm border border-[var(--stroke)] rounded px-1.5 py-1"
                        />
                      ) : (
                        <span className="text-[var(--paragraph)]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-[var(--paragraph)] pt-2 border-t border-[var(--stroke)]">
          単価は form_periods ではなく course_prep_periods に持つ（§16-1）。form_type
          の拡張は不要になった。
        </p>
      </div>

      {/* コース設定（小集団・プログラミング） */}
      <div className="rounded-lg border border-[var(--stroke)] bg-white p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--headline)]">
            コース設定（小集団・プログラミング）
          </h2>
          <p className="text-xs text-[var(--paragraph)] mt-0.5">
            開催予定（session_dates）が配布する予定表の正典。回数×単価が料金になる（決定42）。
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--paragraph)] border-b border-[var(--stroke)]">
                <th className="py-1.5 pr-3 font-medium">コース名</th>
                <th className="py-1.5 pr-3 font-medium">形態</th>
                <th className="py-1.5 pr-3 font-medium">単価</th>
                <th className="py-1.5 pr-3 font-medium">回数</th>
                <th className="py-1.5 font-medium">開催予定</th>
              </tr>
            </thead>
            <tbody>
              {courseSettings.map((c) => (
                <tr key={c.name} className="border-b border-gray-100 last:border-0 align-top">
                  <td className="py-1.5 pr-3 text-[var(--headline)] whitespace-nowrap">{c.name}</td>
                  <td className="py-1.5 pr-3">
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-[var(--paragraph)]">
                      {c.formation}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3">
                    <input
                      type="number"
                      value={c.unitPrice}
                      onChange={(e) => updateCoursePrice(c.name, e.target.value)}
                      className="w-20 text-sm border border-[var(--stroke)] rounded px-1.5 py-1"
                    />
                  </td>
                  <td className="py-1.5 pr-3 text-[var(--paragraph)] whitespace-nowrap">
                    {c.sessions.length}回
                  </td>
                  <td className="py-1.5 text-[11px] text-[var(--paragraph)]">
                    {c.sessions
                      .map((s) => `${mmdd(s.date)}(${WEEKDAY[dow(s.date)]}) ${s.start}〜${s.end}`)
                      .join('、')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-[var(--paragraph)] pt-2 border-t border-[var(--stroke)]">
          回数・開催予定は表示のみ（session_dates
          を直接編集する画面は別途必要）。単価だけこの画面で編集できる。
        </p>
      </div>
    </div>
  );
}
