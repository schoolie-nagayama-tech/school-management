'use client';

import React, { useCallback, useMemo, useState } from 'react';
import type { DragEndEvent } from '@dnd-kit/core';
import { parseTeacherSlotId, parseAvailableTeacherDragId } from './TeacherCard';
import { WeeklyScheduleGridView } from './WeeklyScheduleGridView';
import type { ScheduleEntry, ScheduleTimeSlot } from '@/types/schedule';
import type { TeacherGroup } from './DayCell';
import { evaluateStudentDrop } from '@/lib/utils/scheduleDrop';

/**
 * 担当未決定エントリは個別ドロップターゲットにするため、teacher.id を
 * `__unassigned__:<entry_id>` 形式で識別する。
 * 区切り文字に '|' は使わない: teacher-slot ID 全体が `${date}|${slotId}|${teacher.id}` の
 * 3パーツ形式なので、teacher.id 側で '|' を含むと parseTeacherSlotId が弾いてしまう。
 */
export function makeUnassignedTeacherId(entryId: string): string {
  return `__unassigned__:${entryId}`;
}

export function parseUnassignedTeacherId(id: string): string | null {
  if (!id.startsWith('__unassigned__:')) return null;
  return id.slice('__unassigned__:'.length);
}

/**
 * 担当未決定エントリ用の擬似講師ID。
 * teacher_id が NULL のエントリをまとめる1グループとして扱うためのキー。
 * 既存の TeacherGroup 構造を保ったまま「担当未決定」を1講師として描画できる。
 */
export const UNASSIGNED_TEACHER_ID = '__unassigned__';

type TeacherCardInfo = {
  id: string;
  display_name: string | null;
  email: string | null;
  teachable_subject_ids?: string[] | null;
  gender?: 'male' | 'female' | 'other' | null;
};

function groupEntriesByTeacher(
  entries: ScheduleEntry[],
  date: string,
  slotId: string,
  teachersMap: Map<string, TeacherCardInfo>
): TeacherGroup[] {
  const filtered = entries.filter((e) => e.entry_date === date && e.time_slot_id === slotId);
  const byTeacher = new Map<string, TeacherGroup>();
  for (const entry of filtered) {
    // 担当未決定エントリ (teacher_id NULL) は座席表本体から除外。
    // 上部の「未設定プール」(UnassignedEntriesPool) に集約して表示し、そこからD&D割当する設計。
    const rawTid = entry.teacher_id as string | null | undefined;
    if (!rawTid) {
      continue;
    }
    const tid = rawTid;
    const fromList = teachersMap.get(tid);
    const fromEntry = entry.teacher ?? { id: tid, display_name: null, email: null };
    // 講師一覧にいない場合：schedule_entries.teacher_id が user_profiles の誰かを指しているが、
    // role=teacher ではない可能性。JOIN で取得した名前を表示し、未登録であることを示す
    const teacher = fromList ?? {
      ...fromEntry,
      display_name: fromEntry.display_name
        ? `${fromEntry.display_name}（講師未登録）`
        : '講師未登録',
    };
    if (!byTeacher.has(tid)) {
      byTeacher.set(tid, { teacher, entries: [], isAvailableOnly: false });
    }
    byTeacher.get(tid)!.entries.push(entry);
  }
  return Array.from(byTeacher.values());
}

export interface TeacherOption {
  id: string;
  display_name: string | null;
  email: string | null;
  is_active?: boolean;
  user_schools?: Array<{ school_id: string }>;
  available_days_of_week?: number[] | null;
  available_slot_numbers_by_day?: Record<string, number[]> | null;
  /** D&D 制約チェック用 */
  teachable_subject_ids?: string[] | null;
  gender?: 'male' | 'female' | 'other' | null;
}

