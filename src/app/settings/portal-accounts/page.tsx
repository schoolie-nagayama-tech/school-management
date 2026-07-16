'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ChevronLeft, Copy, Ticket } from 'lucide-react';
import { AdminLayout } from '@/components/layouts';
import { Button, Loading, ToastContainer } from '@/components/ui';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { useLocalSchoolId } from '@/hooks/useLocalSchoolId';
import { useToast } from '@/hooks/useToast';
import { isSystemAdmin } from '@/lib/utils/roles';
import { fetchWithAuth } from '@/lib/api/auth';
import { getStudents } from '@/lib/api/students';

/**
 * ポータルアカウント管理（アドミン限定）。
 *
 * クローズド期間の運用画面。生徒を選んで招待を発行し、受諾URLを表示・コピーする。
 * 発行済み一覧（受諾状況・期限）も表示する。
 * ナビ（navConfig）には載せない = URL直行でのみ到達（docs/portal-v2-requirements.md §6-2）。
 */

interface StudentLite {
  id: string;
  last_name: string;
  first_name: string;
}

interface InvitationRow {
  id: string;
  token: string;
  student_id: string;
  invite_type: string;
  expires_at: string;
  accepted_at: string | null;
  students: { last_name: string; first_name: string } | null;
}

export default function PortalAccountsPage() {
  const { profile, isLoading: authLoading } = useAuth();
  const { localSchoolId, availableSchools, setLocalSchoolId } = useLocalSchoolId();
  const { toasts, removeToast, success, error: toastError } = useToast();

  const [students, setStudents] = useState<StudentLite[]>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [inviteType, setInviteType] = useState<'guardian' | 'student'>('guardian');
  const [loading, setLoading] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [lastUrl, setLastUrl] = useState('');

  const isAdmin = isSystemAdmin(profile?.role);

  // 選択教室の生徒一覧と発行済み招待を読み込む。
  const loadData = useCallback(async () => {
    if (!localSchoolId || localSchoolId === 'all') {
      setStudents([]);
      setInvitations([]);
      return;
    }
    setLoading(true);
    try {
      const [studentList, invRes] = await Promise.all([
        getStudents(undefined, [localSchoolId], undefined, { includeTest: true }),
        // 素の fetch では 401 になる（この API は requireManager/requireAdmin を通るため）。
        // cookie だけに頼らず Authorization ヘッダーを付ける fetchWithAuth を使う
        // ＝このプロジェクトの管理API呼び出しの作法。
        fetchWithAuth(`/api/admin/portal-invitations?school_id=${localSchoolId}`),
      ]);
      setStudents(
        studentList.map((s) => ({ id: s.id, last_name: s.last_name, first_name: s.first_name }))
      );
      const invJson = await invRes.json();
      setInvitations(invRes.ok ? (invJson.invitations ?? []) : []);
    } catch (e) {
      console.error('[portal-accounts] データ取得に失敗:', e);
      toastError('データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [localSchoolId, toastError]);

  useEffect(() => {
    if (isAdmin) loadData();
  }, [isAdmin, loadData]);

  const handleIssue = async () => {
    if (!selectedStudentId) {
      toastError('生徒を選択してください');
      return;
    }
    setIssuing(true);
    setLastUrl('');
    try {
      const res = await fetchWithAuth('/api/admin/portal-invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: selectedStudentId, invite_type: inviteType }),
      });
      const json = await res.json();
      if (!res.ok) {
        toastError(json.error ?? '招待の発行に失敗しました');
        return;
      }
      setLastUrl(json.accept_url);
      success('招待を発行しました');
      loadData();
    } catch {
      toastError('通信に失敗しました');
    } finally {
      setIssuing(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      success('コピーしました');
    } catch {
      toastError('コピーに失敗しました');
    }
  };

  // 招待の状態ラベル。
  const statusOf = (inv: InvitationRow): { label: string; tone: string } => {
    if (inv.accepted_at) return { label: '受諾済み', tone: 'text-success' };
    if (new Date(inv.expires_at) < new Date()) return { label: '期限切れ', tone: 'text-danger' };
    return { label: '未受諾', tone: 'text-text-muted' };
  };

  if (authLoading) {
    return (
      <AdminLayout>
        <Loading />
      </AdminLayout>
    );
  }
  if (!isAdmin) {
    return (
      <AdminLayout>
        <AccessDenied message="このページはシステム管理者のみアクセス可能です" />
      </AdminLayout>
    );
  }

  return (
    <div>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <AdminLayout headerTitle="ポータルアカウント管理">
        <div className="mb-4">
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text-heading"
          >
            <ChevronLeft className="h-4 w-4" />
            設定に戻る
          </Link>
        </div>

        {/* 教室選択 */}
        <div className="mb-6">
          <label className="mb-1 block text-sm font-medium text-text-heading">教室</label>
          <select
            value={localSchoolId}
            onChange={(e) => setLocalSchoolId(e.target.value)}
            className="w-full max-w-xs rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text-body"
          >
            <option value="all">教室を選択</option>
            {availableSchools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {/* 招待発行 */}
        <div className="mb-6 rounded-xl border border-border bg-surface-raised p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-text-heading">
            <Ticket className="h-5 w-5" />
            招待を発行
          </h2>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-text-heading">生徒</label>
              <select
                value={selectedStudentId}
                onChange={(e) => setSelectedStudentId(e.target.value)}
                disabled={loading || students.length === 0}
                className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text-body disabled:opacity-50"
              >
                <option value="">生徒を選択</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.last_name} {s.first_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-text-heading">招待タイプ</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setInviteType('guardian')}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    inviteType === 'guardian'
                      ? 'border-ink bg-ink/10 font-medium text-text-heading'
                      : 'border-border text-text-muted hover:bg-surface-hover'
                  }`}
                >
                  保護者
                </button>
                <button
                  type="button"
                  onClick={() => setInviteType('student')}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    inviteType === 'student'
                      ? 'border-ink bg-ink/10 font-medium text-text-heading'
                      : 'border-border text-text-muted hover:bg-surface-hover'
                  }`}
                >
                  生徒本人
                </button>
              </div>
            </div>

            <Button onClick={handleIssue} isLoading={issuing} disabled={!selectedStudentId}>
              招待を発行して受諾URLを作成
            </Button>

            {lastUrl && (
              <div className="rounded-lg border border-info bg-info/10 p-3">
                <p className="mb-2 text-xs font-medium text-text-heading">
                  受諾URL（保護者・生徒に共有してください。有効期限7日）
                </p>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={lastUrl}
                    className="flex-1 rounded-lg border border-border bg-surface-hover px-3 py-2 text-xs text-text-body"
                  />
                  <Button variant="outline" onClick={() => copy(lastUrl)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 発行済み一覧 */}
        <div className="rounded-xl border border-border bg-surface-raised p-6">
          <h2 className="mb-4 text-lg font-bold text-text-heading">発行済みの招待</h2>
          {loading ? (
            <Loading size="md" />
          ) : invitations.length === 0 ? (
            <p className="text-sm text-text-muted">この教室で発行済みの招待はありません。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-text-muted">
                    <th className="px-2 py-2 font-medium">生徒</th>
                    <th className="px-2 py-2 font-medium">タイプ</th>
                    <th className="px-2 py-2 font-medium">状態</th>
                    <th className="px-2 py-2 font-medium">期限</th>
                    <th className="px-2 py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((inv) => {
                    const st = statusOf(inv);
                    const pending = !inv.accepted_at && new Date(inv.expires_at) >= new Date();
                    const url =
                      typeof window !== 'undefined'
                        ? `${window.location.origin}/mypage/invite/${inv.token}`
                        : '';
                    return (
                      <tr key={inv.id} className="border-b border-border-subtle">
                        <td className="px-2 py-2 text-text-body">
                          {inv.students
                            ? `${inv.students.last_name} ${inv.students.first_name}`
                            : '—'}
                        </td>
                        <td className="px-2 py-2 text-text-body">
                          {inv.invite_type === 'guardian' ? '保護者' : '生徒本人'}
                        </td>
                        <td className={`px-2 py-2 font-medium ${st.tone}`}>{st.label}</td>
                        <td className="px-2 py-2 text-text-muted">
                          {new Date(inv.expires_at).toLocaleDateString('ja-JP')}
                        </td>
                        <td className="px-2 py-2">
                          {pending && (
                            <button
                              type="button"
                              onClick={() => copy(url)}
                              className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-heading"
                            >
                              <Copy className="h-3.5 w-3.5" />
                              URLコピー
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </AdminLayout>
    </div>
  );
}
