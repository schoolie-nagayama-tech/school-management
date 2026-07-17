import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PortalScheduleEntryDto } from '@/types/mypage-schedule';

/**
 * 保護者ポータルの「予定」取得（Stage 3・§4「S. スケジュール」）。
 *
 * ★ なぜ /api/mypage/schedule/route.ts から切り出したか:
 *   ダッシュボード（app/mypage/page.tsx）も「次の授業」ヒーローに同じ予定データを
 *   使う。ルートにベタ書きのままだと、ダッシュボード側で fetch 経由で同じ処理を
 *   もう一度叩く（＝スピナーが増える）か、ロジックをコピペするかの二択になる。
 *   サーバーコンポーネントから直接呼べる関数として共有し、ルートは薄いラッパーにする。
 *
 * ★ ポータルJWTのクライアントで読む（service role では読まない）:
 *   予定は RLS（portal_schedule_entries_select_linked）が「自分の紐づけ生徒・在籍中」に
 *   絞ってくれる。ここで service role を使うと、その多層防御を自ら無効化して
 *   アプリ層の絞り込みミスが即漏洩になる。
 *
 * 表示マッピング（§実装指示）:
 *   kind=regular→通常 / koushu→講習 / test_prep→テスト対策
 *   status=transferred_in→振替 / status=cancelled→休講（打ち消し表示）
 *   ※ ラベル化は呼び出し側（ScheduleView・DashboardView）で行い、ここは生の値も返す。
 */
export async function getPortalScheduleEntries(
  client: SupabaseClient,
  studentId: string,
  from: string,
  to: string
): Promise<PortalScheduleEntryDto[]> {
  const { data: entriesRaw, error } = await client
    .from('schedule_entries')
    .select('id, entry_date, time_slot_id, teacher_id, subject_ids, seat_label, status, kind')
    .eq('student_id', studentId)
    .gte('entry_date', from)
    .lte('entry_date', to)
    .order('entry_date', { ascending: true });

  if (error) {
    console.error('[mypage/schedule] 予定の取得に失敗:', error.message);
    // 呼び出し側（route / page）でエラーレスポンス・エラー表示に変換してもらう。
    throw new Error('予定の取得に失敗しました');
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
  if (entries.length === 0) return [];

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

  return dtos;
}

/**
 * 今日の JST カレンダー日 'YYYY-MM-DD'。
 * ★ ScheduleView（クライアントコンポーネント）にも同名・同定義の関数がある。
 *   あちらは 'use client' から lib/mypage/*（server-only）を import できないため
 *   意図的に重複させている（types/mypage-schedule.ts 冒頭の注記と同じ理由）。
 *   定義を変えるときはロジックを揃えること。
 */
export function todayJst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' に日数を足す（UTC基準で計算しTZに依存させない）。ScheduleView の addDays と同じ定義。 */
export function addDaysJst(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
