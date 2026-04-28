'use client';

import { useState, useCallback, useRef } from 'react';
import { Modal, Button } from '@/components/ui';
import { parseMockCSV, getMockCSVTemplate, downloadCSV } from '@/lib/utils/csvUtils';
import type { MockCsvRow } from '@/lib/utils/csvUtils';
import { createAssessmentRow, updateScore } from '@/lib/api/assessments';

interface MockCsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  studentId: string;
  studentGrade: number;
  onImportComplete: () => void;
}

export function MockCsvImportModal({
  isOpen,
  onClose,
  studentId,
  studentGrade,
  onImportComplete,
}: MockCsvImportModalProps) {
  const [rows, setRows] = useState<MockCsvRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: number; failed: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setFileName(file.name);
    setImportResult(null);
    try {
      const parsed = await parseMockCSV(file);
      setRows(parsed);
    } catch (e) {
      console.error(e);
      setRows([]);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDownloadTemplate = () => {
    downloadCSV(getMockCSVTemplate(), '模試成績テンプレート.csv');
  };

  const handleImport = async () => {
    const validRows = rows.filter((r) => r.errors.length === 0);
    if (validRows.length === 0) return;

    setIsImporting(true);
    let successCount = 0;
    let failedCount = 0;

    for (const row of validRows) {
      try {
        // 行を作成
        const assessment = await createAssessmentRow(
          studentId,
          'mock',
          row.name_code,
          studentGrade,
          row.exam_month || null
        );

        // スコアを更新
        for (const [subject, value] of Object.entries(row.scores)) {
          if (value !== null) {
            await updateScore(assessment.id, subject, value);
          }
        }
        successCount++;
      } catch (e) {
        console.error('Import row failed:', e);
        failedCount++;
      }
    }

    setImportResult({ success: successCount, failed: failedCount });
    setIsImporting(false);

    if (successCount > 0) {
      onImportComplete();
    }
  };

  const handleClose = () => {
    setRows([]);
    setFileName('');
    setImportResult(null);
    onClose();
  };

  const validCount = rows.filter((r) => r.errors.length === 0).length;
  const errorCount = rows.filter((r) => r.errors.length > 0).length;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="模試成績CSVインポート" size="lg">
      <div className="space-y-4">
        {/* テンプレートダウンロード */}
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={handleDownloadTemplate}>
            テンプレートをダウンロード
          </Button>
        </div>

        {/* ファイルアップロード */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-[#3b82f6] hover:bg-blue-50 transition-colors duration-150"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          {fileName ? (
            <p className="text-sm text-[#1f2937]">
              <span className="font-medium">{fileName}</span> を読み込みました
            </p>
          ) : (
            <div>
              <p className="text-sm text-gray-500">CSVファイルをドラッグ＆ドロップ</p>
              <p className="text-xs text-gray-400 mt-1">またはクリックしてファイルを選択</p>
            </div>
          )}
        </div>

        {/* プレビュー */}
        {rows.length > 0 && (
          <>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-[#1f2937]">{rows.length}件 読み込み</span>
              {validCount > 0 && (
                <span className="text-green-700">有効: {validCount}件</span>
              )}
              {errorCount > 0 && (
                <span className="text-red-600">エラー: {errorCount}件</span>
              )}
            </div>

            <div className="overflow-x-auto max-h-[300px] overflow-y-auto rounded-lg border border-gray-200">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-500">行</th>
                    <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-500">テスト名</th>
                    <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-500">試験月</th>
                    <th className="px-2 py-1.5 text-center text-xs font-medium text-gray-500">英</th>
                    <th className="px-2 py-1.5 text-center text-xs font-medium text-gray-500">数</th>
                    <th className="px-2 py-1.5 text-center text-xs font-medium text-gray-500">国</th>
                    <th className="px-2 py-1.5 text-center text-xs font-medium text-gray-500">理</th>
                    <th className="px-2 py-1.5 text-center text-xs font-medium text-gray-500">社</th>
                    <th className="px-2 py-1.5 text-center text-xs font-medium text-gray-500">3科</th>
                    <th className="px-2 py-1.5 text-center text-xs font-medium text-gray-500">5科</th>
                    <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-500">状態</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.rowIndex}
                      className={row.errors.length > 0 ? 'bg-red-50' : 'hover:bg-gray-50'}
                    >
                      <td className="px-2 py-1 text-xs text-gray-400">{row.rowIndex}</td>
                      <td className="px-2 py-1 text-xs">{row.name_code === 'venue' ? '会場模試' : row.name_code === 'classroom' ? '教室模試' : row.name_code}</td>
                      <td className="px-2 py-1 text-xs">{row.exam_month}</td>
                      <td className="px-2 py-1 text-xs text-center">{row.scores.english ?? '—'}</td>
                      <td className="px-2 py-1 text-xs text-center">{row.scores.math ?? '—'}</td>
                      <td className="px-2 py-1 text-xs text-center">{row.scores.japanese ?? '—'}</td>
                      <td className="px-2 py-1 text-xs text-center">{row.scores.science ?? '—'}</td>
                      <td className="px-2 py-1 text-xs text-center">{row.scores.social ?? '—'}</td>
                      <td className="px-2 py-1 text-xs text-center">{row.scores.hensa_3 ?? '—'}</td>
                      <td className="px-2 py-1 text-xs text-center">{row.scores.hensa_5 ?? '—'}</td>
                      <td className="px-2 py-1 text-xs">
                        {row.errors.length > 0 ? (
                          <span className="text-red-600" title={row.errors.join('\n')}>
                            {row.errors[0]}
                          </span>
                        ) : (
                          <span className="text-green-600">OK</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* インポート結果 */}
        {importResult && (
          <div className={`p-3 rounded-lg text-sm ${importResult.failed > 0 ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-800'}`}>
            インポート完了: {importResult.success}件成功
            {importResult.failed > 0 && `、${importResult.failed}件失敗`}
          </div>
        )}

        {/* アクション */}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={handleClose}>
            閉じる
          </Button>
          <Button
            variant="primary"
            onClick={handleImport}
            disabled={validCount === 0 || isImporting || !!importResult}
          >
            {isImporting ? 'インポート中...' : `${validCount}件をインポート`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
