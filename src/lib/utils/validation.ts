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
