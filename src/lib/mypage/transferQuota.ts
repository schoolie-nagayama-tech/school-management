import 'server-only';
import { getMonthlyTransferUsage } from '@/lib/api/schedule';
import { getPortalServiceClient } from './serviceClient';
import type {
  TransferQuota,
  TransferQuotaFree,
  TransferQuotaLimited,
} from '@/types/mypage-schedule';

// 型はクライアントと共有するため @/types/mypage-schedule が正。ここから再輸出しておくと
// サーバー側の呼び出し元が型の置き場所を意識せずに済む。
export type { TransferQuota, TransferQuotaFree, TransferQuotaLimited };

/**
 * 保護者ポータルの「今月の残り振替回数」判定（Stage 3）。
 *
 * 正典: docs/portal-v2-requirements.md §7-3。
 *
 * ★ この関数が判定の唯一の集約点である理由:
 *   残り回数は (a) 予定ビューの注記 (b) 欠席・振替シートの活性/非活性 (c) テンプレ投稿 API の
 *   最終防衛線 の3箇所で必要になる。判定が散らばると「UIでは押せるのにサーバーが弾く」
 *   「片方だけフリー期間を見落とす」といったズレが必ず出る。よって判定はここ1箇所に集約し、
 *   呼び出し側は結果（残り数・許可中・無制限期間中）だけを受け取る。
 *
 * ★ 上限ルールそのものは再実装しない:
 *   上限（＝有効な通塾日程パターン数）・使用（＝その月の transferred_out 件数）・
 *   「数える月は休んだ授業の月」の3点は座席表の getMonthlyTransferUsage が唯一の正。
 *   ここはそれを呼び、上に「フリー期間」と「教室の追加許可」を被せるだけ。
 *
 * ★ 月の基準は targetDate の月（今日の月ではない）— §7-3 の罠:
 *   8/1 に 7/31 の欠席を連絡したら 7 月分として数える。よって getMonthlyTransferUsage
 *   にも portal_transfer_permissions の照合にも、必ず targetDate 由来の月を渡す。
 */

/** transfer_free_periods の1行（判定に必要な最小形）。 */
export interface FreePeriodRow {
  start_date: string;
  end_date: string;
  label: string | null;
}

/**
 * 'YYYY-MM-DD' から「その月の初日」の 'YYYY-MM-01' を作る（純関数）。
 *
 * portal_transfer_permissions.month は date 型かつ「必ず月初日」が不変条件
 * （マイグレーション側の CHECK と対）。ここが唯一の生成点。
 *
 * ★ Date を経由せず文字列操作で作る理由: Date にすると実行環境の TZ で月がずれる
 *   （UTCサーバーで JST の月末日が前月になる等）。'YYYY-MM-DD' は JST カレンダー日
 *   として扱いたいので、文字列のまま切り出すのが最も安全。
 *
 * @returns 'YYYY-MM-01'。dateStr が不正なら null。
 */
export function monthStartOf(dateStr: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

/**
 * 対象授業日がフリー期間に含まれるかを判定する（純関数）。
 *
 * 境界は両端含む（start_date <= targetDate <= end_date）。§7-3 の
 * 「7/22〜8/9 は振替制限なし」は 7/22 と 8/9 を含む、という自然な解釈。
 *
 * ★ 'YYYY-MM-DD' の辞書順比較で日付順比較になるため、Date を作らない
 *   （TZ 依存を持ち込まない）。
 *
 * @param targetDate 対象授業日 'YYYY-MM-DD'
 * @param periods    候補のフリー期間（同教室のもの）
 * @returns 該当した最初の期間。含まれなければ null。
 */
export function findFreePeriod(targetDate: string, periods: FreePeriodRow[]): FreePeriodRow | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return null;
  for (const p of periods) {
    if (p.start_date <= targetDate && targetDate <= p.end_date) return p;
  }
  return null;
}

