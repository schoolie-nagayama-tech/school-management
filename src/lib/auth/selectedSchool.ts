/**
 * 「現在選択中の教室ID」の初期値を決める純関数。
 *
 * クライアント(AuthContext)とサーバー(resolveServerAuth)の両方から呼び、
 * 初期選択ロジックを一箇所に集約して二重メンテ・挙動ズレを防ぐ。
 *
 * 「保存済みの選択(savedSchoolId)」の出所だけが両者で異なる:
 *   - クライアント: localStorage の 'selectedSchoolId'
 *   - サーバー    : cookie の 'selectedSchoolId'（AuthContext がミラーしている）
 * どちらも「ユーザーが最後に選んだUI設定」を表し、扱いは同じ。
 *
 * 優先順位（複数教室のとき）:
 *   1. 保存済みの選択（'all' 含む。アクセス権のある教室、または 'all' のみ有効）
 *      — default より優先しないと、default_school_id を持つユーザーが「すべての教室」を
 *        選んでも毎回 default に戻され絞り込みが効かなくなる。
 *   2. default_school_id（保存値が無い初回のみ。デモ教室は除外）
 *   3. デモ以外の先頭教室（実教室が1つも無いときだけデモを許容）
 *
 * 単一教室ならその教室、教室ゼロなら null（未選択）。
 */
export function resolveSelectedSchoolId(
  schoolIds: string[],
  demoSchoolIds: string[],
  savedSchoolId: string | null,
  defaultSchoolId: string | null
): string | 'all' | null {
  if (schoolIds.length === 0) return null;
  if (schoolIds.length === 1) return schoolIds[0];

  const demoSet = new Set(demoSchoolIds);

  // 1. 保存済みの選択（'all' か、アクセス権のある教室）
  const hasValidSaved =
    !!savedSchoolId && (savedSchoolId === 'all' || schoolIds.includes(savedSchoolId));
  if (hasValidSaved) return savedSchoolId as string | 'all';

  // 2. default_school_id（デモは無効扱い）
  const hasValidDefault =
    !!defaultSchoolId && schoolIds.includes(defaultSchoolId) && !demoSet.has(defaultSchoolId);
  if (hasValidDefault) return defaultSchoolId;

  // 3. デモ以外の先頭（無ければ先頭）
  return schoolIds.find((id) => !demoSet.has(id)) ?? schoolIds[0];
}
