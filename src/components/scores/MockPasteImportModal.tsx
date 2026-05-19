'use client';

import { useState, useMemo, useRef } from 'react';
import { Modal, Button } from '@/components/ui';
import { createAssessmentRow, updateScore } from '@/lib/api/assessments';
import type { Student } from '@/types/database';
import { GRADE_LABELS } from '@/types/database';
import { AlertCircle, Check, HelpCircle, Upload, ClipboardPaste } from 'lucide-react';

interface MockPasteImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  students: Student[];
  onImportComplete: () => void;
}

/** パースした1生徒分のデータ */
interface ParsedMockRow {
  originalCode: string;
  originalName: string;
  matchedStudent: Student | null;
  scores: {
    japanese: number | null;
    math: number | null;
    english: number | null;
    social: number | null;
    science: number | null;
    hensa_3: number | null;
    hensa_5: number | null;
  };
  schools: string[];
}

type InputMode = 'file' | 'paste';

/** 氏名を正規化（全角スペース・半角スペース除去、全角英数→半角） */
function normalizeName(name: string): string {
  return name
    .replace(/[\s　]+/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0)
    )
    .trim();
}

/** 生徒名でマッチング */
function findStudentByName(name: string, students: Student[]): Student | null {
  const normalized = normalizeName(name);
  if (!normalized) return null;

  // 完全一致（姓+名）
  for (const s of students) {
    const fullName = normalizeName(s.last_name + s.first_name);
    if (fullName === normalized) return s;
  }
  // カナ一致
  for (const s of students) {
    const fullKana = normalizeName(s.last_name_kana + s.first_name_kana);
    if (fullKana === normalized) return s;
  }
  // 部分一致（姓だけ一致 + 名の先頭一致）
  for (const s of students) {
    const last = normalizeName(s.last_name);
    const first = normalizeName(s.first_name);
    if (normalized.startsWith(last) && normalized.endsWith(first)) return s;
  }
  return null;
}

/** 数値パース（空白や全角数字対応） */
function parseNum(val: string | number | undefined | null): number | null {
  if (val === undefined || val === null) return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  const trimmed = val
    .trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (trimmed === '' || trimmed === '-' || trimmed === '—') return null;
  const n = parseFloat(trimmed);
  return isNaN(n) ? null : n;
}

/**
 * xlsx/CSVファイルから読み込んだデータをパースする。
 *
 * 進研テストの列構造:
 *   0:登録番号, 1:塾コード, 2:塾名, 3:教室名, 4:学年, 5:塾内番号, 6:性別, 7:氏名,
 *   8:年度, 9:商品, 10:学年, 11:回号,
 *   12:国語得点, 13:国語偏差値, 14:数学得点, 15:数学偏差値,
 *   16:英語得点, 17:英語偏差値, 18:社会得点, 19:社会偏差値,
 *   20:理科得点, 21:理科偏差値, 22:二科三科得点, 23:二科三科偏差値,
 *   24:四科五科得点, 25:四科五科偏差値,
 *   26〜: 志望校名,合格可能性 のペア
 */
function parseFileRows(
  rows: (string | number | undefined)[][],
  students: Student[]
): ParsedMockRow[] {
  const results: ParsedMockRow[] = [];

  // ヘッダー行をスキップ（先頭行）
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 12) continue;

    const name = String(r[7] || '').trim();
    if (!name) continue;

    const schoolList: string[] = [];
    for (let j = 26; j < r.length; j += 2) {
      const schoolName = String(r[j] || '').trim();
      if (schoolName) schoolList.push(schoolName);
    }

    results.push({
      originalCode: String(r[5] || ''),
      originalName: name,
      matchedStudent: findStudentByName(name, students),
      scores: {
        japanese: parseNum(r[13]),
        math: parseNum(r[15]),
        english: parseNum(r[17]),
        social: parseNum(r[19]),
        science: parseNum(r[21]),
        hensa_3: parseNum(r[23]),
        hensa_5: parseNum(r[25]),
      },
      schools: schoolList,
    });
  }

  return results;
}

/**
 * コピペされたデータをパースする。
 *
 * フォーマット:
 *   生徒行ブロック: 番号 TAB 性別 TAB 氏名
 *   得点行ブロック: 国語得点 TAB 国語SS TAB 数学得点 TAB 数学SS TAB ...
 */
