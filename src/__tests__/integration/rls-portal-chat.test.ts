/**
 * 統合テスト: 保護者ポータル チャットの RLS 境界（docs/portal-v2-requirements.md §7-2）。
 *
 * 保証:
 *   1. portal は「自分が participant のスレッド」だけ SELECT できる（他生徒スレッド不可）。
 *   2. portal はそのスレッドのメッセージだけ SELECT できる（他スレッドのメッセージ不可）。
 *   3. portal はそのスレッドの既読(chat_reads)だけ SELECT できる。
 *   4. anon は chat_messages を読めない（0件 or エラー）。
 *   5. authenticated（スタッフ）は chat_messages を読めない
 *      （chat_* は portal 以外に SELECT ポリシー無し = スタッフは service role API 経由）。
 *
 * seed/cleanup は service role、境界検証は pg 直結（request.jwt.claims + SET ROLE）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { getAdminClient, createTestSchool, cleanupTestSchool } from './helpers';
import { selectAs, tryCountAs } from './portal-rls-helpers';

let admin: SupabaseClient;
let schoolId: string;

let studentAId: string;
let studentBId: string;
let accountAId: string;
let accountBId: string;
let threadAId: string;
let threadBId: string;

const uniq = () => Math.random().toString(36).slice(2, 8);

beforeAll(async () => {
  admin = getAdminClient();
  const school = await createTestSchool(admin, { name: 'ポータルChat教室' });
  schoolId = school.id;

  const mkStudent = async () => {
    const u = uniq();
    const { data, error } = await admin
      .from('students')
      .insert({
        school_id: schoolId,
        student_code: `PCHAT_${u}`,
        last_name: `姓${u}`,
        first_name: `名${u}`,
        last_name_kana: 'セイ',
        first_name_kana: 'メイ',
        grade: 5,
        status: 'active',
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`生徒作成失敗: ${error?.message}`);
    return data.id as string;
  };
  studentAId = await mkStudent();
  studentBId = await mkStudent();

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

  await admin
    .from('portal_account_students')
    .insert({ account_id: accountAId, student_id: studentAId, relation: 'guardian' });
  await admin
    .from('portal_account_students')
    .insert({ account_id: accountBId, student_id: studentBId, relation: 'guardian' });

  const mkThread = async (studentId: string) => {
    const { data, error } = await admin
      .from('chat_threads')
      .insert({ school_id: schoolId, student_id: studentId })
      .select('id')
      .single();
    if (error || !data) throw new Error(`スレッド作成失敗: ${error?.message}`);
    return data.id as string;
  };
  threadAId = await mkThread(studentAId);
  threadBId = await mkThread(studentBId);

  await admin.from('chat_thread_participants').insert([
    { thread_id: threadAId, portal_account_id: accountAId },
    { thread_id: threadBId, portal_account_id: accountBId },
  ]);

  await admin.from('chat_messages').insert([
    { thread_id: threadAId, sender_kind: 'portal', sender_id: accountAId, body: 'A message' },
    { thread_id: threadBId, sender_kind: 'portal', sender_id: accountBId, body: 'B message' },
  ]);

  await admin.from('chat_reads').insert([
    { thread_id: threadAId, reader_kind: 'portal', reader_id: accountAId },
    { thread_id: threadBId, reader_kind: 'portal', reader_id: accountBId },
  ]);
});

afterAll(async () => {
  if (!admin) return;
  await admin.from('chat_reads').delete().in('thread_id', [threadAId, threadBId]);
  await admin.from('chat_messages').delete().in('thread_id', [threadAId, threadBId]);
  await admin.from('chat_thread_participants').delete().in('thread_id', [threadAId, threadBId]);
  await admin.from('chat_threads').delete().in('id', [threadAId, threadBId]);
  await admin.from('portal_account_students').delete().eq('account_id', accountAId);
  await admin.from('portal_account_students').delete().eq('account_id', accountBId);
  await admin.from('portal_accounts').delete().in('id', [accountAId, accountBId]);
  await admin.from('students').delete().eq('school_id', schoolId);
  await cleanupTestSchool(admin, schoolId);
});

describe('chat_threads: 自分が participant のスレッドだけ可視', () => {
  it('accountA は threadA を読めるが threadB は読めない', async () => {
    const rows = await selectAs(
      'portal',
      accountAId,
      'select id from chat_threads where id = any($1)',
      [[threadAId, threadBId]]
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(threadAId);
    expect(ids).not.toContain(threadBId);
  });
});

describe('chat_messages: 自分が participant のスレッドのメッセージだけ可視', () => {
  it('accountA は threadA のメッセージのみ読める', async () => {
    const rows = await selectAs(
      'portal',
      accountAId,
      'select thread_id from chat_messages where thread_id = any($1)',
      [[threadAId, threadBId]]
    );
    const ids = rows.map((r) => r.thread_id);
    expect(ids).toContain(threadAId);
    expect(ids).not.toContain(threadBId);
  });

  it('anon は chat_messages を読めない（0件 or エラー）', async () => {
    const count = await tryCountAs('anon', null, 'select id from chat_messages limit 1');
    expect(count === 0 || count === -1).toBe(true);
  });

  it('authenticated（スタッフ）は chat_messages を読めない（portal専用grant）', async () => {
    const count = await tryCountAs(
      'authenticated',
      accountAId,
      'select id from chat_messages limit 1'
    );
    // grant 無し → permission denied(-1) を期待。仮に select 可でも RLS で 0 件。
    expect(count === -1 || count === 0).toBe(true);
  });
});

describe('chat_reads: 自分が participant のスレッドの既読だけ可視', () => {
  it('accountA は threadA の既読のみ読める', async () => {
    const rows = await selectAs(
      'portal',
      accountAId,
      'select thread_id from chat_reads where thread_id = any($1)',
      [[threadAId, threadBId]]
    );
    const ids = rows.map((r) => r.thread_id);
    expect(ids).toContain(threadAId);
    expect(ids).not.toContain(threadBId);
  });
});
