'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui';
import { Button } from '@/components/ui';
import { Minus, Plus, Download, Loader2 } from 'lucide-react';
import { StudentSearchInput, type StudentWithSubjects } from './StudentSearchInput';
import { estimateRegularKomaInPeriod, type KoushuPeriodInfo } from '@/lib/api/koushu-period';
import { getProposedKomaBySubject } from '@/lib/api/koushu-proposed-koma';
import type { Subject } from '@/types/database';
import type { ScheduleEntryFormation } from '@/types/schedule';
// Phase A: 講習申込は個別/集団の2列固定。マトリクスのキー型は2値のまま保つ（他形態はここに来ない）。
import { INDIVIDUAL_FORMATION, GROUP_FORMATION } from '@/types/schedule';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';

/** 講習申込マトリクスの列キー。講習は個別/集団の2列のみ（ユーザー定義形態は対象外）。 */
type KoushuFormationColumn = 'individual' | 'group';

/** 申込1件分（formation 別）。科目別コマ数で持つ。 */
export interface EnrollmentRow {
  formation: ScheduleEntryFormation;
  komaBySubject: Record<string, number>;
}

interface KoushuEnrollmentFormModalProps {
  open: boolean;
  onClose: () => void;
  schoolId: string;
  subjects: Subject[];
  /** 既に登録済みの生徒ID（新規追加時の重複防止用） */
  existingStudentIds: string[];
  /** 編集対象の生徒（指定時は検索なしで固定。新規追加時は未指定） */
  lockedStudent?: { id: string; last_name: string; first_name: string; grade: number } | null;
  /** 編集時の既存値（個別/集団の科目別コマ数を事前入力） */
  initialRows?: EnrollmentRow[];
  /** 通常授業回数（個別コマ数の目安）算出用の講習期間 */
  period?: KoushuPeriodInfo | null;
  onSave: (studentId: string, rows: EnrollmentRow[]) => Promise<void>;
}

type Matrix = Record<string, { individual: number; group: number }>;

