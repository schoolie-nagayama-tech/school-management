'use client';

import { useState } from 'react';
import { Button, Select } from '@/components/ui';
import type { FormResponse, Student } from '@/types/database';
import { GRADE_LABELS } from '@/types/database';
import { getStudents } from '@/lib/api/students';
import { ResponseDetailModal } from './ResponseDetailModal';
import { LinkStudentModal } from './LinkStudentModal';
import { unlinkResponseFromStudent } from '@/lib/api/forms';
import { useConfirm } from '@/hooks/useConfirm';

interface ResponseListProps {
  responses: FormResponse[];
  formId: string;
  onRefresh: () => void;
}

export function ResponseList({ responses, formId, onRefresh }: ResponseListProps) {
  const { confirm, ConfirmDialog } = useConfirm();
  const [gradeFilter, setGradeFilter] = useState<number | ''>('');
  const [linkedFilter, setLinkedFilter] = useState<'all' | 'linked' | 'unlinked'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedResponse, setSelectedResponse] = useState<FormResponse | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [errorMessage, setErrorMessage] = useState('');

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
    if (dateFrom && response.created_at < dateFrom) {
      return false;
    }
    if (dateTo && response.created_at > dateTo + 'T23:59:59') {
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
    setErrorMessage('');
    // 同じ教室・同じ学年の生徒を取得（教室間で生徒が混ざらないようにする）
    try {
      const allStudents = await getStudents(undefined, [response.school_id]);
      const sameGradeStudents = allStudents.filter(
        (s) => s.grade === response.grade && s.deleted_at === null
      );
      setStudents(sameGradeStudents);
      setIsLinkModalOpen(true);
    } catch (error) {
      console.error('Error fetching students:', error);
      setErrorMessage('生徒一覧の取得に失敗しました');
    }
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <>
      <div className="space-y-4">
        {errorMessage && (
          <div className="bg-[#ef4444]/20 text-[#ef4444] px-4 py-2 rounded border border-[#ef4444] text-sm">
            {errorMessage}
          </div>
        )}

        {/* フィルター */}
        <div className="flex gap-4 items-center flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-sm text-[#4b5563]">学年:</label>
            <Select
              value={gradeFilter === '' ? '' : String(gradeFilter)}
              onChange={(e) => setGradeFilter(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-32"
              options={[
                { value: '', label: '全て' },
                ...Object.entries(GRADE_LABELS).map(([key, label]) => ({ value: key, label })),
              ]}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-[#4b5563]">紐付け状態:</label>
            <Select
              value={linkedFilter}
              onChange={(e) => setLinkedFilter(e.target.value as typeof linkedFilter)}
              options={[
                { value: 'all', label: '全て' },
                { value: 'unlinked', label: '未紐付け' },
                { value: 'linked', label: '紐付け済み' },
              ]}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-[#4b5563]">申込日:</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-2 py-1 border border-gray-300 rounded text-sm"
            />
            <span className="text-sm text-gray-400">〜</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-2 py-1 border border-gray-300 rounded text-sm"
            />
          </div>
        </div>

        {/* テーブル */}
        <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[#f3f4f6] border-b border-[#e5e7eb]">
                  <th className="px-4 py-3 text-left text-[#1f2937] font-semibold border-r border-[#e5e7eb]">
                    回答日時
                  </th>
                  <th className="px-4 py-3 text-left text-[#1f2937] font-semibold border-r border-[#e5e7eb]">
                    生徒名
                  </th>
                  <th className="px-4 py-3 text-left text-[#1f2937] font-semibold border-r border-[#e5e7eb]">
                    学年
                  </th>
                  <th className="px-4 py-3 text-left text-[#1f2937] font-semibold border-r border-[#e5e7eb]">
                    メール
                  </th>
                  <th className="px-4 py-3 text-left text-[#1f2937] font-semibold border-r border-[#e5e7eb]">
                    紐付け状態
                  </th>
                  <th className="px-4 py-3 text-center text-[#1f2937] font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredResponses.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-[#4b5563]">
                      回答がありません
                    </td>
                  </tr>
                ) : (
                  filteredResponses.map((response) => (
                    <tr
                      key={response.id}
                      className="border-b border-[#e5e7eb] hover:bg-[#f3f4f6]/30 transition-colors duration-150"
                    >
                      <td className="px-4 py-3 text-[#4b5563] border-r border-[#e5e7eb]">
                        {formatDateTime(response.created_at)}
                      </td>
                      <td className="px-4 py-3 text-[#4b5563] border-r border-[#e5e7eb]">
                        {response.student_name}
                      </td>
                      <td className="px-4 py-3 text-[#4b5563] border-r border-[#e5e7eb]">
                        {response.grade ? GRADE_LABELS[response.grade] : '-'}
                      </td>
                      <td className="px-4 py-3 text-[#4b5563] border-r border-[#e5e7eb]">
                        {response.email || '-'}
                      </td>
                      <td className="px-4 py-3 text-[#4b5563] border-r border-[#e5e7eb]">
                        {response.linked_student_id ? (
                          <span className="text-sm bg-[#3b82f6]/20 text-[#1f2937] px-2 py-1 rounded">
                            紐付け済み
                          </span>
                        ) : (
                          <span className="text-sm text-[#4b5563]/60">未紐付け</span>
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
                                if (await confirm({ description: '紐付けを解除しますか？' })) {
                                  try {
                                    await unlinkResponseFromStudent(response.id);
                                    onRefresh();
                                  } catch (error) {
                                    console.error('Error unlinking:', error);
                                    setErrorMessage('紐付け解除に失敗しました');
                                  }
                                }
                              }}
                              variant="secondary"
                              size="sm"
                            >
                              解除
                            </Button>
                          ) : (
                            <Button onClick={() => handleLink(response)} size="sm">
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

      {ConfirmDialog}

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
