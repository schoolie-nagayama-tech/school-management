import { describe, it, expect } from 'vitest';
import { summarizeStudentSchedule } from '@/lib/utils/studentScheduleSummary';
import type { ScheduleEntry } from '@/types/schedule';

type E = Pick<ScheduleEntry, 'attendance_status' | 'status'>;
const e = (attendance_status: E['attendance_status'], status: E['status'] = 'scheduled'): E => ({
  attendance_status,
  status,
});

describe('summarizeStudentSchedule', () => {
  it('空なら全部0', () => {
    expect(summarizeStudentSchedule([])).toEqual({
      total: 0,
      present: 0,
      late: 0,
      absent: 0,
      transferredOut: 0,
      scheduled: 0,
    });
  });

  it('遅刻は実施済に数え、予定には数えない', () => {
    const s = summarizeStudentSchedule([e('late', 'completed')]);
    expect(s.present).toBe(1);
    expect(s.late).toBe(1);
    expect(s.scheduled).toBe(0);
  });

  it('出席・遅刻・欠席・振替元・未記録をそれぞれの区分に数える', () => {
    const s = summarizeStudentSchedule([
      e('present', 'completed'),
      e('present', 'completed'),
      e('late', 'completed'),
      e('absent', 'completed'),
      e(null, 'transferred_out'),
      e(null),
      e(null, 'transferred_in'),
    ]);
    expect(s).toEqual({
      total: 7,
      present: 3,
      late: 1,
      absent: 1,
      transferredOut: 1,
      scheduled: 2,
    });
  });

  it('欠席かつ振替元の行は欠席として1回だけ数える（二重に引かない）', () => {
    const s = summarizeStudentSchedule([e('absent', 'transferred_out'), e(null)]);
    expect(s.absent).toBe(1);
    expect(s.transferredOut).toBe(0);
    expect(s.scheduled).toBe(1);
  });

  it('区分の合計は常に total と一致する', () => {
    const entries = [
      e('present'),
      e('late', 'transferred_out'),
      e('absent', 'transferred_out'),
      e(null, 'transferred_out'),
      e(null),
    ];
    const s = summarizeStudentSchedule(entries);
    expect(s.present + s.absent + s.transferredOut + s.scheduled).toBe(s.total);
  });
});
