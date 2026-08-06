'use client';

/**
 * 講習申込（Web申込）の公開設定。
 *
 * 正典仕様: docs/koushu-auto-allocation-spec.md §10-4・決定26/29/44。
 * 講習期間（course_prep_periods）1件ごとに次の3つを編集する。
 *   1. 公開期間 — ここに日時が入るまで保護者は申込フォームを開けない（§12の非公開担保）
 *   2. 学年別の終了日 — 開始は共通・終了だけ学年で変えられる（決定44）
 *   3. 単価表 — 学年 × 授業形式(1対1/1対2) × 授業時間(45/90) の3軸（決定26）
 *
 * ★ 2027年2月の切替まで公開期間は空のままにする。公開期間を入れた瞬間に
 *   /koushu-apply/[token] と /portal/[schoolCode]/koushu が保護者に開く。
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { ChevronLeft, Info, Save } from 'lucide-react';
import { AdminLayout } from '@/components/layouts';
import { Button, ToastContainer, Loading } from '@/components/ui';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { useRequirePermission } from '@/hooks/usePermissions';
import { useToast } from '@/hooks/useToast';
import {
  getKoushuApplyPeriods,
  saveKoushuApplySettings,
  type KoushuApplyPeriodSettings,
} from '@/lib/api/koushuApplyAdmin';
import {
  publishStatusOf,
  toDatetimeLocalValue,
  validatePublishWindow,
  sanitizePriceTable,
  sanitizeEndByGrade,
  PUBLISH_STATUS_LABELS,
  type PublishStatus,
} from '@/lib/utils/koushuApplySettings';
import { MAX_GRADE_FOR_45MIN, type PriceTable } from '@/types/koushu-apply';
import { GRADE_LABELS, SEASON_LABELS } from '@/types/database';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

/** 単価表の列。45分は小1〜小4のみ有効（決定17） */
const PRICE_COLUMNS = [
  { ratio: '1on2' as const, duration: '90' as const, label: '1対2 / 90分' },
  { ratio: '1on1' as const, duration: '90' as const, label: '1対1 / 90分' },
  { ratio: '1on2' as const, duration: '45' as const, label: '1対2 / 45分' },
  { ratio: '1on1' as const, duration: '45' as const, label: '1対1 / 45分' },
];

const GRADES = Object.keys(GRADE_LABELS)
  .map(Number)
  .sort((a, b) => a - b);

const STATUS_BADGE: Record<PublishStatus, string> = {
  unpublished: 'bg-surface-hover text-text-muted',
  scheduled: 'bg-warning-subtle text-warning',
  open: 'bg-success-subtle text-success',
  closed: 'bg-info-subtle text-info',
};

/** 入力中の単価表（すべて文字列で保持し、保存時に数値化する） */
type PriceDraft = Record<string, Record<string, string>>;

function priceKey(ratio: string, duration: string): string {
  return `${ratio}_${duration}`;
}

/** DBの単価表 → 入力用ドラフト */
function toPriceDraft(table: PriceTable | null): PriceDraft {
  const draft: PriceDraft = {};
  for (const grade of GRADES) {
    const label = GRADE_LABELS[grade];
    draft[label] = {};
    for (const col of PRICE_COLUMNS) {
      const v = table?.[label]?.[col.ratio]?.[col.duration];
      draft[label][priceKey(col.ratio, col.duration)] = typeof v === 'number' ? String(v) : '';
    }
  }
  return draft;
}

/** 入力用ドラフト → 保存する単価表（空欄は落とす。検証は sanitizePriceTable に任せる） */
function fromPriceDraft(draft: PriceDraft): Record<string, unknown> {
  const out: Record<string, Record<string, Record<string, number>>> = {};
  for (const [label, cells] of Object.entries(draft)) {
    for (const col of PRICE_COLUMNS) {
      const raw = cells[priceKey(col.ratio, col.duration)];
      if (raw == null || raw.trim() === '') continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        // 数値にならない入力はそのまま渡して sanitize 側で日本語エラーにする
        // （ここで握りつぶすと「保存したのに入っていない」になる）
        out[label] ??= {};
        out[label][col.ratio] ??= {};
        out[label][col.ratio][col.duration] = NaN;
        continue;
      }
      out[label] ??= {};
      out[label][col.ratio] ??= {};
      out[label][col.ratio][col.duration] = n;
    }
  }
  return out;
}

