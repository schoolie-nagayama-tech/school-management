'use client';

import { useState, useEffect } from 'react';
import { Button, Input, Select } from '@/components/ui';
import type { Student, StudentInsert, StudentUpdate, Subject } from '@/types/database';
import { GRADE_LABELS, STATUS_LABELS } from '@/types/database';
import { getSubjects } from '@/lib/api/subjects';
import { getStudentSubjects } from '@/lib/api/subjects';
import { getDefaultSchoolId } from '@/lib/api/schools';

interface StudentFormProps {
  student?: Student | null;
  onSubmit: (data: StudentInsert | StudentUpdate, subjectIds?: string[]) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
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

// 学年からカテゴリを取得
function getGradeCategory(grade: number): 'elementary' | 'middle' | 'high' {
  if (grade <= 6) return 'elementary';
  if (grade <= 9) return 'middle';
  return 'high';
}

export function StudentForm({
  student,
  onSubmit,
  onCancel,
  isLoading = false,
}: StudentFormProps) {
  const isEdit = !!student;

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
    subject_other: student?.subject_other || '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [availableSubjects, setAvailableSubjects] = useState<Subject[]>([]);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);
  const [isLoadingSubjects, setIsLoadingSubjects] = useState(false);

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
        subject_other: student.subject_other || '',
      });
    }
  }, [student]);

  // 学年に応じて科目を取得
  useEffect(() => {
    const fetchSubjects = async () => {
      setIsLoadingSubjects(true);
      try {
        const category = getGradeCategory(formData.grade);
        const subjects = await getSubjects(category);
        setAvailableSubjects(subjects);
      } catch (error) {
        console.error('Error fetching subjects:', error);
      } finally {
        setIsLoadingSubjects(false);
      }
    };

    fetchSubjects();
  }, [formData.grade]);

  // 編集時に既存の科目を取得
  useEffect(() => {
    if (isEdit && student) {
      const fetchStudentSubjects = async () => {
        try {
          const studentSubjects = await getStudentSubjects(student.id);
          setSelectedSubjectIds(studentSubjects.map((ss) => ss.subject_id));
        } catch (error) {
          console.error('Error fetching student subjects:', error);
        }
      };
      fetchStudentSubjects();
    }
  }, [isEdit, student]);

  // 科目選択の変更
  const handleSubjectToggle = (subjectId: string) => {
    setSelectedSubjectIds((prev) => {
      if (prev.includes(subjectId)) {
        return prev.filter((id) => id !== subjectId);
      } else {
        return [...prev, subjectId];
      }
    });
  };

  // 「その他」が選択されているかチェック
  const hasOtherSubject = availableSubjects.some(
    (s) => s.name === 'その他' && selectedSubjectIds.includes(s.id)
  );

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
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

    // 新規登録時はschool_idを自動設定
    const submitData = isEdit
      ? (formData as StudentUpdate)
      : ({ ...formData, school_id: getDefaultSchoolId() } as StudentInsert);

    await onSubmit(submitData, selectedSubjectIds);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 生徒コード */}
      <Input
        label="生徒コード"
        name="student_code"
        value={formData.student_code}
        onChange={handleChange}
        error={errors.student_code}
        placeholder="例: S0001（空欄可）"
        disabled={isEdit}
        helpText={isEdit ? '生徒コードは変更できません' : '空欄の場合は自動で割り当てられません'}
      />

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

      {/* 受講科目 */}
      <div>
        <label className="block text-sm font-medium text-[#0d0d0d] mb-2">
          受講科目
        </label>
        {isLoadingSubjects ? (
          <p className="text-sm text-[#2a2a2a]">読み込み中...</p>
        ) : availableSubjects.length === 0 ? (
          <p className="text-sm text-[#2a2a2a]">
            この学年カテゴリには科目が登録されていません
          </p>
        ) : (
          <div className="space-y-2 border border-[#0d0d0d] rounded-lg p-3 max-h-48 overflow-y-auto bg-[#fffffe]">
            {availableSubjects.map((subject) => (
              <label
                key={subject.id}
                className="flex items-center gap-2 cursor-pointer hover:bg-[#eff0f3] p-2 rounded"
              >
                <input
                  type="checkbox"
                  checked={selectedSubjectIds.includes(subject.id)}
                  onChange={() => handleSubjectToggle(subject.id)}
                  className="w-4 h-4 text-[#ff8e3c] border-[#0d0d0d] rounded focus:ring-[#ff8e3c]"
                />
                <span className="text-sm text-[#0d0d0d]">{subject.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* 受講科目その他（「その他」が選択されている場合のみ表示） */}
      {hasOtherSubject && (
        <Input
          label="受講科目その他"
          name="subject_other"
          value={formData.subject_other}
          onChange={handleChange}
          error={errors.subject_other}
          placeholder="例: 物理"
        />
      )}

      {/* ボタン */}
      <div className="flex justify-end gap-3 pt-4 border-t border-[#0d0d0d]">
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
