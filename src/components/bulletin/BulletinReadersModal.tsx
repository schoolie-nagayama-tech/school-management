'use client';

import { useState, useEffect } from 'react';
import { Modal, Loading } from '@/components/ui';
import { getPostReaders } from '@/lib/api/bulletin';
import type { BulletinRead } from '@/types/bulletin';
import { supabase } from '@/lib/supabase';

interface BulletinReadersModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 対象の投稿ID一覧（まとめカードは複数教室分をまとめて渡す） */
  postIds: string[];
  postTitle: string;
  /** 未読集計に使う対象教室ID一覧（まとめカードは複数） */
  schoolIds: string[];
}

export function BulletinReadersModal({
  isOpen,
  onClose,
  postIds,
  postTitle,
  schoolIds,
}: BulletinReadersModalProps) {
  const [readers, setReaders] = useState<BulletinRead[]>([]);
  const [unreadUsers, setUnreadUsers] = useState<Array<{ id: string; name: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);

  // postIds/schoolIds は配列なので依存を安定化させるためキー文字列化する
  const postIdsKey = postIds.join(',');
  const schoolIdsKey = schoolIds.join(',');

  useEffect(() => {
    if (isOpen && postIds.length > 0) {
      fetchReaders();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, postIdsKey, schoolIdsKey]);

  const fetchReaders = async () => {
    setIsLoading(true);
    try {
      // 全教室分の既読を集計する
      const readersArrays = await Promise.all(postIds.map((pid) => getPostReaders(pid)));
      const readersData = readersArrays.flat();
      setReaders(readersData);

      // 対象教室すべての全ユーザーを取得（user_schools経由）
      const { data: userSchools, error: userSchoolsError } = await supabase
        .from('user_schools')
        .select('user_id')
        .in('school_id', schoolIds);

      if (userSchoolsError) {
        console.warn('user_schoolsの取得に失敗しました:', userSchoolsError);
        setUnreadUsers([]);
        return;
      }

      if (!userSchools || userSchools.length === 0) {
        setUnreadUsers([]);
        return;
      }

      // user_profilesから情報を取得（講師のみ）
      const userIds = (userSchools || [])
        .map((us: { user_id: string }) => us.user_id)
        .filter(Boolean);
      const { data: userProfiles } = await supabase
        .from('user_profiles')
        .select('id, display_name, email, role')
        .in('id', userIds)
        .eq('role', 'teacher') // 講師のみ
        .eq('is_active', true); // 無効化された講師は未読集計に含めない

      const userMap = new Map(
        (userProfiles || []).map((up) => [
          up.id,
          { display_name: up.display_name, email: up.email },
        ])
      );

      const readUserIds = new Set(readersData.map((r) => r.user_id));
      const unread = (userProfiles || [])
        .filter((up) => !readUserIds.has(up.id))
        .map((up) => {
          const userInfo = userMap.get(up.id);
          return {
            id: up.id,
            name: userInfo?.display_name || userInfo?.email || '不明',
          };
        });
      setUnreadUsers(unread);
    } catch (error) {
      console.error('Error fetching readers:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`「${postTitle}」の既読状況`}>
      <div className="space-y-4">
        <div>
          <h3 className="font-semibold text-[#1f2937] mb-2">既読 ({readers.length}人)</h3>
          {isLoading ? (
            <Loading size="md" />
          ) : readers.length === 0 ? (
            <div className="text-sm text-[#4b5563]/70">既読者はいません</div>
          ) : (
            <div className="space-y-1">
              {readers.map((read) => {
                const readDate = new Date(read.read_at).toLocaleString('ja-JP', {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                });
                const userName = read.user?.display_name || read.user?.email || '不明';
                return (
                  <div key={read.id} className="text-sm text-[#4b5563]">
                    {userName} - {readDate}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {unreadUsers.length > 0 && (
          <div>
            <h3 className="font-semibold text-[#1f2937] mb-2">未読 ({unreadUsers.length}人)</h3>
            <div className="space-y-1">
              {unreadUsers.map((user) => (
                <div key={user.id} className="text-sm text-[#4b5563]/70">
                  {user.name}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
