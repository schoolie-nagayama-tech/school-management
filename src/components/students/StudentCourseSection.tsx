'use client';

/**
 * 生徒詳細「受講コース」— 科目ごとのコース（PS1 / PS2 / キッズ）を見る場所と、変える入口。
 *
 * ★この画面は入力ステップではない。
 *   通常はここを開かなくても、通塾日程の初回登録でコースは埋まる。
 *   開くのは「見たいとき」と「変えたいとき」だけ。
 *   （コースのために別途入力させると、同じ事実を2回入れることになり運用が続かない）
 *
 * 一覧に出す科目は「コースがある科目」＋「通塾日程に入っているのにコースが無い科目」。
 * 後者を未設定として見せないと、どこを埋めればいいかが分からない。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { History, Pencil, Plus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Loading } from '@/components/ui';
import { getRegularPatterns } from '@/lib/api/schedule';
import { getSubjects } from '@/lib/api/subjects';
import {
  getStudentCourseChanges,
  getStudentCourseRows,
  type CourseChangeRow,
  type StudentCourseRow,
} from '@/lib/api/student-subject-contracts';
import { isManagerOrAbove } from '@/lib/utils/roles';
import {
  courseDetail,
  courseFullLabel,
  courseLabel,
  COURSE_REASON_LABELS,
  type StudentCourse,
} from '@/lib/utils/studentCourse';
import { INDIVIDUAL_FORMATION } from '@/types/schedule';
import { CourseChangeDialog } from './CourseChangeDialog';

interface StudentCourseSectionProps {
  studentId: string;
  studentName: string;
  schoolId: string;
  grade?: number | null;
}

/** 学年(1-12)から科目のgrade_categoryへ */
function gradeToCategory(grade: number): 'elementary' | 'middle' | 'high' {
  if (grade <= 6) return 'elementary';
  if (grade <= 9) return 'middle';
  return 'high';
}

interface Row {
  subjectId: string;
  subjectName: string;
  course: StudentCourse | null;
  updatedAt: string | null;
  updatedByName: string | null;
}

