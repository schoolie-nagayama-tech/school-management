/**
 * 統合テスト: schools API
 * ローカルSupabaseに接続し、教室のCRUDを実際にテストする
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getAdminClient, createTestSchool, cleanupTestSchool } from './helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

let adminClient: SupabaseClient;
let testSchoolId: string;

// lib/api/schools.ts は `supabase` (ブラウザ用シングルトン) を使うため、
// テスト時は service_role クライアントに差し替える
vi.mock('@/lib/supabase', async () => {
  const { getAdminClient } = await import('./helpers');
  const client = getAdminClient();
  return {
    supabase: client,
    getSupabaseBrowserClient: () => client,
    createSupabaseBrowserClient: () => client,
  };
});

describe('Schools API (統合テスト)', () => {
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

  it('getSchool: 教室を1件取得できる', async () => {
    const { getSchool } = await import('@/lib/api/schools');
    const school = await getSchool(testSchoolId);
    expect(school).not.toBeNull();
    expect(school!.id).toBe(testSchoolId);
    expect(school!.name).toContain('テスト教室');
  });

  it('getSchool: 存在しないIDはnullを返す', async () => {
    const { getSchool } = await import('@/lib/api/schools');
    const school = await getSchool('00000000-0000-0000-0000-000000000000');
    expect(school).toBeNull();
  });

  it('getSchoolByCode: コードで教室を取得できる', async () => {
    const { data: schoolData } = await adminClient
      .from('schools')
      .select('code')
      .eq('id', testSchoolId)
      .single();

    const { getSchoolByCode } = await import('@/lib/api/schools');
    const school = await getSchoolByCode(schoolData!.code);
    expect(school).not.toBeNull();
    expect(school!.id).toBe(testSchoolId);
  });

  it('getSchoolByCode: 存在しないコードはnullを返す', async () => {
    const { getSchoolByCode } = await import('@/lib/api/schools');
    const school = await getSchoolByCode('NONEXISTENT_CODE_XYZ');
    expect(school).toBeNull();
  });

  it('getSchools: 教室一覧を取得できる', async () => {
    const { getSchools } = await import('@/lib/api/schools');
    const schools = await getSchools();
    expect(Array.isArray(schools)).toBe(true);
    expect(schools.length).toBeGreaterThanOrEqual(1);
    // テスト教室が含まれているか
    const found = schools.find((s) => s.id === testSchoolId);
    expect(found).toBeTruthy();
  });
});
