'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { useAuth } from '@/contexts/AuthContext';
import { updateUserProfile, fetchWithAuth } from '@/lib/api/auth';
import { impersonateUser } from '@/lib/impersonate';
import { createSchool, updateSchool, deleteSchool } from '@/lib/api/schools';
import { useMasterData } from '@/contexts/MasterDataContext';
import { useToast } from '@/hooks/useToast';
import { ToastContainer } from '@/components/ui';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui';
import { Button } from '@/components/ui';
import { Trash2, LogIn } from 'lucide-react';
import type { School, UserRole, UserProfile } from '@/types/database';
import { USER_ROLE_LABELS, USER_ROLE_LEVELS } from '@/types/database';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { UserEditModal } from '@/components/users/UserEditModal';
import { SchoolFormModal } from '@/components/users/SchoolFormModal';
import { UserCreateDialogs } from '@/components/users/UserCreateDialogs';

type TabType = 'users' | 'schools';

interface UserWithDetails extends UserProfile {
  user_schools?: Array<{
    id: string;
    user_id: string;
    school_id: string;
    school?: {
      id: string;
      name: string;
      code: string | null;
    };
  }>;
}

export default function UsersPage() {
  const { user, profile, permissions, isLoading: authLoading, schoolIds: mySchoolIds } = useAuth();
  const { schools: masterSchools, refreshSchools } = useMasterData();
  const { toasts, removeToast, success, error: toastError } = useToast();
  const [activeTab, setActiveTab] = useState<TabType>('users');
  const [users, setUsers] = useState<UserWithDetails[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const roleLower = String(profile?.role ?? '').toLowerCase();
  const isManager = roleLower === 'manager';
  const isOwner = roleLower === 'owner';
  const isAdmin = roleLower === 'admin';

  // 編集可能か：自分より権限が下、もしくは自分の情報
  const canEditUser = (targetUser: UserWithDetails): boolean => {
    if (!profile?.role) return false;
    if (targetUser.id === profile.id) return true; // 自分の情報
    const myLevel = USER_ROLE_LEVELS[profile.role as UserRole] ?? 0;
    const targetLevel = USER_ROLE_LEVELS[targetUser.role as UserRole] ?? 0;
    return targetLevel < myLevel; // 自分より権限が下
  };

  // ユーザー作成フォーム
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isResultDialogOpen, setIsResultDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [createdUser, setCreatedUser] = useState<{
    email: string;
    password: string;
    displayName: string;
  } | null>(null);

  // 教室作成モーダル
  const [showSchoolForm, setShowSchoolForm] = useState(false);

  // 編集モーダル
  const [editingUser, setEditingUser] = useState<UserWithDetails | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // 削除確認
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingUser, setDeletingUser] = useState<UserWithDetails | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // 教室管理
  const [editingSchool, setEditingSchool] = useState<School | null>(null);
  const [schoolName, setSchoolName] = useState('');
  const [schoolCode, setSchoolCode] = useState('');
  const [notificationEmail, setNotificationEmail] = useState('');
  const [isSavingSchool, setIsSavingSchool] = useState(false);
  const [schoolToDelete, setSchoolToDelete] = useState<School | null>(null);
  const [isDeletingSchool, setIsDeletingSchool] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const usersResponse = await fetchWithAuth(`/api/admin/users?t=${Date.now()}`, { cache: 'no-store' } as RequestInit);

      if (!usersResponse.ok) {
        const errBody = await usersResponse.json().catch(() => ({}));
        const msg = errBody.details || errBody.error || 'データの取得に失敗しました';
        throw new Error(msg);
      }
      const usersData = await usersResponse.json();
      const list = Array.isArray(usersData?.users) ? usersData.users : [];
      const schoolsData = masterSchools;

      // 講師を除外（念のため）
      let filteredUsers = list.filter((user: UserWithDetails) =>
        String(user?.role ?? '').toLowerCase() !== 'teacher'
      );

      // 権限ごとに表示するユーザーを分ける
      if (isAdmin) {
        // システム管理者：全ユーザー表示
        // そのまま
      } else if (isOwner) {
        // エリアマネージャー：担当教室に紐づくユーザーのみ表示（自分の担当教室と共通の教室を持つユーザー）
        const myIds = Array.isArray(mySchoolIds) ? mySchoolIds : [];
        if (myIds.length > 0) {
          filteredUsers = filteredUsers.filter((user: UserWithDetails) => {
            const userSchoolIds = (user.user_schools || []).map((us: { school_id: string }) => us.school_id);
            return (
              userSchoolIds.length === 0 || // 未割当ユーザーも通す（新規登録ユーザーが消えないように）
              userSchoolIds.some((sid: string) => myIds.includes(sid))
            );
          });
        }
      } else if (isManager && profile?.id) {
        // 教室長：自分の情報のみ表示
        filteredUsers = filteredUsers.filter((user: UserWithDetails) => user.id === profile.id);
      }

      setUsers(filteredUsers);
      setSchools(schoolsData);
    } catch (err) {
      console.error('Error loading data:', err);
      toastError(getUserErrorMessage(err, 'データの取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [toastError, isAdmin, isOwner, isManager, mySchoolIds, profile?.id, masterSchools]);

  // データ取得（認証完了後および権限が決まったあとで実行）
  useEffect(() => {
    if (authLoading) return;
    loadData();
  }, [authLoading, profile?.role, profile?.id, loadData]);

  // ユーザー作成
  const handleCreate = async (formData: { email: string; displayName: string; password: string; role: UserRole; schoolId: string }) => {
    if (!formData.displayName || !formData.password || !formData.schoolId) {
      toastError('必須項目を入力してください');
      return;
    }

    if (formData.password.length < 4) {
      toastError('パスワードは4文字以上で入力してください');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetchWithAuth('/api/admin/users/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email || undefined,
          password: formData.password,
          displayName: formData.displayName,
          role: formData.role,
          schoolId: formData.schoolId,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'ユーザーの作成に失敗しました');
      }

      const createdUserData = result.user;
      if (!createdUserData?.id) {
        throw new Error('ユーザー情報の取得に失敗しました');
      }

      setCreatedUser({
        email: createdUserData.email || createdUserData.id || '',
        password: formData.password,
        displayName: formData.displayName,
      });
      setIsCreateDialogOpen(false);
      setIsResultDialogOpen(true);

      // 楽観的更新：API 戻り値で一覧に追加
      setUsers((prev) => [...prev, createdUserData as UserWithDetails]);
      success('ユーザーを作成しました');
    } catch (error: any) {
      console.error('Failed to create user:', error);
      toastError(error.message || 'ユーザーの作成に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  // コピー機能
  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
      success('コピーしました');
    } catch (_error) {
      toastError('コピーに失敗しました');
    }
  };

  // ユーザー編集を保存
  const handleSaveUser = async (displayName: string, role: UserRole, schoolIds: string[], defaultSchoolId: string) => {
    if (!editingUser) return;

    setIsSaving(true);
    try {
      const resolvedDefaultSchoolId = schoolIds.length > 0 && schoolIds.includes(defaultSchoolId)
        ? defaultSchoolId
        : null;

      const res = await fetchWithAuth(`/api/admin/users/${editingUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: displayName,
          role: role,
          default_school_id: resolvedDefaultSchoolId,
          school_ids: schoolIds,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = data.details || data.error || '更新に失敗しました';
        throw new Error(msg);
      }

      const data = await res.json().catch(() => ({}));
      const updatedUserSchools = Array.isArray(data?.user_schools) ? data.user_schools : undefined;

      const savedUserId = editingUser.id;
      const isEditingSelf = editingUser.id === profile?.id;

      // 楽観的更新
      const updatedUser: UserWithDetails = {
        ...editingUser,
        display_name: displayName,
        default_school_id: resolvedDefaultSchoolId,
        ...(isEditingSelf
          ? {}
          : {
              role: role,
              user_schools: updatedUserSchools ?? editingUser.user_schools ?? [],
            }),
      };

      setEditingUser(null);
      setUsers((prev) => prev.map((u) => (u.id === savedUserId ? updatedUser : u)));
      success('ユーザーを更新しました');
    } catch (err) {
      console.error('Error updating user:', err);
      toastError(getUserErrorMessage(err, 'ユーザーの更新に失敗しました'));
    } finally {
      setIsSaving(false);
    }
  };

  // ユーザー削除
  const handleDelete = async () => {
    if (!deletingUser || isDeleting) return;
    const userIdToDelete = deletingUser.id;
    setIsDeleting(true);

    try {
      const response = await fetchWithAuth(`/api/admin/users/${userIdToDelete}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        if (response.status === 404) {
          setUsers((prev) => prev.filter((u) => u.id !== userIdToDelete));
          success('ユーザーを削除しました');
          setIsDeleting(false);
          setIsDeleteDialogOpen(false);
          setDeletingUser(null);
          return;
        }
        let msg = '削除に失敗しました';
        try {
          const body = await response.json();
          if (body?.details) msg = body.details;
          else if (body?.error) msg = body.error;
        } catch (parseErr) {
          console.warn('Failed to parse error response:', parseErr);
        }
        throw new Error(msg);
      }

      setUsers((prev) => prev.filter((u) => u.id !== userIdToDelete));
      success('ユーザーを削除しました');
    } catch (error) {
      console.error('Failed to delete user:', error);
      toastError(getUserErrorMessage(error, '削除に失敗しました'));
    } finally {
      setIsDeleting(false);
      setIsDeleteDialogOpen(false);
      setDeletingUser(null);
    }
  };

  // ユーザー有効/無効切り替え
  const handleToggleActive = async (user: UserWithDetails) => {
    try {
      await updateUserProfile(user.id, { is_active: !user.is_active });
      await loadData();
      success('ユーザーの状態を更新しました');
    } catch (err) {
      console.error('Error toggling user:', err);
      toastError('ユーザーの更新に失敗しました');
    }
  };

  // 教室作成
  const handleCreateSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSchool(true);
    try {
      await createSchool({
        name: schoolName,
        code: schoolCode || null,
        notification_email: notificationEmail.trim() || null,
      });
      setSchoolName('');
      setSchoolCode('');
      setNotificationEmail('');
      setShowSchoolForm(false);
      await refreshSchools();
      await loadData();
      success('教室を作成しました');
    } catch (err: any) {
      console.error('Error creating school:', err);
      toastError(err.message || '教室の作成に失敗しました');
    } finally {
      setIsSavingSchool(false);
    }
  };

  // 教室編集モーダルを開く
  const openEditSchoolModal = (school: School) => {
    setEditingSchool(school);
    setSchoolName(school.name);
    setSchoolCode(school.code || '');
    setNotificationEmail(school.notification_email || '');
    setShowSchoolForm(true);
  };

  // 教室編集を保存
  const handleSaveSchool = async () => {
    if (!editingSchool) return;
    setIsSavingSchool(true);
    try {
      await updateSchool(editingSchool.id, {
        name: schoolName,
        code: schoolCode || null,
        notification_email: notificationEmail.trim() || null,
      });
      setEditingSchool(null);
      setSchoolName('');
      setSchoolCode('');
      setNotificationEmail('');
      setShowSchoolForm(false);
      await refreshSchools();
      await loadData();
      success('教室を更新しました');
    } catch (err: any) {
      console.error('Error updating school:', err);
      toastError(err.message || '教室の更新に失敗しました');
    } finally {
      setIsSavingSchool(false);
    }
  };

  // 教室削除（確認ポップアップを開く）
  const openDeleteSchoolDialog = (school: School) => {
    setSchoolToDelete(school);
  };

  // 教室削除の実行
  const handleConfirmDeleteSchool = async () => {
    if (!schoolToDelete) return;
    setIsDeletingSchool(true);
    try {
      await deleteSchool(schoolToDelete.id);
      await refreshSchools();
      await loadData();
      setSchoolToDelete(null);
      success('教室を削除しました');
    } catch (err: unknown) {
      console.error('Error deleting school:', err);
      toastError(getUserErrorMessage(err, '教室の削除に失敗しました'));
    } finally {
      setIsDeletingSchool(false);
    }
  };

  // デモフラグ切り替え
  const handleToggleDemo = async (school: School) => {
    try {
      await updateSchool(school.id, { is_demo: !school.is_demo });
      setSchools((prev) => prev.map((s) => s.id === school.id ? { ...s, is_demo: !school.is_demo } : s));
      success(school.is_demo ? 'デモフラグを解除しました' : 'デモ教室に設定しました');
    } catch (err: any) {
      toastError(err.message || 'デモフラグの更新に失敗しました');
    }
  };

  // 権限チェック（オーナー以上で教室設定タブにアクセス可能）
  const canAccessSchoolSettings = profile?.role === 'admin' || profile?.role === 'owner';

  // 未ログイン時は権限画面ではなくローディング（AuthContext がログインへリダイレクトするまでの間）
  if (!user || authLoading) {
    return (
      <AdminLayout headerTitle="ユーザー管理">
        <div className="p-6 flex items-center justify-center min-h-[40vh]">
          <div className="w-10 h-10 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin" />
        </div>
      </AdminLayout>
    );
  }
  if (!permissions?.canAccessUsers) {
    return (
      <AdminLayout>
        <div className="p-6">
          <div className="bg-[#ef4444]/10 border border-[#ef4444] rounded-lg p-4">
            <p className="text-[#ef4444]">このページにアクセスする権限がありません</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="ユーザー管理">
      <div className="flex flex-col h-[calc(100vh-6.5rem)] max-w-[1600px] mx-auto">
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <div className="flex items-center gap-4">
            <Link
              href="/students"
              className="flex items-center gap-2 text-[#1f2937] hover:text-[#3b82f6] transition-colors"
              title="ホームに戻る"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                />
              </svg>
            </Link>
            <h1 className="text-2xl font-bold text-[#1f2937]">ユーザー管理</h1>
          </div>
          {activeTab === 'users' && !isManager && (
            <Button onClick={() => setIsCreateDialogOpen(true)}>
              + ユーザーを追加
            </Button>
          )}
          {activeTab === 'schools' && canAccessSchoolSettings && (
            <Button
              onClick={() => {
                setEditingSchool(null);
                setSchoolName('');
                setSchoolCode('');
                setNotificationEmail('');
                setShowSchoolForm(true);
              }}
            >
              + 教室を追加
            </Button>
          )}
        </div>

        {/* タブ */}
        <div className="flex gap-2 mb-4 border-b border-[#e5e7eb]/20 flex-shrink-0">
          <button
            onClick={() => setActiveTab('users')}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === 'users'
                ? 'text-[#1f2937] border-b-2 border-[#3b82f6]'
                : 'text-[#4b5563] hover:text-[#1f2937]'
            }`}
          >
            ユーザー管理
          </button>
          {canAccessSchoolSettings && (
            <button
              onClick={() => setActiveTab('schools')}
              className={`px-4 py-2 font-medium transition-colors ${
                activeTab === 'schools'
                  ? 'text-[#1f2937] border-b-2 border-[#3b82f6]'
                  : 'text-[#4b5563] hover:text-[#1f2937]'
              }`}
            >
              教室設定
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-[#4b5563]">読み込み中...</p>
            </div>
          </div>
        ) : activeTab === 'users' ? (
          <div className="flex-1 min-h-0 flex flex-col">
            {/* ユーザー一覧 */}
            <div className="bg-white rounded-xl border border-[#e5e7eb] flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="p-3 bg-[#f3f4f6] border-b border-[#e5e7eb] flex-shrink-0">
                <h2 className="font-bold text-[#1f2937]">登録済みユーザー ({users.length})</h2>
              </div>
              <div className="flex-1 min-h-0 overflow-auto">
                <table className="w-full table-fixed">
                  <colgroup>
                    <col style={{ width: '11%' }} />
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '11%' }} />
                    <col style={{ width: '22%' }} />
                    <col style={{ width: '7%' }} />
                    <col style={{ width: '10%' }} />
                    <col style={{ width: '23%' }} />
                  </colgroup>
                  <thead className="bg-[#f3f4f6] border-b border-[#e5e7eb]">
                    <tr>
                      <th className="px-3 py-2 text-left text-sm font-bold text-[#1f2937] truncate">名前</th>
                      <th className="px-3 py-2 text-left text-sm font-bold text-[#1f2937] truncate">メール</th>
                      <th className="px-3 py-2 text-left text-sm font-bold text-[#1f2937] truncate">権限</th>
                      <th className="px-3 py-2 text-left text-sm font-bold text-[#1f2937]">担当教室</th>
                      <th className="px-3 py-2 text-left text-sm font-bold text-[#1f2937] truncate">状態</th>
                      <th className="px-3 py-2 text-left text-sm font-bold text-[#1f2937] truncate">最終ログイン</th>
                      <th className="px-3 py-2 text-right text-sm font-bold text-[#1f2937] truncate">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e5e7eb]/10">
                    {users.map(user => (
                      <tr key={user.id} className="hover:bg-[#f3f4f6]/50">
                        <td className="px-3 py-2 text-sm text-[#1f2937] truncate" title={user.display_name || '-'}>
                          {user.display_name || '-'}
                        </td>
                        <td className="px-3 py-2 text-sm text-[#4b5563] truncate" title={user.email}>{user.email}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="inline-block px-2 py-1 text-xs font-bold bg-[#3b82f6]/20 text-[#1f2937] rounded">
                            {USER_ROLE_LABELS[user.role as UserRole] ?? '未設定'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-sm text-[#4b5563] align-top break-words">
                          {user.user_schools && user.user_schools.length > 0 ? (
                            <div className="flex flex-wrap gap-1 break-words">
                              {user.user_schools.map((us, idx) => {
                                const profileWithDefault = user as UserWithDetails & { default_school_id?: string | null };
                                const isDefault = profileWithDefault.default_school_id === us.school_id;
                                return (
                                  <span
                                    key={us.id || `${us.user_id}-${us.school_id}-${idx}`}
                                    className={`inline-flex items-center shrink-0 px-2 py-0.5 text-xs rounded whitespace-nowrap ${isDefault ? 'bg-blue-100 text-blue-800 font-medium' : 'bg-[#f3f4f6] text-[#4b5563]'}`}
                                  >
                                    {us.school?.name || '不明'}
                                  </span>
                                );
                              })}
                            </div>
                          ) : (
                            <span className="text-[#4b5563]/50">なし</span>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {user.is_active ? (
                            <span className="inline-block px-2 py-1 text-xs font-bold bg-green-100 text-green-700 rounded">
                              有効
                            </span>
                          ) : (
                            <span className="inline-block px-2 py-1 text-xs font-bold bg-gray-100 text-gray-700 rounded">
                              無効
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-sm text-[#4b5563] whitespace-nowrap">
                          {user.last_login_at ? new Date(user.last_login_at).toLocaleDateString('ja-JP') : '-'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            {canEditUser(user) && (
                              <>
                                <Button
                                  variant="ghost"
                                  onClick={() => setEditingUser(user)}
                                  className="px-2 py-1 text-xs"
                                >
                                  編集
                                </Button>
                                <Button
                                  variant="ghost"
                                  onClick={() => handleToggleActive(user)}
                                  className="px-2 py-1 text-xs"
                                >
                                  {user.is_active ? '無効化' : '有効化'}
                                </Button>
                                {isAdmin && user.id !== profile?.id && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      if (!confirm(`${user.display_name || user.email}としてログインしますか？\n（元のアカウントにはバナーから戻れます）`)) return;
                                      try {
                                        await impersonateUser(user.id);
                                      } catch (e) {
                                        toastError((e as Error).message);
                                      }
                                    }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:border-amber-400 transition-colors cursor-pointer"
                                    title="このユーザーとしてログイン"
                                  >
                                    <LogIn className="h-3 w-3" />
                                    ログイン
                                  </button>
                                )}
                                {user.id !== profile?.id && (
                                  <Button
                                    variant="ghost"
                                    onClick={() => {
                                      setDeletingUser(user);
                                      setIsDeleteDialogOpen(true);
                                    }}
                                    className="p-2 text-[#ef4444] hover:text-[#ef4444]"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : canAccessSchoolSettings ? (
          <div className="flex-1 min-h-0 flex flex-col">
            {/* 教室一覧 */}
            <div className="bg-white rounded-xl border border-[#e5e7eb] flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="p-3 bg-[#f3f4f6] border-b border-[#e5e7eb] flex-shrink-0">
                <h2 className="font-bold text-[#1f2937]">教室一覧 ({schools.length})</h2>
              </div>
              <div className="flex-1 min-h-0 overflow-auto">
                <table className="w-full">
                  <thead className="bg-[#f3f4f6] border-b border-[#e5e7eb]">
                    <tr>
                      <th className="px-3 py-2 text-left text-sm font-bold text-[#1f2937]">教室名</th>
                      <th className="px-3 py-2 text-left text-sm font-bold text-[#1f2937]">コード</th>
                      <th className="px-3 py-2 text-center text-sm font-bold text-[#1f2937]">デモ</th>
                      <th className="px-3 py-2 text-right text-sm font-bold text-[#1f2937]">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e5e7eb]/10">
                    {schools.map(school => (
                      <tr key={school.id} className={`hover:bg-[#f3f4f6]/50 ${school.is_demo ? 'opacity-60' : ''}`}>
                        <td className="px-3 py-2 text-sm text-[#1f2937]">
                          <span>{school.name}</span>
                          {school.is_demo && (
                            <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-gray-200 text-gray-600 rounded">デモ</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-sm text-[#4b5563]">{school.code || '-'}</td>
                        <td className="px-3 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleToggleDemo(school)}
                            title={school.is_demo ? 'デモフラグを解除する' : 'デモ教室に設定する'}
                            className={`w-10 h-5 rounded-full transition-colors relative ${
                              school.is_demo ? 'bg-gray-400' : 'bg-gray-200'
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                                school.is_demo ? 'translate-x-5' : 'translate-x-0.5'
                              }`}
                            />
                          </button>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              onClick={() => openEditSchoolModal(school)}
                              className="p-2"
                            >
                              編集
                            </Button>
                            {school.code !== 'DEFAULT' && (
                              <Button
                                variant="ghost"
                                onClick={() => openDeleteSchoolDialog(school)}
                                className="p-2 text-[#ef4444] hover:text-[#ef4444]"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center p-6">
            <div className="bg-[#ef4444]/10 border border-[#ef4444] rounded-lg p-4">
              <p className="text-[#ef4444]">教室設定はオーナー権限以上のみアクセス可能です</p>
            </div>
          </div>
        )}

        <UserCreateDialogs
          isCreateDialogOpen={isCreateDialogOpen}
          onCreateDialogChange={setIsCreateDialogOpen}
          isResultDialogOpen={isResultDialogOpen}
          onResultDialogChange={setIsResultDialogOpen}
          schools={schools}
          onCreateUser={handleCreate}
          createdUser={createdUser}
          isSubmitting={isSubmitting}
          onCopy={handleCopy}
          copiedField={copiedField}
        />

        {/* 削除確認ダイアログ */}
        <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ユーザーを削除しますか？</AlertDialogTitle>
              <AlertDialogDescription>
                「{deletingUser?.display_name}」を削除します。この操作は取り消せません。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => { setIsDeleteDialogOpen(false); setDeletingUser(null); }}>キャンセル</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                disabled={isDeleting}
                className="bg-[#ef4444] text-white hover:bg-[#dc2626]"
              >
                {isDeleting ? '削除中...' : '削除'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* 教室削除確認 */}
        <AlertDialog open={!!schoolToDelete} onOpenChange={(open) => !open && setSchoolToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>教室を削除しますか？</AlertDialogTitle>
              <AlertDialogDescription>
                「{schoolToDelete?.name}」を削除します。この操作は取り消せません。
                生徒・フォーム回答・申込などが紐づいている場合は削除できません。空の教室のみ削除可能です。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setSchoolToDelete(null)}>
                キャンセル
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmDeleteSchool}
                disabled={isDeletingSchool}
                className="bg-[#ef4444] text-white hover:bg-[#dc2626]"
              >
                {isDeletingSchool ? '削除中...' : '削除する'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* 教室作成・編集モーダル */}
        {(showSchoolForm || editingSchool) && (
          <SchoolFormModal
            editingSchool={editingSchool}
            schoolName={schoolName}
            schoolCode={schoolCode}
            notificationEmail={notificationEmail}
            isSavingSchool={isSavingSchool}
            onSchoolNameChange={setSchoolName}
            onSchoolCodeChange={setSchoolCode}
            onNotificationEmailChange={setNotificationEmail}
            onSubmitCreate={handleCreateSchool}
            onSubmitEdit={handleSaveSchool}
            onClose={() => {
              setShowSchoolForm(false);
              setEditingSchool(null);
              setSchoolName('');
              setSchoolCode('');
              setNotificationEmail('');
            }}
          />
        )}

        {/* ユーザー編集モーダル */}
        {editingUser && (
          <UserEditModal
            editingUser={editingUser}
            profileId={profile?.id}
            schools={schools}
            isSaving={isSaving}
            onSave={handleSaveUser}
            onClose={() => setEditingUser(null)}
          />
        )}
      </div>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}
