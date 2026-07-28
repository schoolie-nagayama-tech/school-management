'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { Button, Loading } from '@/components/ui';
import {
  KoushuEnrollmentFormModal,
  type EnrollmentRow,
} from '@/components/schedule/KoushuEnrollmentFormModal';
import {
  getKoushuEnrollmentsForPeriod,
  upsertKoushuEnrollment,
  deleteKoushuEnrollment,
  type KoushuEnrollment,
} from '@/lib/api/seasonalCourses';
import {
  getKoushuPeriods,
  getStudentRegularSchedule,
  type KoushuPeriodInfo,
} from '@/lib/api/koushu-period';
// Phase A: 講習申込は individual/group の2列固定（ユーザー定義形態は講習スコープ外）。
// 他形態データが来ても混入しないよう定数で判定する。
import { INDIVIDUAL_FORMATION, GROUP_FORMATION } from '@/types/schedule';
import { useMasterData } from '@/contexts/MasterDataContext';
import { useAuth } from '@/contexts/AuthContext';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

/** 生徒1人分の講習申込（個別/集団） */
interface StudentRow {
  student_id: string;
  student?: { id: string; last_name: string; first_name: string; grade: number };
  individual?: KoushuEnrollment;
  group?: KoushuEnrollment;
}

type StudentSchedule = Awaited<ReturnType<typeof getStudentRegularSchedule>>;

/**
 * 講習申込の生徒別 管理。「申込管理」画面の講習タブとして使う
 * （レイアウト/権限ガードは親が担当）。
 */
