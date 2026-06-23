'use client';

import { useEffect, useState } from 'react';
import { Modal, Button, Select, Input, Loading } from '@/components/ui';
import type { NottaTranscript, InterviewType, Student } from '@/types/database';
import { INTERVIEW_TYPE_LABELS, GRADE_LABELS } from '@/types/database';
import { getStudents } from '@/lib/api/students';
import { linkTranscriptToStudent } from '@/lib/api/notta-transcripts';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  transcript: NottaTranscript | null;
  onSuccess: () => void;
}

const INTERVIEW_TYPE_OPTIONS: InterviewType[] = [
  'phone',
  'parent_interview',
  'student_interview',
  'casual',
  'enrollment',
  'other',
];

export function LinkTranscriptModal({ isOpen, onClose, transcript, onSuccess }: Props) {
  const [students, setStudents] = useState<Student[]>([]);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [interviewType, setInterviewType] = useState<InterviewType>('other');
  const [interviewDate, setInterviewDate] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen || !transcript) return;
    setSelectedStudentId('');
    setInterviewType('other');
    setInterviewDate(
      transcript.recorded_at
        ? transcript.recorded_at.slice(0, 10)
        : new Date().toISOString().slice(0, 10)
    );
    setSearch('');
    setError('');
    (async () => {
      setIsLoadingStudents(true);
      try {
        const list = await getStudents(undefined, [transcript.school_id]);
        setStudents(list.filter((s) => s.status === 'active'));
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoadingStudents(false);
      }
    })();
  }, [isOpen, transcript]);

  if (!transcript) return null;

  const filtered = students.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const full =
      `${s.last_name}${s.first_name}${s.last_name_kana || ''}${s.first_name_kana || ''}`.toLowerCase();
    return full.includes(q) || (s.student_code || '').toLowerCase().includes(q);
  });

  const handleSubmit = async () => {
    if (!selectedStudentId) {
      setError('生徒を選択してください');
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      await linkTranscriptToStudent(transcript, selectedStudentId, {
        interviewType,
        interviewDate: interviewDate || undefined,
      });
      onSuccess();
    } catch (e) {
      setError(getUserErrorMessage(e, '紐付けに失敗しました'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="文字起こしを生徒に紐付け">
      <div className="space-y-4">
        <div className="bg-[#f3f4f6] p-3 rounded border border-[#e5e7eb] text-sm space-y-1">
          <div className="font-semibold text-[#1f2937]">{transcript.title || '(無題)'}</div>
          {transcript.recorded_at && (
            <div className="text-[#4b5563]/70">
              録音: {new Date(transcript.recorded_at).toLocaleString('ja-JP')}
            </div>
          )}
          <div className="text-[#4b5563] line-clamp-3 whitespace-pre-wrap">
            {transcript.transcript.slice(0, 200)}
            {transcript.transcript.length > 200 && '...'}
          </div>
        </div>

        {error && (
          <div className="bg-red-100 text-red-700 px-3 py-2 rounded border border-red-300 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-[#4b5563] mb-1">面談種別</label>
            <Select
              value={interviewType}
              onChange={(e) => setInterviewType(e.target.value as InterviewType)}
              options={INTERVIEW_TYPE_OPTIONS.map((t) => ({
                value: t,
                label: INTERVIEW_TYPE_LABELS[t],
              }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#4b5563] mb-1">面談日</label>
            <Input
              type="date"
              value={interviewDate}
              onChange={(e) => setInterviewDate(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#4b5563] mb-1">生徒を選択</label>
          <Input
            placeholder="名前・かな・コードで検索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {isLoadingStudents ? (
            <Loading size="md" />
          ) : filtered.length === 0 ? (
            <div className="text-center py-6 text-[#4b5563]/60 text-sm">
              {students.length === 0 ? '生徒が登録されていません' : '該当する生徒がいません'}
            </div>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto border border-[#e5e7eb] rounded mt-2 p-2">
              {filtered.slice(0, 100).map((s) => (
                <label
                  key={s.id}
                  className="flex items-center gap-2 p-2 hover:bg-[#f3f4f6] rounded cursor-pointer text-sm"
                >
                  <input
                    type="radio"
                    name="student"
                    value={s.id}
                    checked={selectedStudentId === s.id}
                    onChange={(e) => {
                      setSelectedStudentId(e.target.value);
                      setError('');
                    }}
                    disabled={isSubmitting}
                  />
                  <span className="flex-1">
                    {s.last_name} {s.first_name}
                    <span className="text-[#4b5563]/60 ml-2">({GRADE_LABELS[s.grade]})</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-[#e5e7eb]">
          <Button onClick={onClose} variant="secondary" disabled={isSubmitting}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !selectedStudentId}>
            {isSubmitting ? '紐付け中...' : '紐付ける'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
