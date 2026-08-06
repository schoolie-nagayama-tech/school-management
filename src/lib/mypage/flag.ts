import 'server-only';
import { getPortalServiceClient } from './serviceClient';

/**
 * 保護者ポータルv2 の全体有効スイッチ（クローズド制御・緊急遮断）。
 *
 * system_settings.portal_v2_enabled が 'true' のときだけ有効。
 * /mypage レイアウトがこれを読み、false なら 404 にする（docs/portal-v2-requirements.md §6-2）。
 *
 * service_role で読む理由: この判定は未ログイン（/mypage/login 等）でも必要なので、
 * ポータルJWTやスタッフセッションに依存させない。no-store は serviceClient 側で強制済み。
 */
export async function isPortalV2Enabled(): Promise<boolean> {
  // ★ 開発環境限定のバイパス（本番フラグを触らずにローカル検証するため）:
  //   .env.local は本番DB（東京）を指しているため、ローカルで動作確認したいからと
  //   system_settings.portal_v2_enabled を true にすると、**本番の /mypage が
  //   一般公開されてしまう**。そこでローカルは環境変数だけで開けるようにする。
  //   NODE_ENV が production のときは何があっても効かせない（本番デプロイでの誤爆防止）。
  if (process.env.NODE_ENV !== 'production' && process.env.PORTAL_V2_DEV_ENABLED === 'true') {
    return true;
  }

  try {
    const supabase = getPortalServiceClient();
    const { data, error } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'portal_v2_enabled')
      .maybeSingle();

    if (error) {
      // 読み取り失敗時は安全側に倒す（無効扱い）。
      console.error('[mypage/flag] portal_v2_enabled の読み取りに失敗:', error.message);
      return false;
    }
    return data?.value === 'true';
  } catch (e) {
    console.error('[mypage/flag] portal_v2_enabled の判定に失敗:', e);
    return false;
  }
}
