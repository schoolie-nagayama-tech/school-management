/**
 * テスト対策（増コマ）配置 API
 *
 * 増コマ(zoukoma)フォームの回答を「正典」として読み、座席表へ「テスト対策」コマ(kind='test_prep')を
 * 落とし込むための集計を提供する。講習(koushu-period.ts)の配置パネルと同じ思想:
 *   - 生徒ごとに「申込（科目×コマ数）」と「配置済み」を集計
 *   - 生徒が通塾できる枠（増コマフォームの selected_slots）を返し、座席表のセル強調に使う
 *
 * データソース:
 *   - 申込: form_responses (form_type='zoukoma', linked_student_id 紐付け済みのみ)
 *   - 通塾可能枠: response_data.selected_slots（id = "YYYY-MM-DD_時限コード"）
 *   - 時限の開始時刻: form_periods.settings.schedule.periods（時限コード→start_time）
 *   - 配置済み: schedule_entries (kind='test_prep')
 *
 * 注意:
 *   - 増コマの「科目」はフォーム独自の名前キー。Subject マスタへは名前一致でマップする。
 *     一致しない科目は配置できない（subjectId=null）が、申込としては表示する。
 *   - 増コマの時限(4〜7)はフォーム独自の時間定義で、schedule_time_slots とは別体系。
 *     ここでは時限の start_time だけ返し、座席表コマとの対応付けは呼び出し側で行う。
 */

import { supabase } from '@/lib/supabase';
import { getZoukomaPeriods, getZoukomaResponses, getZoukomaPeriodByKey } from './zoukoma';
import type { Subject } from '@/types/database';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface ZoukomaPlacementPeriod {
  /** form_periods.id */
  id: string;
  school_id: string;
  period_key: string;
  label: string;
}

export interface ZoukomaAvailableSlot {
  /** YYYY-MM-DD */
  date: string;
  /** フォーム時限の開始時刻 "HH:MM"（座席表コマとの対応付けに使う）。設定が無ければ null */
  startTime: string | null;
  /** フォーム時限コード（'4'〜'7' 等） */
  periodCode: string;
}

export interface ZoukomaPlacementSubject {
  enrolled: number;
  placed: number;
  subjectName: string;
  /** Subject マスタに名前一致した場合の科目ID。一致しなければ null（配置不可） */
  subjectId: string | null;
}

export interface ZoukomaPlacementRow {
  student_id: string;
  enrolled: number;
  placed: number;
  /** キー = subjectId（一致時）または `name:科目名`（不一致時） */
  bySubject: Record<string, ZoukomaPlacementSubject>;
  availableSlots: ZoukomaAvailableSlot[];
  student?: { id: string; last_name: string; first_name: string; grade: number };
}

/** 学校の増コマ申込期間（座席表ツールバーの「追加授業」セレクト用） */
export async function getZoukomaPlacementPeriods(
  schoolId: string
): Promise<ZoukomaPlacementPeriod[]> {
  const periods = await getZoukomaPeriods(schoolId);
  return periods.map((p) => ({
    id: p.id,
    school_id: p.school_id,
    period_key: p.period_key,
    label: p.title?.trim() ? `${p.title}（増コマ）` : `${p.period_key} 増コマ`,
  }));
}

/**
 * 期間(period_key)のテスト対策配置進捗を生徒別・科目別に集計する。
 * 戻り値: Map<student_id, ZoukomaPlacementRow>
 */
export async function getZoukomaPlacementProgress(
  schoolId: string,
  periodKey: string,
  subjects: Subject[]
): Promise<Map<string, ZoukomaPlacementRow>> {
  const period = await getZoukomaPeriodByKey(schoolId, periodKey);
  // 時限コード→開始時刻 のマップ（フォーム独自時限）
  const startTimeByCode = new Map<string, string>();
  for (const pc of period?.settings?.schedule?.periods ?? []) {
    if (pc?.code != null) startTimeByCode.set(String(pc.code), pc.start_time);
  }
  // 科目名→マスタ科目
  const subjectByName = new Map(subjects.map((s) => [s.name, s]));

  // 紐付け済みの回答だけ対象（linked_student_id が座席表の生徒と一致する）
  const responses = await getZoukomaResponses(schoolId, periodKey);
  const linked = responses.filter((r) => r.linked_student_id);

  const map = new Map<string, ZoukomaPlacementRow>();
  const allDates = new Set<string>();

  for (const r of linked) {
    const sid = r.linked_student_id as string;
    let row = map.get(sid);
    if (!row) {
      row = { student_id: sid, enrolled: 0, placed: 0, bySubject: {}, availableSlots: [] };
      map.set(sid, row);
    }
    // 科目×コマ数（subjects は {科目名: コマ数}）
    const subj = (r.response_data?.subjects ?? {}) as Record<string, number>;
    for (const [name, komaRaw] of Object.entries(subj)) {
      const n = Number(komaRaw) || 0;
      if (n <= 0) continue;
      const master = subjectByName.get(name) ?? null;
      const key = master ? master.id : `name:${name}`;
      if (!row.bySubject[key]) {
        row.bySubject[key] = { enrolled: 0, placed: 0, subjectName: name, subjectId: master?.id ?? null };
      }
      row.bySubject[key].enrolled += n;
      row.enrolled += n;
    }
    // 通塾可能枠（selected_slots id = "YYYY-MM-DD_時限コード"）
    for (const slot of r.response_data?.selected_slots ?? []) {
      const raw = String(slot.id);
      const us = raw.lastIndexOf('_');
      if (us < 0) continue;
      const date = raw.slice(0, us);
      const code = raw.slice(us + 1);
      if (!date) continue;
      row.availableSlots.push({ date, periodCode: code, startTime: startTimeByCode.get(code) ?? null });
      allDates.add(date);
    }
  }

  if (map.size === 0) return map;

  // 生徒情報
  const ids = Array.from(map.keys());
  const { data: students } = await db
    .from('students')
    .select('id, last_name, first_name, grade')
    .in('id', ids);
  for (const s of (students ?? []) as Array<{ id: string; last_name: string; first_name: string; grade: number }>) {
    const row = map.get(s.id);
    if (row) row.student = s;
  }

  // 配置済み（kind='test_prep'）。申込枠の日付範囲でカウント
  const dates = Array.from(allDates).sort();
  if (dates.length > 0) {
    const { data: placedEntries } = await db
      .from('schedule_entries')
      .select('student_id, subject_ids')
      .eq('school_id', schoolId)
      .eq('kind', 'test_prep')
      .in('student_id', ids)
      .gte('entry_date', dates[0])
      .lte('entry_date', dates[dates.length - 1])
      .in('status', ['scheduled', 'completed', 'transferred_in']);
    for (const e of (placedEntries ?? []) as Array<{ student_id: string; subject_ids: string[] | null }>) {
      const row = map.get(e.student_id);
      if (!row) continue;
      row.placed += 1;
      for (const sid of e.subject_ids ?? []) {
        if (row.bySubject[sid]) row.bySubject[sid].placed += 1;
      }
    }
  }

  return map;
}
