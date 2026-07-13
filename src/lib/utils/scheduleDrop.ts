import type { ScheduleEntry } from '@/types/schedule';

/** 生徒カードD&Dのドロップ判定結果（純関数 evaluateStudentDrop の戻り値）。 */
export type StudentDropDecision =
  | { kind: 'noop' } // 無反応（同一ブロック・満員・重複・休講など）
  | { kind: 'violation'; reason: string } // 制約違反（トースト表示してブロック）
  | { kind: 'drop' }; // ドロップ実行（同コマ内=移動 / 別コマ=振替 は呼び出し側で分岐）

/**
 * 生徒カードをある講師ブロックへドロップしたときの可否を判定する純関数。
 *
 * WeeklyScheduleGrid の handleDragEnd から、実DOM依存部分（parseTeacherSlotId・当たり判定）を
 * 除いた本体ロジックを切り出したもの。ここで 'drop' を返した場合、呼び出し側（page 側の
 * handleStudentEntryDrop）が「同コマ内なら moveScheduleEntry・別コマなら振替」に分岐する。
 *
 * 判定順（先に該当したものを返す）:
 *  1. 休講日 → noop
 *  2. 同一ブロック（同じ日・コマ・講師）へのドロップ → noop
 *  3. 移動先に同じ生徒が既にいる → noop
 *  4. 移動先が満席（有効エントリ数 >= 上限） → noop
 *  5. 指導科目外 / 担当除外 / 希望性別不一致 → violation（理由付き）
 *  6. それ以外 → drop
 *
 * targetActiveEntries は「移動先セルの cancelled/transferred_out を除いた現エントリ」を渡す。
 * ドラッグ中のエントリ自身は別ブロック（別講師）なので含まれず、満席の数え上げに自分は入らない。
 */
export function evaluateStudentDrop(params: {
  entry: Pick<ScheduleEntry, 'entry_date' | 'time_slot_id' | 'teacher_id' | 'student_id'> & {
    subject_ids?: string[] | null;
    student?: ScheduleEntry['student'] | null;
  };
  target: { date: string; slotId: string; teacherId: string };
  targetActiveEntries: Array<Pick<ScheduleEntry, 'student_id'>>;
  targetTeacher?: {
    teachable_subject_ids?: string[] | null;
    gender?: 'male' | 'female' | 'other' | null;
  } | null;
  maxStudentsPerTeacher: number;
  isClosed: boolean;
}): StudentDropDecision {
  const { entry, target, targetActiveEntries, targetTeacher, maxStudentsPerTeacher, isClosed } =
    params;
  if (isClosed) return { kind: 'noop' };
  const isSourceBlock =
    entry.entry_date === target.date &&
    entry.time_slot_id === target.slotId &&
    entry.teacher_id === target.teacherId;
  if (isSourceBlock) return { kind: 'noop' };
  if (targetActiveEntries.some((e) => e.student_id === entry.student_id)) return { kind: 'noop' };
  if (targetActiveEntries.length >= maxStudentsPerTeacher) return { kind: 'noop' };
  if (targetTeacher) {
    // 指導科目（teachable が空/未設定なら全科目可）
    const teachable = targetTeacher.teachable_subject_ids ?? [];
    const subjectIds = entry.subject_ids ?? [];
    if (teachable.length > 0 && subjectIds.length > 0) {
      const teachableSet = new Set(teachable);
      if (!subjectIds.some((sid) => teachableSet.has(sid))) {
        return { kind: 'violation', reason: '指導科目外の講師です' };
      }
    }
    // 除外指定
    const excluded = entry.student?.excluded_teacher_ids ?? [];
    if (excluded.includes(target.teacherId)) {
      return { kind: 'violation', reason: '担当除外指定の講師です' };
    }
    // 性別希望
    const preferred = entry.student?.preferred_teacher_gender;
    if (preferred && targetTeacher.gender && targetTeacher.gender !== preferred) {
      return {
        kind: 'violation',
        reason: `${preferred === 'male' ? '男性' : '女性'}講師希望のため割当不可`,
      };
    }
  }
  return { kind: 'drop' };
}
