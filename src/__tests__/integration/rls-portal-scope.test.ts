/**
 * 統合テスト: 保護者ポータル RLS 境界検証（docs/portal-v2-requirements.md §6-4）。
 *
 * ポータルは専用 Postgres ロール `portal` で動く（authenticated＝スタッフを
 * 暗黙仮定した既存ポリシー群からの構造的隔離。migration 20260714000000）。
 *
 * 実在の個人情報をポータルJWT経路に流す前に、必ず通す境界テスト:
 *   1. portal ロールは「自分の紐づけ生徒（在籍中）」だけ students を読める
 *   2. 紐づいていない生徒は読めない
 *   3. 退塾日を過ぎた生徒は読めない（withdrawal_date による自動失効）
 *   4. portal_invitations は（portal でも）読めない
 *   5. 自分の portal_account_students だけ読め、他アカウントのは読めない
 *   6. anon は何も読めない
 *   7. デフォルト拒否: portal は subjects / system_settings を読めない
 *      （authenticated＝スタッフは従来どおり読める＝スタッフ側の回帰確認）
 *
 * seed/cleanup は service role（RLSバイパス）で行い、境界検証は pg 直結で
 * request.jwt.claims + SET ROLE により RLS を実際に評価する（portal-rls-helpers.ts 参照）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { getAdminClient, createTestSchool, cleanupTestSchool } from './helpers';
import { selectAs, tryCountAs } from './portal-rls-helpers';

let admin: SupabaseClient;
let schoolId: string;

let studentActiveId: string; // 紐づけ済み・在籍中
let studentWithdrawnId: string; // 紐づけ済み・退塾日超過
let studentUnlinkedId: string; // 紐づけなし

let accountId: string; // テスト対象のポータルアカウント
let otherAccountId: string; // 別アカウント（他人の紐づけを見せないための対照）
let invitationId: string;

beforeAll(async () => {
  admin = getAdminClient();

  const school = await createTestSchool(admin, { name: 'ポータルRLS教室' });
  schoolId = school.id;

  const uniq = () => Math.random().toString(36).slice(2, 8);

  // ── 生徒3人（在籍中 / 退塾超過 / 紐づけなし） ──
  const mkStudent = async (overrides: Record<string, unknown>) => {
    const u = uniq();
    const { data, error } = await admin
      .from('students')
      .insert({
        school_id: schoolId,
        student_code: `PRLS_${u}`,
        last_name: `姓${u}`,
        first_name: `名${u}`,
        last_name_kana: 'セイ',
        first_name_kana: 'メイ',
        grade: 5,
        status: 'active',
        ...overrides,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`生徒作成失敗: ${error?.message}`);
    return data.id as string;
  };

  studentActiveId = await mkStudent({});
  // 退塾日を過去にして自動失効を再現する。
  studentWithdrawnId = await mkStudent({ withdrawal_date: '2020-01-01' });
  studentUnlinkedId = await mkStudent({});

  // ── ポータルアカウント2つ ──
  const mkAccount = async (name: string) => {
    const { data, error } = await admin
      .from('portal_accounts')
      .insert({ display_name: name, login_id: `login_${uniq()}` })
      .select('id')
      .single();
    if (error || !data) throw new Error(`アカウント作成失敗: ${error?.message}`);
    return data.id as string;
  };
  accountId = await mkAccount('テスト保護者');
  otherAccountId = await mkAccount('別の保護者');

  // ── 紐づけ: accountId → active(father) と withdrawn(father) ──
  const link = async (acc: string, student: string, relation: string) => {
    const { error } = await admin
      .from('portal_account_students')
      .insert({ account_id: acc, student_id: student, relation });
    if (error) throw new Error(`紐づけ失敗: ${error.message}`);
  };
  await link(accountId, studentActiveId, 'father');
  await link(accountId, studentWithdrawnId, 'father');
  // otherAccount は unlinked 生徒に紐づく（accountId からは見えないことの対照）。
  await link(otherAccountId, studentUnlinkedId, 'mother');

  // ── 招待1件（読めないことの検証用） ──
  const { data: inv, error: invErr } = await admin
    .from('portal_invitations')
    .insert({
      token: `tok_${uniq()}`,
      student_id: studentActiveId,
      invite_type: 'guardian',
      expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      school_id: schoolId,
    })
    .select('id')
    .single();
  if (invErr || !inv) throw new Error(`招待作成失敗: ${invErr?.message}`);
  invitationId = inv.id;
});

afterAll(async () => {
  if (!admin) return;
  await admin.from('portal_invitations').delete().eq('id', invitationId);
  await admin.from('portal_account_students').delete().eq('account_id', accountId);
  await admin.from('portal_account_students').delete().eq('account_id', otherAccountId);
  await admin.from('portal_accounts').delete().eq('id', accountId);
  await admin.from('portal_accounts').delete().eq('id', otherAccountId);
  await admin.from('students').delete().eq('school_id', schoolId);
  await cleanupTestSchool(admin, schoolId);
});

describe('students: ポータルRLS（portal_students_select_linked）', () => {
  it('portal ロールは在籍中の紐づけ生徒だけ読める', async () => {
    const rows = await selectAs('portal', accountId, 'select id from students where id = any($1)', [
      [studentActiveId, studentWithdrawnId, studentUnlinkedId],
    ]);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(studentActiveId);
    // 退塾超過は自動失効で見えない。
    expect(ids).not.toContain(studentWithdrawnId);
    // 紐づいていない生徒は見えない。
    expect(ids).not.toContain(studentUnlinkedId);
  });

  it('anon は students を読めない（0件 or エラー）', async () => {
    const count = await tryCountAs('anon', null, 'select id from students where id = $1', [
      studentActiveId,
    ]);
    expect(count === 0 || count === -1).toBe(true);
  });
});

describe('portal_account_students: 自分の紐づけだけ読める', () => {
  it('自分のアカウントの紐づけ行が読める', async () => {
    const rows = await selectAs(
      'portal',
      accountId,
      'select student_id from portal_account_students'
    );
    const ids = rows.map((r) => r.student_id);
    expect(ids).toContain(studentActiveId);
    expect(ids).toContain(studentWithdrawnId);
    // 他アカウントの紐づけ（unlinked生徒）は見えない。
    expect(ids).not.toContain(studentUnlinkedId);
  });

  it('別アカウントの紐づけは自分からは見えない', async () => {
    const rows = await selectAs(
      'portal',
      accountId,
      'select account_id from portal_account_students where account_id = $1',
      [otherAccountId]
    );
    expect(rows.length).toBe(0);
  });
});

describe('portal_invitations: 誰も（portalでも）読めない', () => {
  it('portal ロールは招待を読めない（0件 or エラー）', async () => {
    const count = await tryCountAs(
      'portal',
      accountId,
      'select id from portal_invitations where id = $1',
      [invitationId]
    );
    expect(count === 0 || count === -1).toBe(true);
  });

  it('anon も招待を読めない（0件 or エラー）', async () => {
    const count = await tryCountAs(
      'anon',
      null,
      'select id from portal_invitations where id = $1',
      [invitationId]
    );
    expect(count === 0 || count === -1).toBe(true);
  });
});

describe('デフォルト拒否: portal ロールは明示グラント外のテーブルを読めない', () => {
  /**
   * 保証:
   *   portal ロールには grant していないテーブルは RLS 以前に permission denied になる。
   *   authenticated＝スタッフを暗黙仮定した広いポリシー（ALL using(true) 等）が
   *   ポータル利用者に波及しないことの回帰テスト。
   *
   * ★ subjects はこのケースから外した（Stage3・2026-07-14）:
   *   予定ビューの科目表示に必要なため、Stage3 のマイグレーションで
   *   「grant select to portal ＋ to portal の using(true) ポリシー」を明示追加した
   *   （教科名は機微でないという判断）。よって subjects はもう「明示グラント外」ではない。
   *   デフォルト拒否の代表例としては、grant していない座席表テーブル
   *   （schedule_regular_patterns）と system_settings で担保する。
   *   subjects が portal から読めること自体は rls-portal-schedule.test.ts が固定する。
   */
  it('portal は schedule_regular_patterns を読めない（permission denied）', async () => {
    const count = await tryCountAs(
      'portal',
      accountId,
      'select id from schedule_regular_patterns limit 1'
    );
    expect(count).toBe(-1);
  });

  it('portal は system_settings を読めない（permission denied）', async () => {
    const count = await tryCountAs('portal', accountId, 'select key from system_settings limit 1');
    expect(count).toBe(-1);
  });

  /**
   * 保証（スタッフ側の回帰）:
   *   ポータル隔離を入れても authenticated（スタッフ）は従来どおり subjects /
   *   system_settings を読める（既存ポリシー無変更の確認）。
   */
  it('authenticated（スタッフ）は subjects を従来どおり読める（エラーにならない）', async () => {
    const count = await tryCountAs('authenticated', accountId, 'select id from subjects limit 1');
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it('authenticated（スタッフ）は system_settings を従来どおり読める（エラーにならない）', async () => {
    const count = await tryCountAs(
      'authenticated',
      accountId,
      'select key from system_settings limit 1'
    );
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
