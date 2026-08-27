'use client';

/**
 * 形態ボード（小集団・プログラミング等のユーザー定義形態）— Phase D。
 *
 * 行 = その形態のコマ時間（schedule_time_slots, formation=キー）、列 = 表示日（向きに追随）。
 * 各セル = その (日付×コマ) の講座の枠カード群。1カード = 1講師のクラス（講師1名＋生徒N行）。
 * カード言語は個別ボード（Phase U 高密度）と統一し、scheduleDensity.module.css を再利用/拡張する。
 *
 * 形態ボードは手動編成なので D&D は無し。空セルの「＋講座の枠」バーで登録モーダル、
 * 空席プレースホルダ行で既存クラスへの生徒追加、生徒行クリックで StudentActionModal を開く。
 */

import React from 'react';
import { Plus } from 'lucide-react';
import type { ScheduleEntry, ScheduleTimeSlot } from '@/types/schedule';
import { getSurname } from '@/lib/utils/teacherName';
import styles from './scheduleDensity.module.css';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
/** 空席プレースホルダを最大何行まで出すか（残席が多いと縦に伸びるので圧縮） */
const MAX_EMPTY_ROWS = 2;

function formatDayHeader(dateStr: string): { dayNum: number; dateLong: string; weekday: string } {
  const d = new Date(dateStr + 'T12:00:00');
  const month = d.getMonth() + 1;
  const date = d.getDate();
  return { dayNum: date, dateLong: `${month}月${date}日`, weekday: DOW_LABELS[d.getDay()] };
}

function getTodayLocalDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface FormationBoardProps {
  weekDates: string[];
  /** その形態のコマ時間（formation=キーで絞り込み済み） */
  slots: ScheduleTimeSlot[];
  /** その形態の週次エントリ（kind='regular', formation=キーで絞り込み済み） */
  entries: ScheduleEntry[];
  closedDates: string[];
  /** 1枠あたり生徒数上限の「形態の既定値」（school_formation_capacity.max_students_per_group） */
  maxStudentsPerGroup: number;
  /**
   * 週次パターンid → 解決済みの枠の定員（講座の定員 > 形態の既定値）。
   * 省略時や引けなかった枠は maxStudentsPerGroup（従来挙動）。
   */
  capacityByPatternId?: Map<string, number>;
  subjectNameById?: Map<string, string>;
  /** 空セルの「＋…」バー文言（例: 講座の枠） */
  addLabel?: string;
  orientation: 'cols' | 'rows';
  stickyOffset?: number;
  /** 空セルの「＋講座の枠」クリック → 登録モーダル（曜日×コマ自動設定） */
  onCreate: (date: string, slotId: string) => void;
  /** 空席プレースホルダ行クリック → 既存クラスへ生徒追加（講師固定） */
  onAddStudent: (date: string, slotId: string, teacherId: string | null) => void;
  /** 生徒行クリック → StudentActionModal */
  onStudentClick: (entry: ScheduleEntry, e: React.MouseEvent) => void;
}

