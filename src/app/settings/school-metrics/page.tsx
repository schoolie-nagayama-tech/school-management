'use client';

/**
 * 月次経営指標の入力ページ（教室長以上）。
 *
 * 教室長ダッシュボードの経営指標（在籍トレンド・予実・増減）は
 * school_monthly_metrics テーブルを「正」として読むため、
 * アプリ導入前の過去実績や予算はこのページから手入力して埋める。
 *
 * 設計メモ:
 *  - フォーム値は文字列で保持する（空文字 = 未入力）。0 と「未入力」を区別し、
 *    すべて空欄の月は保存対象から外す（既存データを 0 で潰さないため）。
 *  - 1 つでも入力がある月は、空欄項目を 0 とみなして upsert する。
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  ToastContainer,
  Loading,
} from '@/components/ui';
import {
  SelectShadcn as Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterData } from '@/contexts/MasterDataContext';
import { isManagerOrAbove } from '@/lib/utils/roles';
import AccessDenied from '@/components/AccessDenied';
import {
  getSchoolMonthlyMetrics,
  upsertSchoolMonthlyMetrics,
  type MetricKind,
  type MonthlyMetricInput,
} from '@/lib/api/schoolMetrics';
import { ChevronLeft, BarChart3, Save } from 'lucide-react';

/** 1か月分のフォーム値。空文字 = 未入力（0 と区別するため文字列で保持） */
interface MonthRow {
  newCount: string;
  leaveCount: string;
  activeCount: string;
}

/** 12か月分の空フォームを作る */
function makeEmptyRows(): MonthRow[] {
  return Array.from({ length: 12 }, () => ({ newCount: '', leaveCount: '', activeCount: '' }));
}

/** 種別の表示ラベル */
const KIND_LABELS: Record<MetricKind, string> = {
  actual: '実績',
  budget: '予算',
};

