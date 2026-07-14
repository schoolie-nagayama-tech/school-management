/**
 * 統合テスト: 掲示板 audience 拡張の RLS 境界（docs/portal-v2-requirements.md §7-2）。
 *
 * 保証:
 *   1. audience が 社内 のみの投稿は portal から不可視。
 *   2. audience に 保護者/生徒 を含み target_scope='all' の投稿は紐づけ portal に可視。
 *   3. target_scope='grade' は自分の紐づけ生徒の学年に一致するときだけ可視。
 *   4. target_scope='individual' は bulletin_post_targets に自分の紐づけ生徒が居るときだけ可視。
 *   5. bulletin_portal_reads は自分の既読だけ可視。
 *   6. 既存スタッフ挙動が不変: authenticated は 社内 の投稿を従来どおり読める（allow_all_auth）。
 *   7. relation と audience の対応: '生徒' 宛は本人(self)のみ・保護者(father/mother/other)は
 *      '保護者' 宛のみ可視（生徒に保護者向け情報を出さない、の裏表）。
 *   8. 教室スコープ: 他教室の投稿は audience/target が該当しても不可視。
 *   9. アーカイブ済み・公開開始前の投稿は不可視（直接PostgRESTを叩かれてもDB層で遮断）。
 *
 * seed/cleanup は service role、境界検証は pg 直結（request.jwt.claims + SET ROLE）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { getAdminClient, createTestSchool, cleanupTestSchool } from './helpers';
import { selectAs, tryCountAs } from './portal-rls-helpers';

let admin: SupabaseClient;
let schoolId: string;

let studentAId: string; // grade 5・accountA(father)
let studentBId: string; // grade 8・accountB(mother)・accountSelfB(self)
let accountAId: string;
let accountBId: string;
let accountSelfBId: string; // studentB 本人（relation='self'）

let otherSchoolId: string; // 教室スコープ検証用の別教室

let postInternalId: string; // 社内のみ
let postAllId: string; // 保護者・全体
let postGrade5Id: string; // 保護者・学年5
let postIndivBId: string; // 生徒・個別(studentB) → self のみ可視（保護者には出ない）
let postOtherSchoolId: string; // 別教室・保護者・全体 → 不可視
let postArchivedId: string; // 保護者・全体・アーカイブ済み → 不可視
let postFutureId: string; // 保護者・全体・公開開始が未来 → 不可視

const uniq = () => Math.random().toString(36).slice(2, 8);

beforeAll(async () => {
  admin = getAdminClient();
  const school = await createTestSchool(admin, { name: 'ポータル掲示板教室' });
  schoolId = school.id;

  const mkStudent = async (grade: number) => {
    const u = uniq();
    const { data, error } = await admin
      .from('students')
      .insert({
        school_id: schoolId,
        student_code: `PBUL_${u}`,
        last_name: `姓${u}`,
        first_name: `名${u}`,
        last_name_kana: 'セイ',
        first_name_kana: 'メイ',
        grade,
        status: 'active',
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`生徒作成失敗: ${error?.message}`);
    return data.id as string;
  };
  studentAId = await mkStudent(5);
  studentBId = await mkStudent(8);

  const mkAccount = async (name: string) => {
    const { data, error } = await admin
      .from('portal_accounts')
      .insert({ display_name: name, login_id: `login_${uniq()}` })
      .select('id')
      .single();
    if (error || !data) throw new Error(`アカウント作成失敗: ${error?.message}`);
    return data.id as string;
  };
  accountAId = await mkAccount('保護者A');
  accountBId = await mkAccount('保護者B');
  accountSelfBId = await mkAccount('生徒B本人');

  await admin
    .from('portal_account_students')
    .insert({ account_id: accountAId, student_id: studentAId, relation: 'father' });
  await admin
    .from('portal_account_students')
    .insert({ account_id: accountBId, student_id: studentBId, relation: 'mother' });
  await admin
    .from('portal_account_students')
    .insert({ account_id: accountSelfBId, student_id: studentBId, relation: 'self' });

  // 教室スコープ検証用の別教室（生徒の紐づけは作らない）。
  const otherSchool = await createTestSchool(admin, { name: 'ポータル掲示板・別教室' });
  otherSchoolId = otherSchool.id;

  const mkPost = async (overrides: Record<string, unknown>) => {
    const { data, error } = await admin
      .from('bulletin_posts')
      .insert({
        school_id: schoolId,
        title: `件名${uniq()}`,
        content: '本文',
        ...overrides,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`投稿作成失敗: ${error?.message}`);
    return data.id as string;
  };

  // 社内のみ（列を指定しない＝既定 {社内}/all で従来動作）。
  postInternalId = await mkPost({});
  // 保護者・全体。
  postAllId = await mkPost({ audience: ['保護者'], target_scope: 'all' });
  // 保護者・学年5。
  postGrade5Id = await mkPost({ audience: ['保護者'], target_scope: 'grade', target_grade: [5] });
  // 生徒・個別(studentB)。audience='生徒' なので本人(self)のみ可視、保護者(mother)には出ない。
  postIndivBId = await mkPost({ audience: ['生徒'], target_scope: 'individual' });
  await admin
    .from('bulletin_post_targets')
    .insert({ post_id: postIndivBId, student_id: studentBId });
  // 別教室・保護者・全体（教室スコープで不可視になるべき）。
  postOtherSchoolId = await mkPost({
    school_id: otherSchoolId,
    audience: ['保護者'],
    target_scope: 'all',
  });
  // アーカイブ済み（保護者・全体でも不可視になるべき）。
  postArchivedId = await mkPost({ audience: ['保護者'], target_scope: 'all', is_archived: true });
  // 公開開始が未来（予約公開。公開前は不可視になるべき）。
  postFutureId = await mkPost({
    audience: ['保護者'],
    target_scope: 'all',
    publish_start_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });

  // accountA の既読1件（自分の既読だけ見える検証用）。
  await admin
    .from('bulletin_portal_reads')
    .insert({ post_id: postAllId, portal_account_id: accountAId });
});

afterAll(async () => {
  if (!admin) return;
  const postIds = [
    postInternalId,
    postAllId,
    postGrade5Id,
    postIndivBId,
    postOtherSchoolId,
    postArchivedId,
    postFutureId,
  ];
  await admin.from('bulletin_portal_reads').delete().in('post_id', postIds);
  await admin.from('bulletin_post_targets').delete().in('post_id', postIds);
  await admin.from('bulletin_posts').delete().in('id', postIds);
  await admin.from('portal_account_students').delete().eq('account_id', accountAId);
  await admin.from('portal_account_students').delete().eq('account_id', accountBId);
  await admin.from('portal_account_students').delete().eq('account_id', accountSelfBId);
  await admin
    .from('portal_accounts')
    .delete()
    .in('id', [accountAId, accountBId, accountSelfBId]);
  await admin.from('students').delete().eq('school_id', schoolId);
  await cleanupTestSchool(admin, otherSchoolId);
  await cleanupTestSchool(admin, schoolId);
});

describe('bulletin_posts: ポータル audience/target 可視性', () => {
  it('社内のみの投稿は portal から不可視', async () => {
    const rows = await selectAs(
      'portal',
      accountAId,
      'select id from bulletin_posts where id = $1',
      [postInternalId]
    );
    expect(rows.length).toBe(0);
  });

  it('保護者・全体は紐づけ portal（A・B とも）に可視', async () => {
    const a = await selectAs('portal', accountAId, 'select id from bulletin_posts where id = $1', [
      postAllId,
    ]);
    const b = await selectAs('portal', accountBId, 'select id from bulletin_posts where id = $1', [
      postAllId,
    ]);
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
  });

  it('学年5指定は accountA(5年)に可視・accountB(8年)に不可視', async () => {
    const a = await selectAs('portal', accountAId, 'select id from bulletin_posts where id = $1', [
      postGrade5Id,
    ]);
    const b = await selectAs('portal', accountBId, 'select id from bulletin_posts where id = $1', [
      postGrade5Id,
    ]);
    expect(a.length).toBe(1);
    expect(b.length).toBe(0);
  });

  it('生徒宛・個別(studentB)は本人(self)のみ可視。保護者(mother)にも他家庭にも不可視', async () => {
    // audience='生徒' は relation='self' だけに立つ（保護者に生徒宛は出さない・逆も同様）。
    const self = await selectAs(
      'portal',
      accountSelfBId,
      'select id from bulletin_posts where id = $1',
      [postIndivBId]
    );
    const mother = await selectAs(
      'portal',
      accountBId,
      'select id from bulletin_posts where id = $1',
      [postIndivBId]
    );
    const a = await selectAs('portal', accountAId, 'select id from bulletin_posts where id = $1', [
      postIndivBId,
    ]);
    expect(self.length).toBe(1);
    expect(mother.length).toBe(0);
    expect(a.length).toBe(0);
  });

  it('保護者宛は本人(self)アカウントに不可視（生徒に保護者向け情報を出さない）', async () => {
    const self = await selectAs(
      'portal',
      accountSelfBId,
      'select id from bulletin_posts where id = $1',
      [postAllId]
    );
    expect(self.length).toBe(0);
  });

  it('他教室の投稿は audience/target が該当しても不可視（教室スコープ）', async () => {
    const a = await selectAs('portal', accountAId, 'select id from bulletin_posts where id = $1', [
      postOtherSchoolId,
    ]);
    expect(a.length).toBe(0);
  });

  it('アーカイブ済み・公開開始前の投稿は不可視（DB層で遮断）', async () => {
    const archived = await selectAs(
      'portal',
      accountAId,
      'select id from bulletin_posts where id = $1',
      [postArchivedId]
    );
    const future = await selectAs(
      'portal',
      accountAId,
      'select id from bulletin_posts where id = $1',
      [postFutureId]
    );
    expect(archived.length).toBe(0);
    expect(future.length).toBe(0);
  });
});

describe('bulletin_portal_reads: 自分の既読だけ可視', () => {
  it('accountA は自分の既読を読める / accountB からは見えない', async () => {
    const a = await selectAs(
      'portal',
      accountAId,
      'select post_id from bulletin_portal_reads where post_id = $1',
      [postAllId]
    );
    const b = await selectAs(
      'portal',
      accountBId,
      'select post_id from bulletin_portal_reads where post_id = $1',
      [postAllId]
    );
    expect(a.length).toBe(1);
    expect(b.length).toBe(0);
  });
});

describe('既存スタッフ挙動の不変（audience 既定=社内で従来どおり）', () => {
  it('authenticated は 社内 の投稿を従来どおり読める', async () => {
    const rows = await selectAs(
      'authenticated',
      accountAId,
      'select id from bulletin_posts where id = $1',
      [postInternalId]
    );
    expect(rows.length).toBe(1);
  });

  it('authenticated は 保護者向け投稿も従来どおり読める（allow_all_auth）', async () => {
    const count = await tryCountAs(
      'authenticated',
      accountAId,
      'select id from bulletin_posts where id = $1',
      [postAllId]
    );
    expect(count).toBe(1);
  });
});
