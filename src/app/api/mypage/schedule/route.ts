import { NextRequest, NextResponse } from 'next/server';
import { requirePortalStudent } from '@/lib/mypage/portalAuth';
import { fetchSchoolTimeSlots, fetchStudentSchoolId } from '@/lib/mypage/schoolInfo';
import { getPortalScheduleEntries } from '@/lib/mypage/schedule';
import { getPortalExamEvents } from '@/lib/mypage/examEvents';
import type {
  PortalScheduleEntryDto,
  PortalTimeSlotDto,
  PortalExamEventDto,
} from '@/types/mypage-schedule';

export const dynamic = 'force-dynamic';

/**
 * 予定ビュー用のスケジュール取得（§4「S. スケジュール」）。
 *
 * GET /api/mypage/schedule?studentId=...&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * ★ ポータルJWTのクライアントで読む（service role では読まない）:
 *   予定は RLS（portal_schedule_entries_select_linked）が「自分の紐づけ生徒・在籍中」に
 *   絞ってくれる。ここで service role を使うと、その多層防御を自ら無効化して
 *   アプリ層の絞り込みミスが即漏洩になる。API を置くのは「認可」のためではなく
 *   **DTO 整形（時限ラベル・教科名・講師名の解決）** のため。
 *
 * ★ 本体（entries の取得＋マスタ解決＋整形）は lib/mypage/schedule.ts の
 *   getPortalScheduleEntries に切り出した。ダッシュボード（app/mypage/page.tsx）も
 *   同じ処理を使うため、ここは「HTTP の皮」（パラメータ検証・認可・timeSlots 同梱）だけを持つ。
 *
 * 表示マッピング（§実装指示）:
 *   kind=regular→通常 / koushu→講習 / test_prep→テスト対策
 *   status=transferred_in→振替 / status=cancelled→休講（打ち消し表示）
 *   ※ ラベル化はクライアント（ScheduleView）で行い、ここは生の値も返す。
 *   DTO の型は @/types/mypage-schedule（クライアントと共有）。
 *
 * 戻り: { ok, entries, timeSlots, exams }
 *   timeSlots は「その生徒の教室に実在する時限」の一覧。振替希望の時限を
 *   自由入力ではなく選択にするために使う（AbsenceSheet）。予定が0件の週でも返す
 *   （＝コマが無い週から開いても選択肢が空にならない）。
 *   exams は申込済み模試（Vもぎ・全県模試・オープン模試）の実施予定。schedule_entries
 *   とは別ソース（form_responses）から導出するため、entries とは別枠で返す
 *   （lib/mypage/examEvents.ts の getPortalExamEvents）。
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const studentId = sp.get('studentId');
  const from = sp.get('from');
  const to = sp.get('to');

  if (!studentId) {
    return NextResponse.json({ error: 'studentId が必要です' }, { status: 400 });
  }
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  if (!from || !ymd.test(from) || !to || !ymd.test(to)) {
    return NextResponse.json({ error: 'from / to（YYYY-MM-DD）が必要です' }, { status: 400 });
  }

  // セッション＋紐づけ検証。RLS でも守られるが、早期に 403 を返して余計なクエリを避ける。
  const auth = await requirePortalStudent(studentId);
  if ('error' in auth) return auth.error;

  const { client } = auth;

  // ── 予定本体（RLS 越し）＋ 教室の時限一覧 ＋ 申込済み模試 ──
  // 互いに独立なので並列に取る（保護者の回線が細い前提。往復を積み上げない）。
  let entries: PortalScheduleEntryDto[];
  let timeSlots: PortalTimeSlotDto[];
  let exams: PortalExamEventDto[];
  try {
    [entries, timeSlots, exams] = await Promise.all([
      getPortalScheduleEntries(client, studentId, from, to),
      fetchSchoolTimeSlots(client, studentId),
      // 模試予定は「所属校ID解決 → 導出」の2段を1本のチェーンとして他と並列に流す
      // （データ最小化のため school_id で絞る）。失敗しても授業予定の表示は巻き添えに
      // しない（ここだけ空配列にフォールバック）。
      fetchStudentSchoolId(client, studentId)
        .then((schoolId) =>
          schoolId ? getPortalExamEvents({ studentId, schoolId, from, to }) : []
        )
        .catch((e) => {
          console.error(
            '[mypage/schedule] 模試予定の取得に失敗:',
            e instanceof Error ? e.message : e
          );
          return [] as PortalExamEventDto[];
        }),
    ]);
  } catch (e) {
    console.error('[mypage/schedule] 予定の取得に失敗:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: '予定の取得に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, entries, timeSlots, exams });
}
