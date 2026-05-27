'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { useAuth } from '@/contexts/AuthContext';
import { updateUserProfile, fetchWithAuth } from '@/lib/api/auth';
import { useMasterData } from '@/contexts/MasterDataContext';
import { useToast } from '@/hooks/useToast';
import { ToastContainer, Loading } from '@/components/ui';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui';
import { Button } from '@/components/ui';
import { Input } from '@/components/ui';
import { Label } from '@/components/ui';
import { SelectShadcn as Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui';
import { Copy, Check, Eye, EyeOff, Trash2, LogIn, AlertTriangle, Home } from 'lucide-react';
import { impersonateUser } from '@/lib/impersonate';
import type { School, UserProfile, TeacherBadge, TeacherBadgeAssignment } from '@/types/database';
import { normalizeLoginEmail, normalizePassword } from '@/lib/utils/loginId';
import { BADGE_RANK_CONFIG } from '@/types/database';
import { generateTeacherCSV, downloadCSV, type TeacherExportRow } from '@/lib/utils/csvUtils';
import dynamic from 'next/dynamic';
const TeacherCsvImportModal = dynamic(
  () => import('@/components/csv/TeacherCsvImportModal').then((m) => m.TeacherCsvImportModal),
  { ssr: false }
);
import { displayLoginId } from '@/lib/utils/loginId';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { getTeacherBadges, getTeacherBadgeAssignments } from '@/lib/api/teacher-badges';
import { onTeacherBadgesChanged } from '@/lib/teacher-badge-events';
import { BadgeIcon } from '@/components/teacher-badges/BadgeIcon';
import { BadgeGlint } from '@/components/badges/BadgeGlint';
import { useFreshBadgeTeachers } from '@/hooks/useFreshBadgeTeachers';

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
  const { user, profile, permissions, isLoading: authLoading, getSelectedSchoolIds, selectedSchoolId, demoSchoolIds } = useAuth();
  const { schools: masterSchools } = useMasterData();
  const { toasts, removeToast, success, error: toastError } = useToast();
  const [teachers, setTeachers] = useState<TeacherWithDetails[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // 直近の読み込み時刻（フォーカス復帰時のスロットル判定用）
  const lastLoadAtRef = useRef<number>(0);
  /** フォーカス復帰時に再読込をスキップする閾値 (ms)。30秒以内なら何もしない。 */
  const FOCUS_REFRESH_MIN_INTERVAL_MS = 30_000;
  
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
    lastName: '',
    firstName: '',
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

  // CSV
  const [isCsvImportModalOpen, setIsCsvImportModalOpen] = useState(false);

  // バッジ
  const [allBadges, setAllBadges] = useState<TeacherBadge[]>([]);
  const [teacherBadgeMap, setTeacherBadgeMap] = useState<Map<string, TeacherBadgeAssignment[]>>(new Map());
  const [badgeFilter, setBadgeFilter] = useState<string>('all');
  const [schoolFilter, setSchoolFilter] = useState<string>('all');
  const [sortByBadges, setSortByBadges] = useState(false);

  // 今日新しいバッジを取った講師ID（名前横に閃光を出すため）
  const freshBadgeTeacherIds = useFreshBadgeTeachers();

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      // 講師一覧とバッジ一覧は相互依存しないので並列化（B案）
      const [teachersResponse, badges] = await Promise.all([
        fetchWithAuth(`/api/admin/users?role=teacher`),
        getTeacherBadges().catch(() => [] as TeacherBadge[]),
      ]);
      setAllBadges(badges);

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

      // デモ教室を除外し、教室長の場合はさらに権限ある教室のみ表示
      const demoSet = new Set(demoSchoolIds);
      let availableSchools = masterSchools.filter((s) => !demoSet.has(s.id));
      if (isManager) {
        availableSchools = availableSchools.filter(school => userSchoolIds.includes(school.id));
      }
      setSchools(availableSchools);

      if (availableSchools.length > 0) {
        setFormData(prev => prev.schoolId ? prev : { ...prev, schoolId: availableSchools[0].id });
      }

      // バッジ割当（teacherIds が必要なので講師取得後に実行）
      try {
        const teacherIds = teachersList.map((t) => t.id);
        if (teacherIds.length > 0) {
          const batchRes = await fetchWithAuth(
            `/api/admin/teachers/badges/batch?teacherIds=${teacherIds.join(',')}`
          );
          const badgeMap = new Map<string, TeacherBadgeAssignment[]>();
          if (batchRes.ok) {
            const data = await batchRes.json();
            const byTeacher: Record<string, TeacherBadgeAssignment[]> = data.assignmentsByTeacher || {};
            for (const [tid, assignments] of Object.entries(byTeacher)) {
              badgeMap.set(tid, assignments);
            }
          }
          setTeacherBadgeMap(badgeMap);
        } else {
          setTeacherBadgeMap(new Map());
        }
      } catch { /* バッジ割当取得失敗は致命的ではない */ }

      lastLoadAtRef.current = Date.now();
    } catch (err) {
      console.error('Error loading data:', err);
      toastError('データの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds, selectedSchoolId, masterSchools, demoSchoolIds, isManager, toastError]);

  // データ取得: 教室切替や master データ更新時に再読込
  // （loadData は getSelectedSchoolIds 経由で selectedSchoolId に依存しているため、
  //   教室切替時に loadData の ID が変わって再実行される）
  useEffect(() => {
    loadData();
  }, [loadData]);

  // 編集ページでバッジがトグルされたら対象講師のバッジのみ再取得
  useEffect(() => {
    const refetchBadgesForTeacher = async (teacherId: string) => {
      try {
        const assignments = await getTeacherBadgeAssignments(teacherId);
        setTeacherBadgeMap((prev) => {
          const next = new Map(prev);
          next.set(teacherId, assignments);
          return next;
        });
      } catch { /* noop */ }
    };
    const offEvent = onTeacherBadgesChanged((tid) => {
      refetchBadgesForTeacher(tid);
    });
    // フォーカス/可視化復帰時の再読込は、直近の読み込みから 30 秒以内ならスキップ（A案）
    // タブ切替や別ウィンドウから戻るたびに全件再フェッチされる挙動を抑制
    const onFocus = () => {
      if (document.visibilityState === 'hidden') return;
      const since = Date.now() - lastLoadAtRef.current;
      if (since < FOCUS_REFRESH_MIN_INTERVAL_MS) return;
      loadData();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      offEvent();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [loadData]);

  // 講師作成
  const handleCreate = async () => {
    if (!formData.lastName || !formData.password || !formData.schoolId) {
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
          email: formData.email ? normalizeLoginEmail(formData.email) : undefined,
          password: normalizePassword(formData.password),
          lastName: formData.lastName,
          firstName: formData.firstName,
          role: 'teacher',
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
        displayName: [formData.lastName, formData.firstName].filter(Boolean).join(' '),
      });
      setIsCreateDialogOpen(false);
      setIsResultDialogOpen(true);
      setFormData({
        email: '',
        lastName: '',
        firstName: '',
        password: '',
        schoolId: schools[0]?.id || '',
      });
      await loadData();
      success('講師を作成しました');
    } catch (error) {
      console.error('Failed to create teacher:', error);
      toastError(error instanceof Error ? error.message : '講師の作成に失敗しました');
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
        } catch (parseErr) {
          console.warn('Failed to parse error response:', parseErr);
        }
        throw new Error(msg);
      }

      setTeachers((prev) => prev.filter((t) => t.id !== teacherIdToDelete));
      success('講師を削除しました');
    } catch (error) {
      console.error('Failed to delete teacher:', error);
      toastError(getUserErrorMessage(error, '削除に失敗しました'));
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
        <Loading />
      </AdminLayout>
    );
  }
  if (!permissions?.canAccessUsers) {
    return (
      <AdminLayout>
        <div className="p-6">
          <div className="bg-danger/10 border border-danger rounded-lg p-4">
            <p className="text-danger">このページにアクセスする権限がありません</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="講師管理">
      <div className="p-6 max-w-[1600px] mx-auto">
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link
              href="/students"
              className="flex items-center gap-2 text-text-heading hover:text-info transition-colors duration-150"
              title="ホームに戻る"
            >
              <Home className="w-5 h-5" />
            </Link>
            <h1 className="text-2xl font-bold text-text-heading">講師管理</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const exportRows: TeacherExportRow[] = teachers.map((t) => ({
                  display_name: t.display_name,
                  // 内部ドメインを除いてIDだけエクスポート（再インポート時に normalizeLoginEmail で復元される）
                  email: displayLoginId(t.email),
                  school_names: (t.user_schools || []).map((us) => us.school?.name ?? '').filter(Boolean),
                  is_active: t.is_active ?? true,
                }));
                const csv = generateTeacherCSV(exportRows);
                const date = new Date().toISOString().slice(0, 10);
                downloadCSV(csv, `講師一覧_${date}.csv`);
              }}
            >
              CSVエクスポート
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsCsvImportModalOpen(true)}
            >
              CSVインポート
            </Button>
            <Button onClick={() => setIsCreateDialogOpen(true)}>
              + 講師を追加
            </Button>
          </div>
        </div>

        {isLoading ? (
          <Loading />
        ) : (
          <div className="space-y-6">
            {/* フィルタ */}
            {(schools.length > 1 || allBadges.length > 0) && (
              <div className="flex flex-wrap items-center gap-3">
                {schools.length > 1 && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">教室:</span>
                    <select
                      value={schoolFilter}
                      onChange={(e) => setSchoolFilter(e.target.value)}
                      className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                    >
                      <option value="all">すべて</option>
                      {schools.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {allBadges.length > 0 && (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-500">バッジ:</span>
                      <select
                        value={badgeFilter}
                        onChange={(e) => setBadgeFilter(e.target.value)}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                      >
                        <option value="all">すべて</option>
                        {allBadges.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sortByBadges}
                        onChange={(e) => setSortByBadges(e.target.checked)}
                        className="rounded border-gray-300 text-ink focus:ring-ink"
                      />
                      バッジ数でソート
                    </label>
                  </>
                )}
              </div>
            )}

            <div className="bg-surface-raised rounded-xl border border-border overflow-hidden">
              <div className="p-4 bg-surface-hover border-b border-border">
                <h2 className="font-bold text-text-heading">登録済み講師 ({teachers.length})</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-surface-hover border-b border-border">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-bold text-text-heading">名前</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-text-heading">ログインID</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-text-heading">担当教室</th>
                      {allBadges.length > 0 && (
                        <th className="px-4 py-3 text-left text-sm font-bold text-text-heading">バッジ</th>
                      )}
                      <th className="px-4 py-3 text-left text-sm font-bold text-text-heading">状態</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-text-heading">最終ログイン</th>
                      <th className="px-4 py-3 text-right text-sm font-bold text-text-heading">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/10">
                    {(() => {
                      let list = [...teachers];
                      // 教室フィルタ
                      if (schoolFilter !== 'all') {
                        list = list.filter((t) =>
                          (t.user_schools || []).some((us) => us.school_id === schoolFilter)
                        );
                      }
                      // バッジフィルタ
                      if (badgeFilter !== 'all') {
                        list = list.filter((t) => {
                          const assignments = teacherBadgeMap.get(t.id) || [];
                          return assignments.some((a) => a.badge_id === badgeFilter);
                        });
                      }
                      // バッジ数ソート
                      if (sortByBadges) {
                        list.sort((a, b) => (teacherBadgeMap.get(b.id)?.length || 0) - (teacherBadgeMap.get(a.id)?.length || 0));
                      }
                      return list;
                    })().map(teacher => (
                      <tr key={teacher.id} className="hover:bg-surface-hover/50">
                        <td className="px-4 py-3 text-sm text-text-heading">
                          <span className="inline-flex items-center gap-1.5">
                            {teacher.display_name || '-'}
                            {freshBadgeTeacherIds.has(teacher.id) && <BadgeGlint />}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-text-body">{displayLoginId(teacher.email)}</td>
                        <td className="px-4 py-3 text-sm text-text-body">
                          {teacher.user_schools && teacher.user_schools.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {teacher.user_schools.map(us => (
                                <span key={us.id} className="inline-block px-2 py-0.5 text-xs bg-surface-hover rounded">
                                  {us.school?.name || '不明'}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-text-body/50">なし</span>
                          )}
                        </td>
                        {allBadges.length > 0 && (
                          <td className="px-4 py-3">
                            {(() => {
                              const assignments = teacherBadgeMap.get(teacher.id) || [];
                              if (assignments.length === 0) return <span className="text-xs text-gray-300">-</span>;
                              const show = assignments.slice(0, 3);
                              const rest = assignments.length - 3;
                              return (
                                <div className="flex items-center gap-1 flex-wrap">
                                  {show.map((a) => {
                                    const badge = a.badge || allBadges.find((b) => b.id === a.badge_id);
                                    if (!badge) return null;
                                    const rankConfig = BADGE_RANK_CONFIG[badge.rank];
                                    return (
                                      <span
                                        key={a.id}
                                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border"
                                        style={{ color: rankConfig.color, borderColor: `${rankConfig.color}40` }}
                                        title={badge.name}
                                      >
                                        <BadgeIcon icon={badge.icon} size={12} />
                                        {badge.name}
                                      </span>
                                    );
                                  })}
                                  {rest > 0 && (
                                    <span className="text-[10px] text-gray-400">+{rest}</span>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                        )}
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
                        <td className="px-4 py-3 text-sm text-text-body">
                          {teacher.last_login_at ? new Date(teacher.last_login_at).toLocaleDateString('ja-JP') : '-'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Link href={`/admin/teachers/${teacher.id}`}>
                              <Button variant="ghost" className="p-2">
                                詳細
                              </Button>
                            </Link>
                            <Link href={`/admin/teachers/${teacher.id}/edit`}>
                              <Button variant="ghost" className="p-2">
                                編集
                              </Button>
                            </Link>
                            <Button
                              variant="ghost"
                              onClick={() => handleToggleActive(teacher)}
                              className="p-2"
                            >
                              {teacher.is_active ? '無効化' : '有効化'}
                            </Button>
                            {profile?.role === 'admin' && teacher.id !== profile?.id && (
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!confirm(`${teacher.display_name || displayLoginId(teacher.email)}としてログインしますか？\n（元のアカウントにはバナーから戻れます）`)) return;
                                  try {
                                    await impersonateUser(teacher.id);
                                  } catch (e) {
                                    toastError((e as Error).message);
                                  }
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:border-amber-400 transition-colors cursor-pointer"
                                title="この講師としてログイン"
                              >
                                <LogIn className="h-3 w-3" />
                                ログイン
                              </button>
                            )}
                            <Button
                              variant="ghost"
                              onClick={() => {
                                setDeletingTeacher(teacher);
                                setIsDeleteDialogOpen(true);
                              }}
                              className="p-2 text-danger hover:text-danger"
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
              <div className="text-sm text-text-body mb-4">
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
                <p className="text-xs text-text-body/70">GrowのID・パスワードと同じものを入力してください。未入力の場合は自動生成されます。</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="lastName">姓 *</Label>
                  <Input
                    id="lastName"
                    value={formData.lastName}
                    onChange={(e) =>
                      setFormData({ ...formData, lastName: e.target.value })
                    }
                    placeholder="山田"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="firstName">名</Label>
                  <Input
                    id="firstName"
                    value={formData.firstName}
                    onChange={(e) =>
                      setFormData({ ...formData, firstName: e.target.value })
                    }
                    placeholder="太郎"
                  />
                </div>
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
                <p className="text-xs text-text-body/70">Growと同じパスワードを入力してください（4文字以上）</p>
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
              <div className="text-sm text-text-body mb-4">
                以下の情報を講師に伝えてください。パスワードは後から確認できません。
              </div>
              {createdTeacher && (
                <>
                  <div className="space-y-2">
                    <Label>表示名</Label>
                    <Input value={createdTeacher.displayName} readOnly />
                  </div>
                  <div className="space-y-2">
                    <Label>ログインID</Label>
                    <div className="flex items-center gap-2">
                      <Input value={displayLoginId(createdTeacher.email)} readOnly className="flex-1" />
                      <Button
                        variant="ghost"
                        onClick={() => handleCopy(displayLoginId(createdTeacher.email), 'email')}
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
                      <AlertTriangle className="inline h-4 w-4 mr-1" />パスワードはこの画面を閉じると再表示できません。必ずメモしてください。
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
                className="bg-danger text-white hover:bg-red-700"
              >
                削除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

      </div>
      {/* CSVインポートモーダル */}
      <TeacherCsvImportModal
        isOpen={isCsvImportModalOpen}
        onClose={() => setIsCsvImportModalOpen(false)}
        schools={schools}
        onImportComplete={loadData}
      />

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}
