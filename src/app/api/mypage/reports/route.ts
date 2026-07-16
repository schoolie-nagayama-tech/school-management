import { NextRequest, NextResponse } from 'next/server';
import { requirePortalStudent } from '@/lib/mypage/portalAuth';
import { getPortalReports } from '@/lib/mypage/reports';

export const dynamic = 'force-dynamic';

/**
 * 授業報告書の一覧（§7-4）。
 *
 * GET /api/mypage/reports?studentId=...
 *
 * ★ 二重の防壁:
 *   (1) requirePortalStudent … セッション＋紐づけ検証（早期に 401/403）
 *   (2) 限定公開ビュー portal_class_reports … 承認済み・紐づけ・在籍・教室スコープ
 *   (1) を書き忘れても (2) が守る／(2) だけでも他生徒は返らない。
 */
export async function GET(request: NextRequest) {
  const studentId = request.nextUrl.searchParams.get('studentId');
  if (!studentId) {
    return NextResponse.json({ error: 'studentId が必要です' }, { status: 400 });
  }

  const auth = await requirePortalStudent(studentId);
  if ('error' in auth) return auth.error;

  const reports = await getPortalReports(auth.client, studentId);
  return NextResponse.json({ ok: true, reports });
}
