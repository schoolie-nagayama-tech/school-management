'use client';

import { useState, useEffect, useCallback } from 'react';
import { AdminLayout } from '@/components/layouts';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@/components/ui';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { ToastContainer } from '@/components/ui';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { USER_ROLE_LABELS } from '@/types/database';
import type { UserRole } from '@/types/database';

const ROLES: UserRole[] = ['admin', 'owner', 'manager', 'teacher', 'parent'];
const MIN_TIMEOUT = 0;
const MAX_TIMEOUT = 300;
const DEFAULT_TIMEOUT = 60;

export type TimeoutByRole = Partial<Record<UserRole, number>>;

function parseTimeoutByRole(value: string | undefined): TimeoutByRole {
  if (!value) return { owner: DEFAULT_TIMEOUT, manager: DEFAULT_TIMEOUT };
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) return { owner: DEFAULT_TIMEOUT, manager: DEFAULT_TIMEOUT };
    const out: TimeoutByRole = {};
    for (const role of ROLES) {
      const v = parsed[role];
      const n = typeof v === 'number' ? v : parseInt(String(v ?? 0), 10);
      out[role] = Number.isNaN(n) ? 0 : Math.max(0, Math.min(MAX_TIMEOUT, n));
    }
    return out;
  } catch {
    return { owner: DEFAULT_TIMEOUT, manager: DEFAULT_TIMEOUT };
  }
}

export default function SecuritySettingsPage() {
  const { profile, isLoading: authLoading } = useAuth();
  const { toasts, removeToast, success, error: toastError } = useToast();
  const [timeoutByRole, setTimeoutByRole] = useState<TimeoutByRole>({
    admin: 0,
    owner: DEFAULT_TIMEOUT,
    manager: DEFAULT_TIMEOUT,
    teacher: 0,
    parent: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/system-settings?category=security', {
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const detail = (errBody?.detail ?? errBody?.error) as string | undefined;
        toastError(detail ? `設定の取得に失敗しました (${res.status}): ${detail}` : `設定の取得に失敗しました (${res.status})`);
        return;
      }
      const json = await res.json();
      const settings = json.settings ?? [];
      for (const s of settings) {
        if (s.key === 'privacy_screen_timeout_by_role') {
          setTimeoutByRole(parseTimeoutByRole(s.value));
          break;
        }
      }
    } catch (err) {
      console.error('Error fetching security settings:', err);
      toastError('設定の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleTimeoutChange = (role: UserRole, value: number) => {
    const clamped = Math.max(MIN_TIMEOUT, Math.min(MAX_TIMEOUT, value));
    setTimeoutByRole((prev) => ({ ...prev, [role]: clamped }));
  };

  const handleSave = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      toastError('セッションが切れています。再ログインしてください。');
      return;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };

    const payload: Record<string, number> = {};
    for (const role of ROLES) {
      payload[role] = timeoutByRole[role] ?? 0;
    }

    setIsSaving(true);
    try {
      const res = await fetch('/api/system-settings/privacy_screen_timeout_by_role', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ value: JSON.stringify(payload) }),
        credentials: 'include',
      });

      const errBody = await res.json().catch(() => ({}));
      const errMessage = (errBody?.error ?? '保存に失敗しました') as string;
      const errDetail = errBody?.detail as string | undefined;

      if (!res.ok) {
        const fullMessage = errDetail
          ? `${errMessage} (${res.status}): ${errDetail}`
          : `${errMessage} (${res.status})`;
        toastError(fullMessage);
        return;
      }

      success('セキュリティ設定を保存しました');
      // 保存した値でその場で表示を更新（再取得でキャッシュやデフォルトに上書きされないようにする）
      setTimeoutByRole(payload);
      // プライバシースクリーンなど他コンポーネントに設定更新を通知
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('system-settings-updated'));
      }
    } catch (err) {
      console.error('Error saving security settings:', err);
      const msg = err instanceof Error ? err.message : 'ネットワークエラーの可能性があります';
      toastError(`保存に失敗しました: ${msg}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (authLoading || !profile) {
    return (
      <AdminLayout headerTitle="講師勤怠">
        <div className="flex justify-center py-12 text-[#4b5563]">
          読み込み中...
        </div>
      </AdminLayout>
    );
  }

  if (profile.role !== 'admin') {
    return (
      <AdminLayout headerTitle="講師勤怠">
        <AccessDenied message="セキュリティ設定はシステム管理者のみアクセスできます。" />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="講師勤怠">
      <div className="space-y-6">
        <div className="mb-4">
          <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-[#6b7280] hover:text-[#1f2937] transition-colors duration-150">
            <ChevronLeft className="w-4 h-4" />
            設定に戻る
          </Link>
        </div>
        <h1 className="text-2xl font-bold">セキュリティ設定</h1>

        {isLoading ? (
          <div className="flex justify-center py-12 text-[#4b5563]">
            読み込み中...
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>プライバシースクリーン</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>プライバシースクリーン タイムアウト（ロール別）</Label>
                <p className="text-xs text-[#6b7280]">
                  0秒＝無効。10〜300秒で無操作時のオーバーレイ表示までの秒数を指定
                </p>
                <div className="space-y-3 mt-3">
                  {ROLES.map((role) => (
                    <div
                      key={role}
                      className="flex items-center gap-4 py-2 border-b border-gray-100 last:border-0"
                    >
                      <label
                        htmlFor={`timeout-${role}`}
                        className="w-36 text-sm font-medium text-[#1a1a1a]"
                      >
                        {USER_ROLE_LABELS[role]}
                      </label>
                      <div className="flex items-center gap-2">
                        <Input
                          id={`timeout-${role}`}
                          type="number"
                          min={MIN_TIMEOUT}
                          max={MAX_TIMEOUT}
                          value={timeoutByRole[role] ?? 0}
                          onChange={(e) =>
                            handleTimeoutChange(
                              role,
                              parseInt(e.target.value, 10) || 0
                            )
                          }
                        />
                        <span className="text-sm text-[#6b7280]">秒</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? '保存中...' : '設定を保存'}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}
