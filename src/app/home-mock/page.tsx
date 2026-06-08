'use client';

/**
 * 教室長ダッシュボード モック（検討用）
 * ------------------------------------------------------------------
 * docs/classroom-manager-dashboard-draft.md の構成を、すべてダミーデータで可視化したもの。
 * レイアウト・指標の見せ方を目で確認するための叩き台であり、本番ロジックは未接続。
 * 「業務系（日々さばく）」を上段、「経営系（傾向を見る）」を下段に置く2層構成。
 * 検討OKなら本番ルート /home へ昇格し、ダミーを実データ取得に差し替える。
 */

import { useState } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent, CardHeader, CardTitle, Badge } from '@/components/ui';
import {
  Inbox, CalendarDays, AlertTriangle, Users,
  FileText, Repeat, Clock, MessageSquare,
  TrendingUp, TrendingDown, Target, GraduationCap,
  School, CheckCircle2, ChevronRight, Flag, Circle, CalendarPlus, ClipboardList,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell,
} from 'recharts';

/* ============================================================
 * ダミーデータ（本番では API 取得に差し替え）
 * ========================================================== */

// [★] 要対応・期日一覧：今日やることではなく、期日が来るもの・アラート予兆を「網羅的」に列挙。
// 教室長はこれを見て「いつ Google カレンダーに入れるか」を判断する。期日帯(group)でグルーピング表示。
const TASKS = [
  // 期限超過
  { id: 't1', title: 'V模擬（6月実施分）の申込を確定', type: 'apply', meta: '未処理 5件', group: 'overdue', dueText: '6/5 期限切れ', done: false },
  { id: 't2', title: '佐藤美咲の定期面談（前回4/8・2ヶ月超）', type: 'interview', meta: '面談遅延', group: 'overdue', dueText: '5/31 目安', done: false },
  { id: 't3', title: '鈴木健太の退会予兆フォロー（連続欠席3回）', type: 'alert', meta: '要連絡', group: 'overdue', dueText: '至急', done: false },
  // 今週
  { id: 't4', title: '外部模試の申込を取りまとめ', type: 'apply', meta: '8名予定', group: 'thisWeek', dueText: '6/13', done: false },
  { id: 't5', title: '未消化の振替3件を消化期限内に調整', type: 'transfer', meta: '振替待機 3件', group: 'thisWeek', dueText: '6/13', done: false },
  { id: 't6', title: '田中翔太の模試下降フォロー面談', type: 'interview', meta: '偏差値 −6', group: 'thisWeek', dueText: '今週中', done: false },
  { id: 't7', title: '6月分の請求を確定', type: 'procedure', meta: '請求締切', group: 'thisWeek', dueText: '6/15', done: false },
  // 来週
  { id: 't8', title: '夏期講習の申込受付を案内', type: 'koushu', meta: '全生徒', group: 'nextWeek', dueText: '6/20', done: false },
  { id: 't9', title: '高3保護者面談の日程を調整', type: 'interview', meta: '5件', group: 'nextWeek', dueText: '6/20', done: false },
  { id: 't10', title: 'テキストの追加発注', type: 'procedure', meta: '発注締切', group: 'nextWeek', dueText: '6/18', done: false },
  // それ以降
  { id: 't11', title: '8月模試の申込開始準備', type: 'koushu', meta: '要項作成', group: 'later', dueText: '6/25', done: false },
  { id: 't12', title: '高3の継続意思確認（7月更新）', type: 'alert', meta: '9名', group: 'later', dueText: '6/30', done: false },
  { id: 't13', title: '中3 三者面談シーズンの準備', type: 'interview', meta: '日程枠の確保', group: 'later', dueText: '7/1', done: false },
  // 対応済み（チェックで畳まれる例）
  { id: 't14', title: '申込期限が近い講習の確認', type: 'koushu', meta: '2件', group: 'thisWeek', dueText: '6/10', done: true },
] as const;

// タスク種別 → ラベル・アイコン・色（tone は TONE マップのキー）
const TASK_TYPES: Record<string, { label: string; icon: React.ElementType; tone: 'danger' | 'warning' | 'info' | 'primary' | 'neutral' }> = {
  apply: { label: '申込', icon: FileText, tone: 'danger' },
  transfer: { label: '振替', icon: Repeat, tone: 'warning' },
  koushu: { label: '講習', icon: CalendarDays, tone: 'info' },
  interview: { label: '面談', icon: MessageSquare, tone: 'info' },
  alert: { label: 'フォロー', icon: AlertTriangle, tone: 'warning' },
  procedure: { label: '手続き', icon: ClipboardList, tone: 'neutral' },
};

