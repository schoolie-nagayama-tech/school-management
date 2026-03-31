'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Modal, Button } from '@/components/ui';
import { getStudentWithSubjects } from '@/lib/api/subjects';
import { getDefaultSchoolId } from '@/lib/api/schools';
import { getStudentTextbooks } from '@/lib/api/ordering';
import type { Student, Subject } from '@/types/database';
import { GRADE_LABELS, STATUS_LABELS, STATUS_COLORS, ORDER_STATUS_LABELS } from '@/types/database';
import { InterviewList } from './InterviewList';
import { AttendanceMatrix } from './AttendanceMatrix';
import { useAuth } from '@/contexts/AuthContext';
import { Calendar } from 'lucide-react';
import { useConfirm } from '@/hooks/useConfirm';

interface StudentDetailModalProps {
  isOpen: boolean;
  student: Student | null;
  onClose: () => void;
  onEdit: (student: Student) => void;
  /** 削除（論理削除） */
  onDelete?: (student: Student) => Promise<void>;
}

type TabType = 'basic' | 'scores' | 'interviews' | 'schedule';

export function StudentDetailModal({
  isOpen,
  student,
  onClose,
  onEdit,
  onDelete,
}: StudentDetailModalProps) {
  const { profile } = useAuth();
  const { confirm, ConfirmDialog } = useConfirm();
  const isTeacher = profile?.role === 'teacher';
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [textbooks, setTextbooks] = useState<Awaited<ReturnType<typeof getStudentTextbooks>>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('basic');
  const schoolId = getDefaultSchoolId();

  // 通塾日程の編集は室長以上のみ。講師にはタブごと非表示
  const tabs: { key: TabType; label: string }[] = [
    { key: 'basic', label: '基本情報' },
    { key: 'scores', label: '成績' },
    ...(isTeacher ? [] : [{ key: 'schedule' as const, label: '通塾日程' }]),
    { key: 'interviews', label: '面談記録' },
  ];

  useEffect(() => {
    if (isOpen && student) {
      setIsLoading(true);
      Promise.all([
        getStudentWithSubjects(student.id).then((data) => {
          if (data) setSubjects(data.subjects);
        }),
        getStudentTextbooks(student.id).then(setTextbooks).catch(() => setTextbooks([])),
      ])
        .catch((error) => {
          console.error('Error fetching student data:', error);
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else {
      setSubjects([]);
      setTextbooks([]);
    }
  }, [isOpen, student]);


  if (!student) return null;

  const handleEdit = () => {
    onEdit(student);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="生徒詳細" size="xl">
      <div className="space-y-6">
        {/* タブ */}
        <div className="flex border-b border-[#e5e7eb] -mx-6 px-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-[#3b82f6] text-[#3b82f6]'
                  : 'border-transparent text-[#4b5563] hover:text-[#1f2937]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* タブコンテンツ */}
        {activeTab === 'basic' && (
          <>
            {/* 基本情報 */}
        <div>
          <h3 className="text-sm font-semibold text-[#1f2937] mb-3">基本情報</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-[#4b5563]">在籍状況</label>
              <div className="mt-1">
                <span
                  className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[student.status]}`}
                >
                  {STATUS_LABELS[student.status]}
                </span>
              </div>
            </div>
            <div>
              <label className="text-xs text-[#4b5563]">氏名</label>
              <p className="mt-1 text-sm text-[#1f2937]">
                {student.last_name} {student.first_name}
              </p>
            </div>
            <div>
              <label className="text-xs text-[#4b5563]">フリガナ</label>
              <p className="mt-1 text-sm text-[#4b5563]">
                {student.last_name_kana} {student.first_name_kana}
              </p>
            </div>
            <div>
              <label className="text-xs text-[#4b5563]">学年</label>
              <p className="mt-1 text-sm text-[#1f2937]">
                {GRADE_LABELS[student.grade] || student.grade}
              </p>
            </div>
          </div>
        </div>

        {/* 学校情報 */}
        {(student.school_name || student.class_name || student.club) && (
          <div>
            <h3 className="text-sm font-semibold text-[#1f2937] mb-3">学校情報</h3>
            <div className="grid grid-cols-2 gap-4">
              {student.school_name && (
                <div>
                  <label className="text-xs text-[#4b5563]">学校名</label>
                  <p className="mt-1 text-sm text-[#1f2937]">{student.school_name}</p>
                </div>
              )}
              {student.class_name && (
                <div>
                  <label className="text-xs text-[#4b5563]">クラス</label>
                  <p className="mt-1 text-sm text-[#1f2937]">{student.class_name}</p>
                </div>
              )}
              {student.club && (
                <div className="col-span-2">
                  <label className="text-xs text-[#4b5563]">部活</label>
                  <p className="mt-1 text-sm text-[#1f2937]">{student.club}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 受講科目 */}
        <div>
          <h3 className="text-sm font-semibold text-[#1f2937] mb-3">受講科目</h3>
          {isLoading ? (
            <p className="text-sm text-[#4b5563]">読み込み中...</p>
          ) : subjects.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {subjects.map((subject) => (
                <span
                  key={subject.id}
                  className="inline-flex px-3 py-1 text-sm bg-[#3b82f6]/20 text-[#1f2937] rounded-full border border-[#e5e7eb]"
                >
                  {subject.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#4b5563]/60">受講科目が設定されていません</p>
          )}
          {student.subject_other && (
            <div className="mt-2">
              <label className="text-xs text-[#4b5563]">その他</label>
              <p className="mt-1 text-sm text-[#1f2937]">{student.subject_other}</p>
            </div>
          )}
        </div>

        {/* 所持教材 */}
        <div>
          <h3 className="text-sm font-semibold text-[#1f2937] mb-3">所持教材</h3>
          {isLoading ? (
            <p className="text-sm text-[#4b5563]">読み込み中...</p>
          ) : textbooks.length > 0 ? (
            <div className="space-y-1.5">
              {textbooks.map((tb) => (
                <div
                  key={tb.orderId}
                  className="flex items-center justify-between px-3 py-1.5 bg-[#f8fafc] rounded-lg border border-[#e5e7eb]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-[#1f2937] truncate">{tb.textbookName}</span>
                    {tb.quantity > 1 && (
                      <span className="text-xs text-[#4b5563] bg-gray-200 px-1.5 py-0.5 rounded">×{tb.quantity}</span>
                    )}
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                    tb.status === 'distributed' ? 'bg-green-100 text-green-700' :
                    tb.status === 'delivered' ? 'bg-blue-100 text-blue-700' :
                    tb.status === 'ordered' ? 'bg-indigo-100 text-indigo-700' :
                    'bg-yellow-100 text-yellow-700'
                  }`}>
                    {ORDER_STATUS_LABELS[tb.status]}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#4b5563]/60">発注された教材はありません</p>
          )}
        </div>

        {/* 登録・更新日時 */}
        <div>
          <h3 className="text-sm font-semibold text-[#1f2937] mb-3">登録情報</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-[#4b5563]">登録日時</label>
              <p className="mt-1 text-sm text-[#1f2937]">
                {new Date(student.created_at).toLocaleString('ja-JP')}
              </p>
            </div>
            <div>
              <label className="text-xs text-[#4b5563]">更新日時</label>
              <p className="mt-1 text-sm text-[#1f2937]">
                {new Date(student.updated_at).toLocaleString('ja-JP')}
              </p>
            </div>
          </div>
        </div>

            {/* アクションボタン */}
            <div className="flex justify-between pt-4 border-t border-[#e5e7eb]">
              <div>
                {!isTeacher && onDelete && (
                  <Button
                    type="button"
                    variant="outline"
                    className="text-red-600 border-red-200 hover:bg-red-50"
                    onClick={async () => {
                      if (!(await confirm({ title: '削除確認', description: `${student.last_name} ${student.first_name} を削除しますか？論理削除され、一覧から非表示になります。`, confirmLabel: '削除', variant: 'danger' }))) return;
                      await onDelete(student);
                      onClose();
                    }}
                  >
                    削除
                  </Button>
                )}
              </div>
              <div className="flex gap-3">
                <Button type="button" variant="secondary" onClick={onClose}>
                  閉じる
                </Button>
                {!isTeacher && (
                  <Button type="button" onClick={handleEdit}>
                    編集
                  </Button>
                )}
              </div>
            </div>
          </>
        )}

        {activeTab === 'schedule' && !isTeacher && student && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#0d0d0d]">通塾日程</h3>
              <Link
                href={`/schedule/regular-patterns?studentId=${student.id}&schoolId=${student.school_id ?? schoolId}`}
              >
                <Button variant="secondary" size="sm">
                  <Calendar className="mr-2 h-4 w-4" />
                  詳細編集
                </Button>
              </Link>
            </div>
            <AttendanceMatrix
              studentId={student.id}
              schoolId={student.school_id ?? schoolId}
              studentGrade={student.grade}
              canEdit={!isTeacher}
            />
          </div>
        )}

        {activeTab === 'scores' && student && (
          <div className="min-h-[400px]">
            <p className="text-sm text-[#4b5563] mb-4">
              成績の詳細を確認できます。下のボタンから成績ページへ移動してください。
            </p>
            <Link href={`/students/${student.id}/scores`}>
              <Button variant="secondary">
                成績の詳細を確認
              </Button>
            </Link>
          </div>
        )}

        {activeTab === 'interviews' && student && (
          <div className="h-[60vh] overflow-y-auto pr-2">
            <InterviewList studentId={student.id} schoolId={schoolId} />
          </div>
        )}
      </div>
      {ConfirmDialog}
    </Modal>
  );
}
