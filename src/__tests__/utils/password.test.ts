import { generatePassword } from '@/lib/utils/password';

describe('generatePassword', () => {
  it('デフォルトで8文字のパスワードを生成', () => {
    const pw = generatePassword();
    expect(pw).toHaveLength(8);
  });

  it('指定した長さのパスワードを生成', () => {
    const pw = generatePassword(12);
    expect(pw).toHaveLength(12);
  });

  it('大文字を含む', () => {
    // 確率的テストなので複数回実行
    const passwords = Array.from({ length: 20 }, () => generatePassword());
    expect(passwords.every((pw) => /[A-Z]/.test(pw))).toBe(true);
  });

  it('小文字を含む', () => {
    const passwords = Array.from({ length: 20 }, () => generatePassword());
    expect(passwords.every((pw) => /[a-z]/.test(pw))).toBe(true);
  });

  it('数字を含む', () => {
    const passwords = Array.from({ length: 20 }, () => generatePassword());
    expect(passwords.every((pw) => /[0-9]/.test(pw))).toBe(true);
  });

  it('紛らわしい文字（I,O,l,o,0,1）を含まない', () => {
    const passwords = Array.from({ length: 50 }, () => generatePassword(20));
    const forbidden = /[IOlo01]/;
    expect(passwords.every((pw) => !forbidden.test(pw))).toBe(true);
  });
});
