import { describe, it, expect } from 'vitest';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

describe('getUserErrorMessage', () => {
  // ── ネットワーク系 ──
  describe('ネットワークエラー', () => {
    it('fetch failed を通信エラーに変換する', () => {
      expect(getUserErrorMessage(new Error('fetch failed'))).toBe(
        '通信エラーが発生しました。インターネット接続を確認してください。'
      );
    });

    it('Failed to fetch を通信エラーに変換する', () => {
      expect(getUserErrorMessage('Failed to fetch')).toBe(
        '通信エラーが発生しました。インターネット接続を確認してください。'
      );
    });

    it('NetworkError を通信エラーに変換する', () => {
      expect(getUserErrorMessage(new Error('NetworkError when attempting to fetch'))).toBe(
        '通信エラーが発生しました。インターネット接続を確認してください。'
      );
    });

    it('timeout をタイムアウトエラーに変換する', () => {
      expect(getUserErrorMessage(new Error('Request timed out'))).toBe(
        '通信がタイムアウトしました。しばらく待ってから再度お試しください。'
      );
    });

    it('aborted をタイムアウトエラーに変換する', () => {
      expect(getUserErrorMessage(new Error('The operation was aborted'))).toBe(
        '通信がタイムアウトしました。しばらく待ってから再度お試しください。'
      );
    });

    it('ERR_CONNECTION_REFUSED を接続エラーに変換する', () => {
      expect(getUserErrorMessage(new Error('ERR_CONNECTION_REFUSED'))).toBe(
        'サーバーに接続できませんでした。しばらく待ってから再度お試しください。'
      );
    });

    it('CORS エラーを通信エラーに変換する', () => {
      expect(getUserErrorMessage(new Error('CORS policy blocked'))).toBe(
        '通信エラーが発生しました。管理者にお問い合わせください。'
      );
    });
  });

  // ── 認証・権限系 ──
  describe('認証・権限エラー', () => {
    it('JWT expired をセッション切れに変換する', () => {
      expect(getUserErrorMessage(new Error('JWT expired'))).toBe(
        'ログインの有効期限が切れました。再ログインしてください。'
      );
    });

    it('invalid token を無効な認証情報に変換する', () => {
      expect(getUserErrorMessage(new Error('invalid token provided'))).toBe(
        '認証情報が無効です。再ログインしてください。'
      );
    });

    it('not authenticated をログイン要求に変換する', () => {
      expect(getUserErrorMessage(new Error('not authenticated'))).toBe(
        'ログインが必要です。再ログインしてください。'
      );
    });

    it('permission denied を権限エラーに変換する', () => {
      expect(getUserErrorMessage(new Error('permission denied for table students'))).toBe(
        'この操作を行う権限がありません。'
      );
    });

    it('row level security をRLSエラーに変換する', () => {
      expect(getUserErrorMessage(new Error('row level security violation'))).toBe(
        'この操作を行う権限がありません。管理者にお問い合わせください。'
      );
    });

    it('invalid login credentials をログイン失敗に変換する', () => {
      expect(getUserErrorMessage(new Error('Invalid login credentials'))).toBe(
        'メールアドレスまたはパスワードが正しくありません。'
      );
    });

    it('email not confirmed をメール未確認に変換する', () => {
      expect(getUserErrorMessage(new Error('Email not confirmed'))).toBe(
        'メールアドレスの確認が完了していません。確認メールをご確認ください。'
      );
    });

    it('user already registered を重複登録に変換する', () => {
      expect(getUserErrorMessage(new Error('User already registered'))).toBe(
        'このメールアドレスは既に登録されています。'
      );
    });

    it('password too short をパスワード短すぎに変換する', () => {
      expect(getUserErrorMessage(new Error('Password should be at least 6 characters'))).toBe(
        'パスワードは6文字以上で設定してください。'
      );
    });
  });

  // ── DB制約系 ──
  describe('DB制約エラー', () => {
    it('duplicate key を重複エラーに変換する', () => {
      expect(getUserErrorMessage(new Error('duplicate key value violates unique constraint'))).toBe(
        '同じデータが既に登録されています。'
      );
    });

    it('23505 を重複エラーに変換する', () => {
      expect(getUserErrorMessage(new Error('error code 23505'))).toBe(
        '同じデータが既に登録されています。'
      );
    });

    it('foreign key constraint を関連データエラーに変換する', () => {
      expect(getUserErrorMessage(new Error('foreign key constraint violation'))).toBe(
        '関連するデータが存在するため、この操作を完了できません。'
      );
    });

    it('not-null constraint を必須項目エラーに変換する', () => {
      expect(getUserErrorMessage(new Error('not-null constraint violated'))).toBe(
        '必須項目が入力されていません。'
      );
    });

    it('check constraint を範囲外エラーに変換する', () => {
      expect(getUserErrorMessage(new Error('check constraint violation'))).toBe(
        '入力値が許容範囲外です。内容を確認してください。'
      );
    });

    it('value too long を文字数超過に変換する', () => {
      expect(getUserErrorMessage(new Error('value too long for type character varying(100)'))).toBe(
        '入力文字数が上限を超えています。'
      );
    });

    it('invalid input syntax を形式エラーに変換する', () => {
      expect(getUserErrorMessage(new Error('invalid input syntax for type uuid'))).toBe(
        '入力形式が正しくありません。'
      );
    });
  });

  // ── DB接続系 ──
  describe('DB接続エラー', () => {
    it('could not connect をDB接続エラーに変換する', () => {
      expect(getUserErrorMessage(new Error('could not connect to server'))).toBe(
        'データベースに接続できませんでした。しばらく待ってから再度お試しください。'
      );
    });

    it('too many connections を混雑エラーに変換する', () => {
      expect(getUserErrorMessage(new Error('too many connections for role'))).toBe(
        'サーバーが混み合っています。しばらく待ってから再度お試しください。'
      );
    });

    it('statement timeout を処理時間超過に変換する', () => {
      expect(getUserErrorMessage(new Error('statement timeout'))).toBe(
        '処理に時間がかかりすぎています。データ量を減らして再度お試しください。'
      );
    });
  });

  // ── Storage系 ──
  describe('Storageエラー', () => {
    it('payload too large をファイルサイズエラーに変換する', () => {
      expect(getUserErrorMessage(new Error('Payload too large'))).toBe(
        'ファイルサイズが大きすぎます。サイズを小さくして再度お試しください。'
      );
    });

    it('unsupported media type をファイル形式エラーに変換する', () => {
      expect(getUserErrorMessage(new Error('unsupported media type'))).toBe(
        '対応していないファイル形式です。'
      );
    });
  });

  // ── HTTP系 ──
  describe('HTTPエラー', () => {
    it('404 を見つからないエラーに変換する', () => {
      expect(getUserErrorMessage(new Error('404 Not Found'))).toBe(
        '指定されたデータが見つかりませんでした。'
      );
    });

    it('500 をサーバーエラーに変換する', () => {
      expect(getUserErrorMessage(new Error('500 Internal Server Error'))).toBe(
        'サーバーエラーが発生しました。しばらく待ってから再度お試しください。'
      );
    });

    it('429 をレート制限エラーに変換する', () => {
      expect(getUserErrorMessage(new Error('429 Too Many Requests'))).toBe(
        'リクエストが多すぎます。しばらく待ってから再度お試しください。'
      );
    });
  });

  // ── 日本語パススルー ──
  describe('日本語メッセージのパススルー', () => {
    it('日本語メッセージはそのまま返す', () => {
      expect(getUserErrorMessage(new Error('保存に失敗しました'))).toBe('保存に失敗しました');
    });

    it('ひらがなを含むメッセージはそのまま返す', () => {
      expect(getUserErrorMessage('データがありません')).toBe('データがありません');
    });

    it('カタカナを含むメッセージはそのまま返す', () => {
      expect(getUserErrorMessage('エラーが発生')).toBe('エラーが発生');
    });
  });

  // ── エラー入力のバリエーション ──
  describe('エラー入力の型バリエーション', () => {
    it('Error オブジェクトを処理する', () => {
      expect(getUserErrorMessage(new Error('fetch failed'))).toBe(
        '通信エラーが発生しました。インターネット接続を確認してください。'
      );
    });

    it('文字列を処理する', () => {
      expect(getUserErrorMessage('fetch failed')).toBe(
        '通信エラーが発生しました。インターネット接続を確認してください。'
      );
    });

    it('message プロパティを持つオブジェクトを処理する', () => {
      expect(getUserErrorMessage({ message: 'fetch failed' })).toBe(
        '通信エラーが発生しました。インターネット接続を確認してください。'
      );
    });

    it('null の場合はフォールバックを返す', () => {
      expect(getUserErrorMessage(null)).toBe(
        '予期しないエラーが発生しました。再度お試しください。'
      );
    });

    it('undefined の場合はフォールバックを返す', () => {
      expect(getUserErrorMessage(undefined)).toBe(
        '予期しないエラーが発生しました。再度お試しください。'
      );
    });

    it('数値の場合はフォールバックを返す', () => {
      expect(getUserErrorMessage(42)).toBe('予期しないエラーが発生しました。再度お試しください。');
    });

    it('空オブジェクトの場合はフォールバックを返す', () => {
      expect(getUserErrorMessage({})).toBe('予期しないエラーが発生しました。再度お試しください。');
    });

    it('カスタムフォールバックを使用する', () => {
      expect(getUserErrorMessage(null, '生徒の保存に失敗しました')).toBe(
        '生徒の保存に失敗しました'
      );
    });

    it('未知の英語メッセージにはフォールバックを返す', () => {
      expect(getUserErrorMessage(new Error('some unknown error xyz'))).toBe(
        '予期しないエラーが発生しました。再度お試しください。'
      );
    });

    it('空文字列の場合はフォールバックを返す', () => {
      expect(getUserErrorMessage('')).toBe('予期しないエラーが発生しました。再度お試しください。');
    });
  });
});
