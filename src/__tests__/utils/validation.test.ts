import { describe, it, expect } from 'vitest';
import { isValidUrl, validateUrl } from '@/lib/utils/validation';

describe('isValidUrl', () => {
  it('https URL は有効', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
  });

  it('http URL は有効', () => {
    expect(isValidUrl('http://example.com')).toBe(true);
  });

  it('https URL にパスが含まれる場合も有効', () => {
    expect(isValidUrl('https://example.com/path/to/page')).toBe(true);
  });

  it('https URL にクエリパラメータが含まれる場合も有効', () => {
    expect(isValidUrl('https://example.com?q=test&page=1')).toBe(true);
  });

  it('ftp プロトコルは無効', () => {
    expect(isValidUrl('ftp://example.com')).toBe(false);
  });

  it('プロトコルなしは無効', () => {
    expect(isValidUrl('example.com')).toBe(false);
  });

  it('空文字は無効', () => {
    expect(isValidUrl('')).toBe(false);
  });

  it('ランダムな文字列は無効', () => {
    expect(isValidUrl('not a url')).toBe(false);
  });

  it('javascript: プロトコルは無効', () => {
    expect(isValidUrl('javascript:alert(1)')).toBe(false);
  });

  it('file: プロトコルは無効', () => {
    expect(isValidUrl('file:///etc/passwd')).toBe(false);
  });

  it('ポート番号付きURLは有効', () => {
    expect(isValidUrl('https://localhost:3000')).toBe(true);
  });
});

describe('validateUrl', () => {
  it('有効なhttps URLの場合 isValid=true', () => {
    const result = validateUrl('https://example.com');
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('有効なhttp URLの場合 isValid=true', () => {
    const result = validateUrl('http://example.com');
    expect(result.isValid).toBe(true);
  });

  it('空文字の場合はエラー', () => {
    const result = validateUrl('');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('URLを入力してください');
  });

  it('空白のみの場合はエラー', () => {
    const result = validateUrl('   ');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('URLを入力してください');
  });

  it('プロトコルなしの場合はエラー', () => {
    const result = validateUrl('example.com');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('URLは http:// または https:// で始まる必要があります');
  });

  it('ftp:// プロトコルの場合はエラー', () => {
    const result = validateUrl('ftp://example.com');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('URLは http:// または https:// で始まる必要があります');
  });

  it('不正なURL形式の場合はエラー', () => {
    const result = validateUrl('http://');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('正しいURL形式を入力してください');
  });

  it('前後の空白はトリムされる', () => {
    const result = validateUrl('  https://example.com  ');
    expect(result.isValid).toBe(true);
  });

  it('パス付きURLも有効', () => {
    const result = validateUrl('https://example.com/path?q=1#section');
    expect(result.isValid).toBe(true);
  });

  it('日本語ドメインも有効（ブラウザがpunycodeに変換）', () => {
    // URL constructor は国際化ドメインを受け付ける
    const result = validateUrl('https://example.jp/テスト');
    expect(result.isValid).toBe(true);
  });
});
