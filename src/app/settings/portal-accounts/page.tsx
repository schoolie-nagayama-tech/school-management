'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  Copy,
  Ticket,
  Users,
  Link2Off,
  Trash2,
  Smartphone,
  KeyRound,
} from 'lucide-react';
import { AdminLayout } from '@/components/layouts';
import { Button, Loading, ToastContainer } from '@/components/ui';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { useLocalSchoolId } from '@/hooks/useLocalSchoolId';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
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

/** 登録済みポータルアカウント1件（GET /api/admin/portal-accounts の返り）。 */
interface PortalAccountRow {
  id: string;
  display_name: string;
  login_id: string | null;
  has_line: boolean;
  last_login_at: string | null;
  students: { student_id: string; student_name: string; relation: string }[];
}

/** relation コードを日本語ラベルに変換する。 */
function relationLabel(relation: string): string {
  switch (relation) {
    case 'self':
      return '本人';
    case 'father':
      return '父';
    case 'mother':
      return '母';
    default:
      return 'その他';
  }
}

export default function PortalAccountsPage() {
  const { profile, isLoading: authLoading } = useAuth();
  const { localSchoolId, availableSchools, setLocalSchoolId } = useLocalSchoolId();
  const { toasts, removeToast, success, error: toastError } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const [students, setStudents] = useState<StudentLite[]>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [inviteType, setInviteType] = useState<'guardian' | 'student'>('guardian');
  const [loading, setLoading] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [lastUrl, setLastUrl] = useState('');

  // 登録済みアカウントは教室スコープを持たない（アカウントは教室に属さないため）ので、
  // 招待一覧（教室別）とは別に全件をまとめて読む。
  const [accounts, setAccounts] = useState<PortalAccountRow[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);

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

  // 登録済みアカウント一覧を読み込む（教室に依存しない全件）。
  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const res = await fetchWithAuth('/api/admin/portal-accounts');
      const json = await res.json();
      setAccounts(res.ok ? (json.accounts ?? []) : []);
      if (!res.ok) toastError(json.error ?? 'アカウント一覧の取得に失敗しました');
    } catch (e) {
      console.error('[portal-accounts] アカウント取得に失敗:', e);
      toastError('アカウント一覧の取得に失敗しました');
    } finally {
      setAccountsLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    if (isAdmin) loadAccounts();
  }, [isAdmin, loadAccounts]);

  // 紐づけ1件だけ解除する（アカウントは残る）。誤操作防止に確認ダイアログ必須。
  const handleUnlink = async (
    account: PortalAccountRow,
    student: { student_id: string; student_name: string }
  ) => {
    const ok = await confirm({
      title: '紐づけを解除',
      description: `${student.student_name} さんとの紐づけを解除しますか？（このアカウントは ${student.student_name} さんの情報を見られなくなります）`,
      confirmLabel: '解除する',
      variant: 'warning',
    });
    if (!ok) return;
    try {
      const res = await fetchWithAuth('/api/admin/portal-accounts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: account.id, student_id: student.student_id }),
      });
      const json = await res.json();
      if (!res.ok) {
        toastError(json.error ?? '解除に失敗しました');
        return;
      }
      success('紐づけを解除しました');
      loadAccounts();
    } catch {
      toastError('通信に失敗しました');
    }
  };

  // アカウントごと削除する（紐づけ・同意ログも cascade で消える）。確認ダイアログ必須。
  const handleDeleteAccount = async (account: PortalAccountRow) => {
    const ok = await confirm({
      title: 'アカウントを削除',
      description: `${account.display_name} のアカウントを削除しますか？ログインできなくなり、紐づけもすべて解除されます。`,
      confirmLabel: '削除する',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const res = await fetchWithAuth('/api/admin/portal-accounts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: account.id }),
      });
      const json = await res.json();
      if (!res.ok) {
        toastError(json.error ?? '削除に失敗しました');
        return;
      }
      success('アカウントを削除しました');
      loadAccounts();
    } catch {
      toastError('通信に失敗しました');
    }
  };

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

        {/* 登録済みアカウント（紐づけ解除・アカウント削除） */}
        <div className="mt-6 rounded-xl border border-border bg-surface-raised p-6">
          <h2 className="mb-1 flex items-center gap-2 text-lg font-bold text-text-heading">
            <Users className="h-5 w-5" />
            登録済みのアカウント
          </h2>
          <p className="mb-4 text-xs text-text-muted">
            受諾済みの保護者・生徒アカウントです。誤って紐づけた・作り直したいときは、生徒ごとに紐づけを解除するか、アカウントごと削除できます。
          </p>
          {accountsLoading ? (
            <Loading size="md" />
          ) : accounts.length === 0 ? (
            <p className="text-sm text-text-muted">登録済みのアカウントはありません。</p>
          ) : (
            <div className="space-y-3">
              {accounts.map((acc) => (
                <div key={acc.id} className="rounded-lg border border-border bg-surface p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-text-heading">{acc.display_name}</span>
                        {/* ログイン手段のバッジ。LINE連携があれば優先表示、なければ発行ID。 */}
                        {acc.has_line ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                            <Smartphone className="h-3 w-3" />
                            LINE連携
                          </span>
                        ) : acc.login_id ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-info/10 px-2 py-0.5 text-xs font-medium text-info">
                            <KeyRound className="h-3 w-3" />
                            ID: {acc.login_id}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-text-muted">
                        最終ログイン:{' '}
                        {acc.last_login_at
                          ? new Date(acc.last_login_at).toLocaleString('ja-JP')
                          : '未ログイン'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteAccount(acc)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-danger px-2.5 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      アカウント削除
                    </button>
                  </div>

                  {/* 紐づけ生徒。各行に続柄と解除ボタン。 */}
                  <div className="mt-3 border-t border-border-subtle pt-3">
                    {acc.students.length === 0 ? (
                      <p className="text-xs text-text-muted">紐づけられている生徒はいません。</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {acc.students.map((st) => (
                          <li
                            key={st.student_id}
                            className="flex items-center justify-between gap-2 text-sm"
                          >
                            <span className="text-text-body">
                              {st.student_name}
                              <span className="ml-1 text-xs text-text-muted">
                                （{relationLabel(st.relation)}）
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() => handleUnlink(acc, st)}
                              className="inline-flex shrink-0 items-center gap-1 text-xs text-text-muted transition-colors hover:text-danger"
                            >
                              <Link2Off className="h-3.5 w-3.5" />
                              解除
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </AdminLayout>
      {ConfirmDialog}
    </div>
  );
}
