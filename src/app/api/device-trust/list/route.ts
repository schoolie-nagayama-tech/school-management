/**
 * GET /api/device-trust/list — 自教室に登録済みの教室端末の一覧。
 *
 * 正典: docs/teacher-home-mode-plan.md §2
 *
 * 教室長以上のみ。auth.schoolIds でスコープするので、他教室の端末は返らない
 * （admin/owner は全校が schoolIds に入るため全件見える）。
 *
 * ★ token_hash は絶対に返さない。返すのは台帳の見出し（ラベル・日時・発行者名）だけ。
 * 失効済みも含めて返す（いつ誰が失効させたかを画面で確認できるようにする）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth, requireManager } from '@/lib/api-auth';
import { getTrustedDeviceServiceClient } from '@/lib/deviceTrust';

export const dynamic = 'force-dynamic';

interface DeviceRow {
  id: string;
  school_id: string;
  label: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
  created_by: string | null;
}

export async function GET(request: NextRequest) {
  const authError = await requireManager(request);
  if (authError) return authError;

  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  if (auth.schoolIds.length === 0) {
    return NextResponse.json({ devices: [] });
  }

  try {
    const db = getTrustedDeviceServiceClient();
    const { data, error } = await db
      .from('trusted_devices')
      .select('id, school_id, label, created_at, last_seen_at, revoked_at, created_by')
      .in('school_id', auth.schoolIds)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const devices = (data ?? []) as DeviceRow[];

    // 発行者名の解決。created_by は auth.users を指しており user_profiles との
    // FK は無いため PostgREST の join が効かない。IDを集めて1回だけ引く。
    const creatorIds = Array.from(
      new Set(devices.map((d) => d.created_by).filter((id): id is string => !!id))
    );
    const creatorNames = new Map<string, string>();
    if (creatorIds.length > 0) {
      const { data: profiles } = await db
        .from('user_profiles')
        .select('id, display_name, email')
        .in('id', creatorIds);
      for (const p of (profiles ?? []) as Array<{
        id: string;
        display_name: string | null;
        email: string | null;
      }>) {
        creatorNames.set(p.id, p.display_name || p.email || '');
      }
    }

    return NextResponse.json({
      devices: devices.map((d) => ({
        id: d.id,
        school_id: d.school_id,
        label: d.label,
        created_at: d.created_at,
        last_seen_at: d.last_seen_at,
        revoked_at: d.revoked_at,
        created_by_name: d.created_by ? (creatorNames.get(d.created_by) ?? null) : null,
      })),
    });
  } catch (e) {
    console.error('[device-trust/list] 端末一覧の取得に失敗しました:', e);
    return NextResponse.json({ error: '端末一覧の取得に失敗しました' }, { status: 500 });
  }
}
