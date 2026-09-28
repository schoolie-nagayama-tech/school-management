/**
 * 生徒ハブのヘッダー2行目（担当・通塾）の組み立て。画面から切り離した純粋関数。
 *
 * 正典: docs/student-hub-plan.md §3・§4
 */
import type { ScheduleEntry, ScheduleRegularPattern } from '@/types/schedule';
import { normalizePersonName } from '@/lib/utils/personName';

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 担当講師（座席表由来）。直近の授業から新しい順に講師名を拾い、重複を除いて最大 max 人。
 *
 * ★担当の正典は座席表（schedule_entries.teacher_id）。students.fixed_teacher_ids は「希望」なので使わない。
 * ★取消・振替元のコマは実際に授業をしていないので数えない。担当未決定（teacher_id=NULL）も飛ばす。
 */
export function summarizeRecentTeachers(entries: ScheduleEntry[], max = 3): string[] {
  const sorted = [...entries].sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1));
  const names: string[] = [];
  for (const e of sorted) {
    if (e.status === 'cancelled' || e.status === 'transferred_out') continue;
    if (!e.teacher_id || !e.teacher) continue;
    const t = e.teacher as { display_name?: string | null; last_name?: string | null };
    const name = normalizePersonName(t.display_name || t.last_name || '');
    if (!name || names.includes(name)) continue;
    names.push(name);
    if (names.length >= max) break;
  }
  return names;
}

/**
 * 通塾（今日有効な通常授業の通塾日程）を「週2回 火・金 19:00-20:30」の形にする。
 *
 * ★週回数はコマ数で数える（同じ曜日に2コマなら2回）。曜日の数ではない。
 * 時刻は全コマが同じ時間帯のときだけ添える（曜日ごとに違うと1行に収まらないため）。
 * 通塾日程が無ければ null（ヘッダーには出さない）。
 */
export function summarizeAttendance(patterns: ScheduleRegularPattern[]): string | null {
  if (patterns.length === 0) return null;
  const days = Array.from(new Set(patterns.map((p) => p.day_of_week))).sort((a, b) => {
    // 月曜始まりで並べる（日曜=0 を最後に回す）
    const ka = a === 0 ? 7 : a;
    const kb = b === 0 ? 7 : b;
    return ka - kb;
  });
  const dayText = days.map((d) => DAY_LABELS[d] ?? '').join('・');
  const times = Array.from(
    new Set(
      patterns
        .map((p) =>
          p.time_slot
            ? `${p.time_slot.start_time.slice(0, 5)}-${p.time_slot.end_time.slice(0, 5)}`
            : ''
        )
        .filter((t) => t)
    )
  );
  const timeText = times.length === 1 ? ` ${times[0]}` : '';
  return `週${patterns.length}回 ${dayText}${timeText}`;
}

/** 'YYYY-MM-DD'（ローカル日付） */
export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}
