'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
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
      const data = await getTeacherBadges();
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

  const handleDelete = async (badge: TeacherBadge) => {
    if (!confirm(`「${badge.name}」を無効化しますか？`)) return;
    await deleteTeacherBadge(badge.id);
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
    <div className="min-h-screen bg-[#f8f9fa]">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <Link href="/students" className="hover:text-[#1e3a5f]">ホーム</Link>
              <span>/</span>
              <span>バッジ管理</span>
            </div>
            <h1 className="text-xl font-bold text-gray-900">バッジ / スキル管理</h1>
          </div>
          <button
            onClick={handleCreate}
            className="px-4 py-2 text-sm font-medium text-white bg-[#1e3a5f] rounded-lg hover:bg-[#2a4a6f] transition-colors"
          >
            + 新規作成
          </button>
        </div>

        {/* カテゴリタブ */}
        <div className="flex gap-1 mb-6 p-1 bg-gray-100 rounded-lg w-fit">
          {categoryTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                filter === tab.key
                  ? 'bg-white text-gray-900 shadow-sm'
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
            <div className="w-6 h-6 border-2 border-gray-300 border-t-[#1e3a5f] rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-sm">バッジがまだありません</p>
            <button
              onClick={handleCreate}
              className="mt-3 text-sm text-[#1e3a5f] hover:underline"
            >
              最初のバッジを作成する
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
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
                  return (
                    <tr key={badge.id} className="hover:bg-gray-50/50 transition-colors">
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
                          <span className="text-sm font-medium text-gray-900">{badge.name}</span>
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
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handleEdit(badge)}
                            className="text-xs text-[#1e3a5f] hover:underline"
                          >
                            編集
                          </button>
                          <button
                            onClick={() => handleDelete(badge)}
                            className="text-xs text-red-500 hover:underline"
                          >
                            無効化
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
      </div>

      <BadgeTemplateDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
        initial={editTarget}
      />
    </div>
  );
}
