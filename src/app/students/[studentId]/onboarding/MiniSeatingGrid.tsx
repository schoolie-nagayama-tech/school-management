'use client';

/**
 * 入会オンボーディング Step3「コマ配置」のミニ座席表 D&D 部品。
 *
 * 座席表本体（/schedule の TeacherCard/StudentCard）は編集しない方針のため、
 * ここに軽量なミニカードを新規実装し、見た目だけ scheduleDensity.module.css を import して寄せる。
 *
 * 構成:
 *  - OnboardingDragCard : ドラッグ元（「氏名 科目 比率 半コマ」の1枚カード）。dnd-kit の draggable。
 *  - MiniTeacherCard    : ドロップ先の講師ミニカード。dnd-kit の droppable。
 *      既定はコンパクト（講師名＋席の埋まり具合ドット）、展開時は在籍生徒＋空席を縦に出す。
 *      D&D は「講師カード1枚＝1 droppable」の粒度（座席表本体と同じ考え方）。
 */

import React, { useMemo } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Plus, X } from 'lucide-react';
import type { ScheduleEntry, HalfPosition } from '@/types/schedule';
import { computeSeatOccupancy, type SeatEntryInput } from '@/lib/utils/seatOccupancy';
import styles from '@/components/schedule/scheduleDensity.module.css';

/** この画面でローカルに積む配置（1配置＝1コマ＝1科目、ドロップ先講師つき）。 */
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

/** ドラッグ元カードが運ぶ「今置く科目」の記述。 */
export interface SubjectDragPayload {
  subjectId: string;
  ratio: 1 | 2;
  durationMinutes: number | null;
  halfPosition: HalfPosition;
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
 * ドラッグ元カード（配置する生徒＋今置く科目）。
 * 45分科目は前半/後半で別カード（呼び出し側が halfPosition を切り替えて2回描く想定は無く、
 * トグルで1枚を出し分ける）。
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
    id: ONB_DRAG_ID,
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
      <span className={`${styles.subjChip} ${styles.subjBlue}`}>{subjectName}</span>
      <span className={styles.ratioTag}>{ratio === 1 ? '1:1' : '1:2'}</span>
      {halfLabel && <span className={styles.halfChip}>{halfLabel}</span>}
    </div>
  );
}

/** 席の埋まり具合ドット（●=使用 / ○=空き）。コンパクト表示用。 */
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
  expanded: boolean;
  /** 選択中科目に対する相性（指導可否/性別）。null=科目未選択。 */
  compat: { ok: boolean; reason: string | null } | null;
  /** ドラッグ中か（相性の枠線表示用） */
  dragActive: boolean;
  /** 選択中のドラッグをこの講師に落とせるか。null=ドラッグ無し。 */
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
 */
export const MiniTeacherCard = React.memo(function MiniTeacherCard({
  droppableId,
  teacher,
  existingEntries,
  placements,
  maxStudents,
  expanded,
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

      {expanded && (
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
      )}
    </div>
  );
});