/**
 * 上限・使用・追加許可から残り回数を組み立てる（純関数）。
 *
 * ルール（§7-3）:
 *   effectiveLimit = limit + permissionExtra
 *   remaining      = max(0, effectiveLimit - used)   ← 超過していても負にしない
 *   canRequestTransfer = remaining > 0
 *
 * @param limit           素の上限（getMonthlyTransferUsage の limit）
 * @param used            使用済み（getMonthlyTransferUsage の used）
 * @param permissionExtra 教室の追加許可回数（無ければ0）
 * @param monthLabel      表示用の月ラベル
 */
export function computeQuota(
  limit: number,
  used: number,
  permissionExtra: number,
  monthLabel: string
): TransferQuotaLimited {
  const extra = Math.max(0, permissionExtra);
  const effectiveLimit = limit + extra;
  // 既に超過している（used > effectiveLimit）場合も残りは 0 に丸める（負を見せない）。
  const remaining = Math.max(0, effectiveLimit - used);
  return {
    mode: 'limited',
    limit,
    effectiveLimit,
    used,
    remaining,
    canRequestTransfer: remaining > 0,
    hasPermission: extra > 0,
    permissionExtra: extra,
    monthLabel,
  };
}

/**
 * 生徒×対象授業日の振替クォータを判定する（service role・サーバー専用）。
 *
 * 手順（§7-3）:
 *   1. 対象授業日がフリー期間に含まれる → { mode:'free' }（上限判定なし）
 *   2. そうでなければ getMonthlyTransferUsage(studentId, targetDate)（既存・唯一の正）
 *      ＋ portal_transfer_permissions（対象授業日の月）の extra_count を足して判定
 *
 * ★ 呼び出し側は必ず「そのアカウントの紐づけ生徒か」を先に検証すること
 *   （この関数は service role で RLS をバイパスするため、認可は行わない）。
 *
 * @param studentId  対象生徒
 * @param targetDate 対象授業日 'YYYY-MM-DD'（今日ではない。§7-3の罠）
 */
export async function getPortalTransferQuota(
  studentId: string,
  targetDate: string
): Promise<TransferQuota> {
  const svc = getPortalServiceClient();

  // 生徒の所属校（フリー期間は教室ごとの設定なので校の特定が要る）。
  const { data: student } = await svc
    .from('students')
    .select('school_id')
    .eq('id', studentId)
    .maybeSingle();
  const schoolId = (student as { school_id: string } | null)?.school_id ?? null;

  // ── 1) フリー期間（対象授業日がその期間内か） ──
  if (schoolId) {
    const { data: periods } = await svc
      .from('transfer_free_periods')
      .select('start_date, end_date, label')
      .eq('school_id', schoolId)
      // 対象授業日を含む期間だけを DB 側で絞る（純関数側でも境界を再判定する）。
      .lte('start_date', targetDate)
      .gte('end_date', targetDate);

    const hit = findFreePeriod(targetDate, (periods ?? []) as FreePeriodRow[]);
    if (hit) {
      return {
        mode: 'free',
        label: hit.label,
        startDate: hit.start_date,
        endDate: hit.end_date,
        canRequestTransfer: true,
      };
    }
  }

  // ── 2) 上限判定（既存ルールを再利用。月は必ず targetDate の月） ──
  // service role クライアントを注入する。既定のブラウザクライアントのままだと
  // サーバーでは RLS により 0 件になり limit=0/used=0 に化ける（schedule.ts のコメント参照）。
  const usage = await getMonthlyTransferUsage(studentId, targetDate, svc);

  // 教室の追加許可（対象授業日の月）。
  let permissionExtra = 0;
  const monthStart = monthStartOf(targetDate);
  if (monthStart) {
    const { data: perm } = await svc
      .from('portal_transfer_permissions')
      .select('extra_count')
      .eq('student_id', studentId)
      .eq('month', monthStart)
      .maybeSingle();
    permissionExtra = (perm as { extra_count: number } | null)?.extra_count ?? 0;
  }

  return computeQuota(usage.limit, usage.used, permissionExtra, usage.monthLabel);
}
