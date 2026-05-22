'use client';

import { useState, useEffect, useCallback } from 'react';
import type { TeacherBadge, BadgeCategory, BadgeRank } from '@/types/database';
import { BADGE_CATEGORY_CONFIG, BADGE_RANK_CONFIG, BADGE_ICON_OPTIONS } from '@/types/database';
import { BadgeIcon } from './BadgeIcon';
import { getBadgeAssignees, toggleTeacherBadge } from '@/lib/api/teacher-badges';
import { fetchWithAuth } from '@/lib/api/auth';
import { emitTeacherBadgesChanged } from '@/lib/teacher-badge-events';
import { Search } from 'lucide-react';

interface TeacherSummary {
  id: string;
  display_name: string;
  last_name?: string;
  first_name?: string;
}

interface BadgeTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  /** バッジ保存コールバック。保存されたバッジを返すこと（講師付与に必要） */
  onSave: (data: {
    name: string;
    category: string;
    rank: string;
    icon: string;
    description: string;
    sort_order: number;
  }) => Promise<TeacherBadge>;
  initial?: TeacherBadge | null;
  /** 作成後に自動付与する講師ID（講師編集ページからの呼び出し用） */
  autoAssignTeacherId?: string;
}

export function BadgeTemplateDialog({ open, onClose, onSave, initial, autoAssignTeacherId }: BadgeTemplateDialogProps) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<BadgeCategory>('training');
  const [rank, setRank] = useState<BadgeRank>('neutral');
  const [icon, setIcon] = useState('star');
  const [description, setDescription] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [saving, setSaving] = useState(false);

  // 保存済みバッジ（作成後に講師付与パネルを表示するため）
  const [savedBadge, setSavedBadge] = useState<TeacherBadge | null>(null);

  // 講師付与セクション
  const [teachers, setTeachers] = useState<TeacherSummary[]>([]);
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set());
  const [teacherSearch, setTeacherSearch] = useState('');
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());

  // 現在有効なバッジID（既存 or 作成済み）
  const activeBadgeId = initial?.id ?? savedBadge?.id ?? null;

  useEffect(() => {
    if (initial) {
      setName(initial.name);
      setCategory(initial.category);
      setRank(initial.rank);
      setIcon(initial.icon);
      setDescription(initial.description || '');
      setSortOrder(initial.sort_order);
      setSavedBadge(null);
    } else {
      setName('');
      setCategory('training');
      setRank('neutral');
      setIcon('star');
      setDescription('');
      setSortOrder(0);
      setSavedBadge(null);
    }
    setTeacherSearch('');
  }, [initial, open]);

  // 講師一覧 + 付与情報の取得
  const fetchTeachersAndAssignees = useCallback(async (badgeId: string) => {
    setLoadingTeachers(true);
    try {
      const [teachersRes, assigned] = await Promise.all([
        fetchWithAuth('/api/admin/users?role=teacher'),
        getBadgeAssignees(badgeId),
      ]);
      if (teachersRes.ok) {
        const data = await teachersRes.json();
        setTeachers(
          (data.users || []).map((u: TeacherSummary) => ({
            id: u.id,
            display_name: u.display_name,
            last_name: u.last_name,
            first_name: u.first_name,
          }))
        );
      }
      setAssignedIds(new Set(assigned));
    } catch {
      // 取得失敗時は空で表示
    } finally {
      setLoadingTeachers(false);
    }
  }, []);

  // バッジIDが確定したら講師情報を取得
  useEffect(() => {
    if (!open) return;
    if (activeBadgeId) {
      fetchTeachersAndAssignees(activeBadgeId);
    }
  }, [open, activeBadgeId, fetchTeachersAndAssignees]);

  // 作成後に autoAssignTeacherId が指定されていたら自動付与
  useEffect(() => {
    if (!savedBadge || !autoAssignTeacherId) return;
    if (assignedIds.has(autoAssignTeacherId)) return;
    handleToggle(autoAssignTeacherId, savedBadge.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedBadge, autoAssignTeacherId]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const saved = await onSave({
        name: name.trim(),
        category,
        rank,
        icon,
        description: description.trim(),
        sort_order: sortOrder,
      });
      // 新規作成の場合、ダイアログを閉じずに講師付与セクションを表示
      if (!initial) {
        setSavedBadge(saved);
      }
      // 既存バッジの編集時はフォーム値を更新（ダイアログは開いたまま）
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (teacherId: string, badgeId?: string) => {
    const bid = badgeId || activeBadgeId;
    if (!bid) return;

    setTogglingIds((prev) => new Set(prev).add(teacherId));

    // 楽観的更新
    const wasAssigned = assignedIds.has(teacherId);
    setAssignedIds((prev) => {
      const next = new Set(prev);
      if (wasAssigned) next.delete(teacherId);
      else next.add(teacherId);
      return next;
    });

    try {
      await toggleTeacherBadge(teacherId, { badgeId: bid });
      emitTeacherBadgesChanged(teacherId);
    } catch {
      // ロールバック
      setAssignedIds((prev) => {
        const next = new Set(prev);
        if (wasAssigned) next.add(teacherId);
        else next.delete(teacherId);
        return next;
      });
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(teacherId);
        return next;
      });
    }
  };

  const teacherName = (t: TeacherSummary) =>
    [t.last_name, t.first_name].filter(Boolean).join(' ') || t.display_name || '(名前未設定)';

  const filteredTeachers = teacherSearch.trim()
    ? teachers.filter((t) => teacherName(t).includes(teacherSearch.trim()))
    : teachers;

  const rankConfig = BADGE_RANK_CONFIG[rank];
  const isCreated = !!initial || !!savedBadge;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-5">
            <h2 className="text-lg font-bold text-gray-900">
              {savedBadge ? 'バッジを作成しました' : initial ? 'バッジを編集' : 'バッジを作成'}
            </h2>

            {/* バッジ編集フォーム（作成済みの場合は折りたたみ表示） */}
            {!savedBadge && (
              <>
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
                  <div className="grid grid-cols-9 gap-1.5">
                    {BADGE_ICON_OPTIONS.map((ic) => (
                      <button
                        key={ic}
                        type="button"
                        onClick={() => setIcon(ic)}
                        className={`
                          flex items-center justify-center w-9 h-9 rounded-lg border-2 transition-[border-color,background-color,color,transform] duration-150 ease-out
                          ${icon === ic
                            ? 'border-sky-500 bg-sky-50 text-sky-600 scale-110'
                            : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                          }
                        `}
                        title={ic}
                      >
                        <BadgeIcon icon={ic} size={18} />
                      </button>
                    ))}
                  </div>
                </div>

                {/* プレビュー */}
                <div className="flex justify-center p-3 bg-gray-50 rounded-xl">
                  <div className="text-center space-y-1.5">
                    <div
                      className="w-12 h-12 rounded-xl mx-auto flex items-center justify-center text-white shadow-lg"
                      style={{
                        background: `linear-gradient(135deg, ${rankConfig.color}, ${rankConfig.color}88)`,
                      }}
                    >
                      <BadgeIcon icon={icon} size={24} />
                    </div>
                    <p className="text-sm font-semibold text-gray-700">{name || 'バッジ名'}</p>
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: rankConfig.color }}>
                      {rankConfig.label}
                    </span>
                  </div>
                </div>

                {/* 説明 + 表示順 */}
                <div className="grid grid-cols-[1fr_auto] gap-4">
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
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">表示順</label>
                    <input
                      type="number"
                      value={sortOrder}
                      onChange={(e) => setSortOrder(Number(e.target.value))}
                      className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                    />
                  </div>
                </div>
              </>
            )}

            {/* 作成済みバッジのサマリ */}
            {savedBadge && (
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-white shadow-sm flex-shrink-0"
                  style={{
                    background: `linear-gradient(135deg, ${BADGE_RANK_CONFIG[savedBadge.rank].color}, ${BADGE_RANK_CONFIG[savedBadge.rank].color}88)`,
                  }}
                >
                  <BadgeIcon icon={savedBadge.icon} size={20} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{savedBadge.name}</p>
                  <p className="text-xs text-gray-500">
                    {BADGE_CATEGORY_CONFIG[savedBadge.category].label} ・{' '}
                    <span style={{ color: BADGE_RANK_CONFIG[savedBadge.rank].color }}>
                      {BADGE_RANK_CONFIG[savedBadge.rank].label}
                    </span>
                  </p>
                </div>
              </div>
            )}

            {/* 講師に付与セクション（バッジが存在する場合のみ） */}
            {isCreated && (
              <div className="border-t border-gray-200 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-800">講師に付与</h3>
                  <span className="text-xs text-gray-500">
                    {assignedIds.size} 名に付与中
                  </span>
                </div>

                {/* 検索 */}
                <div className="relative mb-3">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={teacherSearch}
                    onChange={(e) => setTeacherSearch(e.target.value)}
                    placeholder="講師名で検索..."
                    className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                  />
                </div>

                {/* 講師リスト */}
                {loadingTeachers ? (
                  <div className="text-center py-6 text-sm text-gray-400">読み込み中...</div>
                ) : teachers.length === 0 ? (
                  <div className="text-center py-6 text-sm text-gray-400">講師が登録されていません</div>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-0.5 border border-gray-100 rounded-lg p-1">
                    {filteredTeachers.map((t) => {
                      const assigned = assignedIds.has(t.id);
                      const toggling = togglingIds.has(t.id);
                      return (
                        <label
                          key={t.id}
                          className={`
                            flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors
                            ${assigned ? 'bg-sky-50' : 'hover:bg-gray-50'}
                            ${toggling ? 'opacity-60 pointer-events-none' : ''}
                          `}
                        >
                          <input
                            type="checkbox"
                            checked={assigned}
                            onChange={() => handleToggle(t.id)}
                            className="rounded border-gray-300 text-sky-500 focus:ring-sky-500"
                            disabled={toggling}
                          />
                          <span className="text-sm text-gray-800">{teacherName(t)}</span>
                        </label>
                      );
                    })}
                    {filteredTeachers.length === 0 && (
                      <div className="text-center py-4 text-xs text-gray-400">該当する講師がいません</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* フッター */}
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50 rounded-b-2xl">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors duration-150"
            >
              {savedBadge ? '完了' : 'キャンセル'}
            </button>
            {!savedBadge && (
              <button
                type="submit"
                disabled={saving || !name.trim()}
                className="px-5 py-2 text-sm font-medium text-white bg-[#1e3a5f] rounded-lg hover:bg-[#2a4a6f] disabled:opacity-50 transition-colors duration-150"
              >
                {saving ? '保存中...' : initial ? '更新' : '作成'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
