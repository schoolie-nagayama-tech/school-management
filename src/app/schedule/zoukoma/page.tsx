'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Pencil, Trash2 } from 'lucide-react';
import { AdminLayout } from '@/components/layouts';
import { Button, Loading } from '@/components/ui';
import { ZoukomaEnrollmentFormModal } from '@/components/schedule/ZoukomaEnrollmentFormModal';
import { getZoukomaPeriods, getAllZoukomaResponses } from '@/lib/api/zoukoma';
import { archiveResponse } from '@/lib/api/form-responses';
import type { ZoukomaPeriod, ZoukomaResponse } from '@/types/forms/zoukoma';
import { useAuth } from '@/contexts/AuthContext';
import AccessDenied from '@/components/AccessDenied';

function gradeLabel(grade: number): string {
  if (grade <= 6) return `小${grade}`;
  if (grade <= 9) return `中${grade - 6}`;
  return `高${grade - 9}`;
}

/**
 * 生徒別 増コマ（テスト対策）申込画面。
 * 管理者が生徒ごとに「科目×コマ数＋通塾できる枠」を登録/編集/削除する（フォーム回答の手動代行）。
 * ここで登録した申込を、座席表の「追加授業（テスト対策）」モードが読んで落とし込む。
 */
export default function ZoukomaEnrollmentPage() {
  const { profile, selectedSchoolId } = useAuth();
  const isManager =
    profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';
  const schoolId = selectedSchoolId ?? '';

  const [periods, setPeriods] = useState<ZoukomaPeriod[]>([]);
  const [responses, setResponses] = useState<ZoukomaResponse[]>([]);
  const [loading, setLoading] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ZoukomaResponse | null>(null);
  const [deleting, setDeleting] = useState<ZoukomaResponse | null>(null);

  // 期間は意識しない。ただし新規登録は何らかのフォーム設定（科目・枠）が必要なので、
  // 最新の期間を「テンプレート」として使う（タブ選択はしない）。
  const templatePeriod = periods[0] ?? null;

  // 増コマフォーム設定（テンプレート用）をロード
  useEffect(() => {
    if (!schoolId) { setPeriods([]); return; }
    getZoukomaPeriods(schoolId).then(setPeriods).catch(() => setPeriods([]));
  }, [schoolId]);

  // 申込は全期間まとめて取得
  const loadResponses = useCallback(async () => {
    if (!schoolId) { setResponses([]); return; }
    setLoading(true);
    try {
      setResponses(await getAllZoukomaResponses(schoolId));
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => { loadResponses(); }, [loadResponses]);

  // 学年降順 → 名前
  const rows = useMemo(
    () => [...responses].sort((a, b) => (b.grade ?? 0) - (a.grade ?? 0)),
    [responses]
  );

  // 重複防止：既に申込済みの生徒（紐付け済み）を新規追加から除外
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

  if (!isManager) return <AccessDenied />;

  return (
    <AdminLayout headerTitle="追加授業 申込（生徒別）">
      <div className="space-y-6">
        {/* ヘッダー */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Link href="/schedule">
              <button className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                <ArrowLeft className="w-5 h-5" />
              </button>
            </Link>
            <h1 className="text-xl font-bold text-[var(--headline)]">追加授業（テスト対策）申込（生徒別）</h1>
          </div>
          {templatePeriod && (
            <Button onClick={() => { setEditing(null); setFormOpen(true); }} className="flex items-center gap-1">
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

        {/* 生徒別一覧（期間は意識せず全申込をまとめて表示） */}
        {schoolId && periods.length > 0 && (
          loading ? (
            <Loading size="md" />
          ) : rows.length === 0 ? (
            <div className="text-center py-12 text-[var(--paragraph)]">
              <p className="mb-4">まだ申込がありません。</p>
              <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
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
                    <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50/60 transition-colors">
                      <td className="px-3 py-2 font-medium text-[var(--headline)]">{r.student_name}</td>
                      <td className="px-3 py-2 text-[var(--paragraph)]">{gradeLabel(r.grade)}</td>
                      <td className="px-3 py-2 text-[var(--paragraph)]">{komaSummary(r)}</td>
                      <td className="px-3 py-2 text-[var(--paragraph)]">
                        {(r.response_data?.selected_slots?.length ?? 0)} 枠
                      </td>
                      <td className="px-3 py-2">
                        {r.linked_student_id ? (
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-success-subtle text-success border border-success/20">紐付け済み</span>
                        ) : (
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-warning-subtle text-warning border border-warning/20">未紐付け</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => { setEditing(r); setFormOpen(true); }} className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded" title="編集">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => setDeleting(r)} className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded" title="削除">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* 未紐付けの注意書き：紐付かないと座席表の落とし込みパネルに出ない */}
        {schoolId && periods.length > 0 && rows.some((r) => !r.linked_student_id) && (
          <p className="text-xs text-[var(--paragraph)]">
            ※「未紐付け」の申込は座席表の落とし込みパネルに出ません。編集で生徒を選び直すと紐付きます。
          </p>
        )}
      </div>

      {/* 追加/編集モーダル（最新フォーム設定をテンプレートに使用） */}
      {templatePeriod && (
        <ZoukomaEnrollmentFormModal
          open={formOpen}
          onClose={() => { setFormOpen(false); setEditing(null); }}
          schoolId={schoolId}
          period={templatePeriod}
          existingStudentIds={editing ? [] : existingStudentIds}
          editing={editing}
          onSaved={loadResponses}
        />
      )}

      {/* 削除確認 */}
      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="font-bold text-[var(--headline)] mb-2">申込を削除しますか？</h3>
            <p className="text-sm text-[var(--paragraph)] mb-4">
              {deleting.student_name} の増コマ申込を削除（アーカイブ）します。
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={() => setDeleting(null)}>キャンセル</Button>
              <Button variant="danger" onClick={handleDelete}>削除する</Button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
