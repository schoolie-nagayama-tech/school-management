'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Button, Select } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import {
  getTranscripts,
  archiveTranscript,
  unarchiveTranscript,
  unlinkTranscript,
} from '@/lib/api/notta-transcripts';
import type { NottaTranscriptWithStudent } from '@/types/database';
import { LinkTranscriptModal } from '@/components/transcriptions/LinkTranscriptModal';
import { TranscriptDetailModal } from '@/components/transcriptions/TranscriptDetailModal';

type LinkedFilter = 'all' | 'linked' | 'unlinked';

function formatDuration(seconds: number | null): string {
  if (!seconds) return '-';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function TranscriptionsPage() {
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessStudents
  );
  const { getSelectedSchoolIds } = useAuth();

  const [items, setItems] = useState<NottaTranscriptWithStudent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [linkedFilter, setLinkedFilter] = useState<LinkedFilter>('unlinked');
  const [showArchived, setShowArchived] = useState(false);

  const [selected, setSelected] = useState<NottaTranscriptWithStudent | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isLinkOpen, setIsLinkOpen] = useState(false);

  const schoolIds = useMemo(() => getSelectedSchoolIds(), [getSelectedSchoolIds]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const data = await getTranscripts(schoolIds, {
        linkedFilter,
        includeArchived: showArchived,
      });
      setItems(data);
    } catch (e) {
      setError(getUserErrorMessage(e, '文字起こしの取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [schoolIds, linkedFilter, showArchived]);

  useEffect(() => {
    if (hasPermission) load();
  }, [hasPermission, load]);

  if (permissionLoading) return null;
  if (!hasPermission) return <AccessDenied />;

  const handleArchive = async (id: string, archived: boolean) => {
    try {
      if (archived) await unarchiveTranscript(id);
      else await archiveTranscript(id);
      await load();
    } catch (e) {
      alert(getUserErrorMessage(e, '操作に失敗しました'));
    }
  };

  const handleUnlink = async (id: string) => {
    if (!confirm('紐付けを解除しますか？（面談記録は残ります）')) return;
    try {
      await unlinkTranscript(id);
      await load();
    } catch (e) {
      alert(getUserErrorMessage(e, '操作に失敗しました'));
    }
  };

  return (
    <AdminLayout>
      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#1f2937]">Notta 文字起こし</h1>
            <p className="text-xs text-[#4b5563]/70 mt-1">
              Zapier経由でNottaから受信した文字起こしを、生徒の面談記録に紐付けます。
            </p>
          </div>
          <Button variant="secondary" onClick={load} disabled={isLoading}>
            {isLoading ? '読み込み中...' : '再読込'}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4 p-3 bg-[#f9fafb] border border-[#e5e7eb] rounded">
          <div className="flex items-center gap-2">
            <label className="text-sm text-[#4b5563]">紐付け状態</label>
            <Select
              value={linkedFilter}
              onChange={(e) => setLinkedFilter(e.target.value as LinkedFilter)}
              options={[
                { value: 'unlinked', label: '未紐付け' },
                { value: 'linked', label: '紐付け済み' },
                { value: 'all', label: 'すべて' },
              ]}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-[#4b5563]">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            アーカイブも表示
          </label>
        </div>

        {error && (
          <div className="mb-3 bg-red-100 text-red-700 px-3 py-2 rounded border border-red-300 text-sm">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-12 text-[#4b5563]/60">読み込み中...</div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 text-[#4b5563]/60 text-sm">
            該当する文字起こしがありません
          </div>
        ) : (
          <div className="overflow-x-auto border border-[#e5e7eb] rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-[#f3f4f6] text-[#4b5563]">
                <tr>
                  <th className="px-3 py-2 text-left">取り込み</th>
                  <th className="px-3 py-2 text-left">タイトル</th>
                  <th className="px-3 py-2 text-left">録音日時</th>
                  <th className="px-3 py-2 text-left">尺</th>
                  <th className="px-3 py-2 text-left">プレビュー</th>
                  <th className="px-3 py-2 text-left">紐付け先</th>
                  <th className="px-3 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr
                    key={t.id}
                    className={`border-t border-[#e5e7eb] hover:bg-[#f9fafb] ${t.is_archived ? 'opacity-60' : ''}`}
                  >
                    <td className="px-3 py-2 whitespace-nowrap text-[#4b5563]/80">
                      {new Date(t.created_at).toLocaleString('ja-JP', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-3 py-2 max-w-[200px] truncate">{t.title || '(無題)'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-[#4b5563]/80">
                      {t.recorded_at
                        ? new Date(t.recorded_at).toLocaleString('ja-JP', {
                            month: 'numeric',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '-'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDuration(t.duration_seconds)}</td>
                    <td className="px-3 py-2 max-w-[300px] truncate text-[#4b5563]/80">
                      {t.transcript.slice(0, 80)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {t.student ? (
                        <span className="text-green-700">
                          {t.student.last_name} {t.student.first_name}
                        </span>
                      ) : (
                        <span className="text-yellow-700">未紐付け</span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-right space-x-1">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setSelected(t);
                          setIsDetailOpen(true);
                        }}
                      >
                        詳細
                      </Button>
                      {!t.linked_student_id && !t.is_archived && (
                        <Button
                          onClick={() => {
                            setSelected(t);
                            setIsLinkOpen(true);
                          }}
                        >
                          紐付け
                        </Button>
                      )}
                      {t.linked_student_id && (
                        <Button variant="secondary" onClick={() => handleUnlink(t.id)}>
                          解除
                        </Button>
                      )}
                      <Button variant="secondary" onClick={() => handleArchive(t.id, t.is_archived)}>
                        {t.is_archived ? '戻す' : 'アーカイブ'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TranscriptDetailModal
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        transcript={selected}
      />
      <LinkTranscriptModal
        isOpen={isLinkOpen}
        onClose={() => setIsLinkOpen(false)}
        transcript={selected}
        onSuccess={() => {
          setIsLinkOpen(false);
          load();
        }}
      />
    </AdminLayout>
  );
}