export function KoushuEnrollmentManager() {
  const { selectedSchoolId } = useAuth();
  const { subjects } = useMasterData();
  const schoolId = selectedSchoolId ?? '';

  const subjectNameById = useMemo(() => new Map(subjects.map((s) => [s.id, s.name])), [subjects]);

  const [periods, setPeriods] = useState<KoushuPeriodInfo[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<KoushuPeriodInfo | null>(null);
  const [enrollments, setEnrollments] = useState<KoushuEnrollment[]>([]);
  const [loading, setLoading] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<StudentRow | null>(null);

  const [openStudent, setOpenStudent] = useState<string | null>(null);
  const [sched, setSched] = useState<StudentSchedule>([]);
  const [schedLoading, setSchedLoading] = useState(false);

  const [deletingStudent, setDeletingStudent] = useState<StudentRow | null>(null);

  useEffect(() => {
    if (!schoolId) {
      setPeriods([]);
      setSelectedPeriod(null);
      return;
    }
    getKoushuPeriods(schoolId)
      .then((p) => {
        setPeriods(p);
        setSelectedPeriod((cur) => cur ?? p[0] ?? null);
      })
      .catch(() => setPeriods([]));
  }, [schoolId]);

  const loadEnrollments = useCallback(async () => {
    if (!schoolId || !selectedPeriod) {
      setEnrollments([]);
      return;
    }
    setLoading(true);
    try {
      setEnrollments(await getKoushuEnrollmentsForPeriod(schoolId, selectedPeriod.season));
    } finally {
      setLoading(false);
    }
  }, [schoolId, selectedPeriod]);

  useEffect(() => {
    loadEnrollments();
  }, [loadEnrollments]);

  const studentRows = useMemo<StudentRow[]>(() => {
    const map = new Map<string, StudentRow>();
    for (const e of enrollments) {
      // 講習申込は個別/集団の2値のみ扱う。ユーザー定義形態が混ざっても無視して2列を汚さない。
      if (e.formation !== INDIVIDUAL_FORMATION && e.formation !== GROUP_FORMATION) continue;
      const g = map.get(e.student_id) ?? { student_id: e.student_id, student: e.student };
      if (e.formation === GROUP_FORMATION) g.group = e;
      else g.individual = e;
      map.set(e.student_id, g);
    }
    return Array.from(map.values()).sort(
      (a, b) => (b.student?.grade ?? 0) - (a.student?.grade ?? 0)
    );
  }, [enrollments]);

  const existingStudentIds = studentRows.map((r) => r.student_id);

  const handleSave = async (studentId: string, rows: EnrollmentRow[]) => {
    if (!selectedPeriod) return;
    for (const r of rows) {
      await upsertKoushuEnrollment(
        schoolId,
        selectedPeriod.season,
        studentId,
        r.komaBySubject,
        r.formation
      );
    }
    await loadEnrollments();
  };

  const handleDelete = async () => {
    if (!deletingStudent) return;
    if (deletingStudent.individual) await deleteKoushuEnrollment(deletingStudent.individual.id);
    if (deletingStudent.group) await deleteKoushuEnrollment(deletingStudent.group.id);
    setDeletingStudent(null);
    await loadEnrollments();
  };

  const toggleSchedule = useCallback(
    async (studentId: string) => {
      if (openStudent === studentId) {
        setOpenStudent(null);
        return;
      }
      setOpenStudent(studentId);
      setSchedLoading(true);
      try {
        setSched(await getStudentRegularSchedule(studentId));
      } catch {
        setSched([]);
      } finally {
        setSchedLoading(false);
      }
    },
    [openStudent]
  );

  const komaSummary = (en?: KoushuEnrollment): string => {
    if (!en) return '—';
    const kbs = en.koma_by_subject ?? {};
    const parts = Object.entries(kbs).map(
      ([sid, n]) => `${subjectNameById.get(sid) ?? sid.slice(0, 4)}${n}`
    );
    return parts.length > 0 ? parts.join('・') : `${en.koma_count}コマ`;
  };

  const editInitialRows = (r: StudentRow): EnrollmentRow[] => {
    const rows: EnrollmentRow[] = [];
    if (r.individual?.koma_by_subject)
      rows.push({ formation: INDIVIDUAL_FORMATION, komaBySubject: r.individual.koma_by_subject });
    if (r.group?.koma_by_subject)
      rows.push({ formation: GROUP_FORMATION, komaBySubject: r.group.koma_by_subject });
    return rows;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-[var(--paragraph)]">
          講習（春期/夏期/冬期）の申込。生徒ごとに科目×個別/集団のコマ数を登録します。
        </p>
        {selectedPeriod && (
          <Button
            onClick={() => {
              setEditingStudent(null);
              setFormOpen(true);
            }}
            className="flex items-center gap-1"
          >
            <Plus className="w-4 h-4" />
            生徒を追加
          </Button>
        )}
      </div>

      {!schoolId && (
        <div className="text-center py-12 text-[var(--paragraph)]">教室を選択してください。</div>
      )}

      {schoolId && periods.length === 0 && (
        <div className="text-center py-12 text-[var(--paragraph)]">
          <p className="mb-4">講習期間が設定されていません。</p>
          <Link href="/courses/progress">
            <Button>講習期間を設定する</Button>
          </Link>
        </div>
      )}

      {schoolId && periods.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-[var(--paragraph)] font-medium">講習期間:</span>
          {periods.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedPeriod(p)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                selectedPeriod?.id === p.id
                  ? 'bg-[var(--headline)] text-white border-[var(--headline)]'
                  : 'bg-white text-[var(--paragraph)] border-[var(--stroke)] hover:bg-gray-50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {schoolId &&
        selectedPeriod &&
        (loading ? (
          <Loading size="md" />
        ) : studentRows.length === 0 ? (
          <div className="text-center py-12 text-[var(--paragraph)]">
            <p className="mb-4">まだ申込がありません。</p>
            <Button
              onClick={() => {
                setEditingStudent(null);
                setFormOpen(true);
              }}
            >
              <Plus className="w-4 h-4 mr-1" />
              最初の生徒を追加
            </Button>
          </div>
        ) : (
          <div className="border border-[var(--stroke)] rounded-xl overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-[var(--paragraph)]">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">生徒</th>
                  <th className="text-left px-3 py-2 font-medium">学年</th>
                  <th className="text-left px-3 py-2 font-medium">個別（科目別）</th>
                  <th className="text-left px-3 py-2 font-medium">集団（科目別）</th>
                  <th className="px-3 py-2 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {studentRows.map((r) => {
                  const isOpen = openStudent === r.student_id;
                  return (
                    <FragmentRow
                      key={r.student_id}
                      row={r}
                      isOpen={isOpen}
                      sched={sched}
                      schedLoading={schedLoading}
                      komaSummary={komaSummary}
                      onToggleSchedule={() => toggleSchedule(r.student_id)}
                      onEdit={() => {
                        setEditingStudent(r);
                        setFormOpen(true);
                      }}
                      onDelete={() => setDeletingStudent(r)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

      <KoushuEnrollmentFormModal
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditingStudent(null);
        }}
        schoolId={schoolId}
        subjects={subjects}
        existingStudentIds={editingStudent ? [] : existingStudentIds}
        lockedStudent={editingStudent?.student ?? null}
        initialRows={editingStudent ? editInitialRows(editingStudent) : undefined}
        period={selectedPeriod}
        onSave={handleSave}
      />

      {deletingStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="font-bold text-[var(--headline)] mb-2">申込を削除しますか？</h3>
            <p className="text-sm text-[var(--paragraph)] mb-4">
              {deletingStudent.student
                ? `${deletingStudent.student.last_name} ${deletingStudent.student.first_name}`
                : ''}
              の講習申込（個別・集団）を削除します。
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={() => setDeletingStudent(null)}>
                キャンセル
              </Button>
              <Button variant="danger" onClick={handleDelete}>
                削除する
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 生徒1行（＋通塾日程の展開行） */
function FragmentRow({
  row,
  isOpen,
  sched,
  schedLoading,
  komaSummary,
  onToggleSchedule,
  onEdit,
  onDelete,
}: {
  row: StudentRow;
  isOpen: boolean;
  sched: StudentSchedule;
  schedLoading: boolean;
  komaSummary: (en?: KoushuEnrollment) => string;
  onToggleSchedule: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <tr className="border-t border-gray-100 hover:bg-gray-50/60 transition-colors">
        <td className="px-3 py-2 font-medium text-[var(--headline)]">
          <button
            type="button"
            onClick={onToggleSchedule}
            className="inline-flex items-center gap-1 hover:underline"
            title="通塾日程を表示"
          >
            {isOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
            )}
            {row.student ? `${row.student.last_name} ${row.student.first_name}` : '—'}
          </button>
        </td>
        <td className="px-3 py-2 text-[var(--paragraph)]">
          {row.student ? formatGradeLabel(row.student.grade) : '—'}
        </td>
        <td className="px-3 py-2">
          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-info-subtle text-info border border-info/20 mr-1.5">
            個別
          </span>
          <span className="text-[var(--paragraph)]">{komaSummary(row.individual)}</span>
        </td>
        <td className="px-3 py-2">
          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent-ink-subtle text-accent-ink border border-accent-ink/15 mr-1.5">
            集団
          </span>
          <span className="text-[var(--paragraph)]">{komaSummary(row.group)}</span>
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-1 justify-end">
            <button
              onClick={onEdit}
              className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
              title="編集"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onDelete}
              className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
              title="削除"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </td>
      </tr>
      {isOpen && (
        <tr className="bg-surface/60">
          <td colSpan={5} className="px-3 py-2">
            <div className="text-[11px] text-text-body">
              <span className="font-semibold">通塾日程:</span>{' '}
              {schedLoading ? (
                <span className="text-text-muted">読み込み中…</span>
              ) : sched.length === 0 ? (
                <span className="text-text-muted">登録なし</span>
              ) : (
                <span className="inline-flex flex-wrap gap-1 align-middle">
                  {sched.map((s, i) => (
                    <span
                      key={i}
                      className="px-1.5 py-0.5 rounded bg-white border border-border-subtle text-[10px]"
                    >
                      {DOW_LABELS[s.day_of_week]}
                      {s.slot_number}限
                      <span className="text-text-muted ml-0.5">{s.start_time?.slice(0, 5)}</span>
                    </span>
                  ))}
                </span>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
