/**
 * 「この講師のこのコマに入れられるか」の判定（純関数）
 *
 * 座席表の配置モードで、講師カード単位の可否を出すために使う。
 * 既存 D&D の dropConstraint（TeacherCard）と同じ基準。
 *
 * ★ 切り出した理由:
 *   同じ判定が「汎用配置モードの講師カード表示」と「テスト対策の自動配置が講師を選ぶとき」の
 *   2か所で要る。片方だけ直すと、画面では入れられない講師を自動配置が提案する、という
 *   一番たちの悪いズレ方をする。判定はここ1つに閉じ込め、呼び出し側は材料を渡すだけにする。
 */

import { canPlaceEntry, type SeatEntryInput } from '@/lib/utils/seatOccupancy';

export interface TeacherFitTeacher {
  id: string;
  /** 指導可能科目。空 / 未設定なら全科目可（既存慣習） */
  teachable_subject_ids?: string[] | null;
  gender?: string | null;
}

export interface TeacherFitInput {
  teacher: TeacherFitTeacher;
  /** この日・このコマにこの講師が欠勤しているか */
  isAbsent: boolean;
  /** この日・このコマ・この講師に既に入っている有効なコマ（席占有の判定材料） */
  occupied: SeatEntryInput[];
  /** 個別レーンの1講師あたり上限 */
  maxStudentsPerTeacher: number;
  /** これから入れるコマ */
  incoming: SeatEntryInput;
  /** 入れるコマの科目。空なら科目チェックをしない */
  subjectIds: string[];
  /** 生徒側で担当から外している講師 */
  excludedTeacherIds?: string[];
  /** 生徒の希望講師性別。null / 未設定なら不問 */
  preferredGender?: string | null;
}

export interface TeacherFitResult {
  ok: boolean;
  /** 入れられない理由。ok のときは null */
  reason: string | null;
}

/**
 * 判定順は「その講師がそもそも立てないか（欠勤・科目）」→「席が空いていないか」→
 * 「生徒側の指定に反しないか」。理由の文言は座席表の既存表示と揃えること。
 */
export function checkTeacherFit(input: TeacherFitInput): TeacherFitResult {
  const { teacher } = input;

  // a. 欠勤
  if (input.isAbsent) return { ok: false, reason: '欠勤' };

  // b. 指導可能科目（teachable が空 / 未設定なら全科目可）
  const teachable = teacher.teachable_subject_ids;
  if (teachable && teachable.length > 0 && input.subjectIds.length > 0) {
    const teachableSet = new Set(teachable);
    if (!input.subjectIds.some((id) => teachableSet.has(id))) {
      return { ok: false, reason: '指導科目外' };
    }
  }

  // c. 席占有（1対1専有・満席・45分の半コマ）
  if (!canPlaceEntry(input.occupied, input.incoming, input.maxStudentsPerTeacher)) {
    return {
      ok: false,
      reason: input.occupied.some((e) => e.ratio === 1) ? '1対1のため不可' : '満員',
    };
  }

  // d. 生徒側の指定（担当除外・希望性別）
  if ((input.excludedTeacherIds ?? []).includes(teacher.id)) {
    return { ok: false, reason: '担当除外指定' };
  }
  const pref = input.preferredGender;
  if (pref && teacher.gender && teacher.gender !== pref) {
    return { ok: false, reason: `${pref === 'male' ? '男性' : '女性'}講師希望` };
  }

  return { ok: true, reason: null };
}
