'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { useAuth } from '@/contexts/AuthContext';
import { 
  updateUserProfile,
  addUserToSchool,
  removeUserFromSchool,
} from '@/lib/api/auth';
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
import type { School, UserRole, UserProfile, UserSchool } from '@/types/database';
import { USER_ROLE_LABELS } from '@/types/database';

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
  const { profile, permissions } = useAuth();
  const { toasts, removeToast, success, error: toastError } = useToast();
  const [activeTab, setActiveTab] = useState<TabType>('users');
  const [users, setUsers] = useState<UserWithDetails[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // 教室長かどうかを判定
  const isManager = profile?.role === 'manager';
  
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
  const [isSaving, setIsSaving] = useState(false);

  // 削除確認
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingUser, setDeletingUser] = useState<UserWithDetails | null>(null);

  // 教室管理
  const [editingSchool, setEditingSchool] = useState<School | null>(null);
  const [schoolName, setSchoolName] = useState('');
  const [schoolCode, setSchoolCode] = useState('');
  const [notificationEmail, setNotificationEmail] = useState('');
  const [isSavingSchool, setIsSavingSchool] = useState(false);

  // データ取得
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [usersResponse, schoolsData] = await Promise.all([
        fetch('/api/admin/users?role=admin,owner,manager'), // 講師を除外
        getSchools(),
      ]);
      
      if (!usersResponse.ok) throw new Error('Failed to fetch users');
      const usersData = await usersResponse.json();
      
      // 講師を除外（念のため）
      let filteredUsers = (usersData.users || []).filter((user: UserWithDetails) => 
        user.role !== 'teacher'
      );
      
      // 教室長の場合は自分の情報のみ表示
      if (isManager && profile?.id) {
        filteredUsers = filteredUsers.filter((user: UserWithDetails) => user.id === profile.id);
      }
      
      setUsers(filteredUsers);
      setSchools(schoolsData);
      if (schoolsData.length > 0 && !formData.schoolId) {
        setFormData(prev => ({ ...prev, schoolId: schoolsData[0].id }));
      }
    } catch (err) {
      console.error('Error loading data:', err);
      toastError('データの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

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
      const response = await fetch('/api/admin/users/create', {
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

      setCreatedUser({
        email: result.user?.email || result.user?.id || '',
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
      await loadData();
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
    } catch (error) {
      toastError('コピーに失敗しました');
    }
  };

  // ユーザー編集モーダルを開く
  const openEditModal = (user: UserWithDetails) => {
    setEditingUser(user);
    setEditDisplayName(user.display_name || '');
    setEditRole(user.role);
    setEditSchoolIds(user.user_schools?.map(us => us.school_id) || []);
  };

  // ユーザー編集を保存
  const handleSaveUser = async () => {
    if (!editingUser) return;

    setIsSaving(true);
    try {
      await updateUserProfile(editingUser.id, { role: editRole, display_name: editDisplayName });

      const currentSchoolIds = editingUser.user_schools?.map(us => us.school_id) || [];
      const toAdd = editSchoolIds.filter(id => !currentSchoolIds.includes(id));
      const toRemove = currentSchoolIds.filter(id => !editSchoolIds.includes(id));

      for (const schoolId of toAdd) {
        await addUserToSchool(editingUser.id, schoolId);
      }
      for (const schoolId of toRemove) {
        await removeUserFromSchool(editingUser.id, schoolId);
      }

      setEditingUser(null);
      await loadData();
      success('ユーザーを更新しました');
    } catch (err) {
      console.error('Error updating user:', err);
      toastError('ユーザーの更新に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  // ユーザー削除
  const handleDelete = async () => {
    if (!deletingUser) return;

    try {
      const response = await fetch(`/api/admin/users/${deletingUser.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('削除に失敗しました');
      }

      success('ユーザーを削除しました');
      setIsDeleteDialogOpen(false);
      setDeletingUser(null);
      await loadData();
    } catch (error) {
      console.error('Failed to delete user:', error);
      toastError('削除に失敗しました');
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

  // 教室削除
  const handleDeleteSchool = async (id: string) => {
    if (!confirm('この教室を削除しますか？関連するデータも削除される可能性があります。')) return;
    try {
      await deleteSchool(id);
      await loadData();
      success('教室を削除しました');
    } catch (err: any) {
      console.error('Error deleting school:', err);
      toastError(err.message || '教室の削除に失敗しました');
    }
  };

  // 権限チェック（オーナー以上で教室設定タブにアクセス可能）
  const canAccessSchoolSettings = profile?.role === 'admin' || profile?.role === 'owner';
  
  if (!permissions?.canAccessUsers) {
    return (
      <AdminLayout>
        <div className="p-6">
          <div className="bg-[#d9376e]/10 border border-[#d9376e] rounded-lg p-4">
            <p className="text-[#d9376e]">このページにアクセスする権限がありません</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="ユーザー管理">
      <div className="p-6 max-w-7xl mx-auto">
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link
              href="/students"
              className="flex items-center gap-2 text-[#0d0d0d] hover:text-[#ff8e3c] transition-colors"
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
            <h1 className="text-2xl font-bold text-[#0d0d0d]">ユーザー管理</h1>
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
        <div className="flex gap-2 mb-6 border-b border-[#0d0d0d]/20">
          <button
            onClick={() => setActiveTab('users')}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === 'users'
                ? 'text-[#0d0d0d] border-b-2 border-[#ff8e3c]'
                : 'text-[#2a2a2a] hover:text-[#0d0d0d]'
            }`}
          >
            ユーザー管理
          </button>
          {canAccessSchoolSettings && (
            <button
              onClick={() => setActiveTab('schools')}
              className={`px-4 py-2 font-medium transition-colors ${
                activeTab === 'schools'
                  ? 'text-[#0d0d0d] border-b-2 border-[#ff8e3c]'
                  : 'text-[#2a2a2a] hover:text-[#0d0d0d]'
              }`}
            >
              教室設定
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="text-center py-12">
            <div className="w-12 h-12 border-4 border-[#ff8e3c] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-[#2a2a2a]">読み込み中...</p>
          </div>
        ) : activeTab === 'users' ? (
          <div className="space-y-6">
            {/* ユーザー一覧 */}
            <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] overflow-hidden">
              <div className="p-4 bg-[#eff0f3] border-b border-[#0d0d0d]">
                <h2 className="font-bold text-[#0d0d0d]">登録済みユーザー ({users.length})</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-[#eff0f3] border-b border-[#0d0d0d]">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-bold text-[#0d0d0d]">名前</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-[#0d0d0d]">メール</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-[#0d0d0d]">権限</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-[#0d0d0d]">担当教室</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-[#0d0d0d]">状態</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-[#0d0d0d]">最終ログイン</th>
                      <th className="px-4 py-3 text-right text-sm font-bold text-[#0d0d0d]">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#0d0d0d]/10">
                    {users.map(user => (
                      <tr key={user.id} className="hover:bg-[#eff0f3]/50">
                        <td className="px-4 py-3 text-sm text-[#0d0d0d]">
                          {user.display_name || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-[#2a2a2a]">{user.email}</td>
                        <td className="px-4 py-3">
                          <span className="inline-block px-2 py-1 text-xs font-bold bg-[#ff8e3c]/20 text-[#0d0d0d] rounded">
                            {USER_ROLE_LABELS[user.role]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-[#2a2a2a]">
                          {user.user_schools && user.user_schools.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {user.user_schools.map(us => (
                                <span key={us.id} className="inline-block px-2 py-0.5 text-xs bg-[#eff0f3] rounded">
                                  {us.school?.name || '不明'}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[#2a2a2a]/50">なし</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
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
                        <td className="px-4 py-3 text-sm text-[#2a2a2a]">
                          {user.last_login_at ? new Date(user.last_login_at).toLocaleDateString('ja-JP') : '-'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {/* 教室長の場合は自分の情報のみ編集可能 */}
                            {(!isManager || user.id === profile?.id) && (
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
                                    className="p-2 text-[#d9376e] hover:text-[#d9376e]"
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
          <div className="space-y-6">
            {/* 教室一覧 */}
            <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] overflow-hidden">
              <div className="p-4 bg-[#eff0f3] border-b border-[#0d0d0d]">
                <h2 className="font-bold text-[#0d0d0d]">教室一覧 ({schools.length})</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-[#eff0f3] border-b border-[#0d0d0d]">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-bold text-[#0d0d0d]">教室名</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-[#0d0d0d]">コード</th>
                      <th className="px-4 py-3 text-right text-sm font-bold text-[#0d0d0d]">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#0d0d0d]/10">
                    {schools.map(school => (
                      <tr key={school.id} className="hover:bg-[#eff0f3]/50">
                        <td className="px-4 py-3 text-sm text-[#0d0d0d]">{school.name}</td>
                        <td className="px-4 py-3 text-sm text-[#2a2a2a]">{school.code || '-'}</td>
                        <td className="px-4 py-3 text-right">
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
                                onClick={() => handleDeleteSchool(school.id)}
                                className="p-2 text-[#d9376e] hover:text-[#d9376e]"
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
          <div className="p-6">
            <div className="bg-[#d9376e]/10 border border-[#d9376e] rounded-lg p-4">
              <p className="text-[#d9376e]">教室設定はオーナー権限以上のみアクセス可能です</p>
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
              <div className="text-sm text-[#2a2a2a] mb-4">
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
                <p className="text-xs text-[#2a2a2a]/70">ログイン時に使用するIDです。未入力の場合は自動生成されます。</p>
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
                <p className="text-xs text-[#2a2a2a]/70">パスワードは4文字以上で入力してください</p>
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
                    <SelectValue placeholder="教室を選択" />
                  </SelectTrigger>
                  <SelectContent>
                    {schools.map((school) => (
                      <SelectItem key={school.id} value={school.id}>
                        {school.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-xs px-2 py-1"
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
                </div>
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
        <Dialog open={isResultDialogOpen} onOpenChange={setIsResultDialogOpen}>
          <DialogHeader>
            <DialogTitle>ユーザーを作成しました</DialogTitle>
          </DialogHeader>
          <DialogContent>
            <div className="space-y-4">
              <div className="text-sm text-[#2a2a2a] mb-4">
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
              <AlertDialogCancel>キャンセル</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-[#d9376e] text-white hover:bg-[#c02d5a]"
              >
                削除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* 教室作成・編集モーダル */}
        {(showSchoolForm || editingSchool) && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-6 max-w-md w-full">
              <h2 className="text-xl font-bold text-[#0d0d0d] mb-4">
                {editingSchool ? '教室を編集' : '教室を追加'}
              </h2>
              <form
                onSubmit={editingSchool ? (e) => { e.preventDefault(); handleSaveSchool(); } : handleCreateSchool}
                className="space-y-4"
              >
                <div>
                  <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
                    教室名
                  </label>
                  <input
                    type="text"
                    value={schoolName}
                    onChange={e => setSchoolName(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#ff8e3c]"
                    placeholder="例：長山教室"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
                    教室コード（任意）
                  </label>
                  <input
                    type="text"
                    value={schoolCode}
                    onChange={e => setSchoolCode(e.target.value)}
                    className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#ff8e3c]"
                    placeholder="例：NAGAYAMA"
                  />
                  <p className="mt-1 text-xs text-[#2a2a2a]">ポータルURLで使用されます</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
                    申込通知先メールアドレス（任意）
                  </label>
                  <input
                    type="email"
                    value={notificationEmail}
                    onChange={e => setNotificationEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#ff8e3c]"
                    placeholder="manager@example.com"
                  />
                  <p className="mt-1 text-xs text-[#2a2a2a]">フォームから申込があった際に通知を受け取るメールアドレスです</p>
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
                    className="flex-1 px-4 py-2 bg-[#eff0f3] text-[#0d0d0d] rounded-lg hover:bg-[#0d0d0d]/10 transition-colors"
                  >
                    キャンセル
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingSchool}
                    className="flex-1 px-4 py-2 bg-[#ff8e3c] text-[#0d0d0d] font-bold rounded-lg hover:bg-[#ff7a1f] transition-colors disabled:opacity-50"
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
            <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-6 max-w-md w-full">
              <h2 className="text-xl font-bold text-[#0d0d0d] mb-4">ユーザー編集</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
                    メールアドレス
                  </label>
                  <input
                    type="text"
                    value={editingUser.email}
                    disabled
                    className="w-full px-3 py-2 border border-[#0d0d0d]/30 rounded-lg bg-[#eff0f3] text-[#2a2a2a]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
                    表示名
                  </label>
                  <input
                    type="text"
                    value={editDisplayName}
                    onChange={e => setEditDisplayName(e.target.value)}
                    className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#ff8e3c]"
                    placeholder="山田 太郎"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
                    権限
                  </label>
                  <select
                    value={editRole}
                    onChange={e => setEditRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#ff8e3c]"
                  >
                    {(Object.keys(USER_ROLE_LABELS) as UserRole[]).filter(role => role !== 'teacher').map(role => (
                      <option key={role} value={role}>
                        {USER_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
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
                              setEditSchoolIds(editSchoolIds.filter(id => id !== school.id));
                            }
                          }}
                          className="rounded border-[#0d0d0d]"
                        />
                        <span className="text-sm text-[#0d0d0d]">{school.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setEditingUser(null)}
                    className="flex-1 px-4 py-2 bg-[#eff0f3] text-[#0d0d0d] rounded-lg hover:bg-[#0d0d0d]/10 transition-colors"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={handleSaveUser}
                    disabled={isSaving}
                    className="flex-1 px-4 py-2 bg-[#ff8e3c] text-[#0d0d0d] font-bold rounded-lg hover:bg-[#ff7a1f] transition-colors disabled:opacity-50"
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
