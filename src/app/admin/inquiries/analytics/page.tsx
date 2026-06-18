'use client';

/**
 * 問合せ分析ページ。
 * admin / owner のみアクセス可。
 * InquiryPeriodPicker で期間を選択（デフォルト: 今年）し、即時再取得する。
 * 「去年と比較」トグル ON のとき、今年と前年を並列取得してサマリーカードと
 * 月次推移チャートに前年系列を重ねて表示する。
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Loading } from '@/components/ui';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import AccessDenied from '@/components/AccessDenied';
import { getInquiries } from '@/lib/api/inquiries';
import { computeInquiryAnalytics, type InquiryAnalytics } from '@/lib/utils/inquiryAnalytics';
import { InquiryPeriodPicker } from '@/components/inquiries/InquiryPeriodPicker';
import {
  resolvePeriod,
  shiftByYear,
  type PeriodPreset,
  type ResolvedPeriod,
} from '@/lib/utils/inquiryPeriod';
import { ArrowLeft, TrendingUp, Users, UserCheck, Clock, Activity, MapPin, XCircle } from 'lucide-react';
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
  // 前年比較用（今年より薄い系列）
  primaryPrev: '#93c5fd',
  greenPrev:   '#86efac',
  tealPrev:    '#5eead4',
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

/** 失注理由ドーナツの色（グレー〜オレンジ系で没感を表現） */
const LOST_REASON_COLORS = ['#94a3b8', '#f97316', '#f59e0b', '#6b7280', '#a78bfa'];

/** 共通ツールチップスタイル（home-mock に準拠） */
const TOOLTIP_STYLE = {
  backgroundColor: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  fontSize: 12,
};

// ============================================================
// 前年比ヘルパー
// ============================================================

/**
 * 前年との差分を "+12" / "−3" / "±0" 形式の文字列と符号クラスで返す。
 * @param current 今年の値
 * @param previous 前年の値（null なら比較なし）
 * @param isRate パーセンテージ差の場合は "pt" を付ける
 */
function diffLabel(
  current: number,
  previous: number | null,
  isRate = false
): { text: string; cls: string } | null {
  if (previous === null) return null;
  const diff = current - previous;
  const suffix = isRate ? 'pt' : '';
  if (diff > 0) return { text: `+${diff}${suffix}`, cls: 'text-success' };
  if (diff < 0) return { text: `${diff}${suffix}`, cls: 'text-danger' };
  return { text: `±0${suffix}`, cls: 'text-text-muted' };
}

// ============================================================
// 小コンポーネント
// ============================================================

