import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { TODAY_PLAN_FEATURE_KEY } from '@/lib/ai/features';
import type { PlanItem } from '@/lib/ai/todayPlan';

/**
 * 「今日の段取り」の読み書き（サーバー専用）。
 *
 * ★3つの口（GET/PATCH・組む・差し込む）が同じ読み書きをするので1か所に集める。
 *   別々に書くと、片方だけ updated_by を入れ忘れる・片方だけ日付を絞り忘れる、が起きる。
 */

export const PLAN_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PLAN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface StoredPlan {
  plan: PlanItem[];
  /** 朝に組んだ時刻。null なら「まだ組んでいない」 */
  generatedAt: string | null;
}

/** その教室のその日の段取りを読む。行が無ければ「まだ組んでいない」 */
export async function loadPlan(
  supabase: SupabaseClient,
  schoolId: string,
  date: string
): Promise<StoredPlan> {
  const { data } = await supabase
    .from('today_plans')
    .select('plan, generated_at')
    .eq('school_id', schoolId)
    .eq('plan_date', date)
    .maybeSingle();

  const raw = data?.plan;
  return {
    plan: Array.isArray(raw) ? (raw as PlanItem[]) : [],
    generatedAt: (data?.generated_at as string | null) ?? null,
  };
}

/**
 * 段取りを丸ごと置き換える。
 * ★generatedAt は渡されたときだけ書く。省けば既存の値がそのまま残る
 *   （手で直しただけで「組んだ時刻」が今に更新されると、
 *   その日はもう組んだという判定が壊れる）。
 */
export async function savePlan(
  supabase: SupabaseClient,
  input: {
    schoolId: string;
    date: string;
    plan: PlanItem[];
    userId: string;
    generatedAt?: string;
  }
): Promise<boolean> {
  const row: Record<string, unknown> = {
    school_id: input.schoolId,
    plan_date: input.date,
    plan: input.plan,
    updated_by: input.userId,
    updated_at: new Date().toISOString(),
  };
  if (input.generatedAt) row.generated_at = input.generatedAt;

  const { error } = await supabase
    .from('today_plans')
    .upsert(row, { onConflict: 'school_id,plan_date' });

  if (error) {
    console.error('[today-plan] 保存に失敗', error.message);
    return false;
  }
  return true;
}

/** この教室で「今日の段取り」を使ってよいか。★行が無ければOFF */
export async function isTodayPlanEnabled(
  supabase: SupabaseClient,
  schoolId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('school_ai_settings')
    .select('enabled')
    .eq('school_id', schoolId)
    .eq('feature_key', TODAY_PLAN_FEATURE_KEY)
    .maybeSingle();

  return data?.enabled === true;
}
