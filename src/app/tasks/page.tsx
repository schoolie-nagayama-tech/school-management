'use client';

import { AdminLayout } from '@/components/layouts';
import { Loading } from '@/components/ui';
import { MonthlyTaskPage } from '@/components/monthly-tasks/MonthlyTaskPage';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';

export default function TasksPage() {
  const { hasPermission, isLoading } = useRequirePermission((p) => p.canAccessBilling);

  if (isLoading) {
    return (
      <AdminLayout headerTitle="業務進捗管理表" fullWidth>
        <Loading />
      </AdminLayout>
    );
  }

  if (!hasPermission) {
    return <AccessDenied />;
  }

  return (
    <AdminLayout headerTitle="業務進捗管理表" fullWidth>
      <MonthlyTaskPage />
    </AdminLayout>
  );
}
