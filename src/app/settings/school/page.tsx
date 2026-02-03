'use client';

import { useState, useEffect } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Button, Card, CardHeader, CardTitle, CardContent, Input, ToastContainer } from '@/components/ui';
import { getDefaultSchoolId, getSchool, updateSchool } from '@/lib/api/schools';
import { useToast } from '@/hooks/useToast';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import type { School } from '@/types/database';

export default function SchoolSettingsPage() {
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessSettings
  );
  const { toasts, removeToast, success, error: toastError } = useToast();
  
  const [school, setSchool] = useState<School | null>(null);
  const [notificationEmail, setNotificationEmail] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 教室情報を取得
  useEffect(() => {
    const fetchSchool = async () => {
      try {
        const schoolId = getDefaultSchoolId();
        const schoolData = await getSchool(schoolId);
        if (schoolData) {
          setSchool(schoolData);
          setNotificationEmail(schoolData.notification_email || '');
        }
      } catch (error) {
        console.error('Error fetching school:', error);
        toastError('教室情報の取得に失敗しました');
      } finally {
        setIsLoading(false);
      }
    };

    if (hasPermission) {
      fetchSchool();
    }
  }, [hasPermission, toastError]);

  // 通知先メールアドレスを保存
  const handleSave = async () => {
    if (!school) return;

    setIsSubmitting(true);
    try {
      await updateSchool(school.id, {
        notification_email: notificationEmail.trim() || null,
      });
      
      // 更新後のデータを再取得
      const updatedSchool = await getSchool(school.id);
      if (updatedSchool) {
        setSchool(updatedSchool);
        setNotificationEmail(updatedSchool.notification_email || '');
      }
      
      success('通知先メールアドレスを更新しました');
    } catch (error) {
      console.error('Error updating school:', error);
      toastError(
        error instanceof Error ? error.message : '更新に失敗しました'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // 権限チェック中
  if (permissionLoading) {
    return (
      <AdminLayout headerTitle="教室設定">
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-[#3b82f6] border-t-transparent rounded-full animate-spin"></div>
        </div>
      </AdminLayout>
    );
  }

  // 権限なし
  if (!hasPermission) {
    return (
      <AdminLayout headerTitle="教室設定">
        <AccessDenied message="設定ページは教室長以上のみアクセス可能です" />
      </AdminLayout>
    );
  }

  if (isLoading) {
    return (
      <AdminLayout headerTitle="教室設定">
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-[#3b82f6] border-t-transparent rounded-full animate-spin"></div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="教室設定">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>通知設定</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-[#1f2937] mb-1">
                  申込通知先メールアドレス
                </label>
                <Input
                  type="email"
                  value={notificationEmail}
                  onChange={(e) => setNotificationEmail(e.target.value)}
                  placeholder="manager@example.com"
                  className="w-full"
                />
                <p className="mt-1 text-sm text-[#4b5563]">
                  フォームから申込があった際に通知を受け取るメールアドレスです
                </p>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={handleSave}
                  disabled={isSubmitting}
                  className="min-w-[120px]"
                >
                  {isSubmitting ? '保存中...' : '保存'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
