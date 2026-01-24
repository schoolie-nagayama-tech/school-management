'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui';
import { Button } from '@/components/ui';
import { getStudentWithSubjects } from '@/lib/api/subjects';
import { getDefaultSchoolId } from '@/lib/api/schools';
import type { Student, Subject } from '@/types/database';
import { GRADE_LABELS, STATUS_LABELS, STATUS_COLORS } from '@/types/database';
import { InterviewList } from './InterviewList';
import { useAuth } from '@/contexts/AuthContext';

interface StudentDetailModalProps {
  isOpen: boolean;
  student: Student | null;
  onClose: () => void;
  onEdit: (student: Student) => void;
}

type TabType = 'basic' | 'scores' | 'interviews';

export function StudentDetailModal({
  isOpen,
  student,
  onClose,
  onEdit,
}: StudentDetailModalProps) {
  const { profile } = useAuth();
  const isTeacher = profile?.role === 'teacher';
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('basic');
  const schoolId = getDefaultSchoolId();

  const tabs: { key: TabType; label: string }[] = [
    { key: 'basic', label: '基本情報' },
    { key: 'interviews', label: '面談記録' },
  ];

  useEffect(() => {
    if (isOpen && student) {
      setIsLoading(true);
      getStudentWithSubjects(student.id)
        .then((data) => {
          if (data) {
            setSubjects(data.subjects);
          }
        })
        .catch((error) => {
          console.error('Error fetching student subjects:', error);
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else {
      setSubjects([]);
    }
  }, [isOpen, student]);

  if (!student) return null;

  const handleEdit = () => {
    // 編集モーダルを開く（handleOpenEditModal内で詳細モーダルも閉じられる）
    onEdit(student);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="生徒詳細" size="lg">
      <div className="space-y-6">
        {/* タブ */}
        <div className="flex border-b border-[#0d0d0d] -mx-6 px-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-[#ff8e3c] text-[#ff8e3c]'
                  : 'border-transparent text-[#2a2a2a] hover:text-[#0d0d0d]'
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
          <h3 className="text-sm font-semibold text-[#0d0d0d] mb-3">基本情報</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-[#2a2a2a]">生徒コード</label>
              <p className="mt-1 text-sm font-mono text-[#0d0d0d]">
                {student.student_code || <span className="text-[#2a2a2a]/40">未設定</span>}
              </p>
            </div>
            <div>
              <label className="text-xs text-[#2a2a2a]">在籍状況</label>
              <p className="mt-1">
                <span
                  className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[student.status]}`}
                >
                  {STATUS_LABELS[student.status]}
                </span>
              </p>
            </div>
            <div>
              <label className="text-xs text-[#2a2a2a]">氏名</label>
              <p className="mt-1 text-sm text-[#0d0d0d]">
                {student.last_name} {student.first_name}
              </p>
            </div>
            <div>
              <label className="text-xs text-[#2a2a2a]">フリガナ</label>
              <p className="mt-1 text-sm text-[#2a2a2a]">
                {student.last_name_kana} {student.first_name_kana}
              </p>
            </div>
            <div>
              <label className="text-xs text-[#2a2a2a]">学年</label>
              <p className="mt-1 text-sm text-[#0d0d0d]">
                {GRADE_LABELS[student.grade] || student.grade}
              </p>
            </div>
          </div>
        </div>

        {/* 学校情報 */}
        {(student.school_name || student.class_name || student.club) && (
          <div>
            <h3 className="text-sm font-semibold text-[#0d0d0d] mb-3">学校情報</h3>
            <div className="grid grid-cols-2 gap-4">
              {student.school_name && (
                <div>
                  <label className="text-xs text-[#2a2a2a]">学校名</label>
                  <p className="mt-1 text-sm text-[#0d0d0d]">{student.school_name}</p>
                </div>
              )}
              {student.class_name && (
                <div>
                  <label className="text-xs text-[#2a2a2a]">クラス</label>
                  <p className="mt-1 text-sm text-[#0d0d0d]">{student.class_name}</p>
                </div>
              )}
              {student.club && (
                <div className="col-span-2">
                  <label className="text-xs text-[#2a2a2a]">部活</label>
                  <p className="mt-1 text-sm text-[#0d0d0d]">{student.club}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 受講科目 */}
        <div>
          <h3 className="text-sm font-semibold text-[#0d0d0d] mb-3">受講科目</h3>
          {isLoading ? (
            <p className="text-sm text-[#2a2a2a]">読み込み中...</p>
          ) : subjects.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {subjects.map((subject) => (
                <span
                  key={subject.id}
                  className="inline-flex px-3 py-1 text-sm bg-[#ff8e3c]/20 text-[#0d0d0d] rounded-full border border-[#0d0d0d]"
                >
                  {subject.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#2a2a2a]/60">受講科目が設定されていません</p>
          )}
          {student.subject_other && (
            <div className="mt-2">
              <label className="text-xs text-[#2a2a2a]">その他</label>
              <p className="mt-1 text-sm text-[#0d0d0d]">{student.subject_other}</p>
            </div>
          )}
        </div>

        {/* 登録・更新日時 */}
        <div>
          <h3 className="text-sm font-semibold text-[#0d0d0d] mb-3">登録情報</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-[#2a2a2a]">登録日時</label>
              <p className="mt-1 text-sm text-[#0d0d0d]">
                {new Date(student.created_at).toLocaleString('ja-JP')}
              </p>
            </div>
            <div>
              <label className="text-xs text-[#2a2a2a]">更新日時</label>
              <p className="mt-1 text-sm text-[#0d0d0d]">
                {new Date(student.updated_at).toLocaleString('ja-JP')}
              </p>
            </div>
          </div>
        </div>

            {/* アクションボタン */}
            <div className="flex justify-end gap-3 pt-4 border-t border-[#0d0d0d]">
              <Button type="button" variant="secondary" onClick={onClose}>
                閉じる
              </Button>
              {!isTeacher && (
                <Button type="button" onClick={handleEdit}>
                  編集
                </Button>
              )}
            </div>
          </>
        )}

        {activeTab === 'scores' && student && (
          <div className="min-h-[400px]">
            <p className="text-sm text-[#2a2a2a] mb-4">
              成績管理機能は別ウィンドウで開きます。生徒一覧ページから「成績」ボタンをクリックしてください。
            </p>
            <Button onClick={handleEdit} variant="secondary">
              成績を開く
            </Button>
          </div>
        )}

        {activeTab === 'interviews' && student && (
          <div className="h-[60vh] overflow-y-auto pr-2">
            <InterviewList studentId={student.id} schoolId={schoolId} />
          </div>
        )}
      </div>
    </Modal>
  );
}
