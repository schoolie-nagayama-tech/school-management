'use client';

import type { BulletinPost } from '@/types/bulletin';
import { Button } from '@/components/ui';
import { Edit2, Archive, Users, Check } from 'lucide-react';

interface BulletinPostCardProps {
  post: BulletinPost;
  canEdit: boolean;
  canRead: boolean; // 講師のみが既読機能を使える
  onRead: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onShowReaders: () => void;
}

export function BulletinPostCard({
  post,
  canEdit,
  canRead,
  onRead,
  onEdit,
  onArchive,
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
          ? 'bg-[#fffffe] border-[#0d0d0d]'
          : canRead && !post.is_read
          ? 'bg-[#eff0f3] border-[#0d0d0d] border-2'
          : 'bg-[#fffffe] border-[#0d0d0d]'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-1">
          {post.is_pinned && <span className="text-sm">📌</span>}
          {canRead && !post.is_read && <span className="text-sm">●</span>}
          {post.label && (
            <span
              className="px-2 py-0.5 rounded text-xs font-medium text-white"
              style={{ backgroundColor: post.label.color }}
            >
              {post.label.name}
            </span>
          )}
          <span className="font-semibold text-[#0d0d0d]">{post.title}</span>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-[#2a2a2a]/70 mb-2">
        <span>
          {createdDate} {creatorName}
        </span>
        {canEdit && (
          <button
            onClick={onShowReaders}
            className="flex items-center gap-1 hover:text-[#0d0d0d] transition-colors"
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
          <span className="text-xs text-[#2a2a2a]/70">✓既読</span>
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
              onClick={onArchive}
              variant="ghost"
              size="sm"
              className="text-xs px-2 py-1"
            >
              <Archive className="w-3 h-3 mr-1" />
              アーカイブ
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
