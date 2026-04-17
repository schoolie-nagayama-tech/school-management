/**
 * 内部ID運用ドメイン。
 * 既存システムのID（例: tanaka123）をそのままログインIDとして使えるよう、
 * `@` を含まない入力値にはこのドメインを自動で付加してメールアドレス化する。
 *
 * 注意:
 *  - このドメインは実在ドメインではない（.local は RFC 6762 で予約）
 *  - 外部メール送信には使えないため、パスワードリセットメール等で
 *    このドメインのユーザーには届かない点に留意
 */
export const INTERNAL_LOGIN_DOMAIN = 'schoolie.local';

/**
 * ログイン入力値を Supabase Auth が受け付ける email 形式に正規化する。
 * - `@` を含む → そのまま返す（通常のメールアドレス）
 * - `@` を含まない → `{input}@schoolie.local` に変換（ID運用）
 * - 前後の空白は除去
 */
export function normalizeLoginEmail(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes('@')) return trimmed;
  return `${trimmed}@${INTERNAL_LOGIN_DOMAIN}`;
}

/**
 * 逆方向: email が内部ドメインの場合、ID部分のみを返す。
 * 画面表示で `@schoolie.local` を隠したいときに使う。
 */
export function displayLoginId(email: string | null | undefined): string {
  if (!email) return '';
  const suffix = `@${INTERNAL_LOGIN_DOMAIN}`;
  return email.endsWith(suffix) ? email.slice(0, -suffix.length) : email;
}

/**
 * Supabase Auth のパスワード最低文字数（下げられない固定値）。
 */
const SUPABASE_MIN_PASSWORD_LENGTH = 6;

/**
 * パスワードを Supabase が要求する 6 文字以上に正規化する。
 * - 既に 6 文字以上ならそのまま
 * - 4〜5 文字なら末尾に `0` を付けて 6 文字にする
 *
 * 登録時（Admin API 経由の createUser / CSV インポート）とログイン時
 * （signInWithPassword）の両方でこの関数を通せば、講師は元の短い
 * パスワードのまま入力でき、内部的にだけ 6 文字化される。
 *
 * ⚠ このロジックを一度決めたら変更しないこと。変えると既存の短パスワード
 *     ユーザーがログインできなくなる。
 */
export function normalizePassword(input: string): string {
  if (!input) return input;
  if (input.length >= SUPABASE_MIN_PASSWORD_LENGTH) return input;
  return input.padEnd(SUPABASE_MIN_PASSWORD_LENGTH, '0');
}
