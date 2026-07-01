'use client';

/**
 * 問合せ管理 — 取込ページ。
 * admin / owner のみアクセス可。
 *
 * セクション1: CSVファイル取込 (HPエクスポート CSV、既存フロー)
 *   select → preview(チェックボックス絞り込み) → done
 *
 * セクション2: スプレッドシート移行(初回のみ)
 *   .xlsx ファイル選択 → parseMigrationXlsx → プレビュー → importMigrationRows → 結果表示
 *   再実行しても同一とみなせる行はスキップされる。
 */

import { useState, useRef } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Loading } from '@/components/ui';
import { Button } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import AccessDenied from '@/components/AccessDenied';
import { importInquiries, importMigrationRows } from '@/lib/api/inquiries';
import { parseInquiryCsvFile } from '@/lib/utils/inquiryCsv';
import type { ParsedInquiryRow } from '@/lib/utils/inquiryCsv';
import type { InquiryImportResult, MigrationImportResult } from '@/lib/api/inquiries';
import { parseMigrationXlsx } from '@/lib/utils/inquiryMigration';
import type { MigrationRow } from '@/lib/utils/inquiryMigration';
import { STATUS_CONFIG, formatDate } from '../inquiryConstants';
import {
  AlertTriangle,
  CheckCircle,
  Upload,
  ChevronLeft,
  Info,
  FileSpreadsheet,
} from 'lucide-react';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { isManagerOrAbove } from '@/lib/utils/roles';

/** CSV取込の3ステップ */
type Step = 'select' | 'preview' | 'done';

/** スプレッドシート移行の3ステップ */
type MigStep = 'select' | 'preview' | 'done';

