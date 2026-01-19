'use client';

import { useState, useEffect } from 'react';
import { AdminLayout } from '@/components/layouts';
import { useAuth } from '@/contexts/AuthContext';
import { 
  getUsers, 
  createInvitation, 
  getInvitations,
  deleteInvitation,
  updateUserProfile,
  addUserToSchool,
  removeUserFromSchool,
} from '@/lib/api/auth';
import { getSchools, createSchool, updateSchool, deleteSchool } from '@/lib/api/schools';
import type { UserWithDetails, UserInvitation, School, UserRole } from '@/types/database';
import { USER_ROLE_LABELS } from '@/types/database';

type TabType = 'users' | 'schools';

export default function UsersPage() {
  const { profile, permissions } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('users');
  const [users, setUsers] = useState<UserWithDetails[]>([]);
  const [invitations, setInvitations] = useState<UserInvitation[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // 招待フォーム
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('teacher');
  const [inviteSchoolIds, setInviteSchoolIds] = useState<string[]>([]);
  const [isInviting, setIsInviting] = useState(false);

  // 教室作成モーダル
  const [showSchoolForm, setShowSchoolForm] = useState(false);
  
  // 編集モーダル
  const [editingUser, setEditingUser] = useState<UserWithDetails | null>(null);
  const [editRole, setEditRole] = useState<UserRole>('teacher');
  const [editSchoolIds, setEditSchoolIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // 教室管理
  const [editingSchool, setEditingSchool] = useState<School | null>(null);
  const [schoolName, setSchoolName] = useState('');
  const [schoolCode, setSchoolCode] = useState('');
  const [isSavingSchool, setIsSavingSchool] = useState(false);

  // データ取得
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [usersData, invitationsData, schoolsData] = await Promise.all([
        getUsers(),
        getInvitations(),
        getSchools(),
      ]);
      setUsers(usersData);
      setInvitations(invitationsData.filter(inv => !inv.accepted_at));
      setSchools(schoolsData);
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // 招待送信
  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    setIsInviting(true);
    try {
      await createInvitation(inviteEmail, inviteRole, inviteSchoolIds, profile.id);
      setInviteEmail('');
      setInviteRole('teacher');
      setInviteSchoolIds([]);
      setShowInviteForm(false);
      await loadData();
    } catch (err) {
      console.error('Error inviting user:', err);
      alert('招待の送信に失敗しました');
    } finally {
      setIsInviting(false);
    }
  };

  // 招待削除
  const handleDeleteInvitation = async (id: string) => {
    if (!confirm('この招待を削除しますか？')) return;
    try {
      await deleteInvitation(id);
      await loadData();
    } catch (err) {
      console.error('Error deleting invitation:', err);
      alert('招待の削除に失敗しました');
    }
  };

  // ユーザー編集モーダルを開く
  const openEditModal = async (user: UserWithDetails) => {
    setEditingUser(user);
    setEditRole(user.role);
    setEditSchoolIds(user.schools.map(s => s.school_id));
  };

  // ユーザー編集を保存
  const handleSaveUser = async () => {
    if (!editingUser) return;

    setIsSaving(true);
    try {
      // ロール更新
      await updateUserProfile(editingUser.id, { role: editRole });

      // 教室の紐付け更新
      const currentSchoolIds = editingUser.schools.map(s => s.school_id);
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
    } catch (err) {
      console.error('Error updating user:', err);
      alert('ユーザーの更新に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  // ユーザー有効/無効切り替え
  const handleToggleActive = async (user: UserWithDetails) => {
    try {
      await updateUserProfile(user.id, { is_active: !user.is_active });
      await loadData();
    } catch (err) {
      console.error('Error toggling user:', err);
      alert('ユーザーの更新に失敗しました');
    }
  };

  // 権限チェック
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

  // 教室作成
  const handleCreateSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSchool(true);
    try {
      await createSchool({ name: schoolName, code: schoolCode || null });
      setSchoolName('');
      setSchoolCode('');
      setShowSchoolForm(false);
      await loadData();
    } catch (err: any) {
      console.error('Error creating school:', err);
      alert(err.message || '教室の作成に失敗しました');
    } finally {
      setIsSavingSchool(false);
    }
  };

  // 教室編集モーダルを開く
  const openEditSchoolModal = (school: School) => {
    setEditingSchool(school);
    setSchoolName(school.name);
    setSchoolCode(school.code || '');
    setShowSchoolForm(true);
  };

  // 教室編集を保存
  const handleSaveSchool = async () => {
    if (!editingSchool) return;
    setIsSavingSchool(true);
    try {
      await updateSchool(editingSchool.id, { name: schoolName, code: schoolCode || null });
      setEditingSchool(null);
      setSchoolName('');
      setSchoolCode('');
      setShowSchoolForm(false);
      await loadData();
    } catch (err: any) {
      console.error('Error updating school:', err);
      alert(err.message || '教室の更新に失敗しました');
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
    } catch (err: any) {
      console.error('Error deleting school:', err);
      alert(err.message || '教室の削除に失敗しました');
    }
  };

  return (
    <AdminLayout>
      <div className="p-6 max-w-7xl mx-auto">
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-[#0d0d0d]">ユーザー管理</h1>
          {activeTab === 'users' && (
            <button
              onClick={() => setShowInviteForm(true)}
              className="px-4 py-2 bg-[#ff8e3c] text-[#0d0d0d] font-bold rounded-lg hover:bg-[#ff7a1f] transition-colors"
            >
              + ユーザーを招待
            </button>
          )}
          {activeTab === 'schools' && (
            <button
              onClick={() => {
                setEditingSchool(null);
                setSchoolName('');
                setSchoolCode('');
                setShowSchoolForm(true);
              }}
              className="px-4 py-2 bg-[#ff8e3c] text-[#0d0d0d] font-bold rounded-lg hover:bg-[#ff7a1f] transition-colors"
            >
              + 教室を追加
            </button>
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
                          {user.schools.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {user.schools.map(us => (
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
                            <button
                              onClick={() => openEditModal(user)}
                              className="px-3 py-1 text-sm bg-[#eff0f3] text-[#0d0d0d] rounded hover:bg-[#0d0d0d]/10 transition-colors"
                            >
                              編集
                            </button>
                            <button
                              onClick={() => handleToggleActive(user)}
                              className={`px-3 py-1 text-sm rounded transition-colors ${
                                user.is_active
                                  ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                  : 'bg-green-100 text-green-700 hover:bg-green-200'
                              }`}
                            >
                              {user.is_active ? '無効化' : '有効化'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 招待中のユーザー */}
            {invitations.length > 0 && (
              <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] overflow-hidden">
                <div className="p-4 bg-[#eff0f3] border-b border-[#0d0d0d]">
                  <h2 className="font-bold text-[#0d0d0d]">招待中 ({invitations.length})</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-[#eff0f3] border-b border-[#0d0d0d]">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-bold text-[#0d0d0d]">メール</th>
                        <th className="px-4 py-3 text-left text-sm font-bold text-[#0d0d0d]">権限</th>
                        <th className="px-4 py-3 text-left text-sm font-bold text-[#0d0d0d]">有効期限</th>
                        <th className="px-4 py-3 text-right text-sm font-bold text-[#0d0d0d]">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#0d0d0d]/10">
                      {invitations.map(inv => (
                        <tr key={inv.id} className="hover:bg-[#eff0f3]/50">
                          <td className="px-4 py-3 text-sm text-[#0d0d0d]">{inv.email}</td>
                          <td className="px-4 py-3">
                            <span className="inline-block px-2 py-1 text-xs font-bold bg-[#ff8e3c]/20 text-[#0d0d0d] rounded">
                              {USER_ROLE_LABELS[inv.role]}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-[#2a2a2a]">
                            {new Date(inv.expires_at).toLocaleDateString('ja-JP')}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => handleDeleteInvitation(inv.id)}
                              className="px-3 py-1 text-sm bg-[#d9376e]/10 text-[#d9376e] rounded hover:bg-[#d9376e]/20 transition-colors"
                            >
                              削除
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : (
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
                            <button
                              onClick={() => openEditSchoolModal(school)}
                              className="px-3 py-1 text-sm bg-[#eff0f3] text-[#0d0d0d] rounded hover:bg-[#0d0d0d]/10 transition-colors"
                            >
                              編集
                            </button>
                            {school.code !== 'DEFAULT' && (
                              <button
                                onClick={() => handleDeleteSchool(school.id)}
                                className="px-3 py-1 text-sm bg-[#d9376e]/10 text-[#d9376e] rounded hover:bg-[#d9376e]/20 transition-colors"
                              >
                                削除
                              </button>
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
        )}

        {/* 招待フォームモーダル */}
        {showInviteForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-6 max-w-md w-full">
              <h2 className="text-xl font-bold text-[#0d0d0d] mb-4">ユーザーを招待</h2>
              <form onSubmit={handleInvite} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
                    メールアドレス
                  </label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#ff8e3c]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
                    権限
                  </label>
                  <select
                    value={inviteRole}
                    onChange={e => setInviteRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#ff8e3c]"
                  >
                    {(Object.keys(USER_ROLE_LABELS) as UserRole[]).map(role => (
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
                          checked={inviteSchoolIds.includes(school.id)}
                          onChange={e => {
                            if (e.target.checked) {
                              setInviteSchoolIds([...inviteSchoolIds, school.id]);
                            } else {
                              setInviteSchoolIds(inviteSchoolIds.filter(id => id !== school.id));
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
                    onClick={() => setShowInviteForm(false)}
                    className="flex-1 px-4 py-2 bg-[#eff0f3] text-[#0d0d0d] rounded-lg hover:bg-[#0d0d0d]/10 transition-colors"
                  >
                    キャンセル
                  </button>
                  <button
                    type="submit"
                    disabled={isInviting}
                    className="flex-1 px-4 py-2 bg-[#ff8e3c] text-[#0d0d0d] font-bold rounded-lg hover:bg-[#ff7a1f] transition-colors disabled:opacity-50"
                  >
                    {isInviting ? '送信中...' : '招待を送信'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

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
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowSchoolForm(false);
                      setEditingSchool(null);
                      setSchoolName('');
                      setSchoolCode('');
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
                    権限
                  </label>
                  <select
                    value={editRole}
                    onChange={e => setEditRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#ff8e3c]"
                  >
                    {(Object.keys(USER_ROLE_LABELS) as UserRole[]).map(role => (
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
    </AdminLayout>
  );
}
