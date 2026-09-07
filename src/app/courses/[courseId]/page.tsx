'use client';

import { useParams } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { Loading } from '@/components/ui';
import AccessDenied from '@/components/AccessDenied';
import { useRequirePermission } from '@/hooks/usePermissions';
import { useLocalSchoolId } from '@/hooks/useLocalSchoolId';
import { CourseEditor } from '@/components/koushu-plan/CourseEditor';

/**
 * 講習テンプレートの編集ページ。中身は CourseEditor（/courses/new と同じ部品）。
 *
 * ★権限判定を必ず先頭に置く。旧実装は読み込み中・コース未取得の早期returnが権限チェックより
 * 前にあり、権限の無い利用者にもコースのデータ取得が走っていた。
 */
export default function CourseDetailPage() {
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessCourses
  );
  const params = useParams();
  const courseId = params?.courseId as string;
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
    <AdminLayout headerTitle="講習を編集">
      <CourseEditor courseId={courseId} schoolId={localSchoolId} />
    </AdminLayout>
  );
}
