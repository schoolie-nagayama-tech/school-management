/**
 * getOrCreateAttendanceSheet の所属ガードのテスト
 *
 * このページ(/attendance/[schoolCode]/[teacherId])は開いただけでシートを作るため、
 * 所属していない教室のURLを踏むと空シートが生えて、出勤簿一覧に同じ講師が2行並んでいた。
 * 「既存は所属を見ずに返す／新規は所属している教室だけ」を固定する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// テーブルごとに応答を差し替えられる最小モック。
// 共有の createMockSupabaseClient は全テーブルで同じ応答を返すため、
// attendance_sheets と user_schools を撃ち分けたいここでは使わない。
const responses: Record<string, { data: unknown; error: unknown }> = {};
const insertedRows: unknown[] = [];

function makeChain(table: string) {
  const result = () => responses[table] ?? { data: null, error: null };
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    insert: vi.fn((row: unknown) => {
      insertedRows.push(row);
      return chain;
    }),
    single: vi.fn(async () => result()),
    maybeSingle: vi.fn(async () => result()),
  };
  Object.defineProperty(chain, 'then', {
    get:
      () =>
      (resolve: (value: unknown) => void): void =>
        resolve(result()),
    configurable: true,
  });
  return chain;
}

const fromMock = vi.fn((table: string) => makeChain(table));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => fromMock(table) },
}));

import { getOrCreateAttendanceSheet } from '@/lib/api/attendance';

const TEACHER = 'teacher-1';
const SCHOOL = 'school-1';
const YM = '2026-08';

beforeEach(() => {
  vi.clearAllMocks();
  insertedRows.length = 0;
  for (const key of Object.keys(responses)) delete responses[key];
});

describe('getOrCreateAttendanceSheet の所属ガード', () => {
  it('既存シートがあれば所属を確認せずそのまま返す（異動しても過去分を開ける）', async () => {
    responses.attendance_sheets = { data: { id: 'sheet-1', status: 'draft' }, error: null };

    const sheet = await getOrCreateAttendanceSheet(TEACHER, SCHOOL, YM);

    expect(sheet.id).toBe('sheet-1');
    expect(fromMock).not.toHaveBeenCalledWith('user_schools');
    expect(insertedRows).toHaveLength(0);
  });

  it('その教室に所属していなければ作成せずエラー', async () => {
    responses.attendance_sheets = { data: null, error: null };
    responses.user_schools = { data: [], error: null };

    await expect(getOrCreateAttendanceSheet(TEACHER, SCHOOL, YM)).rejects.toThrow(
      'この教室に所属していないため、出勤簿を作成できません'
    );
    expect(insertedRows).toHaveLength(0);
  });

  it('所属していれば下書きを作成する', async () => {
    responses.user_schools = { data: [{ school_id: SCHOOL }], error: null };
    // 検索時は null、作成後は行を返す（同じテーブルなので呼び出し順で切り替える）
    let searched = false;
    Object.defineProperty(responses, 'attendance_sheets', {
      get: () => {
        if (!searched) {
          searched = true;
          return { data: null, error: null };
        }
        return { data: { id: 'sheet-new', status: 'draft' }, error: null };
      },
      configurable: true,
    });

    const sheet = await getOrCreateAttendanceSheet(TEACHER, SCHOOL, YM);

    expect(sheet.id).toBe('sheet-new');
    expect(insertedRows).toEqual([
      { teacher_id: TEACHER, school_id: SCHOOL, year_month: YM, status: 'draft' },
    ]);
  });
});
