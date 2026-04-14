'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Button, Input, Select } from '@/components/ui';
import type { Student, StudentInsert, StudentUpdate, Subject } from '@/types/database';
import { Calendar, X } from 'lucide-react';
import { GRADE_LABELS, STATUS_LABELS, ORDER_STATUS_LABELS } from '@/types/database';
import { getSubjects } from '@/lib/api/subjects';
import { getStudentSubjects } from '@/lib/api/subjects';
import { getDefaultSchoolId } from '@/lib/api/schools';
import { getStudentTextbooks, deleteOrder } from '@/lib/api/ordering';
import type { StudentTextbook } from '@/lib/api/ordering';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

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
    is_programming: student?.is_programming ?? false,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [availableSubjects, setAvailableSubjects] = useState<Subject[]>([]);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);
  const [isLoadingSubjects, setIsLoadingSubjects] = useState(false);

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
        subject_other: student.subject_other || '',
        is_programming: student.is_programming ?? false,
      });
    }
  }, [student]);

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
        <label className="block text-sm font-medium text-[#1f2937] mb-2">
          受講科目
        </label>
        {isLoadingSubjects ? (
          <p className="text-sm text-[#4b5563]">読み込み中...</p>
        ) : availableSubjects.length === 0 ? (
          <p className="text-sm text-[#4b5563]">
            この学年カテゴリには科目が登録されていません
          </p>
        ) : (
          <div className="space-y-2 border border-[#e5e7eb] rounded-lg p-3 max-h-48 overflow-y-auto bg-white">
            {availableSubjects.map((subject) => (
              <label
                key={subject.id}
                className="flex items-center gap-2 cursor-pointer hover:bg-[#f3f4f6] p-2 rounded"
              >
                <input
                  type="checkbox"
                  checked={selectedSubjectIds.includes(subject.id)}
                  onChange={() => handleSubjectToggle(subject.id)}
                  className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6]"
                />
                <span className="text-sm text-[#1f2937]">{subject.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* プログラミングコース */}
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.is_programming}
            onChange={(e) => setFormData((prev) => ({ ...prev, is_programming: e.target.checked }))}
            className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6]"
          />
          <span className="text-sm font-medium text-[#1f2937]">プログラミングコース受講</span>
        </label>
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

      {/* 所持教材 */}
      {isEdit && student?.id && (
        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-2">
            所持教材
          </label>
          {textbooksLoading ? (
            <p className="text-sm text-[#4b5563]">読み込み中...</p>
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
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      tb.status === 'distributed' ? 'bg-green-100 text-green-700' :
                      tb.status === 'delivered' ? 'bg-blue-100 text-blue-700' :
                      tb.status === 'ordered' ? 'bg-indigo-100 text-indigo-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {ORDER_STATUS_LABELS[tb.status]}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteTextbook(tb.orderId, tb.textbookName)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all"
                    title="削除"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#4b5563]/60">
              発注された教材はありません
            </p>
          )}
          <p className="text-xs text-[#9ca3af] mt-1">
            教材の追加は「教材・発注管理」ページから行えます
          </p>
        </div>
      )}

      {/* 通塾日程 */}
      <div className="border-t border-[#0d0d0d] pt-4">
        {isEdit && student?.id && student?.school_id ? (
          <Link href={`/schedule/regular-patterns?studentId=${student.id}&schoolId=${student.school_id}`}>
            <Button type="button" variant="secondary" className="w-full sm:w-auto">
              <Calendar className="mr-2 h-4 w-4" />
              通塾日程を管理
            </Button>
          </Link>
        ) : (
          <p className="text-sm text-[#2a2a2a]/80">
            通塾日程は保存後、生徒詳細の「通塾日程」タブまたは座席表メニューから登録できます。
          </p>
        )}
      </div>

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
