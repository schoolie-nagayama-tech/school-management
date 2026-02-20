import { createClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

export interface AuditLogParams {
  actorId: string;
  actorRole: string;
  action: string; // 'user.create' | 'user.update' | 'user.delete'
  targetType: string; // 'user_profile'
  targetId?: string;
  detail?: Record<string, unknown>;
  request?: NextRequest; // IP取得用（optional）
}

function getIpAddress(request?: NextRequest): string | null {
  if (!request) return null;
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    null
  );
}

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * 監査ログを admin_audit_logs に書き込む。
 * INSERT 失敗時は console.error でログ出力するのみ（処理を止めない）。
 */
export async function writeAuditLog(params: AuditLogParams): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) return;

    const ipAddress = getIpAddress(params.request);

    const { error } = await supabase.from('admin_audit_logs').insert({
      actor_id: params.actorId,
      actor_role: params.actorRole,
      action: params.action,
      target_type: params.targetType,
      target_id: params.targetId ?? null,
      detail: params.detail ?? {},
      ip_address: ipAddress,
    });

    if (error) {
      console.error('[audit-log] INSERT failed:', error);
    }
  } catch (err) {
    console.error('[audit-log] Unexpected error:', err);
  }
}
