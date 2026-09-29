'use client';

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { Modal, Button } from '@/components/ui';
import { createAssessmentRow, updateScore } from '@/lib/api/assessments';
import {
  applyMockTargetSchools,
  getAllHighSchoolKeys,
  getTargetSchoolsByStudents,
  insertAssessmentTargetSchools,
  type MockSchoolToSave,
} from '@/lib/api/mockTargetSchools';
import {
  planTargetSchoolsFromMock,
  type CurrentTargetRow,
  type TargetPlan,
  type TargetPlanKind,
} from '@/lib/scores/mockTargetPlan';
// ★読み取り（パース）は純関数にして lib へ出した。テストはそちらを直接叩く
import { parseFileRows, parsePastedData, type ParsedMockRow } from '@/lib/scores/mockImportParse';
import {
  formatPossibility,
  mastersForSlot,
  matchMockSchoolName,
  mockSchoolShortName,
  type HighSchoolKeyRow,
} from '@/lib/scores/mockSchools';
import { regionOfSchool, REGION_LABEL } from '@/lib/interview/region';
import type { Student } from '@/types/database';
import { GRADE_LABELS } from '@/types/database';
import { AlertCircle, Check, HelpCircle, Upload, ClipboardPaste } from 'lucide-react';

interface MockPasteImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  students: Student[];
  onImportComplete: () => void;
}

type InputMode = 'file' | 'paste';

