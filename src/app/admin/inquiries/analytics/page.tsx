'use client';

/**
 * 問合せ分析ページ。
 * admin / owner のみアクセス可。
 * 現在選択中の教室IDで getInquiries() を呼び、computeInquiryAnalytics() で集計後に描画する。
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Loading } from '@/components/ui';
import { Button } from '@/components/ui';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import AccessDenied from '@/components/AccessDenied';
import { getInquiries } from '@/lib/api/inquiries';
import { computeInquiryAnalytics, type InquiryAnalytics } from '@/lib/utils/inquiryAnalytics';
import { ArrowLeft, TrendingUp, Users, UserCheck, Clock, Activity } from 'lucide-react';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ComposedChart,
  Line,
} from 'recharts';

// ============================================================
// カラーパレット（home-mock と同じ hex 固定方式）
// ============================================================
const C = {
  primary:  '#2563eb', // 入会
  green:    '#22c55e', // ポジティブ
  amber:    '#f59e0b', // 対応中
  orange:   '#f97316', // 体験没
  slate:    '#94a3b8', // 没 / 補助
  gray:     '#9ca3af', // 連絡不通
  red:      '#ef4444', // ネガティブ
  teal:     '#14b8a6', // 入会率ライン
};

/** ステータス別の Pie スライス色 */
const STATUS_COLORS: Record<string, string> = {
  enrolled:    C.primary,
  in_progress: C.amber,
  trial_lost:  C.orange,
  unreachable: C.slate,
  lost:        C.gray,
};

/** ファネル棒グラフの色（段階が進むほど濃いブルー系） */
const FUNNEL_COLORS = ['#93c5fd', '#60a5fa', '#3b82f6', '#1d4ed8'];

/** 共通ツールチップスタイル（home-mock に準拠） */
const TOOLTIP_STYLE = {
  backgroundColor: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  fontSize: 12,
};

// ============================================================
// 小コンポーネント
// ============================================================

/** サマリー小カード */
function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
  iconColor,
  iconBg,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  iconColor: string;
  iconBg: string;
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-start gap-3">
          <div className={`rounded-lg p-2 shrink-0 ${iconBg}`}>
            <Icon className={`w-5 h-5 ${iconColor}`} />
          </div>
          <div className="min-w-0">
            <div className="text-xs text-text-muted">{label}</div>
            <div className="text-2xl font-bold text-text-heading mt-0.5">{value}</div>
            {sub && <div className="text-xs text-text-faint mt-0.5">{sub}</div>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** セクション見出し */
function SectionTitle({
  icon: Icon,
  children,
}: {
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mt-8 mb-3">
      <Icon className="w-4 h-4 text-text-muted" />
      <h2 className="text-sm font-bold text-text-heading">{children}</h2>
    </div>
  );
}

/** PieChart 用カスタムラベル（ドーナツ外側に % 表示） */
function PieLabel({
  cx,
  cy,
  midAngle,
  outerRadius,
  percent,
  name,
}: {
  cx: number;
  cy: number;
  midAngle: number;
  outerRadius: number;
  percent: number;
  name: string;
}) {
  if (percent < 0.04) return null; // 4% 未満は非表示（重なり防止）
  const RADIAN = Math.PI / 180;
  const radius = outerRadius + 22;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
      style={{ fontSize: 11, fill: '#4b5563' }}
    >
      {name} {Math.round(percent * 100)}%
    </text>
  );
}

// ============================================================
// メインページ
// ============================================================

