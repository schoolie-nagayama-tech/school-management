'use client';

import { useState, useEffect } from 'react';
import type { TeacherBadge, BadgeCategory, BadgeRank } from '@/types/database';
import { BADGE_CATEGORY_CONFIG, BADGE_RANK_CONFIG, BADGE_ICON_OPTIONS } from '@/types/database';
import { BadgeIcon } from './BadgeIcon';

interface BadgeTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: {
    name: string;
    category: string;
    rank: string;
    icon: string;
    description: string;
    sort_order: number;
  }) => Promise<void>;
  initial?: TeacherBadge | null;
}

export function BadgeTemplateDialog({ open, onClose, onSave, initial }: BadgeTemplateDialogProps) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<BadgeCategory>('training');
  const [rank, setRank] = useState<BadgeRank>('neutral');
  const [icon, setIcon] = useState('star');
  const [description, setDescription] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initial) {
      setName(initial.name);
      setCategory(initial.category);
      setRank(initial.rank);
      setIcon(initial.icon);
      setDescription(initial.description || '');
      setSortOrder(initial.sort_order);
    } else {
      setName('');
      setCategory('training');
      setRank('neutral');
      setIcon('star');
      setDescription('');
      setSortOrder(0);
    }
  }, [initial, open]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim(), category, rank, icon, description: description.trim(), sort_order: sortOrder });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const rankConfig = BADGE_RANK_CONFIG[rank];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-5">
            <h2 className="text-lg font-bold text-gray-900">
              {initial ? 'バッジを編集' : 'バッジを作成'}
            </h2>

            {/* バッジ名 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">バッジ名</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例: 目標設定研修"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                required
              />
            </div>

            {/* カテゴリ + ランク */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">カテゴリ</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as BadgeCategory)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                >
                  {(Object.keys(BADGE_CATEGORY_CONFIG) as BadgeCategory[]).map((cat) => (
                    <option key={cat} value={cat}>{BADGE_CATEGORY_CONFIG[cat].label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ランク</label>
                <select
                  value={rank}
                  onChange={(e) => setRank(e.target.value as BadgeRank)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                >
                  {(Object.keys(BADGE_RANK_CONFIG) as BadgeRank[]).map((r) => (
                    <option key={r} value={r}>{BADGE_RANK_CONFIG[r].label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* アイコン選択 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">アイコン</label>
              <div className="grid grid-cols-6 gap-2">
                {BADGE_ICON_OPTIONS.map((ic) => (
                  <button
                    key={ic}
                    type="button"
                    onClick={() => setIcon(ic)}
                    className={`
                      flex items-center justify-center w-10 h-10 rounded-lg border-2 transition-all
                      ${icon === ic
                        ? 'border-sky-500 bg-sky-50 text-sky-600 scale-110'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                      }
                    `}
                    title={ic}
                  >
                    <BadgeIcon icon={ic} size={20} />
                  </button>
                ))}
              </div>
            </div>

            {/* プレビュー */}
            <div className="flex justify-center p-4 bg-gray-50 rounded-xl">
              <div className="text-center space-y-2">
                <div
                  className="w-14 h-14 rounded-xl mx-auto flex items-center justify-center text-white shadow-lg"
                  style={{
                    background: `linear-gradient(135deg, ${rankConfig.color}, ${rankConfig.color}88)`,
                  }}
                >
                  <BadgeIcon icon={icon} size={28} />
                </div>
                <p className="text-sm font-semibold text-gray-700">{name || 'バッジ名'}</p>
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: rankConfig.color }}>
                  {rankConfig.label}
                </span>
              </div>
            </div>

            {/* 説明 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">説明（任意）</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="バッジの説明や獲得条件"
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500 resize-none"
              />
            </div>

            {/* 表示順 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">表示順</label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
                className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
              />
            </div>
          </div>

          {/* フッター */}
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50 rounded-b-2xl">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="px-5 py-2 text-sm font-medium text-white bg-[#1e3a5f] rounded-lg hover:bg-[#2a4a6f] disabled:opacity-50 transition-colors"
            >
              {saving ? '保存中...' : initial ? '更新' : '作成'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
