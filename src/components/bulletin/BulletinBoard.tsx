'use client';

import { useState, useEffect, useCallback } from 'react';
import { BulletinPostCard } from './BulletinPostCard';
import { BulletinPostModal } from './BulletinPostModal';
import { BulletinReadersModal } from './BulletinReadersModal';
import {
  getBulletinPosts,
  getBulletinLabels,
  markAsRead,
  deleteBulletinPost,
  getUnreadCount,
} from '@/lib/api/bulletin';
import { getSchools } from '@/lib/api/schools';
import type { BulletinPost, BulletinLabel } from '@/types/bulletin';
import type { School } from '@/types/database';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { Button, InlineLoading } from '@/components/ui';
import { ChevronDown, ChevronUp, Plus, Check, Megaphone } from 'lucide-react';
import { RELEASE_NOTES } from '@/lib/data/releaseNotes';

const UPDATES_LAST_SEEN_KEY = 'updatesBoard_lastSeenDate';

interface BulletinBoardProps {
  className?: string;
}

export function BulletinBoard({ className = '' }: BulletinBoardProps) {
  const { getSelectedSchoolIds, profile } = useAuth();
  const { success, error: toastError } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [posts, setPosts] = useState<BulletinPost[]>([]);
  /** 教室IDごとのラベル一覧（複数教室対応） */
  const [labelsBySchool, setLabelsBySchool] = useState<Record<string, BulletinLabel[]>>({});
  const [schools, setSchools] = useState<School[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isPostModalOpen, setIsPostModalOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<BulletinPost | null>(null);
  const [readersModalPost, setReadersModalPost] = useState<BulletinPost | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  /** 新規投稿で選択中の教室ID（複数選択可） */
  const [postingSchoolIds, setPostingSchoolIds] = useState<string[]>([]);

  // 編集権限はmanager以上のみ
  const canEdit = profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';
  // 既読機能は講師のみ
  const canRead = profile?.role === 'teacher';
  const userId = profile?.id;

  // アップデート情報
  const [updateLastSeen, setUpdateLastSeen] = useState<string | null>(null);
  const [updateMounted, setUpdateMounted] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setUpdateLastSeen(localStorage.getItem(UPDATES_LAST_SEEN_KEY));
      setUpdateMounted(true);
    }
  }, []);

  const recentNotes = RELEASE_NOTES.slice(0, 3);
  const latestDate = recentNotes[0]?.date ?? '';
  const hasUpdateUnread = updateMounted && (!updateLastSeen || updateLastSeen < latestDate);
  const handleMarkUpdateRead = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(UPDATES_LAST_SEEN_KEY, latestDate);
      setUpdateLastSeen(latestDate);
    }
  };

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) {
        setPosts([]);
        setLabelsBySchool({});
        setSchools([]);
        return;
      }

      const schoolIdSet = new Set(schoolIds);

      try {
        const [allSchoolsData, ...postsAndLabelsPerSchool] = await Promise.all([
          getSchools(),
          ...schoolIds.map(async (schoolId) => {
            const [postsData, labelsData] = await Promise.all([
              getBulletinPosts(schoolId, {
                includeArchived: false,
                userId: userId,
              }),
              getBulletinLabels(schoolId),
            ]);
            return { schoolId, posts: postsData, labels: labelsData };
          }),
        ]);

        const schoolsList = (allSchoolsData || []).filter((s) => schoolIdSet.has(s.id));
        setSchools(schoolsList);

        const schoolNameById = Object.fromEntries(schoolsList.map((s) => [s.id, s.name]));
        const labelsBySchoolMap: Record<string, BulletinLabel[]> = {};
        const allPosts: BulletinPost[] = [];

        for (const { schoolId, posts: postsData, labels: labelsData } of postsAndLabelsPerSchool) {
          labelsBySchoolMap[schoolId] = labelsData;
          const name = schoolNameById[schoolId] ?? null;
          for (const post of postsData) {
            allPosts.push({ ...post, school_name: name });
          }
        }

        allPosts.sort((a, b) => {
          if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });

        setLabelsBySchool(labelsBySchoolMap);
        setPosts(allPosts);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '';
        if (message.includes('schema cache') || message.includes('not found')) {
          console.warn('掲示板テーブルが見つかりません。マイグレーションを実行してください:', error);
          setPosts([]);
          setLabelsBySchool({});
          return;
        }
        throw error;
      }

      if (userId && canRead) {
        // 複数教室の未読数を並列取得（シーケンシャル await → Promise.all で N回 → 1ラウンドトリップに削減）
        const counts = await Promise.all(
          schoolIds.map((schoolId) => getUnreadCount(schoolId, userId))
        );
        setUnreadCount(counts.reduce((sum, n) => sum + n, 0));
      } else {
        setUnreadCount(0);
      }

      setPostingSchoolIds((prev) => {
        const valid = prev.filter((id) => schoolIdSet.has(id));
        if (valid.length === prev.length && prev.length > 0) return prev;
        return [...schoolIds];
      });
    } catch (error) {
      console.error('Error fetching bulletin data:', error);
      toastError('掲示板の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds, userId, toastError, canRead]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRead = useCallback(async (post: BulletinPost) => {
    if (!userId) return;

    try {
      await markAsRead(post.id, userId);
      success('既読にしました');
      await fetchData();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('bulletin-unread-changed'));
      }
    } catch (error) {
      console.error('Error marking as read:', error);
      toastError('既読の記録に失敗しました');
    }
  }, [userId, success, toastError, fetchData]);

  const handleEdit = useCallback((post: BulletinPost) => {
    setEditingPost(post);
    setIsPostModalOpen(true);
  }, []);

  const handleDelete = useCallback(async (post: BulletinPost) => {
    if (!(await confirm({ title: '削除確認', description: 'この投稿を削除しますか？', confirmLabel: '削除', variant: 'danger' }))) {
      return;
    }

    try {
      await deleteBulletinPost(post.id);
      success('削除しました');
      await fetchData();
    } catch (error) {
      console.error('Error deleting post:', error);
      toastError('削除に失敗しました');
    }
  }, [confirm, success, toastError, fetchData]);

  const handleShowReaders = useCallback((post: BulletinPost) => {
    setReadersModalPost(post);
  }, []);

  const handleNewPost = useCallback(() => {
    setEditingPost(null);
    setPostingSchoolIds(getSelectedSchoolIds());
    setIsPostModalOpen(true);
  }, [getSelectedSchoolIds]);

  const handlePostSaved = useCallback(() => {
    fetchData();
  }, [fetchData]);

  if (isLoading) {
    return (
      <div className={`bg-[#f8f8f8] rounded-xl border border-gray-200 p-4 ${className}`}>
        <InlineLoading label="掲示板を読み込み中..." />
      </div>
    );
  }

  return (
    <>
      <div className={`bg-[#f8f8f8] rounded-xl border border-gray-200 overflow-hidden ${className}`}>
        {/* ヘッダー */}
        <div
          className="flex items-center justify-between p-4 bg-[#ffebee] border-b border-[#ffcdd2] cursor-pointer hover:bg-[#ffcdd2]/40 transition-colors duration-150"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-[#1a1a1a]" />
            <span className="font-bold text-[#1a1a1a]">
              連絡掲示板
              {canRead && unreadCount > 0 && (
                <span className="ml-2 text-sm text-[#d32f2f] font-semibold">
                  （未読{unreadCount}件）
                </span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && (
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  handleNewPost();
                }}
                size="sm"
                className="text-xs px-2 py-1"
              >
                <Plus className="w-3 h-3 mr-1" />
                新規投稿
              </Button>
            )}
            <button className="text-gray-500 hover:text-gray-700 transition-colors duration-150">
              {isExpanded ? (
                <ChevronUp className="w-5 h-5" />
              ) : (
                <ChevronDown className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>

        {/* 投稿一覧 */}
        {isExpanded && (
          <div className="p-4 space-y-3">
            {/* アップデート情報（未読時のみ表示） */}
            {recentNotes.length > 0 && hasUpdateUnread && (
              <div className="rounded-lg border border-green-200 bg-[#e8f5e9] overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-green-800">アップデート情報</span>
                    {hasUpdateUnread && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-green-600 text-white rounded-full">NEW</span>
                    )}
                  </div>
                  {hasUpdateUnread && (
                    <button
                      onClick={handleMarkUpdateRead}
                      className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-700 px-1.5 py-0.5 rounded hover:bg-green-100 transition-colors duration-150"
                    >
                      <Check className="w-3 h-3" />
                      確認済み
                    </button>
                  )}
                </div>
                <div className="px-3 pb-2 space-y-2">
                  {recentNotes.map((note) => (
                    <div key={note.version}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="px-1.5 py-0.5 bg-green-100 text-green-800 text-[10px] font-semibold rounded">{note.version}</span>
                        <span className="text-[10px] text-gray-500">{note.date}</span>
                        <span className="text-xs font-medium text-[#1a1a1a]">{note.title}</span>
                      </div>
                      <ul className="space-y-0.5 ml-1">
                        {note.items.map((item, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-gray-600">
                            <span className="text-green-500 mt-0.5 shrink-0">•</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {posts.length === 0 && recentNotes.length === 0 ? (
              <div className="text-center text-sm text-gray-400 py-8">
                投稿はありません。{canEdit ? '「新規投稿」ボタンから投稿を作成できます。' : ''}
              </div>
            ) : (
              posts.map((post) => (
                <BulletinPostCard
                  key={post.id}
                  post={post}
                  schoolName={post.school_name}
                  canEdit={canEdit}
                  canRead={canRead}
                  onRead={() => handleRead(post)}
                  onEdit={() => handleEdit(post)}
                  onDelete={() => handleDelete(post)}
                  onShowReaders={() => handleShowReaders(post)}
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* 投稿作成・編集モーダル */}
      {getSelectedSchoolIds().length > 0 && (
        <BulletinPostModal
          isOpen={isPostModalOpen}
          onClose={() => {
            setIsPostModalOpen(false);
            setEditingPost(null);
          }}
          post={editingPost}
          labels={
            editingPost
              ? labelsBySchool[editingPost.school_id] ?? []
              : labelsBySchool[postingSchoolIds[0] ?? getSelectedSchoolIds()[0]] ?? []
          }
          schoolId={editingPost ? editingPost.school_id : postingSchoolIds[0] ?? getSelectedSchoolIds()[0]}
          schoolIds={getSelectedSchoolIds().length > 1 ? getSelectedSchoolIds() : undefined}
          schools={schools}
          selectedSchoolIds={editingPost ? [editingPost.school_id] : postingSchoolIds}
          onSelectedSchoolIdsChange={setPostingSchoolIds}
          onSaved={handlePostSaved}
        />
      )}

      {ConfirmDialog}

      {/* 既読者一覧モーダル */}
      {readersModalPost && (
        <BulletinReadersModal
          isOpen={!!readersModalPost}
          onClose={() => setReadersModalPost(null)}
          postId={readersModalPost.id}
          postTitle={readersModalPost.title}
          schoolId={readersModalPost.school_id}
        />
      )}
    </>
  );
}
