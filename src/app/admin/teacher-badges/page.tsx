'use client';

import { useState, useEffect, useCallback } from 'react';
import { AdminLayout } from '@/components/layouts';
import type { TeacherBadge, BadgeCategory } from '@/types/database';
import { BADGE_CATEGORY_CONFIG, BADGE_RANK_CONFIG } from '@/types/database';
import { getTeacherBadges, createTeacherBadge, updateTeacherBadge, deleteTeacherBadge } from '@/lib/api/teacher-badges';
import { BadgeIcon } from '@/components/teacher-badges/BadgeIcon';
import { BadgeTemplateDialog } from '@/components/teacher-badges/BadgeTemplateDialog';

type CategoryFilter = BadgeCategory | 'all';

export default function TeacherBadgesPage() {
  const [badges, setBadges] = useState<TeacherBadge[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<CategoryFilter>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TeacherBadge | null>(null);

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

  useEffect(() => { fetchBadges(); }, [fetchBadges]);

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
  }) => {
    if (editTarget) {
      const updated = await updateTeacherBadge(editTarget.id, data);
      setBadges((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    } else {
      const created = await createTeacherBadge(data);
      setBadges((prev) => [...prev, created]);
    }
  };

  const handleDisable = async (badge: TeacherBadge) => {
    if (!confirm(`「${badge.name}」を無効化しますか？\n（付与済みのデータは残りますが、新規付与はできなくなります）`)) return;
    await deleteTeacherBadge(badge.id);
    setBadges((prev) => prev.map((b) => (b.id === badge.id ? { ...b, is_active: false } : b)));
  };

  const handleEnable = async (badge: TeacherBadge) => {
    const updated = await updateTeacherBadge(badge.id, { is_active: true });
    setBadges((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
  };

  const handleHardDelete = async (badge: TeacherBadge) => {
    if (!confirm(`「${badge.name}」を完全に削除しますか？\n付与済みの全データも削除されます。この操作は取り消せません。`)) return;
    await deleteTeacherBadge(badge.id, { hard: true });
    setBadges((prev) => prev.filter((b) => b.id !== badge.id));
  };

  const filtered = filter === 'all' ? badges : badges.filter((b) => b.category === filter);

  const categoryTabs: { key: CategoryFilter; label: string }[] = [
    { key: 'all', label: 'すべて' },
    ...(['training', 'skill', 'achievement'] as BadgeCategory[]).map((cat) => ({
      key: cat as CategoryFilter,
      label: BADGE_CATEGORY_CONFIG[cat].label,
    })),
  ];

  return (
    <AdminLayout
      headerTitle="バッジ / スキル管理"
      title="バッジ / スキル管理"
      actions={
        <button
          onClick={handleCreate}
          className="px-4 py-2 text-sm font-medium text-white bg-ink rounded-lg hover:brightness-[0.85] transition-colors duration-150"
        >
          + 新規作成
        </button>
      }
    >

        {/* カテゴリタブ */}
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
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-gray-300 border-t-ink rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-sm">バッジがまだありません</p>
            <button
              onClick={handleCreate}
              className="mt-3 text-sm text-ink hover:underline"
            >
              最初のバッジを作成する
            </button>
          </div>
        ) : (
          <div className="bg-surface-raised rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">バッジ</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">カテゴリ</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">ランク</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">説明</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((badge) => {
                  const rankConfig = BADGE_RANK_CONFIG[badge.rank];
                  const inactive = !badge.is_active;
                  return (
                    <tr key={badge.id} className={`hover:bg-gray-50/50 transition-colors ${inactive ? 'opacity-50' : ''}`}>
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
                            <span className="text-sm font-medium text-gray-900">{badge.name}</span>
                            {inactive && (
                              <span className="text-[10px] font-semibold text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded">無効</span>
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

        <BadgeTemplateDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onSave={handleSave}
          initial={editTarget}
        />
    </AdminLayout>
  );
}
