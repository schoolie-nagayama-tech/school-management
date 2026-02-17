import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireManager } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

function toNumArray(v: unknown): number[] {
  if (Array.isArray(v)) return v.map((x) => Number(x)).filter((n) => !Number.isNaN(n));
  if (typeof v === 'string') {
    const trimmed = v.replace(/^\{|\}$/g, '').trim();
    if (!trimmed) return [];
    return trimmed.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
  }
  return [];
}

function toSlotNumbersByDay(v: unknown): Record<string, number[]> {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    const out: Record<string, number[]> = {};
    for (const key of Object.keys(v as object)) {
      const arr = toNumArray((v as Record<string, unknown>)[key]);
      if (arr.length > 0) out[key] = arr;
    }
    return out;
  }
  return {};
}

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  }

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    db: {
      schema: 'public',
    },
    global: {
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    const authError = await requireManager(request);
    if (authError) return authError;
    const supabaseAdmin = getSupabaseAdmin();
    const roleParam = request.nextUrl.searchParams.get('role');

    // 全ユーザープロファイルを取得（直接 SELECT で確実に全件取得。RPC はレプリケーション遅延等で抜けがある場合がある）
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (profilesError) {
      console.error('Error fetching user profiles:', profilesError);
      throw profilesError;
    }

    const profileList = profiles ?? [];
    const noCacheHeaders = {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
    };
    if (profileList.length === 0) {
      return NextResponse.json({ users: [] }, { headers: noCacheHeaders });
    }

    // role=teacher のときは講師のみ返す（講師一覧用）。それ以外は講師以外を返す（ユーザー管理用：admin, owner, manager など）
    const wantTeachers = roleParam?.toLowerCase().trim() === 'teacher';
    const filteredProfiles = profileList.filter((p: { role?: string | null }) => {
      const r = String(p.role || '').toLowerCase();
      if (wantTeachers) return r === 'teacher';
      return r !== 'teacher';
    });

    if (filteredProfiles.length === 0) {
      return NextResponse.json({ users: [] }, { headers: noCacheHeaders });
    }

    // 全ユーザー分の user_schools を1回で取得（複数教室が1件にまとまらないようにする）
    const userIds = filteredProfiles.map((p: Record<string, unknown>) => String(p.id)).filter(Boolean);
    const { data: allUserSchools, error: schoolsError } = await supabaseAdmin
      .from('user_schools')
      .select('*, school:schools(*)')
      .in('user_id', userIds)
      .order('user_id')
      .order('school_id');

    if (schoolsError) {
      console.error('Error fetching user_schools:', schoolsError);
      throw schoolsError;
    }

    // user_id ごとにグループ化
    const userSchoolsByUserId: Record<string, typeof allUserSchools> = {};
    for (const row of allUserSchools || []) {
      const uid = String(row.user_id);
      if (!userSchoolsByUserId[uid]) userSchoolsByUserId[uid] = [];
      userSchoolsByUserId[uid].push(row);
    }

    const usersWithSchools = filteredProfiles.map((profile: Record<string, unknown>) => ({
      ...profile,
      available_slot_numbers_by_day: toSlotNumbersByDay(profile.available_slot_numbers_by_day),
      user_schools: userSchoolsByUserId[String(profile.id)] || [],
    }));

    return NextResponse.json({ users: usersWithSchools }, { headers: noCacheHeaders });
  } catch (error: any) {
    console.error('Failed to fetch users:', error);
    return NextResponse.json(
      { 
        error: 'ユーザーの取得に失敗しました',
        details: error?.message || 'Unknown error'
      },
      { status: 500 }
    );
  }
}