export interface WeeklyScheduleGridProps {
  schoolId: string;
  weekDates: string[];
  timeSlots: ScheduleTimeSlot[];
  entries: ScheduleEntry[];
  closedDates: string[];
  teachers: TeacherOption[];
  emptyTeacherSlots: Record<string, string[]>;
  /**
   * 通常シフトから「曜日 → 出勤可能な講師ID 配列」のマップ。
   * 各セル描画時に「その日の曜日」を引いて空き枠の講師カードを自動配置する。
   * 未指定なら自動表示はしない（後方互換）。
   */
  shiftAvailableByDow?: Map<number, string[]>;
  maxStudentsPerTeacher: number;
  transferMode: { sourceEntry: ScheduleEntry } | null;
  /** §2.12 入れ替えモードの選択中エントリ（生徒A）。null=通常 */
  swapMode?: { sourceEntry: ScheduleEntry } | null;
  onEmptyTeacherSlotsChange: (next: Record<string, string[]>) => void;
  onAddTeacher: (date: string, slotId: string, existingTeacherIds: string[]) => void;
  onAddStudent: (date: string, slotId: string, teacherId: string) => void;
  onRemoveTeacher: (date: string, slotId: string, teacherId: string, entryCount: number) => void;
  onStudentClick: (entry: ScheduleEntry, e: React.MouseEvent) => void;
  onTransferClick?: (entry: ScheduleEntry) => void;
  onTeacherCardMove: (
    source: { date: string; slotId: string; teacherId: string },
    target: { date: string; slotId: string }
  ) => Promise<void>;
  onStudentEntryDrop?: (
    entryId: string,
    targetDate: string,
    targetSlotId: string,
    targetTeacherId: string
  ) => void;
  /**
   * 「出勤可能（授業なし）」講師カードを担当未決定エントリにドロップしたとき呼ばれる。
   * 親側で「このコマだけ / 毎週このコマ」の選択UIを出す。
   */
  onTeacherDropOnUnassigned?: (params: {
    teacherId: string;
    entryId: string;
    date: string;
    slotId: string;
  }) => void;
  /**
   * D&D 制約違反でドロップ拒否したときに呼ばれる。
   * トースト表示などに使う。
   */
  onConstraintViolation?: (reason: string) => void;
  /**
   * 配置はしたが注意が要るときに呼ばれる（希望性別と違う講師に入れた等）。
   * ドロップは実行済みなので、呼び出し側は警告トーストを出すだけにする。
   */
  onConstraintWarning?: (reason: string) => void;
  onTransferTargetClick?: (date: string, slotId: string, teacherId: string) => void;
  onPrintDay?: (date: string) => void;
  onBoothAssign?: (date: string) => void;
  onTransferCancel: () => void;
  /** 曜日ヘッダー行の一番右に表示する要素（例: 通塾日程ボタン） */
  headerRightContent?: React.ReactNode;
  getKoushuInfo?: (studentId: string) => { enrolled: number; scheduled: number } | null;
  /** 講師カードのミニラベル表示用：科目ID → 名前 */
  subjectNameById?: Map<string, string>;
  /** 講師欠勤マップ。キー: `${date}|${timeSlotId}|${userId}` */
  absenceKeySet?: Set<string>;
  /** 講師カードの欠勤トグル */
  onToggleAbsence?: (date: string, slotId: string, teacherId: string) => void;
  /** 講習の手動配置モード中か（true でセルがクリック可能な配置ターゲットになる） */
  koushuPlacing?: boolean;
  /** 配置モード中、各セルの配置可否と理由（緑/淡色のハイライト用） */
  getKoushuPlaceability?: (date: string, slotId: string) => { ok: boolean; reason: string | null };
  /** 配置モード中にセルをクリックしたとき（担当未決定で落とす） */
  onKoushuPlace?: (date: string, slotId: string) => void;
  /** 配置モード中に講師カードをクリックしたとき（その講師で配置） */
  onKoushuPlaceWithTeacher?: (date: string, slotId: string, teacherId: string) => void;
  /** P2改訂: 汎用配置モード中の講師カード単位の配置可否（指導科目外/満員/欠勤等）。 */
  getTeacherPlaceConstraint?: (
    date: string,
    slotId: string,
    teacherId: string
  ) => { ok: boolean; reason: string | null };
  /** 向き: 'cols'=日=列(週俯瞰) / 'rows'=日=行(転置・既定) */
  orientation: 'cols' | 'rows';
  /** 日=列モードのセル内カラム数（1 or 2）。転置モードでは無視 */
  colMode: 1 | 2;
  /** 座席番号（印刷ブース番号）: 日付 → 講師ID → 番号 */
  boothMapByDate?: Map<string, Map<string, number>>;
  /** 座席番号の保存（日付, 講師ID, 値） */
  onSeatNoChange?: (date: string, teacherId: string, value: string) => void;
  /** sticky ツールバーの実測高さ(px)。時限見出しの sticky top に使う */
  stickyOffset?: number;
}

