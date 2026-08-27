/**
 * 通塾日程v2（編集モーダル・授業追加・変更履歴・開始日指定）を出すか。
 * 座席表の運用開始と同時に講師へ公開する（それまで講師UIを変えると混乱するため）。
 * 公開するときはこの関数を role を見ずに true を返すよう変えるだけ。判定はここ1か所に集約。
 */
export function canUseLessonEntryV2(role: string | null | undefined): boolean {
  return role === 'admin';
}
