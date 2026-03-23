'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { useAuth } from '@/contexts/AuthContext';
import { updateUserProfile, fetchWithAuth } from '@/lib/api/auth';
import { getSchools, createSchool, updateSchool, deleteSchool } from '@/lib/api/schools';
import { useToast } from '@/hooks/useToast';
import { ToastContainer } from '@/components/ui';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui';
import { Button } from '@/components/ui';
import { Input } from '@/components/ui';
import { Label } from '@/components/ui';
import { SelectShadcn as Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui';
import { Copy, Check, Eye, EyeOff, Trash2 } from 'lucide-react';
import type { School, UserRole, UserProfile } from '@/types/database';
import { USER_ROLE_LABELS, USER_ROLE_LEVELS } from '@/types/database';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

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
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    displayName: '',
    password: '',
    role: 'manager' as UserRole,
    schoolId: '',
  });
  const [createdUser, setCreatedUser] = useState<{
    email: string;
    password: string;
    displayName: string;
  } | null>(null);

  // 教室作成モーダル
  const [showSchoolForm, setShowSchoolForm] = useState(false);
  
  // 編集モーダル
  const [editingUser, setEditingUser] = useState<UserWithDetails | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('manager');
  const [editSchoolIds, setEditSchoolIds] = useState<string[]>([]);
  const [editDefaultSchoolId, setEditDefaultSchoolId] = useState<string>('');
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
      const [usersResponse, schoolsData] = await Promise.all([
        fetchWithAuth(`/api/admin/users?t=${Date.now()}`, { cache: 'no-store' } as RequestInit),
        getSchools(),
      ]);
      
      if (!usersResponse.ok) {
        const errBody = await usersResponse.json().catch(() => ({}));
        const msg = errBody.details || errBody.error || 'データの取得に失敗しました';
        throw new Error(msg);
      }
      const usersData = await usersResponse.json();
      const list = Array.isArray(usersData?.users) ? usersData.users : [];
      
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
      if (schoolsData.length > 0 && !formData.schoolId) {
        setFormData(prev => ({ ...prev, schoolId: schoolsData[0].id }));
      }
    } catch (err) {
      console.error('Error loading data:', err);
      toastError(getUserErrorMessage(err, 'データの取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [toastError, isAdmin, isOwner, mySchoolIds, profile?.id]);

  // データ取得（認証完了後および権限が決まったあとで実行）
  useEffect(() => {
    if (authLoading) return;
    loadData();
  }, [authLoading, profile?.role, profile?.id, loadData]);

  // ユーザー作成
  const handleCreate = async () => {
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
          email: formData.email || undefined, // 未入力の場合は自動生成
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

      const createdUser = result.user;
      if (!createdUser?.id) {
        throw new Error('ユーザー情報の取得に失敗しました');
      }

      setCreatedUser({
        email: createdUser.email || createdUser.id || '',
        password: formData.password,
        displayName: formData.displayName,
      });
      setIsCreateDialogOpen(false);
      setIsResultDialogOpen(true);
      setFormData({
        email: '',
        displayName: '',
        password: '',
        role: 'manager',
        schoolId: schools[0]?.id || '',
      });

      // 楽観的更新：API 戻り値で一覧に追加（loadData で上書きしない）
      setUsers((prev) => [...prev, createdUser as UserWithDetails]);
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

  // ユーザー編集モーダルを開く（講師以外のロールのみ選択可能）
  const openEditModal = (user: UserWithDetails) => {
    setEditingUser(user);
    setEditDisplayName(user.display_name || '');
    setEditRole(user.role === 'teacher' ? 'manager' : (user.role || 'manager'));
    const ids = user.user_schools?.map(us => us.school_id) || [];
    setEditSchoolIds(ids);
    const profileWithDefault = user as UserWithDetails & { default_school_id?: string | null };
    const defaultId = profileWithDefault.default_school_id && ids.includes(profileWithDefault.default_school_id)
      ? profileWithDefault.default_school_id
      : ids[0] || '';
    setEditDefaultSchoolId(defaultId);
  };

  // ユーザー編集を保存（API 経由でサービスロールで保存し、RLS の影響を受けないようにする）
  const handleSaveUser = async () => {
    if (!editingUser) return;

    setIsSaving(true);
    try {
      const defaultSchoolId = editSchoolIds.length > 0 && editSchoolIds.includes(editDefaultSchoolId)
        ? editDefaultSchoolId
        : null;

      const res = await fetchWithAuth(`/api/admin/users/${editingUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: editDisplayName,
          role: editRole,
          default_school_id: defaultSchoolId,
          school_ids: editSchoolIds,
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

      // 楽観的更新：DB 保存が成功しているので、一覧を即時反映（loadData で上書きしない）
      const updatedUser: UserWithDetails = {
        ...editingUser,
        display_name: editDisplayName,
        default_school_id: defaultSchoolId,
        ...(isEditingSelf
          ? {}
          : {
              role: editRole,
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
        // 404 = 既に削除済み → 一覧から除外して成功扱い
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

      // 楽観的更新：一覧から即時削除（loadData は呼ばない＝古いキャッシュで上書きされない）
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
      <div className="flex flex-col h-[calc(100vh-6.5rem)] max-w-7xl mx-auto">
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
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '20%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '25%' }} />
                    <col style={{ width: '8%' }} />
                    <col style={{ width: '11%' }} />
                    <col style={{ width: '12%' }} />
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
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            {/* 自分より権限が下、もしくは自分の情報のみ編集可能 */}
                            {canEditUser(user) && (
                              <>
                                <Button
                                  variant="ghost"
                                  onClick={() => openEditModal(user)}
                                  className="p-2"
                                >
                                  編集
                                </Button>
                                <Button
                                  variant="ghost"
                                  onClick={() => handleToggleActive(user)}
                                  className="p-2"
                                >
                                  {user.is_active ? '無効化' : '有効化'}
                                </Button>
                                {/* 削除は自分のアカウントではできない */}
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

        {/* ユーザー作成ダイアログ */}
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogHeader>
            <DialogTitle>ユーザーを追加</DialogTitle>
          </DialogHeader>
          <DialogContent>
            <div className="space-y-4">
              <div className="text-sm text-[#4b5563] mb-4">
                新しいユーザーアカウントを作成します。ユーザーID（メールアドレス）は未入力の場合、自動生成されます。
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">メールアドレス（ID）</Label>
                <Input
                  id="email"
                  type="text"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  placeholder="未入力の場合は自動生成されます"
                />
                <p className="text-xs text-[#4b5563]/70">ログイン時に使用するIDです。未入力の場合は自動生成されます。</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="displayName">表示名 *</Label>
                <Input
                  id="displayName"
                  value={formData.displayName}
                  onChange={(e) =>
                    setFormData({ ...formData, displayName: e.target.value })
                  }
                  placeholder="山田 太郎"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">パスワード *</Label>
                <Input
                  id="password"
                  type="password"
                  value={formData.password}
                  onChange={(e) =>
                    setFormData({ ...formData, password: e.target.value })
                  }
                  placeholder="4文字以上"
                />
                <p className="text-xs text-[#4b5563]/70">パスワードは4文字以上で入力してください</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">権限 *</Label>
                <Select
                  value={formData.role}
                  onValueChange={(value) =>
                    setFormData({ ...formData, role: value as UserRole })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">システム管理者</SelectItem>
                    <SelectItem value="owner">エリアマネージャー</SelectItem>
                    <SelectItem value="manager">教室長</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="school">所属教室 *</Label>
                <Select
                  value={formData.schoolId}
                  onValueChange={(value) =>
                    setFormData({ ...formData, schoolId: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="教室を選択（登録済みから選択）" />
                  </SelectTrigger>
                  <SelectContent>
                    {schools.map((school) => (
                      <SelectItem key={school.id} value={school.id}>
                        {school.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-[#4b5563]/70">複数教室の権限は作成後に編集で設定できます。登録済みの教室から選択してください。</p>
              </div>
            </div>
          </DialogContent>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setIsCreateDialogOpen(false)}
            >
              キャンセル
            </Button>
            <Button onClick={handleCreate} disabled={isSubmitting}>
              {isSubmitting ? '作成中...' : '作成'}
            </Button>
          </DialogFooter>
        </Dialog>

        {/* 作成完了ダイアログ */}
        <Dialog
          open={isResultDialogOpen}
          onOpenChange={setIsResultDialogOpen}
        >
          <DialogHeader>
            <DialogTitle>ユーザーを作成しました</DialogTitle>
          </DialogHeader>
          <DialogContent>
            <div className="space-y-4">
              <div className="text-sm text-[#4b5563] mb-4">
                以下の情報をユーザーに伝えてください。パスワードは後から確認できません。
              </div>
              {createdUser && (
                <>
                  <div className="space-y-2">
                    <Label>表示名</Label>
                    <Input value={createdUser.displayName} readOnly />
                  </div>
                  <div className="space-y-2">
                    <Label>メールアドレス（ID）</Label>
                    <div className="flex items-center gap-2">
                      <Input value={createdUser.email} readOnly className="flex-1" />
                      <Button
                        variant="ghost"
                        onClick={() => handleCopy(createdUser.email, 'email')}
                        className="p-2"
                      >
                        {copiedField === 'email' ? (
                          <Check className="h-4 w-4 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>仮パスワード</Label>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Input
                          type={showPassword ? 'text' : 'password'}
                          value={createdUser.password}
                          readOnly
                        />
                        <Button
                          variant="ghost"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-0 top-0 h-full p-2"
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      <Button
                        variant="ghost"
                        onClick={() => handleCopy(createdUser.password, 'password')}
                        className="p-2"
                      >
                        {copiedField === 'password' ? (
                          <Check className="h-4 w-4 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
                    <p className="text-sm text-yellow-800">
                      ⚠️ パスワードはこの画面を閉じると再表示できません。必ずメモしてください。
                    </p>
                  </div>
                </>
              )}
            </div>
          </DialogContent>
          <DialogFooter>
            <Button onClick={() => setIsResultDialogOpen(false)}>
              閉じる
            </Button>
          </DialogFooter>
        </Dialog>

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
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl border border-[#e5e7eb] p-6 max-w-md w-full">
              <h2 className="text-xl font-bold text-[#1f2937] mb-4">
                {editingSchool ? '教室を編集' : '教室を追加'}
              </h2>
              <form
                onSubmit={editingSchool ? (e) => { e.preventDefault(); handleSaveSchool(); } : handleCreateSchool}
                className="space-y-4"
              >
                <div>
                  <label className="block text-sm font-medium text-[#1f2937] mb-1">
                    教室名
                  </label>
                  <input
                    type="text"
                    value={schoolName}
                    onChange={e => setSchoolName(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                    placeholder="例：長山教室"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#1f2937] mb-1">
                    教室コード（任意）
                  </label>
                  <input
                    type="text"
                    value={schoolCode}
                    onChange={e => setSchoolCode(e.target.value)}
                    className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                    placeholder="例：NAGAYAMA"
                  />
                  <p className="mt-1 text-xs text-[#4b5563]">ポータルURLで使用されます</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#1f2937] mb-1">
                    申込通知先メールアドレス（任意）
                  </label>
                  <input
                    type="email"
                    value={notificationEmail}
                    onChange={e => setNotificationEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                    placeholder="manager@example.com"
                  />
                  <p className="mt-1 text-xs text-[#4b5563]">フォームから申込があった際に通知を受け取るメールアドレスです</p>
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowSchoolForm(false);
                      setEditingSchool(null);
                      setSchoolName('');
                      setSchoolCode('');
                      setNotificationEmail('');
                    }}
                    className="flex-1 px-4 py-2 bg-[#f3f4f6] text-[#1f2937] rounded-lg hover:bg-[#e5e7eb] transition-colors"
                  >
                    キャンセル
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingSchool}
                    className="flex-1 px-4 py-2 bg-[#3b82f6] text-white font-bold rounded-lg hover:bg-[#60a5fa] transition-colors disabled:opacity-50"
                  >
                    {isSavingSchool ? '保存中...' : editingSchool ? '更新' : '作成'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ユーザー編集モーダル */}
        {editingUser && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl border border-[#e5e7eb] p-6 max-w-md w-full">
              <h2 className="text-xl font-bold text-[#1f2937] mb-4">
                {editingUser.id === profile?.id ? '自分の情報を編集' : 'ユーザー編集'}
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#1f2937] mb-1">
                    メールアドレス
                  </label>
                  <input
                    type="text"
                    value={editingUser.email}
                    disabled
                    className="w-full px-3 py-2 border border-[#e5e7eb]/30 rounded-lg bg-[#f3f4f6] text-[#4b5563]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#1f2937] mb-1">
                    表示名
                  </label>
                  <input
                    type="text"
                    value={editDisplayName}
                    onChange={e => setEditDisplayName(e.target.value)}
                    className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                    placeholder="山田 太郎"
                  />
                </div>
                {editingUser.id !== profile?.id && (
                <div>
                  <label className="block text-sm font-medium text-[#1f2937] mb-1">
                    権限
                  </label>
                  <select
                    value={editRole}
                    onChange={e => setEditRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                  >
                    {(Object.keys(USER_ROLE_LABELS) as UserRole[]).filter(role => role !== 'teacher').map(role => (
                      <option key={role} value={role}>
                        {USER_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </div>
                )}
                {editingUser.id !== profile?.id && (
                <div>
                  <label className="block text-sm font-medium text-[#1f2937] mb-1">
                    担当教室
                  </label>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {schools.map(school => (
                      <label key={school.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={editSchoolIds.includes(school.id)}
                          onChange={e => {
                            if (e.target.checked) {
                              setEditSchoolIds([...editSchoolIds, school.id]);
                            } else {
                              const next = editSchoolIds.filter(id => id !== school.id);
                              setEditSchoolIds(next);
                              if (editDefaultSchoolId === school.id) {
                                setEditDefaultSchoolId(next[0] || '');
                              }
                            }
                          }}
                          className="rounded border-[#e5e7eb]"
                        />
                        <span className="text-sm text-[#1f2937]">{school.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
                )}
                {editSchoolIds.length > 1 && (
                  <div>
                    <label className="block text-sm font-medium text-[#1f2937] mb-1">
                      デフォルトの教室
                    </label>
                    <p className="text-xs text-[#4b5563]/70 mb-2">複数教室のとき、ログイン時に最初に選択される教室です。</p>
                    <select
                      value={editDefaultSchoolId}
                      onChange={e => setEditDefaultSchoolId(e.target.value)}
                      className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                    >
                      {schools.filter(s => editSchoolIds.includes(s.id)).map(school => (
                        <option key={school.id} value={school.id}>
                          {school.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setEditingUser(null)}
                    className="flex-1 px-4 py-2 bg-[#f3f4f6] text-[#1f2937] rounded-lg hover:bg-[#e5e7eb] transition-colors"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={handleSaveUser}
                    disabled={isSaving}
                    className="flex-1 px-4 py-2 bg-[#3b82f6] text-white font-bold rounded-lg hover:bg-[#60a5fa] transition-colors disabled:opacity-50"
                  >
                    {isSaving ? '保存中...' : '保存'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}
