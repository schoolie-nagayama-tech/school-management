import { supabase } from '@/lib/supabase';
import {
  getTimeSlotById,
  getRegularPatterns,
  createRegularPattern,
  checkStudentTimeConflict,
} from '@/lib/api/schedule';
import type { ScheduleRegularPattern } from '@/types/schedule';

// schedule_regular_patterns は Database 型に未定義のため any でクエリ（schedule.ts と同じ流儀）。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** 今日の YYYY-MM-DD（JST 想定） */
function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** 前日の YYYY-MM-DD */
function prevDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** 時間帯が重複するか（endA > startB && endB > startA） */
function timeRangesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  const sA = startA.slice(0, 8);
  const eA = endA.slice(0, 8);
  const sB = startB.slice(0, 8);
  const eB = endB.slice(0, 8);
  return eA > sB && eB > sA;
}

export interface CreateFormationClassParams {
  schoolId: string;
  /** 形態キー（ユーザー定義形態の 'f_xxxxxxxx' 等） */
  formation: string;
  timeSlotId: string;
  dayOfWeek: number;
  /** 講師（1名）。null=担当未決定 */
  teacherId: string | null;
  subjectIds: string[];
  /** 追加する生徒（複数） */
  studentIds: string[];
  /** 適用開始日。未指定なら今日 */
  effectiveFrom?: string;
  /** 1枠あたり生徒数上限（school_formation_capacity.max_students_per_group） */
  maxStudentsPerGroup: number;
  /** 同時刻の枠数上限（school_formation_capacity.max_concurrent_groups） */
  maxConcurrentGroups: number;
}

/**
 * 形態別クラス枠の週次パターンを一括作成する（Phase C）。
 *
 * クラス概念は持たず「曜日×コマ×講師×形態」の行群を暗黙のクラスとして扱う。
 * 選択生徒ごとに schedule_regular_patterns 行（formation=キー）を作成する。
 *
 * バリデーション（DB 書き込み前に全部まとめてチェックし、通ったものだけ挿入）:
 *  1. 定員: 同一 (曜日×コマ×講師) の既存メンバー + 追加数 <= max_students_per_group
 *  2. 同時刻の枠数: 新規に講師枠を増やす場合、同一 (曜日×コマ) の講師枠数 < max_concurrent_groups
 *  3. 講師の別枠時間帯重複: 同一講師が別コマ（時間帯オーバーラップ）に既にいれば不可（同一コマは複数生徒OK）
 *  4. 生徒: 生徒ごとに checkStudentTimeConflict（形態横断・同一時間帯の二重登録禁止）
 */
export async function createFormationClassPatterns(
  params: CreateFormationClassParams
): Promise<ScheduleRegularPattern[]> {
  const {
    schoolId,
    formation,
    timeSlotId,
    dayOfWeek,
    teacherId,
    subjectIds,
    studentIds,
    maxStudentsPerGroup,
    maxConcurrentGroups,
  } = params;
  const effectiveFrom = params.effectiveFrom || todayStr();

  if (studentIds.length === 0) {
    throw new Error('生徒を1名以上選択してください');
  }

  const slot = await getTimeSlotById(timeSlotId);
  if (!slot) throw new Error('コマ時間が見つかりません');

  // 適用開始日時点で有効な、その曜日の全パターン（全形態）を取得。
  // 講師の別枠重複判定は形態横断で行うため、あえて formation で絞らずに引く。
  const dayPatterns = await getRegularPatterns(schoolId, {
    dayOfWeek,
    asOfDate: effectiveFrom,
  });

  // ── 1 & 2. 定員 / 同時刻の枠数 ──
  // この形態・このコマの既存パターン（講師ごとにグルーピング）
  const sameSlotFormation = dayPatterns.filter(
    (p) => p.formation === formation && p.time_slot_id === timeSlotId
  );
  const groupKeyOf = (tid: string | null) => tid ?? '__unassigned__';
  const membersByGroup = new Map<string, number>();
  for (const p of sameSlotFormation) {
    const k = groupKeyOf(p.teacher_id);
    membersByGroup.set(k, (membersByGroup.get(k) ?? 0) + 1);
  }
  const targetGroupKey = groupKeyOf(teacherId);
  const existingInGroup = membersByGroup.get(targetGroupKey) ?? 0;
  if (existingInGroup + studentIds.length > maxStudentsPerGroup) {
    throw new Error(
      `定員を超えます（現在 ${existingInGroup} 名 + 追加 ${studentIds.length} 名 > 上限 ${maxStudentsPerGroup} 名）`
    );
  }
  // 新規に講師枠を増やす場合のみ同時刻の枠数を検査（既存枠への追加はカウント増にならない）
  const isNewGroup = !membersByGroup.has(targetGroupKey);
  if (isNewGroup && membersByGroup.size >= maxConcurrentGroups) {
    throw new Error(
      `同時刻の枠数が上限です（このコマは最大 ${maxConcurrentGroups} 枠まで。既存 ${membersByGroup.size} 枠）`
    );
  }

  // ── 3. 講師の別枠時間帯重複（同一コマは除外＝複数生徒OK） ──
  if (teacherId) {
    for (const p of dayPatterns) {
      if (p.teacher_id !== teacherId) continue;
      if (p.time_slot_id === timeSlotId) continue; // 同一コマは容量側で扱う
      const st = p.time_slot?.start_time;
      const et = p.time_slot?.end_time;
      if (!st || !et) continue;
      if (timeRangesOverlap(slot.start_time, slot.end_time, st, et)) {
        throw new Error('この講師は同じ時間帯に別のコマを担当しているため登録できません');
      }
    }
  }

  // ── 4. 生徒ごとの時間重複（形態横断）を事前チェック（挿入前に全員分） ──
  for (const studentId of studentIds) {
    const conflict = await checkStudentTimeConflict(
      studentId,
      dayOfWeek,
      slot.start_time,
      slot.end_time
    );
    if (conflict) throw new Error(conflict.message);
  }

  // ── 挿入（createRegularPattern を再利用。formation を渡す） ──
  const created: ScheduleRegularPattern[] = [];
  for (const studentId of studentIds) {
    const row = await createRegularPattern(schoolId, {
      student_id: studentId,
      day_of_week: dayOfWeek,
      time_slot_id: timeSlotId,
      teacher_id: teacherId,
      subject_ids: subjectIds,
      seat_label: '',
      period_type: 'regular',
      effective_from: effectiveFrom,
      formation,
    });
    created.push(row);
  }
  return created;
}

/**
 * 形態クラスから生徒1名を「通塾日程から外す」。
 * effective_until を昨日にセットして週次生成の対象外にする（履歴は保持）。
 * fromDate 未指定なら今日を境界に、その前日を effective_until にする。
 */
export async function removeStudentFromFormationClass(
  regularPatternId: string,
  fromDate?: string
): Promise<void> {
  const until = prevDay(fromDate || todayStr());
  const { error } = await db
    .from('schedule_regular_patterns')
    .update({ effective_until: until })
    .eq('id', regularPatternId);
  if (error) {
    console.error('Error removing student from formation class:', error);
    throw new Error('通塾日程からの除外に失敗しました');
  }
}
