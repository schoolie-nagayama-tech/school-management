'use client';

import { useState, useEffect } from 'react';
import { Modal, Loading } from '@/components/ui';
import { getPostReaders } from '@/lib/api/bulletin';
import type { BulletinRead } from '@/types/bulletin';
import { supabase } from '@/lib/supabase';

interface BulletinReadersModalProps {
  isOpen: boolean;
  onClose: () => void;
  postId: string;
  postTitle: string;
  schoolId: string;
}

export function BulletinReadersModal({
  isOpen,
  onClose,
  postId,
  postTitle,
  schoolId,
}: BulletinReadersModalProps) {
  const [readers, setReaders] = useState<BulletinRead[]>([]);
  const [unreadUsers, setUnreadUsers] = useState<Array<{ id: string; name: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (isOpen && postId) {
      fetchReaders();
    }
  }, [isOpen, postId]);

  const fetchReaders = async () => {
    setIsLoading(true);
    try {
      const readersData = await getPostReaders(postId);
      setReaders(readersData);

      // 教室の全ユーザーを取得（user_schools経由）
      const { data: userSchools, error: userSchoolsError } = await supabase
        .from('user_schools')
        .select('user_id')
        .eq('school_id', schoolId);

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
      const userIds = (userSchools || []).map((us: { user_id: string }) => us.user_id).filter(Boolean);
      const { data: userProfiles } = await supabase
        .from('user_profiles')
        .select('id, display_name, email, role')
        .in('id', userIds)
        .eq('role', 'teacher'); // 講師のみ

      const userMap = new Map(
        (userProfiles || []).map(up => [up.id, { display_name: up.display_name, email: up.email }])
      );

      const readUserIds = new Set(readersData.map(r => r.user_id));
      const unread = (userProfiles || [])
        .filter(up => !readUserIds.has(up.id))
        .map(up => {
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
          <h3 className="font-semibold text-[#1f2937] mb-2">
            既読 ({readers.length}人)
          </h3>
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
            <h3 className="font-semibold text-[#1f2937] mb-2">
              未読 ({unreadUsers.length}人)
            </h3>
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
