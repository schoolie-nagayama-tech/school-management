'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { Button, Input, Label } from '@/components/ui';
import { ToastContainer } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useAuth } from '@/contexts/AuthContext';
import { addUserToSchool, removeUserFromSchool } from '@/lib/api/auth';
import { getSchools } from '@/lib/api/schools';
import { getSubjects } from '@/lib/api/subjects';
import type { School, UserProfile, Subject } from '@/types/database';

const DAY_LABELS: { value: number; label: string }[] = [
  { value: 0, label: '日' },
  { value: 1, label: '月' },
  { value: 2, label: '火' },
  { value: 3, label: '水' },
  { value: 4, label: '木' },
  { value: 5, label: '金' },
  { value: 6, label: '土' },
];

const GRADE_CATEGORY_LABELS: Record<string, string> = {
  elementary: '小学',
  middle: '中学',
  high: '高校',
};

function groupSubjectsByGradeCategory(subjects: Subject[]): { label: string; items: Subject[] }[] {
  const order: ('elementary' | 'middle' | 'high')[] = ['elementary', 'middle', 'high'];
  const map = new Map<string, Subject[]>();
  for (const s of subjects) {
    const cat = s.grade_category ?? 'middle';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(s);
  }
  return order
    .filter((cat) => map.has(cat))
    .map((cat) => ({ label: GRADE_CATEGORY_LABELS[cat] ?? cat, items: map.get(cat)! }));
}

/** API/DB が配列 or 文字列で返す場合に JS 配列に正規化 */
function normalizeToStrArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === 'string') {
    const trimmed = v.replace(/^\{|\}$/g, '').trim();
    if (!trimmed) return [];
    return trimmed.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
  }
  return [];
}

function normalizeToNumArray(v: unknown): number[] {
  if (Array.isArray(v)) return v.map((x) => Number(x)).filter((n) => !Number.isNaN(n));
  if (typeof v === 'string') {
    const trimmed = v.replace(/^\{|\}$/g, '').trim();
    if (!trimmed) return [];
    return trimmed.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
  }
  return [];
}

/** 曜日別コマを Record<string, number[]> に正規化（キー "0"〜"6"、値は 1〜7） */
function normalizeToSlotNumbersByDay(v: unknown): Record<string, number[]> {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    const out: Record<string, number[]> = {};
    for (const key of Object.keys(v as object)) {
      const arr = normalizeToNumArray((v as Record<string, unknown>)[key]).filter(
        (n) => n >= 1 && n <= 7
      );
      if (arr.length > 0) out[key] = arr;
    }
    return out;
  }
  return {};
}

interface TeacherWithDetails extends UserProfile {
  user_schools?: Array<{
    id: string;
    user_id: string;
    school_id: string;
    school?: { id: string; name: string; code: string | null };
  }>;
}

