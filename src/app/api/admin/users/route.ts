import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
    const { searchParams } = new URL(request.url);
    const roleParam = searchParams.get('role');
    
    // まずユーザープロファイルを取得
    let query = supabaseAdmin
      .from('user_profiles')
      .select('*');
    
    // roleパラメータがある場合はフィルタリング
    if (roleParam) {
      // カンマ区切りの場合は複数のroleをフィルタリング
      const roles = roleParam.split(',').map(r => r.trim());
      if (roles.length === 1) {
        query = query.eq('role', roles[0]);
      } else if (roles.length > 1) {
        query = query.in('role', roles);
      }
    }
    
    const { data: profiles, error: profilesError } = await query
      .order('created_at', { ascending: false });

    if (profilesError) {
      console.error('Error fetching user profiles:', profilesError);
      throw profilesError;
    }

    if (!profiles || profiles.length === 0) {
      return NextResponse.json({ users: [] });
    }

    // 各ユーザーの教室情報を取得
    const usersWithSchools = await Promise.all(
      profiles.map(async (profile) => {
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
