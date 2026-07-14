'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button, Input, Select, Loading } from '@/components/ui';
import type { Student, StudentInsert, StudentUpdate } from '@/types/database';
import { X, UserX, UserCheck } from 'lucide-react';
import { GRADE_LABELS, STATUS_LABELS, ORDER_STATUS_LABELS } from '@/types/database';
import { getStudentTextbooks, deleteOrder } from '@/lib/api/ordering';
import type { StudentTextbook } from '@/lib/api/ordering';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { fetchWithAuth } from '@/lib/api/auth';

/** 講師希望セクションで使う講師（/api/admin/users?role=teacher の返り値の必要フィールド）。 */
interface PrefTeacher {
  id: string;
  display_name: string | null;
  last_name?: string | null;
  first_name?: string | null;
  email: string | null;
  // どの教室に所属するかで絞り込むため user_schools を参照する
  user_schools?: Array<{ school_id?: string | null }> | null;
}

/** 講師の表示名（display_name 優先 → 姓名 → メール）。 */
function teacherLabel(t: PrefTeacher): string {
  if (t.display_name && t.display_name.trim()) return t.display_name.trim();
  const name = `${t.last_name ?? ''} ${t.first_name ?? ''}`.trim();
  if (name) return name;
  return t.email ?? '(名称未設定)';
}

/** 希望性別オプション（空文字＝指定なし＝DBでは null）。 */
const genderOptions = [
  { value: '', label: '指定なし' },
  { value: 'male', label: '男性' },
  { value: 'female', label: '女性' },
];

interface StudentFormProps {
  student?: Student | null;
  onSubmit: (data: StudentInsert | StudentUpdate) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
  schools?: { id: string; name: string }[];
  defaultSchoolId?: string;
}

// 学年オプション
const gradeOptions = Object.entries(GRADE_LABELS).map(([value, label]) => ({
  value: parseInt(value, 10),
  label,
}));

