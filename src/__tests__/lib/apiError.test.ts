import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Sentry に渡された引数を検証したいので、引数の型を明示したモックにする */
type CaptureOptions = {
  tags: Record<string, string>;
  contexts: { api: Record<string, unknown> };
};
const captureExceptionMock = vi.fn(
  (_error: unknown, _options: CaptureOptions): string => 'evt_test_1234'
);

vi.mock('@sentry/nextjs', () => ({
  captureException: (error: unknown, options: CaptureOptions) =>
    captureExceptionMock(error, options),
}));

import { captureApiError, apiErrorResponse } from '@/lib/api-error';

/**
 * API エラーの Sentry 転送ヘルパーのテスト。
 *
 * 守りたいのは2点。
 * 1. 捕捉した例外が Sentry に届くこと（try/catch を書いたルートが不可視になる問題の解消）
 * 2. 内部エラー文言をクライアントに返さないこと。DB のカラム名・制約名が利用者に見えるのは
 *    情報漏洩であり、この回帰は目視では気づきにくいのでテストで固定する。
 */
describe('captureApiError', () => {
  beforeEach(() => {
    captureExceptionMock.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('例外を Sentry に送り、ルートをタグに付ける', () => {
    const err = new Error('column "foo" does not exist');

    const eventId = captureApiError(err, { route: 'POST /api/tasks', action: 'update_task' });

    expect(eventId).toBe('evt_test_1234');
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [passedError, options] = captureExceptionMock.mock.calls[0] as [
      unknown,
      { tags: Record<string, string>; contexts: { api: Record<string, unknown> } },
    ];
    expect(passedError).toBe(err);
    expect(options.tags.api_route).toBe('POST /api/tasks');
    expect(options.tags.api_action).toBe('update_task');
  });

  it('redirect()/notFound() の制御用エラーは送らない（ノイズになるため）', () => {
    const redirectErr = Object.assign(new Error('redirect'), { digest: 'NEXT_REDIRECT;push;/x' });
    const notFoundErr = Object.assign(new Error('nf'), { digest: 'NEXT_NOT_FOUND' });

    expect(captureApiError(redirectErr, { route: 'GET /api/x' })).toBeUndefined();
    expect(captureApiError(notFoundErr, { route: 'GET /api/x' })).toBeUndefined();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('リクエストボディの JSON パース失敗は送らない（公開エンドポイントのクォータ枯渇対策）', () => {
    // `await request.json()` が壊れた body に対して投げる形
    let parseError: unknown;
    try {
      JSON.parse('{not json');
    } catch (e) {
      parseError = e;
    }

    expect(captureApiError(parseError, { route: 'POST /api/mypage/login' })).toBeUndefined();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('JSONパース以外の SyntaxError は送る（本物のバグを握り潰さない）', () => {
    const realBug = new SyntaxError('Invalid regular expression flags');

    expect(captureApiError(realBug, { route: 'POST /api/x' })).toBe('evt_test_1234');
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it('fetch の AbortError は送らない', () => {
    const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });

    expect(captureApiError(abort, { route: 'GET /api/x' })).toBeUndefined();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('渡した識別子は context に載るが、勝手に他の情報を足さない', () => {
    captureApiError(new Error('boom'), {
      route: 'POST /api/x',
      userId: 'user-uuid',
      schoolId: 'school-uuid',
      role: 'manager',
    });

    const [, options] = captureExceptionMock.mock.calls[0] as [
      unknown,
      { contexts: { api: Record<string, unknown> } },
    ];
    expect(options.contexts.api.user_id).toBe('user-uuid');
    expect(options.contexts.api.school_id).toBe('school-uuid');
    expect(options.contexts.api.role).toBe('manager');
  });
});

describe('apiErrorResponse', () => {
  beforeEach(() => {
    captureExceptionMock.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('内部エラー文言をクライアントに返さない', async () => {
    const dbError = new Error(
      'duplicate key value violates unique constraint "students_school_id_student_code_key"'
    );

    const res = apiErrorResponse(dbError, { route: 'POST /api/students' });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).not.toContain('constraint');
    expect(body.error).not.toContain('students_school_id_student_code_key');
    expect(body.error).toBe('サーバー側で問題が発生しました。時間をおいて再度お試しください。');
  });

  it('問い合わせ用に Sentry の eventId を返す', async () => {
    const res = apiErrorResponse(new Error('boom'), { route: 'POST /api/x' });
    const body = await res.json();

    expect(body.eventId).toBe('evt_test_1234');
  });

  it('操作に即した文言とステータスを指定できる', async () => {
    const res = apiErrorResponse(
      new Error('boom'),
      { route: 'POST /api/courses/prep' },
      '講習プランの保存に失敗しました。時間をおいて再度お試しください。',
      503
    );
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error).toBe('講習プランの保存に失敗しました。時間をおいて再度お試しください。');
  });

  it('Sentry に送らないエラー（redirect等）では eventId を付けない', async () => {
    const redirectErr = Object.assign(new Error('redirect'), { digest: 'NEXT_REDIRECT;push;/x' });

    const res = apiErrorResponse(redirectErr, { route: 'GET /api/x' });
    const body = await res.json();

    expect(body.eventId).toBeUndefined();
    expect(body.error).toBeTruthy();
  });
});
