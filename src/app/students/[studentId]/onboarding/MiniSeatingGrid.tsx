'use client';

/**
 * 入会オンボーディング Step3「② スケジュール」のミニ座席表 D&D 部品。
 *
 * 座席表本体（/schedule の TeacherCard/StudentCard）は編集しない方針のため、
 * ここに軽量なミニカードを新規実装し、見た目だけ scheduleDensity.module.css を import して寄せる。
 *
 * 構成（§2.13改訂2）:
 *  - OnboardingDragCard : ドラッグ元（「生徒名 科目名 比率 半コマ」の1枚カード）。1科目=1カード。
 *      科目自体をカードが表すため、科目名の色バッジは付けない。dnd-kit の draggable。
 *  - MiniTeacherCard    : ドロップ先の講師ミニカード。dnd-kit の droppable。
 *      在籍生徒（1対2の隣が見える）＋空席を縦に出す。D&D は「講師カード1枚＝1 droppable」の粒度。
 *  - MiniSeatingSlot    : 指定 (曜日, コマ) のミニ座席表を1つ描く親部品。呼び出し側が
 *      Step2 で確定した (科目×曜日×コマ) の該当コマぶんループして並べる。
 */

import React, { useMemo } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Plus, X } from 'lucide-react';
import type { ScheduleEntry, HalfPosition } from '@/types/schedule';
import { DAY_OF_WEEK_LABELS } from '@/types/schedule';
import { computeSeatOccupancy, type SeatEntryInput } from '@/lib/utils/seatOccupancy';
import styles from '@/components/schedule/scheduleDensity.module.css';

/** この画面でローカルに積む配置（1配置＝1科目＝1コマ、ドロップ先講師つき）。 */
export interface Placement {
  /** 一意キー */
  key: string;
  /** 曜日 0-6（月=1〜土=6 を使用） */
  day: number;
  /** 表示週での実日付 YYYY-MM-DD */
  date: string;
  timeSlotId: string;
  slotNumber: number;
  startTime: string;
  endTime: string;
  teacherId: string;
  subjectId: string;
  ratio: 1 | 2;
  durationMinutes: number | null;
  halfPosition: HalfPosition;
}

/**
 * ドラッグ元カードが運ぶ「配置する科目」の記述。
 * day / slotId は Step2 で確定済みの受講コマ。ドロップ先の (曜日, コマ) と一致するかの検証に使う。
 */
export interface SubjectDragPayload {
  subjectId: string;
  ratio: 1 | 2;
  durationMinutes: number | null;
  halfPosition: HalfPosition;
  day: number;
  slotId: string;
}

export const ONB_DRAG_ID = 'onb-subject-drag';

/** placement を席計算入力へ。 */
function placementToSeat(p: Pick<Placement, 'ratio' | 'halfPosition'>): SeatEntryInput {
  return { ratio: p.ratio, halfPosition: p.halfPosition };
}

/** ScheduleEntry を席計算入力へ。 */
function entryToSeat(e: ScheduleEntry): SeatEntryInput {
  return { ratio: e.ratio === 1 ? 1 : 2, halfPosition: e.half_position ?? null };
}

/**
 * ドラッグ元カード（1科目=1カード）。カード自体が科目を表すため色バッジは付けず、
 * 生徒名＋科目名（プレーン）＋比率＋半コマを並べるだけにする。
 * draggable の id は科目ごとに一意化する（複数カードが同時に並ぶため）。
 */
