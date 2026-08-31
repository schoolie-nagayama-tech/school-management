'use client';

/**
 * 座席表「デイリー表示（当日盤）」。
 *
 * コンセプト:
 *   週の座席表＝「予定を組む盤」に対し、この日表示は「今日を回す運用盤」。
 *   行=講師・列=コマで、(1) 今のコマで誰が誰を見ているか、(2) 講師の1日の流れ、
 *   (3) 当日の異常（欠勤・未配置・体験・テスト対策・出欠）が1画面で分かることを狙う。
 *
 *   ★ このビューでは配置の組み替え（D&D・振替先指定・入れ替え）を一切しない。
 *     組み替えは週表示の役割であり、当日画面での誤操作（動いている授業を掴んで
 *     落としてしまう事故）を防ぐため、閲覧・運用に主体を絞っている。
 *     したがって @dnd-kit には依存しない。
 *
 * デザインは承認済みモック src/app/schedule/daily-mock/page.tsx を実データ化したもの。
 * ただし行色はモックのインライン oklch ではなく scheduleDensity.module.css に寄せ、
 * 欠勤はモックの「列（講師）全体」ではなく実データに合わせて「コマ単位」で表現する。
 */

import React, { Fragment, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpenCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  UserX,
  Users,
} from 'lucide-react';
import type { ScheduleEntry, ScheduleTimeSlot } from '@/types/schedule';
import { getSubjectChip, type SubjectChipTone } from './scheduleBadges';
import styles from './scheduleDensity.module.css';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';
import { getSurname } from '@/lib/utils/teacherName';

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

/** 科目チップの色トーン → CSS モジュールクラス（StudentCard と同じ対応表）。 */
const TONE_CLASS: Record<SubjectChipTone, string> = {
  indigo: styles.subjIndigo,
  blue: styles.subjBlue,
  emerald: styles.subjEmerald,
  teal: styles.subjTeal,
  amber: styles.subjAmber,
  violet: styles.subjViolet,
  gray: styles.subjGray,
};

const TONE_CHIP: Record<string, string> = {
  info: 'bg-info-subtle text-info',
  success: 'bg-success-subtle text-success',
  danger: 'bg-danger-subtle text-danger',
  warning: 'bg-warning-subtle text-warning',
};

/** 'HH:MM:SS' → 'HH:MM'。DB の time 型はミリ秒付きのこともあるので先頭5文字で切る。 */
function hhmm(t?: string | null): string {
  return t ? t.slice(0, 5) : '';
}

/** 'YYYY-MM-DD' → 'M月D日(曜)' */
function formatDateLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return `${d.getMonth() + 1}月${d.getDate()}日(${DOW_LABELS[d.getDay()]})`;
}

/** 生徒名。student > inquiry > フォールバックの順（StudentCard と同じ規則）。 */
function studentNameOf(entry: ScheduleEntry): string {
  if (entry.student) return `${entry.student.last_name} ${entry.student.first_name}`;
  if (entry.inquiry?.student_name) return entry.inquiry.student_name;
  return '（氏名未登録）';
}

/** 学年ラベル。生徒は数値学年、見込み客は text。 */
function gradeOf(entry: ScheduleEntry): string {
  if (entry.student) return formatGradeLabel(entry.student.grade);
  if (entry.inquiry?.grade) return entry.inquiry.grade;
  return '—';
}

/**
 * 科目名の一覧。リレーション（subjects）が載っていればそれを優先し、
 * 無ければ subject_ids をマスタ辞書で引く。
 */
function subjectNamesOf(entry: ScheduleEntry, byId?: Map<string, string>): string[] {
  const fromRelation = (entry.subjects ?? [])
    .map((s) => (typeof s === 'object' && s && 'name' in s ? s.name : String(s)))
    .filter((n): n is string => !!n);
  if (fromRelation.length > 0) return fromRelation;
  if (!byId) return [];
  return (entry.subject_ids ?? []).map((id) => byId.get(id)).filter((n): n is string => !!n);
}

/**
 * 行色（状態）。優先度は StudentCard と同一に揃える:
 *   欠席 > 振替元 > 振替先 > 体験 > テスト対策 > 追加授業 > 通常
 * 配色の単一ソースは scheduleDensity.module.css（週表示と同じ見え方にするため）。
 */
