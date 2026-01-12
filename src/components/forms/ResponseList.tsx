'use client';

import { useState } from 'react';
import { Button, Select } from '@/components/ui';
import type { FormResponse, Student } from '@/types/database';
import { GRADE_LABELS } from '@/types/database';
import { getStudents } from '@/lib/api/students';
import { ResponseDetailModal } from './ResponseDetailModal';
import { LinkStudentModal } from './LinkStudentModal';

interface ResponseListProps {
  responses: FormResponse[];
  formId: string;
  onRefresh: () => void;
}

export function ResponseList({ responses, formId, onRefresh }: ResponseListProps) {
  const [gradeFilter, setGradeFilter] = useState<number | ''>('');
  const [linkedFilter, setLinkedFilter] = useState<'all' | 'linked' | 'unlinked'>('all');
  const [selectedResponse, setSelectedResponse] = useState<FormResponse | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);

  // フィルター適用
  const filteredResponses = responses.filter((response) => {
    if (gradeFilter !== '' && response.grade !== Number(gradeFilter)) {
      return false;
    }
    if (linkedFilter === 'linked' && !response.linked_student_id) {
      return false;
    }
    if (linkedFilter === 'unlinked' && response.linked_student_id) {
      return false;
    }
    return true;
  });

  const handleViewDetail = (response: FormResponse) => {
    setSelectedResponse(response);
    setIsDetailModalOpen(true);
  };

  const handleLink = async (response: FormResponse) => {
    setSelectedResponse(response);
    // 同じ学年の生徒を取得
    try {
      const allStudents = await getStudents();
      const sameGradeStudents = allStudents.filter(
        (s) => s.grade === response.grade && s.deleted_at === null
      );
      setStudents(sameGradeStudents);
      setIsLinkModalOpen(true);
    } catch (error) {
      console.error('Error fetching students:', error);
      alert('生徒一覧の取得に失敗しました');
    }
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <>
      <div className="space-y-4">
        {/* フィルター */}
        <div className="flex gap-4 items-center">
          <div className="flex items-center gap-2">
            <label className="text-sm text-[#2a2a2a]">学年:</label>
            <Select
              value={gradeFilter === '' ? '' : String(gradeFilter)}
              onChange={(e) => setGradeFilter(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-32"
            >
              <option value="">全て</option>
              {Object.entries(GRADE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-[#2a2a2a]">紐付け状態:</label>
            <Select
              value={linkedFilter}
              onChange={(e) => setLinkedFilter(e.target.value as typeof linkedFilter)}
            >
              <option value="all">全て</option>
              <option value="unlinked">未紐付け</option>
              <option value="linked">紐付け済み</option>
            </Select>
          </div>
        </div>

        {/* テーブル */}
        <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[#eff0f3] border-b border-[#0d0d0d]">
                  <th className="px-4 py-3 text-left text-[#0d0d0d] font-semibold border-r border-[#0d0d0d]">
                    回答日時
                  </th>
                  <th className="px-4 py-3 text-left text-[#0d0d0d] font-semibold border-r border-[#0d0d0d]">
                    生徒名
                  </th>
                  <th className="px-4 py-3 text-left text-[#0d0d0d] font-semibold border-r border-[#0d0d0d]">
                    学年
                  </th>
                  <th className="px-4 py-3 text-left text-[#0d0d0d] font-semibold border-r border-[#0d0d0d]">
                    メール
                  </th>
                  <th className="px-4 py-3 text-left text-[#0d0d0d] font-semibold border-r border-[#0d0d0d]">
                    紐付け状態
                  </th>
                  <th className="px-4 py-3 text-center text-[#0d0d0d] font-semibold">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredResponses.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-[#2a2a2a]">
                      回答がありません
                    </td>
                  </tr>
                ) : (
                  filteredResponses.map((response) => (
                    <tr
                      key={response.id}
                      className="border-b border-[#0d0d0d] hover:bg-[#eff0f3]/30"
                    >
                      <td className="px-4 py-3 text-[#2a2a2a] border-r border-[#0d0d0d]">
                        {formatDateTime(response.created_at)}
                      </td>
                      <td className="px-4 py-3 text-[#2a2a2a] border-r border-[#0d0d0d]">
                        {response.student_name}
                      </td>
                      <td className="px-4 py-3 text-[#2a2a2a] border-r border-[#0d0d0d]">
                        {response.grade ? GRADE_LABELS[response.grade] : '-'}
                      </td>
                      <td className="px-4 py-3 text-[#2a2a2a] border-r border-[#0d0d0d]">
                        {response.email || '-'}
                      </td>
                      <td className="px-4 py-3 text-[#2a2a2a] border-r border-[#0d0d0d]">
                        {response.linked_student_id ? (
                          <span className="text-sm bg-[#ff8e3c]/20 text-[#0d0d0d] px-2 py-1 rounded">
                            紐付け済み
                          </span>
                        ) : (
                          <span className="text-sm text-[#2a2a2a]/60">未紐付け</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            onClick={() => handleViewDetail(response)}
                            variant="secondary"
                            size="sm"
                          >
                            詳細
                          </Button>
                          {response.linked_student_id ? (
                            <Button
                              onClick={async () => {
                                const { unlinkResponseFromStudent } = await import('@/lib/api/forms');
                                if (confirm('紐付けを解除しますか？')) {
                                  try {
                                    await unlinkResponseFromStudent(response.id);
                                    onRefresh();
                                  } catch (error) {
                                    console.error('Error unlinking:', error);
                                    alert('紐付け解除に失敗しました');
                                  }
                                }
                              }}
                              variant="secondary"
                              size="sm"
                            >
                              解除
                            </Button>
                          ) : (
                            <Button
                              onClick={() => handleLink(response)}
                              size="sm"
                            >
                              紐付け
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ResponseDetailModal
        isOpen={isDetailModalOpen}
        onClose={() => {
          setIsDetailModalOpen(false);
          setSelectedResponse(null);
        }}
        response={selectedResponse}
        formId={formId}
      />

      <LinkStudentModal
        isOpen={isLinkModalOpen}
        onClose={() => {
          setIsLinkModalOpen(false);
          setSelectedResponse(null);
          setStudents([]);
        }}
        response={selectedResponse}
        students={students}
        onSuccess={() => {
          setIsLinkModalOpen(false);
          setSelectedResponse(null);
          setStudents([]);
          onRefresh();
        }}
      />
    </>
  );
}
