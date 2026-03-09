'use client';

import { useState, useRef } from 'react';
import { Modal, Button } from '@/components/ui';
import {
  parseStudentCSV,
  downloadCSV,
  getStudentCSVTemplate,
  type StudentCSVRow,
} from '@/lib/utils/csvUtils';
import { createStudent } from '@/lib/api/students';
import { getSubjects } from '@/lib/api/subjects';
import type { Subject, StudentInsert } from '@/types/database';

type Step = 'upload' | 'preview' | 'importing' | 'done';

interface ImportResult {
  success: number;
  skipped: number;
  failed: number;
  failDetails: string[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** インポート先の教室ID */
  schoolId: string;
  /** インポート完了後に呼ばれるコールバック（一覧を再取得するなど） */
  onImportComplete: () => void;
  /** 重複チェック用の既存生徒コード一覧 */
  existingStudentCodes: Set<string>;
}

export function StudentCsvImportModal({
  isOpen,
  onClose,
  schoolId,
  onImportComplete,
  existingStudentCodes,
}: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [rows, setRows] = useState<StudentCSVRow[]>([]);
  const [parseError, setParseError] = useState<string>('');
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
    downloadCSV(getStudentCSVTemplate(), '生徒インポートテンプレート.csv');
  };

  // ファイル選択
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError('');
    try {
      const parsed = await parseStudentCSV(file);
      if (parsed.length === 0) {
        setParseError('データ行がありません。ヘッダー行の次に生徒データを入力してください。');
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
  const skippableByCode = validRows.filter(
    (r) => r.student_code && existingStudentCodes.has(r.student_code)
  );
  const importableRows = validRows.filter(
    (r) => !(r.student_code && existingStudentCodes.has(r.student_code))
  );

  // インポート実行
  const handleImport = async () => {
    if (!schoolId) {
      alert('教室が選択されていません');
      return;
    }
    setStep('importing');
    setProgress(0);

    let allSubjects: Subject[] = [];
    try {
      allSubjects = await getSubjects();
    } catch {
      // 科目取得失敗時は科目なしで続行
    }
    const subjectMap = new Map<string, string>(
      allSubjects.map((s) => [s.name, s.id])
    );

    const result: ImportResult = {
      success: 0,
      skipped: skippableByCode.length + errorRows.length,
      failed: 0,
      failDetails: [],
    };

    for (let i = 0; i < importableRows.length; i++) {
      const row = importableRows[i];
      try {
        const subjectIds = row.subject_names
          .map((name) => subjectMap.get(name))
          .filter((id): id is string => !!id);

        const studentData: StudentInsert = {
          school_id: schoolId,
          student_code: row.student_code,
          last_name: row.last_name,
          first_name: row.first_name,
          last_name_kana: row.last_name_kana,
          first_name_kana: row.first_name_kana,
          grade: row.grade,
          status: row.status,
          school_name: row.school_name,
          class_name: row.class_name,
          club: row.club,
        };

        await createStudent(studentData, subjectIds.length > 0 ? subjectIds : undefined);
        result.success++;
      } catch (err) {
        result.failed++;
        const msg = err instanceof Error ? err.message : '不明なエラー';
        result.failDetails.push(`行${row.rowIndex}: ${msg}`);
      }
      setProgress(i + 1);
    }

    setImportResult(result);
    setStep('done');
    if (result.success > 0) {
      onImportComplete();
    }
  };

  const previewRows = rows.slice(0, 5);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="生徒CSVインポート"
      size="lg"
    >
      {/* ── STEP: アップロード ── */}
      {step === 'upload' && (
        <div className="space-y-6">
          <p className="text-sm text-[#4b5563]">
            CSVファイルをアップロードして生徒を一括登録します。
            まずテンプレートをダウンロードして、必要事項を記入してください。
          </p>

          {/* テンプレートDL */}
          <div className="bg-[#f3f4f6] rounded-lg p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[#1f2937]">CSVテンプレート</p>
              <p className="text-xs text-[#4b5563] mt-0.5">
                ヘッダー行のみのテンプレートをダウンロードできます
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
              テンプレートDL
            </Button>
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

          {/* フォーマット説明 */}
          <div className="border border-[#e5e7eb] rounded-lg overflow-hidden">
            <div className="bg-[#f3f4f6] px-4 py-2 border-b border-[#e5e7eb]">
              <p className="text-xs font-medium text-[#4b5563]">CSVフォーマット</p>
            </div>
            <div className="p-4 overflow-x-auto">
              <table className="text-xs text-[#4b5563] w-full">
                <thead>
                  <tr className="border-b border-[#e5e7eb]">
                    <th className="text-left pr-4 pb-1 font-medium">列名</th>
                    <th className="text-left pr-4 pb-1 font-medium">必須</th>
                    <th className="text-left pb-1 font-medium">備考</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e5e7eb]/50">
                  {[
                    ['生徒コード', '—', '重複の場合はスキップ'],
                    ['姓', '✅', ''],
                    ['名', '✅', ''],
                    ['姓（かな）', '✅', ''],
                    ['名（かな）', '✅', ''],
                    ['学年', '✅', '1〜13 の数値'],
                    ['在籍状況', '—', '在籍中 / 休会 / 退会（省略時: 在籍中）'],
                    ['学校名', '—', ''],
                    ['クラス', '—', ''],
                    ['部活', '—', ''],
                    ['受講科目', '—', '科目名を「/」区切り（例: 英語/数学）'],
                  ].map(([col, req, note]) => (
                    <tr key={col}>
                      <td className="pr-4 py-1 font-medium text-[#1f2937]">{col}</td>
                      <td className="pr-4 py-1">{req}</td>
                      <td className="py-1">{note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end">
            <Button variant="ghost" onClick={handleClose}>キャンセル</Button>
          </div>
        </div>
      )}

      {/* ── STEP: プレビュー ── */}
      {step === 'preview' && (
        <div className="space-y-4">
          {/* サマリー */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-blue-700">{rows.length}</p>
              <p className="text-xs text-blue-600 mt-0.5">読み込み行数</p>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-700">{importableRows.length}</p>
              <p className="text-xs text-green-600 mt-0.5">登録予定</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-amber-700">
                {errorRows.length + skippableByCode.length}
              </p>
              <p className="text-xs text-amber-600 mt-0.5">スキップ</p>
            </div>
          </div>

          {/* スキップ理由 */}
          {(errorRows.length > 0 || skippableByCode.length > 0) && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1 max-h-32 overflow-y-auto">
              {skippableByCode.map((r) => (
                <p key={r.rowIndex} className="text-xs text-amber-800">
                  行{r.rowIndex}: 生徒コード「{r.student_code}」は既に登録済みのためスキップ
                </p>
              ))}
              {errorRows.map((r) =>
                r.errors.map((e, ei) => (
                  <p key={`${r.rowIndex}-${ei}`} className="text-xs text-[#c62828]">
                    行{r.rowIndex}: {e}
                  </p>
                ))
              )}
            </div>
          )}

          {/* データプレビュー（先頭5件） */}
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
                    {['行', '姓', '名', '姓（かな）', '名（かな）', '学年', '在籍状況', '受講科目'].map(
                      (h) => (
                        <th
                          key={h}
                          className="px-3 py-2 text-left text-[#4b5563] font-medium whitespace-nowrap"
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e5e7eb]/50">
                  {previewRows.map((r) => (
                    <tr
                      key={r.rowIndex}
                      className={r.errors.length > 0 ? 'bg-red-50' : ''}
                    >
                      <td className="px-3 py-2 text-[#4b5563]">{r.rowIndex}</td>
                      <td className="px-3 py-2">{r.last_name}</td>
                      <td className="px-3 py-2">{r.first_name}</td>
                      <td className="px-3 py-2">{r.last_name_kana}</td>
                      <td className="px-3 py-2">{r.first_name_kana}</td>
                      <td className="px-3 py-2">{r.grade}</td>
                      <td className="px-3 py-2">{r.status}</td>
                      <td className="px-3 py-2">{r.subject_names.join('/')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-between">
            <Button variant="ghost" onClick={resetState}>
              ← やり直し
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={handleClose}>キャンセル</Button>
              <Button
                onClick={handleImport}
                disabled={importableRows.length === 0}
              >
                {importableRows.length} 件を登録する
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
              インポート中... {progress} / {importableRows.length} 件
            </p>
          </div>
          <div className="w-full bg-[#e5e7eb] rounded-full h-2">
            <div
              className="bg-[#1e3a5f] h-2 rounded-full transition-all duration-300"
              style={{
                width: importableRows.length > 0
                  ? `${(progress / importableRows.length) * 100}%`
                  : '0%',
              }}
            />
          </div>
        </div>
      )}

      {/* ── STEP: 完了 ── */}
      {step === 'done' && importResult && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-700">{importResult.success}</p>
              <p className="text-xs text-green-600 mt-0.5">登録成功</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-amber-700">{importResult.skipped}</p>
              <p className="text-xs text-amber-600 mt-0.5">スキップ</p>
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
