import type { SupabaseClient } from '@supabase/supabase-js';
import { canAssignRole, isManagerOrAbove } from '@/lib/utils/roles';

/**
 * スタッフ招待（user_invitations）の「招待した人にその権限を配る資格があるか」の判定。
 *
 * ★なぜ受諾時にも検査するのか:
 *   招待の行は RLS（"Admins can manage invitations"）上、教室長でも PostgREST を直接叩けば
 *   role='admin' で INSERT できてしまう。受諾APIは招待の role をそのままプロフィールに写すので、
 *   ここで見ないと「教室長が管理者を作る」権限昇格になる。作成時の検査だけでは、
 *   DB を直接書かれた行や、招待後に招待者が降格・無効化されたケースを防げない。
 *   そのため「受諾の瞬間の招待者の現在のロール」で判定する。
 *
 * ★判定規則はユーザー作成API（src/app/api/admin/users/create/route.ts）と完全に同じにする:
 *   - 招待者は教室長（manager）以上（作成APIの requireManager に相当）
 *   - 付与するロールは招待者より「厳密に下」（targetLevel >= myLevel なら拒否）。
 *     管理者（admin）にも例外はない＝管理者が管理者を招待することはできない。
 *     作成APIでも admin は admin を作れないため、招待だけ抜け道にしない。
 *   - 招待先の教室は招待者の担当範囲内（作成APIの isSchoolInScope に相当。
 *     admin / owner は全教室が範囲内）
 *   片方だけ緩めると、緩い方が抜け道になる。変えるときは両方を同時に変えること。
 */

/**
 * 招待者（inviterRole）が invitedRole を付与してよいか。
 * 招待者が教室長以上で、かつ付与ロールが招待者より厳密に下のときだけ true。
 * 上下関係の判定そのものはユーザー作成・編集APIと共通の canAssignRole に任せる
 * （ここで別に書くと片方だけ直されてズレるため）。未知のロールは canAssignRole が弾く。
 */
export function canInviterGrantRole(
  inviterRole: string | null | undefined,
  invitedRole: string | null | undefined
): boolean {
  if (!isManagerOrAbove(inviterRole)) return false;
  return canAssignRole(inviterRole, invitedRole);
}

/** 招待先の教室がすべて招待者の担当範囲内か。教室の指定が無い招待は範囲の問題が起きないので true。 */
export function areSchoolsInInviterScope(
  invitedSchoolIds: readonly string[],
  inviterSchoolIds: readonly string[]
): boolean {
  return invitedSchoolIds.every((id) => inviterSchoolIds.includes(id));
}

export type InviterAuthorityResult =
  | { ok: true }
  | { ok: false; reason: 'no_inviter' | 'inviter_inactive' | 'role_not_allowed' | 'school_scope' };

/**
 * 招待行の invited_by を service role で引き直し、今の時点で招待が有効かを判定する。
 * supabaseAdmin は必ず service role のクライアントを渡すこと（RLS を通すと招待者の行が読めない）。
 */
export async function verifyInviterAuthority(
  supabaseAdmin: SupabaseClient,
  invitation: { invited_by: string | null; role: string; school_ids: string[] | null }
): Promise<InviterAuthorityResult> {
  // 招待者不明の招待は、誰がその権限を配ったのか辿れないので受け付けない。
  if (!invitation.invited_by) return { ok: false, reason: 'no_inviter' };

  const { data: inviter, error } = await supabaseAdmin
    .from('user_profiles')
    .select('id, role, is_active')
    .eq('id', invitation.invited_by)
    .maybeSingle();
  if (error) throw error;
  if (!inviter) return { ok: false, reason: 'no_inviter' };
  // 招待後に無効化（退職など）された人の招待は、その人の権限で配られたものなので失効させる。
  if (inviter.is_active === false) return { ok: false, reason: 'inviter_inactive' };

  if (!canInviterGrantRole(inviter.role as string, invitation.role)) {
    return { ok: false, reason: 'role_not_allowed' };
  }

  const invitedSchoolIds = Array.isArray(invitation.school_ids) ? invitation.school_ids : [];
  if (invitedSchoolIds.length > 0) {
    const inviterRole = String(inviter.role ?? '').toLowerCase();
    // admin / owner は全教室が担当範囲（getApiAuth と同じ扱い）。
    if (inviterRole !== 'admin' && inviterRole !== 'owner') {
      const { data: rows, error: schoolsError } = await supabaseAdmin
        .from('user_schools')
        .select('school_id')
        .eq('user_id', inviter.id);
      if (schoolsError) throw schoolsError;
      const inviterSchoolIds = (rows || []).map((r: { school_id: string }) => r.school_id);
      if (!areSchoolsInInviterScope(invitedSchoolIds, inviterSchoolIds)) {
        return { ok: false, reason: 'school_scope' };
      }
    }
  }

  return { ok: true };
}
