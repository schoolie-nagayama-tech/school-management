import type { ScheduleEntry } from '@/types/schedule';

/** 生徒詳細「予定表」タブの月の件数まとめ */
export interface StudentScheduleSummary {
  total: number;
  /** 実施済（出席＋遅刻）。遅刻も授業は受けているので実施済に含める */
  present: number;
  /** present のうち遅刻だったもの（内訳表示用。present とは別に数えない） */
  late: number;
  absent: number;
  transferredOut: number;
  /** まだ出欠が付いていない授業（＝これからの予定、または出欠の付け忘れ） */
  scheduled: number;
}

type SummaryEntry = Pick<ScheduleEntry, 'attendance_status' | 'status'>;

/**
 * 予定表の件数まとめを数える。各授業は必ずどれか1つの区分にだけ入る
 * （total = present + absent + transferredOut + scheduled が常に成り立つ）。
 *
 * ★遅刻（attendance_status='late'）は「実施済」に含める。
 *   この画面は保護者に「今月いつですか」「何回来ましたか」と聞かれて即答するためのもので、
 *   遅刻しても授業は受けている＝消化済みのコマ。以前は 'present' だけを見ていたため、
 *   遅刻した過去の授業が「予定」に数えられ、終わった授業をこれからの予定として案内しかねなかった。
 *   遅刻を別の区分に分けると「実施済＋遅刻」を足さないと受けた回数にならず、電話口で計算が要る。
 *   そこで区分は実施済に寄せ、遅刻は「うち遅刻N」の内訳で見せる。
 *
 * 区分の優先度は行の色と同じ 欠席 > 振替元 > 実施済 > 予定。
 * 以前は出欠と振替元を独立に数えて total から両方引いていたため、欠席かつ振替元の行が
 * 二重に引かれて予定が少なく出ることがあった（Math.max(0, …) で負数だけ隠していた）。
 */
export function summarizeStudentSchedule(entries: SummaryEntry[]): StudentScheduleSummary {
  let present = 0;
  let late = 0;
  let absent = 0;
  let transferredOut = 0;
  let scheduled = 0;
  for (const entry of entries) {
    if (entry.attendance_status === 'absent') {
      absent += 1;
    } else if (entry.status === 'transferred_out') {
      transferredOut += 1;
    } else if (entry.attendance_status === 'present' || entry.attendance_status === 'late') {
      present += 1;
      if (entry.attendance_status === 'late') late += 1;
    } else {
      scheduled += 1;
    }
  }
  return { total: entries.length, present, late, absent, transferredOut, scheduled };
}
