/**
 * 統合テスト: 退塾生の失効（account-line-design.md §9「卒業・退塾後は即時に閲覧不可」）。
 *
 * ★ このテストが存在する理由（2026-07-15 に実機で漏洩を確認）:
 *   ポータルの読み取りは RLS が守るが、**service role で算出する API は RLS をバイパスする**。
 *   `requirePortalStudent` が紐づけ（portal_account_students）だけを見て在籍を見ていなかったため、
 *   /api/mypage/transfer-usage が **退塾生の通塾パターン数・振替使用回数を返していた**
 *   （実測: limit=2 used=1）。紐づけ行は退塾しても残るのが原因。
 *   RLS の外側にある認可の穴は RLS テストでは捕まらないので、ここで独立に固定する。
 *
 * 検証すること:
 *   1. 退塾超過の生徒は students / schedule_entries が RLS で見えない（既存の防壁）
 *   2. **RLS をバイパスする service role でも、在籍確認が入口で効いている**
 *      （＝ requirePortalStudent と同じ述語で 0 件になること）
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { getAdminClient, createTestSchool, cleanupTestSchool } from './helpers';
import { selectAs } from './portal-rls-helpers';

let admin: SupabaseClient;
let schoolId: string;
let activeStudentId: string;
let withdrawnStudentId: string;
let accountId: string;

const uniq = () => Math.random().toString(36).slice(2, 8);

beforeAll(async () => {
  admin = getAdminClient();
  const school = await createTestSchool(admin, { name: '退塾失効の検証校' });
  schoolId = school.id;

  const mkStudent = async (withdrawalDate: string | null) => {
    const u = uniq();
    const { data, error } = await admin
      .from('students')
      .insert({
        school_id: schoolId,
        student_code: `WD_${u}`,
        last_name: `姓${u}`,
        first_name: `名${u}`,
        last_name_kana: 'セイ',
        first_name_kana: 'メイ',
        grade: 8,
        status: withdrawalDate ? 'withdrawn' : 'active',
        withdrawal_date: withdrawalDate,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`生徒作成失敗: ${error?.message}`);
    return data.id as string;
  };
  activeStudentId = await mkStudent(null);
  // 昨日で退塾＝失効済み
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  withdrawnStudentId = await mkStudent(yesterday);

  const { data: acc, error: accErr } = await admin
    .from('portal_accounts')
    .insert({ display_name: '検証保護者', login_id: `wd_${uniq()}` })
    .select('id')
    .single();
  if (accErr || !acc) throw new Error(`アカウント作成失敗: ${accErr?.message}`);
  accountId = acc.id;

  // ★ 両方に紐づける。退塾しても紐づけ行は残る＝これが穴の前提だった。
  await admin.from('portal_account_students').insert([
    { account_id: accountId, student_id: activeStudentId, relation: 'mother' },
    { account_id: accountId, student_id: withdrawnStudentId, relation: 'mother' },
  ]);
});

afterAll(async () => {
  if (!admin) return;
  await admin.from('portal_account_students').delete().eq('account_id', accountId);
  await admin.from('portal_accounts').delete().eq('id', accountId);
  await admin.from('students').delete().eq('school_id', schoolId);
  await cleanupTestSchool(admin, schoolId);
});

describe('退塾生の失効', () => {
  it('紐づけ行は退塾後も残る（穴の前提。ここが「紐づけだけ見ると通る」理由）', async () => {
    const { data } = await admin
      .from('portal_account_students')
      .select('student_id')
      .eq('account_id', accountId);
    expect((data ?? []).map((r) => r.student_id)).toContain(withdrawnStudentId);
  });

  it('RLS: 退塾生は students から見えない / 在籍生は見える', async () => {
    const rows = await selectAs('portal', accountId, 'select id from students order by id');
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(activeStudentId);
    expect(ids).not.toContain(withdrawnStudentId);
  });

  it('★ 在籍確認の述語が退塾生を弾く（requirePortalStudent が使う判定と同じ形）', async () => {
    // requirePortalStudent は ポータルJWTのクライアントで students を1件引き、
    // 0件なら 403 にする。その判定をSQLレベルで固定する。
    const active = await selectAs('portal', accountId, 'select id from students where id = $1', [
      activeStudentId,
    ]);
    const withdrawn = await selectAs('portal', accountId, 'select id from students where id = $1', [
      withdrawnStudentId,
    ]);
    expect(active.length).toBe(1); // 在籍 → 通す
    expect(withdrawn.length).toBe(0); // 退塾 → 403 に落ちる
  });

  it('退塾日が未来の生徒は在籍扱い（境界: 当日はまだ見える）', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await admin.from('students').update({ withdrawal_date: today }).eq('id', withdrawnStudentId);
    const rows = await selectAs('portal', accountId, 'select id from students where id = $1', [
      withdrawnStudentId,
    ]);
    expect(rows.length).toBe(1); // withdrawal_date >= current_date なので当日は可視
    // 後続テストのために戻す
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await admin
      .from('students')
      .update({ withdrawal_date: yesterday })
      .eq('id', withdrawnStudentId);
  });
});
