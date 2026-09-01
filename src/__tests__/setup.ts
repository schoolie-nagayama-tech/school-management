import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

/**
 * Sentry SDK は既定でモックする。
 *
 * ★なぜ必要か:
 *   API ルートの catch から `captureApiError`（src/lib/api-error.ts）を呼ぶようにしたことで、
 *   ルートを `await import()` するテストが軒並み `@sentry/nextjs` の実体を読み込むようになった。
 *   SDK は依存が重く、読み込みだけで vitest の既定タイムアウト(5秒)を超えてテストが落ちる。
 *   ユニットテストで SDK の中身を検証する意図は無いので、ここで一律に差し替える。
 *
 * Sentry へ何が渡されたかを検証したいテストは、ファイル内で `vi.mock('@sentry/nextjs', ...)` を
 * 書けばそちらが優先される（src/__tests__/lib/apiError.test.ts がその例）。
 */
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(() => 'test-event-id'),
  captureMessage: vi.fn(() => 'test-event-id'),
  captureRequestError: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
  init: vi.fn(),
  setUser: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn(),
  withScope: vi.fn((cb: (scope: unknown) => void) =>
    cb({ setTag: vi.fn(), setContext: vi.fn(), setLevel: vi.fn() })
  ),
}));
