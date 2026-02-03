import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set. Please restart the Next.js server after adding it to .env.local');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const roleParam = request.nextUrl.searchParams.get('role');
    
    // 全ユーザープロファイルを取得（roleは取得後にフィルタ）
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (profilesError) {
      console.error('Error fetching user profiles:', profilesError);
      throw profilesError;
    }

    if (!profiles || profiles.length === 0) {
      return NextResponse.json({ users: [] });
    }

    // roleパラメータがある場合はメモリ上でフィルタ（DBのenum/大文字小文字の差で漏れないようにする）
    const allowedRoles = roleParam
      ? roleParam.split(',').map((r: string) => r.trim().toLowerCase())
      : null;
    const filteredProfiles = allowedRoles
      ? profiles.filter(
          (p: { role?: string | null }) =>
            p.role != null && allowedRoles.includes(String(p.role).toLowerCase())
        )
      : profiles;

    if (filteredProfiles.length === 0) {
      return NextResponse.json({ users: [] });
    }

    // 各ユーザーの教室情報を取得
    const usersWithSchools = await Promise.all(
      filteredProfiles.map(async (profile: Record<string, unknown>) => {
        const { data: userSchools, error: schoolsError } = await supabaseAdmin
          .from('user_schools')
          .select(`
            *,
            school:schools(*)
          `)
          .eq('user_id', profile.id);

        if (schoolsError) {
          console.error(`Error fetching schools for user ${profile.id}:`, schoolsError);
          return {
            ...profile,
            user_schools: [],
          };
        }

        return {
          ...profile,
          available_slot_numbers_by_day: toSlotNumbersByDay(profile.available_slot_numbers_by_day),
          user_schools: userSchools || [],
        };
      })
    );

    return NextResponse.json({ users: usersWithSchools });
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