// 期日グループ（カレンダーに入れる優先度の帯）。この順で上から表示する
const DUE_GROUPS = [
  { key: 'overdue', label: '期限超過', tone: 'danger' as const, range: '対応を急ぐ' },
  { key: 'thisWeek', label: '今週', tone: 'warning' as const, range: '〜6/13' },
  { key: 'nextWeek', label: '来週', tone: 'info' as const, range: '6/14〜6/20' },
  { key: 'later', label: 'それ以降', tone: 'primary' as const, range: '6/21〜' },
];

// [A] KPI サマリーカード
const KPIS = [
  { key: 'pending', label: '未処理の申込', value: 5, unit: '件', icon: Inbox, tone: 'danger' as const, sub: '要さばき' },
  { key: 'today', label: '本日の授業', value: 24, unit: 'コマ', icon: CalendarDays, tone: 'info' as const, sub: '出欠未入力 6' },
  { key: 'alert', label: '要対応アラート', value: 7, unit: '件', icon: AlertTriangle, tone: 'warning' as const, sub: '成績・面談' },
  { key: 'students', label: '在籍生徒数', value: 123, unit: '名', icon: Users, tone: 'primary' as const, sub: '前月比 +3' },
];

// 在籍数トレンド（今年 vs 昨年）— 昨対比
const ENROLLMENT_TREND = [
  { month: '7月', thisYear: 104, lastYear: 98 },
  { month: '8月', thisYear: 106, lastYear: 99 },
  { month: '9月', thisYear: 110, lastYear: 103 },
  { month: '10月', thisYear: 113, lastYear: 105 },
  { month: '11月', thisYear: 115, lastYear: 107 },
  { month: '12月', thisYear: 116, lastYear: 108 },
  { month: '1月', thisYear: 118, lastYear: 109 },
  { month: '2月', thisYear: 119, lastYear: 110 },
  { month: '3月', thisYear: 114, lastYear: 106 },
  { month: '4月', thisYear: 120, lastYear: 109 },
  { month: '5月', thisYear: 122, lastYear: 111 },
  { month: '6月', thisYear: 123, lastYear: 112 },
];

// 増減ウォーターフォール：月初 +入会 −退会 ±休復 = 月末
// range=[start,end] の floating bar で増減を表現
const WATERFALL = [
  { name: '月初在籍', range: [0, 118], delta: '118', kind: 'total' as const },
  { name: '新規入会', range: [118, 126], delta: '+8', kind: 'up' as const },
  { name: '退会', range: [121, 126], delta: '−5', kind: 'down' as const },
  { name: '休会復帰', range: [121, 123], delta: '+2', kind: 'up' as const },
  { name: '月末在籍', range: [0, 123], delta: '123', kind: 'total' as const },
];

// 退会率・継続率・着地見込み
const CHURN = { churnRate: 4.1, retentionRate: 95.9, forecast: 128 };

// 在籍目標（予実）。target は取り込み or 手入力で用意する想定
const TARGET = { current: 123, target: 130 };

// 学年構成
const GRADE_DIST = [
  { grade: '小4', count: 6, cat: 'elem' }, { grade: '小5', count: 9, cat: 'elem' }, { grade: '小6', count: 12, cat: 'elem' },
  { grade: '中1', count: 18, cat: 'mid' }, { grade: '中2', count: 21, cat: 'mid' }, { grade: '中3', count: 28, cat: 'mid' },
  { grade: '高1', count: 11, cat: 'high' }, { grade: '高2', count: 9, cat: 'high' }, { grade: '高3', count: 9, cat: 'high' },
];

// 通学校別ランキング（上位）
const SCHOOL_DIST = [
  { name: '第一中学校', count: 22 },
  { name: '中央中学校', count: 18 },
  { name: '東高等学校', count: 14 },
  { name: '西小学校', count: 11 },
  { name: '南中学校', count: 9 },
];

// 平均週回数の分布
const WEEKLY_DIST = [
  { times: '週1', count: 28 },
  { times: '週2', count: 41 },
  { times: '週3', count: 33 },
  { times: '週4', count: 14 },
  { times: '週5+', count: 7 },
];

/* ============================================================
 * カラー（recharts は CSS 変数でなく hex で固定）
 * ========================================================== */
const C = {
  primary: '#2563eb',
  slate: '#94a3b8',
  green: '#22c55e',
  red: '#ef4444',
  amber: '#f59e0b',
  blue: '#3b82f6',
  ink: '#1e3a5f',
};

