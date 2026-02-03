'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Modal, Button } from '@/components/ui';
import { getStudentWithSubjects } from '@/lib/api/subjects';
import { getDefaultSchoolId } from '@/lib/api/schools';
import { getRegularPatterns } from '@/lib/api/schedule';
import type { Student, Subject } from '@/types/database';
import { GRADE_LABELS, STATUS_LABELS, STATUS_COLORS } from '@/types/database';
import { DAY_OF_WEEK_LABELS, SCHEDULE_PERIOD_LABELS } from '@/types/schedule';
import type { ScheduleRegularPattern } from '@/types/schedule';
import { InterviewList } from './InterviewList';
import { useAuth } from '@/contexts/AuthContext';
import { Calendar } from 'lucide-react';

interface StudentDetailModalProps {
  isOpen: boolean;
  student: Student | null;
  onClose: () => void;
  onEdit: (student: Student) => void;
}

type TabType = 'basic' | 'scores' | 'interviews' | 'schedule';

export function StudentDetailModal({
  isOpen,
  student,
  onClose,
  onEdit,
}: StudentDetailModalProps) {
  const { profile } = useAuth();
  const isTeacher = profile?.role === 'teacher';
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [schedulePatterns, setSchedulePatterns] = useState<ScheduleRegularPattern[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('basic');
  const schoolId = getDefaultSchoolId();

  const tabs: { key: TabType; label: string }[] = [
    { key: 'basic', label: '基本情報' },
    { key: 'schedule', label: '通塾日程' },
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

  useEffect(() => {
    if (isOpen && student && activeTab === 'schedule' && student.school_id) {
      setScheduleLoading(true);
      getRegularPatterns(student.school_id, { studentId: student.id })
        .then(setSchedulePatterns)
        .catch(() => setSchedulePatterns([]))
        .finally(() => setScheduleLoading(false));
    } else if (!isOpen || activeTab !== 'schedule') {
      setSchedulePatterns([]);
    }
  }, [isOpen, student, activeTab]);

  if (!student) return null;

  const handleEdit = () => {
    // 編集モーダルを開く（handleOpenEditModal内で詳細モーダルも閉じられる）
    onEdit(student);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="生徒詳細" size="lg">
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
              <label className="text-xs text-[#4b5563]">生徒コード</label>
              <p className="mt-1 text-sm font-mono text-[#1f2937]">
                {student.student_code || <span className="text-[#4b5563]/40">未設定</span>}
              </p>
            </div>
            <div>
              <label className="text-xs text-[#4b5563]">在籍状況</label>
              <p className="mt-1">
                <span
                  className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[student.status]}`}
                >
                  {STATUS_LABELS[student.status]}
                </span>
              </p>
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
            <div className="flex justify-end gap-3 pt-4 border-t border-[#e5e7eb]">
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

        {activeTab === 'schedule' && student && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#0d0d0d]">通塾日程</h3>
              <Link
                href={`/schedule/regular-patterns?studentId=${student.id}&schoolId=${student.school_id ?? schoolId}`}
              >
                <Button variant="secondary" size="sm">
                  <Calendar className="mr-2 h-4 w-4" />
                  通塾日程を編集
                </Button>
              </Link>
            </div>
            {scheduleLoading ? (
              <p className="text-sm text-[#2a2a2a]">読み込み中...</p>
            ) : schedulePatterns.length === 0 ? (
              <p className="text-sm text-[#2a2a2a]/60">通塾日程が登録されていません。上の「通塾日程を編集」から登録できます。</p>
            ) : (
              <ul className="space-y-2 border rounded-md p-3 bg-[#eff0f3]/50">
                {schedulePatterns.map((p) => (
                  <li key={p.id} className="text-sm text-[#0d0d0d] flex flex-wrap gap-x-3 gap-y-1">
                    <span>{DAY_OF_WEEK_LABELS[p.day_of_week] ?? p.day_of_week}</span>
                    <span>
                      {p.time_slot
                        ? `${p.time_slot.slot_number}限 ${p.time_slot.start_time?.slice(0, 5)}-${p.time_slot.end_time?.slice(0, 5)}`
                        : '—'}
                    </span>
                    <span className="text-[#2a2a2a]">
                      {p.teacher?.display_name || p.teacher?.email || '—'}
                    </span>
                    <span className="text-[#2a2a2a]">
                      <span className="inline-flex px-2 py-0.5 text-xs rounded bg-[#ff8e3c]/20 border border-[#ff8e3c]/40">
                        {SCHEDULE_PERIOD_LABELS[p.period_type]}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {activeTab === 'scores' && student && (
          <div className="min-h-[400px]">
            <p className="text-sm text-[#4b5563] mb-4">
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
