'use client';

/**
 * 問合せに Notta 文字起こしを取り込む（紐付ける）モーダル。
 *
 * 生徒向けの ImportNottaModal と同じく、取り込み済みの notta_transcripts から
 * 未紐付けのものを選んで紐付ける。ただし問合せは入会前なので面談記録は作らず、
 * linked_inquiry_id を立てるだけ。入会(生徒登録)時に面談記録へ引き継がれる。
 */

import { useEffect, useState, useMemo } from 'react';
import { Modal, Button, Input, Loading } from '@/components/ui';
import { Mic } from 'lucide-react';
import type { NottaTranscript } from '@/types/database';
import {
  getAvailableTranscriptsForInquiry,
  linkTranscriptToInquiry,
} from '@/lib/api/notta-transcripts';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  inquiryId: string;
  /**
   * 取込候補を探す教室ID群。問合せの1教室に限らず、ユーザーがアクセスできる
   * 全教室を渡す（録音が別教室にタグ付けされていても拾えるようにするため）。
   */
  schoolIds: string[];
  onSuccess: () => void;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '-';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}分${s}秒`;
}

export function InquiryImportNottaModal({
  isOpen,
  onClose,
  inquiryId,
  schoolIds,
  onSuccess,
}: Props) {
  const [transcripts, setTranscripts] = useState<NottaTranscript[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedId('');
    setSearch('');
    setError('');

    (async () => {
      setIsLoading(true);
      try {
        const data = await getAvailableTranscriptsForInquiry(schoolIds);
        setTranscripts(data);
      } catch (e) {
        setError(getUserErrorMessage(e, '文字起こしの取得に失敗しました'));
      } finally {
        setIsLoading(false);
      }
    })();
    // schoolIds は親で useMemo 済みの安定参照を渡す前提（毎レンダー再取得を避ける）
  }, [isOpen, schoolIds]);

  const filtered = useMemo(() => {
    if (!search) return transcripts;
    const q = search.toLowerCase();
    return transcripts.filter(
      (t) => (t.title || '').toLowerCase().includes(q) || t.transcript.toLowerCase().includes(q)
    );
  }, [transcripts, search]);

  const handleSubmit = async () => {
    if (!selectedId) {
      setError('文字起こしを選択してください');
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      await linkTranscriptToInquiry(selectedId, inquiryId);
      onSuccess();
    } catch (e) {
      setError(getUserErrorMessage(e, '取り込みに失敗しました'));
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
          <div className="text-center py-10 text-sm text-text-muted">
            取り込める文字起こしがありません（未紐付けのものが対象です）
          </div>
        ) : (
          <>
            <Input
              placeholder="タイトル・内容で検索"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <div className="max-h-56 overflow-y-auto border border-border rounded-lg divide-y divide-border">
              {filtered.length === 0 ? (
                <div className="text-center py-6 text-sm text-text-muted">
                  該当する文字起こしがありません
                </div>
              ) : (
                filtered.map((t) => (
                  <label
                    key={t.id}
                    className={`flex items-start gap-3 p-3 cursor-pointer transition-colors duration-150 ${
                      selectedId === t.id ? 'bg-blue-50' : 'hover:bg-surface-hover'
                    }`}
                  >
                    <input
                      type="radio"
                      name="inquiry-notta-transcript"
                      value={t.id}
                      checked={selectedId === t.id}
                      onChange={() => {
                        setSelectedId(t.id);
                        setError('');
                      }}
                      disabled={isSubmitting}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Mic className="w-3.5 h-3.5 text-text-muted shrink-0" />
                        <span className="text-sm font-medium text-text-heading truncate">
                          {t.title || '(無題)'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-text-muted">
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
                      <div className="mt-1 text-xs text-text-body line-clamp-2">
                        {t.transcript.slice(0, 120)}
                        {t.transcript.length > 120 && '...'}
                      </div>
                    </div>
                  </label>
                ))
              )}
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-border">
          <Button onClick={onClose} variant="secondary" disabled={isSubmitting}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !selectedId}>
            {isSubmitting ? '取り込み中...' : '問合せに取り込む'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