// tone → Tailwind クラス対応
const TONE: Record<string, { text: string; bg: string; bar: string }> = {
  danger: { text: 'text-danger', bg: 'bg-danger-subtle', bar: 'bg-danger' },
  warning: { text: 'text-warning', bg: 'bg-warning-subtle', bar: 'bg-warning' },
  info: { text: 'text-info', bg: 'bg-info-subtle', bar: 'bg-info' },
  primary: { text: 'text-primary', bg: 'bg-primary-subtle', bar: 'bg-primary' },
  neutral: { text: 'text-text-muted', bg: 'bg-surface-hover', bar: 'bg-text-muted' },
};

/* ============================================================
 * 小コンポーネント
 * ========================================================== */

// セクション見出し
function SectionLabel({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mt-8 mb-3">
      <Icon className="w-5 h-5 text-text-muted" />
      <h2 className="text-base font-bold text-text-heading">{children}</h2>
    </div>
  );
}

// 小さな統計表示
// invert=true のときは「上昇が悪い指標」（例：退会率）として矢印の色を反転する
function MiniStat({ label, value, hint, trend, invert }: { label: string; value: string; hint?: string; trend?: 'up' | 'down'; invert?: boolean }) {
  const upColor = invert ? 'text-danger' : 'text-success';
  const downColor = invert ? 'text-success' : 'text-danger';
  return (
    <div className="flex-1 min-w-[120px]">
      <div className="text-xs text-text-muted">{label}</div>
      <div className="flex items-center gap-1.5 mt-1">
        <span className="text-2xl font-bold text-text-heading">{value}</span>
        {trend === 'up' && <TrendingUp className={`w-4 h-4 ${upColor}`} />}
        {trend === 'down' && <TrendingDown className={`w-4 h-4 ${downColor}`} />}
      </div>
      {hint && <div className="text-xs text-text-faint mt-0.5">{hint}</div>}
    </div>
  );
}

/* ============================================================
 * ページ本体
 * ========================================================== */