function rowStateClass(entry: ScheduleEntry): string {
  if (entry.attendance_status === 'absent') return styles.absent;
  if (entry.status === 'transferred_out') return styles.transferredOut;
  if (entry.status === 'transferred_in') return styles.transferRow;
  if (entry.kind === 'trial') return styles.trialRow;
  if (entry.kind === 'test_prep') return styles.testPrepRow;
  if (entry.kind === 'additional') return styles.additionalRow;
  return '';
}

function SubjectChip({ name }: { name: string }) {
  const { label, tone } = getSubjectChip(name);
  if (!label) return null;
  return (
    <span className={`${styles.subjChip} ${TONE_CLASS[tone]}`} title={name}>
      {label}
    </span>
  );
}

/**
 * 出欠チップ（表示のみ・クリック不可）。
 * 当日盤は「今どうなっているか」を見る場所なので、出欠付けは既存の授業操作モーダルに任せる。
 */
function AttendanceChip({ status }: { status: ScheduleEntry['attendance_status'] }) {
  const { label, cls, title } =
    status === 'present'
      ? { label: '出', cls: 'bg-success text-text-on-primary', title: '出席' }
      : status === 'absent'
        ? {
            label: '欠',
            cls: 'bg-surface-hover text-text-faint border border-border',
            title: '欠席',
          }
        : status === 'late'
          ? { label: '遅', cls: 'bg-warning text-text-on-primary', title: '遅刻' }
          : { label: '-', cls: 'border border-border text-text-faint', title: '出欠未設定' };
  return (
    <span
      title={title}
      className={`ml-auto shrink-0 rounded px-1 text-[10px] font-bold leading-4 ${cls}`}
    >
      {label}
    </span>
  );
}

export interface DailyScheduleBoardProps {
  /** 表示中の日 'YYYY-MM-DD' */
  date: string;
  /** 週ぶんのエントリ。この中から date のものを自分で絞る */
  entries: ScheduleEntry[];
  /** 個別コマの時限一覧（slot_number 昇順で使う） */
  timeSlots: ScheduleTimeSlot[];
  teachers: Array<{
    id: string;
    display_name: string | null;
    last_name?: string | null;
    email: string | null;
  }>;
  /** `${date}|${timeSlotId}|${teacherId}` の集合 */
  absenceKeySet: Set<string>;
  /** 曜日(0=日) → その曜日に出勤可能な講師ID */
  shiftAvailableByDow?: Map<number, string[]>;
  /** その日の 講師ID → 座席番号 */
  boothMap?: Map<string, number>;
  subjectNameById?: Map<string, string>;
  /** その日が休講日か */
  isClosed: boolean;
  onStudentClick: (entry: ScheduleEntry, e: React.MouseEvent) => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
}

