'use client';

import { useState, useRef, useMemo } from 'react';
import { Modal, Button, Input, Label, Spinner } from '@/components/ui';
import { SelectShadcn as Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui';
import {
  parseTeacherCSV,
  downloadCSV,
  getTeacherCSVTemplate,
  type TeacherCSVRow,
} from '@/lib/utils/csvUtils';
import { fetchWithAuth } from '@/lib/api/auth';
import { normalizeLoginEmail, normalizePassword } from '@/lib/utils/loginId';
import { useMasterData } from '@/contexts/MasterDataContext';
import type { School } from '@/types/database';

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

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
  const { subjects, schools: allSchools } = useMasterData();
  // 教室コード/名前 → ID のマップ（大文字小文字・前後空白を正規化）
  const schoolLookup = useMemo(() => {
    const byCode = new Map<string, string>();
    const byName = new Map<string, string>();
    for (const s of allSchools) {
      if (s.code) byCode.set(s.code.trim().toLowerCase(), s.id);
      if (s.name) byName.set(s.name.trim().toLowerCase(), s.id);
    }
    return { byCode, byName };
  }, [allSchools]);
  // 科目名 → ID のマップ
  const subjectLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of subjects) {
      if (s.name) map.set(s.name.trim().toLowerCase(), s.id);
    }
    return map;
  }, [subjects]);

  const [step, setStep] = useState<Step>('upload');
  const [rows, setRows] = useState<TeacherCSVRow[]>([]);
  const [parseError, setParseError] = useState<string>('');
  const [defaultPassword, setDefaultPassword] = useState('');
  const [selectedSchoolId, setSelectedSchoolId] = useState(schools[0]?.id ?? '');
  const [progress, setProgress] = useState(0);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetState = () => {
    setStep('upload');
    setRows([]);
    setParseError('');
    setProgress(0);
    setImportResult(null);
    setErrorMessage('');
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

  // 全行に個別PWが入っていれば共通PWは不要
  const allRowsHaveOwnPassword =
    validRows.length > 0 && validRows.every((r) => (r.password?.length ?? 0) >= 4);
  const commonPasswordRequired = !allRowsHaveOwnPassword;

  // インポート実行
  const handleImport = async () => {
    setErrorMessage('');
    if (!selectedSchoolId) {
      setErrorMessage('所属教室を選択してください');
      return;
    }
    if (commonPasswordRequired && defaultPassword.length < 4) {
      setErrorMessage('初期パスワードは4文字以上で入力してください（CSVの全行にパスワードが入っていれば省略可）');
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
        // CSV 行の担当教室（コード/名前）→ ID に解決
        const resolvedSchoolIds: string[] = [];
        const unknownSchools: string[] = [];
        for (const raw of row.school_codes_raw) {
          const key = raw.trim().toLowerCase();
          const id = schoolLookup.byCode.get(key) ?? schoolLookup.byName.get(key);
          if (id) resolvedSchoolIds.push(id);
          else unknownSchools.push(raw);
        }
        if (unknownSchools.length > 0) {
          throw new Error(`不明な教室: ${unknownSchools.join(', ')}`);
        }
        // CSV 行の指導科目名 → ID
        const resolvedSubjectIds: string[] = [];
        const unknownSubjects: string[] = [];
        for (const raw of row.subject_names_raw) {
          const id = subjectLookup.get(raw.trim().toLowerCase());
          if (id) resolvedSubjectIds.push(id);
          else unknownSubjects.push(raw);
        }
        if (unknownSubjects.length > 0) {
          throw new Error(`不明な科目: ${unknownSubjects.join(', ')}`);
        }

        // 主教室: CSV に複数指定があれば 1 つ目、なければモーダル選択を使用
        const primarySchoolId = resolvedSchoolIds[0] ?? selectedSchoolId;
        const additional = resolvedSchoolIds.slice(1);

        // メール欄が空 → APIで自動生成
        // メール欄が ID（@なし）→ 内部ドメインを付加して email 化
        // メール欄が通常メール → そのまま
        const emailForCreate = row.email ? normalizeLoginEmail(row.email) : undefined;
        // パスワードは Supabase の最低 6 文字制約に合わせて透過的にパディング
        // 例: 4文字 `6ni3` → 内部的に `6ni300`。ログイン時も同じ変換を適用するので講師は元のPWで入れる
        const rawPassword = row.password || defaultPassword;
        const passwordForCreate = normalizePassword(rawPassword);

        const response = await fetchWithAuth('/api/admin/users/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: emailForCreate,
            password: passwordForCreate,
            displayName: row.display_name,
            role: 'teacher',
            schoolId: primarySchoolId,
            additionalSchoolIds: additional.length > 0 ? additional : undefined,
            teachableSubjectIds: resolvedSubjectIds.length > 0 ? resolvedSubjectIds : undefined,
            availableDaysOfWeek: row.available_days_of_week ?? undefined,
            isActive: row.is_active,
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
                列: 表示名 / メール or ID（任意） / パスワード（任意） / 担当教室（コード・/区切り） / 指導科目（名前・/区切り） / 出勤可能曜日（日月火水木金土・/区切り） / 状態（有効・無効）
              </p>
              <p className="text-[11px] text-[#6b7280] mt-1">
                ※ メール欄は既存システムのID（例: <code className="bg-white px-1 rounded">tanaka123</code>）をそのまま入力してOK。講師はそのIDでログインできます。
              </p>
              <p className="text-[11px] text-[#6b7280] mt-0.5">
                ※ パスワード欄も講師ごとに個別指定できます（4文字以上）。空欄の行は右の「初期パスワード」が適用されます。全行に入れる場合は右の欄は省略可。
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
              <Label htmlFor="import-password">
                初期パスワード（全員共通）
                {commonPasswordRequired ? (
                  <span className="text-[#ef4444]"> *</span>
                ) : (
                  <span className="text-[11px] text-[#6b7280] font-normal ml-1">（任意・全行に個別PWあり）</span>
                )}
              </Label>
              <Input
                id="import-password"
                type="password"
                value={defaultPassword}
                onChange={(e) => setDefaultPassword(e.target.value)}
                placeholder={commonPasswordRequired ? '4文字以上' : '省略可（CSVの個別PWが使われます）'}
              />
              <p className="text-xs text-[#4b5563] mt-1">
                CSVのパスワード欄が空の行にのみ適用されます。登録後、各講師が変更可。
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
            <p>
              パスワード:{' '}
              <strong>
                {allRowsHaveOwnPassword
                  ? 'CSVから個別適用（全員）'
                  : defaultPassword
                  ? `共通 (${'•'.repeat(defaultPassword.length)}) + 個別`
                  : '—'}
              </strong>
            </p>
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
                    {['行', '表示名', 'メール', 'PW', '担当教室', '指導科目', '出勤曜日', '状態'].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left text-[#4b5563] font-medium whitespace-nowrap"
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
                      <td className="px-3 py-2 text-[#4b5563]">{r.password ? '個別' : '共通'}</td>
                      <td className="px-3 py-2 text-[#4b5563]">
                        {r.school_codes_raw.length > 0 ? r.school_codes_raw.join(' / ') : '（選択教室）'}
                      </td>
                      <td className="px-3 py-2 text-[#4b5563]">
                        {r.subject_names_raw.length > 0 ? r.subject_names_raw.join(' / ') : '—'}
                      </td>
                      <td className="px-3 py-2 text-[#4b5563]">
                        {r.available_days_of_week && r.available_days_of_week.length > 0
                          ? r.available_days_of_week.map((d) => DAY_LABELS[d]).join('/')
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-[#4b5563]">{r.is_active ? '有効' : '無効'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-[#c62828]">{errorMessage}</p>
            </div>
          )}

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
            <Spinner size="lg" className="mx-auto mb-4" />
            <p className="text-sm text-[#4b5563]">
              インポート中... {progress} / {validRows.length} 件
            </p>
          </div>
          <div className="w-full bg-[#e5e7eb] rounded-full h-2">
            <div
              className="bg-[#1e3a5f] h-2 rounded-full transition-[width] duration-300 ease-out"
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
