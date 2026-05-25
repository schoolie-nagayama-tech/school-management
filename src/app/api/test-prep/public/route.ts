import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase env not set');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** GET /api/test-prep/public?token=xxx — 公開トークンで提案書を取得 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdmin();

    // 提案書本体 + 生徒 + 試験種別 + 教室
    const { data: proposal, error } = await admin
      .from('test_prep_proposals')
      .select(`
        *,
        student:students(id, last_name, first_name, grade),
        exam_type:exam_types(id, name),
        school:schools(id, name, code, logo_url)
      `)
      .eq('token', token)
      .in('status', ['sent', 'published'])
      .single();

    if (error || !proposal) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    // 科目
    const { data: subjects } = await admin
      .from('test_prep_proposal_subjects')
      .select('*')
      .eq('proposal_id', proposal.id)
      .order('sort_order');

    // 単元
    const subjectIds = (subjects || []).map((s: { id: string }) => s.id);
    let units: Array<Record<string, unknown>> = [];
    if (subjectIds.length > 0) {
      const { data: unitData } = await admin
        .from('test_prep_proposal_units')
        .select('*')
        .in('subject_id', subjectIds)
        .order('sort_order');
      units = unitData || [];
    }

    // 科目に単元をネスト
    const subjectsWithUnits = (subjects || []).map((s: { id: string }) => ({
      ...s,
      units: units.filter((u: Record<string, unknown>) => u.subject_id === s.id),
    }));

    // 講師情報
    let teacher: { display_name: string | null; email: string | null } | null = null;
    if (proposal.teacher_user_id) {
      const { data: profile } = await admin
        .from('user_profiles')
        .select('display_name, email')
        .eq('id', proposal.teacher_user_id)
        .single();
      if (profile) teacher = profile;
    }

    // 増コマ期間情報
    let zoukomaPeriod: Record<string, unknown> | null = null;
    if (proposal.zoukoma_period_id) {
      const { data: period } = await admin
        .from('form_periods')
        .select('*')
        .eq('id', proposal.zoukoma_period_id)
        .single();
      if (period) zoukomaPeriod = period;
    }

    return NextResponse.json({
      ...proposal,
      subjects: subjectsWithUnits,
      teacher,
      zoukoma_period: zoukomaPeriod,
    });
  } catch (e) {
    console.error('test-prep public API error:', e);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
