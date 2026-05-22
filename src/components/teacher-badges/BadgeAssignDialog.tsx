'use client';

import { useState, useEffect, useCallback } from 'react';
import type { TeacherBadge } from '@/types/database';
import { BADGE_CATEGORY_CONFIG, BADGE_RANK_CONFIG } from '@/types/database';
import { BadgeIcon } from './BadgeIcon';
import { getBadgeAssignees, toggleTeacherBadge } from '@/lib/api/teacher-badges';
import { fetchWithAuth } from '@/lib/api/auth';
import { emitTeacherBadgesChanged } from '@/lib/teacher-badge-events';
import { Search } from 'lucide-react';

interface UserSchool {
  school_id: string;
  school?: { id: string; name: string };
}

interface TeacherSummary {
  id: string;
  display_name: string;
  last_name?: string;
  first_name?: string;
  user_schools?: UserSchool[];
}

interface BadgeAssignDialogProps {
  open: boolean;
  badge: TeacherBadge | null;
  /** 表示する講師を絞り込む教室ID。未指定なら全講師表示 */
  schoolIds?: string[];
  onClose: () => void;
}

/** バッジを講師にまとめて付与/剥奪するダイアログ */
export function BadgeAssignDialog({ open, badge, schoolIds, onClose }: BadgeAssignDialogProps) {
  const [teachers, setTeachers] = useState<TeacherSummary[]>([]);
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async (badgeId: string) => {
    setLoading(true);
    try {
      const [teachersRes, assigned] = await Promise.all([
        fetchWithAuth('/api/admin/users?role=teacher'),
        getBadgeAssignees(badgeId),
      ]);
      if (teachersRes.ok) {
        const data = await teachersRes.json();
        let users: TeacherSummary[] = (data.users || []).map((u: TeacherSummary) => ({
          id: u.id,
          display_name: u.display_name,
          last_name: u.last_name,
          first_name: u.first_name,
          user_schools: u.user_schools,
        }));
        // 教室IDで絞り込み
        if (schoolIds && schoolIds.length > 0) {
          users = users.filter((u) =>
            (u.user_schools || []).some((us) => schoolIds.includes(us.school_id))
          );
        }
        setTeachers(users);
      }
      setAssignedIds(new Set(assigned));
    } catch {
      // 空で表示
    } finally {
      setLoading(false);
    }
  }, [schoolIds]);

  useEffect(() => {
    if (open && badge) {
      setSearch('');
      fetchData(badge.id);
    }
  }, [open, badge, fetchData]);

  if (!open || !badge) return null;

  const handleToggle = async (teacherId: string) => {
    setTogglingIds((prev) => new Set(prev).add(teacherId));

    const wasAssigned = assignedIds.has(teacherId);
    setAssignedIds((prev) => {
      const next = new Set(prev);
      if (wasAssigned) next.delete(teacherId);
      else next.add(teacherId);
      return next;
    });

    try {
      await toggleTeacherBadge(teacherId, { badgeId: badge.id });
      emitTeacherBadgesChanged(teacherId);
    } catch {
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

  const filtered = search.trim()
    ? teachers.filter((t) => teacherName(t).includes(search.trim()))
    : teachers;

  const rankConfig = BADGE_RANK_CONFIG[badge.rank];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー: バッジ情報 */}
        <div className="p-5 border-b border-gray-100">
          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center text-white shadow-sm flex-shrink-0"
              style={{
                background: `linear-gradient(135deg, ${rankConfig.color}, ${rankConfig.color}88)`,
              }}
            >
              <BadgeIcon icon={badge.icon} size={20} />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">{badge.name}</p>
              <p className="text-xs text-gray-500">
                {BADGE_CATEGORY_CONFIG[badge.category].label}
                {' ・ '}
                <span style={{ color: rankConfig.color }}>{rankConfig.label}</span>
              </p>
            </div>
          </div>

          {/* 検索 */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="講師名で検索..."
              className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
            />
          </div>
        </div>

        {/* 講師リスト */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="text-center py-8 text-sm text-gray-400">読み込み中...</div>
          ) : teachers.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-400">講師が登録されていません</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-xs text-gray-400">該当する講師がいません</div>
          ) : (
            <div className="space-y-0.5">
              {filtered.map((t) => {
                const assigned = assignedIds.has(t.id);
                const toggling = togglingIds.has(t.id);
                return (
                  <label
                    key={t.id}
                    className={`
                      flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors
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
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/50 rounded-b-2xl">
          <span className="text-xs text-gray-500">{assignedIds.size} 名に付与中</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-white bg-[#1e3a5f] rounded-lg hover:bg-[#2a4a6f] transition-colors duration-150"
          >
            完了
          </button>
        </div>
      </div>
    </div>
  );
}
