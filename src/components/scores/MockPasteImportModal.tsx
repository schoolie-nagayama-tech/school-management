'use client';

import { useState, useMemo } from 'react';
import { Modal, Button } from '@/components/ui';
import { createAssessmentRow, updateScore } from '@/lib/api/assessments';
import type { Student } from '@/types/database';
import { GRADE_LABELS } from '@/types/database';
import { AlertCircle, Check, HelpCircle } from 'lucide-react';

interface MockPasteImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  students: Student[];
  onImportComplete: () => void;
}

/** パースした1生徒分のデータ */
interface ParsedMockRow {
  /** 元の塾内番号 */
  originalCode: string;
  /** 元の氏名 */
  originalName: string;
  /** マッチしたNEST生徒 */
  matchedStudent: Student | null;
  /** 得点 */
  scores: {
    japanese: number | null;
    math: number | null;
    english: number | null;
    social: number | null;
    science: number | null;
    hensa_3: number | null;
    hensa_5: number | null;
  };
  /** 志望校（表示用） */
  schools: string[];
}

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
function parseNum(val: string | undefined): number | null {
  if (!val) return null;
  const trimmed = val
    .trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (trimmed === '' || trimmed === '-' || trimmed === '—') return null;
  const n = parseFloat(trimmed);
  return isNaN(n) ? null : n;
}

/**
 * 模試会社からコピペされたデータをパースする。
 *
 * フォーマット:
 *   ヘッダー行（複数行にまたがることがある）
 *   生徒行ブロック: 番号 TAB 性別 TAB 氏名
 *   得点行ブロック: 国語得点 TAB 国語SS TAB 数学得点 TAB ... TAB 志望校1 TAB ...
 */
function parsePastedData(text: string, students: Student[]): ParsedMockRow[] {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));

  // ヘッダー的な行をスキップするためのキーワード
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

    // ヘッダー行をスキップ
    const isHeader = headerKeywords.some((kw) => trimmed.includes(kw));
    if (isHeader) continue;

    const cols = trimmed.split('\t');

    // 生徒行の判定: 3列目以降が空 or 未定義、かつ2列目が性別（男/女）
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

    // 得点行の判定: 先頭がスコアっぽい数値
    const firstNum = parseNum(col0);
    if (firstNum !== null && cols.length >= 6) {
      scoreRows.push(cols);
      continue;
    }
  }

  // 生徒行と得点行を1:1で結合
  const results: ParsedMockRow[] = [];
  const count = Math.min(studentRows.length, scoreRows.length);

  for (let i = 0; i < count; i++) {
    const sr = studentRows[i];
    const sc = scoreRows[i];

    // 得点行の列マッピング:
    // 0:国語得点, 1:国語SS, 2:数学得点, 3:数学SS, 4:英語得点, 5:英語SS,
    // 6:社会得点, 7:社会SS, 8:理科得点, 9:理科SS,
    // 10:二科三科得点, 11:二科三科SS, 12:四科五科得点, 13:四科五科SS,
    // 14〜: 志望校名,合格可能性 のペア

    // 志望校を取得
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
        japanese: parseNum(sc[0]),
        math: parseNum(sc[2]),
        english: parseNum(sc[4]),
        social: parseNum(sc[6]),
        science: parseNum(sc[8]),
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
  const [pasteText, setPasteText] = useState('');
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

  // activeな生徒のみ対象
  const activeStudents = useMemo(
    () => students.filter((s) => s.status === 'active' && !s.deleted_at),
    [students]
  );

  const parsed = useMemo(() => {
    if (!pasteText.trim()) return [];
    return parsePastedData(pasteText, activeStudents);
  }, [pasteText, activeStudents]);

  const matchedCount = parsed.filter((r) => r.matchedStudent).length;
  const unmatchedCount = parsed.filter((r) => !r.matchedStudent).length;

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

        {/* 貼り付けエリア */}
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
            生徒の氏名でNESTの生徒と自動マッチングします。塾内番号は使用しません。
          </p>
        </div>

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
