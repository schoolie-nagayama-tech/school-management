'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button, Input, Select, Loading } from '@/components/ui';
import type { Student, StudentInsert, StudentUpdate } from '@/types/database';
import { X } from 'lucide-react';
import { GRADE_LABELS, STATUS_LABELS, ORDER_STATUS_LABELS } from '@/types/database';
import { getStudentTextbooks, deleteOrder } from '@/lib/api/ordering';
import type { StudentTextbook } from '@/lib/api/ordering';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

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
  const [selectedSchoolId, setSelectedSchoolId] = useState(defaultSchoolId || schools[0]?.id || '');

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
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

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

    const submitData = isEdit
      ? (formData as StudentUpdate)
      : ({ ...formData, school_id: selectedSchoolId } as StudentInsert);

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
          <label className="block text-sm font-medium text-[#1f2937] mb-1">
            登録する教室
          </label>
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

      {/* 所持教材 */}
      {isEdit && student?.id && (
        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-2">
            所持教材
          </label>
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
                    className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-opacity duration-150"
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
