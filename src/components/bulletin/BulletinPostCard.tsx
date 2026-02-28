'use client';

import type { BulletinPost } from '@/types/bulletin';
import { Button } from '@/components/ui';
import { Edit2, Trash2, Users, Check } from 'lucide-react';

interface BulletinPostCardProps {
  post: BulletinPost;
  /** 投稿先の教室名（複数教室表示時に表示） */
  schoolName?: string | null;
  canEdit: boolean;
  canRead: boolean; // 講師のみが既読機能を使える
  onRead: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onShowReaders: () => void;
}

export function BulletinPostCard({
  post,
  schoolName,
  canEdit,
  canRead,
  onRead,
  onEdit,
  onDelete,
  onShowReaders,
}: BulletinPostCardProps) {
  const createdDate = new Date(post.created_at).toLocaleDateString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
  });

  const creatorName = post.creator?.display_name || post.creator?.email || '不明';

  return (
    <div
      className={`p-3 rounded-lg border ${
        canRead && post.is_read
          ? 'bg-white border border-gray-200'
          : canRead && !post.is_read
          ? 'bg-white border border-gray-200 border-l-4 border-l-[#d32f2f] shadow-sm'
          : 'bg-white border border-gray-200'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {post.is_pinned && <span className="text-sm shrink-0">📌</span>}
          {canRead && !post.is_read && <span className="text-sm shrink-0">●</span>}
          {post.label && (
            <span
              className="shrink-0 px-2 py-0.5 rounded text-xs font-medium text-white"
              style={{ backgroundColor: post.label.color }}
            >
              {post.label.name}
            </span>
          )}
          <span className="font-semibold text-[#1a1a1a] truncate">{post.title}</span>
        </div>
        {schoolName && (
          <span className="shrink-0 text-xs text-gray-400 ml-2">
            {schoolName}
          </span>
        )}
      </div>

      {/* 本文を表示 */}
      {post.content && (
        <div className="text-sm text-[var(--text)] whitespace-pre-wrap break-words mb-2 pl-0">
          {post.content}
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
        <span>
          {createdDate} {creatorName}
        </span>
        {canEdit && (
          <button
            onClick={onShowReaders}
            className="flex items-center gap-1 text-gray-500 hover:text-gray-700 transition-colors"
          >
            <Users className="w-3 h-3" />
            <span>既読: {post.read_count}人</span>
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {canRead && !post.is_read && (
          <Button
            onClick={onRead}
            variant="secondary"
            size="sm"
            className="text-xs px-2 py-1"
          >
            <Check className="w-3 h-3 mr-1" />
            見ました
          </Button>
        )}
        {canRead && post.is_read && (
          <span className="text-xs text-gray-400">✓既読</span>
        )}
        {canEdit && (
          <>
            <Button
              onClick={onEdit}
              variant="ghost"
              size="sm"
              className="text-xs px-2 py-1"
            >
              <Edit2 className="w-3 h-3 mr-1" />
              編集
            </Button>
            <Button
              onClick={onDelete}
              variant="ghost"
              size="sm"
              className="text-xs px-2 py-1"
            >
              <Trash2 className="w-3 h-3 mr-1" />
              削除
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