/** 反映の種類の札 */
const PLAN_KIND_LABEL: Record<Exclude<TargetPlanKind, 'none'>, string> = {
  new: '新規',
  change: '差し替え',
  same: '同じ',
};
const PLAN_KIND_CLASS: Record<Exclude<TargetPlanKind, 'none'>, string> = {
  new: 'bg-info-subtle text-info',
  change: 'bg-warning-subtle text-warning',
  same: 'bg-surface-hover text-text-muted',
};

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
    /** 志望校が空だったので模試の志望校を入れた生徒の数 */
    filled: number;
    /** 志望校を模試の志望校に差し替えた生徒の名前 */
    replaced: string[];
    /** プレビューの後に志望校が直されていたので、反映しなかった生徒の数 */
    conflicted: number;
    /** 成績は入ったが、模試の志望校の保存に失敗した生徒の数 */
    schoolFailed: number;
  } | null>(null);
  /**
   * 模試の志望校を、生徒の志望校に反映するか（全体のスイッチ）。
   * ★既定はON。志望校は模試のたびに変わるので、取り込みで最新にしたい（教室長 2026-09-28）。
   *   ただし黙って書き換えない。生徒ごとに前後を見せ、チェックで外せる（mockTargetPlan.ts）。
   */
  const [applyTargets, setApplyTargets] = useState(true);
  /** 生徒ごとのチェックを人が変えたもの。無ければ計画の既定（defaultApply） */
  const [applyOverrides, setApplyOverrides] = useState<Record<string, boolean>>({});
  /** 模試に出てきた学校名で引いた高校マスタ（当ての材料） */
  const [masterRows, setMasterRows] = useState<HighSchoolKeyRow[]>([]);
  /** 生徒ID→いまの志望校。null＝まだ読めていない */
  const [currentTargets, setCurrentTargets] = useState<Map<string, CurrentTargetRow[]> | null>(
    null
  );
  /** いまの志望校が読めなかった。★読めないまま反映すると前後を見せずに書き換えるので、反映を止める */
  const [targetsError, setTargetsError] = useState(false);
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

  /**
   * 当てに使う高校マスタ。模試に志望校が1つでも出たら、全件を1度だけ引く（getAllHighSchoolKeys の注記）。
   * ★引き終わるまでは当たらない（名前だけで入る）ので、取り込みボタンは読み終わるまで押せなくする。
   */
  const hasMockSchools = parsed.some((r) => r.schools.length > 0);
  const [masterReady, setMasterReady] = useState(false);
  useEffect(() => {
    if (!hasMockSchools || masterReady) return;
    let alive = true;
    getAllHighSchoolKeys()
      .then((rows) => {
        if (alive) setMasterRows(rows);
      })
      // 読めなければ当てずに名前だけで入れる（取り込みそのものは止めない）
      .catch(() => {
        if (alive) setMasterRows([]);
      })
      .finally(() => {
        if (alive) setMasterReady(true);
      });
    return () => {
      alive = false;
    };
  }, [hasMockSchools, masterReady]);

  const matchedStudentIdsKey = useMemo(
    () =>
      parsed
        .map((r) => r.matchedStudent?.id)
        .filter((id): id is string => Boolean(id))
        .sort()
        .join('|'),
    [parsed]
  );
  useEffect(() => {
    const ids = matchedStudentIdsKey ? matchedStudentIdsKey.split('|') : [];
    setTargetsError(false);
    if (ids.length === 0) {
      setCurrentTargets(new Map());
      return;
    }
    let alive = true;
    setCurrentTargets(null);
    getTargetSchoolsByStudents(ids)
      .then((m) => {
        if (alive) setCurrentTargets(m);
      })
      .catch(() => {
        if (alive) setTargetsError(true);
      });
    return () => {
      alive = false;
    };
  }, [matchedStudentIdsKey]);

  /**
   * 1行ぶんの志望校を、保存する形（マスタに当てた結果つき）にする。
   * ★1〜3枠は公立のマスタだけ、4〜5枠は私立・国立のマスタだけに当てる（mastersForSlot。
   *   同じ名前の公立と私立がある）。
   * ★都県は生徒の教室から決める（「多摩」は東京と神奈川の両方にある）。
   */
  const schoolsToSave = useCallback(
    (row: ParsedMockRow): MockSchoolToSave[] => {
      const region = regionOfSchool(row.matchedStudent?.school_id);
      const prefer = REGION_LABEL[region ?? 'tokyo'];
      return row.schools.map((c) => {
        const m = matchMockSchoolName(c.nameRaw, mastersForSlot(masterRows, c.isPublic), prefer);
        return {
          ...c,
          highSchoolId: m.highSchoolId,
          // ★志望校に入れる名前は、マスタに当たればマスタの名前（志望校の入力欄と同じ形）、
          //   当たらなければ模試の名前を面談で読む形にしたもの（「駒沢学園女子（特進）」）
          schoolName: m.highSchoolId ? m.schoolName : mockSchoolShortName(c.nameRaw),
        };
      });
    },
    [masterRows]
  );

  /** 生徒ID→志望校の反映の計画（前後・既定のチェック）。いまの志望校が読めるまでは空 */
  const plans = useMemo(() => {
    const m = new Map<string, TargetPlan>();
    if (!currentTargets) return m;
    const examMonthOrNull = examMonth || null;
    for (const r of parsed) {
      const id = r.matchedStudent?.id;
      if (!id) continue;
      m.set(
        id,
        planTargetSchoolsFromMock(currentTargets.get(id) ?? [], schoolsToSave(r), examMonthOrNull)
      );
    }
    return m;
  }, [parsed, currentTargets, schoolsToSave, examMonth]);

  const willApply = useCallback(
    (studentId: string): boolean => {
      const plan = plans.get(studentId);
      if (!plan || plan.kind === 'none' || plan.kind === 'same') return false;
      return applyOverrides[studentId] ?? plan.defaultApply;
    },
    [plans, applyOverrides]
  );

  const planCounts = useMemo(() => {
    const c = { new: 0, change: 0, same: 0, applyChange: 0 };
    plans.forEach((p, id) => {
      if (p.kind === 'none') return;
      c[p.kind]++;
      if (p.kind === 'change' && willApply(id)) c.applyChange++;
    });
    return c;
  }, [plans, willApply]);
  const unmatchedCount = parsed.filter((r) => !r.matchedStudent).length;

  const processFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    setFileError('');
    setImportResult(null);

    try {
      const allRows: (string | number | undefined)[][] = [];
      const fileNames: string[] = [];

      for (const file of files) {
        fileNames.push(file.name);
        const ext = file.name.toLowerCase().split('.').pop();

        if (ext === 'xlsx' || ext === 'xls') {
          const formData = new FormData();
          formData.append('file', file);
          const res = await fetch('/api/scores/parse-xlsx', { method: 'POST', body: formData });
          if (!res.ok) throw new Error('xlsx parse failed: ' + file.name);
          const { rows } = await res.json();
          if (allRows.length === 0) {
            allRows.push(...rows);
          } else {
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
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await processFiles(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const [isDragging, setIsDragging] = useState(false);
  const dragCountRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current++;
    if (dragCountRef.current === 1) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current--;
    if (dragCountRef.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCountRef.current = 0;
      setIsDragging(false);

      const droppedFiles = Array.from(e.dataTransfer.files);
      if (droppedFiles.length > 0) {
        await processFiles(droppedFiles);
      }
    },
    [processFiles]
  );

  const handleImport = async () => {
    const importable = parsed.filter((r) => r.matchedStudent);
    if (importable.length === 0) return;

    setIsImporting(true);
    let success = 0;
    let failed = 0;
    let filled = 0;
    let conflicted = 0;
    const replaced: string[] = [];
    let schoolFailed = 0;

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

        /**
         * 模試の志望校と合格可能性。★成績の取り込みとは別に失敗を数える。
         *   ここで落ちても成績は入っているので、成績まで「失敗」と数えない。
         */
        if (row.schools.length > 0) {
          try {
            const schools = schoolsToSave(row);
            await insertAssessmentTargetSchools(
              assessment.id,
              student.id,
              student.school_id,
              schools
            );
            const plan = plans.get(student.id);
            if (applyTargets && currentTargets && plan && willApply(student.id)) {
              const r = await applyMockTargetSchools(
                student.id,
                student.school_id,
                assessment.id,
                plan.rows,
                currentTargets.get(student.id) ?? []
              );
              if (r === 'conflict') conflicted++;
              else if (plan.kind === 'new') filled++;
              else replaced.push(`${student.last_name} ${student.first_name}`);
            }
          } catch (e) {
            console.error('Mock school import failed for', row.originalName, e);
            schoolFailed++;
          }
        }
      } catch (e) {
        console.error('Import failed for', row.originalName, e);
        failed++;
      }
    }

    setImportResult({
      success,
      failed,
      skipped: unmatchedCount,
      filled,
      replaced,
      conflicted,
      schoolFailed,
    });
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
    setApplyOverrides({});
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="模試結果の一括取り込み" size="xl">
      <div className="space-y-4">
        {/* テスト情報 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-heading mb-1">テスト種別</label>
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
            <label className="block text-xs font-medium text-text-heading mb-1">試験月</label>
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
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className={`w-full border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                isDragging
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/50 hover:bg-primary/5'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                multiple
                onChange={handleFileChange}
                className="hidden"
              />
              <Upload
                className={`w-6 h-6 mx-auto mb-2 ${isDragging ? 'text-primary' : 'text-text-muted'}`}
              />
              {isDragging ? (
                <p className="text-sm text-primary font-medium">ここにドロップ</p>
              ) : fileName ? (
                <p className="text-sm text-text-heading font-medium">{fileName}</p>
              ) : (
                <p className="text-sm text-text-muted">
                  ファイルをドラッグ&ドロップ、またはクリックして選択（複数可）
                  <br />
                  学年別ファイルをまとめて取り込めます
                </p>
              )}
            </div>
            {fileError && <p className="text-xs text-red-600 mt-1">{fileError}</p>}
            <p className="text-[11px] text-text-muted mt-1">
              進研テスト等のダウンロードファイルに対応（学年別ファイルを複数同時選択可）。偏差値と志望校・合格可能性を取り込みます（得点は除外）。
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
              生徒の氏名でNESTの生徒と自動マッチングします。偏差値と志望校・合格可能性を取り込みます。
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

            {/* 志望校への反映。★黙って書き換えない：生徒ごとの前後を表の「志望校に反映」列で見せる */}
            <div className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2 text-xs text-text-body">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={applyTargets && !targetsError}
                  disabled={targetsError}
                  onChange={(e) => setApplyTargets(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">模試の志望校を、生徒の志望校に反映する</span>
                  <span className="ml-1 text-text-muted">
                    （公立・私立とも枠の順に第1〜第5志望。併願の印は付けない）
                  </span>
                </span>
              </label>
              {targetsError ? (
                <span className="text-danger">
                  いまの志望校が読めなかったので、今回は反映しません（成績と模試の志望校は入ります）
                </span>
              ) : currentTargets === null ? (
                <span className="text-text-muted">いまの志望校を確認中…</span>
              ) : (
                applyTargets && (
                  <span className="flex flex-wrap gap-3 text-text-muted">
                    <span>
                      <span className={`mr-1 rounded-full px-1.5 ${PLAN_KIND_CLASS.new}`}>
                        新規
                      </span>
                      {planCounts.new}名（志望校が空）
                    </span>
                    <span>
                      <span className={`mr-1 rounded-full px-1.5 ${PLAN_KIND_CLASS.change}`}>
                        差し替え
                      </span>
                      {planCounts.change}名（うち反映 {planCounts.applyChange}名）
                    </span>
                    <span>
                      <span className={`mr-1 rounded-full px-1.5 ${PLAN_KIND_CLASS.same}`}>
                        同じ
                      </span>
                      {planCounts.same}名
                    </span>
                  </span>
                )
              )}
            </div>

            <div className="overflow-x-auto max-h-[340px] overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-surface-hover sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left text-xs font-medium text-text-muted">
                      氏名
                    </th>
                    <th className="px-2 py-1.5 text-left text-xs font-medium text-text-muted">
                      NEST生徒
                    </th>
                    <th className="px-2 py-1.5 text-center text-xs font-medium text-text-muted">
                      国
                    </th>
                    <th className="px-2 py-1.5 text-center text-xs font-medium text-text-muted">
                      数
                    </th>
                    <th className="px-2 py-1.5 text-center text-xs font-medium text-text-muted">
                      英
                    </th>
                    <th className="px-2 py-1.5 text-center text-xs font-medium text-text-muted">
                      社
                    </th>
                    <th className="px-2 py-1.5 text-center text-xs font-medium text-text-muted">
                      理
                    </th>
                    <th className="px-2 py-1.5 text-center text-xs font-medium text-text-muted">
                      3科SS
                    </th>
                    <th className="px-2 py-1.5 text-center text-xs font-medium text-text-muted">
                      5科SS
                    </th>
                    <th className="px-2 py-1.5 text-left text-xs font-medium text-text-muted">
                      志望校
                    </th>
                    {applyTargets && !targetsError && (
                      <th className="px-2 py-1.5 text-left text-xs font-medium text-text-muted">
                        志望校に反映
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {parsed.map((row, idx) => (
                    <tr
                      key={idx}
                      className={row.matchedStudent ? 'hover:bg-surface-hover' : 'bg-amber-50'}
                    >
                      <td className="px-2 py-1.5 text-xs whitespace-nowrap">{row.originalName}</td>
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
                      {/* 志望校と合格可能性。★判定不能は「判定なし」（0% と書かない） */}
                      <td className="min-w-[220px] px-2 py-1.5 text-xs text-text-muted">
                        {row.schools.length === 0
                          ? '—'
                          : row.schools.map((c) => (
                              <div key={c.slot} className="whitespace-nowrap">
                                {!c.isPublic && <span className="mr-1 text-text-faint">私立</span>}
                                {c.nameRaw}
                                {formatPossibility(c) && (
                                  <span className="ml-1 tabular-nums text-text-body">
                                    {formatPossibility(c)}
                                  </span>
                                )}
                              </div>
                            ))}
                      </td>
                      {applyTargets && !targetsError && (
                        <td className="min-w-[240px] px-2 py-1.5 text-xs">
                          <PlanCell
                            plan={row.matchedStudent ? plans.get(row.matchedStudent.id) : undefined}
                            checked={row.matchedStudent ? willApply(row.matchedStudent.id) : false}
                            onToggle={(v) => {
                              const id = row.matchedStudent?.id;
                              if (id) setApplyOverrides((prev) => ({ ...prev, [id]: v }));
                            }}
                          />
                        </td>
                      )}
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
              importResult.failed > 0 ||
              importResult.schoolFailed > 0 ||
              importResult.conflicted > 0
                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                : 'bg-green-50 text-green-800 border border-green-200'
            }`}
          >
            取り込み完了: {importResult.success}名成功
            {importResult.failed > 0 && `、${importResult.failed}名失敗`}
            {importResult.skipped > 0 && `、${importResult.skipped}名スキップ（未マッチ）`}
            {importResult.filled > 0 && `。志望校を${importResult.filled}名に新しく入れました`}
            {importResult.replaced.length > 0 &&
              `。志望校を${importResult.replaced.length}名差し替えました（${importResult.replaced.join('、')}）`}
            {importResult.conflicted > 0 &&
              `。${importResult.conflicted}名は取り込みの間に志望校が直されていたので、志望校はそのままにしました`}
            {importResult.schoolFailed > 0 &&
              `。${importResult.schoolFailed}名は模試の志望校を保存できませんでした（成績は入っています）`}
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
            disabled={
              matchedCount === 0 ||
              isImporting ||
              !!importResult ||
              // ★前後を見せる前に反映させない（いまの志望校を読み終えるまで待つ）
              (applyTargets && !targetsError && currentTargets === null) ||
              // ★マスタを読み終える前に取り込むと、当たるはずの学校が名前だけで入る
              (hasMockSchools && !masterReady)
            }
          >
            {isImporting ? '取り込み中...' : `${matchedCount}名分を取り込む`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * 表の「志望校に反映」の1マス。チェック・種類の札・行ごとの前後。
 * ★変わる行は「前 → 後」、変わらない行は薄く出す。何が消えて何が入るかを取り込む前に見せる。
 */
function PlanCell({
  plan,
  checked,
  onToggle,
}: {
  plan: TargetPlan | undefined;
  checked: boolean;
  onToggle: (v: boolean) => void;
}) {
  if (!plan) return <span className="text-text-faint">—</span>;
  if (plan.kind === 'none') return <span className="text-text-faint">模試に志望校なし</span>;
  const kind = plan.kind;
  return (
    <div className="flex items-start gap-2">
      <input
        type="checkbox"
        checked={checked}
        disabled={kind === 'same'}
        onChange={(e) => onToggle(e.target.checked)}
        className="mt-0.5"
        aria-label="この生徒の志望校に反映する"
      />
      <div className="flex flex-col gap-0.5">
        <span>
          <span className={`rounded-full px-1.5 text-[11px] ${PLAN_KIND_CLASS[kind]}`}>
            {PLAN_KIND_LABEL[kind]}
          </span>
        </span>
        {kind !== 'same' &&
          plan.lines.map((l) => (
            <span key={l.rank} className="whitespace-nowrap">
              <span className="mr-1 text-text-faint">第{l.rank}</span>
              {l.changed ? (
                <>
                  {l.before && <span className="text-text-faint line-through">{l.before}</span>}
                  {l.before && ' → '}
                  {l.after ? (
                    <span className="font-medium text-text-heading">{l.after}</span>
                  ) : (
                    <span className="text-text-faint">（空欄にする）</span>
                  )}
                </>
              ) : (
                <span className="text-text-muted">{l.after}</span>
              )}
            </span>
          ))}
        {kind === 'change' && plan.manualAfterMock && (
          <span className="text-warning">
            模試の月より後に手で入れた志望校があるので、最初は外しています
          </span>
        )}
      </div>
    </div>
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