export default function InquiryAnalyticsPage() {
  const { profile, getSelectedSchoolIds, selectedSchoolId } = useAuth();

  // ロールガード: admin / owner のみ
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner';

  const [analytics, setAnalytics] = useState<InquiryAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // ---- 期間フィルタ状態 ----
  const [inputFrom, setInputFrom] = useState('');
  const [inputTo, setInputTo] = useState('');
  // 「適用」ボタンで確定する値（空=全期間）
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');

  // ---- データ取得＆集計 ----
  const fetchAndCompute = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const ids = getSelectedSchoolIds();
      if (ids.length === 0) {
        setErrorMessage('教室が選択されていません');
        setIsLoading(false);
        return;
      }

      // 期間フィルタを組み立てる（空文字は渡さない）
      const filters: { dateFrom?: string; dateTo?: string } = {};
      if (appliedFrom) filters.dateFrom = appliedFrom;
      if (appliedTo) filters.dateTo = appliedTo;

      const data = await getInquiries(ids, filters);
      setAnalytics(computeInquiryAnalytics(data));
    } catch (err) {
      setErrorMessage(getUserErrorMessage(err, 'データの取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds, appliedFrom, appliedTo]);

  // 教室変更または適用済みフィルタ変更で再取得する
  useEffect(() => {
    if (selectedSchoolId !== null) {
      fetchAndCompute();
    }
  }, [fetchAndCompute, selectedSchoolId]);

  // ---- ロールガード ----
  if (profile && !isAdmin) {
    return <AccessDenied />;
  }

  return (
    <AdminLayout headerTitle="問合せ分析">
      <div className="max-w-5xl mx-auto px-4 py-6">

        {/* ---- 戻るリンク ---- */}
        <div className="mb-4">
          <Link
            href="/admin/inquiries"
            className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-primary transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            問合せ一覧に戻る
          </Link>
        </div>

        {/* ---- 期間フィルタ ---- */}
        <Card className="mb-6">
          <CardContent className="py-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">期間（開始）</label>
                <input
                  type="date"
                  value={inputFrom}
                  onChange={(e) => setInputFrom(e.target.value)}
                  className="border border-border rounded-lg px-3 py-1.5 text-sm text-text-body bg-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">期間（終了）</label>
                <input
                  type="date"
                  value={inputTo}
                  onChange={(e) => setInputTo(e.target.value)}
                  className="border border-border rounded-lg px-3 py-1.5 text-sm text-text-body bg-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <Button
                onClick={() => {
                  setAppliedFrom(inputFrom);
                  setAppliedTo(inputTo);
                }}
              >
                適用
              </Button>
              {(appliedFrom || appliedTo) && (
                <button
                  onClick={() => {
                    setInputFrom('');
                    setInputTo('');
                    setAppliedFrom('');
                    setAppliedTo('');
                  }}
                  className="text-xs text-text-muted underline hover:text-primary"
                >
                  クリア
                </button>
              )}
              {(appliedFrom || appliedTo) && (
                <span className="text-xs text-text-muted">
                  {appliedFrom || '—'} 〜 {appliedTo || '—'} で絞り込み中
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ---- ローディング ---- */}
        {isLoading && <Loading />}

        {/* ---- エラー ---- */}
        {!isLoading && errorMessage && (
          <div className="rounded-xl border border-danger/30 bg-danger-subtle px-4 py-3 text-sm text-danger">
            {errorMessage}
          </div>
        )}

        {/* ---- データなし ---- */}
        {!isLoading && !errorMessage && analytics && analytics.total === 0 && (
          <div className="py-20 text-center text-text-muted text-sm">
            データがありません
          </div>
        )}

        {/* ---- 分析コンテンツ ---- */}
        {!isLoading && !errorMessage && analytics && analytics.total > 0 && (
          <>
            {/* == 1. サマリーカード == */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
              <SummaryCard
                icon={Users}
                label="総問合せ"
                value={`${analytics.total.toLocaleString()} 件`}
                iconColor="text-primary"
                iconBg="bg-primary/10"
              />
              <SummaryCard
                icon={UserCheck}
                label="入会"
                value={`${(analytics.statusCounts.find((s) => s.status === 'enrolled')?.count ?? 0).toLocaleString()} 件`}
                iconColor="text-success"
                iconBg="bg-success/10"
              />
              <SummaryCard
                icon={TrendingUp}
                label="入会率"
                value={
                  analytics.total > 0
                    ? `${Math.round(
                        ((analytics.statusCounts.find((s) => s.status === 'enrolled')?.count ?? 0) /
                          analytics.total) *
                          100
                      )} %`
                    : '— %'
                }
                iconColor="text-teal-500"
                iconBg="bg-teal-50"
              />
              <SummaryCard
                icon={Activity}
                label="対応中"
                value={`${(analytics.statusCounts.find((s) => s.status === 'in_progress')?.count ?? 0).toLocaleString()} 件`}
                iconColor="text-warning"
                iconBg="bg-warning/10"
              />
            </div>

            {/* == 2. 決着内訳(Pie) + 3. ファネル(Bar) == */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">

              {/* 決着内訳 ドーナツ */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">決着内訳</CardTitle>
                </CardHeader>
                <CardContent className="py-4">
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie
                        data={analytics.statusCounts}
                        dataKey="count"
                        nameKey="label"
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={2}
                        labelLine={false}
                        label={(props) => (
                          <PieLabel
                            cx={props.cx as number}
                            cy={props.cy as number}
                            midAngle={props.midAngle as number}
                            outerRadius={props.outerRadius as number}
                            percent={props.percent as number}
                            name={props.name as string}
                          />
                        )}
                      >
                        {analytics.statusCounts.map((entry) => (
                          <Cell
                            key={entry.status}
                            fill={STATUS_COLORS[entry.status] ?? C.slate}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        formatter={(value) => [`${value} 件`]}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: 12 }}
                        iconType="circle"
                        iconSize={8}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* ファネル 横棒 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">ファネル（問合せ → 入会）</CardTitle>
                </CardHeader>
                <CardContent className="py-4">
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart
                      layout="vertical"
                      data={analytics.funnel}
                      margin={{ top: 4, right: 60, bottom: 4, left: 16 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 11, fill: '#4b5563' }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="stage"
                        tick={{ fontSize: 12, fill: '#4b5563' }}
                        tickLine={false}
                        axisLine={false}
                        width={48}
                      />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        formatter={(value, _name, item) => {
                          // ファネルの rate を補足表示する
                          const rate = (item as { payload?: { rate?: number } }).payload?.rate ?? 0;
                          return [`${value} 件（前段比 ${rate}%）`, '件数'];
                        }}
                      />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]} label={{ position: 'right', fontSize: 11, fill: '#4b5563', formatter: (v: unknown) => String(v) }}>
                        {analytics.funnel.map((_, i) => (
                          <Cell key={i} fill={FUNNEL_COLORS[i] ?? C.primary} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* == 4. 月次推移 ComposedChart == */}
            <SectionTitle icon={TrendingUp}>月次推移</SectionTitle>
            <Card>
              <CardContent className="py-4">
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={analytics.monthly} margin={{ top: 4, right: 40, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 11, fill: '#4b5563' }}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    {/* 左軸: 件数 */}
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: 11, fill: '#4b5563' }}
                      tickLine={false}
                      axisLine={false}
                      width={32}
                    />
                    {/* 右軸: 入会率(%) */}
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 11, fill: C.teal }}
                      tickLine={false}
                      axisLine={false}
                      width={36}
                      unit="%"
                      domain={[0, 100]}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(value, name) => {
                        if (name === '入会率') return [`${value}%`, name as string];
                        return [`${value} 件`, name as string];
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
                    <Bar yAxisId="left" dataKey="inquiries" name="問合せ" fill={C.primary} opacity={0.4} radius={[3, 3, 0, 0]} />
                    <Bar yAxisId="left" dataKey="enrolled" name="入会" fill={C.green} radius={[3, 3, 0, 0]} />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="rate"
                      name="入会率"
                      stroke={C.teal}
                      strokeWidth={2}
                      dot={{ r: 2.5, fill: C.teal }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* == 5. 媒体別 BarChart == */}
            <SectionTitle icon={Activity}>媒体別</SectionTitle>
            <Card>
              <CardContent className="py-4">
                <ResponsiveContainer width="100%" height={Math.max(200, analytics.byMedia.length * 40 + 60)}>
                  <BarChart
                    layout="vertical"
                    data={analytics.byMedia}
                    margin={{ top: 4, right: 80, bottom: 4, left: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 11, fill: '#4b5563' }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="media"
                      tick={{ fontSize: 11, fill: '#4b5563' }}
                      tickLine={false}
                      axisLine={false}
                      width={80}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(value, name) => {
                        if (name === '入会率') return [`${value}%`, name as string];
                        return [`${value} 件`, name as string];
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
                    <Bar dataKey="count" name="問合せ数" fill={C.primary} opacity={0.5} radius={[0, 4, 4, 0]}
                      label={{ position: 'right', fontSize: 10, fill: '#4b5563', formatter: (v: unknown) => String(v) }} />
                    <Bar dataKey="enrolled" name="入会数" fill={C.green} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>

                {/* 入会率・連絡不通率をテキスト表示（棒グラフに乗せるには複雑なため補足表示） */}
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-xs text-text-body border-collapse">
                    <thead>
                      <tr className="border-b border-border-subtle">
                        <th className="text-left py-1.5 pr-4 font-medium text-text-muted">媒体</th>
                        <th className="text-right py-1.5 pr-4 font-medium text-text-muted">問合せ</th>
                        <th className="text-right py-1.5 pr-4 font-medium text-text-muted">入会</th>
                        <th className="text-right py-1.5 pr-4 font-medium text-text-muted">入会率</th>
                        <th className="text-right py-1.5 font-medium text-text-muted">連絡不通率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.byMedia.map((row) => (
                        <tr key={row.media} className="border-b border-border-subtle last:border-0">
                          <td className="py-1.5 pr-4 font-medium">{row.media}</td>
                          <td className="text-right py-1.5 pr-4">{row.count.toLocaleString()}</td>
                          <td className="text-right py-1.5 pr-4">{row.enrolled.toLocaleString()}</td>
                          <td className="text-right py-1.5 pr-4">{row.enrollRate}%</td>
                          <td className="text-right py-1.5">{row.unreachableRate}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* == 6. リードタイム スタットカード == */}
            <SectionTitle icon={Clock}>リードタイム</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* 問合せ → 入会 */}
              <Card>
                <CardContent className="py-4">
                  <div className="text-xs text-text-muted mb-1">問合せ → 入会</div>
                  {analytics.leadTime.inquiryToEnroll.n > 0 ? (
                    <>
                      <div className="flex items-baseline gap-2 mt-1">
                        <span className="text-2xl font-bold text-text-heading">
                          {analytics.leadTime.inquiryToEnroll.median} 日
                        </span>
                        <span className="text-xs text-text-muted">中央値</span>
                      </div>
                      <div className="text-sm text-text-body mt-1">
                        平均 {analytics.leadTime.inquiryToEnroll.avg} 日
                        <span className="text-xs text-text-faint ml-2">
                          （n={analytics.leadTime.inquiryToEnroll.n} 件）
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-text-faint mt-1">集計対象なし</div>
                  )}
                </CardContent>
              </Card>

              {/* 体験 → 入会 */}
              <Card>
                <CardContent className="py-4">
                  <div className="text-xs text-text-muted mb-1">体験 → 入会</div>
                  {analytics.leadTime.trialToEnroll.n > 0 ? (
                    <>
                      <div className="flex items-baseline gap-2 mt-1">
                        <span className="text-2xl font-bold text-text-heading">
                          {analytics.leadTime.trialToEnroll.median} 日
                        </span>
                        <span className="text-xs text-text-muted">中央値</span>
                      </div>
                      <div className="text-sm text-text-body mt-1">
                        平均 {analytics.leadTime.trialToEnroll.avg} 日
                        <span className="text-xs text-text-faint ml-2">
                          （n={analytics.leadTime.trialToEnroll.n} 件）
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-text-faint mt-1">集計対象なし</div>
                  )}
                </CardContent>
              </Card>
            </div>

          </>
        )}
      </div>
    </AdminLayout>
  );
}
