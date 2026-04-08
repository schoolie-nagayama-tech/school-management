/**
 * 生徒名バリデーション
 * 空チェック + メールアドレスや明らかに名前でない入力を検出
 */
export function validateStudentName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return '生徒名を入力してください';
  }
  // メールアドレスパターン
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return 'メールアドレスではなく、生徒のお名前を入力してください';
  }
  // @を含む（部分的なメールアドレス）
  if (trimmed.includes('@')) {
    return 'お名前に「@」は使用できません。生徒のお名前を入力してください';
  }
  // URLパターン
  if (/^https?:\/\//i.test(trimmed) || /\.(com|co\.jp|net|org|jp)\b/i.test(trimmed)) {
    return 'URLではなく、生徒のお名前を入力してください';
  }
  // 数字のみ
  if (/^\d+$/.test(trimmed)) {
    return '生徒のお名前を入力してください';
  }
  return null; // エラーなし
}

/**
 * URLバリデーション関数
 */
export function isValidUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * URLバリデーション（より厳密なチェック）
 */
export function validateUrl(url: string): { isValid: boolean; error?: string } {
  if (!url.trim()) {
    return { isValid: false, error: 'URLを入力してください' };
  }

  // http:// または https:// で始まるかチェック
  const trimmedUrl = url.trim();
  if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
    return { isValid: false, error: 'URLは http:// または https:// で始まる必要があります' };
  }

  // URL形式として有効かチェック
  try {
    new URL(trimmedUrl);
    return { isValid: true };
  } catch {
    return { isValid: false, error: '正しいURL形式を入力してください' };
  }
}
