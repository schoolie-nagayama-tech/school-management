import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';

/**
 * 「生徒スコープの保護者ポータル操作」の共通ゲート。
 *
 * 元は portal-links/route.ts の中のローカル関数だったが、紐づけ候補の検索
 * （portal-links/candidates）でも同じ検証が必要になったので切り出した。
 * 認可の判定が2箇所に分かれると片方だけ緩む事故が起きるため、必ずここを通す。
 *
 * 検証すること（この順序に意味がある）:
 *   1) 認証済みか（未認証は 401）
 *   2) 教室長（manager）以上か（teacher 等は 403）
 *   3) studentId が UUID 形式か（不正値でDBに触らない）
 *   4) 生徒が存在するか（404）
 *   5) ★その生徒の school_id が auth.schoolIds に含まれるか（IDOR防止の核心・403）
 */

/** UUID 形式の緩い検証（ハイフン区切り・16進）。不正値は早期に 400 で弾く。 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PortalStudentScope =
  | { ok?: undefined; error: NextResponse }
  | {
      ok: true;
      supabase: ReturnType<typeof getPortalServiceClient>;
      studentId: string;
      /** 対象生徒の所属校。候補検索の教室スコープに使う。 */
      schoolId: string;
      /** 呼び出し元の権限（admin/owner なら全校、manager なら所属校のみ）。 */
      auth: { userId: string; role: string; schoolIds: string[] };
    };

export async function authorizeStudentScope(
  request: NextRequest,
  studentIdRaw: string
): Promise<PortalStudentScope> {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return { error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }) };
  }
  // 教室長（manager）以上のみ。teacher など下位ロールはここで弾く。
  if (!isManagerOrAbove(auth.role)) {
    return { error: NextResponse.json({ error: '権限がありません' }, { status: 403 }) };
  }
  // パスパラメータの形式検証（不正な studentId でDBに触れない）。
  if (!UUID_RE.test(studentIdRaw)) {
    return { error: NextResponse.json({ error: '生徒IDが不正です' }, { status: 400 }) };
  }

  const supabase = getPortalServiceClient();

  // 生徒の所属校を取得（存在確認も兼ねる）。
  const { data: student, error: studentErr } = await supabase
    .from('students')
    .select('id, school_id')
    .eq('id', studentIdRaw)
    .maybeSingle();

  if (studentErr) {
    console.error('[portalStudentScope] 生徒取得に失敗:', studentErr.message);
    return { error: NextResponse.json({ error: '取得に失敗しました' }, { status: 500 }) };
  }
  if (!student) {
    return { error: NextResponse.json({ error: '生徒が見つかりません' }, { status: 404 }) };
  }

  // ★ 教室スコープ検証（IDOR防止の核心）:
  //   auth.schoolIds は admin/owner なら全校、manager なら所属校のみ。この生徒の school_id が
  //   その中に無ければ「他教室の生徒」なので 403 で弾き、以降のDB操作へ進ませない。
  const schoolId = (student as { school_id: string | null }).school_id;
  if (!schoolId || !auth.schoolIds.includes(schoolId)) {
    return { error: NextResponse.json({ error: '教室スコープ外です' }, { status: 403 }) };
  }

  return { ok: true, supabase, studentId: studentIdRaw, schoolId, auth };
}
