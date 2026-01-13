import type { FormPeriod } from '@/types/database';

/**
 * 期間が現在公開中かどうか判定
 */
export function isPeriodActive(period: FormPeriod): boolean {
  if (period.is_archived) return false;
  
  const now = new Date();
  const start = period.publish_start ? new Date(period.publish_start) : null;
  const end = period.publish_end ? new Date(period.publish_end) : null;

  // 開始日未設定は非公開
  if (!start) return false;
  
  // まだ開始前
  if (now < start) return false;
  
  // 終了日なし = 永続公開
  if (!end) return true;
  
  // 終了日以内
  return now <= end;
}

/**
 * 期間のステータスを取得
 */
export function getPeriodStatus(period: FormPeriod): { label: string; color: string } {
  if (period.is_archived) {
    return { label: 'アーカイブ', color: 'bg-gray-200 text-gray-600' };
  }

  const now = new Date();
  const start = period.publish_start ? new Date(period.publish_start) : null;
  const end = period.publish_end ? new Date(period.publish_end) : null;

  if (!start) {
    return { label: '未設定', color: 'bg-gray-100 text-gray-600' };
  }
  if (now < start) {
    return { label: '公開前', color: 'bg-yellow-100 text-yellow-800' };
  }
  if (!end) {
    return { label: '公開中（常時）', color: 'bg-green-100 text-green-800' };
  }
  if (now > end) {
    return { label: '公開終了', color: 'bg-gray-100 text-gray-600' };
  }
  return { label: '公開中', color: 'bg-green-100 text-green-800' };
}