/** 1枠カード（1講師分）。 */
function ClassCard({
  entries,
  maxStudents,
  capacityByPatternId,
  subjectNameById,
  date,
  slotId,
  onAddStudent,
  onStudentClick,
}: {
  entries: ScheduleEntry[];
  /** 形態の既定値（講座の定員が引けなかったときのフォールバック） */
  maxStudents: number;
  capacityByPatternId?: Map<string, number>;
  subjectNameById?: Map<string, string>;
  date: string;
  slotId: string;
  onAddStudent: (date: string, slotId: string, teacherId: string | null) => void;
  onStudentClick: (entry: ScheduleEntry, e: React.MouseEvent) => void;
}) {
  if (entries.length === 0) return null;
  const teacherId = entries[0].teacher_id ?? null;
  // この枠の定員。枠のどのエントリも同じ講座に属する前提なので先頭の週次パターンで引く。
  const patternId = entries[0].regular_pattern_id ?? null;
  const capacity = (patternId ? capacityByPatternId?.get(patternId) : undefined) ?? maxStudents;
  const teacher = entries[0].teacher;
  const teacherFullName = teacher?.display_name || teacher?.email || null;
  // 座席表ボードは密度優先のため姓のみ表示（フルネームは title 属性で確認できる）
  const teacherName = teacher ? getSurname(teacher) || teacherFullName : null;

  // 科目はクラス内の全エントリの和集合を見出しに（小集団は見出しに科目、生徒行にチップなし）
  const subjectIds = Array.from(new Set(entries.flatMap((e) => e.subject_ids ?? [])));
  const subjectLabel = subjectNameById
    ? subjectIds
        .map((id) => subjectNameById.get(id))
        .filter((n): n is string => !!n)
        .join('・')
    : '';

  const count = entries.length;
  const remaining = Math.max(0, capacity - count);
  const isFull = remaining === 0;
  const emptyRows = Math.min(remaining, MAX_EMPTY_ROWS);
  const hiddenRemain = remaining - emptyRows;

  return (
    <div className={`${styles.gCard} ${isFull ? '' : styles.hasVacancy}`}>
      <div className={styles.gCardHead}>
        <span className={styles.gTitle} title={subjectLabel || undefined}>
          {subjectLabel || 'クラス'}
        </span>
        <span className={`${styles.gCap} ${isFull ? '' : styles.openSlots}`}>
          {count}/{capacity}
        </span>
      </div>
      <div
        className={`${styles.gTeacher} ${teacherName ? '' : styles.unassignedName}`}
        title={
          teacherName && teacherFullName !== teacherName
            ? (teacherFullName ?? undefined)
            : undefined
        }
      >
        講師: {teacherName ?? '担当未決定'}
      </div>
      <div className={styles.gStudents}>
        {entries.map((e) => {
          const name = e.student ? `${e.student.last_name}${e.student.first_name}` : '—';
          const grade = e.student ? formatGradeLabel(e.student.grade) : '';
          const isTransferIn = e.status === 'transferred_in';
          const isAbsent = e.attendance_status === 'absent';
          const rowCls = [
            styles.sRow,
            styles.clickable,
            isTransferIn ? styles.transferRow : '',
            isAbsent ? styles.absent : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div
              key={e.id}
              className={rowCls}
              onClick={(ev) => onStudentClick(e, ev)}
              title={`${name}（${grade}）`}
            >
              <span className={styles.sName}>{name}</span>
              <span className={styles.sGrade}>{grade}</span>
            </div>
          );
        })}
        {/* 空席プレースホルダ（最大2行）。クリックでこのクラスへ生徒追加 */}
        {Array.from({ length: emptyRows }).map((_, i) => (
          <div
            key={`empty-${i}`}
            className={styles.seatEmpty}
            onClick={() => onAddStudent(date, slotId, teacherId)}
            title="空席（クリックで生徒を追加）"
          >
            <Plus className="w-3 h-3" /> 空席
          </div>
        ))}
        {hiddenRemain > 0 && <div className={styles.gRemain}>ほか残 {hiddenRemain} 席</div>}
      </div>
    </div>
  );
}

/**
 * 形態ボード本体。★ React.memo でラップして export している（末尾）。
 * 理由は WeeklyScheduleGrid と同じ（盤面に無関係なデータが届くたびの再描画を止める）。
 * 呼び出し側は props を安定させること。
 */
