import { NextRequest, NextResponse } from 'next/server';
import { requirePortalStudent } from '@/lib/mypage/portalAuth';
import { fetchSchoolTimeSlots, fetchMeetingBookingUrl } from '@/lib/mypage/schoolInfo';

export const dynamic = 'force-dynamic';

/**
 * チャットのクイックアクション（ChatView の TemplateForm）向けの軽量な教室情報。
 *
 * GET /api/mypage/school-info?student_id=...
 *
 * 戻り: { ok, timeSlots, meetingBookingUrl }
 *   - timeSlots: AbsenceSheet と同じ「実在する時限」一覧（時限を自由入力にしない）。
 *     生徒の所属校で明示的に絞る（fetchSchoolTimeSlots の契約。兄弟が別教室の罠）。
 *   - meetingBookingUrl: 生徒の所属校の面談予約URL。無ければ null
 *     （クライアント側は従来のチャット送信フォームにフォールバックする）。
 *
 * ★ なぜ /api/mypage/schedule に相乗りさせないか:
 *   ChatView のクイックアクションは予定ビュー（ScheduleView）を経由せずに開くため、
 *   予定APIが要求する from/to（期間）を持っていない。ダミー期間を投げるくらいなら、
 *   「今この生徒の教室情報だけ」を返す軽量な専用エンドポイントにするほうが素直。
 *
 * ★ 認可は他の /api/mypage ルートと同じ requirePortalStudent に揃える:
 *   セッション検証＋「紐づけ生徒か」＋「在籍中か」を入口でまとめて見る（書き忘れ防止）。
 */
export async function GET(request: NextRequest) {
  const studentId = request.nextUrl.searchParams.get('student_id');
  if (!studentId) {
    return NextResponse.json({ error: 'student_id が必要です' }, { status: 400 });
  }

  const auth = await requirePortalStudent(studentId);
  if ('error' in auth) return auth.error;

  const { client, svc } = auth;

  // 互いに独立なので並列に取る（保護者の回線が細い前提。往復を積み上げない）。
  const [timeSlots, meetingBookingUrl] = await Promise.all([
    fetchSchoolTimeSlots(client, studentId),
    fetchMeetingBookingUrl(svc, studentId),
  ]);

  return NextResponse.json({ ok: true, timeSlots, meetingBookingUrl });
}
