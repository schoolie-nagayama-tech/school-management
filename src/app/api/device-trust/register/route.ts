/**
 * POST /api/device-trust/register — この端末を教室端末として登録する。
 *
 * 正典: docs/teacher-home-mode-plan.md §2
 *
 * body: { label: string, schoolId: string }
 * 教室長以上のみ。教室の共有PCで室長が1度だけ実行する運用（§3）。
 *
 * ★ 自教室スコープの検証（IDOR防止）:
 *   schoolId は body で受け取るので、そのまま信じると他教室の端末台帳に行を作れる。
 *   admin/owner は auth.schoolIds に全校が入るためバイパスされる（既存の
 *   isSchoolInScope と同じ作法）。
 *
 * トークンは平文をクッキーへ、DBには hash だけを保存する。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth, isSchoolInScope, requireManager } from '@/lib/api-auth';
import {
  generateTrustedDeviceToken,
  getTrustedDeviceServiceClient,
  hashTrustedDeviceToken,
  setTrustedDeviceCookie,
} from '@/lib/deviceTrust';

export const dynamic = 'force-dynamic';

/** ラベルの上限。台帳の見出しなので長文は不要（UI 側でも制限する） */
const LABEL_MAX_LENGTH = 60;

export async function POST(request: NextRequest) {
  const authError = await requireManager(request);
  if (authError) return authError;

  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  let body: { label?: unknown; schoolId?: unknown };
  try {
    body = (await request.json()) as { label?: unknown; schoolId?: unknown };
  } catch {
    return NextResponse.json({ error: 'リクエストの形式が不正です' }, { status: 400 });
  }

  const label = typeof body.label === 'string' ? body.label.trim() : '';
  const schoolId = typeof body.schoolId === 'string' ? body.schoolId : '';
  if (!label || label.length > LABEL_MAX_LENGTH) {
    return NextResponse.json(
      { error: `端末名を${LABEL_MAX_LENGTH}文字以内で入力してください` },
      { status: 400 }
    );
  }
  if (!schoolId) {
    return NextResponse.json({ error: '教室を選択してください' }, { status: 400 });
  }
  if (!isSchoolInScope(schoolId, auth.schoolIds)) {
    return NextResponse.json({ error: 'この教室を操作する権限がありません' }, { status: 403 });
  }

  const token = generateTrustedDeviceToken();

  try {
    const db = getTrustedDeviceServiceClient();
    const { data, error } = await db
      .from('trusted_devices')
      .insert({
        school_id: schoolId,
        label,
        token_hash: hashTrustedDeviceToken(token),
        created_by: auth.userId,
      })
      .select('id, label')
      .single();

    if (error) throw error;

    const response = NextResponse.json({ id: data.id, label: data.label });
    setTrustedDeviceCookie(response, token);
    return response;
  } catch (e) {
    console.error('[device-trust/register] 端末の登録に失敗しました:', e);
    return NextResponse.json({ error: '端末の登録に失敗しました' }, { status: 500 });
  }
}