export default function KoushuApplySettingsPage() {
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessSettings
  );
  const { getSelectedSchoolIds, selectedSchoolId } = useAuth();
  const { toasts, removeToast, success, error } = useToast();

  const [periods, setPeriods] = useState<KoushuApplyPeriodSettings[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 編集中の値
  const [publishStart, setPublishStart] = useState('');
  const [publishEnd, setPublishEnd] = useState('');
  const [endByGrade, setEndByGrade] = useState<Record<string, string>>({});
  const [priceDraft, setPriceDraft] = useState<PriceDraft>(() => toPriceDraft(null));
  // 単価のまとめて入力
  const [bulkPrices, setBulkPrices] = useState<Record<string, string>>({});

  const schoolId = getSelectedSchoolIds()[0] ?? '';

  const loadPeriods = useCallback(async () => {
    if (!schoolId) {
      setPeriods([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await getKoushuApplyPeriods(schoolId);
      setPeriods(rows);
      setSelectedPeriodId((prev) => {
        // 教室を切り替えても同じ期間（season+year）を見続けられるようにする
        const keep = prev ? rows.find((r) => r.id === prev) : undefined;
        return keep?.id ?? rows[0]?.id ?? null;
      });
    } catch (err) {
      console.error('[koushu-apply settings] 期間の取得に失敗:', err);
      error(getUserErrorMessage(err, '講習期間の取得に失敗しました'));
    } finally {
      setLoading(false);
    }
    // error は useToast の安定参照だが依存に入れると再取得ループを招くため除外する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  useEffect(() => {
    if (selectedSchoolId !== null) loadPeriods();
  }, [loadPeriods, selectedSchoolId]);

  const selectedPeriod = useMemo(
    () => periods.find((p) => p.id === selectedPeriodId) ?? null,
    [periods, selectedPeriodId]
  );

  // 選択中の期間が変わったら編集値を差し替える
  useEffect(() => {
    if (!selectedPeriod) {
      setPublishStart('');
      setPublishEnd('');
      setEndByGrade({});
      setPriceDraft(toPriceDraft(null));
      return;
    }
    setPublishStart(toDatetimeLocalValue(selectedPeriod.applyPublishStart));
    setPublishEnd(toDatetimeLocalValue(selectedPeriod.applyPublishEnd));
    setEndByGrade({ ...(selectedPeriod.scheduleEndByGrade ?? {}) });
    setPriceDraft(toPriceDraft(selectedPeriod.applyPriceTable));
  }, [selectedPeriod]);

  const status = publishStatusOf(
    selectedPeriod?.applyPublishStart,
    selectedPeriod?.applyPublishEnd
  );

  /** まとめて入力を全学年へ流し込む（45分は小1〜小4だけに入れる） */
  const applyBulkPrices = () => {
    setPriceDraft((prev) => {
      const next: PriceDraft = { ...prev };
      for (const grade of GRADES) {
        const label = GRADE_LABELS[grade];
        next[label] = { ...next[label] };
        for (const col of PRICE_COLUMNS) {
          const v = bulkPrices[priceKey(col.ratio, col.duration)];
          if (v == null || v.trim() === '') continue;
          if (col.duration === '45' && grade > MAX_GRADE_FOR_45MIN) continue;
          next[label][priceKey(col.ratio, col.duration)] = v;
        }
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!selectedPeriod || !schoolId) return;

    // サーバーと同じ検証をここでも通す。保存前に日本語で理由を出すため（サーバーは最後の砦）。
    const win = validatePublishWindow(
      publishStart ? new Date(publishStart).toISOString() : null,
      publishEnd ? new Date(publishEnd).toISOString() : null
    );
    if (!win.ok) {
      error(win.message);
      return;
    }
    const table = sanitizePriceTable(fromPriceDraft(priceDraft));
    if (!table.ok) {
      error(table.message);
      return;
    }
    const byGrade = sanitizeEndByGrade(endByGrade, selectedPeriod.scheduleStartDate);
    if (!byGrade.ok) {
      error(byGrade.message);
      return;
    }

    setSaving(true);
    try {
      await saveKoushuApplySettings({
        schoolId,
        season: selectedPeriod.season,
        year: selectedPeriod.year,
        applyPublishStart: win.value.start,
        applyPublishEnd: win.value.end,
        applyPriceTable: table.value,
        scheduleEndByGrade: byGrade.value,
      });
      success('公開設定を保存しました');
      await loadPeriods();
    } catch (err) {
      console.error('[koushu-apply settings] 保存に失敗:', err);
      error(getUserErrorMessage(err, '保存に失敗しました'));
    } finally {
      setSaving(false);
    }
  };

  if (permissionLoading) {
    return (
      <AdminLayout headerTitle="講習申込の公開設定">
        <Loading />
      </AdminLayout>
    );
  }

  if (!hasPermission) {
    return (
      <AdminLayout headerTitle="講習申込の公開設定">
        <AccessDenied message="設定ページは教室長以上のみアクセス可能です" />
      </AdminLayout>
    );
  }

  return (
    <div>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <AdminLayout headerTitle="講習申込の公開設定">
        <div className="mb-4">
          <Link
            href="/settings/portal"
            className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-heading transition-colors duration-150"
          >
            <ChevronLeft className="w-4 h-4" />
            ポータル設定に戻る
          </Link>
        </div>

        {/* 公開の意味を必ず読ませる。ここを空にしておくことが非公開の担保そのもの */}
        <div className="mb-6 flex gap-3 p-4 rounded-xl bg-warning-subtle border border-warning/30">
          <Info className="w-5 h-5 text-warning shrink-0 mt-0.5" />
          <div className="text-sm text-text-body leading-relaxed">
            <p className="font-medium text-text-heading mb-1">
              公開期間を入れると、その時刻から保護者が申込フォームを開けます
            </p>
            <p>
              紙の申込書と並走している間は<strong>公開期間を空のまま</strong>
              にしてください。空のときは申込URLを開いても「見つかりません」になります。
            </p>
          </div>
        </div>

        {loading ? (
          <Loading size="md" />
        ) : periods.length === 0 ? (
          <div className="bg-surface-raised rounded-xl border border-border p-6">
            <p className="text-sm text-text-body">
              この教室にはまだ講習期間がありません。先に
              <Link href="/courses" className="text-info hover:underline mx-1">
                講習準備
              </Link>
              で期間（開始日・終了日）を作成してください。
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* 期間の選択 */}
            <div className="bg-surface-raised rounded-xl border border-border p-6">
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-sm font-medium text-text-heading">講習期間</label>
                <select
                  value={selectedPeriodId ?? ''}
                  onChange={(e) => setSelectedPeriodId(e.target.value)}
                  className="px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text-body"
                >
                  {periods.map((p) => (
                    <option key={p.id} value={p.id ?? ''}>
                      {p.year} {SEASON_LABELS[p.season]}講習
                    </option>
                  ))}
                </select>
                <span
                  className={`px-2 py-1 text-xs font-medium rounded ${STATUS_BADGE[status]}`}
                  title="この期間の申込フォームが今どう見えているか"
                >
                  {PUBLISH_STATUS_LABELS[status]}
                </span>
                {selectedPeriod && (
                  <span className="text-xs text-text-muted">
                    {selectedPeriod.scheduleStartDate ?? '開始日未設定'} 〜{' '}
                    {selectedPeriod.scheduleEndDate ?? '終了日未設定'}
                  </span>
                )}
              </div>
            </div>

            {/* 1. 公開期間 */}
            <div className="bg-surface-raised rounded-xl border border-border p-6">
              <h2 className="text-lg font-bold text-text-heading mb-1">申込フォームの公開期間</h2>
              <p className="text-xs text-text-muted mb-4">
                開始・終了はセットで入力します。両方を空にすると非公開に戻ります。
              </p>
              <div className="flex flex-wrap gap-4">
                <div className="space-y-1">
                  <label className="block text-sm text-text-body">公開開始</label>
                  <input
                    type="datetime-local"
                    value={publishStart}
                    onChange={(e) => setPublishStart(e.target.value)}
                    className="px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text-body"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-sm text-text-body">公開終了</label>
                  <input
                    type="datetime-local"
                    value={publishEnd}
                    onChange={(e) => setPublishEnd(e.target.value)}
                    className="px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text-body"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => {
                      setPublishStart('');
                      setPublishEnd('');
                    }}
                    className="px-3 py-2 text-sm text-text-muted hover:text-text-heading underline"
                  >
                    非公開に戻す
                  </button>
                </div>
              </div>
            </div>

            {/* 2. 学年別の終了日 */}
            <div className="bg-surface-raised rounded-xl border border-border p-6">
              <h2 className="text-lg font-bold text-text-heading mb-1">学年別の講習終了日</h2>
              <p className="text-xs text-text-muted mb-4">
                開始日は全学年で共通です。空欄の学年は共通の終了日（
                {selectedPeriod?.scheduleEndDate ?? '未設定'}）を使います。
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {GRADES.map((grade) => (
                  <div key={grade} className="flex items-center gap-2">
                    <span className="text-sm text-text-body w-10 shrink-0">
                      {GRADE_LABELS[grade]}
                    </span>
                    <input
                      type="date"
                      value={endByGrade[String(grade)] ?? ''}
                      onChange={(e) =>
                        setEndByGrade((prev) => ({ ...prev, [String(grade)]: e.target.value }))
                      }
                      className="flex-1 min-w-0 px-2 py-1.5 border border-border rounded-lg text-sm bg-surface text-text-body"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* 3. 単価表 */}
            <div className="bg-surface-raised rounded-xl border border-border p-6">
              <h2 className="text-lg font-bold text-text-heading mb-1">
                単価表（1コマあたり・円）
              </h2>
              <p className="text-xs text-text-muted mb-4">
                空欄の組み合わせは保護者が選べません。45分は小1〜小4のみ設定できます。
              </p>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse border border-border text-sm">
                  <thead>
                    <tr className="bg-surface-hover">
                      <th className="border border-border px-3 py-2 text-left w-20">学年</th>
                      {PRICE_COLUMNS.map((col) => (
                        <th
                          key={priceKey(col.ratio, col.duration)}
                          className="border border-border px-3 py-2 text-left"
                        >
                          {col.label}
                        </th>
                      ))}
                    </tr>
                    {/* まとめて入力: 学年ごとの打鍵を減らす（45分は対象学年にだけ入る） */}
                    <tr className="bg-info-subtle/40">
                      <th className="border border-border px-3 py-2 text-left text-xs font-medium text-text-muted">
                        まとめて入力
                      </th>
                      {PRICE_COLUMNS.map((col) => (
                        <td
                          key={priceKey(col.ratio, col.duration)}
                          className="border border-border px-2 py-1.5"
                        >
                          <input
                            type="number"
                            min={0}
                            inputMode="numeric"
                            value={bulkPrices[priceKey(col.ratio, col.duration)] ?? ''}
                            onChange={(e) =>
                              setBulkPrices((prev) => ({
                                ...prev,
                                [priceKey(col.ratio, col.duration)]: e.target.value,
                              }))
                            }
                            className="w-full px-2 py-1 border border-border rounded text-sm bg-surface text-text-body"
                            placeholder="—"
                          />
                        </td>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={PRICE_COLUMNS.length + 1} className="px-3 py-2">
                        <button
                          type="button"
                          onClick={applyBulkPrices}
                          className="text-xs text-info hover:underline"
                        >
                          まとめて入力の値を全学年に適用
                        </button>
                      </td>
                    </tr>
                    {GRADES.map((grade) => {
                      const label = GRADE_LABELS[grade];
                      return (
                        <tr key={grade} className="hover:bg-surface-hover/50">
                          <td className="border border-border px-3 py-2 font-medium text-text-heading">
                            {label}
                          </td>
                          {PRICE_COLUMNS.map((col) => {
                            const disabled = col.duration === '45' && grade > MAX_GRADE_FOR_45MIN;
                            return (
                              <td
                                key={priceKey(col.ratio, col.duration)}
                                className="border border-border px-2 py-1.5"
                              >
                                <input
                                  type="number"
                                  min={0}
                                  inputMode="numeric"
                                  disabled={disabled}
                                  value={
                                    disabled
                                      ? ''
                                      : (priceDraft[label]?.[priceKey(col.ratio, col.duration)] ??
                                        '')
                                  }
                                  onChange={(e) =>
                                    setPriceDraft((prev) => ({
                                      ...prev,
                                      [label]: {
                                        ...prev[label],
                                        [priceKey(col.ratio, col.duration)]: e.target.value,
                                      },
                                    }))
                                  }
                                  className="w-full px-2 py-1 border border-border rounded text-sm bg-surface text-text-body disabled:bg-surface-hover disabled:cursor-not-allowed"
                                  placeholder={disabled ? '—' : ''}
                                  title={disabled ? '45分は小1〜小4のみ' : undefined}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saving || !selectedPeriod}>
                <Save className="w-4 h-4 mr-1.5" />
                {saving ? '保存中...' : '保存'}
              </Button>
            </div>
          </div>
        )}
      </AdminLayout>
    </div>
  );
}
