'use client';

import { AdminLayout } from '@/components/layouts';
import { Loading } from '@/components/ui';
import AccessDenied from '@/components/AccessDenied';
import { useRequirePermission } from '@/hooks/usePermissions';
import { useLocalSchoolId } from '@/hooks/useLocalSchoolId';
import { CourseEditor } from '@/components/koushu-plan/CourseEditor';

/**
 * 講習テンプレートの新規作成ページ。
 *
 * 編集ページと同じ CourseEditor を courseId 無しで開くだけ。テキストを選ぶところから始まり、
 * 保存を押して初めて講習の行ができる（「作成 → 一覧 → 詳細で設定」の2段構えを廃止した）。
 * 権限判定はデータ取得より先に行う。
 */
export default function NewCoursePage() {
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessCourses
  );
  const { localSchoolId } = useLocalSchoolId();

  if (permissionLoading) {
    return (
      <AdminLayout headerTitle="講習管理">
        <Loading className="min-h-[60vh]" />
      </AdminLayout>
    );
  }

  if (!hasPermission) {
    return (
      <AdminLayout headerTitle="講習管理">
        <AccessDenied message="講習管理ページは教室長以上のみアクセス可能です" />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="講習を新規作成">
      <CourseEditor schoolId={localSchoolId} />
    </AdminLayout>
  );
}
