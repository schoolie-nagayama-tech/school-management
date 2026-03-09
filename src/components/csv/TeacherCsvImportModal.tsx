'use client';

import { useState, useRef } from 'react';
import { Modal, Button, Input, Label } from '@/components/ui';
import { SelectShadcn as Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui';
import {
  parseTeacherCSV,
  downloadCSV,
  getTeacherCSVTemplate,
  type TeacherCSVRow,
} from '@/lib/utils/csvUtils';
import { fetchWithAuth } from '@/lib/api/auth';
import type { School } from '@/types/database';

type Step = 'upload' | 'preview' | 'importing' | 'done';

interface ImportResult {
  success: number;
  failed: number;
  failDetails: string[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  schools: School[];
  /** インポート完了後に呼ばれるコールバック（一覧を再取得するなど） */
  onImportComplete: () => void;
}

export function TeacherCsvImportModal({
  isOpen,
  onClose,
  schools,
  onImportComplete,
}: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [rows, setRows] = useState<TeacherCSVRow[]>([]);
  const [parseError, setParseError] = useState<string>('');
  const [defaultPassword, setDefaultPassword] = useState('');
  const [selectedSchoolId, setSelectedSchoolId] = useState(schools[0]?.id ?? '');
  const [progress, setProgress] = useState(0);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetState = () => {
    setStep('upload');
    setRows([]);
    setParseError('');
    setProgress(0);
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  // テンプレートダウンロード
  const handleDownloadTemplate = () => {
    downloadCSV(getTeacherCSVTemplate(), '講師インポートテンプレート.csv');
  };

  // ファイル選択
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError('');
    try {
      const parsed = await parseTeacherCSV(file);
      if (parsed.length === 0) {
        setParseError('データ行がありません。ヘッダー行の次に講師データを入力してください。');
        return;
      }
      setRows(parsed);
      setStep('preview');
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'CSVの読み込みに失敗しました');
    }
  };

  const validRows = rows.filter((r) => r.errors.length === 0);
  const errorRows = rows.filter((r) => r.errors.length > 0);
  const previewRows = rows.slice(0, 5);

  // インポート実行
  const handleImport = async () => {
    if (!selectedSchoolId) {
      alert('所属教室を選択してください');
      return;
    }
    if (defaultPassword.length < 4) {
      alert('初期パスワードは4文字以上で入力してください');
      return;
    }

    setStep('importing');
    setProgress(0);

    const result: ImportResult = {
      success: 0,
      failed: 0,
      failDetails: [],
    };

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      try {
        const response = await fetchWithAuth('/api/admin/users/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: row.email || undefined,
            password: defaultPassword,
            displayName: row.display_name,
            role: 'teacher',
            schoolId: selectedSchoolId,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || '作成に失敗しました');
        }
        result.success++;
      } catch (err) {
        result.failed++;
        const msg = err instanceof Error ? err.message : '不明なエラー';
        result.failDetails.push(`行${row.rowIndex} (${row.display_name}): ${msg}`);
      }
      setProgress(i + 1);
    }

    setImportResult(result);
    setStep('done');
    if (result.success > 0) {
      onImportComplete();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="講師CSVインポート"
      size="lg"
    >
      {/* ── STEP: アップロード ── */}
      {step === 'upload' && (
        <div className="space-y-6">
          <p className="text-sm text-[#4b5563]">
            CSVファイルをアップロードして講師を一括登録します。
            まずテンプレートをダウンロードして、必要事項を記入してください。
          </p>

          {/* テンプレートDL */}
          <div className="bg-[#f3f4f6] rounded-lg p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[#1f2937]">CSVテンプレート</p>
              <p className="text-xs text-[#4b5563] mt-0.5">
                列: 表示名, メールアドレス（任意）
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
              テンプレートDL
            </Button>
          </div>

          {/* 共通設定 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="import-school">所属教室 *</Label>
              <Select
                value={selectedSchoolId}
                onValueChange={setSelectedSchoolId}
              >
                <SelectTrigger>
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
              <Label htmlFor="import-password">初期パスワード（全員共通） *</Label>
              <Input
                id="import-password"
                type="password"
                value={defaultPassword}
                onChange={(e) => setDefaultPassword(e.target.value)}
                placeholder="4文字以上"
              />
              <p className="text-xs text-[#4b5563] mt-1">
                登録後、各講師が変更できます
              </p>
            </div>
          </div>

          {/* ファイル選択 */}
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-2">
              CSVファイルを選択 <span className="text-[#ef4444]">*</span>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="block w-full text-sm text-[#4b5563] file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border file:border-[#e5e7eb] file:text-sm file:font-medium file:bg-white file:text-[#1f2937] hover:file:bg-[#f3f4f6] cursor-pointer"
            />
          </div>

          {parseError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-[#c62828]">{parseError}</p>
            </div>
          )}

          <div className="flex justify-end">
            <Button variant="ghost" onClick={handleClose}>キャンセル</Button>
          </div>
        </div>
      )}

      {/* ── STEP: プレビュー ── */}
      {step === 'preview' && (
        <div className="space-y-4">
          {/* サマリー */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-700">{validRows.length}</p>
              <p className="text-xs text-green-600 mt-0.5">登録予定</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-amber-700">{errorRows.length}</p>
              <p className="text-xs text-amber-600 mt-0.5">スキップ（エラー）</p>
            </div>
          </div>

          {/* 設定確認 */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
            <p>所属教室: <strong>{schools.find((s) => s.id === selectedSchoolId)?.name ?? '—'}</strong></p>
            <p>初期パスワード: <strong>{'•'.repeat(defaultPassword.length)}</strong></p>
          </div>

          {/* エラー行 */}
          {errorRows.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 max-h-28 overflow-y-auto">
              {errorRows.map((r) =>
                r.errors.map((e, ei) => (
                  <p key={`${r.rowIndex}-${ei}`} className="text-xs text-[#c62828]">
                    行{r.rowIndex}: {e}
                  </p>
                ))
              )}
            </div>
          )}

          {/* データプレビュー */}
          <div className="border border-[#e5e7eb] rounded-lg overflow-hidden">
            <div className="bg-[#f3f4f6] px-4 py-2 border-b border-[#e5e7eb]">
              <p className="text-xs font-medium text-[#4b5563]">
                プレビュー（先頭 {previewRows.length} 件）
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-[#f9fafb]">
                  <tr>
                    {['行', '表示名', 'メール'].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left text-[#4b5563] font-medium"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e5e7eb]/50">
                  {previewRows.map((r) => (
                    <tr key={r.rowIndex} className={r.errors.length > 0 ? 'bg-red-50' : ''}>
                      <td className="px-3 py-2 text-[#4b5563]">{r.rowIndex}</td>
                      <td className="px-3 py-2">{r.display_name}</td>
                      <td className="px-3 py-2 text-[#4b5563]">{r.email ?? '（自動生成）'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-between">
            <Button variant="ghost" onClick={resetState}>← やり直し</Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={handleClose}>キャンセル</Button>
              <Button
                onClick={handleImport}
                disabled={validRows.length === 0}
              >
                {validRows.length} 件を登録する
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP: インポート中 ── */}
      {step === 'importing' && (
        <div className="space-y-6 py-6">
          <div className="text-center">
            <div className="w-10 h-10 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-sm text-[#4b5563]">
              インポート中... {progress} / {validRows.length} 件
            </p>
          </div>
          <div className="w-full bg-[#e5e7eb] rounded-full h-2">
            <div
              className="bg-[#1e3a5f] h-2 rounded-full transition-all duration-300"
              style={{
                width: validRows.length > 0
                  ? `${(progress / validRows.length) * 100}%`
                  : '0%',
              }}
            />
          </div>
        </div>
      )}

      {/* ── STEP: 完了 ── */}
      {step === 'done' && importResult && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-700">{importResult.success}</p>
              <p className="text-xs text-green-600 mt-0.5">登録成功</p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-red-700">{importResult.failed}</p>
              <p className="text-xs text-red-600 mt-0.5">失敗</p>
            </div>
          </div>

          {importResult.failDetails.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 max-h-40 overflow-y-auto">
              <p className="text-xs font-medium text-[#c62828] mb-1">失敗の詳細:</p>
              {importResult.failDetails.map((d, i) => (
                <p key={i} className="text-xs text-[#c62828]">{d}</p>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={resetState}>
              続けてインポート
            </Button>
            <Button onClick={handleClose}>閉じる</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
