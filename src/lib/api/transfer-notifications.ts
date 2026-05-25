/**
 * 振替確定通知の取得・管理 API
 *
 * createTransferEntry で自動 INSERT されるレコードを参照するための関数群。
 * 実際の送信は将来の Edge Function に委ねる前提なので、ここでは
 *  - 一覧取得（pending / sent / 全件）
 *  - 状態手動更新（送信完了マーク・スキップマーク）
 * だけを提供。
 */

import { supabase } from '@/lib/supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type TransferNotificationStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface TransferNotification {
  id: string;
  school_id: string;
  student_id: string;
  from_entry_id: string | null;
  to_entry_id: string | null;
  from_date: string;
  to_date: string;
  from_time_slot_label: string | null;
  to_time_slot_label: string | null;
  delivery_status: TransferNotificationStatus;
  delivery_method: string | null;
  sent_at: string | null;
  sent_to: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  // join
  student?: { id: string; last_name: string; first_name: string; grade: number };
}

export async function getTransferNotifications(
  schoolIds: string[],
  status?: TransferNotificationStatus,
  limit = 100
): Promise<TransferNotification[]> {
  if (schoolIds.length === 0) return [];
  let q = db
    .from('transfer_notifications')
    .select('*, student:students(id, last_name, first_name, grade)')
    .in('school_id', schoolIds)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status) q = q.eq('delivery_status', status);
  const { data, error } = await q;
  if (error) {
    console.error('Error fetching transfer notifications:', error);
    throw new Error('振替通知の取得に失敗しました');
  }
  return (data || []) as TransferNotification[];
}

/** 手動で「送信済み」マーク（メアド/LINE等を別途送った後の事後記録用） */
export async function markTransferNotificationSent(
  id: string,
  method: string,
  sentTo: string
): Promise<void> {
  const { error } = await db
    .from('transfer_notifications')
    .update({
      delivery_status: 'sent' as TransferNotificationStatus,
      delivery_method: method,
      sent_to: sentTo,
      sent_at: new Date().toISOString(),
      error_message: null,
    })
    .eq('id', id);
  if (error) {
    console.error('Error marking sent:', error);
    throw new Error('送信済みマークに失敗しました');
  }
}

/** 「通知不要」としてスキップ */
export async function skipTransferNotification(id: string): Promise<void> {
  const { error } = await db
    .from('transfer_notifications')
    .update({ delivery_status: 'skipped' as TransferNotificationStatus })
    .eq('id', id);
  if (error) {
    console.error('Error skipping notification:', error);
    throw new Error('スキップに失敗しました');
  }
}
