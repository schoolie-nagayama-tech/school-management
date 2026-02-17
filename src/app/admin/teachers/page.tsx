'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { useAuth } from '@/contexts/AuthContext';
import { updateUserProfile, fetchWithAuth } from '@/lib/api/auth';
import { getSchools } from '@/lib/api/schools';
import { useToast } from '@/hooks/useToast';
import { ToastContainer } from '@/components/ui';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui';
import { Button } from '@/components/ui';
import { Input } from '@/components/ui';
import { Label } from '@/components/ui';
import { SelectShadcn as Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui';
import { Copy, Check, Eye, EyeOff, Trash2 } from 'lucide-react';
import type { School, UserProfile } from '@/types/database';

interface TeacherWithDetails extends UserProfile {
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

export default function TeachersPage() {
  const { user, profile, permissions, isLoading: authLoading, getSelectedSchoolIds } = useAuth();
  const { toasts, removeToast, success, error: toastError } = useToast();
  const [teachers, setTeachers] = useState<TeacherWithDetails[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // 教室長かどうかを判定
  const isManager = profile?.role === 'manager';
  
  // 講師作成フォーム
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isResultDialogOpen, setIsResultDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    displayName: '',
    password: '',
    schoolId: '',
  });
  const [createdTeacher, setCreatedTeacher] = useState<{
    email: string;
    password: string;
    displayName: string;
  } | null>(null);

  // 削除確認
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingTeacher, setDeletingTeacher] = useState<TeacherWithDetails | null>(null);

  // データ取得
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [teachersResponse, schoolsData] = await Promise.all([
        fetchWithAuth(`/api/admin/users?role=teacher&t=${Date.now()}`),
        getSchools(),
      ]);
      
      if (!teachersResponse.ok) throw new Error('Failed to fetch teachers');
      const teachersData = await teachersResponse.json();
      let teachersList: TeacherWithDetails[] = teachersData.users || [];

      // 権限が講師かつ、その教室に所属する人のみ表示（選択中の教室に紐づく講師に絞る）
      const userSchoolIds = getSelectedSchoolIds();
      if (userSchoolIds.length > 0) {
        teachersList = teachersList.filter(
          (t: TeacherWithDetails) =>
            (t.user_schools || []).some((us: { school_id: string }) => userSchoolIds.includes(us.school_id))
        );
      }
      setTeachers(teachersList);

      // 教室長の場合は自分の権限がある教室のみ表示
      let availableSchools = schoolsData;
      if (isManager) {
        const userSchoolIds = getSelectedSchoolIds();
        availableSchools = schoolsData.filter(school => userSchoolIds.includes(school.id));
      }
      setSchools(availableSchools);
      
      if (availableSchools.length > 0 && !formData.schoolId) {
        setFormData(prev => ({ ...prev, schoolId: availableSchools[0].id }));
      }
    } catch (err) {
      console.error('Error loading data:', err);
      toastError('データの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  // 講師作成
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
          role: 'teacher', // 講師として固定
          schoolId: formData.schoolId,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || '講師の作成に失敗しました');
      }

      setCreatedTeacher({
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
        schoolId: schools[0]?.id || '',
      });
      await loadData();
      success('講師を作成しました');
    } catch (error: any) {
      console.error('Failed to create teacher:', error);
      toastError(error.message || '講師の作成に失敗しました');
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

  // 講師削除
  const handleDelete = async () => {
    if (!deletingTeacher) return;
    const teacherIdToDelete = deletingTeacher.id;

    try {
      const response = await fetchWithAuth(`/api/admin/users/${teacherIdToDelete}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        // 404 = 既に削除済み → 一覧から除外して成功扱い
        if (response.status === 404) {
          setTeachers((prev) => prev.filter((t) => t.id !== teacherIdToDelete));
          success('講師を削除しました');
          return;
        }
        let msg = '削除に失敗しました';
        try {
          const body = await response.json();
          if (body?.details) msg = body.details;
          else if (body?.error) msg = body.error;
        } catch (_) {}
        throw new Error(msg);
      }

      setTeachers((prev) => prev.filter((t) => t.id !== teacherIdToDelete));
      success('講師を削除しました');
      await loadData();
    } catch (error) {
      console.error('Failed to delete teacher:', error);
      toastError(error instanceof Error ? error.message : '削除に失敗しました');
    } finally {
      setIsDeleteDialogOpen(false);
      setDeletingTeacher(null);
    }
  };

  // 講師有効/無効切り替え（楽観的更新で即座にUI反映）
  const handleToggleActive = async (teacher: TeacherWithDetails) => {
    const newIsActive = !teacher.is_active;
    setTeachers((prev) =>
      prev.map((t) =>
        t.id === teacher.id ? { ...t, is_active: newIsActive } : t
      )
    );
    try {
      await updateUserProfile(teacher.id, { is_active: newIsActive });
      success('講師の状態を更新しました');
    } catch (err) {
      console.error('Error toggling teacher:', err);
      setTeachers((prev) =>
        prev.map((t) =>
          t.id === teacher.id ? { ...t, is_active: teacher.is_active } : t
        )
      );
      toastError('講師の更新に失敗しました');
    }
  };

  // 未ログイン時は権限画面ではなくローディング（AuthContext がログインへリダイレクトするまでの間）
  if (!user || authLoading) {
    return (
      <AdminLayout headerTitle="講師管理">
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
    <AdminLayout headerTitle="講師管理">
      <div className="p-6 max-w-7xl mx-auto">
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-6">
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
            <h1 className="text-2xl font-bold text-[#1f2937]">講師管理</h1>
          </div>
          <Button onClick={() => setIsCreateDialogOpen(true)}>
            + 講師を追加
          </Button>
        </div>

        {isLoading ? (
          <div className="text-center py-12">
            <div className="w-12 h-12 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-[#4b5563]">読み込み中...</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* 講師一覧 */}
            <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
              <div className="p-4 bg-[#f3f4f6] border-b border-[#e5e7eb]">
                <h2 className="font-bold text-[#1f2937]">登録済み講師 ({teachers.length})</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-[#f3f4f6] border-b border-[#e5e7eb]">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-bold text-[#1f2937]">名前</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-[#1f2937]">メール</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-[#1f2937]">担当教室</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-[#1f2937]">状態</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-[#1f2937]">最終ログイン</th>
                      <th className="px-4 py-3 text-right text-sm font-bold text-[#1f2937]">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e5e7eb]/10">
                    {teachers.map(teacher => (
                      <tr key={teacher.id} className="hover:bg-[#f3f4f6]/50">
                        <td className="px-4 py-3 text-sm text-[#1f2937]">
                          {teacher.display_name || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-[#4b5563]">{teacher.email}</td>
                        <td className="px-4 py-3 text-sm text-[#4b5563]">
                          {teacher.user_schools && teacher.user_schools.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {teacher.user_schools.map(us => (
                                <span key={us.id} className="inline-block px-2 py-0.5 text-xs bg-[#f3f4f6] rounded">
                                  {us.school?.name || '不明'}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[#4b5563]/50">なし</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {teacher.is_active ? (
                            <span className="inline-block px-2 py-1 text-xs font-bold bg-green-100 text-green-700 rounded">
                              有効
                            </span>
                          ) : (
                            <span className="inline-block px-2 py-1 text-xs font-bold bg-gray-100 text-gray-700 rounded">
                              無効
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-[#4b5563]">
                          {teacher.last_login_at ? new Date(teacher.last_login_at).toLocaleDateString('ja-JP') : '-'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Link href={`/admin/teachers/${teacher.id}`}>
                              <Button variant="ghost" className="p-2">
                                詳細
                              </Button>
                            </Link>
                            <Button
                              variant="ghost"
                              onClick={() => handleToggleActive(teacher)}
                              className="p-2"
                            >
                              {teacher.is_active ? '無効化' : '有効化'}
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => {
                                setDeletingTeacher(teacher);
                                setIsDeleteDialogOpen(true);
                              }}
                              className="p-2 text-[#ef4444] hover:text-[#ef4444]"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
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

        {/* 講師作成ダイアログ */}
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogHeader>
            <DialogTitle>講師を追加</DialogTitle>
          </DialogHeader>
          <DialogContent>
            <div className="space-y-4">
              <div className="text-sm text-[#4b5563] mb-4">
                新しい講師アカウントを作成します。ユーザーID（メールアドレス）は未入力の場合、自動生成されます。
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
                    {schools
                      .filter(school => {
                        // 教室長の場合は自分の権限がある教室のみ表示
                        if (isManager) {
                          const userSchoolIds = getSelectedSchoolIds();
                          return userSchoolIds.includes(school.id);
                        }
                        return true;
                      })
                      .map((school) => (
                        <SelectItem key={school.id} value={school.id}>
                          {school.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
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
            <DialogTitle>講師を作成しました</DialogTitle>
          </DialogHeader>
          <DialogContent>
            <div className="space-y-4">
              <div className="text-sm text-[#4b5563] mb-4">
                以下の情報を講師に伝えてください。パスワードは後から確認できません。
              </div>
              {createdTeacher && (
                <>
                  <div className="space-y-2">
                    <Label>表示名</Label>
                    <Input value={createdTeacher.displayName} readOnly />
                  </div>
                  <div className="space-y-2">
                    <Label>メールアドレス（ID）</Label>
                    <div className="flex items-center gap-2">
                      <Input value={createdTeacher.email} readOnly className="flex-1" />
                      <Button
                        variant="ghost"
                        onClick={() => handleCopy(createdTeacher.email, 'email')}
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
                          value={createdTeacher.password}
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
                        onClick={() => handleCopy(createdTeacher.password, 'password')}
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
              <AlertDialogTitle>講師を削除しますか？</AlertDialogTitle>
              <AlertDialogDescription>
                「{deletingTeacher?.display_name}」を削除します。この操作は取り消せません。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => { setIsDeleteDialogOpen(false); setDeletingTeacher(null); }}>キャンセル</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-[#ef4444] text-white hover:bg-[#dc2626]"
              >
                削除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

      </div>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}