function FormationBoardImpl({
  weekDates,
  slots,
  entries,
  closedDates,
  maxStudentsPerGroup,
  capacityByPatternId,
  subjectNameById,
  addLabel = '講座の枠',
  orientation,
  stickyOffset = 0,
  onCreate,
  onAddStudent,
  onStudentClick,
}: FormationBoardProps) {
  const todayLocal = getTodayLocalDateStr();
  const closedSet = new Set(closedDates);

  // 表示対象（キャンセル・振替元は除く）を (date, slotId) → teacherKey → entries[] に束ねる
  const visible = entries.filter((e) => e.status !== 'cancelled' && e.status !== 'transferred_out');
  const cellGroups = (date: string, slotId: string): Map<string, ScheduleEntry[]> => {
    const m = new Map<string, ScheduleEntry[]>();
    for (const e of visible) {
      if (e.entry_date !== date || e.time_slot_id !== slotId) continue;
      const tid = e.teacher_id ?? '__unassigned__';
      if (!m.has(tid)) m.set(tid, []);
      m.get(tid)!.push(e);
    }
    return m;
  };

  const slotTimeLabel = (slot: ScheduleTimeSlot) =>
    `${slot.start_time?.slice(0, 5) ?? ''}〜${slot.end_time?.slice(0, 5) ?? ''}`;

  // 1セルの中身（枠カード群 ＋ ＋バー）
  const renderCell = (date: string, slot: ScheduleTimeSlot) => {
    const closed = closedSet.has(date);
    const groups = cellGroups(date, slot.id);
    const isToday = date === todayLocal;
    return (
      <div
        className={`${styles.groupCell} ${groups.size === 0 ? styles.empty : ''} ${isToday ? styles.todayRow : ''}`}
      >
        {Array.from(groups.entries()).map(([tid, list]) => (
          <ClassCard
            key={tid}
            entries={list}
            maxStudents={maxStudentsPerGroup}
            capacityByPatternId={capacityByPatternId}
            subjectNameById={subjectNameById}
            date={date}
            slotId={slot.id}
            onAddStudent={onAddStudent}
            onStudentClick={onStudentClick}
          />
        ))}
        {!closed && (
          <button
            type="button"
            className={styles.addClassBar}
            onClick={() => onCreate(date, slot.id)}
          >
            <Plus className="w-3 h-3" /> {addLabel}
          </button>
        )}
      </div>
    );
  };

  // ============ 日=列（週俯瞰） ============
  const renderColsBoard = () => {
    const gridCols = `44px repeat(${weekDates.length}, minmax(0, 1fr))`;
    return (
      <div className={styles.weekGrid} style={{ gridTemplateColumns: gridCols }}>
        <div className={styles.cornerCell} />
        {weekDates.map((dateStr) => {
          const { dayNum, dateLong, weekday } = formatDayHeader(dateStr);
          const isToday = dateStr === todayLocal;
          return (
            <div
              key={dateStr}
              className={`${styles.dayHead} ${isToday ? styles.today : ''}`}
              title={dateLong}
            >
              <span className={styles.dDate}>{dayNum}</span>
              <span className={styles.dDay}>{weekday}</span>
            </div>
          );
        })}
        {slots.map((slot) => (
          <React.Fragment key={slot.id}>
            <div className={styles.slotLabelMain}>
              {slot.slot_number}限
              <span className={styles.slotTime}>
                {slot.start_time?.slice(0, 5)}
                <br />
                <span className={styles.slotTimeArrow}>↓</span>
                <br />
                {slot.end_time?.slice(0, 5)}
              </span>
            </div>
            {weekDates.map((dateStr) => (
              <React.Fragment key={`${dateStr}-${slot.id}`}>
                {renderCell(dateStr, slot)}
              </React.Fragment>
            ))}
          </React.Fragment>
        ))}
      </div>
    );
  };

  // ============ 日=行（転置・既定） ============
  const renderRowsBoard = () => {
    const gridCols = `44px repeat(${slots.length}, minmax(0, 1fr))`;
    return (
      <>
        <div
          className={`${styles.weekGridT} ${styles.tStickyHead}`}
          style={{ gridTemplateColumns: gridCols }}
        >
          <div className={styles.cornerCell} />
          {slots.map((slot) => (
            <div key={slot.id} className={styles.slotHeadT}>
              {slot.slot_number}限<span className={styles.slotHeadTime}>{slotTimeLabel(slot)}</span>
            </div>
          ))}
        </div>
        <div className={styles.weekGridT} style={{ gridTemplateColumns: gridCols }}>
          {weekDates.map((dateStr) => {
            const { dayNum, dateLong, weekday } = formatDayHeader(dateStr);
            const isToday = dateStr === todayLocal;
            return (
              <React.Fragment key={dateStr}>
                <div
                  className={`${styles.dayLabelT} ${isToday ? styles.today : ''}`}
                  title={dateLong}
                >
                  <span className={styles.dDate}>{dayNum}</span>
                  <span className={styles.dDay}>{weekday}</span>
                </div>
                {slots.map((slot) => (
                  <React.Fragment key={`${dateStr}-${slot.id}`}>
                    {renderCell(dateStr, slot)}
                  </React.Fragment>
                ))}
              </React.Fragment>
            );
          })}
        </div>
      </>
    );
  };

  return (
    <div
      className={`${styles.root} ${styles.boardCanvas}`}
      style={{ '--sd-sticky-top': `${stickyOffset}px` } as React.CSSProperties}
    >
      <div className={styles.boardArea}>
        {orientation === 'rows' ? renderRowsBoard() : renderColsBoard()}
      </div>
    </div>
  );
}

export const FormationBoard = React.memo(FormationBoardImpl);
FormationBoard.displayName = 'FormationBoard';