export function KoushuEnrollmentFormModal({
  open,
  onClose,
  schoolId,
  subjects,
  existingStudentIds,
  lockedStudent,
  initialRows,
  period,
  onSave,
}: KoushuEnrollmentFormModalProps) {
  const [selectedStudent, setSelectedStudent] = useState<StudentWithSubjects | null>(null);
  // 科目 × formation のコマ数マトリクス。matrix[subjectId] = { individual, group }
  const [matrix, setMatrix] = useState<Matrix>({});
  const [regularHint, setRegularHint] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * 科目の絞り込み。既定は「この生徒に関係する科目」だけを出す。
   * 全科目を並べると、受講しない科目の 0 が大半を占めて目的の行を探すことになるため。
   */
  const [showAllSubjects, setShowAllSubjects] = useState(false);
  /** 生徒が履修中の科目ID（新規追加時は検索結果から、編集時は取れないので空） */
  const [studentSubjectIds, setStudentSubjectIds] = useState<string[]>([]);
  /** 提案書から取り込んだ科目別コマ数。取り込みボタンの結果と、行の「提案 n」表示に使う */
  const [proposed, setProposed] = useState<Record<string, number> | null>(null);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [proposalNote, setProposalNote] = useState<string | null>(null);

  const isEditMode = !!lockedStudent;
  const studentId = lockedStudent?.id ?? selectedStudent?.id ?? null;

  useEffect(() => {
    if (!open) return;
    setSelectedStudent(null);
    setError(null);
    setRegularHint(null);
    setShowAllSubjects(false);
    setStudentSubjectIds([]);
    setProposed(null);
    setProposalNote(null);
    const init: Matrix = {};
    for (const row of initialRows ?? []) {
      // 講習申込は個別/集団の2列固定。混入した他形態行は無視して2列を汚さない。
      if (row.formation !== INDIVIDUAL_FORMATION && row.formation !== GROUP_FORMATION) continue;
      const col: KoushuFormationColumn =
        row.formation === GROUP_FORMATION ? GROUP_FORMATION : INDIVIDUAL_FORMATION;
      for (const [sid, n] of Object.entries(row.komaBySubject)) {
        if (!init[sid]) init[sid] = { individual: 0, group: 0 };
        init[sid][col] = n;
      }
    }
    setMatrix(init);
  }, [open, initialRows]);

  /** 提案書を読み込む。取り込みボタンの元になる数字で、行の目安表示にも使う。 */
  const loadProposal = useCallback(
    async (sid: string) => {
      if (!period) return;
      setProposalLoading(true);
      setProposalNote(null);
      try {
        const result = await getProposedKomaBySubject(sid, period.season, period.year);
        setProposed(result.komaBySubject);
        if (Object.keys(result.komaBySubject).length === 0) {
          setProposalNote('この生徒の提案書が見つかりません（手入力してください）');
        } else if (result.unresolvedCount > 0) {
          // 黙って落とすと「提案したのに出てこない」原因が分からないので必ず知らせる
          setProposalNote(
            `${result.unresolvedCount}枚の提案書は教材に科目が設定されておらず取り込めません`
          );
        }
      } catch {
        setProposed({});
        setProposalNote('提案書の取得に失敗しました');
      } finally {
        setProposalLoading(false);
      }
    },
    [period]
  );

  // 編集時は開いた時点で生徒が確定しているので、そのまま提案書を読む
  useEffect(() => {
    if (!open || !lockedStudent) return;
    void loadProposal(lockedStudent.id);
  }, [open, lockedStudent, loadProposal]);

  // 新規追加時、生徒を選んだら通常授業回数の目安と提案書をまとめて取る
  const handleSelectStudent = async (student: StudentWithSubjects | null) => {
    setSelectedStudent(student);
    setStudentSubjectIds(student?.subjects?.map((s) => s.id) ?? []);
    if (!student) return;
    if (period) {
      try {
        setRegularHint(await estimateRegularKomaInPeriod(student.id, period));
      } catch {
        setRegularHint(null);
      }
    }
    void loadProposal(student.id);
  };

  /**
   * 表示する科目。既定は「関係のある科目」だけに絞る:
   *   履修中の科目 ∪ 提案書に出ている科目 ∪ すでに値が入っている科目
   * 1つも該当しなければ絞る意味がないので全科目を出す（空の表を見せない）。
   */
  const visibleSubjects = useMemo(() => {
    if (showAllSubjects) return subjects;
    const keep = new Set<string>(studentSubjectIds);
    for (const sid of Object.keys(proposed ?? {})) keep.add(sid);
    for (const [sid, v] of Object.entries(matrix)) {
      if (v.individual > 0 || v.group > 0) keep.add(sid);
    }
    if (keep.size === 0) return subjects;
    return subjects.filter((s) => keep.has(s.id));
  }, [showAllSubjects, subjects, studentSubjectIds, proposed, matrix]);

  const hiddenCount = subjects.length - visibleSubjects.length;

  const setCell = (subjectId: string, formation: KoushuFormationColumn, value: number) => {
    setMatrix((prev) => {
      const cur = prev[subjectId] ?? { individual: 0, group: 0 };
      const base = { individual: cur.individual, group: cur.group };
      base[formation] = Math.min(99, Math.max(0, value));
      return { ...prev, [subjectId]: base };
    });
  };

  /** 提案書のコマ数を個別列に入れる。集団はコース単位で別管理なので触らない。 */
  const applyProposal = () => {
    if (!proposed) return;
    setMatrix((prev) => {
      const next: Matrix = { ...prev };
      for (const [sid, koma] of Object.entries(proposed)) {
        const cur = next[sid] ?? { individual: 0, group: 0 };
        next[sid] = { individual: koma, group: cur.group };
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!studentId) {
      setError('生徒を選択してください');
      return;
    }

    const indiv: Record<string, number> = {};
    const group: Record<string, number> = {};
    for (const [sid, v] of Object.entries(matrix)) {
      if (v.individual > 0) indiv[sid] = v.individual;
      if (v.group > 0) group[sid] = v.group;
    }

    // 個別/集団それぞれ行を作る。空（全0）でも upsert 側で削除扱いになるよう、編集時は両方渡す。
    const rows: EnrollmentRow[] = [
      { formation: INDIVIDUAL_FORMATION, komaBySubject: indiv },
      { formation: GROUP_FORMATION, komaBySubject: group },
    ];
    if (!isEditMode && Object.keys(indiv).length === 0 && Object.keys(group).length === 0) {
      setError('いずれかの科目にコマ数を1以上で入力してください');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave(studentId, rows);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const studentLabel = lockedStudent
    ? `${lockedStudent.last_name} ${lockedStudent.first_name}（${formatGradeLabel(lockedStudent.grade)}）`
    : null;

  const indivTotal = Object.values(matrix).reduce((s, v) => s + (v.individual || 0), 0);
  const groupTotal = Object.values(matrix).reduce((s, v) => s + (v.group || 0), 0);
  const proposedTotal = Object.values(proposed ?? {}).reduce((s, n) => s + n, 0);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditMode ? '講習申込を編集' : '生徒を追加'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* 生徒選択 */}
          {isEditMode ? (
            <div>
              <label className="block text-sm font-medium text-[var(--headline)] mb-1">生徒</label>
              <div className="px-3 py-2 bg-gray-50 rounded-md text-sm">{studentLabel}</div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-[var(--headline)] mb-1">
                生徒を選択 <span className="text-red-500">*</span>
              </label>
              <StudentSearchInput
                schoolId={schoolId}
                excludeStudentIds={existingStudentIds}
                onSelect={handleSelectStudent}
                placeholder="氏名・かなで検索..."
              />
              {selectedStudent && (
                <div className="mt-2 text-sm text-[var(--headline)] bg-blue-50 px-3 py-2 rounded-md">
                  {selectedStudent.last_name} {selectedStudent.first_name}（
                  {formatGradeLabel(selectedStudent.grade)}）
                  {regularHint != null && (
                    <span className="ml-2 text-xs text-[var(--paragraph)]">
                      講習期間中の通常授業: 約{regularHint}コマ
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 提案書からの取り込み。手入力を減らすための主導線なので科目表の上に置く。 */}
          {studentId && (
            <div className="rounded-md border border-[var(--stroke)] bg-gray-50 px-3 py-2">
              {proposalLoading ? (
                <p className="flex items-center gap-2 text-xs text-[var(--paragraph)]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  提案書を確認しています…
                </p>
              ) : proposedTotal > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-[var(--paragraph)]">
                    提案書あり（{Object.keys(proposed ?? {}).length}科目・合計{proposedTotal}コマ）
                  </span>
                  <Button size="sm" variant="outline" onClick={applyProposal} className="ml-auto">
                    <Download className="mr-1 h-3.5 w-3.5" />
                    提案どおり入力
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-[var(--paragraph)]">
                  {proposalNote ?? '提案書が見つかりません（手入力してください）'}
                </p>
              )}
              {proposedTotal > 0 && proposalNote && (
                <p className="mt-1 text-xs text-amber-700">{proposalNote}</p>
              )}
            </div>
          )}

          {/* 科目別コマ数（科目 × 個別/集団） */}
          <div>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <label className="text-sm font-medium text-[var(--headline)]">科目別コマ数</label>
              <span className="text-xs text-[var(--paragraph)]">
                合計 個別{indivTotal} / 集団{groupTotal} コマ
              </span>
            </div>
            {subjects.length === 0 ? (
              <p className="text-xs text-[var(--paragraph)]">科目が登録されていません</p>
            ) : (
              <>
                <div className="border border-[var(--stroke)] rounded-md overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-[var(--paragraph)]">
                      <tr>
                        <th className="text-left px-2 py-1.5 font-medium">科目</th>
                        <th className="px-2 py-1.5 font-medium w-[104px]">個別</th>
                        <th className="px-2 py-1.5 font-medium w-[104px]">集団</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleSubjects.map((s) => {
                        const cell = matrix[s.id] ?? { individual: 0, group: 0 };
                        const p = proposed?.[s.id];
                        return (
                          <tr key={s.id} className="border-t border-gray-100">
                            <td className="px-2 py-1 text-[var(--headline)]">
                              {s.name}
                              {p != null && p > 0 && (
                                <span className="ml-1.5 text-[10px] text-[var(--paragraph)]">
                                  提案{p}
                                </span>
                              )}
                            </td>
                            <td className="px-1 py-1">
                              <KomaStepper
                                value={cell.individual}
                                label={`${s.name} 個別`}
                                onChange={(v) => setCell(s.id, INDIVIDUAL_FORMATION, v)}
                              />
                            </td>
                            <td className="px-1 py-1">
                              <KomaStepper
                                value={cell.group}
                                label={`${s.name} 集団`}
                                onChange={(v) => setCell(s.id, GROUP_FORMATION, v)}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* 絞り込みの解除。隠している件数を出さないと「科目が足りない」と誤解される。 */}
                {(hiddenCount > 0 || showAllSubjects) && (
                  <button
                    type="button"
                    onClick={() => setShowAllSubjects((v) => !v)}
                    className="mt-1.5 text-xs text-[var(--primary)] underline-offset-2 hover:underline"
                  >
                    {showAllSubjects
                      ? '受講する科目だけ表示'
                      : `他の科目も表示（${hiddenCount}科目を隠しています）`}
                  </button>
                )}
              </>
            )}
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * コマ数の入力。数値キーボードを出さず、増減をクリックだけで済ませる。
 *
 * ★ number input をやめた理由:
 *   講習の申込は1科目あたり数コマ〜十数コマで、大半は「提案どおり」か「±1」。
 *   input だと 1件ごとに フォーカス→全選択→打鍵 が要り、科目数ぶん繰り返すことになる。
 *   数字自体は表示のみにして、押せる面積を大きく取る。
 */
function KomaStepper({
  value,
  label,
  onChange,
}: {
  value: number;
  label: string;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-0.5">
      <button
        type="button"
        aria-label={`${label} を1減らす`}
        disabled={value <= 0}
        onClick={() => onChange(value - 1)}
        className="flex h-7 w-7 items-center justify-center rounded border border-[var(--stroke)] bg-white text-[var(--paragraph)] transition-colors hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-white"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span
        className={`w-7 text-center text-sm tabular-nums ${
          value > 0 ? 'font-bold text-[var(--headline)]' : 'text-gray-300'
        }`}
      >
        {value}
      </span>
      <button
        type="button"
        aria-label={`${label} を1増やす`}
        onClick={() => onChange(value + 1)}
        className="flex h-7 w-7 items-center justify-center rounded border border-[var(--stroke)] bg-white text-[var(--paragraph)] transition-colors hover:bg-gray-100"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
