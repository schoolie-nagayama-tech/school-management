import { supabase } from '@/lib/supabase';

/**
 * ユーザーごとのテキストお気に入り操作。
 * 講習提案書のテキスト選択画面で、頻繁に使うテキストを上位表示するための印として使う。
 * 保存範囲はユーザー個人（教室共有ではない）— 先生によって担当教科・よく使うテキストが違うため。
 */

/** 現在のユーザーのお気に入りテキスト ID 集合を返す */
export async function getFavoriteTextbookIds(): Promise<Set<number>> {
  const { data, error } = await supabase
    .from('user_textbook_favorites')
    .select('textbook_id');
  if (error) {
    // 取得失敗時は空集合で動作継続（お気に入りはあくまで補助機能のため UI を止めない）
    return new Set();
  }
  return new Set((data ?? []).map((r) => (r as { textbook_id: number }).textbook_id));
}

/** お気に入り追加。RLS により user_id は auth.uid() で自動制限される */
export async function addFavoriteTextbook(textbookId: number): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('ログインが必要です');
  const { error } = await supabase
    .from('user_textbook_favorites')
    .insert({ user_id: user.id, textbook_id: textbookId });
  // 既にお気に入り登録済みの場合の重複エラー（23505）は無視する
  if (error && error.code !== '23505') {
    throw new Error(`お気に入り追加に失敗しました: ${error.message}`);
  }
}

/** お気に入り解除 */
export async function removeFavoriteTextbook(textbookId: number): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('ログインが必要です');
  const { error } = await supabase
    .from('user_textbook_favorites')
    .delete()
    .eq('user_id', user.id)
    .eq('textbook_id', textbookId);
  if (error) {
    throw new Error(`お気に入り解除に失敗しました: ${error.message}`);
  }
}