export function StudentCourseSection({
  studentId,
  studentName,
  schoolId,
  grade,
}: StudentCourseSectionProps) {
  const { profile } = useAuth();
  const canManage = isManagerOrAbove(profile?.role);

  const [rows, setRows] = useState<Row[] | null>(null);
  const [changes, setChanges] = useState<CourseChangeRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!schoolId) return;
    setError(null);
    const gradeCategory = typeof grade === 'number' ? gradeToCategory(grade) : undefined;
    const [coursesRes, patternsRes, subjectsRes, changesRes] = await Promise.allSettled([
      getStudentCourseRows(studentId),
      getRegularPatterns(schoolId, { studentId }),
      getSubjects(gradeCategory),
      getStudentCourseChanges(studentId),
    ]);

    if (coursesRes.status !== 'fulfilled') {
      setError('コースの読み込みに失敗しました');
      setRows([]);
      return;
    }
    const courseRows = coursesRes.value as StudentCourseRow[];

    // 通塾日程（個別）に入っている科目。コースが無いものを「未設定」として並べる。
    const subjectNames = new Map<string, string>();
    if (subjectsRes.status === 'fulfilled') {
      for (const s of subjectsRes.value) subjectNames.set(s.id, s.name);
    }
    const scheduledSubjectIds = new Set<string>();
    if (patternsRes.status === 'fulfilled') {
      for (const p of patternsRes.value) {
        if ((p.formation ?? INDIVIDUAL_FORMATION) !== INDIVIDUAL_FORMATION) continue;
        for (const id of p.subject_ids ?? []) scheduledSubjectIds.add(id);
      }
    }

    const merged: Row[] = courseRows.map((c) => ({
      subjectId: c.subjectId,
      subjectName: c.subjectName,
      course: { subjectId: c.subjectId, ratio: c.ratio, durationMinutes: c.durationMinutes },
      updatedAt: c.updatedAt ?? null,
      updatedByName: c.updatedByName,
    }));
    const have = new Set(merged.map((m) => m.subjectId));
    for (const id of Array.from(scheduledSubjectIds)) {
      if (have.has(id)) continue;
      merged.push({
        subjectId: id,
        subjectName: subjectNames.get(id) ?? '（科目名不明）',
        course: null,
        updatedAt: null,
        updatedByName: null,
      });
    }

    setRows(merged);
    setChanges(changesRes.status === 'fulfilled' ? changesRes.value : []);
  }, [studentId, schoolId, grade]);

  useEffect(() => {
    load();
  }, [load]);

  const unsetCount = useMemo(() => (rows ?? []).filter((r) => !r.course).length, [rows]);

  if (rows === null) return <Loading size="sm" />;

  return (
    <div className="border border-[var(--stroke)] rounded-lg bg-white p-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[#1f2937]">受講コース</h3>
          {unsetCount > 0 && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
              未設定 {unsetCount}
            </span>
          )}
        </div>
        <span className="text-[11px] text-[var(--paragraph-light)]">
          {canManage ? '変更すると理由と履歴が残ります' : '変更できるのは教室長以上です'}
        </span>
      </div>

      {error && <p className="text-xs text-red-700 mb-2">{error}</p>}

      {rows.length === 0 ? (
        <p className="text-xs text-[var(--paragraph-light)]">
          まだ通塾日程が登録されていません。コースは通塾日程を登録するときに設定します。
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-[var(--paragraph-light)]">
              <th className="text-left font-medium py-1">科目</th>
              <th className="text-left font-medium py-1">コース</th>
              <th className="text-left font-medium py-1">内容</th>
              <th className="text-left font-medium py-1">最終変更</th>
              <th className="w-16"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.subjectId} className="border-t border-[#f3f4f6]">
                <td className="py-1.5 font-medium text-[var(--headline)]">{r.subjectName}</td>
                <td className="py-1.5">
                  {r.course ? (
                    <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--ink-subtle,#eef2f7)] text-[#1e3a5f]">
                      {courseLabel(r.course.ratio, r.course.durationMinutes)}
                    </span>
                  ) : (
                    <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                      未設定
                    </span>
                  )}
                </td>
                <td className="py-1.5 text-xs text-[var(--paragraph-light)]">
                  {r.course ? courseDetail(r.course.ratio, r.course.durationMinutes) : '—'}
                </td>
                <td className="py-1.5 text-xs text-[var(--paragraph-light)]">
                  {r.updatedAt
                    ? `${r.updatedAt.slice(0, 10)}${r.updatedByName ? ` ${r.updatedByName}` : ''}`
                    : '—'}
                </td>
                <td className="py-1.5 text-right">
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => setEditing(r)}
                      className="inline-flex items-center gap-1 text-xs text-[var(--primary,#2563eb)] hover:underline"
                    >
                      {r.course ? (
                        <>
                          <Pencil className="w-3 h-3" />
                          変更
                        </>
                      ) : (
                        <>
                          <Plus className="w-3 h-3" />
                          設定
                        </>
                      )}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {changes.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-[var(--paragraph-light)] hover:text-[var(--paragraph)]"
          >
            <History className="w-3 h-3" />
            変更履歴（{changes.length}件）
          </button>
          {showHistory && (
            <table className="w-full text-xs mt-2">
              <thead>
                <tr className="text-[10px] text-[var(--paragraph-light)]">
                  <th className="text-left font-medium py-1">日時</th>
                  <th className="text-left font-medium py-1">科目</th>
                  <th className="text-left font-medium py-1">変更</th>
                  <th className="text-left font-medium py-1">理由</th>
                  <th className="text-left font-medium py-1">実施者</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => (
                  <tr
                    key={c.id}
                    className="border-t border-[#f3f4f6] text-[var(--paragraph-light)]"
                  >
                    <td className="py-1">{c.changedAt.slice(0, 16).replace('T', ' ')}</td>
                    <td className="py-1">{c.subjectName}</td>
                    <td className="py-1 text-[var(--paragraph)]">
                      {c.fromRatio === null
                        ? '（未設定）'
                        : courseFullLabel(c.fromRatio, c.fromDuration)}{' '}
                      → {courseFullLabel(c.toRatio, c.toDuration)}
                    </td>
                    <td className="py-1">
                      {COURSE_REASON_LABELS[c.reasonCode] ?? c.reasonCode}
                      {c.reasonNote ? `（${c.reasonNote}）` : ''}
                    </td>
                    <td className="py-1">{c.changedByName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {editing && (
        <CourseChangeDialog
          open
          onClose={() => setEditing(null)}
          onSaved={load}
          schoolId={schoolId}
          studentId={studentId}
          studentName={studentName}
          subjectId={editing.subjectId}
          subjectName={editing.subjectName}
          current={editing.course}
          grade={grade}
          actorId={profile?.id}
          actorRole={profile?.role}
        />
      )}
    </div>
  );
}