/** サマリー小カード（比較モード対応） */
function SummaryCard({
  icon: Icon,
  label,
  value,
  prevValue,
  sub,
  iconColor,
  iconBg,
  isRate = false,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  prevValue?: string | null;
  sub?: string;
  iconColor: string;
  iconBg: string;
  isRate?: boolean;
}) {
  // 前年比を数値で持てる場合に差分ラベルを出す
  const currentNum = parseFloat(value.replace(/[^0-9.-]/g, ''));
  const previousNum = prevValue ? parseFloat(prevValue.replace(/[^0-9.-]/g, '')) : null;
  const diff = !isNaN(currentNum) && previousNum !== null && !isNaN(previousNum)
    ? diffLabel(Math.round(currentNum), Math.round(previousNum), isRate)
    : null;

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-start gap-3">
          <div className={`rounded-lg p-2 shrink-0 ${iconBg}`}>
            <Icon className={`w-5 h-5 ${iconColor}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-text-muted">{label}</div>
            {/* 今年の値 */}
            <div className="text-2xl font-bold text-text-heading mt-0.5">{value}</div>
            {/* 前年の値 + 差分（比較モード時） */}
            {prevValue != null && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-text-muted">前年: {prevValue}</span>
                {diff && (
                  <span className={`text-xs font-medium ${diff.cls}`}>{diff.text}</span>
                )}
              </div>
            )}
            {sub && !prevValue && (
              <div className="text-xs text-text-faint mt-0.5">{sub}</div>
            )}
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
// データ取得ヘルパー
// ============================================================

/** getInquiries の filters 用に period を変換する */
function periodToFilters(period: ResolvedPeriod): { dateFrom?: string; dateTo?: string } {
  const f: { dateFrom?: string; dateTo?: string } = {};
  if (period.dateFrom) f.dateFrom = period.dateFrom;
  if (period.dateTo)   f.dateTo   = period.dateTo;
  return f;
}

// ============================================================
// メインページ
// ============================================================

export default function InquiryAnalyticsPage() {
  const { profile, getSelectedSchoolIds, selectedSchoolId } = useAuth();

  // ロールガード: admin / owner のみ
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';

  // ---- 分析結果ステート ----
  const [current, setCurrent] = useState<InquiryAnalytics | null>(null);
  const [previous, setPrevious] = useState<InquiryAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // ---- 期間ピッカー状態（デフォルト: 今年） ----
  const [preset, setPreset] = useState<PeriodPreset>('this_year');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // ---- 比較モード ----
  const [compare, setCompare] = useState(false);

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

      const period = resolvePeriod(preset, customFrom, customTo);

      if (compare) {
        // 比較モード: 今年と前年を並列取得する
        const prevPeriod = shiftByYear(period, -1);

        // all_time など境界なしの期間は前年取得をスキップして null にする
        const canCompare = period.dateFrom !== '' || period.dateTo !== '';

        const [currentData, previousData] = await Promise.all([
          getInquiries(ids, periodToFilters(period)),
          canCompare
            ? getInquiries(ids, periodToFilters(prevPeriod)).catch(() => null)
            : Promise.resolve(null),
        ]);

        setCurrent(computeInquiryAnalytics(currentData));
        setPrevious(previousData !== null ? computeInquiryAnalytics(previousData) : null);
      } else {
        // 通常モード: 今年のみ取得する
        const data = await getInquiries(ids, periodToFilters(period));
        setCurrent(computeInquiryAnalytics(data));
        setPrevious(null);
      }
    } catch (err) {
      setErrorMessage(getUserErrorMessage(err, 'データの取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds, preset, customFrom, customTo, compare]);

  // 教室変更または期間・比較モード変更で即時再取得する（適用ボタン廃止）
  useEffect(() => {
    if (selectedSchoolId !== null) {
      fetchAndCompute();
    }
  }, [fetchAndCompute, selectedSchoolId]);

  /**
   * ピッカーの onChange ハンドラ。
   * preset / customFrom / customTo をまとめて更新し、再取得をトリガーする。
   */
  const handlePeriodChange = (
    newPreset: PeriodPreset,
    newCustomFrom: string,
    newCustomTo: string
  ) => {
    setPreset(newPreset);
    setCustomFrom(newCustomFrom);
    setCustomTo(newCustomTo);
  };

  // ---- ロールガード ----
  if (profile && !isAdmin) {
    return <AccessDenied />;
  }

  // ---- サマリー値の抽出ヘルパー ----
  const getCount = (a: InquiryAnalytics | null, status: string): number =>
    a?.statusCounts.find((s) => s.status === status)?.count ?? 0;

  const getEnrollRate = (a: InquiryAnalytics | null): number => {
    if (!a || a.total === 0) return 0;
    return Math.round((getCount(a, 'enrolled') / a.total) * 100);
  };

  // ---- 月次推移の2系列マージ（比較モード時） ----
  // 今年の月次データに前年の同月データをマージして recharts に渡す
  const monthlyMerged = (() => {
    if (!current) return [];
    if (!compare || !previous) {
      // 通常モード: 今年のみ
      return current.monthly.map((p) => ({
        month: p.month,
        inquiries: p.inquiries,
        enrolled:  p.enrolled,
        rate:      p.rate,
        inquiriesPrev: undefined as number | undefined,
        enrolledPrev:  undefined as number | undefined,
        ratePrev:      undefined as number | undefined,
      }));
    }

    // 前年の月ごとデータを "YYYY-MM" → point にマップ化する
    const prevMap = new Map(previous.monthly.map((p) => [p.month, p]));

    // 今年の月 "2026-01" → 前年の月 "2025-01" へ変換するユーティリティ
    const toPrevMonth = (month: string) => {
      const [y, m] = month.split('-');
      return `${Number(y) - 1}-${m}`;
    };

    return current.monthly.map((p) => {
      const prev = prevMap.get(toPrevMonth(p.month));
      return {
        month: p.month,
        inquiries: p.inquiries,
        enrolled:  p.enrolled,
        rate:      p.rate,
        inquiriesPrev: prev?.inquiries,
        enrolledPrev:  prev?.enrolled,
        ratePrev:      prev?.rate,
      };
    });
  })();

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

        {/* ---- 期間ピッカー（適用ボタン廃止・即時反映） ---- */}
        <Card className="mb-6">
          <CardContent className="py-4">
            <InquiryPeriodPicker
              preset={preset}
              customFrom={customFrom}
              customTo={customTo}
              onChange={handlePeriodChange}
              showCompare={true}
              compare={compare}
              onCompareChange={setCompare}
            />
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
        {!isLoading && !errorMessage && current && current.total === 0 && (
          <div className="py-20 text-center text-text-muted text-sm">
            データがありません
          </div>
        )}

        {/* ---- 分析コンテンツ ---- */}
        {!isLoading && !errorMessage && current && current.total > 0 && (
          <>
            {/* == 1. サマリーカード == */}
            {/* 比較モード ON のとき各カードに前年値と前年比を表示する */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
              <SummaryCard
                icon={Users}
                label="総問合せ"
                value={`${current.total.toLocaleString()} 件`}
                prevValue={compare && previous ? `${previous.total.toLocaleString()} 件` : null}
                iconColor="text-primary"
                iconBg="bg-primary/10"
              />
              <SummaryCard
                icon={UserCheck}
                label="入会"
                value={`${getCount(current, 'enrolled').toLocaleString()} 件`}
                prevValue={
                  compare && previous
                    ? `${getCount(previous, 'enrolled').toLocaleString()} 件`
                    : null
                }
                iconColor="text-success"
                iconBg="bg-success/10"
              />
              <SummaryCard
                icon={TrendingUp}
                label="入会率"
                value={current.total > 0 ? `${getEnrollRate(current)} %` : '— %'}
                prevValue={
                  compare && previous
                    ? previous.total > 0 ? `${getEnrollRate(previous)} %` : '— %'
                    : null
                }
                iconColor="text-teal-500"
                iconBg="bg-teal-50"
                isRate={true}
              />
              <SummaryCard
                icon={Activity}
                label="対応中"
                value={`${getCount(current, 'in_progress').toLocaleString()} 件`}
                prevValue={
                  compare && previous
                    ? `${getCount(previous, 'in_progress').toLocaleString()} 件`
                    : null
                }
                iconColor="text-warning"
                iconBg="bg-warning/10"
              />
            </div>

            {/* == 2. 決着内訳(Pie) + 3. ファネル(Bar) == */}
            {/* 比較モードでも現期間のみ表示する */}
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
                        data={current.statusCounts}
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
                        {current.statusCounts.map((entry) => (
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
                      data={current.funnel}
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
                          const rate = (item as { payload?: { rate?: number } }).payload?.rate ?? 0;
                          return [`${value} 件（前段比 ${rate}%）`, '件数'];
                        }}
                      />
                      <Bar
                        dataKey="count"
                        radius={[0, 4, 4, 0]}
                        label={{
                          position: 'right',
                          fontSize: 11,
                          fill: '#4b5563',
                          formatter: (v: unknown) => String(v),
                        }}
                      >
                        {current.funnel.map((_, i) => (
                          <Cell key={i} fill={FUNNEL_COLORS[i] ?? C.primary} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* == 4. 月次推移 ComposedChart == */}
            {/* 比較モード ON のとき今年・前年の2系列を重ねて表示する */}
            <SectionTitle icon={TrendingUp}>月次推移</SectionTitle>
            <Card>
              <CardContent className="py-4">
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart
                    data={monthlyMerged}
                    margin={{ top: 4, right: 40, bottom: 4, left: 0 }}
                  >
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
                        if (String(name).includes('入会率')) return [`${value}%`, name as string];
                        return [`${value} 件`, name as string];
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />

                    {/* 今年の棒グラフ */}
                    <Bar
                      yAxisId="left"
                      dataKey="inquiries"
                      name="問合せ（今年）"
                      fill={C.primary}
                      opacity={0.4}
                      radius={[3, 3, 0, 0]}
                    />
                    <Bar
                      yAxisId="left"
                      dataKey="enrolled"
                      name="入会（今年）"
                      fill={C.green}
                      radius={[3, 3, 0, 0]}
                    />

                    {/* 前年の棒グラフ（比較モード ON のときのみ） */}
                    {compare && previous && (
                      <>
                        <Bar
                          yAxisId="left"
                          dataKey="inquiriesPrev"
                          name="問合せ（前年）"
                          fill={C.primaryPrev}
                          opacity={0.6}
                          radius={[3, 3, 0, 0]}
                        />
                        <Bar
                          yAxisId="left"
                          dataKey="enrolledPrev"
                          name="入会（前年）"
                          fill={C.greenPrev}
                          radius={[3, 3, 0, 0]}
                        />
                      </>
                    )}

                    {/* 今年の入会率ライン */}
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="rate"
                      name="入会率（今年）"
                      stroke={C.teal}
                      strokeWidth={2}
                      dot={{ r: 2.5, fill: C.teal }}
                    />

                    {/* 前年の入会率ライン（比較モード ON のときのみ） */}
                    {compare && previous && (
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="ratePrev"
                        name="入会率（前年）"
                        stroke={C.tealPrev}
                        strokeWidth={2}
                        strokeDasharray="4 3"
                        dot={{ r: 2, fill: C.tealPrev }}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* == 5. 媒体別 BarChart（現期間のみ） == */}
            <SectionTitle icon={Activity}>媒体別</SectionTitle>
            <Card>
              <CardContent className="py-4">
                <ResponsiveContainer width="100%" height={Math.max(200, current.byMedia.length * 40 + 60)}>
                  <BarChart
                    layout="vertical"
                    data={current.byMedia}
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
                    <Bar
                      dataKey="count"
                      name="問合せ数"
                      fill={C.primary}
                      opacity={0.5}
                      radius={[0, 4, 4, 0]}
                      label={{
                        position: 'right',
                        fontSize: 10,
                        fill: '#4b5563',
                        formatter: (v: unknown) => String(v),
                      }}
                    />
                    <Bar dataKey="enrolled" name="入会数" fill={C.green} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>

                {/* 入会率・連絡不通率をテキスト表示 */}
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
                      {current.byMedia.map((row) => (
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

            {/* == 6. リードタイム スタットカード（現期間のみ） == */}
            <SectionTitle icon={Clock}>リードタイム</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* 問合せ → 入会 */}
              <Card>
                <CardContent className="py-4">
                  <div className="text-xs text-text-muted mb-1">問合せ → 入会</div>
                  {current.leadTime.inquiryToEnroll.n > 0 ? (
                    <>
                      <div className="flex items-baseline gap-2 mt-1">
                        <span className="text-2xl font-bold text-text-heading">
                          {current.leadTime.inquiryToEnroll.median} 日
                        </span>
                        <span className="text-xs text-text-muted">中央値</span>
                      </div>
                      <div className="text-sm text-text-body mt-1">
                        平均 {current.leadTime.inquiryToEnroll.avg} 日
                        <span className="text-xs text-text-faint ml-2">
                          （n={current.leadTime.inquiryToEnroll.n} 件）
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
                  {current.leadTime.trialToEnroll.n > 0 ? (
                    <>
                      <div className="flex items-baseline gap-2 mt-1">
                        <span className="text-2xl font-bold text-text-heading">
                          {current.leadTime.trialToEnroll.median} 日
                        </span>
                        <span className="text-xs text-text-muted">中央値</span>
                      </div>
                      <div className="text-sm text-text-body mt-1">
                        平均 {current.leadTime.trialToEnroll.avg} 日
                        <span className="text-xs text-text-faint ml-2">
                          （n={current.leadTime.trialToEnroll.n} 件）
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-text-faint mt-1">集計対象なし</div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* == 7. 商圏分析（現期間のみ） == */}
            {(current.byPostal.length > 0 || current.bySchoolName.length > 0) && (
              <>
                <SectionTitle icon={MapPin}>商圏分析</SectionTitle>
                <p className="text-xs text-text-faint mb-3">
                  チラシ配布エリアや重点校選定の参考に使えます
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                  {/* 郵便番号別（前3桁グループ、上位15） */}
                  {current.byPostal.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-sm">郵便番号別（上位15）</CardTitle>
                      </CardHeader>
                      <CardContent className="py-3">
                        <table className="w-full text-xs text-text-body border-collapse">
                          <thead>
                            <tr className="border-b border-border-subtle">
                              <th className="text-left py-1.5 pr-4 font-medium text-text-muted">エリア</th>
                              <th className="text-right py-1.5 pr-4 font-medium text-text-muted">問合せ</th>
                              <th className="text-right py-1.5 pr-4 font-medium text-text-muted">入会</th>
                              <th className="text-right py-1.5 font-medium text-text-muted">入会率</th>
                            </tr>
                          </thead>
                          <tbody>
                            {current.byPostal.map((row) => {
                              const enrollRate = row.count > 0
                                ? Math.round((row.enrolled / row.count) * 1000) / 10
                                : 0;
                              return (
                                <tr key={row.postal} className="border-b border-border-subtle last:border-0">
                                  <td className="py-1.5 pr-4 font-medium">{row.postal}</td>
                                  <td className="text-right py-1.5 pr-4">{row.count.toLocaleString()}</td>
                                  <td className="text-right py-1.5 pr-4">{row.enrolled.toLocaleString()}</td>
                                  <td className="text-right py-1.5">{enrollRate}%</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </CardContent>
                    </Card>
                  )}

                  {/* 在籍学校名別（上位15） */}
                  {current.bySchoolName.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-sm">在籍学校別（上位15）</CardTitle>
                      </CardHeader>
                      <CardContent className="py-3">
                        <table className="w-full text-xs text-text-body border-collapse">
                          <thead>
                            <tr className="border-b border-border-subtle">
                              <th className="text-left py-1.5 pr-4 font-medium text-text-muted">学校名</th>
                              <th className="text-right py-1.5 pr-4 font-medium text-text-muted">問合せ</th>
                              <th className="text-right py-1.5 pr-4 font-medium text-text-muted">入会</th>
                              <th className="text-right py-1.5 font-medium text-text-muted">入会率</th>
                            </tr>
                          </thead>
                          <tbody>
                            {current.bySchoolName.map((row) => (
                              <tr key={row.schoolName} className="border-b border-border-subtle last:border-0">
                                <td className="py-1.5 pr-4 font-medium">{row.schoolName}</td>
                                <td className="text-right py-1.5 pr-4">{row.count.toLocaleString()}</td>
                                <td className="text-right py-1.5 pr-4">{row.enrolled.toLocaleString()}</td>
                                <td className="text-right py-1.5">{row.enrollRate}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </>
            )}

            {/* == 8. 失注理由（現期間のみ） == */}
            {current.lostReasons.length > 0 && (
              <>
                <SectionTitle icon={XCircle}>失注理由</SectionTitle>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                  {/* ドーナツグラフ */}
                  <Card>
                    <CardContent className="py-4">
                      <ResponsiveContainer width="100%" height={240}>
                        <PieChart>
                          <Pie
                            data={current.lostReasons}
                            dataKey="count"
                            nameKey="reason"
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
                            {current.lostReasons.map((entry, i) => (
                              <Cell
                                key={entry.reason}
                                fill={LOST_REASON_COLORS[i % LOST_REASON_COLORS.length]}
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

                  {/* 件数リスト */}
                  <Card>
                    <CardContent className="py-4">
                      <table className="w-full text-xs text-text-body border-collapse">
                        <thead>
                          <tr className="border-b border-border-subtle">
                            <th className="text-left py-1.5 pr-4 font-medium text-text-muted">理由</th>
                            <th className="text-right py-1.5 font-medium text-text-muted">件数</th>
                          </tr>
                        </thead>
                        <tbody>
                          {current.lostReasons.map((row, i) => (
                            <tr key={row.reason} className="border-b border-border-subtle last:border-0">
                              <td className="py-1.5 pr-4">
                                <span
                                  className="inline-block w-2 h-2 rounded-full mr-2 shrink-0"
                                  style={{ backgroundColor: LOST_REASON_COLORS[i % LOST_REASON_COLORS.length] }}
                                />
                                {row.reason}
                              </td>
                              <td className="text-right py-1.5 font-medium">{row.count.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>
                </div>
              </>
            )}

          </>
        )}
      </div>
    </AdminLayout>
  );
}
