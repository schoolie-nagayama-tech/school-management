/**
 * lib/mypage/schoolInfo.ts のテスト（DBアクセスを含むヘルパー）。
 *
 * 固定する仕様:
 *   - fetchSchoolTimeSlots: 生徒の所属校（students.school_id）で明示的に絞る。
 *     ラベルが作れない時限（開始/終了時刻が欠けている）は除外する。
 *     生徒が見つからない/所属校が無ければ空配列（例外にしない）。
 *   - fetchMeetingBookingUrl: schools.meeting_booking_url を返す。未設定/生徒不明は null。
 *
 * これらはもともと /api/mypage/schedule に閉じていたロジックを、ChatView の
 * TemplateForm（/api/mypage/school-info）と共有するために抽出したもの。
 * 抽出前後で挙動が変わっていないことをここで固定する。
 */
import { describe, it, expect, vi } from 'vitest';
import { createMockChain } from '../../api-routes/helpers';

// schoolInfo.ts は 'server-only' を import するため、node のテスト環境では空モジュールに差し替える。
vi.mock('server-only', () => ({}));

import { fetchSchoolTimeSlots, fetchMeetingBookingUrl } from '@/lib/mypage/schoolInfo';

/** テーブルごとに異なるチェーンを返す軽量な Supabase クライアントスタブ。 */
function stubClient(chains: Record<string, ReturnType<typeof createMockChain>>) {
  return {
    from: vi.fn((table: string) => {
      const chain = chains[table];
      if (!chain) throw new Error(`unexpected table: ${table}`);
      return chain;
    }),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

describe('fetchSchoolTimeSlots', () => {
  it('生徒の所属校の時限をラベル付きで返す（表示順）', async () => {
    const studentsChain = createMockChain({ school_id: 'sch-1' }, null);
    const slotsChain = createMockChain(
      [
        { id: 'slot-3', slot_number: 3, start_time: '17:00:00', end_time: '18:30:00' },
        { id: 'slot-4', slot_number: 4, start_time: '18:40:00', end_time: '20:10:00' },
      ],
      null
    );
    const client = stubClient({ students: studentsChain, schedule_time_slots: slotsChain });

    const result = await fetchSchoolTimeSlots(client, 'stu-1');

    expect(result).toEqual([
      { id: 'slot-3', slotNumber: 3, slotLabel: '17:00〜18:30' },
      { id: 'slot-4', slotNumber: 4, slotLabel: '18:40〜20:10' },
    ]);
    // 所属校で明示的に絞っている（兄弟が別教室の罠対策）。
    expect(slotsChain.eq).toHaveBeenCalledWith('school_id', 'sch-1');
    expect(slotsChain.eq).toHaveBeenCalledWith('is_active', true);
  });

  it('開始/終了時刻が欠けている時限はラベルが作れないため除外する', async () => {
    const studentsChain = createMockChain({ school_id: 'sch-1' }, null);
    const slotsChain = createMockChain(
      [
        { id: 'slot-ok', slot_number: 1, start_time: '09:00:00', end_time: '10:30:00' },
        { id: 'slot-broken', slot_number: 2, start_time: null, end_time: null },
      ],
      null
    );
    const client = stubClient({ students: studentsChain, schedule_time_slots: slotsChain });

    const result = await fetchSchoolTimeSlots(client, 'stu-1');

    expect(result).toEqual([{ id: 'slot-ok', slotNumber: 1, slotLabel: '09:00〜10:30' }]);
  });

  it('生徒が見つからない（所属校が無い）なら空配列を返し、時限は問い合わせない', async () => {
    const studentsChain = createMockChain(null, null);
    const slotsChain = createMockChain([], null);
    const client = stubClient({ students: studentsChain, schedule_time_slots: slotsChain });

    const result = await fetchSchoolTimeSlots(client, 'stu-unknown');

    expect(result).toEqual([]);
  });
});

describe('fetchMeetingBookingUrl', () => {
  it('生徒の所属校に設定された面談予約URLを返す', async () => {
    const studentsChain = createMockChain({ school_id: 'sch-1' }, null);
    const schoolsChain = createMockChain(
      { meeting_booking_url: 'https://calendar.example.com/book' },
      null
    );
    const client = stubClient({ students: studentsChain, schools: schoolsChain });

    const result = await fetchMeetingBookingUrl(client, 'stu-1');

    expect(result).toBe('https://calendar.example.com/book');
    expect(schoolsChain.eq).toHaveBeenCalledWith('id', 'sch-1');
  });

  it('URL未設定の教室は null を返す', async () => {
    const studentsChain = createMockChain({ school_id: 'sch-1' }, null);
    const schoolsChain = createMockChain({ meeting_booking_url: null }, null);
    const client = stubClient({ students: studentsChain, schools: schoolsChain });

    const result = await fetchMeetingBookingUrl(client, 'stu-1');

    expect(result).toBeNull();
  });

  it('生徒が見つからないなら null を返し、schools は問い合わせない', async () => {
    const studentsChain = createMockChain(null, null);
    const schoolsChain = createMockChain(null, null);
    const client = stubClient({ students: studentsChain, schools: schoolsChain });

    const result = await fetchMeetingBookingUrl(client, 'stu-unknown');

    expect(result).toBeNull();
    expect(schoolsChain.eq).not.toHaveBeenCalled();
  });
});
