/**
 * エラーメッセージを人間がわかる日本語に変換するユーティリティ
 *
 * Supabase / PostgreSQL / ブラウザから返される英語のエラーメッセージを
 * ユーザーに表示するための日本語メッセージに変換する。
 */

/** 既知のエラーパターンと対応する日本語メッセージ */
const ERROR_TRANSLATIONS: Array<{ pattern: RegExp; message: string }> = [
  // ── DB処理タイムアウト（ネットワーク系より先に判定） ──
  {
    pattern: /statement timeout|57014/i,
    message: '処理に時間がかかりすぎています。データ量を減らして再度お試しください。',
  },

  // ── ネットワーク系 ──
  {
    pattern: /fetch failed|network error|failed to fetch|networkerror/i,
    message: '通信エラーが発生しました。インターネット接続を確認してください。',
  },
  {
    pattern: /timeout|timed out|aborted/i,
    message: '通信がタイムアウトしました。しばらく待ってから再度お試しください。',
  },
  {
    pattern: /ERR_CONNECTION_REFUSED/i,
    message: 'サーバーに接続できませんでした。しばらく待ってから再度お試しください。',
  },
  {
    pattern: /CORS|cross-origin/i,
    message: '通信エラーが発生しました。管理者にお問い合わせください。',
  },

  // ── 認証・権限系 ──
  {
    pattern: /JWT expired|token.*expired|session.*expired/i,
    message: 'ログインの有効期限が切れました。再ログインしてください。',
  },
  {
    pattern: /invalid.*token|invalid.*jwt/i,
    message: '認証情報が無効です。再ログインしてください。',
  },
  {
    pattern: /not authenticated|unauthenticated|auth.*required/i,
    message: 'ログインが必要です。再ログインしてください。',
  },
  {
    pattern: /permission denied|insufficient.*privilege|forbidden|403/i,
    message: 'この操作を行う権限がありません。',
  },
  {
    pattern: /row.level security|42501|RLS/i,
    message: 'この操作を行う権限がありません。管理者にお問い合わせください。',
  },
  {
    pattern: /invalid login credentials/i,
    message: 'メールアドレスまたはパスワードが正しくありません。',
  },
  {
    pattern: /email not confirmed/i,
    message: 'メールアドレスの確認が完了していません。確認メールをご確認ください。',
  },
  {
    pattern: /user already registered|already.*exists.*email/i,
    message: 'このメールアドレスは既に登録されています。',
  },
  {
    pattern: /password.*too short|password.*at least/i,
    message: 'パスワードは6文字以上で設定してください。',
  },

  // ── DB制約系 ──
  {
    pattern: /duplicate key|unique.*constraint|23505/i,
    message: '同じデータが既に登録されています。',
  },
  {
    pattern: /foreign key.*constraint|23503/i,
    message: '関連するデータが存在するため、この操作を完了できません。',
  },
  { pattern: /not-null constraint|null.*violat|23502/i, message: '必須項目が入力されていません。' },
  {
    pattern: /check constraint|23514/i,
    message: '入力値が許容範囲外です。内容を確認してください。',
  },
  {
    pattern: /value too long|string.*too long|22001/i,
    message: '入力文字数が上限を超えています。',
  },
  { pattern: /invalid input syntax|22P02/i, message: '入力形式が正しくありません。' },

  // ── DB接続系 ──
  {
    pattern: /could not connect|connection.*refused|connection.*reset/i,
    message: 'データベースに接続できませんでした。しばらく待ってから再度お試しください。',
  },
  {
    pattern: /too many connections|53300/i,
    message: 'サーバーが混み合っています。しばらく待ってから再度お試しください。',
  },

  // ── Supabase Storage ──
  {
    pattern: /payload too large|file.*too large|413/i,
    message: 'ファイルサイズが大きすぎます。サイズを小さくして再度お試しください。',
  },
  { pattern: /unsupported.*media|unsupported.*file/i, message: '対応していないファイル形式です。' },

  // ── HTTP ──
  { pattern: /404|not found/i, message: '指定されたデータが見つかりませんでした。' },
  {
    pattern: /500|internal server error/i,
    message: 'サーバーエラーが発生しました。しばらく待ってから再度お試しください。',
  },
  {
    pattern: /502|bad gateway/i,
    message: 'サーバーが一時的に利用できません。しばらく待ってから再度お試しください。',
  },
  {
    pattern: /503|service unavailable/i,
    message: 'サービスが一時的に利用できません。しばらく待ってから再度お試しください。',
  },
  {
    pattern: /429|rate limit|too many requests/i,
    message: 'リクエストが多すぎます。しばらく待ってから再度お試しください。',
  },
];

/**
 * エラーオブジェクトからユーザー向け日本語メッセージを取得する。
 *
 * @param error   catch で受け取った値（Error, string, unknown いずれでも可）
 * @param fallback マッチしなかった場合のフォールバックメッセージ
 * @returns ユーザーに表示できる日本語メッセージ
 *
 * @example
 * catch (error) {
 *   toastError(getUserErrorMessage(error, '保存に失敗しました'));
 * }
 */
export function getUserErrorMessage(
  error: unknown,
  fallback = '予期しないエラーが発生しました。再度お試しください。'
): string {
  // エラーメッセージの文字列を取り出す
  const raw = extractRawMessage(error);
  if (!raw) return fallback;

  // 既に日本語メッセージ（ひらがな・カタカナ・漢字を含む）ならそのまま返す
  if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(raw)) {
    return raw;
  }

  // 既知パターンとマッチング
  for (const { pattern, message } of ERROR_TRANSLATIONS) {
    if (pattern.test(raw)) {
      return message;
    }
  }

  // マッチしない英語メッセージ → フォールバック
  return fallback;
}

/** error から文字列を取り出すヘルパー */
function extractRawMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (
    error !== null &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as Record<string, unknown>).message === 'string'
  ) {
    return (error as Record<string, unknown>).message as string;
  }
  return null;
}