// 在籍状況オプション
const statusOptions = Object.entries(STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export function StudentForm({
  student,
  onSubmit,
  onCancel,
  isLoading = false,
  schools = [],
  defaultSchoolId = '',
}: StudentFormProps) {
  const isEdit = !!student;
  const [selectedSchoolId] = useState(defaultSchoolId || schools[0]?.id || '');

  const [formData, setFormData] = useState({
    student_code: student?.student_code || '',
    last_name: student?.last_name || '',
    first_name: student?.first_name || '',
    last_name_kana: student?.last_name_kana || '',
    first_name_kana: student?.first_name_kana || '',
    grade: student?.grade || 7,
    status: student?.status || 'active',
    school_name: student?.school_name || '',
    class_name: student?.class_name || '',
    club: student?.club || '',
    is_programming: student?.is_programming ?? false,
    is_sibling: student?.is_sibling ?? false,
    withdrawal_date: student?.withdrawal_date || '',
    // 講師希望3列。gender は select 用に空文字を許容し、送信時に null へ正規化する。
    preferred_teacher_gender: (student?.preferred_teacher_gender ?? '') as '' | 'male' | 'female',
    fixed_teacher_ids: (student?.fixed_teacher_ids ?? []) as string[],
    excluded_teacher_ids: (student?.excluded_teacher_ids ?? []) as string[],
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // 講師希望セクション用の講師リスト（生徒の所属校で絞り込む）
  const [teachers, setTeachers] = useState<PrefTeacher[]>([]);
  const [teachersLoading, setTeachersLoading] = useState(false);

  // 講師リスト取得の基準となる教室ID。編集時は生徒の所属校、新規時は登録先教室。
  const teacherSchoolId = student?.school_id || selectedSchoolId;

  // 所持教材
  const [textbooks, setTextbooks] = useState<StudentTextbook[]>([]);
  const [textbooksLoading, setTextbooksLoading] = useState(false);
  const [textbookError, setTextbookError] = useState<string | null>(null);

  // studentプロップが変更された時にフォームデータを更新
  useEffect(() => {
    if (student) {
      setFormData({
        student_code: student.student_code || '',
        last_name: student.last_name || '',
        first_name: student.first_name || '',
        last_name_kana: student.last_name_kana || '',
        first_name_kana: student.first_name_kana || '',
        grade: student.grade || 7,
        status: student.status || 'active',
        school_name: student.school_name || '',
        class_name: student.class_name || '',
        club: student.club || '',
        is_programming: student.is_programming ?? false,
        is_sibling: student.is_sibling ?? false,
        withdrawal_date: student.withdrawal_date || '',
        preferred_teacher_gender: (student.preferred_teacher_gender ?? '') as
          | ''
          | 'male'
          | 'female',
        fixed_teacher_ids: student.fixed_teacher_ids ?? [],
        excluded_teacher_ids: student.excluded_teacher_ids ?? [],
      });
    }
  }, [student]);

  // 教室の講師を取得（座席表と同じ admin users API）。その教室に user_schools で
  // 紐づく role=teacher のみに絞り込む。NG/固定の選択肢に使う。
  useEffect(() => {
    if (!teacherSchoolId) {
      setTeachers([]);
      return;
    }
    let cancelled = false;
    setTeachersLoading(true);
    fetchWithAuth('/api/admin/users?role=teacher')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const all = (d.users || []) as PrefTeacher[];
        const scoped = all.filter((t) =>
          (t.user_schools || []).some((us) => us?.school_id === teacherSchoolId)
        );
        // 表示名で並べ替え（日本語ロケール）
        scoped.sort((a, b) => teacherLabel(a).localeCompare(teacherLabel(b), 'ja'));
        setTeachers(scoped);
      })
      .catch(() => {
        if (!cancelled) setTeachers([]);
      })
      .finally(() => {
        if (!cancelled) setTeachersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [teacherSchoolId]);

  // NG講師トグル。固定に入っている講師は同時にNGにできない（相反するため固定から外す）。
  const toggleExcludedTeacher = (teacherId: string) => {
    setFormData((prev) => {
      const isOn = prev.excluded_teacher_ids.includes(teacherId);
      return {
        ...prev,
        excluded_teacher_ids: isOn
          ? prev.excluded_teacher_ids.filter((id) => id !== teacherId)
          : [...prev.excluded_teacher_ids, teacherId],
        // NGに追加するときは固定から自動除外（両方指定を防ぐ）
        fixed_teacher_ids: isOn
          ? prev.fixed_teacher_ids
          : prev.fixed_teacher_ids.filter((id) => id !== teacherId),
      };
    });
  };

  // 固定講師トグル。NGに入っている講師は同時に固定にできない（NGから外す）。
  const toggleFixedTeacher = (teacherId: string) => {
    setFormData((prev) => {
      const isOn = prev.fixed_teacher_ids.includes(teacherId);
      return {
        ...prev,
        fixed_teacher_ids: isOn
          ? prev.fixed_teacher_ids.filter((id) => id !== teacherId)
          : [...prev.fixed_teacher_ids, teacherId],
        excluded_teacher_ids: isOn
          ? prev.excluded_teacher_ids
          : prev.excluded_teacher_ids.filter((id) => id !== teacherId),
      };
    });
  };

  // 所持教材を取得（編集時のみ）
  const fetchTextbooks = useCallback(async () => {
    if (!student?.id) return;
    setTextbooksLoading(true);
    setTextbookError(null);
    try {
      const data = await getStudentTextbooks(student.id);
      setTextbooks(data);
    } catch (err) {
      setTextbookError(getUserErrorMessage(err, '教材の取得に失敗しました'));
    } finally {
      setTextbooksLoading(false);
    }
  }, [student?.id]);

  useEffect(() => {
    if (isEdit && student?.id) {
      fetchTextbooks();
    }
  }, [isEdit, student?.id, fetchTextbooks]);

  const handleDeleteTextbook = async (orderId: string, textbookName: string) => {
    if (!confirm(`「${textbookName}」を削除しますか？`)) return;
    try {
      await deleteOrder(orderId);
      setTextbooks((prev) => prev.filter((t) => t.orderId !== orderId));
    } catch (err) {
      setTextbookError(getUserErrorMessage(err, '削除に失敗しました'));
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'grade' ? parseInt(value, 10) : value,
    }));
    // エラーをクリア
    if (errors[name]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.last_name.trim()) {
      newErrors.last_name = '姓は必須です';
    }
    if (!formData.first_name.trim()) {
      newErrors.first_name = '名は必須です';
    }
    if (!formData.last_name_kana.trim()) {
      newErrors.last_name_kana = 'セイは必須です';
    }
    if (!formData.first_name_kana.trim()) {
      newErrors.first_name_kana = 'メイは必須です';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) return;

    // 安全網: NGと固定に同じ講師が入っていないこと（UI側でトグル時に相互排他にしているが念のため）。
    const dupTeacherIds = formData.fixed_teacher_ids.filter((id) =>
      formData.excluded_teacher_ids.includes(id)
    );
    if (dupTeacherIds.length > 0) {
      setErrors((prev) => ({
        ...prev,
        teacherPref: '同じ講師をNGと固定の両方に指定することはできません',
      }));
      return;
    }

    // withdrawal_date は空欄を null として送る（DB の DATE 型は空文字を許容しない）。
    // preferred_teacher_gender も空文字（指定なし）は null で保存する。
    const normalized = {
      ...formData,
      withdrawal_date: formData.withdrawal_date || null,
      preferred_teacher_gender: formData.preferred_teacher_gender || null,
    };
    const submitData = isEdit
      ? (normalized as StudentUpdate)
      : ({ ...normalized, school_id: selectedSchoolId } as StudentInsert);

    await onSubmit(submitData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 氏名 */}
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="姓"
          name="last_name"
          value={formData.last_name}
          onChange={handleChange}
          error={errors.last_name}
          placeholder="山田"
          required
        />
        <Input
          label="名"
          name="first_name"
          value={formData.first_name}
          onChange={handleChange}
          error={errors.first_name}
          placeholder="太郎"
          required
        />
      </div>

      {/* フリガナ */}
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="セイ"
          name="last_name_kana"
          value={formData.last_name_kana}
          onChange={handleChange}
          error={errors.last_name_kana}
          placeholder="ヤマダ"
          required
        />
        <Input
          label="メイ"
          name="first_name_kana"
          value={formData.first_name_kana}
          onChange={handleChange}
          error={errors.first_name_kana}
          placeholder="タロウ"
          required
        />
      </div>

      {/* 登録教室（新規のみ・現在選択中の教室に登録） */}
      {!isEdit && schools.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-1">登録する教室</label>
          <p className="text-sm text-[#4b5563] px-3 py-2 border border-[#e5e7eb] rounded-lg bg-[#f9fafb]">
            {schools.find((s) => s.id === selectedSchoolId)?.name ?? schools[0]?.name}
          </p>
        </div>
      )}

      {/* 学年 */}
      <Select
        label="学年"
        name="grade"
        value={formData.grade}
        onChange={handleChange}
        options={gradeOptions}
        required
      />

      {/* 在籍状況（編集時のみ表示） */}
      {isEdit && (
        <Select
          label="在籍状況"
          name="status"
          value={formData.status}
          onChange={handleChange}
          options={statusOptions}
          required
        />
      )}

      {/* 退塾予定日（編集時のみ表示）— 入力すればこの日以降は座席表生成・5週目計算から除外 */}
      {isEdit && (
        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-1">退塾予定日</label>
          <input
            type="date"
            name="withdrawal_date"
            value={formData.withdrawal_date}
            onChange={handleChange}
            className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white"
          />
          <p className="text-xs text-[#6b7280] mt-1">
            この日以降は座席表・5週目請求から自動的に除外されます。さらに退塾日の翌日に在籍状況が自動で「退会」へ切り替わります。空欄なら在籍中扱い。
          </p>
        </div>
      )}

      {/* 学校名 */}
      <Input
        label="学校名"
        name="school_name"
        value={formData.school_name}
        onChange={handleChange}
        error={errors.school_name}
        placeholder="例: 第一中学校"
      />

      {/* クラス */}
      <Input
        label="クラス"
        name="class_name"
        value={formData.class_name}
        onChange={handleChange}
        error={errors.class_name}
        placeholder="例: 3-A"
      />

      {/* 部活 */}
      <Input
        label="部活"
        name="club"
        value={formData.club}
        onChange={handleChange}
        error={errors.club}
        placeholder="例: サッカー部"
      />

      {/* チェックボックス */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.is_programming}
            onChange={(e) => setFormData((prev) => ({ ...prev, is_programming: e.target.checked }))}
            className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6]"
          />
          <span className="text-sm font-medium text-[#1f2937]">プログラミングコース受講</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.is_sibling}
            onChange={(e) => setFormData((prev) => ({ ...prev, is_sibling: e.target.checked }))}
            className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6]"
          />
          <span className="text-sm font-medium text-[#1f2937]">兄弟・姉妹あり</span>
        </label>
      </div>

      {/* 担当講師の希望（NG講師・固定講師・希望性別） */}
      {/* ここで設定した値は座席表のD&D可否判定・マッチング候補・入会ウィザードのミニ座席表が読む。 */}
      <div className="space-y-4 border-t border-[#e5e7eb] pt-4">
        <div>
          <h3 className="text-sm font-semibold text-[#1f2937]">担当講師の希望</h3>
          <p className="text-xs text-[#6b7280] mt-0.5">
            NG講師・固定講師・希望性別を設定すると、座席表への配置やマッチングで反映されます。
          </p>
        </div>

        {/* 希望性別 */}
        <Select
          label="希望する講師の性別"
          name="preferred_teacher_gender"
          value={formData.preferred_teacher_gender}
          onChange={handleChange}
          options={genderOptions}
        />

        {errors.teacherPref && <p className="text-sm text-red-600">{errors.teacherPref}</p>}

        {teachersLoading ? (
          <Loading size="md" />
        ) : !teacherSchoolId ? (
          <p className="text-sm text-[#4b5563]/60">教室が未確定のため講師を表示できません</p>
        ) : teachers.length === 0 ? (
          <p className="text-sm text-[#4b5563]/60">この教室に登録された講師がいません</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* 担当NG講師 */}
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <UserX className="w-4 h-4 text-[#dc2626]" />
                <span className="text-sm font-medium text-[#1f2937]">担当NG講師</span>
              </div>
              <div className="space-y-1 border border-[#e5e7eb] rounded-lg p-2 bg-white max-h-48 overflow-y-auto">
                {teachers.map((t) => (
                  <label
                    key={t.id}
                    className="flex items-center gap-2 px-1.5 py-1 rounded cursor-pointer hover:bg-[#f3f4f6]"
                  >
                    <input
                      type="checkbox"
                      checked={formData.excluded_teacher_ids.includes(t.id)}
                      onChange={() => toggleExcludedTeacher(t.id)}
                      className="w-4 h-4 text-[#dc2626] border-[#e5e7eb] rounded focus:ring-[#dc2626]"
                    />
                    <span className="text-sm text-[#1f2937] truncate">{teacherLabel(t)}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* 固定講師 */}
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <UserCheck className="w-4 h-4 text-[#16a34a]" />
                <span className="text-sm font-medium text-[#1f2937]">固定講師</span>
              </div>
              <div className="space-y-1 border border-[#e5e7eb] rounded-lg p-2 bg-white max-h-48 overflow-y-auto">
                {teachers.map((t) => (
                  <label
                    key={t.id}
                    className="flex items-center gap-2 px-1.5 py-1 rounded cursor-pointer hover:bg-[#f3f4f6]"
                  >
                    <input
                      type="checkbox"
                      checked={formData.fixed_teacher_ids.includes(t.id)}
                      onChange={() => toggleFixedTeacher(t.id)}
                      className="w-4 h-4 text-[#16a34a] border-[#e5e7eb] rounded focus:ring-[#16a34a]"
                    />
                    <span className="text-sm text-[#1f2937] truncate">{teacherLabel(t)}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 所持教材 */}
      {isEdit && student?.id && (
        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-2">所持教材</label>
          {textbooksLoading ? (
            <Loading size="md" />
          ) : textbookError ? (
            <p className="text-sm text-red-600">{textbookError}</p>
          ) : textbooks.length > 0 ? (
            <div className="space-y-1 border border-[#e5e7eb] rounded-lg p-2 bg-white">
              {textbooks.map((tb) => (
                <div
                  key={tb.orderId}
                  className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-[#f3f4f6] group"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-sm text-[#1f2937] truncate">{tb.textbookName}</span>
                    {tb.quantity > 1 && (
                      <span className="text-xs text-[#4b5563] bg-gray-100 px-1.5 py-0.5 rounded">
                        x{tb.quantity}
                      </span>
                    )}
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                        tb.status === 'distributed'
                          ? 'bg-green-100 text-green-700'
                          : tb.status === 'delivered'
                            ? 'bg-blue-100 text-blue-700'
                            : tb.status === 'ordered'
                              ? 'bg-indigo-100 text-indigo-700'
                              : 'bg-yellow-100 text-yellow-700'
                      }`}
                    >
                      {ORDER_STATUS_LABELS[tb.status]}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteTextbook(tb.orderId, tb.textbookName)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-opacity duration-150"
                    title="削除"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#4b5563]/60">発注された教材はありません</p>
          )}
          <p className="text-xs text-[#9ca3af] mt-1">
            教材の追加は「教材・発注管理」ページから行えます
          </p>
        </div>
      )}

      {/* ボタン */}
      <div className="flex justify-end gap-3 pt-4 border-t border-[#e5e7eb]">
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" isLoading={isLoading}>
          {isEdit ? '更新する' : '登録する'}
        </Button>
      </div>
    </form>
  );
}
