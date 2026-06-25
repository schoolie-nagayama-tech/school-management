'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Loading } from '@/components/ui';
import { ToastContainer } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import type { TeacherBadge, BadgeCategory } from '@/types/database';
import { BADGE_CATEGORY_CONFIG, BADGE_RANK_CONFIG } from '@/types/database';
import {
  getTeacherBadges,
  createTeacherBadge,
  updateTeacherBadge,
  deleteTeacherBadge,
} from '@/lib/api/teacher-badges';
import { BadgeIcon } from '@/components/teacher-badges/BadgeIcon';
import { BadgeTemplateDialog } from '@/components/teacher-badges/BadgeTemplateDialog';
import { BadgeAssignDialog } from '@/components/teacher-badges/BadgeAssignDialog';
import { TrainingMastersPanel } from '@/components/teacher-badges/TrainingMastersPanel';
import { useAuth } from '@/contexts/AuthContext';
import { Award, GraduationCap } from 'lucide-react';

type TopTab = 'badges' | 'trainings';
type CategoryFilter = BadgeCategory | 'all';

export default function TeacherBadgesPage() {
  const { getSelectedSchoolIds, selectedSchoolId } = useAuth();
  // 教室切替時に安定した参照を維持（BadgeAssignDialog の不要な再取得を防止）
  const schoolIds = useMemo(() => getSelectedSchoolIds(), [selectedSchoolId, getSelectedSchoolIds]);
  const { toasts, success, error: toastError, removeToast } = useToast();

  const [topTab, setTopTab] = useState<TopTab>('badges');
  const [badges, setBadges] = useState<TeacherBadge[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<CategoryFilter>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TeacherBadge | null>(null);
  const [assignTarget, setAssignTarget] = useState<TeacherBadge | null>(null);

  const fetchBadges = useCallback(async () => {
    try {
      const data = await getTeacherBadges(undefined, { includeInactive: true });
      setBadges(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBadges();
  }, [fetchBadges]);

  const handleCreate = () => {
    setEditTarget(null);
    setDialogOpen(true);
  };

  const handleEdit = (badge: TeacherBadge) => {
    setEditTarget(badge);
    setDialogOpen(true);
  };

  const handleSave = async (data: {
    name: string;
    category: string;
    rank: string;
    icon: string;
    description: string;
    sort_order: number;
  }): Promise<TeacherBadge> => {
    try {
      if (editTarget) {
        const updated = await updateTeacherBadge(editTarget.id, data);
        setBadges((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
        success(`「${updated.name}」を更新しました`);
        return updated;
      } else {
        const created = await createTeacherBadge(data);
        setBadges((prev) => [...prev, created]);
        success(`「${created.name}」を作成しました`);
        return created;
      }
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'バッジの保存に失敗しました');
      throw e;
    }
  };

  const handleDisable = async (badge: TeacherBadge) => {
    if (
      !confirm(
        `「${badge.name}」を無効化しますか？\n（付与済みのデータは残りますが、新規付与はできなくなります）`
      )
    )
      return;
    try {
      await deleteTeacherBadge(badge.id);
      setBadges((prev) => prev.map((b) => (b.id === badge.id ? { ...b, is_active: false } : b)));
      success(`「${badge.name}」を無効化しました`);
    } catch (e) {
      toastError(e instanceof Error ? e.message : '無効化に失敗しました');
    }
  };

  const handleEnable = async (badge: TeacherBadge) => {
    try {
      const updated = await updateTeacherBadge(badge.id, { is_active: true });
      setBadges((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
      success(`「${updated.name}」を再有効化しました`);
    } catch (e) {
      toastError(e instanceof Error ? e.message : '再有効化に失敗しました');
    }
  };

  const handleHardDelete = async (badge: TeacherBadge) => {
    if (
      !confirm(
        `「${badge.name}」を完全に削除しますか？\n付与済みの全データも削除されます。この操作は取り消せません。`
      )
    )
      return;
    try {
      await deleteTeacherBadge(badge.id, { hard: true });
      setBadges((prev) => prev.filter((b) => b.id !== badge.id));
      success(`「${badge.name}」を削除しました`);
    } catch (e) {
      toastError(e instanceof Error ? e.message : '削除に失敗しました');
    }
  };

  const handleDialogClose = () => {
    setDialogOpen(false);
    // 講師付与が変更された可能性があるので再取得
    fetchBadges();
  };

  const filtered = filter === 'all' ? badges : badges.filter((b) => b.category === filter);

  const categoryTabs: { key: CategoryFilter; label: string }[] = [
    { key: 'all', label: 'すべて' },
    ...(['training', 'skill', 'achievement'] as BadgeCategory[]).map((cat) => ({
      key: cat as CategoryFilter,
      label: BADGE_CATEGORY_CONFIG[cat].label,
    })),
  ];

  const topTabs: { key: TopTab; label: string; icon: React.ReactNode }[] = [
    { key: 'badges', label: 'バッジ管理', icon: <Award className="w-4 h-4" /> },
    { key: 'trainings', label: '研修マスタ', icon: <GraduationCap className="w-4 h-4" /> },
  ];

  return (
    <AdminLayout
      headerTitle="バッジ / スキル管理"
      title="バッジ / スキル管理"
      actions={
        topTab === 'badges' ? (
          <button
            onClick={handleCreate}
            className="px-4 py-2 text-sm font-medium text-white bg-ink rounded-lg hover:brightness-[0.85] transition-[transform,filter] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
          >
            + 新規作成
          </button>
        ) : undefined
      }
    >
      {/* トップレベルタブ */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {topTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setTopTab(tab.key)}
            className={`
                flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-[color,border-color] duration-150 active:scale-[0.98] -mb-px
                ${
                  topTab === tab.key
                    ? 'border-ink text-ink'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }
              `}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* バッジ管理タブ */}
      {topTab === 'badges' && (
        <>
          {/* カテゴリフィルタ */}
          <div className="flex gap-1 mb-6 p-1 bg-gray-100 rounded-lg w-fit">
            {categoryTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-[background-color,color,box-shadow] duration-150 ease-out ${
                  filter === tab.key
                    ? 'bg-surface-raised text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* テーブル */}
          {loading ? (
            <Loading size="md" />
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <p className="text-sm">バッジがまだありません</p>
              <button onClick={handleCreate} className="mt-3 text-sm text-ink hover:underline">
                最初のバッジを作成する
              </button>
            </div>
          ) : (
            <div className="bg-surface-raised rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      バッジ
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      カテゴリ
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      ランク
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      説明
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((badge) => {
                    const rankConfig = BADGE_RANK_CONFIG[badge.rank];
                    const inactive = !badge.is_active;
                    return (
                      <tr
                        key={badge.id}
                        className={`hover:bg-gray-50/50 transition-colors ${inactive ? 'opacity-50' : ''}`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div
                              className="w-9 h-9 rounded-lg flex items-center justify-center text-white shadow-sm"
                              style={{
                                background: `linear-gradient(135deg, ${rankConfig.color}, ${rankConfig.color}88)`,
                              }}
                            >
                              <BadgeIcon icon={badge.icon} size={18} />
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-900">
                                {badge.name}
                              </span>
                              {inactive && (
                                <span className="text-[10px] font-semibold text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded">
                                  無効
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                            {BADGE_CATEGORY_CONFIG[badge.category].label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="text-xs font-bold uppercase tracking-wider"
                            style={{ color: rankConfig.color }}
                          >
                            {rankConfig.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">
                          {badge.description || '-'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-3">
                            {!inactive && (
                              <button
                                onClick={() => setAssignTarget(badge)}
                                className="text-xs text-sky-600 hover:underline font-medium"
                              >
                                適用
                              </button>
                            )}
                            <button
                              onClick={() => handleEdit(badge)}
                              className="text-xs text-ink hover:underline"
                            >
                              編集
                            </button>
                            {inactive ? (
                              <button
                                onClick={() => handleEnable(badge)}
                                className="text-xs text-emerald-600 hover:underline"
                              >
                                再有効化
                              </button>
                            ) : (
                              <button
                                onClick={() => handleDisable(badge)}
                                className="text-xs text-amber-600 hover:underline"
                              >
                                無効化
                              </button>
                            )}
                            <button
                              onClick={() => handleHardDelete(badge)}
                              className="text-xs text-red-500 hover:underline"
                            >
                              削除
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* 研修マスタタブ */}
      {topTab === 'trainings' && <TrainingMastersPanel onSuccess={success} onError={toastError} />}

      <BadgeTemplateDialog
        open={dialogOpen}
        onClose={handleDialogClose}
        onSave={handleSave}
        initial={editTarget}
      />

      <BadgeAssignDialog
        open={!!assignTarget}
        badge={assignTarget}
        schoolIds={schoolIds}
        onClose={() => setAssignTarget(null)}
        onSuccess={success}
        onError={toastError}
      />

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}