export default function SchoolMetricsSettingsPage() {
  const { profile, selectedSchoolId: headerSelectedSchoolId } = useAuth();
  const { schools: masterSchools, schoolsLoading } = useMasterData();
  const { toasts, removeToast, success, error: toastError } = useToast();

  // デモ教室は経営指標の入力対象外（ヘッダーのドロップダウンと同じ扱い）
  const schools = useMemo(() => masterSchools.filter((s) => !s.is_demo), [masterSchools]);

  const currentYear = new Date().getFullYear();
  // 過去実績の遡り入力（2022〜）と来年度予算の先行入力（今年+1）を許容する
  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let y = currentYear + 1; y >= 2022; y--) years.push(y);
    return years;
  }, [currentYear]);

  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('');
  const [year, setYear] = useState<number>(currentYear);
  const [kind, setKind] = useState<MetricKind>('actual');
  const [rows, setRows] = useState<MonthRow[]>(makeEmptyRows());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // 教室選択の初期化: ヘッダーで個別教室を選んでいればそれを優先、'all' なら先頭の教室
  useEffect(() => {
    if (selectedSchoolId || schools.length === 0) return;
    const preferred =
      headerSelectedSchoolId &&
      headerSelectedSchoolId !== 'all' &&
      schools.some((s) => s.id === headerSelectedSchoolId)
        ? headerSelectedSchoolId
        : schools[0].id;
    setSelectedSchoolId(preferred);
  }, [schools, selectedSchoolId, headerSelectedSchoolId]);

  // 教室・年・種別が変わるたびに既存データを読み直してフォームへ反映
  const load = useCallback(async (schoolId: string, y: number, k: MetricKind) => {
    setIsLoading(true);
    try {
      const points = await getSchoolMonthlyMetrics([schoolId], [y]);
      const next = makeEmptyRows();
      for (const p of points) {
        // 取得は年単位なので、表示中の種別だけをフォームに載せる
        if (p.kind !== k) continue;
        next[p.month - 1] = {
          newCount: String(p.newCount),
          leaveCount: String(p.leaveCount),
          activeCount: String(p.activeCount),
        };
      }
      setRows(next);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedSchoolId) return;
    void load(selectedSchoolId, year, kind);
  }, [selectedSchoolId, year, kind, load]);

  // 1セルの入力変更。負数は入力させない（min=0 だがキーボード入力対策）
  const handleCellChange = useCallback(
    (monthIndex: number, field: keyof MonthRow, value: string) => {
      if (value !== '' && (!/^\d+$/.test(value) || Number(value) < 0)) return;
      setRows((prev) => prev.map((r, i) => (i === monthIndex ? { ...r, [field]: value } : r)));
    },
    []
  );

  // 保存: 1つでも入力がある月だけを upsert 対象にする（空欄項目は 0 として保存）
  const handleSave = useCallback(async () => {
    if (!selectedSchoolId) return;

    const inputs: MonthlyMetricInput[] = [];
    rows.forEach((row, i) => {
      const allEmpty = row.newCount === '' && row.leaveCount === '' && row.activeCount === '';
      if (allEmpty) return; // すべて空欄の月はスキップ（既存データを温存）
      inputs.push({
        schoolId: selectedSchoolId,
        year,
        month: i + 1,
        kind,
        newCount: row.newCount === '' ? 0 : Number(row.newCount),
        leaveCount: row.leaveCount === '' ? 0 : Number(row.leaveCount),
        activeCount: row.activeCount === '' ? 0 : Number(row.activeCount),
      });
    });

    if (inputs.length === 0) {
      toastError('入力された月がありません');
      return;
    }

    setIsSaving(true);
    try {
      await upsertSchoolMonthlyMetrics(inputs);
      success(`${year}年の${KIND_LABELS[kind]}を保存しました（${inputs.length}か月分）`);
      // 保存後に再取得して「未入力だった月が 0 に化けていないか」を画面上でも確認できるようにする
      await load(selectedSchoolId, year, kind);
    } catch (e) {
      toastError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  }, [selectedSchoolId, year, kind, rows, success, toastError, load]);

  // 教室長（manager）以上のみ入力可
  if (profile && !isManagerOrAbove(profile.role)) {
    return (
      <AdminLayout headerTitle="設定">
        <AccessDenied message="この機能は教室長以上のみ利用できます" />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="設定" documentTitle="月次経営指標の入力">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div className="max-w-3xl">
        {/* パンくず */}
        <div className="mb-4">
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-ink"
          >
            <ChevronLeft className="w-4 h-4" />
            設定一覧へ戻る
          </Link>
        </div>

        {/* 見出し・説明 */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-text-heading mb-2 flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            月次経営指標の入力
          </h1>
          <p className="text-sm text-text-muted">
            教室長ダッシュボードの在籍トレンド・予実・増減に使う月次データを入力します。
          </p>
        </div>

        {/* セレクタ行: 教室 / 年 / 種別 */}
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">教室</label>
            <Select value={selectedSchoolId} onValueChange={setSelectedSchoolId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="教室を選択" />
              </SelectTrigger>
              <SelectContent>
                {schools.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">年</label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}年
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">種別</label>
            <Select value={kind} onValueChange={(v) => setKind(v as MetricKind)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="actual">実績</SelectItem>
                <SelectItem value="budget">予算</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* 入力グリッド */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {year}年の{KIND_LABELS[kind]}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {schoolsLoading || isLoading ? (
              <Loading />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="py-2 pr-3 font-medium text-text-muted w-16">月</th>
                      <th className="py-2 px-2 font-medium text-text-muted">入会数</th>
                      <th className="py-2 px-2 font-medium text-text-muted">退会・休会数</th>
                      <th className="py-2 px-2 font-medium text-text-muted">月末在籍数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className="border-b border-border last:border-b-0">
                        <td className="py-1.5 pr-3 text-text-body whitespace-nowrap">{i + 1}月</td>
                        {(['newCount', 'leaveCount', 'activeCount'] as const).map((field) => (
                          <td key={field} className="py-1.5 px-2">
                            <input
                              type="number"
                              min={0}
                              inputMode="numeric"
                              value={row[field]}
                              placeholder="未入力"
                              onChange={(e) => handleCellChange(i, field, e.target.value)}
                              className="w-full max-w-[8rem] px-3 py-1.5 border border-border-strong rounded-lg text-sm bg-surface-raised text-text-heading focus:ring-2 focus:ring-ink/30 focus:border-ink"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 注記・保存 */}
        <div className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <p className="text-xs text-text-muted">
            すべて空欄の月は保存されません（既存データがある月はそのまま残ります）
          </p>
          <Button onClick={handleSave} disabled={isSaving || isLoading || !selectedSchoolId}>
            <Save className="w-4 h-4 mr-1.5" />
            {isSaving ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>
    </AdminLayout>
  );
}