/**
 * 盤面本体。★ React.memo でラップして export している（末尾）。
 *
 * 座席表ページは1コンポーネントに多数の状態を持ち、初回描画のあとにも
 * 講習期間・全生徒・定員などの取得結果が次々届いてページ全体が再レンダリングされる。
 * 盤面は「講師×コマ×日」のセルを大量に描くのでこの再描画が重く、
 * 盤面に関係ないデータが届くたびカクついていた。
 * props が変わらない限り盤面は描き直さない。
 * ★ そのため呼び出し側は props を安定させること（インラインで new Map やアロー関数を
 *    渡すと毎回別物になり memo が効かない）。
 */
function WeeklyScheduleGridImpl(props: WeeklyScheduleGridProps) {
  const {
    schoolId,
    weekDates,
    timeSlots,
    entries,
    closedDates,
    teachers,
    emptyTeacherSlots,
    shiftAvailableByDow,
    maxStudentsPerTeacher,
    transferMode,
    swapMode,
    onAddTeacher,
    onAddStudent,
    onRemoveTeacher,
    onStudentClick,
    onTransferClick: _onTransferClick,
    onTeacherCardMove: _onTeacherCardMove,
    onStudentEntryDrop,
    onTeacherDropOnUnassigned,
    onConstraintViolation,
    onConstraintWarning,
    onTransferTargetClick,
    onPrintDay,
    onBoothAssign,
    headerRightContent: _headerRightContent,
    getKoushuInfo,
    subjectNameById,
    absenceKeySet,
    onToggleAbsence,
    koushuPlacing,
    getKoushuPlaceability,
    onKoushuPlace,
    onKoushuPlaceWithTeacher,
    getTeacherPlaceConstraint,
    orientation,
    colMode,
    boothMapByDate,
    onSeatNoChange,
    stickyOffset,
  } = props;

  const [activeId, setActiveId] = useState<string | null>(null);

  const teachersMap = useMemo(
    () =>
      new Map(
        teachers.map((t) => [
          t.id,
          {
            id: t.id,
            display_name: t.display_name,
            email: t.email,
            // D&D 制約チェックに使う
            teachable_subject_ids: t.teachable_subject_ids ?? null,
            gender: t.gender ?? null,
          },
        ])
      ),
    [teachers]
  );

  /**
   * 講師ID → 講師一覧での位置。セル内の講師カードの並び順に使う。
   *
   * ★ なぜ必要か（2026-08-20）:
   *   以前はセル内の並びが「エントリ配列に現れた順 → 手動追加枠 → 出勤可能枠」だった。
   *   前者は API の返却順そのままで安定しておらず、授業を移動・振替して再取得が走ると
   *   講師カードの左右が入れ替わり、「今どこに入れたか」を見失う原因になっていた。
   *   さらに空き枠だった講師に授業を入れると、その講師が「出勤可能枠」から
   *   「エントリあり」のグループへ移動するため、操作した直後に必ず列が動いていた。
   *   講師一覧（/api/admin/users?role=teacher・created_at desc, id asc で決定的）の
   *   順序に固定することで、授業の有無にかかわらずカードの位置が動かなくなる。
   */
  const teacherOrder = useMemo(() => {
    const order = new Map<string, number>();
    teachers.forEach((t, i) => order.set(t.id, i));
    return order;
  }, [teachers]);

  /** 講師カードの安定した並び順。一覧に無い講師（講師未登録）は末尾へ寄せる。 */
  const compareTeacherGroups = useCallback(
    (a: TeacherGroup, b: TeacherGroup) => {
      const ia = teacherOrder.get(a.teacher.id) ?? Number.MAX_SAFE_INTEGER;
      const ib = teacherOrder.get(b.teacher.id) ?? Number.MAX_SAFE_INTEGER;
      if (ia !== ib) return ia - ib;
      // 一覧に無い者どうしは表示名→IDで決める（毎回同じ並びにするための最終手段）。
      const na = a.teacher.display_name ?? '';
      const nb = b.teacher.display_name ?? '';
      if (na !== nb) return na.localeCompare(nb, 'ja');
      return a.teacher.id.localeCompare(b.teacher.id);
    },
    [teacherOrder]
  );

  const activeEntry = useMemo(() => {
    if (
      !activeId ||
      activeId.startsWith('teacher-card-') ||
      activeId.startsWith('teacher-slot-') ||
      activeId.startsWith('avail-teacher-')
    )
      return null;
    return entries.find((e) => e.id === activeId) ?? null;
  }, [activeId, entries]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over || over.id === active.id) return;

    const overSlot = parseTeacherSlotId(String(over.id));

    // [1] 「出勤可能講師」 → 「担当未決定エントリ」へのドロップ
    //     ドロップ先 teacher.id が __unassigned__|<entryId> 形式なら割当処理に振る
    const availDrag = parseAvailableTeacherDragId(String(active.id));
    if (availDrag && overSlot && onTeacherDropOnUnassigned) {
      const targetEntryId = parseUnassignedTeacherId(overSlot.teacherId);
      if (targetEntryId) {
        onTeacherDropOnUnassigned({
          teacherId: availDrag.teacherId,
          entryId: targetEntryId,
          date: overSlot.date,
          slotId: overSlot.slotId,
        });
        return;
      }
    }

    // [2] 生徒カードのドロップ → 講師ブロックに割当（同コマ内=移動 / 別コマ=振替）
    if (overSlot && onStudentEntryDrop) {
      const entry = entries.find((e) => e.id === String(active.id));
      if (!entry) return;
      // 移動先セルの有効エントリ（cancelled/transferred_out を除く）。満席・重複判定に使う。
      const targetActiveEntries = entries.filter(
        (e) =>
          e.entry_date === overSlot.date &&
          e.time_slot_id === overSlot.slotId &&
          e.teacher_id === overSlot.teacherId &&
          e.status !== 'cancelled' &&
          e.status !== 'transferred_out'
      );
      // 可否判定は純関数へ委譲（同一ブロック・満席・重複・制約違反をここで一元判定）。
      const decision = evaluateStudentDrop({
        entry,
        target: { date: overSlot.date, slotId: overSlot.slotId, teacherId: overSlot.teacherId },
        targetActiveEntries,
        targetTeacher: teachers.find((t) => t.id === overSlot.teacherId) ?? null,
        maxStudentsPerTeacher,
        isClosed: closedDates.includes(overSlot.date),
      });
      // 入れられない場合は理由をトースト表示（満席・重複・休講・相性）。noop だけ無反応。
      if (decision.kind === 'violation' || decision.kind === 'blocked') {
        onConstraintViolation?.(decision.reason);
        return;
      }
      // 希望と違うだけ（希望性別）なら止めない。警告を出したうえでそのまま配置する。
      if (decision.kind === 'warn') {
        onConstraintWarning?.(decision.reason);
        onStudentEntryDrop(String(active.id), overSlot.date, overSlot.slotId, overSlot.teacherId);
        return;
      }
      if (decision.kind !== 'drop') return;
      onStudentEntryDrop(String(active.id), overSlot.date, overSlot.slotId, overSlot.teacherId);
      return;
    }
  };

  const teachersForSchool = useMemo(
    () =>
      teachers.filter(
        (t) => t.is_active !== false && t.user_schools?.some((us) => us.school_id === schoolId)
      ),
    [teachers, schoolId]
  );

  /**
   * セル (dateStr, slotId) の未配置エントリ (teacher_id NULL) を返す。
   * DayCell に渡してミニチップとして表示する。
   */
  const getUnassignedEntriesForCell = useCallback(
    (dateStr: string, slotId: string): ScheduleEntry[] => {
      return entries.filter(
        (e) =>
          e.entry_date === dateStr &&
          e.time_slot_id === slotId &&
          !e.teacher_id &&
          e.status !== 'cancelled' &&
          e.status !== 'transferred_out'
      );
    },
    [entries]
  );

  /** セル (dateStr, slotId) に出勤可能な講師を全員含む teacherGroups */
  const getTeacherGroupsForCell = useCallback(
    (dateStr: string, slotId: string, _slotNumber: number) => {
      const fromEntries = groupEntriesByTeacher(entries, dateStr, slotId, teachersMap);
      const cellKey = `${dateStr}-${slotId}`;
      const emptyIds = emptyTeacherSlots[cellKey] ?? [];
      const merged: TeacherGroup[] = [];

      // (A) エントリがある講師（授業あり）
      for (const group of fromEntries) {
        merged.push({ ...group, isAvailableOnly: false });
      }

      // (B) 手動で追加した講師スロット（+講師追加 で明示的に追加したもの）
      for (const tid of emptyIds) {
        if (merged.some((m) => m.teacher.id === tid)) continue;
        const teacher = teachersMap.get(tid);
        if (teacher) merged.push({ teacher, entries: [], isAvailableOnly: true });
      }

      // (C) 通常シフト提出から「この曜日に出勤可能」な講師を空き枠で自動表示。
      // 曜日 (0=日 〜 6=土) を date から計算。ローカル日時で扱う。
      if (shiftAvailableByDow && shiftAvailableByDow.size > 0) {
        const dow = new Date(dateStr + 'T12:00:00').getDay();
        const shiftIds = shiftAvailableByDow.get(dow) ?? [];
        for (const tid of shiftIds) {
          if (merged.some((m) => m.teacher.id === tid)) continue;
          const teacher = teachersMap.get(tid);
          if (teacher) merged.push({ teacher, entries: [], isAvailableOnly: true });
        }
      }

      // ★ 最後に必ず講師一覧の順へ揃える。(A)(B)(C) の積み上げ順のままだと
      //   「授業を入れた瞬間に (C) から (A) へ移って列が動く」ため。
      merged.sort(compareTeacherGroups);
      return merged;
    },
    [
      entries,
      teachersForSchool,
      emptyTeacherSlots,
      teachersMap,
      shiftAvailableByDow,
      compareTeacherGroups,
    ]
  );

  return (
    <WeeklyScheduleGridView
      schoolId={schoolId}
      weekDates={weekDates}
      timeSlots={timeSlots}
      entries={entries}
      closedDates={closedDates}
      emptyTeacherSlots={emptyTeacherSlots}
      maxStudentsPerTeacher={maxStudentsPerTeacher}
      transferMode={transferMode}
      swapMode={swapMode}
      activeId={activeId}
      activeEntry={activeEntry}
      // こちらの経路（印刷・別ビュー）も同じ並び順に揃える。片方だけ固定すると
      // 画面と印刷で講師の順番が食い違う。
      groupEntriesByTeacher={(e, d, s) =>
        groupEntriesByTeacher(e, d, s, teachersMap).sort(compareTeacherGroups)
      }
      getTeacherGroupsForCell={getTeacherGroupsForCell}
      getUnassignedEntriesForCell={getUnassignedEntriesForCell}
      onDragStart={(e) => setActiveId(String(e.active.id))}
      onDragEnd={handleDragEnd}
      onAddTeacher={onAddTeacher}
      onAddStudent={onAddStudent}
      onRemoveTeacher={onRemoveTeacher}
      onStudentClick={onStudentClick}
      onTransferTargetClick={onTransferTargetClick}
      onPrintDay={onPrintDay}
      onBoothAssign={onBoothAssign}
      getKoushuInfo={getKoushuInfo}
      subjectNameById={subjectNameById}
      absenceKeySet={absenceKeySet}
      onToggleAbsence={onToggleAbsence}
      koushuPlacing={koushuPlacing}
      getKoushuPlaceability={getKoushuPlaceability}
      getTeacherPlaceConstraint={getTeacherPlaceConstraint}
      onKoushuPlace={onKoushuPlace}
      onKoushuPlaceWithTeacher={onKoushuPlaceWithTeacher}
      orientation={orientation}
      colMode={colMode}
      boothMapByDate={boothMapByDate}
      onSeatNoChange={onSeatNoChange}
      stickyOffset={stickyOffset}
    />
  );
}

export const WeeklyScheduleGrid = React.memo(WeeklyScheduleGridImpl);
WeeklyScheduleGrid.displayName = 'WeeklyScheduleGrid';
