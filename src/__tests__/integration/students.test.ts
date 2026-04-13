/**
 * 統合テスト: students API
 * ローカルSupabaseに接続し、生徒のCRUDを実際にテストする
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getAdminClient, createTestSchool, cleanupTestSchool } from './helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

let adminClient: SupabaseClient;
let testSchoolId: string;

// supabase シングルトンを service_role クライアントに差し替え
vi.mock('@/lib/supabase', async () => {
  const { getAdminClient } = await import('./helpers');
  const client = getAdminClient();
  return {
    supabase: client,
    getSupabaseBrowserClient: () => client,
    createSupabaseBrowserClient: () => client,
  };
});

// getDefaultSchoolId をテスト用教室IDに差し替え
vi.mock('@/lib/api/schools', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/schools')>();
  return {
    ...original,
    getDefaultSchoolId: () => testSchoolId,
  };
});

describe('Students API (統合テスト)', () => {
  let createdStudentId: string;

  beforeAll(async () => {
    adminClient = getAdminClient();
    const school = await createTestSchool(adminClient);
    testSchoolId = school.id;
  });

  afterAll(async () => {
    if (testSchoolId) {
      await cleanupTestSchool(adminClient, testSchoolId);
    }
  });

  it('createStudent: 生徒を新規作成できる', async () => {
    const { createStudent } = await import('@/lib/api/students');
    const student = await createStudent({
      school_id: testSchoolId,
      last_name: '統合',
      first_name: 'テスト太郎',
      last_name_kana: 'トウゴウ',
      first_name_kana: 'テストタロウ',
      grade: 3,
      status: 'active',
    });

    expect(student).toBeDefined();
    expect(student.id).toBeTruthy();
    expect(student.last_name).toBe('統合');
    expect(student.first_name).toBe('テスト太郎');
    expect(student.grade).toBe(3);
    expect(student.status).toBe('active');
    expect(student.school_id).toBe(testSchoolId);
    expect(student.student_code).toBeTruthy();

    createdStudentId = student.id;
  });

  it('getStudent: 作成した生徒を取得できる', async () => {
    const { getStudent } = await import('@/lib/api/students');
    const student = await getStudent(createdStudentId);

    expect(student).not.toBeNull();
    expect(student!.id).toBe(createdStudentId);
    expect(student!.last_name).toBe('統合');
  });

  it('getStudentsPage: 教室の生徒一覧を取得できる', async () => {
    const { getStudentsPage } = await import('@/lib/api/students');
    const result = await getStudentsPage({
      schoolIds: [testSchoolId],
      offset: 0,
      limit: 10,
    });

    expect(result.totalCount).toBeGreaterThanOrEqual(1);
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
    const found = result.rows.find((s) => s.id === createdStudentId);
    expect(found).toBeTruthy();
    // EnrichedStudent に subjects と schedulePatterns が含まれている
    expect(Array.isArray(found!.subjects)).toBe(true);
    expect(Array.isArray(found!.schedulePatterns)).toBe(true);
  });

  it('updateStudent: 生徒情報を更新できる', async () => {
    const { updateStudent } = await import('@/lib/api/students');
    const updated = await updateStudent(createdStudentId, {
      first_name: '更新済み太郎',
      grade: 4,
    });

    expect(updated.first_name).toBe('更新済み太郎');
    expect(updated.grade).toBe(4);
  });

  it('searchStudents: 名前で検索できる', async () => {
    const { searchStudents } = await import('@/lib/api/students');
    // searchStudents(schoolId, query) の順序
    const results = await searchStudents(testSchoolId, '更新済み');

    expect(results.length).toBeGreaterThanOrEqual(1);
    const found = results.find((s) => s.id === createdStudentId);
    expect(found).toBeTruthy();
  });

  it('deleteStudent: 生徒を論理削除できる', async () => {
    const { deleteStudent, getStudent } = await import('@/lib/api/students');
    await deleteStudent(createdStudentId);

    // 論理削除後は取得できない（deleted_at IS NULL 条件）
    const student = await getStudent(createdStudentId);
    expect(student).toBeNull();
  });

  it('restoreStudent: 論理削除を復元できる', async () => {
    const { restoreStudent, getStudent } = await import('@/lib/api/students');
    await restoreStudent(createdStudentId);

    const student = await getStudent(createdStudentId);
    expect(student).not.toBeNull();
    expect(student!.id).toBe(createdStudentId);
  });

  it('createStudent: 重複する生徒コードでエラーになる', async () => {
    const { createStudent } = await import('@/lib/api/students');
    const uniqueCode = `DUP_${Date.now()}`;

    // 1人目: 成功
    await createStudent({
      school_id: testSchoolId,
      last_name: '重複',
      first_name: 'テスト1',
      last_name_kana: 'ジュウフク',
      first_name_kana: 'テスト1',
      grade: 1,
      status: 'active',
      student_code: uniqueCode,
    });

    // 2人目: 同じコードでエラー
    await expect(
      createStudent({
        school_id: testSchoolId,
        last_name: '重複',
        first_name: 'テスト2',
        last_name_kana: 'ジュウフク',
        first_name_kana: 'テスト2',
        grade: 1,
        status: 'active',
        student_code: uniqueCode,
      })
    ).rejects.toThrow('この生徒コードは既に使用されています');
  });
});