function parsePastedData(text: string, students: Student[]): ParsedMockRow[] {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));

  const headerKeywords = [
    '塾内', '番号', '性別', '氏名', '得点', 'ＳＳ', 'SS',
    '志望校', '合格', '可能性', '年度', '商品', '学年', '回号',
    '偏差値',
  ];

  const studentRows: { code: string; name: string }[] = [];
  const scoreRows: string[][] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const isHeader = headerKeywords.some((kw) => trimmed.includes(kw));
    if (isHeader) continue;

    const cols = trimmed.split('\t');
    const col0 = (cols[0] || '').trim();
    const col1 = (cols[1] || '').trim();
    const col2 = (cols[2] || '').trim();

    const isGender = col1 === '男' || col1 === '女';
    const hasName = col2.length > 0 && /[　-鿿゠-ヿ぀-ゟ]/.test(col2);
    const restEmpty = cols.slice(3).every((c) => !c || !c.trim());

    if (isGender && hasName && restEmpty) {
      studentRows.push({ code: col0, name: col2 });
      continue;
    }

    const firstNum = parseNum(col0);
    if (firstNum !== null && cols.length >= 6) {
      scoreRows.push(cols);
      continue;
    }
  }

  const results: ParsedMockRow[] = [];
  const count = Math.min(studentRows.length, scoreRows.length);

  for (let i = 0; i < count; i++) {
    const sr = studentRows[i];
    const sc = scoreRows[i];

    // 偏差値列を参照（得点ではなく SS を取得）
    // 0:国語得点, 1:国語SS, 2:数学得点, 3:数学SS, 4:英語得点, 5:英語SS,
    // 6:社会得点, 7:社会SS, 8:理科得点, 9:理科SS,
    // 10:二科三科得点, 11:二科三科SS, 12:四科五科得点, 13:四科五科SS

    const schoolList: string[] = [];
    for (let j = 14; j < sc.length; j += 2) {
      const name = (sc[j] || '').trim();
      if (name) schoolList.push(name);
    }

    results.push({
      originalCode: sr.code,
      originalName: sr.name,
      matchedStudent: findStudentByName(sr.name, students),
      scores: {
        japanese: parseNum(sc[1]),
        math: parseNum(sc[3]),
        english: parseNum(sc[5]),
        social: parseNum(sc[7]),
        science: parseNum(sc[9]),
        hensa_3: parseNum(sc[11]),
        hensa_5: parseNum(sc[13]),
      },
      schools: schoolList,
    });
  }

  return results;
}

