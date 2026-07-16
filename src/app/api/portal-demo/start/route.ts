import { NextRequest, NextResponse } from 'next/server';
import { requireSystemAdmin } from '@/lib/api-auth';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { signPortalJwt } from '@/lib/mypage/jwt';
import { setPortalSession } from '@/lib/mypage/session';

export const dynamic = 'force-dynamic';

/** デモ用ポータルアカウントのログインID（データ投入側と揃える固定値）。 */
const DEMO_LOGIN_ID = 'demo-parent';

/**
 * システム管理者（admin）向け「デモ用ポータルセッション」の発行。
 *
 * 背景:
 *   /mypage を本番で触ってもらいたいが、全体フラグ（portal_v2_enabled）を ON にすると
 *   /mypage/login が一般公開されてしまう。そこでフラグは OFF のまま据え置き、
 *   署名済みの demo クレーム付きセッションだけがレイアウトの門番を通れるようにする。
 *
 * ★ 公開範囲は admin のみ（ユーザー判断 2026-07-16「一旦見えるのはアドミンのみ」）:
 *   当初は「教室長に本番で触ってもらう」目的で manager 以上に開いていたが、まずは
 *   admin だけに絞る。requireAdmin ではなく requireSystemAdmin を使うのは、
 *   **requireAdmin が owner も通してしまう**ため（UI の isSystemAdmin と境界がズレ、
 *   「メニューに出ないのに API は叩ける」状態になる）。
 *   教室長にも開く段階になったら requireManager に戻し、AppHeader の条件と
 *   デモSQL の user_schools 付与範囲（2-b）も**3点セットで**揃えること。
 *
 * 安全性の三重構造:
 *   1) この発行口をスタッフ認証（admin のみ）で閉じる ＝ 外から叩けない
 *   2) 発行対象をデモアカウント1つに固定し、その紐づけ生徒が全員ダミーかを検証する（下記）
 *   3) 発行後も RLS が「紐づいた生徒」しか見せない ＝ 実データには構造的に到達できない
 */
export async function POST(request: NextRequest) {
  // admin 以外（owner / manager / 講師）と未認証はここで弾く（401/403 を返す）。
  const denied = await requireSystemAdmin(request);
  if (denied) return denied;

  const supabase = getPortalServiceClient();

  const { data: account, error } = await supabase
    .from('portal_accounts')
    .select('id, login_id, display_name')
    .eq('login_id', DEMO_LOGIN_ID)
    .maybeSingle();

  if (error) {
    console.error('[portal-demo/start] デモアカウントの検索に失敗:', error.message);
    return NextResponse.json({ error: 'デモの起動に失敗しました' }, { status: 500 });
  }
  if (!account) {
    // データ投入は別タスク。未投入は「異常」ではなく「まだ使えない」なので 503。
    return NextResponse.json({ error: 'デモデータが未投入です' }, { status: 503 });
  }

  // ★ 構造的な安全チェック（最後の砦）
  //   デモアカウントに実在生徒が1人でも紐づいていたら、RLS は「正当な紐づけ」として
  //   その生徒の実データを見せてしまう。紐づけはデータ投入ミスや将来の運用オペで
  //   壊れうるので、「コードは正しいがデータが事故っている」ケースをここで止める。
  //   ＝ デモセッションが実データに触れる経路を、データ側の事故があっても塞ぐ。
  const { data: links, error: linkError } = await supabase
    .from('portal_account_students')
    .select('student_id, students(id, is_test, schools(id, is_demo))')
    .eq('account_id', account.id);

  if (linkError) {
    console.error('[portal-demo/start] 紐づけ生徒の検証に失敗:', linkError.message);
    return NextResponse.json({ error: 'デモの起動に失敗しました' }, { status: 500 });
  }

  const rows = links ?? [];
  // 紐づけゼロは「空のポータルを見せるだけ」で危険はないが、デモとして意味を成さない。
  // 一方で「全員ダミー」の検証は vacuous に true になってしまうため、明示的に弾く。
  if (rows.length === 0) {
    return NextResponse.json({ error: 'デモデータが未投入です' }, { status: 503 });
  }

  const allDummy = rows.every((row: Record<string, unknown>) => {
    const student = row.students as { is_test?: boolean; schools?: { is_demo?: boolean } } | null;
    return student?.is_test === true && student?.schools?.is_demo === true;
  });

  if (!allDummy) {
    console.error(
      JSON.stringify({
        type: 'PORTAL_DEMO_UNSAFE_LINK',
        message:
          'デモアカウントに実データ生徒が紐づいています。デモセッションの発行を中止しました。',
        accountId: account.id,
        linkedCount: rows.length,
        timestamp: new Date().toISOString(),
      })
    );
    return NextResponse.json(
      { error: 'デモデータの構成が不正です（管理者に連絡してください）' },
      { status: 500 }
    );
  }

  // demo クレーム付きで発行する。これがフラグ OFF 下で /mypage を通る唯一の鍵。
  const jwt = await signPortalJwt(account.id, { demo: true });
  await setPortalSession(jwt);

  return NextResponse.json({ ok: true });
}
