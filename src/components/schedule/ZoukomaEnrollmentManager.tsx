'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Button, Loading } from '@/components/ui';
import { ZoukomaEnrollmentFormModal } from '@/components/schedule/ZoukomaEnrollmentFormModal';
import { getZoukomaPeriods, getAllZoukomaResponses } from '@/lib/api/zoukoma';
import { archiveResponse } from '@/lib/api/form-responses';
import type { ZoukomaPeriod, ZoukomaResponse } from '@/types/forms/zoukoma';
import { useAuth } from '@/contexts/AuthContext';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';

/**
 * テスト対策（増コマ）申込の生徒別 管理。期間は意識せず全申込を1つの一覧で扱う。
 * 「申込管理」画面のテスト対策タブとして使う（レイアウト/権限ガードは親が担当）。
 */
export function ZoukomaEnrollmentManager() {
  const { selectedSchoolId } = useAuth();
  const schoolId = selectedSchoolId ?? '';

  const [periods, setPeriods] = useState<ZoukomaPeriod[]>([]);
  const [responses, setResponses] = useState<ZoukomaResponse[]>([]);
  const [loading, setLoading] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ZoukomaResponse | null>(null);
  const [deleting, setDeleting] = useState<ZoukomaResponse | null>(null);

  // 新規登録のテンプレートに使う最新フォーム設定（タブ選択はしない）
  const templatePeriod = periods[0] ?? null;

  useEffect(() => {
    if (!schoolId) {
      setPeriods([]);
      return;
    }
    getZoukomaPeriods(schoolId)
      .then(setPeriods)
      .catch(() => setPeriods([]));
  }, [schoolId]);

  const loadResponses = useCallback(async () => {
    if (!schoolId) {
      setResponses([]);
      return;
    }
    setLoading(true);
    try {
      setResponses(await getAllZoukomaResponses(schoolId));
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    loadResponses();
  }, [loadResponses]);

  const rows = useMemo(
    () => [...responses].sort((a, b) => (b.grade ?? 0) - (a.grade ?? 0)),
    [responses]
  );

  const existingStudentIds = useMemo(
    () => responses.map((r) => r.linked_student_id).filter((x): x is string => !!x),
    [responses]
  );

  const komaSummary = (r: ZoukomaResponse): string => {
    const subj = r.response_data?.subjects ?? {};
    const parts = Object.entries(subj)
      .filter(([, n]) => Number(n) > 0)
      .map(([name, n]) => `${name}${n}`);
    return parts.length > 0 ? parts.join('・') : '—';
  };

  const handleDelete = async () => {
    if (!deleting) return;
    await archiveResponse(deleting.id);
    setDeleting(null);
    await loadResponses();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-[var(--paragraph)]">
          増コマフォームの申込（科目×コマ数＋通塾できる枠）。座席表のテスト対策モードで落とし込みます。
        </p>
        {templatePeriod && (
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="flex items-center gap-1"
          >
            <Plus className="w-4 h-4" />
            生徒を追加
          </Button>
        )}
      </div>

      {!schoolId && (
        <div className="text-center py-12 text-[var(--paragraph)]">教室を選択してください。</div>
      )}

      {schoolId && periods.length === 0 && (
        <div className="text-center py-12 text-[var(--paragraph)]">
          <p className="mb-4">増コマ申込フォームが設定されていません。</p>
          <Link href="/forms">
            <Button>フォーム設定へ</Button>
          </Link>
        </div>
      )}

      {schoolId &&
        periods.length > 0 &&
        (loading ? (
          <Loading size="md" />
        ) : rows.length === 0 ? (
          <div className="text-center py-12 text-[var(--paragraph)]">
            <p className="mb-4">まだ申込がありません。</p>
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="w-4 h-4 mr-1" />
              最初の生徒を追加
            </Button>
          </div>
        ) : (
          <div className="border border-[var(--stroke)] rounded-xl overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-[var(--paragraph)]">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">生徒</th>
                  <th className="text-left px-3 py-2 font-medium">学年</th>
                  <th className="text-left px-3 py-2 font-medium">科目別コマ数</th>
                  <th className="text-left px-3 py-2 font-medium">通塾枠</th>
                  <th className="text-left px-3 py-2 font-medium">紐付け</th>
                  <th className="px-3 py-2 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-gray-100 hover:bg-gray-50/60 transition-colors"
                  >
                    <td className="px-3 py-2 font-medium text-[var(--headline)]">
                      {r.student_name}
                    </td>
                    <td className="px-3 py-2 text-[var(--paragraph)]">
                      {formatGradeLabel(r.grade)}
                    </td>
                    <td className="px-3 py-2 text-[var(--paragraph)]">{komaSummary(r)}</td>
                    <td className="px-3 py-2 text-[var(--paragraph)]">
                      {r.response_data?.selected_slots?.length ?? 0} 枠
                    </td>
                    <td className="px-3 py-2">
                      {r.linked_student_id ? (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-success-subtle text-success border border-success/20">
                          紐付け済み
                        </span>
                      ) : (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-warning-subtle text-warning border border-warning/20">
                          未紐付け
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => {
                            setEditing(r);
                            setFormOpen(true);
                          }}
                          className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                          title="編集"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleting(r)}
                          className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                          title="削除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {schoolId && periods.length > 0 && rows.some((r) => !r.linked_student_id) && (
        <p className="text-xs text-[var(--paragraph)]">
          ※「未紐付け」の申込は座席表の落とし込みパネルに出ません。編集で生徒を選び直すと紐付きます。
        </p>
      )}

      {templatePeriod && (
        <ZoukomaEnrollmentFormModal
          open={formOpen}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          schoolId={schoolId}
          period={templatePeriod}
          existingStudentIds={editing ? [] : existingStudentIds}
          editing={editing}
          onSaved={loadResponses}
        />
      )}

      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="font-bold text-[var(--headline)] mb-2">申込を削除しますか？</h3>
            <p className="text-sm text-[var(--paragraph)] mb-4">
              {deleting.student_name} の増コマ申込を削除（アーカイブ）します。
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                キャンセル
              </Button>
              <Button variant="danger" onClick={handleDelete}>
                削除する
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