export function MockPasteImportModal({
  isOpen,
  onClose,
  students,
  onImportComplete,
}: MockPasteImportModalProps) {
  const [inputMode, setInputMode] = useState<InputMode>('file');
  const [pasteText, setPasteText] = useState('');
  const [fileRows, setFileRows] = useState<(string | number | undefined)[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState('');
  const [nameCode, setNameCode] = useState<'venue' | 'classroom'>('venue');
  const [examMonth, setExamMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    success: number;
    failed: number;
    skipped: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeStudents = useMemo(
    () => students.filter((s) => s.status === 'active' && !s.deleted_at),
    [students]
  );

  const parsed = useMemo(() => {
    if (inputMode === 'file') {
      if (!fileRows) return [];
      return parseFileRows(fileRows, activeStudents);
    }
    if (!pasteText.trim()) return [];
    return parsePastedData(pasteText, activeStudents);
  }, [inputMode, fileRows, pasteText, activeStudents]);

  const matchedCount = parsed.filter((r) => r.matchedStudent).length;
  const unmatchedCount = parsed.filter((r) => !r.matchedStudent).length;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setFileError('');
    setImportResult(null);

    try {
      const allRows: (string | number | undefined)[][] = [];
      const fileNames: string[] = [];

      for (let fi = 0; fi < files.length; fi++) {
        const file = files[fi];
        fileNames.push(file.name);
        const ext = file.name.toLowerCase().split('.').pop();

        if (ext === 'xlsx' || ext === 'xls') {
          const formData = new FormData();
          formData.append('file', file);
          const res = await fetch('/api/scores/parse-xlsx', { method: 'POST', body: formData });
          if (!res.ok) throw new Error('xlsx parse failed: ' + file.name);
          const { rows } = await res.json();
          // 最初のファイルはヘッダー含む全行、2番目以降はヘッダーをスキップ
          if (allRows.length === 0) {
            allRows.push(...rows);
          } else {
            // ヘッダー行（先頭行）をスキップしてデータ行のみ追加
            for (let i = 1; i < rows.length; i++) {
              allRows.push(rows[i]);
            }
          }
        } else if (ext === 'csv') {
          const text = await file.text();
          const rows = parseCSV(text);
          if (allRows.length === 0) {
            allRows.push(...rows);
          } else {
            for (let i = 1; i < rows.length; i++) {
              allRows.push(rows[i]);
            }
          }
        } else {
          setFileError('xlsx または csv ファイルを選択してください');
          setFileRows(null);
          return;
        }
      }

      setFileName(
        fileNames.length === 1
          ? fileNames[0]
          : `${fileNames.length}件のファイル（${fileNames.join(', ')}）`
      );
      setFileRows(allRows);
    } catch (err) {
      console.error('File read error:', err);
      setFileError('ファイルの読み込みに失敗しました');
      setFileRows(null);
    }

    // reset input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleImport = async () => {
    const importable = parsed.filter((r) => r.matchedStudent);
    if (importable.length === 0) return;

    setIsImporting(true);
    let success = 0;
    let failed = 0;

    for (const row of importable) {
      const student = row.matchedStudent!;
      try {
        const assessment = await createAssessmentRow(
          student.id,
          'mock',
          nameCode,
          student.grade,
          examMonth || null
        );

        for (const [subject, value] of Object.entries(row.scores)) {
          if (value !== null) {
            await updateScore(assessment.id, subject, value);
          }
        }
        success++;
      } catch (e) {
        console.error('Import failed for', row.originalName, e);
        failed++;
      }
    }

    setImportResult({ success, failed, skipped: unmatchedCount });
    setIsImporting(false);

    if (success > 0) {
      onImportComplete();
    }
  };

  const handleClose = () => {
    setPasteText('');
    setFileRows(null);
    setFileName('');
    setFileError('');
    setImportResult(null);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="模試結果の一括取り込み" size="xl">
      <div className="space-y-4">
        {/* テスト情報 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-heading mb-1">
              テスト種別
            </label>
            <select
              value={nameCode}
              onChange={(e) => setNameCode(e.target.value as 'venue' | 'classroom')}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary/30 focus:border-primary"
            >
              <option value="venue">会場模試</option>
              <option value="classroom">教室模試</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-heading mb-1">
              試験月
            </label>
            <input
              type="month"
              value={examMonth}
              onChange={(e) => setExamMonth(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>
        </div>

        {/* 入力モード切替 */}
        <div className="flex gap-1 p-1 bg-surface-hover rounded-lg w-fit">
          <button
            type="button"
            onClick={() => setInputMode('file')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
              inputMode === 'file'
                ? 'bg-white text-text-heading shadow-sm font-medium'
                : 'text-text-muted hover:text-text-body'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            ファイル読込
          </button>
          <button
            type="button"
            onClick={() => setInputMode('paste')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
              inputMode === 'paste'
                ? 'bg-white text-text-heading shadow-sm font-medium'
                : 'text-text-muted hover:text-text-body'
            }`}
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
            コピペ
          </button>
        </div>

        {/* ファイル読込 */}
        {inputMode === 'file' && (
          <div>
            <label className="block text-xs font-medium text-text-heading mb-1">
              模試結果ファイル（xlsx / csv）
            </label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                multiple
                onChange={handleFileChange}
                className="hidden"
              />
              <Upload className="w-6 h-6 text-text-muted mx-auto mb-2" />
              {fileName ? (
                <p className="text-sm text-text-heading font-medium">{fileName}</p>
              ) : (
                <p className="text-sm text-text-muted">
                  クリックしてファイルを選択（複数選択可）<br />
                  学年別ファイルをまとめて選択できます
                </p>
              )}
            </div>
            {fileError && (
              <p className="text-xs text-red-600 mt-1">{fileError}</p>
            )}
            <p className="text-[11px] text-text-muted mt-1">
              進研テスト等のダウンロードファイルに対応（学年別ファイルを複数同時選択可）。偏差値のみ取り込みます（得点は除外）。
            </p>
          </div>
        )}

        {/* コピペ入力 */}
        {inputMode === 'paste' && (
          <div>
            <label className="block text-xs font-medium text-text-heading mb-1">
              模試結果を貼り付け
            </label>
            <textarea
              value={pasteText}
              onChange={(e) => {
                setPasteText(e.target.value);
                setImportResult(null);
              }}
              placeholder="模試会社のサイトから結果表をコピーして、ここに貼り付けてください"
              rows={6}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-white font-mono focus:ring-2 focus:ring-primary/30 focus:border-primary resize-y"
            />
            <p className="text-[11px] text-text-muted mt-1">
              生徒の氏名でNESTの生徒と自動マッチングします。偏差値のみ取り込みます。
            </p>
          </div>
        )}

        {/* プレビュー */}
        {parsed.length > 0 && (
          <>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-text-heading font-medium">{parsed.length}名 検出</span>
              {matchedCount > 0 && (
                <span className="text-green-700 flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" />
                  マッチ: {matchedCount}名
                </span>
              )}
              {unmatchedCount > 0 && (
                <span className="text-amber-600 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  未マッチ: {unmatchedCount}名（スキップ）
                </span>
              )}
            </div>

            <div className="overflow-x-auto max-h-[340px] overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-surface-hover sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left text-xs font-medium text-text-muted">氏名</th>
                    <th className="px-2 py-1.5 text-left text-xs font-medium text-text-muted">NEST生徒</th>
                    <th className="px-2 py-1.5 text-center text-xs font-medium text-text-muted">国</th>
                    <th className="px-2 py-1.5 text-center text-xs font-medium text-text-muted">数</th>
                    <th className="px-2 py-1.5 text-center text-xs font-medium text-text-muted">英</th>
                    <th className="px-2 py-1.5 text-center text-xs font-medium text-text-muted">社</th>
                    <th className="px-2 py-1.5 text-center text-xs font-medium text-text-muted">理</th>
                    <th className="px-2 py-1.5 text-center text-xs font-medium text-text-muted">3科SS</th>
                    <th className="px-2 py-1.5 text-center text-xs font-medium text-text-muted">5科SS</th>
                    <th className="px-2 py-1.5 text-left text-xs font-medium text-text-muted">志望校</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.map((row, idx) => (
                    <tr
                      key={idx}
                      className={
                        row.matchedStudent
                          ? 'hover:bg-surface-hover'
                          : 'bg-amber-50'
                      }
                    >
                      <td className="px-2 py-1.5 text-xs whitespace-nowrap">
                        {row.originalName}
                      </td>
                      <td className="px-2 py-1.5 text-xs whitespace-nowrap">
                        {row.matchedStudent ? (
                          <span className="text-green-700 flex items-center gap-1">
                            <Check className="w-3 h-3" />
                            {row.matchedStudent.last_name} {row.matchedStudent.first_name}
                            <span className="text-text-faint">
                              ({GRADE_LABELS[row.matchedStudent.grade]})
                            </span>
                          </span>
                        ) : (
                          <span className="text-amber-600 flex items-center gap-1">
                            <HelpCircle className="w-3 h-3" />
                            未マッチ
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-center tabular-nums">
                        {row.scores.japanese ?? '—'}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-center tabular-nums">
                        {row.scores.math ?? '—'}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-center tabular-nums">
                        {row.scores.english ?? '—'}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-center tabular-nums">
                        {row.scores.social ?? '—'}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-center tabular-nums">
                        {row.scores.science ?? '—'}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-center tabular-nums font-medium">
                        {row.scores.hensa_3 ?? '—'}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-center tabular-nums font-medium">
                        {row.scores.hensa_5 ?? '—'}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-text-muted max-w-[200px] truncate" title={row.schools.join(', ')}>
                        {row.schools.join(', ') || '—'}
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
          <div
            className={`p-3 rounded-lg text-sm ${
              importResult.failed > 0
                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                : 'bg-green-50 text-green-800 border border-green-200'
            }`}
          >
            取り込み完了: {importResult.success}名成功
            {importResult.failed > 0 && `、${importResult.failed}名失敗`}
            {importResult.skipped > 0 && `、${importResult.skipped}名スキップ（未マッチ）`}
          </div>
        )}

        {/* アクション */}
        <div className="flex justify-end gap-3 pt-2 border-t border-border">
          <Button variant="secondary" onClick={handleClose}>
            閉じる
          </Button>
          <Button
            variant="primary"
            onClick={handleImport}
            disabled={matchedCount === 0 || isImporting || !!importResult}
          >
            {isImporting
              ? '取り込み中...'
              : `${matchedCount}名分を取り込む`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * CSVテキストをパースする。
 * ダブルクォート内の改行・カンマに対応。
 */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        current.push(field);
        field = '';
        i++;
      } else if (ch === '\r') {
        if (i + 1 < text.length && text[i + 1] === '\n') i++;
        current.push(field);
        field = '';
        rows.push(current);
        current = [];
        i++;
      } else if (ch === '\n') {
        current.push(field);
        field = '';
        rows.push(current);
        current = [];
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  if (field || current.length > 0) {
    current.push(field);
    rows.push(current);
  }

  return rows;
}
