'use client';

import { Modal, Button } from '@/components/ui';
import { Link2 } from 'lucide-react';
import type { NottaTranscriptWithStudent } from '@/types/database';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  transcript: NottaTranscriptWithStudent | null;
  onLink?: () => void;
  onUnlink?: () => void;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '-';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}分${s}秒`;
}

export function TranscriptDetailModal({ isOpen, onClose, transcript, onLink, onUnlink }: Props) {
  if (!transcript) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={transcript.title || '文字起こし詳細'}>
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-2 bg-[#f3f4f6] p-3 rounded">
          <div>
            <span className="text-[#4b5563]/60">録音日時: </span>
            {transcript.recorded_at ? new Date(transcript.recorded_at).toLocaleString('ja-JP') : '-'}
          </div>
          <div>
            <span className="text-[#4b5563]/60">尺: </span>
            {formatDuration(transcript.duration_seconds)}
          </div>
          <div>
            <span className="text-[#4b5563]/60">取り込み: </span>
            {new Date(transcript.created_at).toLocaleString('ja-JP')}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#4b5563]/60">紐付け先: </span>
            {transcript.student
              ? <span className="text-green-700 font-medium">{transcript.student.last_name} {transcript.student.first_name}</span>
              : <span className="text-yellow-700">未紐付け</span>}
          </div>
          {transcript.audio_url && (
            <div className="col-span-2">
              <a
                href={transcript.audio_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline break-all"
              >
                Nottaで開く
              </a>
            </div>
          )}
        </div>

        <div>
          <div className="text-[#4b5563]/60 mb-1">文字起こし</div>
          <div className="whitespace-pre-wrap bg-white border border-[#e5e7eb] rounded p-3 max-h-96 overflow-y-auto">
            {transcript.transcript}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-[#e5e7eb]">
          <div>
            {!transcript.linked_student_id && onLink && (
              <Button onClick={onLink}>
                <Link2 className="w-4 h-4 mr-1 inline" />
                紐付け
              </Button>
            )}
            {transcript.linked_student_id && onUnlink && (
              <Button variant="secondary" onClick={onUnlink}>
                紐付け解除
              </Button>
            )}
          </div>
          <Button onClick={onClose} variant="secondary">
            閉じる
          </Button>
        </div>
      </div>
    </Modal>
  );
}
