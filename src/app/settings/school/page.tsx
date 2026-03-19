'use client';

import { useState, useEffect, useRef } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Button, Card, CardHeader, CardTitle, CardContent, Input, ToastContainer } from '@/components/ui';
import Link from 'next/link';
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
  const [notificationEmails, setNotificationEmails] = useState<string[]>([]);
  const [logoUrl, setLogoUrl] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
          setLogoUrl(schoolData.logo_url || '');
          // notification_emails 配列を優先、なければ旧フィールドから復元
          if (schoolData.notification_emails && schoolData.notification_emails.length > 0) {
            setNotificationEmails(schoolData.notification_emails);
          } else if (schoolData.notification_email) {
            setNotificationEmails([schoolData.notification_email]);
          } else {
            setNotificationEmails([]);
          }
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

  // メールアドレスリストを更新
  const updateEmail = (index: number, value: string) => {
    setNotificationEmails((prev) => prev.map((e, i) => (i === index ? value : e)));
  };

  const addEmail = () => {
    setNotificationEmails((prev) => [...prev, '']);
  };

  const removeEmail = (index: number) => {
    setNotificationEmails((prev) => prev.filter((_, i) => i !== index));
  };

  // ロゴ画像アップロード
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !school) return;

    if (file.size > 2 * 1024 * 1024) {
      toastError('ファイルサイズは2MB以下にしてください');
      return;
    }
    if (!file.type.startsWith('image/')) {
      toastError('画像ファイルのみアップロードできます');
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('schoolId', school.id);

      const res = await fetch('/api/upload/logo', {
        method: 'POST',
        body: formData,
      });
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || 'アップロードに失敗しました');
      }

      setLogoUrl(json.url);
      // school オブジェクトも更新
      setSchool({ ...school, logo_url: json.url });
      success('ロゴ画像をアップロードしました');
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'アップロードに失敗しました');
    } finally {
      setIsUploading(false);
      // inputをリセット
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ロゴ画像を削除
  const handleLogoRemove = async () => {
    if (!school) return;
    setIsUploading(true);
    try {
      await updateSchool(school.id, { logo_url: null });
      setLogoUrl('');
      setSchool({ ...school, logo_url: null });
      success('ロゴ画像を削除しました');
    } catch (err) {
      toastError(err instanceof Error ? err.message : '削除に失敗しました');
    } finally {
      setIsUploading(false);
    }
  };

  // 通知先メールアドレスを保存
  const handleSave = async () => {
    if (!school) return;

    const filteredEmails = notificationEmails.map((e) => e.trim()).filter(Boolean);

    setIsSubmitting(true);
    try {
      await updateSchool(school.id, {
        notification_emails: filteredEmails,
        // 旧フィールドも先頭アドレスで更新（後方互換）
        notification_email: filteredEmails[0] ?? null,
      });

      // 更新後のデータを再取得
      const updatedSchool = await getSchool(school.id);
      if (updatedSchool) {
        setSchool(updatedSchool);
        setNotificationEmails(updatedSchool.notification_emails ?? []);
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
          <div className="w-8 h-8 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin"></div>
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
          <div className="w-8 h-8 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin"></div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="教室設定">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div className="max-w-2xl mx-auto">
        <div className="mb-4">
          <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-[#6b7280] hover:text-[#1f2937] transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            設定に戻る
          </Link>
        </div>
        {/* ロゴ設定 */}
        <Card>
          <CardHeader>
            <CardTitle>ポータル表示</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <label className="block text-sm font-medium text-[#1f2937] mb-1">
                ロゴ画像
              </label>
              <div className="flex items-center gap-4">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt="ロゴ"
                    className="w-16 h-16 rounded-xl object-cover border border-[#e5e7eb] bg-[#f9fafb]"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-[#f3f4f6] border border-dashed border-[#d1d5db] flex items-center justify-center">
                    <svg className="w-6 h-6 text-[#9ca3af]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                  <Button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="text-sm"
                  >
                    {isUploading ? 'アップロード中...' : logoUrl ? '画像を変更' : '画像をアップロード'}
                  </Button>
                  {logoUrl && (
                    <button
                      type="button"
                      onClick={handleLogoRemove}
                      disabled={isUploading}
                      className="text-xs text-[#ef4444] hover:text-[#dc2626] transition-colors disabled:opacity-50"
                    >
                      ロゴを削除
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs text-[#6b7280]">
                保護者ポータルのヘッダーに表示されます。2MB以下の画像ファイル。
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>通知設定</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-[#1f2937] mb-2">
                  申込通知先メールアドレス
                </label>

                <div className="space-y-2">
                  {notificationEmails.map((email, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        type="email"
                        value={email}
                        onChange={(e) => updateEmail(index, e.target.value)}
                        placeholder="manager@example.com"
                        className="flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => removeEmail(index)}
                        className="shrink-0 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                        title="削除"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}

                  {notificationEmails.length === 0 && (
                    <p className="text-sm text-gray-400 py-1">通知先が設定されていません</p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={addEmail}
                  className="mt-2 flex items-center gap-1.5 text-sm text-[#1e3a5f] hover:text-[#2a4f7f] font-medium transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  メールアドレスを追加
                </button>

                <p className="mt-2 text-sm text-[#4b5563]">
                  フォームから申込があった際に通知を受け取るメールアドレスです。複数設定すると全員に通知されます。
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
