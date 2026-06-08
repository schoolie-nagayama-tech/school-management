import { supabase } from '../supabase';
import {
  type AlertSetting,
  type AlertThresholds,
  type AlertType,
  DEFAULT_ALERT_THRESHOLDS,
} from '@/types/alerts';

const ALL_ALERT_TYPES: AlertType[] = [
  'score_drop',
  'score_missing',
  'interview_overdue',
  'application_overdue',
  'interview_task',
  'exam_overdue',
  'homework_not_done',
  'tardy',
  'course_prep_overdue',
  'schedule_change_unapplied',
];

type AlertSettingRow = {
  school_id: string;
  alert_type: string;
  enabled: boolean;
  thresholds: AlertThresholds | null;
};

/** 教室ごとの設定を取得（未保存のタイプはデフォルトで補完） */
export async function getAlertSettings(schoolId: string): Promise<AlertSetting[]> {
  const { data, error } = await (supabase
    .from('alert_settings' as never) as any)
    .select('school_id, alert_type, enabled, thresholds')
    .eq('school_id', schoolId);

  if (error) {
    if (error.code === 'PGRST116' || (error.message ?? '').includes('schema cache')) {
      return ALL_ALERT_TYPES.map((t) => buildDefault(schoolId, t));
    }
    throw new Error(`アラート設定の取得に失敗しました: ${error.message}`);
  }

  const map = new Map<AlertType, AlertSetting>();
  for (const row of (data ?? []) as AlertSettingRow[]) {
    map.set(row.alert_type as AlertType, {
      school_id: row.school_id,
      alert_type: row.alert_type as AlertType,
      enabled: row.enabled,
      thresholds: (row.thresholds as AlertThresholds) ?? {},
    });
  }
  return ALL_ALERT_TYPES.map((t) => map.get(t) ?? buildDefault(schoolId, t));
}

/** 複数教室の設定を一括取得（教室ごとにマージ済み配列を返す） */
export async function getAlertSettingsBySchools(
  schoolIds: string[]
): Promise<Map<string, AlertSetting[]>> {
  if (schoolIds.length === 0) return new Map();
  const { data, error } = await (supabase
    .from('alert_settings' as never) as any)
    .select('school_id, alert_type, enabled, thresholds')
    .in('school_id', schoolIds);

  if (error && !(error.code === 'PGRST116' || (error.message ?? '').includes('schema cache'))) {
    throw new Error(`アラート設定の取得に失敗しました: ${error.message}`);
  }

  const rowsAll = (data ?? []) as AlertSettingRow[];
  const result = new Map<string, AlertSetting[]>();
  for (const sid of schoolIds) {
    const rows = rowsAll.filter((r) => r.school_id === sid);
    const map = new Map<AlertType, AlertSetting>();
    for (const row of rows) {
      map.set(row.alert_type as AlertType, {
        school_id: row.school_id,
        alert_type: row.alert_type as AlertType,
        enabled: row.enabled,
        thresholds: (row.thresholds as AlertThresholds) ?? {},
      });
    }
    result.set(
      sid,
      ALL_ALERT_TYPES.map((t) => map.get(t) ?? buildDefault(sid, t))
    );
  }
  return result;
}

/** 設定を upsert */
export async function upsertAlertSetting(
  schoolId: string,
  alertType: AlertType,
  enabled: boolean,
  thresholds: AlertThresholds
): Promise<void> {
  const { error } = await (supabase.from('alert_settings' as never) as any).upsert(
    {
      school_id: schoolId,
      alert_type: alertType,
      enabled,
      thresholds,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'school_id,alert_type' }
  );
  if (error) {
    throw new Error(`アラート設定の保存に失敗しました: ${error.message}`);
  }
}

/** 教室の全設定をデフォルトに戻す */
export async function resetAlertSettings(schoolId: string): Promise<void> {
  const { error } = await (supabase
    .from('alert_settings' as never) as any)
    .delete()
    .eq('school_id', schoolId);
  if (error) {
    throw new Error(`デフォルトに戻すのに失敗しました: ${error.message}`);
  }
}

function buildDefault(schoolId: string, alertType: AlertType): AlertSetting {
  return {
    school_id: schoolId,
    alert_type: alertType,
    enabled: true,
    thresholds: {},
  };
}

/** 設定値を取り出す（未指定はデフォルト） */
export function resolveThreshold<K extends keyof AlertThresholds>(
  setting: AlertSetting | undefined,
  key: K
): NonNullable<AlertThresholds[K]> {
  return (setting?.thresholds?.[key] ?? DEFAULT_ALERT_THRESHOLDS[key]) as NonNullable<
    AlertThresholds[K]
  >;
}

/** 教室別設定をマージして「最も厳しい / 最も緩い」値で代表させる */
export function pickStrictestThreshold<K extends keyof AlertThresholds>(
  settings: AlertSetting[],
  key: K,
  mode: 'min' | 'max'
): NonNullable<AlertThresholds[K]> {
  const values = settings
    .map((s) => s.thresholds?.[key])
    .filter((v): v is NonNullable<AlertThresholds[K]> => v !== undefined && v !== null);
  if (values.length === 0) return DEFAULT_ALERT_THRESHOLDS[key] as NonNullable<AlertThresholds[K]>;
  return (mode === 'min' ? Math.min(...(values as number[])) : Math.max(...(values as number[]))) as NonNullable<
    AlertThresholds[K]
  >;
}