export default function TeacherEditPage() {
  const params = useParams();
  const router = useRouter();
  const teacherId = params?.teacherId as string | undefined;
  const { getSelectedSchoolIds } = useAuth();
  const { toasts, removeToast, success, error: toastError } = useToast();
  const isManager = useAuth().profile?.role === 'manager';

  const [teacher, setTeacher] = useState<TeacherWithDetails | null>(null);
  const [schools, setSchools] = useState<School[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const [editDisplayName, setEditDisplayName] = useState('');
  const [editSchoolIds, setEditSchoolIds] = useState<string[]>([]);
  const [editTeachableSubjectIds, setEditTeachableSubjectIds] = useState<string[]>([]);
  const [editAvailableDaysOfWeek, setEditAvailableDaysOfWeek] = useState<number[]>([]);
  const [editAvailableSlotNumbersByDay, setEditAvailableSlotNumbersByDay] = useState<
    Record<string, number[]>
  >({});

  useEffect(() => {
    if (!teacherId) return;
    const load = async () => {
      setIsLoading(true);
      setNotFound(false);
      try {
        // 講師1件だけ取得（teachable_subject_ids, available_days_of_week を含む最新の状態）
        const [teacherRes, schoolsData, subjectsData] = await Promise.all([
          fetch(`/api/admin/users/${teacherId}`, { cache: 'no-store' }),
          getSchools(),
          getSubjects(),
        ]);
        if (!teacherRes.ok) {
          if (teacherRes.status === 404) {
            setNotFound(true);
            setTeacher(null);
            return;
          }
          throw new Error('講師の取得に失敗しました');
        }
        const found: TeacherWithDetails = await teacherRes.json();
        setTeacher(found);
        setSchools(schoolsData);
        setSubjects(subjectsData);

        setEditDisplayName(found.display_name || '');
        const teacherSchoolIds = found.user_schools?.map((us) => us.school_id) || [];
        if (isManager) {
          const userSchoolIds = getSelectedSchoolIds();
          setEditSchoolIds(teacherSchoolIds.filter((id) => userSchoolIds.includes(id)));
        } else {
          setEditSchoolIds(teacherSchoolIds);
        }
        // 保存済みの値を表示（API は配列で返すが、文字列等で返る場合にも正規化）
        const subjectIds = normalizeToStrArray(found.teachable_subject_ids);
        const days = normalizeToNumArray(found.available_days_of_week);
        setEditTeachableSubjectIds(subjectIds);
        setEditAvailableDaysOfWeek(days.length > 0 ? days : [0, 1, 2, 3, 4, 5, 6]);
        setEditAvailableSlotNumbersByDay(
          normalizeToSlotNumbersByDay(found.available_slot_numbers_by_day)
        );
      } catch (e) {
        toastError((e as Error).message);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [teacherId, isManager, getSelectedSchoolIds, toastError]);

  const handleSave = async () => {
    if (!teacher) return;
    setIsSaving(true);
    try {
      // プロファイル（表示名・指導可能科目・出勤可能曜日）は API 経由で RPC 更新
      const profileRes = await fetch(`/api/admin/users/${teacher.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          display_name: editDisplayName,
          teachable_subject_ids: editTeachableSubjectIds,
          available_days_of_week: editAvailableDaysOfWeek,
          available_slot_numbers_by_day: editAvailableSlotNumbersByDay,
        }),
      });
      const errBody = await profileRes.json().catch(() => ({}));
      if (!profileRes.ok) {
        throw new Error((errBody as { error?: string }).error || 'プロファイルの更新に失敗しました');
      }

      const currentSchoolIds = teacher.user_schools?.map((us) => us.school_id) || [];
      const toAdd = editSchoolIds.filter((id) => !currentSchoolIds.includes(id));
      const toRemove = currentSchoolIds.filter((id) => !editSchoolIds.includes(id));

      for (const schoolId of toAdd) {
        await addUserToSchool(teacher.id, schoolId);
      }
      for (const schoolId of toRemove) {
        await removeUserFromSchool(teacher.id, schoolId);
      }

      success('講師を更新しました');
      router.push('/admin/teachers');
    } catch (err) {
      console.error('Error updating teacher:', err);
      toastError('講師の更新に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  const availableSchools = isManager
    ? schools.filter((s) => getSelectedSchoolIds().includes(s.id))
    : schools;

  if (!teacherId) {
    return (
      <AdminLayout headerTitle="講師編集">
        <div className="p-6">
          <p className="text-[#2a2a2a]">講師IDが指定されていません。</p>
          <Link href="/admin/teachers">
            <Button variant="secondary" className="mt-4">
              講師一覧に戻る
            </Button>
          </Link>
        </div>
      </AdminLayout>
    );
  }

  if (isLoading) {
    return (
      <AdminLayout headerTitle="講師編集">
        <div className="p-6 text-center text-[#2a2a2a]">読み込み中...</div>
      </AdminLayout>
    );
  }

  if (notFound || !teacher) {
    return (
      <AdminLayout headerTitle="講師編集">
        <div className="p-6">
          <p className="text-[#2a2a2a]">講師が見つかりません。</p>
          <Link href="/admin/teachers">
            <Button variant="secondary" className="mt-4">
              講師一覧に戻る
            </Button>
          </Link>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="講師編集">
      <div className="p-6 max-w-2xl mx-auto">
        <div className="mb-6 flex items-center gap-4">
          <Link href="/admin/teachers" className="text-sm text-[#2a2a2a] hover:text-[#ff8e3c]">
            ← 講師一覧に戻る
          </Link>
          <h1 className="text-2xl font-bold text-[#0d0d0d]">講師編集</h1>
        </div>

        <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-6 space-y-6">
          <div>
            <Label className="block text-sm font-medium text-[#0d0d0d] mb-1">メールアドレス</Label>
            <Input
              value={teacher.email}
              disabled
              className="w-full bg-[#eff0f3] text-[#2a2a2a]"
            />
          </div>

          <div>
            <Label className="block text-sm font-medium text-[#0d0d0d] mb-1">表示名</Label>
            <Input
              value={editDisplayName}
              onChange={(e) => setEditDisplayName(e.target.value)}
              placeholder="山田 太郎"
              className="w-full"
            />
          </div>

          <div>
            <Label className="block text-sm font-medium text-[#0d0d0d] mb-1">担当教室</Label>
            <div className="space-y-2 max-h-48 overflow-y-auto border border-[#0d0d0d]/20 rounded-lg p-3">
              {availableSchools.map((school) => (
                <label key={school.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={editSchoolIds.includes(school.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setEditSchoolIds([...editSchoolIds, school.id]);
                      } else {
                        setEditSchoolIds(editSchoolIds.filter((id) => id !== school.id));
                      }
                    }}
                    className="rounded border-[#0d0d0d]"
                  />
                  <span className="text-sm text-[#0d0d0d]">{school.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label className="block text-sm font-medium text-[#0d0d0d] mb-1">指導可能科目</Label>
            <p className="text-xs text-[#2a2a2a]/70 mb-2">
              空の場合は全科目を指導可能として扱います。
            </p>
            <div className="space-y-3 max-h-48 overflow-y-auto border border-[#0d0d0d]/20 rounded-lg p-3">
              {subjects.length === 0 ? (
                <p className="text-sm text-[#2a2a2a]/60">科目が登録されていません</p>
              ) : (
              groupSubjectsByGradeCategory(subjects).map(({ label, items }) => (
                <div key={label}>
                  <p className="text-xs font-medium text-[#2a2a2a] mb-1.5">{label}</p>
                  <div className="space-y-2 pl-1">
                    {items.map((subject) => (
                      <label key={subject.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={editTeachableSubjectIds.includes(subject.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setEditTeachableSubjectIds([...editTeachableSubjectIds, subject.id]);
                            } else {
                              setEditTeachableSubjectIds(
                                editTeachableSubjectIds.filter((id) => id !== subject.id)
                              );
                            }
                          }}
                          className="rounded border-[#0d0d0d]"
                        />
                        <span className="text-sm text-[#0d0d0d]">{subject.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))
              )}
            </div>
          </div>

          <div>
            <Label className="block text-sm font-medium text-[#0d0d0d] mb-1">出勤可能曜日</Label>
            <p className="text-xs text-[#2a2a2a]/70 mb-2">
              選択した曜日のみ座席表に表示されます。未選択の場合は全曜日表示です。
            </p>
            <div className="flex flex-wrap gap-3">
              {DAY_LABELS.map((d) => (
                <label key={d.value} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={editAvailableDaysOfWeek.includes(d.value)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setEditAvailableDaysOfWeek([...editAvailableDaysOfWeek, d.value]);
                      } else {
                        setEditAvailableDaysOfWeek(
                          editAvailableDaysOfWeek.filter((x) => x !== d.value)
                        );
                      }
                    }}
                    className="rounded border-[#0d0d0d]"
                  />
                  <span className="text-sm text-[#0d0d0d]">{d.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label className="block text-sm font-medium text-[#0d0d0d] mb-1">
              曜日ごとの出勤可能コマ
            </Label>
            <p className="text-xs text-[#2a2a2a]/70 mb-2">
              各曜日で出勤可能なコマ（1限〜7限）を選択してください。未設定の曜日は全コマ出勤可です。
            </p>
            <div className="space-y-3 max-h-64 overflow-y-auto border border-[#0d0d0d]/20 rounded-lg p-3">
              {DAY_LABELS.map((d) => {
                const dayKey = String(d.value);
                const slotNums = editAvailableSlotNumbersByDay[dayKey] ?? [];
                const toggleSlot = (n: number) => {
                  setEditAvailableSlotNumbersByDay((prev) => {
                    const arr = prev[dayKey] ?? [];
                    const next = arr.includes(n) ? arr.filter((x) => x !== n) : [...arr, n].sort((a, b) => a - b);
                    const nextMap = { ...prev };
                    if (next.length === 0) delete nextMap[dayKey];
                    else nextMap[dayKey] = next;
                    return nextMap;
                  });
                };
                return (
                  <div key={d.value} className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-[#0d0d0d] w-6">{d.label}</span>
                    {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                      <label key={n} className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={slotNums.includes(n)}
                          onChange={() => toggleSlot(n)}
                          className="rounded border-[#0d0d0d]"
                        />
                        <span className="text-xs text-[#0d0d0d]">{n}限</span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <Link href="/admin/teachers">
              <Button variant="secondary">キャンセル</Button>
            </Link>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? '保存中...' : '保存'}
            </Button>
          </div>
        </div>
      </div>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}
