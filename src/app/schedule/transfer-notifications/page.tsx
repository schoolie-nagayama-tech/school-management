'use client';

/**
 * 振替確定通知の履歴ページ（室長用）
 *
 * URL: /schedule/transfer-notifications
 *
 * 用途：createTransferEntry で自動記録された通知レコードを一覧表示。
 *      実際のメール/LINE送信は将来の Edge Function に委ねる前提なので、
 *      ここでは「事後ログとして手動で送信済みマーク」「不要ならスキップ」を行う。
 *
 * 表示：
 *  - フィルタ: 未送信 / 送信済み / すべて
 *  - 各行: 生徒 / 元日時 → 先日時 / 状態 / アクション
 */

import { useEffect, useState, useCallback } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent } from '@/components/ui';
import { Button } from '@/components/ui';
import {
  ToastContainer,
  Loading,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  SelectShadcn as Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useAuth } from '@/contexts/AuthContext';
import {
  getTransferNotifications,
  markTransferNotificationSent,
  skipTransferNotification,
  type TransferNotification,
  type TransferNotificationStatus,
} from '@/lib/api/transfer-notifications';
import { Mail, CheckCircle, X, AlertCircle } from 'lucide-react';
import AccessDenied from '@/components/AccessDenied';

function gradeLabel(g: number): string {
  if (g <= 6) return `小${g}`;
  if (g <= 9) return `中${g - 6}`;
  return `高${g - 9}`;
}

export default function TransferNotificationsPage() {
  const { profile, selectedSchoolId, getSelectedSchoolIds } = useAuth();
  const { toasts, removeToast, success, error: toastError } = useToast();

  const [notifications, setNotifications] = useState<TransferNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<TransferNotificationStatus | 'all'>(
    'pending'
  );
  // 「送信済みにマーク」ダイアログ
  const [markTarget, setMarkTarget] = useState<TransferNotification | null>(null);
  const [markMethod, setMarkMethod] = useState('email');
  const [markSentTo, setMarkSentTo] = useState('');

  const isManager =
    profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'owner';

  const load = useCallback(async () => {
    if (!profile) return;
    setIsLoading(true);
    try {
      const schoolIds =
        selectedSchoolId && selectedSchoolId !== 'all'
          ? [selectedSchoolId]
          : getSelectedSchoolIds();
      const data = await getTransferNotifications(
        schoolIds,
        statusFilter === 'all' ? undefined : statusFilter
      );
      setNotifications(data);
    } catch (e) {
      toastError(e instanceof Error ? e.message : '取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [profile, selectedSchoolId, getSelectedSchoolIds, statusFilter, toastError]);

  useEffect(() => {
    load();
  }, [load]);

  const handleMark = async () => {
    if (!markTarget || !markSentTo.trim()) return;
    try {
      await markTransferNotificationSent(markTarget.id, markMethod, markSentTo.trim());
      success('送信済みにマークしました');
      setMarkTarget(null);
      setMarkSentTo('');
      await load();
    } catch (e) {
      toastError(e instanceof Error ? e.message : '更新に失敗しました');
    }
  };

  const handleSkip = async (n: TransferNotification) => {
    if (!confirm('この通知をスキップ（不要扱い）しますか？')) return;
    try {
      await skipTransferNotification(n.id);
      success('スキップしました');
      await load();
    } catch (e) {
      toastError(e instanceof Error ? e.message : '更新に失敗しました');
    }
  };

  if (!isManager) return <AccessDenied />;

  const statusBadge = (s: TransferNotificationStatus) => {
    const cls =
      s === 'pending'
        ? 'bg-amber-100 text-amber-800'
        : s === 'sent'
          ? 'bg-green-100 text-green-800'
          : s === 'failed'
            ? 'bg-red-100 text-red-800'
            : 'bg-gray-100 text-gray-600';
    const label =
      s === 'pending' ? '未送信' : s === 'sent' ? '送信済' : s === 'failed' ? '失敗' : 'スキップ';
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>{label}</span>
    );
  };

  return (
    <AdminLayout>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div className="max-w-4xl mx-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">振替確定通知</h1>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">未送信</SelectItem>
              <SelectItem value="sent">送信済み</SelectItem>
              <SelectItem value="skipped">スキップ</SelectItem>
              <SelectItem value="all">すべて</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-sm text-gray-600">
          振替が確定したコマの通知レコード。実際のメール/LINE送信は別途行い、送信後は「送信済みにマーク」してください。
          通知が不要な場合は「スキップ」で記録できます。
        </p>

        {isLoading ? (
          <Loading />
        ) : notifications.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-gray-500">
              該当する通知はありません
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => {
              const studentName = n.student
                ? `${n.student.last_name} ${n.student.first_name}`
                : n.student_id;
              return (
                <Card key={n.id}>
                  <CardContent className="p-3 flex items-center gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold">{studentName}</span>
                        {n.student && (
                          <span className="text-xs text-gray-500">
                            ({gradeLabel(n.student.grade)})
                          </span>
                        )}
                        {statusBadge(n.delivery_status)}
                      </div>
                      <div className="text-sm text-gray-700">
                        <span className="line-through text-gray-500">
                          {n.from_date} {n.from_time_slot_label}
                        </span>
                        <span className="mx-2 text-indigo-600 font-bold">→</span>
                        <span className="font-semibold">
                          {n.to_date} {n.to_time_slot_label}
                        </span>
                      </div>
                      {n.sent_to && (
                        <div className="text-xs text-gray-500 mt-1">
                          送信先: {n.sent_to} ({n.delivery_method})・
                          {n.sent_at && new Date(n.sent_at).toLocaleString('ja-JP')}
                        </div>
                      )}
                      {n.error_message && (
                        <div className="text-xs text-red-600 mt-1 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          {n.error_message}
                        </div>
                      )}
                    </div>
                    {n.delivery_status === 'pending' && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => {
                            setMarkTarget(n);
                            setMarkSentTo('');
                            setMarkMethod('email');
                          }}
                        >
                          <CheckCircle className="w-4 h-4 mr-1" />
                          送信済にする
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleSkip(n)}>
                          <X className="w-4 h-4 mr-1" />
                          スキップ
                        </Button>
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* 送信済みマーク ダイアログ */}
      <Dialog open={!!markTarget} onOpenChange={(v) => !v && setMarkTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>送信済みにマーク</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              実際に送信した方法と宛先を記録します（事後ログ）。
            </p>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">送信方法</label>
              <Select value={markMethod} onValueChange={setMarkMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">メール</SelectItem>
                  <SelectItem value="line">LINE</SelectItem>
                  <SelectItem value="phone">電話</SelectItem>
                  <SelectItem value="paper">配布物</SelectItem>
                  <SelectItem value="other">その他</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">送信先</label>
              <input
                type="text"
                value={markSentTo}
                onChange={(e) => setMarkSentTo(e.target.value)}
                placeholder="例: parent@example.com / 保護者 LINE / 電話番号"
                className="w-full px-3 py-2 border rounded-md text-sm"
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500 bg-indigo-50 p-2 rounded">
              <Mail className="w-3 h-3" />
              将来：Edge Function が pending を自動送信する仕組みに置き換える予定
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkTarget(null)}>
              キャンセル
            </Button>
            <Button onClick={handleMark} disabled={!markSentTo.trim()}>
              記録
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
