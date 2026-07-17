/**
 * password.ts ユニットテスト（bcrypt ハッシュ/検証・最小長バリデーション）。
 */
// password.ts は 'server-only' を import するため空モジュールに差し替える。
vi.mock('server-only', () => ({}));

import { describe, it, expect } from 'vitest';
import {
  validatePassword,
  hashPassword,
  verifyPassword,
  MIN_PASSWORD_LENGTH,
} from '@/lib/mypage/password';

describe('validatePassword', () => {
  it('8文字未満はエラーメッセージを返す', () => {
    expect(validatePassword('short')).not.toBeNull();
    expect(validatePassword('a'.repeat(MIN_PASSWORD_LENGTH - 1))).not.toBeNull();
  });

  it('文字列でない場合はエラー', () => {
    expect(validatePassword(undefined)).not.toBeNull();
    expect(validatePassword(12345678)).not.toBeNull();
  });

  it('8文字以上は null（OK）', () => {
    expect(validatePassword('a'.repeat(MIN_PASSWORD_LENGTH))).toBeNull();
    expect(validatePassword('longenoughpassword')).toBeNull();
  });
});

describe('hashPassword / verifyPassword', () => {
  it('ハッシュは平文と異なり、正しいパスワードで検証できる', async () => {
    const plain = 'correct-horse-battery';
    const hash = await hashPassword(plain);
    expect(hash).not.toBe(plain);
    expect(await verifyPassword(plain, hash)).toBe(true);
  });

  it('間違ったパスワードは検証に失敗する', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });
});
