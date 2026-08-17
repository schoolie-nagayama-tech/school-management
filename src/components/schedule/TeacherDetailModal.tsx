'use client';

import { Modal, Button } from '@/components/ui';
import type { Subject } from '@/types/database';
// 出勤可能時間帯は teacher_availability_periods（正典）由来の AvailabilityDayMap から表示する。
// user_profiles.available_slot_numbers_by_day（コマ番号）は periods の manual 優先を迂回する
// うえ、形態(formation)ごとにコマ番号が独立採番されるため意味が壊れる。よって直読みしない。
import type { AvailabilityDayMap, TimeInterval } from '@/lib/api/teacher-availability';

const DAY_LABELS: { value: number; label: string }[] = [
  { value: 0, label: '日' },
  { value: 1, label: '月' },
  { value: 2, label: '火' },
  { value: 3, label: '水' },
  { value: 4, label: '木' },
  { value: 5, label: '金' },
  { value: 6, label: '土' },
];

/** 分単位の時刻(TimeInterval)を "HH:MM" に整形する */
function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** マージ済み区間列を "HH:MM-HH:MM・HH:MM-HH:MM" 形式に整形する */
function formatIntervals(intervals: TimeInterval[]): string {
  return intervals.map((iv) => `${formatMinutes(iv.start)}-${formatMinutes(iv.end)}`).join('・');
}

export interface ScheduleTeacherOption {
  id: string;
  display_name: string | null;
  email: string | null;
  user_schools?: Array<{ school_id: string; school?: { name: string } }>;
  teachable_subject_ids?: string[] | null;
  /**
   * @deprecated 表示には使わない（下記 availabilityMap を使う）。呼び出し元の型互換のため
   * プロパティ自体は残す。
   */
  available_days_of_week?: number[] | null;
  /** @deprecated 同上 */
  available_slot_numbers_by_day?: Record<string, number[]> | null;
}

interface TeacherDetailModalProps {
  open: boolean;
  onClose: () => void;
  teacher: ScheduleTeacherOption | null;
  subjects: Subject[];
  /**
   * 出勤可否（正典）。呼び出し元が getAvailabilityDayMap で取得済みのものを渡す。
   * null は「未取得（読み込み中、または対象教室に period レコードが1件も無い）」を意味する。
   */
  availabilityMap: AvailabilityDayMap | null;
}

export function TeacherDetailModal({
  open,
  onClose,
  teacher,
  subjects,
  availabilityMap,
}: TeacherDetailModalProps) {
  if (!teacher) return null;

  const subjectNames = (teacher.teachable_subject_ids ?? [])
    .map((id) => subjects.find((s) => s.id === id)?.name)
    .filter(Boolean) as string[];
  const schoolNames = (teacher.user_schools ?? [])
    .map((us) => us.school?.name)
    .filter(Boolean) as string[];

  // 曜日ごとの在室時間帯（時間帯ベース表示。コマ番号は形態ごとに意味が違うため使わない）。
  // その曜日が availabilityMap.byDayOfWeek に含まれない講師は「出勤不可の曜日」として表示から除く。
  const availabilityLines = !availabilityMap
    ? []
    : DAY_LABELS.filter((d) =>
        (availabilityMap.byDayOfWeek.get(d.value) ?? []).includes(teacher.id)
      ).map((d) => {
        const intervals = availabilityMap.intervalsByDayAndUser.get(`${d.value}|${teacher.id}`);
        // intervals === null は「その曜日は全時間可」を意味する（teacher-availability.ts の意味論）
        const label = intervals == null ? '全時間可' : formatIntervals(intervals);
        return `${d.label}: ${label}`;
      });

  return (
    <Modal isOpen={open} onClose={onClose} title="講師詳細" size="md">
      <div className="space-y-4">
        <div>
          <label className="text-xs text-[var(--paragraph)]">表示名</label>
          <p className="mt-1 text-sm font-medium text-[var(--headline)]">
            {teacher.display_name || '—'}
          </p>
        </div>
        <div>
          <label className="text-xs text-[var(--paragraph)]">メール</label>
          <p className="mt-1 text-sm text-[var(--headline)]">{teacher.email || '—'}</p>
        </div>
        <div>
          <label className="text-xs text-[var(--paragraph)]">担当教室</label>
          <p className="mt-1 text-sm text-[var(--headline)]">
            {schoolNames.length > 0 ? schoolNames.join('、') : '—'}
          </p>
        </div>
        <div>
          <label className="text-xs text-[var(--paragraph)]">指導可能科目</label>
          <p className="mt-1 text-sm text-[var(--headline)]">
            {subjectNames.length > 0 ? subjectNames.join('、') : '—'}
          </p>
        </div>
        <div>
          <label className="text-xs text-[var(--paragraph)]">出勤可能時間帯</label>
          <p className="mt-1 text-sm text-[var(--headline)]">
            {!availabilityMap
              ? '取得中...'
              : availabilityLines.length > 0
                ? availabilityLines.join(' / ')
                : '—'}
          </p>
        </div>
        <div className="flex justify-end pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            閉じる
          </Button>
        </div>
      </div>
    </Modal>
  );
}
