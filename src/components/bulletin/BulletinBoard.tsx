'use client';

import { useState, useEffect, useCallback } from 'react';
import { BulletinPostCard } from './BulletinPostCard';
import { BulletinPostModal } from './BulletinPostModal';
import { BulletinReadersModal } from './BulletinReadersModal';
import {
  getBulletinPosts,
  getBulletinLabels,
  markAsRead,
  archiveBulletinPost,
  getUnreadCount,
} from '@/lib/api/bulletin';
import type { BulletinPost, BulletinLabel } from '@/types/bulletin';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface BulletinBoardProps {
  className?: string;
}

export function BulletinBoard({ className = '' }: BulletinBoardProps) {
  const { getSelectedSchoolIds, profile } = useAuth();
  const { success, error: toastError } = useToast();
  const [posts, setPosts] = useState<BulletinPost[]>([]);
  const [labels, setLabels] = useState<BulletinLabel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isPostModalOpen, setIsPostModalOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<BulletinPost | null>(null);
  const [readersModalPost, setReadersModalPost] = useState<BulletinPost | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  // 編集権限はmanager以上のみ
  const canEdit = profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';
  // 既読機能は講師のみ
  const canRead = profile?.role === 'teacher';
  const userId = profile?.id;

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) {
        setPosts([]);
        setLabels([]);
        return;
      }

      const schoolId = schoolIds[0]; // 最初の教室を使用

      try {
        const [postsData, labelsData] = await Promise.all([
          getBulletinPosts(schoolId, {
            includeArchived: false,
            userId: userId,
          }),
          getBulletinLabels(schoolId),
        ]);

        setPosts(postsData);
        setLabels(labelsData);
      } catch (error: any) {
        // テーブルが存在しない場合は空配列を設定
        if (error?.message?.includes('schema cache') || error?.message?.includes('not found')) {
          console.warn('掲示板テーブルが見つかりません。マイグレーションを実行してください:', error);
          setPosts([]);
          setLabels([]);
          return;
        }
        throw error;
      }

      // 未読件数を取得（講師のみ）
      if (userId && canRead) {
        const count = await getUnreadCount(schoolId, userId);
        setUnreadCount(count);
      } else {
        setUnreadCount(0);
      }
    } catch (error) {
      console.error('Error fetching bulletin data:', error);
      toastError('掲示板の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds, userId, toastError]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRead = useCallback(async (post: BulletinPost) => {
    if (!userId) return;

    try {
      await markAsRead(post.id, userId);
      success('既読にしました');
      await fetchData();
    } catch (error) {
      console.error('Error marking as read:', error);
      toastError('既読の記録に失敗しました');
    }
  }, [userId, success, toastError, fetchData]);

  const handleEdit = useCallback((post: BulletinPost) => {
    setEditingPost(post);
    setIsPostModalOpen(true);
  }, []);

  const handleArchive = useCallback(async (post: BulletinPost) => {
    if (!confirm('この投稿をアーカイブしますか？')) {
      return;
    }

    try {
      await archiveBulletinPost(post.id);
      success('アーカイブしました');
      await fetchData();
    } catch (error) {
      console.error('Error archiving post:', error);
      toastError('アーカイブに失敗しました');
    }
  }, [success, toastError, fetchData]);

  const handleShowReaders = useCallback((post: BulletinPost) => {
    setReadersModalPost(post);
  }, []);

  const handleNewPost = useCallback(() => {
    setEditingPost(null);
    setIsPostModalOpen(true);
  }, []);

  const handlePostSaved = useCallback(() => {
    fetchData();
  }, [fetchData]);

  if (isLoading) {
    return (
      <div className={`bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-4 ${className}`}>
        <div className="flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-[#ff8e3c] border-t-transparent rounded-full animate-spin"></div>
          <span className="ml-2 text-sm text-[#2a2a2a]">掲示板を読み込み中...</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={`bg-[#fffffe] rounded-xl border border-[#0d0d0d] overflow-hidden ${className}`}>
        {/* ヘッダー */}
        <div
          className="flex items-center justify-between p-4 bg-[#eff0f3] border-b border-[#0d0d0d] cursor-pointer hover:bg-[#0d0d0d]/5 transition-colors"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">📢</span>
            <span className="font-semibold text-[#0d0d0d]">
              連絡掲示板
              {canRead && unreadCount > 0 && (
                <span className="ml-2 text-sm text-[#d9376e]">
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
            <button className="text-[#2a2a2a] hover:text-[#0d0d0d] transition-colors">
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
            {posts.length === 0 ? (
              <div className="text-center text-sm text-[#2a2a2a]/70 py-8">
                投稿はありません
              </div>
            ) : (
              posts.map((post) => (
                <BulletinPostCard
                  key={post.id}
                  post={post}
                  canEdit={canEdit}
                  canRead={canRead}
                  onRead={() => handleRead(post)}
                  onEdit={() => handleEdit(post)}
                  onArchive={() => handleArchive(post)}
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
          labels={labels}
          schoolId={getSelectedSchoolIds()[0]}
          onSaved={handlePostSaved}
        />
      )}

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
