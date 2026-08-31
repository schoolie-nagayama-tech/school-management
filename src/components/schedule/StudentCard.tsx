'use client';

import React from 'react';
import type { ScheduleEntry } from '@/types/schedule';
import { SCHEDULE_ENTRY_KIND_LABELS, isExtraLessonKind } from '@/types/schedule';
import { getSubjectChip, type SubjectChipTone } from './scheduleBadges';
import styles from './scheduleDensity.module.css';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';

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

/** §2.12 入れ替えモードでの行の状態。null=通常。 */
export type SwapState = 'source' | 'candidate' | 'dimmed' | null;

export interface StudentCardProps {
  entry: ScheduleEntry;
  onClick: (e: React.MouseEvent) => void;
  /** 講習モード: 申し込みコマ数 */
  koushuEnrolled?: number;
  /** 講習モード: 期間内の受講済みコマ数 */
  koushuScheduled?: number;
  /** §2.12 入れ替えモード時の行ハイライト状態 */
  swapState?: SwapState;
}

/**
 * 生徒行（1行表示・Phase U 密度改修）。
 * 「氏名 学年 [科目色チップ]」を1行に収める。出欠・振替と、単発コマの種別
 * （体験・テスト対策・追加授業）はすべて「行色」で表現し、種別バッジは持たない
 * （凡例に行色の意味を集約。1行の密度をバッジで圧迫しないため）。
 * 行クリックで親が授業操作メニュー（StudentActionModal）を開く。
 */
export const StudentCard = React.memo(function StudentCard({
  entry,
  onClick,
  koushuEnrolled,
  koushuScheduled,
  swapState,
}: StudentCardProps) {
  // Phase T: 体験の見込み客（student を持たず inquiry を参照する行）は inquiry からフォールバック表示する。
  const isInquiry = !entry.student && !!entry.inquiry;
  const studentName = entry.student
    ? `${entry.student.last_name} ${entry.student.first_name}`
    : entry.inquiry
      ? entry.inquiry.student_name || '（氏名未登録）'
      : (entry.student_id ?? '—');
  // 生徒は数値学年、見込み客(inquiry.grade)は text。student/inquiry いずれも無ければ「—」。
  const grade = entry.student
    ? formatGradeLabel(entry.student.grade)
    : entry.inquiry
      ? entry.inquiry.grade || '—'
      : '—';
  const subjectNames = (entry.subjects ?? [])
    .map((s) => (typeof s === 'object' && s && 'name' in s ? s.name : String(s)))
    .filter((n): n is string => !!n);

  const isTransferredOut = entry.status === 'transferred_out';
  const isTransferredIn = entry.status === 'transferred_in';
  const isDraft = !!entry.isDraft;
  const isAbsent = entry.attendance_status === 'absent';
  const isTrial = entry.kind === 'trial';
  const isTestPrep = entry.kind === 'test_prep';
  const isAdditional = entry.kind === 'additional';

  // 行色（状態）: 優先度 = 欠席 > 振替元 > 振替先 > 体験 > テスト対策 > 追加授業 > 通常
  // 単発コマ（体験・テスト対策・追加授業）は種別バッジを持たず、すべて行色で見分ける。
  // バッジは1行に収める密度を圧迫するため、色と凡例に情報を寄せている。
  const stateClass = isAbsent
    ? styles.absent
    : isTransferredOut
      ? styles.transferredOut
      : isTransferredIn
        ? styles.transferRow
        : isTrial
          ? styles.trialRow
          : isTestPrep
            ? styles.testPrepRow
            : isAdditional
              ? styles.additionalRow
              : '';

  // 行色だけでは断定できない情報は hover の title で補う（バッジ廃止のぶん）
  const rowTitle = isTransferredIn
    ? '振替で入ったコマ'
    : isExtraLessonKind(entry.kind)
      ? `${studentName}（${SCHEDULE_ENTRY_KIND_LABELS[entry.kind]}）`
      : studentName;

  // §2.12 入れ替えモードの行ハイライト（source/candidate/dimmed）。
  const swapClass =
    swapState === 'source'
      ? styles.swapSource
      : swapState === 'candidate'
        ? styles.swapCandidate
        : swapState === 'dimmed'
          ? styles.swapDimmed
          : '';

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
      className={`${styles.sRow} ${styles.clickable} ${stateClass} ${swapClass} ${isDraft ? styles.draftRow : ''}`}
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
      {isInquiry && (
        <span
          className={styles.kindBadge}
          style={{ background: 'var(--success)', color: '#fff' }}
          title="問合せ名簿の見込み客（未入会）の体験授業"
        >
          見込
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
      {/* 振替先は行の青色で表現する（「振替」テキストは行を圧迫するので出さない。
          由来は hover の title「振替で入ったコマ」で補う）。 */}
      {koushuRemain !== null && <span className={styles.koushuTag}>残{koushuRemain}</span>}
    </div>
  );
});
