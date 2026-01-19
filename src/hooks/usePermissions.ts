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
  const { permissions, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && permissions) {
      if (!checkPermission(permissions)) {
        router.push(redirectTo);
      }
    }
  }, [permissions, isLoading, router, redirectTo, checkPermission]);

  return { permissions, isLoading, hasPermission: permissions ? checkPermission(permissions) : false };
}

/**
 * 編集権限チェック用
 */
export function useCanEdit(editPermissionKey: keyof Permission) {
  const { permissions } = useAuth();
  return permissions?.[editPermissionKey] ?? false;
}
