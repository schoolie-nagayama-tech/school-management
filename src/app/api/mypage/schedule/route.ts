import { NextRequest, NextResponse } from 'next/server';
import { requirePortalStudent } from '@/lib/mypage/portalAuth';
import type { PortalScheduleEntryDto, PortalTimeSlotDto } from '@/types/mypage-schedule';
import type { SupabaseClient } from '@supabase/supabase-js';

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
 * 表示マッピング（§実装指示）:
 *   kind=regular→通常 / koushu→講習 / test_prep→テスト対策
 *   status=transferred_in→振替 / status=cancelled→休講（打ち消し表示）
 *   ※ ラベル化はクライアント（ScheduleView）で行い、ここは生の値も返す。
 *   DTO の型は @/types/mypage-schedule（クライアントと共有）。
 *
 * 戻り: { ok, entries, timeSlots }
 *   timeSlots は「その生徒の教室に実在する時限」の一覧。振替希望の時限を
 *   自由入力ではなく選択にするために使う（AbsenceSheet）。予定が0件の週でも返す
 *   （＝コマが無い週から開いても選択肢が空にならない）。
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

  // ── 予定本体（RLS 越し）＋ 教室の時限一覧 ──
  // 互いに独立なので並列に取る（保護者の回線が細い前提。往復を積み上げない）。
  const [{ data: entriesRaw, error }, timeSlots] = await Promise.all([
    client
      .from('schedule_entries')
      .select('id, entry_date, time_slot_id, teacher_id, subject_ids, seat_label, status, kind')
      .eq('student_id', studentId)
      .gte('entry_date', from)
      .lte('entry_date', to)
      .order('entry_date', { ascending: true }),
    fetchSchoolTimeSlots(client, studentId),
  ]);

  if (error) {
    console.error('[mypage/schedule] 予定の取得に失敗:', error.message);
    return NextResponse.json({ error: '予定の取得に失敗しました' }, { status: 500 });
  }

  interface EntryRow {
    id: string;
    entry_date: string;
    time_slot_id: string | null;
    teacher_id: string | null;
    subject_ids: string[] | null;
    seat_label: string | null;
    status: string;
    kind: string;
  }
  const entries = (entriesRaw ?? []) as unknown as EntryRow[];
  if (entries.length === 0) {
    // 予定が無くても時限一覧は返す（コマが無い週から連絡シートを開いても選択肢が要る）。
    return NextResponse.json({ ok: true, entries: [], timeSlots });
  }

  // ── 参照マスタをまとめて解決（N+1 を避ける） ──
  const slotIds = Array.from(
    new Set(entries.map((e) => e.time_slot_id).filter((v): v is string => !!v))
  );
  const teacherIds = Array.from(
    new Set(entries.map((e) => e.teacher_id).filter((v): v is string => !!v))
  );
  const subjectIds = Array.from(new Set(entries.flatMap((e) => e.subject_ids ?? [])));

  // 時限（schedule_time_slots は portal に grant 済み・自校のみ可視）。
  const slotMap = new Map<string, { label: string; slotNumber: number; startTime: string }>();
  if (slotIds.length > 0) {
    const { data: slots } = await client
      .from('schedule_time_slots')
      .select('id, slot_number, start_time, end_time')
      .in('id', slotIds);
    for (const s of (slots ?? []) as unknown as Array<{
      id: string;
      slot_number: number;
      start_time: string;
      end_time: string;
    }>) {
      const st = s.start_time?.slice(0, 5) ?? '';
      const et = s.end_time?.slice(0, 5) ?? '';
      slotMap.set(s.id, {
        label: st && et ? `${st}〜${et}` : '',
        slotNumber: s.slot_number,
        startTime: st,
      });
    }
  }

  // 講師名は限定公開ビュー経由（user_profiles 本体は portal に開けない。migration 参照）。
  const teacherMap = new Map<string, string>();
  if (teacherIds.length > 0) {
    const { data: teachers } = await client
      .from('portal_teacher_names')
      .select('id, display_name')
      .in('id', teacherIds);
    for (const t of (teachers ?? []) as unknown as Array<{
      id: string;
      display_name: string | null;
    }>) {
      if (t.display_name) teacherMap.set(t.id, t.display_name);
    }
  }

  // 教科名（subjects は portal に using(true) で開放済み）。
  const subjectMap = new Map<string, string>();
  if (subjectIds.length > 0) {
    const { data: subjects } = await client
      .from('subjects')
      .select('id, name')
      .in('id', subjectIds);
    for (const s of (subjects ?? []) as unknown as Array<{ id: string; name: string }>) {
      subjectMap.set(s.id, s.name);
    }
  }

  const dtos: PortalScheduleEntryDto[] = entries.map((e) => {
    const slot = e.time_slot_id ? slotMap.get(e.time_slot_id) : undefined;
    return {
      id: e.id,
      entryDate: e.entry_date,
      slotNumber: slot?.slotNumber ?? null,
      slotLabel: slot?.label || null,
      startTime: slot?.startTime ?? null,
      status: e.status,
      kind: e.kind,
      subjectNames: (e.subject_ids ?? [])
        .map((id) => subjectMap.get(id))
        .filter((n): n is string => !!n),
      teacherName: e.teacher_id ? (teacherMap.get(e.teacher_id) ?? null) : null,
      seatLabel: e.seat_label,
    };
  });

  // 同日内は開始時刻順（時限が引けないものは末尾）。
  dtos.sort((a, b) => {
    if (a.entryDate !== b.entryDate) return a.entryDate < b.entryDate ? -1 : 1;
    return (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99');
  });

  return NextResponse.json({ ok: true, entries: dtos, timeSlots });
}

/**
 * その生徒の教室に実在する時限（有効なもの）を表示順で返す。
 *
 * ★ 生徒の所属校で明示的に絞る理由:
 *   schedule_time_slots の portal ポリシーは「紐づけ生徒のいずれかの所属校」を許す。
 *   兄弟が別教室に通っている保護者だと、絞らなければ両校の時限が混ざって選択肢に出る
 *   （その生徒には存在しない時限を選べてしまう）。RLS は越境を防ぐためのものであって、
 *   「この生徒に出す一覧」の絞り込みはアプリ側の責務。
 *
 * ★ 失敗しても空配列を返す（例外にしない）: 時限一覧は連絡シートの補助的な選択肢で、
 *   これが引けないことを理由に予定表そのものを 500 にする価値はない。
 */
async function fetchSchoolTimeSlots(
  client: SupabaseClient,
  studentId: string
): Promise<PortalTimeSlotDto[]> {
  const { data: student } = await client
    .from('students')
    .select('school_id')
    .eq('id', studentId)
    .maybeSingle();

  const schoolId = (student as { school_id?: string } | null)?.school_id;
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