export function OnboardingDragCard({
  studentName,
  subjectName,
  ratio,
  halfLabel,
  payload,
}: {
  studentName: string;
  subjectName: string;
  ratio: 1 | 2;
  halfLabel: string | null;
  payload: SubjectDragPayload;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${ONB_DRAG_ID}:${payload.subjectId}`,
    data: { type: 'onb-subject', payload },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={styles.tBlock}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        cursor: 'grab',
        opacity: isDragging ? 0.4 : 1,
      }}
      title="ドラッグして出勤講師に配置します"
    >
      <span style={{ fontWeight: 600, fontSize: 12 }}>{studentName}</span>
      <span style={{ fontSize: 12, color: 'var(--text-body)' }}>{subjectName}</span>
      <span className={styles.ratioTag}>{ratio === 1 ? '1:1' : '1:2'}</span>
      {halfLabel && <span className={styles.halfChip}>{halfLabel}</span>}
    </div>
  );
}

/** 席の埋まり具合ドット（●=使用 / ○=空き）。 */
function OccupancyDots({ used, total }: { used: number; total: number }) {
  const dots: string[] = [];
  for (let i = 0; i < total; i++) dots.push(i < used ? '●' : '○');
  return (
    <span style={{ fontSize: 9, letterSpacing: '1px', color: 'var(--text-muted)' }}>
      {dots.join('')}
    </span>
  );
}

export interface MiniTeacherCardProps {
  droppableId: string;
  teacher: { id: string; name: string; gender: 'male' | 'female' | 'other' | null };
  /** その日付×コマ×講師の実データ在籍（キャンセル・振替元は除外済みを渡す） */
  existingEntries: ScheduleEntry[];
  /** この画面で積んだ配置（同一講師・同一セル分） */
  placements: Placement[];
  maxStudents: number;
  /** 選択中科目に対する相性（指導可否/性別）。null=非ドラッグまたは対象外。 */
  compat: { ok: boolean; reason: string | null } | null;
  /** ドラッグ中か（相性の枠線表示用） */
  dragActive: boolean;
  /** ドラッグ中の科目をこの講師に落とせるか。null=ドラッグ無し。 */
  canDrop: boolean | null;
  /** 表示補助 */
  studentName: string;
  subjectNameById: Map<string, string>;
  onRemovePlacement: (key: string) => void;
}

/**
 * 講師ミニカード（ドロップ先）。
 * カード全体が1つの droppable。isOver と canDrop の組み合わせで枠色を出し分ける
 * （座席表本体 TeacherCard の dropOk/dropNg/dropCandidate と同じ意味論）。
 * ミニ座席表は常に在籍生徒＋空席を展開表示する（該当コマだけを詳しく出すため）。
 */
export const MiniTeacherCard = React.memo(function MiniTeacherCard({
  droppableId,
  teacher,
  existingEntries,
  placements,
  maxStudents,
  compat,
  dragActive,
  canDrop,
  studentName,
  subjectNameById,
  onRemovePlacement,
}: MiniTeacherCardProps) {
  const { isOver, setNodeRef } = useDroppable({ id: droppableId });

  const occupancy = useMemo(
    () =>
      computeSeatOccupancy(
        [...existingEntries.map(entryToSeat), ...placements.map(placementToSeat)],
        maxStudents
      ),
    [existingEntries, placements, maxStudents]
  );

  const genderLabel = teacher.gender === 'male' ? '男' : teacher.gender === 'female' ? '女' : '';

  // 枠色: ドラッグ中は canDrop に応じて緑/赤、非ドラッグ時は相性 ok=false で淡色。
  const outlineClass =
    dragActive && canDrop != null
      ? isOver && canDrop
        ? styles.dropOk
        : isOver && !canDrop
          ? styles.dropNg
          : canDrop
            ? styles.dropCandidate
            : styles.dropDim
      : '';

  return (
    <div ref={setNodeRef} className={`${styles.tBlock} ${outlineClass}`}>
      <div className={styles.tHead} style={{ padding: '0 6px' }}>
        <span className={styles.tName} title={teacher.name}>
          {teacher.name}
          {genderLabel && (
            <span
              className={`${styles.genderMark} ${teacher.gender === 'male' ? styles.genderMale : styles.genderFemale}`}
            >
              {genderLabel}
            </span>
          )}
        </span>
        <span className={styles.headRight} style={{ position: 'static', transform: 'none' }}>
          {compat && !compat.ok && (
            <span
              className={styles.kindBadge}
              style={{ background: 'var(--danger)', color: '#fff' }}
              title={compat.reason ?? '配置不可'}
            >
              不可
            </span>
          )}
          {compat && compat.ok && (
            <span
              className={styles.kindBadge}
              style={{ background: 'var(--success)', color: '#fff' }}
              title="この科目を指導可能・希望に合致"
            >
              可
            </span>
          )}
          <OccupancyDots used={occupancy.usedSeatCount} total={occupancy.effectiveSeatCount} />
        </span>
      </div>

      <div>
        {/* 実データの在籍生徒（読み取り専用の簡易行。1対2の隣が見える） */}
        {existingEntries.map((e) => {
          const nm = e.student
            ? `${e.student.last_name} ${e.student.first_name}`
            : (e.inquiry?.student_name ?? '—');
          const half =
            e.half_position === 'first' ? '前' : e.half_position === 'second' ? '後' : null;
          return (
            <div key={e.id} className={styles.sRow}>
              <span className={styles.sName}>{nm}</span>
              {e.ratio === 1 && <span className={styles.ratioTag}>1:1</span>}
              {half && <span className={styles.halfChip}>{half}</span>}
              {(e.subjects ?? []).map((s, i) => (
                <span key={i} className={`${styles.subjChip} ${styles.subjGray}`}>
                  {s.name}
                </span>
              ))}
            </div>
          );
        })}

        {/* この画面で積んだ配置（緑・削除可能） */}
        {placements.map((p) => {
          const half =
            p.halfPosition === 'first' ? '前' : p.halfPosition === 'second' ? '後' : null;
          return (
            <div key={p.key} className={`${styles.sRow} ${styles.trialRow}`}>
              <span className={styles.sName}>{studentName}</span>
              {p.ratio === 1 && <span className={styles.ratioTag}>1:1</span>}
              {half && <span className={styles.halfChip}>{half}</span>}
              <span className={`${styles.subjChip} ${styles.subjEmerald}`}>
                {subjectNameById.get(p.subjectId) ?? '科目'}
              </span>
              <button
                type="button"
                onClick={() => onRemovePlacement(p.key)}
                className={`${styles.headBtn}`}
                style={{ marginLeft: 'auto' }}
                aria-label="この配置を削除"
                title="この配置を外す"
              >
                <X size={11} />
              </button>
            </div>
          );
        })}

        {/* 空席プレースホルダ（クリックはしない・ドロップ先の目安） */}
        {occupancy.vacancies.map((v, i) => (
          <div key={`vac-${i}`} className={styles.seatEmpty} style={{ cursor: 'default' }}>
            <Plus size={10} />
            {v.kind === 'first' ? '空席（前45）' : v.kind === 'second' ? '空席（後45）' : '空席'}
          </div>
        ))}
      </div>
    </div>
  );
});

/** ミニ座席表の見出しに出す科目情報（1コマに複数科目が来る場合はリスト）。 */
export interface MiniSeatingSlotSubject {
  subjectId: string;
  subjectName: string;
  ratio: 1 | 2;
  half: HalfPosition;
}

/** 出勤講師（ミニ座席表に並べる単位）。 */
export interface MiniSeatingSlotTeacher {
  id: string;
  name: string;
  gender: 'male' | 'female' | 'other' | null;
}

export interface MiniSeatingSlotProps {
  /** 曜日 1(月)〜6(土) */
  day: number;
  slotNumber: number;
  /** "HH:MM[:SS]" */
  startTime: string;
  /** この (曜日×コマ) に配置予定の科目（見出し表示用。複数可） */
  subjectsForCell: MiniSeatingSlotSubject[];
  isClosed: boolean;
  weekLoading: boolean;
  teachers: MiniSeatingSlotTeacher[];
  maxStudents: number;
  dragActive: boolean;
  studentName: string;
  subjectNameById: Map<string, string>;
  /** 講師別の実データ在籍を返す（呼び出し側で日付×コマ×講師で絞る） */
  existingEntriesFor: (teacherId: string) => ScheduleEntry[];
  /** 講師別のローカル配置を返す */
  placementsFor: (teacherId: string) => Placement[];
  /** droppable id を組み立てる */
  makeDropId: (teacherId: string) => string;
  /** ドラッグ中の科目をこの講師に落とせるか */
  canDropFor: (teacherId: string) => boolean | null;
  /** ドラッグ中の科目に対する相性 */
  compatFor: (teacherId: string) => { ok: boolean; reason: string | null } | null;
  onRemovePlacement: (key: string) => void;
}

/**
 * 指定 (曜日, コマ) のミニ座席表を1つ描く。
 * 見出しに「科目名（比率）… — 月 3限」を出し、その下にその曜日×コマの出勤講師を並べる。
 * 全曜日×全コマのグリッドは描かない（該当コマだけを詳しく出す方針）。
 */
export function MiniSeatingSlot({
  day,
  slotNumber,
  startTime,
  subjectsForCell,
  isClosed,
  weekLoading,
  teachers,
  maxStudents,
  dragActive,
  studentName,
  subjectNameById,
  existingEntriesFor,
  placementsFor,
  makeDropId,
  canDropFor,
  compatFor,
  onRemovePlacement,
}: MiniSeatingSlotProps) {
  const subjectSummary = subjectsForCell
    .map((s) => {
      const half = s.half === 'first' ? '・前45' : s.half === 'second' ? '・後45' : '';
      return `${s.subjectName}（${s.ratio === 1 ? '1対1' : '1対2'}${half}）`;
    })
    .join('、');

  return (
    <div className="border border-border rounded-lg p-3 bg-surface-hover space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-bold text-text-heading">{subjectSummary}</span>
        <span className="text-xs text-text-muted">
          — {DAY_OF_WEEK_LABELS[day]}曜 {slotNumber}限 {startTime.slice(0, 5)}
        </span>
      </div>

      {isClosed ? (
        <div className="min-h-[40px] rounded-md border border-dashed border-border flex items-center justify-center text-[11px] text-text-faint">
          休講日です。別の開始日を選ぶか、座席表から後で配置してください。
        </div>
      ) : teachers.length === 0 ? (
        <div className="min-h-[40px] rounded-md border border-dashed border-border flex items-center justify-center text-[11px] text-text-faint">
          {weekLoading ? '出勤講師を読み込み中…' : 'このコマに出勤している講師がいません'}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: 6,
          }}
        >
          {teachers.map((t) => (
            <MiniTeacherCard
              key={t.id}
              droppableId={makeDropId(t.id)}
              teacher={t}
              existingEntries={existingEntriesFor(t.id)}
              placements={placementsFor(t.id)}
              maxStudents={maxStudents}
              compat={compatFor(t.id)}
              dragActive={dragActive}
              canDrop={canDropFor(t.id)}
              studentName={studentName}
              subjectNameById={subjectNameById}
              onRemovePlacement={onRemovePlacement}
            />
          ))}
        </div>
      )}
    </div>
  );
}