export default function InquiriesImportPage() {
  const { profile } = useAuth();

  // ロールガード: 教室長以上（manager / owner / admin）。判定は roles.ts に一元化。
  const isAdmin = isManagerOrAbove(profile?.role);

  // ---- CSV取込の状態 ----
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('select');
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedInquiryRow[]>([]);
  // 各行の取込対象チェック状態（インデックス → boolean）
  const [checkedRows, setCheckedRows] = useState<boolean[]>([]);

  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<InquiryImportResult | null>(null);
  const [importError, setImportError] = useState('');

  // ---- スプレッドシート移行の状態(CSV取込と独立) ----
  const migFileInputRef = useRef<HTMLInputElement>(null);

  const [migStep, setMigStep] = useState<MigStep>('select');
  const [isMigParsing, setIsMigParsing] = useState(false);
  const [migParseError, setMigParseError] = useState('');
  const [migRows, setMigRows] = useState<MigrationRow[]>([]);
  const [migSkippedNoDate, setMigSkippedNoDate] = useState(0);

  const [isMigImporting, setIsMigImporting] = useState(false);
  const [migImportResult, setMigImportResult] = useState<MigrationImportResult | null>(null);
  const [migImportError, setMigImportError] = useState('');

  // ---- ファイル選択 → パース ----
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsParsing(true);
    setParseError('');
    setParsedRows([]);
    setCheckedRows([]);
    setImportResult(null);

    try {
      const rows = await parseInquiryCsvFile(file);
      setParsedRows(rows);
      // 初期は全行チェック状態にする
      setCheckedRows(rows.map(() => true));
      setStep('preview');
    } catch (err) {
      setParseError(
        getUserErrorMessage(err, 'CSVのパースに失敗しました。文字コードや形式を確認してください。')
      );
    } finally {
      setIsParsing(false);
      // ファイル入力をリセット（同じファイルを再選択できるよう）
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ---- 全選択/全解除 ----
  const handleCheckAll = (checked: boolean) => {
    setCheckedRows(parsedRows.map(() => checked));
  };

  // ---- 取込実行 ----
  const handleImport = async () => {
    const selectedRows = parsedRows.filter((_, i) => checkedRows[i]);
    if (selectedRows.length === 0) {
      setImportError('取込対象の行がありません');
      return;
    }

    setIsImporting(true);
    setImportError('');
    try {
      const result = await importInquiries(selectedRows);
      setImportResult(result);
      setStep('done');
    } catch (err) {
      setImportError(getUserErrorMessage(err, '取込に失敗しました'));
    } finally {
      setIsImporting(false);
    }
  };

  // ---- CSV リセット（最初から） ----
  const handleReset = () => {
    setStep('select');
    setParsedRows([]);
    setCheckedRows([]);
    setImportResult(null);
    setImportError('');
    setParseError('');
  };

  // ---- スプレッドシート移行: ファイル選択 → パース ----
  const handleMigFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsMigParsing(true);
    setMigParseError('');
    setMigRows([]);
    setMigSkippedNoDate(0);
    setMigImportResult(null);

    try {
      const { rows, skipped } = await parseMigrationXlsx(file);
      setMigRows(rows);
      setMigSkippedNoDate(skipped);
      setMigStep('preview');
    } catch (err) {
      setMigParseError(
        getUserErrorMessage(err, 'Excelのパースに失敗しました。ファイル形式を確認してください。')
      );
    } finally {
      setIsMigParsing(false);
      if (migFileInputRef.current) migFileInputRef.current.value = '';
    }
  };

  // ---- スプレッドシート移行: 実行 ----
  const handleMigImport = async () => {
    if (migRows.length === 0) {
      setMigImportError('取込対象の行がありません');
      return;
    }

    setIsMigImporting(true);
    setMigImportError('');
    try {
      const result = await importMigrationRows(migRows);
      setMigImportResult(result);
      setMigStep('done');
    } catch (err) {
      setMigImportError(getUserErrorMessage(err, '移行に失敗しました'));
    } finally {
      setIsMigImporting(false);
    }
  };

  // ---- スプレッドシート移行: リセット ----
  const handleMigReset = () => {
    setMigStep('select');
    setMigRows([]);
    setMigSkippedNoDate(0);
    setMigImportResult(null);
    setMigImportError('');
    setMigParseError('');
  };

  // ---- ローディング / 権限 ----
  if (profile === null) {
    return (
      <AdminLayout headerTitle="問合せ取込">
        <Loading className="min-h-[60vh]" />
      </AdminLayout>
    );
  }
  if (!isAdmin) {
    return (
      <AdminLayout>
        <AccessDenied message="問合せ管理は管理者のみ利用できます" />
      </AdminLayout>
    );
  }

  const selectedCount = checkedRows.filter(Boolean).length;
  const warningRowCount = parsedRows.filter((r) => r.warnings.length > 0).length;

  // ---- 移行セクション用集計 ----
  // 教室別件数の集計
  const migSchoolCount = migRows.reduce<Record<string, number>>((acc, r) => {
    acc[r.schoolNameShort] = (acc[r.schoolNameShort] ?? 0) + 1;
    return acc;
  }, {});
  // ステータス内訳の集計
  const migStatusCount = migRows.reduce<Record<string, number>>((acc, r) => {
    const s = r.data.status ?? 'in_progress';
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});
  // 警告ありの行を上位10件抽出
  const migWarningRows = migRows
    .flatMap((r, i) => r.warnings.map((w) => ({ rowNo: i + 2, warning: w })))
    .slice(0, 10);
  // プレビュー先頭10行
  const migPreviewRows = migRows.slice(0, 10);

  return (
    <AdminLayout headerTitle="問合せ取込">
      <div className="max-w-5xl">
        {/* 戻るリンク */}
        <Link
          href="/admin/inquiries"
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-heading mb-6 transition-colors duration-150"
        >
          <ChevronLeft className="w-4 h-4" />
          問合せ一覧に戻る
        </Link>

        {/* 注意書き */}
        <div className="mb-6 p-4 bg-info-subtle border border-info/30 rounded-lg flex gap-3">
          <Info className="w-4 h-4 text-info shrink-0 mt-0.5" />
          <p className="text-sm text-info">
            HPシステムからエクスポートした <code className="font-mono">boshu_applicant_*.csv</code>
            （教室別）をアップロードしてください。問合せNOで重複は自動スキップされます。
          </p>
        </div>

        {/* ── STEP 1: ファイル選択 ── */}
        {step === 'select' && (
          <div className="bg-surface-raised border border-border rounded-xl p-8 text-center">
            <Upload className="w-10 h-10 text-text-muted mx-auto mb-4" />
            <p className="text-sm text-text-muted mb-4">Shift_JIS形式のCSVファイルをアップロード</p>
            {isParsing ? (
              <Loading size="sm" />
            ) : (
              <>
                <label className="cursor-pointer">
                  <span className="px-4 py-2 bg-ink text-white rounded-lg text-sm hover:bg-ink/80 transition-colors duration-150 inline-block">
                    ファイルを選択
                  </span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleFileChange}
                    className="sr-only"
                  />
                </label>
                {parseError && <p className="mt-3 text-sm text-danger">{parseError}</p>}
              </>
            )}
          </div>
        )}

        {/* ── STEP 2: プレビュー確認 ── */}
        {step === 'preview' && (
          <div className="space-y-4">
            {/* プレビューサマリー */}
            <div className="flex flex-wrap items-center gap-4 p-4 bg-surface-raised border border-border rounded-xl">
              <div className="text-sm text-text-body">
                <span className="font-semibold text-text-heading">{parsedRows.length}</span>
                件をパース
              </div>
              {warningRowCount > 0 && (
                <div className="flex items-center gap-1.5 text-sm text-text-body">
                  <AlertTriangle className="w-4 h-4 text-warning" />
                  <span>警告あり: {warningRowCount}件</span>
                </div>
              )}
              <div className="text-sm text-text-muted">
                取込対象: <span className="font-semibold text-text-heading">{selectedCount}</span>件
              </div>
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" size="sm" onClick={handleReset}>
                  やり直す
                </Button>
                <Button
                  size="sm"
                  isLoading={isImporting}
                  disabled={selectedCount === 0}
                  onClick={handleImport}
                >
                  {selectedCount}件を取込実行
                </Button>
              </div>
            </div>

            {importError && (
              <div className="p-4 bg-danger/20 border border-danger rounded-lg">
                <p className="text-sm text-danger">{importError}</p>
              </div>
            )}

            {/* プレビューテーブル */}
            <div className="bg-surface-raised border border-border rounded-xl overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-surface-hover">
                    <th className="border border-border px-2 py-2 text-center w-10">
                      <input
                        type="checkbox"
                        checked={checkedRows.every(Boolean) && parsedRows.length > 0}
                        onChange={(e) => handleCheckAll(e.target.checked)}
                        className="cursor-pointer"
                      />
                    </th>
                    <th className="border border-border px-3 py-2 text-left font-medium text-text-heading whitespace-nowrap">
                      受付日
                    </th>
                    <th className="border border-border px-3 py-2 text-left font-medium text-text-heading whitespace-nowrap">
                      教室名
                    </th>
                    <th className="border border-border px-3 py-2 text-left font-medium text-text-heading whitespace-nowrap">
                      生徒名
                    </th>
                    <th className="border border-border px-3 py-2 text-left font-medium text-text-heading whitespace-nowrap">
                      保護者名
                    </th>
                    <th className="border border-border px-3 py-2 text-left font-medium text-text-heading whitespace-nowrap">
                      学年
                    </th>
                    <th className="border border-border px-3 py-2 text-left font-medium text-text-heading whitespace-nowrap">
                      媒体
                    </th>
                    <th className="border border-border px-3 py-2 text-left font-medium text-text-heading whitespace-nowrap">
                      申込内容
                    </th>
                    <th className="border border-border px-3 py-2 text-left font-medium text-text-heading whitespace-nowrap">
                      電話
                    </th>
                    <th className="border border-border px-3 py-2 text-center font-medium text-text-heading whitespace-nowrap">
                      ステータス
                    </th>
                    <th className="border border-border px-3 py-2 text-left font-medium text-text-heading">
                      警告
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.map((row, i) => {
                    const hasWarning = row.warnings.length > 0;
                    const status = row.data.status ?? 'in_progress';
                    const sc = STATUS_CONFIG[status];
                    return (
                      <tr
                        key={i}
                        className={`${hasWarning ? 'bg-warning-subtle/50' : ''} ${!checkedRows[i] ? 'opacity-40' : ''}`}
                      >
                        <td className="border border-border px-2 py-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={checkedRows[i] ?? false}
                            onChange={(e) => {
                              const next = [...checkedRows];
                              next[i] = e.target.checked;
                              setCheckedRows(next);
                            }}
                            className="cursor-pointer"
                          />
                        </td>
                        <td className="border border-border px-3 py-1.5 whitespace-nowrap text-text-body">
                          {row.data.inquired_at ? formatDate(row.data.inquired_at) : '—'}
                        </td>
                        <td className="border border-border px-3 py-1.5 text-text-body">
                          {row.schoolName}
                        </td>
                        <td className="border border-border px-3 py-1.5 font-medium text-text-heading">
                          {row.data.student_name ?? '—'}
                        </td>
                        <td className="border border-border px-3 py-1.5 text-text-body">
                          {row.data.guardian_name ?? '—'}
                        </td>
                        <td className="border border-border px-3 py-1.5 text-text-body">
                          {row.data.grade ?? '—'}
                        </td>
                        <td className="border border-border px-3 py-1.5 text-text-body">
                          {row.data.media ?? '—'}
                        </td>
                        <td className="border border-border px-3 py-1.5 text-text-body">
                          {row.data.request_type ?? '—'}
                        </td>
                        <td className="border border-border px-3 py-1.5 text-text-body whitespace-nowrap">
                          {row.data.phone ?? '—'}
                        </td>
                        <td className="border border-border px-3 py-1.5 text-center">
                          <span
                            className={`px-1.5 py-0.5 rounded-full font-medium ${sc.className}`}
                          >
                            {sc.label}
                          </span>
                        </td>
                        <td className="border border-border px-3 py-1.5">
                          {hasWarning ? (
                            <div className="flex items-start gap-1">
                              <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
                              <span className="text-text-body text-xs">
                                {row.warnings.join(' / ')}
                              </span>
                            </div>
                          ) : (
                            <span className="text-text-faint">—</span>
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

        {/* ── STEP 3: 完了 ── */}
        {step === 'done' && importResult && (
          <div className="bg-surface-raised border border-border rounded-xl p-8">
            <div className="flex items-center gap-2 mb-6">
              <CheckCircle className="w-6 h-6 text-success" />
              <h2 className="text-lg font-bold text-text-heading">取込完了</h2>
            </div>

            {/* 結果サマリー */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="p-4 bg-success-subtle border border-success/30 rounded-lg text-center">
                <p className="text-xs text-success mb-1">新規登録</p>
                <p className="text-2xl font-bold text-success">{importResult.created}</p>
              </div>
              <div className="p-4 bg-surface-hover border border-border rounded-lg text-center">
                <p className="text-xs text-text-muted mb-1">スキップ（重複）</p>
                <p className="text-2xl font-bold text-text-muted">{importResult.skipped}</p>
              </div>
              <div
                className={`p-4 border rounded-lg text-center ${importResult.errors.length > 0 ? 'bg-danger-subtle border-danger/30' : 'bg-surface-hover border-border'}`}
              >
                <p
                  className={`text-xs mb-1 ${importResult.errors.length > 0 ? 'text-danger' : 'text-text-muted'}`}
                >
                  エラー
                </p>
                <p
                  className={`text-2xl font-bold ${importResult.errors.length > 0 ? 'text-danger' : 'text-text-muted'}`}
                >
                  {importResult.errors.length}
                </p>
              </div>
            </div>

            {/* エラー詳細 */}
            {importResult.errors.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-text-heading mb-2">エラー詳細</h3>
                <div className="space-y-1">
                  {importResult.errors.map((e, i) => (
                    <div
                      key={i}
                      className="flex gap-2 text-xs p-2 bg-danger-subtle border border-danger/30 rounded"
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-danger shrink-0 mt-0.5" />
                      <span className="text-danger">
                        【{e.schoolName || '不明'} / NO: {e.hpNo || '不明'}】{e.message}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <Link href="/admin/inquiries">
                <Button size="sm">一覧へ</Button>
              </Link>
              <Button variant="secondary" size="sm" onClick={handleReset}>
                続けて取込む
              </Button>
            </div>
          </div>
        )}

        {/* ── スプレッドシート移行セクション ── */}
        <div className="mt-10 pt-8 border-t border-border">
          <div className="flex items-center gap-2 mb-4">
            <FileSpreadsheet className="w-5 h-5 text-text-muted" />
            <h2 className="text-base font-bold text-text-heading">
              旧スプレッドシートからの移行（初回のみ）
            </h2>
          </div>

          {/* 注意書き */}
          <div className="mb-5 p-4 bg-warning-subtle border border-warning/30 rounded-lg flex gap-3">
            <Info className="w-4 h-4 text-warning shrink-0 mt-0.5" />
            <div className="text-sm text-text-heading space-y-1">
              <p>
                問合せ管理表.xlsxをアップロードしてください。シート名「問合せ管理」を読み込みます。
              </p>
              <p>再実行しても同一とみなせる行（同日・同電話番号または同名）はスキップされます。</p>
            </div>
          </div>

          {/* ── 移行 STEP 1: ファイル選択 ── */}
          {migStep === 'select' && (
            <div className="bg-surface-raised border border-border rounded-xl p-8 text-center">
              <Upload className="w-10 h-10 text-text-muted mx-auto mb-4" />
              <p className="text-sm text-text-muted mb-4">.xlsx ファイルをアップロード</p>
              {isMigParsing ? (
                <Loading size="sm" />
              ) : (
                <>
                  <label className="cursor-pointer">
                    <span className="px-4 py-2 bg-ink text-white rounded-lg text-sm hover:bg-ink/80 transition-colors duration-150 inline-block">
                      Excelファイルを選択
                    </span>
                    <input
                      ref={migFileInputRef}
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={handleMigFileChange}
                      className="sr-only"
                    />
                  </label>
                  {migParseError && <p className="mt-3 text-sm text-danger">{migParseError}</p>}
                </>
              )}
            </div>
          )}

          {/* ── 移行 STEP 2: プレビュー確認 ── */}
          {migStep === 'preview' && (
            <div className="space-y-4">
              {/* サマリー行 */}
              <div className="flex flex-wrap items-center gap-4 p-4 bg-surface-raised border border-border rounded-xl">
                <div className="text-sm text-text-body">
                  パース結果:{' '}
                  <span className="font-semibold text-text-heading">{migRows.length}</span>件
                </div>
                {migSkippedNoDate > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-text-body">
                    <AlertTriangle className="w-4 h-4 text-warning" />
                    <span>問合日なしスキップ: {migSkippedNoDate}件</span>
                  </div>
                )}
                <div className="ml-auto flex gap-2">
                  <Button variant="ghost" size="sm" onClick={handleMigReset}>
                    やり直す
                  </Button>
                  <Button
                    size="sm"
                    isLoading={isMigImporting}
                    disabled={migRows.length === 0}
                    onClick={handleMigImport}
                  >
                    {migRows.length}件を移行実行
                  </Button>
                </div>
              </div>

              {migImportError && (
                <div className="p-4 bg-danger/20 border border-danger rounded-lg">
                  <p className="text-sm text-danger">{migImportError}</p>
                </div>
              )}

              {/* 教室別件数 & ステータス内訳 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-surface-raised border border-border rounded-xl p-4">
                  <h3 className="text-xs font-semibold text-text-heading mb-2">教室別件数</h3>
                  <div className="space-y-1">
                    {Object.entries(migSchoolCount).map(([name, cnt]) => (
                      <div key={name} className="flex justify-between text-xs">
                        <span className="text-text-body">{name}</span>
                        <span className="font-medium text-text-heading">{String(cnt)}件</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-surface-raised border border-border rounded-xl p-4">
                  <h3 className="text-xs font-semibold text-text-heading mb-2">ステータス内訳</h3>
                  <div className="space-y-1">
                    {Object.entries(migStatusCount).map(([status, cnt]) => {
                      const sc = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG];
                      return (
                        <div key={status} className="flex justify-between text-xs">
                          <span
                            className={`px-1.5 py-0.5 rounded-full font-medium ${sc?.className ?? ''}`}
                          >
                            {sc?.label ?? status}
                          </span>
                          <span className="font-medium text-text-heading">{String(cnt)}件</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* 警告上位10件 */}
              {migWarningRows.length > 0 && (
                <div className="bg-warning-subtle border border-warning/30 rounded-xl p-4">
                  <h3 className="text-xs font-semibold text-text-heading mb-2 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-warning" />
                    警告（上位10件）
                  </h3>
                  <div className="space-y-1">
                    {migWarningRows.map((w, i) => (
                      <p key={i} className="text-xs text-text-body">
                        行{w.rowNo}: {w.warning}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* 先頭10行プレビューテーブル */}
              <div className="bg-surface-raised border border-border rounded-xl overflow-x-auto">
                <p className="text-xs text-text-muted px-3 pt-3 pb-1">先頭10件のプレビュー</p>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-surface-hover">
                      <th className="border border-border px-3 py-2 text-left font-medium text-text-heading whitespace-nowrap">
                        問合日
                      </th>
                      <th className="border border-border px-3 py-2 text-left font-medium text-text-heading whitespace-nowrap">
                        教室
                      </th>
                      <th className="border border-border px-3 py-2 text-left font-medium text-text-heading whitespace-nowrap">
                        生徒名
                      </th>
                      <th className="border border-border px-3 py-2 text-left font-medium text-text-heading whitespace-nowrap">
                        保護者名
                      </th>
                      <th className="border border-border px-3 py-2 text-left font-medium text-text-heading whitespace-nowrap">
                        学年
                      </th>
                      <th className="border border-border px-3 py-2 text-left font-medium text-text-heading whitespace-nowrap">
                        媒体
                      </th>
                      <th className="border border-border px-3 py-2 text-left font-medium text-text-heading whitespace-nowrap">
                        電話
                      </th>
                      <th className="border border-border px-3 py-2 text-center font-medium text-text-heading whitespace-nowrap">
                        ステータス
                      </th>
                      <th className="border border-border px-3 py-2 text-left font-medium text-text-heading">
                        警告
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {migPreviewRows.map((row, i) => {
                      const hasWarning = row.warnings.length > 0;
                      const status = row.data.status ?? 'in_progress';
                      const sc = STATUS_CONFIG[status];
                      return (
                        <tr key={i} className={hasWarning ? 'bg-warning-subtle/50' : ''}>
                          <td className="border border-border px-3 py-1.5 whitespace-nowrap text-text-body">
                            {row.data.inquired_at ? formatDate(row.data.inquired_at) : '—'}
                          </td>
                          <td className="border border-border px-3 py-1.5 text-text-body">
                            {row.schoolNameShort}
                          </td>
                          <td className="border border-border px-3 py-1.5 font-medium text-text-heading">
                            {row.data.student_name ?? '—'}
                          </td>
                          <td className="border border-border px-3 py-1.5 text-text-body">
                            {row.data.guardian_name ?? '—'}
                          </td>
                          <td className="border border-border px-3 py-1.5 text-text-body">
                            {row.data.grade ?? '—'}
                          </td>
                          <td className="border border-border px-3 py-1.5 text-text-body">
                            {row.data.media ?? '—'}
                          </td>
                          <td className="border border-border px-3 py-1.5 text-text-body whitespace-nowrap">
                            {row.data.phone ?? '—'}
                          </td>
                          <td className="border border-border px-3 py-1.5 text-center">
                            <span
                              className={`px-1.5 py-0.5 rounded-full font-medium ${sc.className}`}
                            >
                              {sc.label}
                            </span>
                          </td>
                          <td className="border border-border px-3 py-1.5">
                            {hasWarning ? (
                              <div className="flex items-start gap-1">
                                <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
                                <span className="text-text-body text-xs">
                                  {row.warnings.join(' / ')}
                                </span>
                              </div>
                            ) : (
                              <span className="text-text-faint">—</span>
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

          {/* ── 移行 STEP 3: 完了 ── */}
          {migStep === 'done' && migImportResult && (
            <div className="bg-surface-raised border border-border rounded-xl p-8">
              <div className="flex items-center gap-2 mb-6">
                <CheckCircle className="w-6 h-6 text-success" />
                <h3 className="text-lg font-bold text-text-heading">移行完了</h3>
              </div>

              {/* 結果サマリー */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="p-4 bg-success-subtle border border-success/30 rounded-lg text-center">
                  <p className="text-xs text-success mb-1">新規登録</p>
                  <p className="text-2xl font-bold text-success">{migImportResult.created}</p>
                </div>
                <div className="p-4 bg-surface-hover border border-border rounded-lg text-center">
                  <p className="text-xs text-text-muted mb-1">スキップ（重複）</p>
                  <p className="text-2xl font-bold text-text-muted">{migImportResult.skipped}</p>
                </div>
                <div
                  className={`p-4 border rounded-lg text-center ${migImportResult.errors.length > 0 ? 'bg-danger-subtle border-danger/30' : 'bg-surface-hover border-border'}`}
                >
                  <p
                    className={`text-xs mb-1 ${migImportResult.errors.length > 0 ? 'text-danger' : 'text-text-muted'}`}
                  >
                    エラー
                  </p>
                  <p
                    className={`text-2xl font-bold ${migImportResult.errors.length > 0 ? 'text-danger' : 'text-text-muted'}`}
                  >
                    {migImportResult.errors.length}
                  </p>
                </div>
              </div>

              {/* エラー詳細 */}
              {migImportResult.errors.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-medium text-text-heading mb-2">エラー詳細</h3>
                  <div className="space-y-1">
                    {migImportResult.errors.map((e, i) => (
                      <div
                        key={i}
                        className="flex gap-2 text-xs p-2 bg-danger-subtle border border-danger/30 rounded"
                      >
                        <AlertTriangle className="w-3.5 h-3.5 text-danger shrink-0 mt-0.5" />
                        <span className="text-danger">
                          【{e.school || '不明'} / {e.name || '不明'}】{e.message}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <Link href="/admin/inquiries">
                  <Button size="sm">一覧へ</Button>
                </Link>
                <Button variant="secondary" size="sm" onClick={handleMigReset}>
                  もう一度実行
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
