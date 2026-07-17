/**
 * ダッシュボード（/mypage トップ）のデータ整形ロジック（純関数）テスト。
 *
 * 固定する仕様:
 *   - ヒーロー選択（0件/1件/複数件）
 *   - 未読数の集計
 *   - 手続きハブの生徒絞り込みで pushes のみ返すこと（studentId で絞る）
 */
import { describe, it, expect } from 'vitest';
import {
  selectHero,
  toDashboardHero,
  countUnreadReports,
  filterGuidanceForStudent,
} from '@/lib/mypage/dashboardDerive';
import type { PortalScheduleEntryDto } from '@/types/mypage-schedule';
import type { PortalReportListItem } from '@/types/mypage-report';
import type { FormGuidance } from '@/types/mypage-schedule';

function mkEntry(over: Partial<PortalScheduleEntryDto> = {}): PortalScheduleEntryDto {
  return {
    id: 'e1',
    entryDate: '2026-07-16',
    slotNumber: 3,
    slotLabel: '18:40〜20:10',
    startTime: '18:40',
    status: 'scheduled',
    kind: 'regular',
    subjectNames: ['数学'],
    teacherName: '山田',
    seatLabel: null,
    ...over,
  };
}

describe('selectHero', () => {
  it('0件なら null', () => {
    expect(selectHero([])).toBeNull();
  });

  it('1件なら その1件', () => {
    const e = mkEntry();
    expect(selectHero([e])).toBe(e);
  });

  it('複数件なら先頭のみ（2件目以降は捨てる）', () => {
    const e1 = mkEntry({ id: 'e1' });
    const e2 = mkEntry({ id: 'e2' });
    expect(selectHero([e1, e2])).toBe(e1);
  });
});

describe('toDashboardHero', () => {
  it('slotLabel を開始/終了に分け、entryDate===today で isToday=true', () => {
    const hero = toDashboardHero(mkEntry({ entryDate: '2026-07-16' }), '2026-07-16');
    expect(hero).toMatchObject({
      isToday: true,
      startTime: '18:40',
      endTime: '20:10',
      isCancelled: false,
      isTransfer: false,
    });
  });

  it('today と一致しなければ isToday=false', () => {
    const hero = toDashboardHero(mkEntry({ entryDate: '2026-07-17' }), '2026-07-16');
    expect(hero.isToday).toBe(false);
  });

  it('slotLabel が null なら開始/終了とも null（startTime は素の値を優先）', () => {
    const hero = toDashboardHero(mkEntry({ slotLabel: null, startTime: null }), '2026-07-16');
    expect(hero.startTime).toBeNull();
    expect(hero.endTime).toBeNull();
  });

  it('status=cancelled は isCancelled=true、transferred_in は isTransfer=true', () => {
    expect(toDashboardHero(mkEntry({ status: 'cancelled' }), '2026-07-16').isCancelled).toBe(true);
    expect(toDashboardHero(mkEntry({ status: 'transferred_in' }), '2026-07-16').isTransfer).toBe(
      true
    );
  });
});

function mkReport(over: Partial<PortalReportListItem> = {}): PortalReportListItem {
  return {
    id: 'r1',
    studentId: 's1',
    lessonDate: '2026-07-15',
    subjectNames: ['英語'],
    teacherName: '山田',
    shortTermGoal: null,
    checkTestScore: null,
    checkTestTotal: null,
    checkTestPassed: null,
    homeworkCompletionPct: null,
    isRead: false,
    ...over,
  };
}

describe('countUnreadReports', () => {
  it('未読のみ数える', () => {
    const reports = [
      mkReport({ isRead: false }),
      mkReport({ isRead: true }),
      mkReport({ isRead: false }),
    ];
    expect(countUnreadReports(reports)).toBe(2);
  });

  it('0件なら0', () => {
    expect(countUnreadReports([])).toBe(0);
  });
});

describe('filterGuidanceForStudent', () => {
  const guidance: FormGuidance = {
    pushes: [
      {
        studentId: 's1',
        studentName: '太郎',
        formType: 'moshi',
        periodKey: '2026-08',
        title: '8月模試',
        reason: '対象学年です',
        href: '/portal/x/moshi',
      },
      {
        studentId: 's2',
        studentName: '花子',
        formType: 'moshi',
        periodKey: '2026-08',
        title: '8月模試',
        reason: '対象学年です',
        href: '/portal/x/moshi',
      },
    ],
    items: [
      {
        studentId: 's1',
        studentName: '太郎',
        formType: 'soudan',
        periodKey: 'k1',
        title: '個別面談',
        status: 'open',
        href: '/portal/x/soudan',
      },
      {
        studentId: 's1',
        studentName: '太郎',
        formType: 'youbi',
        periodKey: 'k2',
        title: '曜日変更',
        status: 'ended',
        href: '/portal/x/youbi',
      },
      {
        studentId: 's2',
        studentName: '花子',
        formType: 'soudan',
        periodKey: 'k1',
        title: '個別面談',
        status: 'open',
        href: '/portal/x/soudan',
      },
    ],
  };

  it('studentId で絞り込む（pushes のみ返す。items はダッシュボードに出さない）', () => {
    const result = filterGuidanceForStudent(guidance, 's1');
    expect(result).toEqual({
      pushes: [
        {
          studentId: 's1',
          studentName: '太郎',
          formType: 'moshi',
          periodKey: '2026-08',
          title: '8月模試',
          reason: '対象学年です',
          href: '/portal/x/moshi',
        },
      ],
    });
  });

  it('該当が無ければ空配列', () => {
    const result = filterGuidanceForStudent(guidance, 's3');
    expect(result).toEqual({ pushes: [] });
  });
});
