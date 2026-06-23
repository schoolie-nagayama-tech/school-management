import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { Permission } from '@/types/database';

/**
 * 権限チェック用カスタムフック
 * 指定した権限がない場合、アクセス拒否画面を表示またはリダイレクト
 */
export function useRequirePermission(
  checkPermission: (permissions: Permission) => boolean,
  redirectTo: string = '/students'
) {
  const { permissions, isLoading, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // ログアウト中（userがnull）の場合は権限チェックをスキップ
    if (!user) {
      return;
    }
    if (!isLoading && permissions) {
      if (!checkPermission(permissions)) {
        router.replace(redirectTo);
      }
    }
  }, [permissions, isLoading, user, router, redirectTo, checkPermission]);

  return {
    permissions,
    isLoading,
    hasPermission: permissions ? checkPermission(permissions) : false,
  };
}

/**
 * 編集権限チェック用
 */
export function useCanEdit(editPermissionKey: keyof Permission) {
  const { permissions } = useAuth();
  return permissions?.[editPermissionKey] ?? false;
}
