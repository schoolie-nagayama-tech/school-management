/**
 * 指導形態（formation）の判定ヘルパー。
 *
 * Phase A で ScheduleEntryFormation を string に緩めたことに伴い、
 * これまでコード各所に散っていた 'individual'/'group' 直書き分岐の一掃先として集約する。
 * 形態は schedule_formations テーブルで動的に増減するため、値を列挙して判定してはいけない。
 * 「個別かどうか」「group レーンかどうか」という“性質”で判定する。
 */
import { INDIVIDUAL_FORMATION, GROUP_FORMATION, type ScheduleFormation } from '@/types/schedule';

/**
 * 個別指導（座席グリッド型のメインレーン）かどうか。
 * is_system の 'individual' 固定キーで判定する。個別だけを対象にしたい箇所で使う。
 */
export function isIndividualFormation(key: string | null | undefined): boolean {
  return key === INDIVIDUAL_FORMATION;
}

/**
 * group レーン（1講師N名のカードレーン型）かどうか。
 *
 * マスタ（formations）が渡されていればその lane_type で厳密判定する。
 * 渡されていない／該当キーが見つからない同期文脈では、安全側フォールバックとして
 * 「individual 以外はすべて group レーン扱い」とする。
 *
 * この規約の意図：新しく作られたユーザー定義形態（lane_type='group' 固定）を、
 * マスタ未ロード時に誤って個別グリッド側へ混入させないため。
 * “未知の形態を個別扱いにしない”ことで、個別レーンの純度を最優先で守る。
 */
export function isGroupLane(formation: string, formations?: ScheduleFormation[]): boolean {
  if (formations && formations.length > 0) {
    const match = formations.find((f) => f.key === formation);
    if (match) return match.lane_type === GROUP_FORMATION;
  }
  // フォールバック：individual だけが個別レーン、それ以外は group レーンとみなす。
  return formation !== INDIVIDUAL_FORMATION;
}
