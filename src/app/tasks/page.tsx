'use client';

import { AdminLayout } from '@/components/layouts';
import { MonthlyTaskPage } from '@/components/monthly-tasks/MonthlyTaskPage';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';

export default function TasksPage() {
  const { hasPermission, isLoading } = useRequirePermission(
    (p) => p.canAccessBilling
  );

  if (isLoading) {
    return (
      <AdminLayout headerTitle="業務進捗管理表" fullWidth>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#d32f2f]" />
        </div>
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