export const DailyScheduleBoard = React.memo(function DailyScheduleBoard({
  date,
  entries,
  timeSlots,
  teachers,
  absenceKeySet,
  shiftAvailableByDow,
  boothMap,
  subjectNameById,
  isClosed,
  onStudentClick,
  onPrevDay,
  onNextDay,
  onToday,
}: DailyScheduleBoardProps) {
  // 現在時刻（JST）はマウント時に1回だけ確定する。
  // ・SSR とクライアントで値がズレるとハイドレーション不整合になるので useEffect で入れる
  // ・1分ごとの再計算はしない（当日盤は目視で使うもので、秒単位の追従は不要）
  const [nowJst, setNowJst] = useState<{ date: string; time: string } | null>(null);
  useEffect(() => {
    const d = new Date();
    setNowJst({
      date: d.toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' }),
      time: d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Tokyo', hour12: false }).slice(0, 5),
    });
  }, []);

  const slots = useMemo(
    () => timeSlots.slice().sort((a, b) => a.slot_number - b.slot_number),
    [timeSlots]
  );

  /** この日のエントリ。取消（cancelled）は当日の運用対象外なので出さない。 */
  const dayEntries = useMemo(
    () => entries.filter((e) => e.entry_date === date && e.status !== 'cancelled'),
    [entries, date]
  );

  /** その日に欠勤登録のある講師ID。行見出しの「欠勤」バッジに使う。 */
  const absentTeacherIds = useMemo(() => {
    const set = new Set<string>();
    Array.from(absenceKeySet).forEach((key) => {
      const parts = key.split('|');
      if (parts[0] === date && parts[2]) set.add(parts[2]);
    });
    return set;
  }, [absenceKeySet, date]);

  /**
   * 表示する講師行 = 「この日にエントリがある講師」∪「この日に欠勤登録がある講師」
   *                 ∪「この曜日に出勤可能な講師」。
   * 並び順は teachers 配列（社員番号順で渡ってくる）に揃える。
   */
  const teacherRows = useMemo(() => {
    const ids = new Set<string>();
    dayEntries.forEach((e) => {
      if (e.teacher_id) ids.add(e.teacher_id);
    });
    Array.from(absentTeacherIds).forEach((id) => ids.add(id));
    const dow = new Date(`${date}T12:00:00`).getDay();
    (shiftAvailableByDow?.get(dow) ?? []).forEach((id) => ids.add(id));
    return teachers.filter((t) => ids.has(t.id));
  }, [dayEntries, absentTeacherIds, shiftAvailableByDow, teachers, date]);

  /** 講師×コマ → 生徒行。担当未決定（teacher_id が空）はここには入らない。 */
  const cellMap = useMemo(() => {
    const map = new Map<string, ScheduleEntry[]>();
    dayEntries.forEach((e) => {
      if (!e.teacher_id) return;
      const key = `${e.teacher_id}|${e.time_slot_id}`;
      const list = map.get(key);
      if (list) list.push(e);
      else map.set(key, [e]);
    });
    return map;
  }, [dayEntries]);

  /** 担当未決定のエントリ。講師行に出せないので盤面の下に時限ごとの帯で出す。 */
  const unassignedBySlot = useMemo(() => {
    const map = new Map<string, ScheduleEntry[]>();
    dayEntries.forEach((e) => {
      if (e.teacher_id) return;
      const list = map.get(e.time_slot_id);
      if (list) list.push(e);
      else map.set(e.time_slot_id, [e]);
    });
    return map;
  }, [dayEntries]);

  const unassignedCount = useMemo(
    () => dayEntries.filter((e) => !e.teacher_id).length,
    [dayEntries]
  );

  /** 現在のコマ。表示中の日が今日のときだけ効かせる（他日はハイライトしない）。 */
  const currentSlotId = useMemo(() => {
    if (!nowJst || nowJst.date !== date) return null;
    const hit = slots.find(
      (s) => hhmm(s.start_time) <= nowJst.time && nowJst.time < hhmm(s.end_time)
    );
    return hit?.id ?? null;
  }, [nowJst, date, slots]);

  /** サマリチップ。0件のもの（欠勤・未配置・体験・テスト対策）は出さない。 */
  const summary = useMemo(() => {
    const trialCount = dayEntries.filter((e) => e.kind === 'trial').length;
    const testPrepCount = dayEntries.filter((e) => e.kind === 'test_prep').length;
    // 出勤講師数 = 表示中の講師行のうち、その日に欠勤登録が1件も無い講師（モックの定義に合わせる）
    const workingCount = teacherRows.filter((t) => !absentTeacherIds.has(t.id)).length;
    const items: Array<{
      key: string;
      label: string;
      value: number;
      unit: string;
      icon: typeof CalendarDays;
      tone: string;
    }> = [
      {
        key: 'lessons',
        label: '本日の授業',
        value: dayEntries.length,
        unit: 'コマ',
        icon: CalendarDays,
        tone: 'info',
      },
      {
        key: 'working',
        label: '出勤講師',
        value: workingCount,
        unit: '名',
        icon: Users,
        tone: 'success',
      },
    ];
    if (absentTeacherIds.size > 0) {
      items.push({
        key: 'absent',
        label: '欠勤',
        value: absentTeacherIds.size,
        unit: '名',
        icon: UserX,
        tone: 'danger',
      });
    }
    if (unassignedCount > 0) {
      items.push({
        key: 'unassigned',
        label: '未配置',
        value: unassignedCount,
        unit: '件',
        icon: AlertTriangle,
        tone: 'warning',
      });
    }
    if (trialCount > 0) {
      items.push({
        key: 'trial',
        label: '体験',
        value: trialCount,
        unit: '件',
        icon: Sparkles,
        tone: 'success',
      });
    }
    if (testPrepCount > 0) {
      items.push({
        key: 'testprep',
        label: 'テスト対策',
        value: testPrepCount,
        unit: '件',
        icon: BookOpenCheck,
        tone: 'warning',
      });
    }
    return items;
  }, [dayEntries, teacherRows, absentTeacherIds, unassignedCount]);

  const isToday = nowJst?.date === date;

  return (
    <div className="px-3">
      {/* ヘッダー行: 前日/本日/翌日 + 日付見出し */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-lg border border-border">
          <button
            type="button"
            onClick={onPrevDay}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-text-muted transition-colors hover:bg-surface-hover"
          >
            <ChevronLeft className="h-4 w-4" />
            前日
          </button>
          <button
            type="button"
            onClick={onToday}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              isToday
                ? 'bg-ink text-text-on-primary'
                : 'bg-surface text-text-muted hover:bg-surface-hover'
            }`}
          >
            本日
          </button>
          <button
            type="button"
            onClick={onNextDay}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-text-muted transition-colors hover:bg-surface-hover"
          >
            翌日
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <h2 className="text-lg font-bold text-text-heading">{formatDateLabel(date)}</h2>
        {isClosed && (
          <span className="rounded-full bg-danger-subtle px-2.5 py-0.5 text-xs font-bold text-danger">
            休講日
          </span>
        )}
      </div>

      {isClosed ? (
        <div className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-text-muted">
          休講日です
        </div>
      ) : (
        <>
          {/* サマリチップ行 */}
          <div className="mb-3 flex flex-wrap gap-2">
            {summary.map((s) => (
              <span
                key={s.key}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${TONE_CHIP[s.tone]}`}
              >
                <s.icon className="h-3.5 w-3.5" />
                {s.label} <span className="text-sm font-bold">{s.value}</span>
                {s.unit}
              </span>
            ))}
          </div>

          {teacherRows.length === 0 || slots.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-text-muted">
              この日の授業はありません
            </div>
          ) : (
            /* 盤面: 行=講師 / 列=コマ。左端=講師見出し(sticky left)、上端=コマ見出し(sticky top) */
            <div className="overflow-auto rounded-xl border border-border bg-surface">
              <div
                className="grid min-w-max"
                style={{
                  gridTemplateColumns: `140px repeat(${slots.length}, minmax(190px, 1fr))`,
                }}
              >
                {/* 左上コーナー（両方向 sticky） */}
                <div className="sticky left-0 top-0 z-30 border-b border-r border-border bg-surface-raised" />

                {/* コマ見出し行（sticky top） */}
                {slots.map((slot) => {
                  const isCurrent = slot.id === currentSlotId;
                  const unplaced = unassignedBySlot.get(slot.id)?.length ?? 0;
                  return (
                    <div
                      key={slot.id}
                      className={`sticky top-0 z-20 flex flex-col justify-center gap-1 border-b border-border px-3 py-2 ${
                        isCurrent ? 'bg-info-subtle' : 'bg-surface-raised'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-text-heading">
                          {slot.slot_number}限
                        </span>
                        {isCurrent && (
                          <span className="rounded-full bg-info px-1.5 py-0.5 text-[10px] font-bold text-text-on-primary">
                            現在
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-text-faint">
                        {hhmm(slot.start_time)}〜{hhmm(slot.end_time)}
                      </span>
                      {unplaced > 0 && (
                        <span className="mt-0.5 inline-flex w-fit items-center gap-1 rounded-full bg-warning-subtle px-1.5 py-0.5 text-[10px] font-bold text-warning">
                          <AlertTriangle className="h-3 w-3" />
                          未配置 {unplaced}
                        </span>
                      )}
                    </div>
                  );
                })}

                {/* 講師行 */}
                {teacherRows.map((t) => {
                  const surname = getSurname(t) || t.email || '—';
                  const boothNo = boothMap?.get(t.id);
                  const hasAbsence = absentTeacherIds.has(t.id);
                  return (
                    <Fragment key={t.id}>
                      {/* 講師見出し（sticky left）。密度優先で姓のみ表示する。 */}
                      <div
                        className={`sticky left-0 z-10 flex items-center justify-between gap-2 border-b border-r border-border px-3 py-2 ${
                          hasAbsence ? 'bg-danger-subtle' : 'bg-surface-raised'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-text-heading">
                            {surname}
                          </div>
                          {boothNo !== undefined && (
                            <div className="text-[10px] text-text-faint">席{boothNo}</div>
                          )}
                        </div>
                        {hasAbsence && (
                          <span className="shrink-0 rounded-full bg-danger px-2 py-0.5 text-[10px] font-bold text-text-on-primary">
                            欠勤
                          </span>
                        )}
                      </div>

                      {/* 講師×コマのセル */}
                      {slots.map((slot) => {
                        const isCurrent = slot.id === currentSlotId;
                        // 欠勤はコマ単位で登録されるので、行全体ではなく該当コマだけを減光＋斜線にする。
                        const cellAbsent = absenceKeySet.has(`${date}|${slot.id}|${t.id}`);
                        const cellEntries = cellMap.get(`${t.id}|${slot.id}`) ?? [];
                        return (
                          <div
                            key={`${t.id}-${slot.id}`}
                            className={`min-h-[52px] border-b border-r border-border-subtle p-1.5 last:border-r-0 ${
                              isCurrent ? 'bg-info-subtle/40' : ''
                            } ${cellAbsent ? 'opacity-50' : ''}`}
                            style={
                              cellAbsent
                                ? {
                                    backgroundImage:
                                      'repeating-linear-gradient(45deg, transparent, transparent 6px, color-mix(in oklch, var(--danger) 10%, transparent) 6px, color-mix(in oklch, var(--danger) 10%, transparent) 12px)',
                                  }
                                : undefined
                            }
                          >
                            {cellEntries.length === 0 ? (
                              <div className="flex h-full min-h-[36px] items-center justify-center text-center text-[10px] text-text-faint">
                                {cellAbsent ? '欠勤' : ''}
                              </div>
                            ) : (
                              <div className="flex flex-col gap-1">
                                {cellEntries.map((entry) => (
                                  <StudentRow
                                    key={entry.id}
                                    entry={entry}
                                    subjectNameById={subjectNameById}
                                    onClick={onStudentClick}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </div>
            </div>
          )}

          {/* 担当未決定の帯。講師行に出せないエントリを時限ごとにまとめて出す。 */}
          {unassignedCount > 0 && (
            <div className="mt-3 rounded-lg border border-warning bg-warning-subtle px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-medium text-warning">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                担当未決定の授業が{unassignedCount}件あります
              </p>
              <div className="mt-2 flex flex-col gap-1.5">
                {slots.map((slot) => {
                  const list = unassignedBySlot.get(slot.id) ?? [];
                  if (list.length === 0) return null;
                  return (
                    <div key={slot.id} className="flex flex-wrap items-center gap-1.5">
                      <span className="shrink-0 text-xs font-bold text-text-body">
                        {slot.slot_number}限
                      </span>
                      {list.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={(e) => onStudentClick(entry, e)}
                          className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-text-body transition-colors hover:bg-surface-hover"
                        >
                          {studentNameOf(entry)}（{gradeOf(entry)}
                          {subjectNamesOf(entry, subjectNameById).length > 0
                            ? `・${subjectNamesOf(entry, subjectNameById).join('/')}`
                            : ''}
                          ）
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <p className="mt-3 text-xs text-text-faint">
            日表示は当日の運用確認用です。配置の組み替え（振替・入れ替え・移動）は週表示で行ってください。
          </p>
        </>
      )}
    </div>
  );
});

/** 生徒行（1行表示）。「氏名 学年 科目チップ ＋ 出欠チップ」。行クリックで授業操作モーダルを開く。 */
function StudentRow({
  entry,
  subjectNameById,
  onClick,
}: {
  entry: ScheduleEntry;
  subjectNameById?: Map<string, string>;
  onClick: (entry: ScheduleEntry, e: React.MouseEvent) => void;
}) {
  const name = studentNameOf(entry);
  const names = subjectNamesOf(entry, subjectNameById);
  return (
    <div
      role="button"
      tabIndex={0}
      title={name}
      onClick={(e) => onClick(entry, e)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(entry, e as unknown as React.MouseEvent);
        }
      }}
      className={`${styles.sRow} ${styles.clickable} ${rowStateClass(entry)}`}
    >
      <span className={styles.sName}>{name}</span>
      <span className={styles.sGrade}>{gradeOf(entry)}</span>
      {names.map((n, i) => (
        <SubjectChip key={`${n}-${i}`} name={n} />
      ))}
      <AttendanceChip status={entry.attendance_status} />
    </div>
  );
}
