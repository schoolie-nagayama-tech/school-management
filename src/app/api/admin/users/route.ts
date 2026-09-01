import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getApiAuth } from '@/lib/api-auth';
import { fetchAllPaged } from '@/lib/utils/supabasePaging';
import { captureApiError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

function toNumArray(v: unknown): number[] {
  if (Array.isArray(v)) return v.map((x) => Number(x)).filter((n) => !Number.isNaN(n));
  if (typeof v === 'string') {
    const trimmed = v.replace(/^\{|\}$/g, '').trim();
    if (!trimmed) return [];
    return trimmed
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n));
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
    // 呼び出し元の認証情報を取得（教室スコープ絞り込みに schoolIds が必要なため
    // requireManager ではなく getApiAuth を使う）
    const { auth } = await getApiAuth(request);
    if (!auth) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    const callerRole = auth.role.toLowerCase();
    if (callerRole !== 'admin' && callerRole !== 'owner' && callerRole !== 'manager') {
      return NextResponse.json({ error: '権限がありません' }, { status: 403 });
    }
    // admin/owner は全教室（schoolIds に全教室が入る）。manager は自分の教室のみに絞る。
    const isGlobalRole = callerRole === 'admin' || callerRole === 'owner';

    const supabaseAdmin = getSupabaseAdmin();
    const roleParam = request.nextUrl.searchParams.get('role');
    const requestTs = request.nextUrl.searchParams.get('t');
    const queryNowIso =
      requestTs && Number.isFinite(Number(requestTs))
        ? new Date(Number(requestTs)).toISOString()
        : new Date().toISOString();

    // 全ユーザープロファイルを取得（直接 SELECT で確実に全件取得。RPC はレプリケーション遅延等で抜けがある場合がある）
    // ユーザー数が 1000 を超えると PostgREST の上限で静かに切り捨てられ一覧から欠落するため、
    // .range() で全件ページング取得する。created_at は一意でないので id を第2ソートキーに加える。
    let profileList: Record<string, unknown>[];
    try {
      profileList = await fetchAllPaged<Record<string, unknown>>((from, to) =>
        supabaseAdmin
          .from('user_profiles')
          .select('*')
          // 一覧URLごとに毎回変わる条件を付与し、古いキャッシュ応答を避ける
          .lte('created_at', queryNowIso)
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to)
      );
    } catch (profilesError) {
      // ここでは Sentry に送らない。再 throw して外側の catch が captureApiError するので、
      // 両方で送ると同じ例外が2件のイベントになる。
      console.error('Error fetching user profiles:', profilesError);
      throw profilesError;
    }
    // ユーザー権限変更を即時反映するためキャッシュ不可
    const noCacheHeaders = {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
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

    // 全ユーザー分の user_schools を取得（複数教室が1件にまとまらないようにする）。
    // userIds はページング取得した filteredProfiles 由来で 1000 を超えうるうえ、
    // user_schools は (ユーザー × 教室) でスケールするため、userIds を 500 件ずつに
    // 分割し、各チャンク内も .range() でページングして全件取得する。
    const userIds = filteredProfiles
      .map((p: Record<string, unknown>) => String(p.id))
      .filter(Boolean);
    const allUserSchools: Record<string, unknown>[] = [];
    const USER_CHUNK = 500;
    try {
      for (let i = 0; i < userIds.length; i += USER_CHUNK) {
        const chunk = userIds.slice(i, i + USER_CHUNK);
        const rows = await fetchAllPaged<Record<string, unknown>>((from, to) =>
          supabaseAdmin
            .from('user_schools')
            .select('*, school:schools(*)')
            .in('user_id', chunk)
            .lte('created_at', queryNowIso)
            .order('user_id')
            .order('school_id')
            .range(from, to)
        );
        allUserSchools.push(...rows);
      }
    } catch (schoolsError) {
      // 上と同じ理由で、再 throw だけして Sentry 送信は外側の catch に任せる。
      console.error('Error fetching user_schools:', schoolsError);
      throw schoolsError;
    }

    // user_id ごとにグループ化
    const userSchoolsByUserId: Record<string, Record<string, unknown>[]> = {};
    for (const row of allUserSchools) {
      const uid = String(row.user_id);
      if (!userSchoolsByUserId[uid]) userSchoolsByUserId[uid] = [];
      userSchoolsByUserId[uid].push(row);
    }

    const usersWithSchools = filteredProfiles.map((profile: Record<string, unknown>) => ({
      ...profile,
      available_slot_numbers_by_day: toSlotNumbersByDay(profile.available_slot_numbers_by_day),
      user_schools: userSchoolsByUserId[String(profile.id)] || [],
    }));

    // manager は自分の所属教室に紐づくユーザーのみ閲覧可（他教室・上位権限者の
    // プロファイル/メール流出を防ぐ）。admin/owner はそのまま全件。
    const scopedUsers = isGlobalRole
      ? usersWithSchools
      : usersWithSchools.filter((u) => {
          const callerSchools = new Set(auth.schoolIds);
          return ((u.user_schools as Array<{ school_id?: string | null }>) || []).some(
            (us) => us.school_id != null && callerSchools.has(String(us.school_id))
          );
        });

    return NextResponse.json({ users: scopedUsers }, { headers: noCacheHeaders });
  } catch (error: unknown) {
    captureApiError(error, {
      route: 'GET /api/admin/users',
    });
    console.error('Failed to fetch users:', error);
    return NextResponse.json({ error: 'ユーザーの取得に失敗しました' }, { status: 500 });
  }
}