export default function HomeMockPage() {
  // タスクの完了状態をローカルで管理（チェックで完了/未完をトグル）
  const [doneIds, setDoneIds] = useState<Set<string>>(() => new Set(TASKS.filter((t) => t.done).map((t) => t.id)));
  const toggleTask = (id: string) =>
    setDoneIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  // 期日帯でグルーピングして表示するため、ここでは done 付与のみ。グループ内の並べ替えは描画時に行う
  const tasks = TASKS.map((t) => ({ ...t, done: doneIds.has(t.id) }));
  const openCount = tasks.filter((t) => !t.done).length;

  const targetPct = Math.round((TARGET.current / TARGET.target) * 100);
  const gradeColor = (cat: string) => (cat === 'elem' ? C.blue : cat === 'mid' ? C.primary : C.ink);
  const maxSchool = Math.max(...SCHOOL_DIST.map((s) => s.count));

  return (
    <AdminLayout headerTitle="ホーム" title="サンプル教室 ダッシュボード">
      {/* モック明示バナー */}
      <div className="mb-6 flex items-center gap-2 rounded-lg border border-warning bg-warning-subtle px-4 py-2 text-sm text-warning">
        <Flag className="w-4 h-4 shrink-0" />
        これは検討用モックです。すべてダミーデータで、実データは未接続です。
      </div>

      {/* ===== 上段：業務系 ===== */}

      {/* [★] 要対応・期日一覧（網羅表示）。期日帯でグルーピングし、各行からカレンダー登録できる */}
      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>要対応・期日一覧</CardTitle>
            <p className="text-xs text-text-muted mt-0.5">期日が来るもの・アラート予兆を網羅。カレンダーにいつ入れるかの判断材料。</p>
          </div>
          <span className="text-sm text-text-muted shrink-0">未対応 <span className="font-bold text-text-heading">{openCount}</span> 件</span>
        </CardHeader>
        <CardContent className="py-2">
          {DUE_GROUPS.map((g) => {
            // このグループの項目（未完を上、完了を下）
            const items = tasks
              .filter((t) => t.group === g.key)
              .sort((a, b) => Number(a.done) - Number(b.done));
            if (items.length === 0) return null;
            const gt = TONE[g.tone];
            return (
              <div key={g.key} className="py-2">
                {/* グループ見出し（期日帯） */}
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${gt.bg} ${gt.text}`}>{g.label}</span>
                  <span className="text-xs text-text-faint">{g.range}・{items.length}件</span>
                </div>
                {items.map((t) => {
                  const def = TASK_TYPES[t.type];
                  const tn = TONE[def.tone];
                  const overdue = t.group === 'overdue' && !t.done;
                  return (
                    <div
                      key={t.id}
                      onClick={() => toggleTask(t.id)}
                      className="flex items-center gap-3 py-2.5 border-b border-border-subtle last:border-0 cursor-pointer hover:bg-surface-hover -mx-2 px-2 rounded-lg transition-colors"
                    >
                      {/* チェック（対応済みにする） */}
                      {t.done ? (
                        <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
                      ) : (
                        <Circle className="w-5 h-5 text-text-faint shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-medium ${t.done ? 'line-through text-text-faint' : 'text-text-body'}`}>
                          {t.title}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-text-faint mt-0.5">
                          <span className={`flex items-center gap-1 ${overdue ? 'text-danger font-medium' : ''}`}>
                            <Clock className="w-3 h-3" />{t.dueText}
                          </span>
                          <span>・{t.meta}</span>
                        </div>
                      </div>
                      {/* 種別バッジ */}
                      <span className={`hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${tn.bg} ${tn.text}`}>
                        <def.icon className="w-3 h-3" />{def.label}
                      </span>
                      {/* カレンダー登録（将来 Google カレンダー連携の入口。今は見た目のみ） */}
                      {!t.done && (
                        <button
                          type="button"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border text-text-muted hover:bg-surface-hover hover:text-primary transition-colors shrink-0"
                        >
                          <CalendarPlus className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">予定に追加</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* [A] KPI サマリーカード */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {KPIS.map((k) => {
          const t = TONE[k.tone];
          return (
            <Card key={k.key} className="cursor-pointer hover:bg-surface-hover transition-colors">
              <CardContent className="py-4">
                <div className="flex items-start justify-between">
                  <div className={`rounded-lg p-2 ${t.bg}`}>
                    <k.icon className={`w-5 h-5 ${t.text}`} />
                  </div>
                  <ChevronRight className="w-4 h-4 text-text-faint" />
                </div>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-text-heading">{k.value}</span>
                  <span className="text-sm text-text-muted">{k.unit}</span>
                </div>
                <div className="mt-0.5 text-sm text-text-body">{k.label}</div>
                <div className="text-xs text-text-faint">{k.sub}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* [D] 掲示板 / [E] アラート（要対応カードはタスクに一本化したため廃止） */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-2">
        <Card>
          <CardHeader><CardTitle>連絡掲示板</CardTitle></CardHeader>
          <CardContent className="text-sm text-text-muted">
            既存 BulletinBoard を配置予定。
            <div className="mt-2 space-y-2">
              <div className="rounded-lg bg-surface-hover px-3 py-2 text-text-body">夏期講習の申込集計を金曜までに確認</div>
              <div className="rounded-lg bg-surface-hover px-3 py-2 text-text-body">面談週間スタート（〜6/20）</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>アラート</CardTitle></CardHeader>
          <CardContent className="text-sm text-text-muted">
            既存 AlertBoard（軽量）を配置予定。
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-2 text-text-body"><AlertTriangle className="w-4 h-4 text-warning" />田中：模試偏差値が前回比 −6</div>
              <div className="flex items-center gap-2 text-text-body"><AlertTriangle className="w-4 h-4 text-warning" />佐藤：面談が2ヶ月未実施</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ===== 下段：経営系 ===== */}
      <SectionLabel icon={TrendingUp}>経営指標 — 動き（フロー・昨対・予実）</SectionLabel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 在籍数トレンド（昨対比） */}
        <Card>
          <CardHeader><CardTitle>在籍数の推移（昨対比）</CardTitle></CardHeader>
          <CardContent>
            <div className="w-full h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={ENROLLMENT_TREND} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#4b5563' }} tickLine={false} />
                  <YAxis domain={[90, 130]} tick={{ fontSize: 11, fill: '#4b5563' }} tickLine={false} axisLine={false} width={32} />
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
                  <Line type="monotone" dataKey="thisYear" name="今年" stroke={C.primary} strokeWidth={2.5} dot={{ r: 2 }} />
                  <Line type="monotone" dataKey="lastYear" name="昨年" stroke={C.slate} strokeWidth={2} strokeDasharray="5 4" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* 増減ウォーターフォール */}
        <Card>
          <CardHeader><CardTitle>今月の増減内訳</CardTitle></CardHeader>
          <CardContent>
            <div className="w-full h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={WATERFALL} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#4b5563' }} tickLine={false} interval={0} />
                  <YAxis domain={[100, 130]} tick={{ fontSize: 11, fill: '#4b5563' }} tickLine={false} axisLine={false} width={32} />
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="range" radius={[4, 4, 4, 4]}>
                    {WATERFALL.map((w, i) => (
                      <Cell key={i} fill={w.kind === 'up' ? C.green : w.kind === 'down' ? C.red : C.slate} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-between px-2 -mt-2 text-xs">
              {WATERFALL.map((w) => (
                <span key={w.name} className={w.kind === 'up' ? 'text-success' : w.kind === 'down' ? 'text-danger' : 'text-text-muted'}>
                  {w.delta}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 率・予実・見込み（3つの小カード） */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
        {/* 退会率・継続率 */}
        <Card>
          <CardContent className="py-5">
            <div className="flex gap-4">
              <MiniStat label="今月の退会率" value={`${CHURN.churnRate}%`} hint="前月 3.4%" trend="up" invert />
              <MiniStat label="継続率" value={`${CHURN.retentionRate}%`} />
            </div>
          </CardContent>
        </Card>

        {/* 着地見込み */}
        <Card>
          <CardContent className="py-5">
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <Target className="w-4 h-4" />期末の着地見込み
            </div>
            <div className="mt-1 text-3xl font-bold text-text-heading">{CHURN.forecast}<span className="text-sm font-normal text-text-muted ml-1">名</span></div>
            <div className="text-xs text-text-faint mt-0.5">直近の純増ペースから外挿</div>
          </CardContent>
        </Card>

        {/* 予実ゲージ（在籍目標） */}
        <Card>
          <CardContent className="py-5">
            <div className="flex items-center justify-between text-xs text-text-muted">
              <span>在籍目標の達成</span>
              <span>{TARGET.current} / {TARGET.target} 名</span>
            </div>
            <div className="mt-2 text-3xl font-bold text-text-heading">{targetPct}%</div>
            <div className="mt-2 h-2.5 w-full rounded-full bg-surface-hover overflow-hidden">
              <div className={`h-full rounded-full ${targetPct >= 100 ? 'bg-success' : 'bg-primary'}`} style={{ width: `${Math.min(targetPct, 100)}%` }} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ===== 経営指標 — 構成（スナップショット） ===== */}
      <SectionLabel icon={GraduationCap}>経営指標 — 構成（今の生徒の内訳）</SectionLabel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 学年構成 */}
        <Card>
          <CardHeader><CardTitle>学年構成</CardTitle></CardHeader>
          <CardContent>
            <div className="w-full h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={GRADE_DIST} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="grade" tick={{ fontSize: 11, fill: '#4b5563' }} tickLine={false} interval={0} />
                  <YAxis tick={{ fontSize: 11, fill: '#4b5563' }} tickLine={false} axisLine={false} width={28} />
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="count" name="人数" radius={[4, 4, 0, 0]}>
                    {GRADE_DIST.map((g, i) => <Cell key={i} fill={gradeColor(g.cat)} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex gap-4 justify-center text-xs text-text-muted mt-1">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: C.blue }} />小学</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: C.primary }} />中学</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: C.ink }} />高校</span>
            </div>
          </CardContent>
        </Card>

        {/* 平均週回数 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>週回数の分布</CardTitle>
            <span className="text-sm text-text-muted">平均 <span className="font-bold text-text-heading">2.4</span> 回</span>
          </CardHeader>
          <CardContent>
            <div className="w-full h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={WEEKLY_DIST} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="times" tick={{ fontSize: 11, fill: '#4b5563' }} tickLine={false} interval={0} />
                  <YAxis tick={{ fontSize: 11, fill: '#4b5563' }} tickLine={false} axisLine={false} width={28} />
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="count" name="人数" fill={C.blue} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 通学校別ランキング */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6 mb-4">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <School className="w-4 h-4 text-text-muted" />
            <CardTitle>通学校別の生徒数（上位）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 py-4">
            {SCHOOL_DIST.map((s) => (
              <div key={s.name} className="flex items-center gap-3">
                <div className="w-28 shrink-0 text-sm text-text-body truncate">{s.name}</div>
                <div className="flex-1 h-5 rounded-md bg-surface-hover overflow-hidden">
                  <div className="h-full rounded-md bg-primary" style={{ width: `${(s.count / maxSchool) * 100}%` }} />
                </div>
                <div className="w-8 text-right text-sm font-medium text-text-heading">{s.count}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* 男女比プレースホルダ（性別データ未整備） */}
        <Card>
          <CardHeader><CardTitle>男女比</CardTitle></CardHeader>
          <CardContent className="flex flex-col items-center justify-center h-[180px] text-center">
            <Users className="w-8 h-8 text-text-faint mb-2" />
            <div className="text-sm text-text-muted">性別データの取り込み後に表示</div>
            <div className="text-xs text-text-faint mt-1">CSV/Excel 一括取り込みで整備予定</div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
