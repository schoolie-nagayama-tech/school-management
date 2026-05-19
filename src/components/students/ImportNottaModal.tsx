'use client';

import { useEffect, useState, useMemo } from 'react';
import { Modal, Button, Select, Input, Loading } from '@/components/ui';
import { Mic } from 'lucide-react';
import type { NottaTranscript, InterviewType } from '@/types/database';
import { INTERVIEW_TYPE_LABELS } from '@/types/database';
import { getTranscripts } from '@/lib/api/notta-transcripts';
import { linkTranscriptToStudent } from '@/lib/api/notta-transcripts';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  studentId: string;
  schoolId: string;
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

function formatDuration(seconds: number | null): string {
  if (!seconds) return '-';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}分${s}秒`;
}

export function ImportNottaModal({ isOpen, onClose, studentId, schoolId, onSuccess }: Props) {
  const [transcripts, setTranscripts] = useState<NottaTranscript[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [interviewType, setInterviewType] = useState<InterviewType>('other');
  const [interviewDate, setInterviewDate] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedId('');
    setInterviewType('other');
    setInterviewDate('');
    setSearch('');
    setError('');

    (async () => {
      setIsLoading(true);
      try {
        const data = await getTranscripts([schoolId], {
          linkedFilter: 'unlinked',
          includeArchived: false,
        });
        setTranscripts(data);
      } catch (e) {
        console.error(e);
        setError('文字起こしの取得に失敗しました');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [isOpen, schoolId]);

  const filtered = useMemo(() => {
    if (!search) return transcripts;
    const q = search.toLowerCase();
    return transcripts.filter(
      (t) =>
        (t.title || '').toLowerCase().includes(q) ||
        t.transcript.toLowerCase().includes(q)
    );
  }, [transcripts, search]);

  const selectedTranscript = transcripts.find((t) => t.id === selectedId) || null;

  // 選択時に面談日をデフォルトセット
  const handleSelect = (id: string) => {
    setSelectedId(id);
    setError('');
    const t = transcripts.find((tr) => tr.id === id);
    if (t?.recorded_at) {
      setInterviewDate(t.recorded_at.slice(0, 10));
    } else {
      setInterviewDate(new Date().toISOString().slice(0, 10));
    }
  };

  const handleSubmit = async () => {
    if (!selectedTranscript) {
      setError('文字起こしを選択してください');
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      await linkTranscriptToStudent(selectedTranscript, studentId, {
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
    <Modal isOpen={isOpen} onClose={onClose} title="Notta文字起こしから取り込み">
      <div className="space-y-4">
        {error && (
          <div className="bg-red-100 text-red-700 px-3 py-2 rounded border border-red-300 text-sm">
            {error}
          </div>
        )}

        {isLoading ? (
          <Loading size="md" />
        ) : transcripts.length === 0 ? (
          <div className="text-center py-10 text-sm text-[#4b5563]/60">
            未紐付けの文字起こしがありません
          </div>
        ) : (
          <>
            {/* 検索 */}
            <Input
              placeholder="タイトル・内容で検索"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            {/* 文字起こし一覧 */}
            <div className="max-h-56 overflow-y-auto border border-[#e5e7eb] rounded-lg divide-y divide-[#e5e7eb]">
              {filtered.length === 0 ? (
                <div className="text-center py-6 text-sm text-[#4b5563]/60">
                  該当する文字起こしがありません
                </div>
              ) : (
                filtered.map((t) => (
                  <label
                    key={t.id}
                    className={`flex items-start gap-3 p-3 cursor-pointer transition-colors duration-150 ${
                      selectedId === t.id
                        ? 'bg-blue-50'
                        : 'hover:bg-[#f3f4f6]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="notta-transcript"
                      value={t.id}
                      checked={selectedId === t.id}
                      onChange={() => handleSelect(t.id)}
                      disabled={isSubmitting}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Mic className="w-3.5 h-3.5 text-[#4b5563]/50 shrink-0" />
                        <span className="text-sm font-medium text-[#1f2937] truncate">
                          {t.title || '(無題)'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-[#4b5563]/60">
                        {t.recorded_at && (
                          <span>
                            {new Date(t.recorded_at).toLocaleString('ja-JP', {
                              month: 'numeric',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        )}
                        <span>{formatDuration(t.duration_seconds)}</span>
                      </div>
                      <div className="mt-1 text-xs text-[#4b5563]/70 line-clamp-2">
                        {t.transcript.slice(0, 120)}
                        {t.transcript.length > 120 && '...'}
                      </div>
                    </div>
                  </label>
                ))
              )}
            </div>

            {/* 面談種別・日付 */}
            {selectedId && (
              <div className="grid grid-cols-2 gap-3 pt-1">
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
            )}
          </>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-[#e5e7eb]">
          <Button onClick={onClose} variant="secondary" disabled={isSubmitting}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !selectedId}>
            {isSubmitting ? '取り込み中...' : '面談記録に取り込む'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
