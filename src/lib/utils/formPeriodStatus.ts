/**
 * フォーム期間の公開状態を判定するヘルパー。
 *
 * moshi/mogi/shukaisu/youbi/soudan の期間設定ページで共通で使う。
 * zoukoma は返却シェイプが異なるため対象外。
 */

export interface FormPeriodStatus {
  label: string;
  color: 'gray' | 'yellow' | 'green';
}

interface PublishablePeriod {
  is_archived?: boolean | null;
  publish_start?: string | null;
  publish_end?: string | null;
}

export function getFormPeriodStatus(period: PublishablePeriod): FormPeriodStatus {
  if (period.is_archived) {
    return { label: 'アーカイブ', color: 'gray' };
  }

  const now = new Date();
  const start = period.publish_start ? new Date(period.publish_start) : null;
  const end = period.publish_end ? new Date(period.publish_end) : null;

  if (!start) {
    return { label: '未設定', color: 'gray' };
  }
  if (start > now) {
    return { label: '公開前', color: 'yellow' };
  }
  if (!end) {
    return { label: '公開中（常時）', color: 'green' };
  }
  if (end < now) {
    return { label: '公開終了', color: 'gray' };
  }
  return { label: '公開中', color: 'green' };
}
