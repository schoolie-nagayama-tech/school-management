import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PortalTimeSlotDto } from '@/types/mypage-schedule';

/**
 * 生徒の所属校に関する軽量な参照情報（時限一覧・面談予約URL）。
 *
 * ★ なぜ切り出したか:
 *   `fetchSchoolTimeSlots` はもともと /api/mypage/schedule に閉じていたが、
 *   ChatView のクイックアクション（TemplateForm）でも同じ「実在する時限」を
 *   select の選択肢に使いたくなった。コピペで二重化すると、片方だけ改修されて
 *   時限の書式がズレる事故になるため、この中立モジュールに集約する。
 */

/**
 * 生徒の所属校ID（students.school_id）。
 *
 * ★ ポータルJWTのクライアントで読む理由: students の portal ポリシーが
 *   「紐づけ生徒・在籍中」に絞ってくれる。fetchSchoolTimeSlots・模試予定導出
 *   （examEvents.ts）の両方が同じ解決を必要とするため、ここに集約する。
 */
export async function fetchStudentSchoolId(
  client: SupabaseClient,
  studentId: string
): Promise<string | null> {
  const { data: student } = await client
    .from('students')
    .select('school_id')
    .eq('id', studentId)
    .maybeSingle();
  return (student as { school_id?: string } | null)?.school_id ?? null;
}

/**
 * その生徒の教室（students.school_id）に実在する時限（有効なもの）を表示順で返す。
 *
 * ★ 生徒の所属校で明示的に絞る理由:
 *   schedule_time_slots の portal ポリシーは「紐づけ生徒のいずれかの所属校」を許す。
 *   兄弟が別教室に通っている保護者だと、絞らなければ両校の時限が混ざって選択肢に出る
 *   （その生徒には存在しない時限を選べてしまう）。RLS は越境を防ぐためのものであって、
 *   「この生徒に出す一覧」の絞り込みはアプリ側の責務。
 *
 * ★ 失敗しても空配列を返す（例外にしない）: 時限一覧は連絡シートの補助的な選択肢で、
 *   これが引けないことを理由に呼び出し元の API 全体を 500 にする価値はない。
 *
 * @param client ポータルJWTのクライアント（RLSが効く）。students / schedule_time_slots
 *   はどちらも portal ロールに grant 済みなのでこれで読める。
 */
export async function fetchSchoolTimeSlots(
  client: SupabaseClient,
  studentId: string
): Promise<PortalTimeSlotDto[]> {
  const schoolId = await fetchStudentSchoolId(client, studentId);
  if (!schoolId) return [];

  const { data: slots } = await client
    .from('schedule_time_slots')
    .select('id, slot_number, start_time, end_time')
    .eq('school_id', schoolId)
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  return (
    (
      (slots ?? []) as unknown as Array<{
        id: string;
        slot_number: number;
        start_time: string | null;
        end_time: string | null;
      }>
    )
      .map((s) => {
        const st = s.start_time?.slice(0, 5) ?? '';
        const et = s.end_time?.slice(0, 5) ?? '';
        return { id: s.id, slotNumber: s.slot_number, slotLabel: st && et ? `${st}〜${et}` : '' };
      })
      // ラベルが作れない時限は選択肢に出さない（保護者に意味のない行を見せない）。
      .filter((s) => s.slotLabel !== '')
  );
}

/**
 * 生徒の所属校の面談予約URL（schools.meeting_booking_url）。
 *
 * ★ なぜ service role で引くか:
 *   schools は portal ロールに grant されていない（ポータルは明示グラント済みテーブルの
 *   紐づけ生徒スコープしか見えない設計。migration 20260714000000 参照）。
 *   /api/mypage/chat/template の meeting_request 処理と同じ経路をここでも使う
 *   （呼び出し元は認可＝紐づけ検証を済ませた後で呼ぶこと）。
 *
 * @param svc service role クライアント（RLSバイパス）。
 * @returns 未設定（教室・生徒が見つからない/URL未設定）なら null。
 */
export async function fetchMeetingBookingUrl(
  svc: SupabaseClient,
  studentId: string
): Promise<string | null> {
  const { data: studentRow } = await svc
    .from('students')
    .select('school_id')
    .eq('id', studentId)
    .maybeSingle();
  const schoolId = (studentRow as { school_id?: string } | null)?.school_id;
  if (!schoolId) return null;

  const { data: schoolRow } = await svc
    .from('schools')
    .select('meeting_booking_url')
    .eq('id', schoolId)
    .maybeSingle();
  return (schoolRow as { meeting_booking_url?: string | null } | null)?.meeting_booking_url ?? null;
}
