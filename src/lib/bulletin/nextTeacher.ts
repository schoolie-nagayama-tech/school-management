/**
 * 「次にその生徒の授業をする講師」を、座席表のコマから選ぶ。
 *
 * 正典: docs/bulletin-ai-assist.html
 *
 * ★名簿上の担当ではない（2026-09-04 訂正）。生徒に固定の担当が付いているとは限らず、
 *   曜日で講師が変わる。頼みたい相手は「その生徒の前に座る講師」。
 *
 * ★固定講師や進行表へのフォールバックはしない。コマが無い生徒は誰にも頼めないので、
 *   名前だけ埋めても督促先にならない。決まらなければ null のままにする。
 *
 * DBアクセスはAPI側。ここは「引いてきたコマからどれを選ぶか」だけを持つ。
 */

/** 判定に必要なコマ1件ぶん */
export interface LessonSlot {
  studentId: string;
  /** 講師が未定のコマは呼び出し側で除いてよいが、ここでも弾く */
  teacherId: string | null;
  /** YYYY-MM-DD */
  entryDate: string;
  /** 時限。同じ日に複数コマあるときの順番に使う */
  slotNumber: number | null;
}

/** 時限が取れなかったコマは、同じ日の中でいちばん後ろに置く */
const UNKNOWN_SLOT = 99;

/**
 * 生徒ごとに「いちばん早い、講師が決まっているコマ」の講師を返す。
 *
 * ★いちばん近いコマではなく「いちばん近い“決まっている”コマ」を採る。
 *   本番では直近のコマほど teacher_id が未定で、先のコマには入っている
 *   （永山校: 14日以内だと81名中34名しか決まらないが、期間全体なら75名決まる）。
 *   近いコマだけを見ると、決まっているのに「担当なし」に落ちる生徒が増える。
 *
 * ★同じ日に複数コマあるときは早い時限を採る。日付だけで比べると、
 *   その日の最後のコマの講師を「次に会う人」と誤って出すことがある。
 */
export function pickNextTeacherByStudent(slots: readonly LessonSlot[]): Map<string, string> {
  const teacherByStudent = new Map<string, string>();
  const bestByStudent = new Map<string, { date: string; slot: number }>();

  for (const s of slots) {
    if (!s.studentId || !s.teacherId) continue;

    const at = { date: s.entryDate, slot: s.slotNumber ?? UNKNOWN_SLOT };
    const best = bestByStudent.get(s.studentId);
    const isEarlier =
      !best || at.date < best.date || (at.date === best.date && at.slot < best.slot);

    if (isEarlier) {
      bestByStudent.set(s.studentId, at);
      teacherByStudent.set(s.studentId, s.teacherId);
    }
  }

  return teacherByStudent;
}
