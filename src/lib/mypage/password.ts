import 'server-only';
import bcrypt from 'bcryptjs';

/**
 * 保護者ポータルのパスワードハッシュ/検証。
 *
 * 教室発行のID/PWフォールバック（docs/account-line-design.md §4）で使う。
 * 平文パスワードはDBに保存せず、必ず bcrypt ハッシュにして portal_accounts.password_hash に入れる。
 */

/** パスワードの最小文字数。 */
export const MIN_PASSWORD_LENGTH = 8;

/** bcrypt のコストパラメータ（10 = 一般的な既定値）。 */
const BCRYPT_ROUNDS = 10;

/**
 * パスワードの最小要件を満たすか検証する。
 * @returns 満たさない場合はエラーメッセージ、OKなら null
 */
export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string') {
    return 'パスワードを入力してください';
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `パスワードは${MIN_PASSWORD_LENGTH}文字以上で入力してください`;
  }
  return null;
}

/**
 * 平文パスワードを bcrypt ハッシュにする。
 * 呼び出し前に validatePassword で最小要件を確認しておくこと。
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * 平文パスワードとハッシュを照合する。
 * @returns 一致すれば true
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
