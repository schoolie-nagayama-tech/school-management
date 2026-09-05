import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';

export const dynamic = 'force-dynamic';

/**
 * 講師ごとの「掲示板AIアシスト」の入切（教室長以上）。
 *
 * ★既定はOFF。しきい値で自動ONにはしない（2026-09-04 決定）。
 *   授業中に画面が割り込む機能なので、誰に出すかは人が決める。
 *   「気づいたら出るようになっていた」は、講師がカードを読まなくなる最短の道。
 *
 * ★付け外しは自教室の講師にだけ。掛け持ち講師は教室ごとに別アカウントを持つので、
 *   ここで他教室ぶんの設定まで巻き込むことにはならない。
 *
 * 正典: docs/bulletin-ai-assist.html
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  let body: { teacherId?: unknown; enabled?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const teacherId = typeof body.teacherId === 'string' ? body.teacherId : '';
  if (!UUID_RE.test(teacherId)) {
    return NextResponse.json({ error: '講師IDが不正です' }, { status: 400 });
  }
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: '指定が不正です' }, { status: 400 });
  }

  const supabase = getPortalServiceClient();

  // ★自教室に所属している講師だけ。他教室の講師の設定を触らせない
  const { data: links, error: linkError } = await supabase
    .from('user_schools')
    .select('school_id')
    .eq('user_id', teacherId);

  if (linkError) {
    console.error('[ai/bulletin/assist] 所属の取得に失敗', linkError.message);
    return NextResponse.json({ error: '更新できませんでした' }, { status: 500 });
  }

  const sameSchool = (links ?? []).some((l) => auth.schoolIds.includes(l.school_id as string));
  if (!sameSchool) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const { error } = await supabase
    .from('user_profiles')
    .update({ bulletin_ai_assist: body.enabled })
    .eq('id', teacherId);

  if (error) {
    console.error('[ai/bulletin/assist] 更新に失敗', error.message);
    return NextResponse.json({ error: '更新できませんでした' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, enabled: body.enabled });
}
