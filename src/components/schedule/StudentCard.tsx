'use client';

import React from 'react';
import type { ScheduleEntry } from '@/types/schedule';
import { SCHEDULE_ENTRY_KIND_LABELS, isExtraLessonKind } from '@/types/schedule';
import { extraKindBadgeClass, getSubjectChip, type SubjectChipTone } from './scheduleBadges';
import styles from './scheduleDensity.module.css';

function gradeLabel(grade: number): string {
  if (grade <= 6) return `小${grade}`;
  if (grade <= 9) return `中${grade - 6}`;
  return `高${grade - 9}`;
}

/** 科目チップの色トーン → CSS モジュールクラス。scheduleBadges.getSubjectChip と対で使う。 */
const TONE_CLASS: Record<SubjectChipTone, string> = {
  indigo: styles.subjIndigo,
  blue: styles.subjBlue,
  emerald: styles.subjEmerald,
  teal: styles.subjTeal,
  amber: styles.subjAmber,
  violet: styles.subjViolet,
  gray: styles.subjGray,
};

function SubjectChip({ name }: { name: string }) {
  const { label, tone } = getSubjectChip(name);
  if (!label) return null;
  return (
    <span className={`${styles.subjChip} ${TONE_CLASS[tone]}`} title={name}>
      {label}
    </span>
  );
}

export interface StudentCardProps {
  entry: ScheduleEntry;
  onClick: (e: React.MouseEvent) => void;
  /** 講習モード: 申し込みコマ数 */
  koushuEnrolled?: number;
  /** 講習モード: 期間内の受講済みコマ数 */
  koushuScheduled?: number;
}

/**
 * 生徒行（1行表示・Phase U 密度改修）。
 * 「氏名 学年 [科目色チップ]」を1行に収める。出欠・振替・体験は「行色」で表現し、
 * 状態バッジ（振/欠/体）は廃止（凡例に行色の意味を集約）。
 * テスト対策・追加授業などの kind バッジは現行どおり残す。
 * 行クリックで親が授業操作メニュー（StudentActionModal）を開く。
 */
export const StudentCard = React.memo(function StudentCard({
  entry,
  onClick,
  koushuEnrolled,
  koushuScheduled,
}: StudentCardProps) {
  const studentName = entry.student
    ? `${entry.student.last_name} ${entry.student.first_name}`
    : entry.student_id;
  const grade = entry.student ? gradeLabel(entry.student.grade) : '—';
  const subjectNames = (entry.subjects ?? [])
    .map((s) => (typeof s === 'object' && s && 'name' in s ? s.name : String(s)))
    .filter((n): n is string => !!n);

  const isTransferredOut = entry.status === 'transferred_out';
  const isTransferredIn = entry.status === 'transferred_in';
  const isDraft = !!entry.isDraft;
  const isAbsent = entry.attendance_status === 'absent';
  const isTrial = entry.kind === 'trial';
  // 追加授業の種別バッジ（体験は行色にするのでバッジからは除外）
  const showKindBadge = isExtraLessonKind(entry.kind) && entry.kind !== 'trial';

  // 行色（状態）: 優先度 = 欠席 > 振替元 > 振替先 > 体験 > 通常
  const stateClass = isAbsent
    ? styles.absent
    : isTransferredOut
      ? styles.transferredOut
      : isTransferredIn
        ? styles.transferRow
        : isTrial
          ? styles.trialRow
          : '';

  // 振替先は元日程を title に出す（バッジ廃止のぶんの情報を hover で補う）
  const rowTitle = isTransferredIn ? '振替で入ったコマ' : studentName;

  const koushuRemain =
    koushuEnrolled !== undefined ? Math.max(0, koushuEnrolled - (koushuScheduled ?? 0)) : null;

  // Phase R: 45分授業の前後半チップ（グレー系）と 1対1 マーカー。
  const halfLabel =
    entry.half_position === 'first' ? '前' : entry.half_position === 'second' ? '後' : null;
  const isOneToOne = entry.ratio === 1;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(e as unknown as React.MouseEvent);
        }
      }}
      title={
        isDraft
          ? '自動マッチングの仮配置（未公開）。コントロールパネルで公開すると確定します'
          : rowTitle
      }
      className={`${styles.sRow} ${styles.clickable} ${stateClass} ${isDraft ? styles.draftRow : ''}`}
    >
      {isDraft && (
        <span
          className={styles.kindBadge}
          style={{ background: 'var(--info)', color: '#fff' }}
          title="自動マッチングの仮配置（未公開）"
        >
          仮
        </span>
      )}
      {showKindBadge && (
        <span
          className={`${styles.kindBadge} ${extraKindBadgeClass(entry.kind)}`}
          title={`${SCHEDULE_ENTRY_KIND_LABELS[entry.kind]}（単発の追加授業）`}
        >
          {SCHEDULE_ENTRY_KIND_LABELS[entry.kind]}
        </span>
      )}
      <span className={styles.sName}>{studentName}</span>
      <span className={styles.sGrade}>{grade}</span>
      {isOneToOne && (
        <span className={styles.ratioTag} title="1対1授業（生徒1名で満席）">
          1:1
        </span>
      )}
      {halfLabel && (
        <span
          className={styles.halfChip}
          title={entry.half_position === 'first' ? '前半45分' : '後半45分'}
        >
          {halfLabel}
        </span>
      )}
      {subjectNames.map((name, i) => (
        <SubjectChip key={`${name}-${i}`} name={name} />
      ))}
      {isTransferredIn && <span className={styles.metaTag}>振替</span>}
      {koushuRemain !== null && <span className={styles.koushuTag}>残{koushuRemain}</span>}
    </div>
  );
});
