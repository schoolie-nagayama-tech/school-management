'use client';

import { useCallback, useRef, useState } from 'react';
import { PortalDuplicateDialog } from './PortalDuplicateDialog';

interface DuplicateCheckParams {
  school_id: string;
  form_type: string;
  form_period: string;
  student_name: string;
  email: string;
}

interface UsePortalDuplicateGuardOptions {
  /** プレビューモードでは確認しない */
  enabled?: boolean;
}

/**
 * 送信前の二重申込チェック。
 *
 * 同じ期間に同じ氏名・メールの申込があれば確認ダイアログを出し、保護者が
 * 「それでも送信する」を選んだときだけ true を返す。ダイアログの応答を待つため
 * Promise を保持しており、handleSubmit から素直に await できる。
 *
 * サーバー側にも同一内容の冪等ガードがある（api/portal/form-responses）。
 * こちらは「気づかせる」係、あちらは「事故を通さない」係で役割が違うので両方必要。
 * 通信エラー時は true（＝送信続行）にして、確認のためだけに申込を落とさない。
 */
export function usePortalDuplicateGuard({ enabled = true }: UsePortalDuplicateGuardOptions = {}) {
  const [pendingSubmittedAt, setPendingSubmittedAt] = useState<string | null | undefined>(
    undefined
  );
  const resolverRef = useRef<((proceed: boolean) => void) | null>(null);

  const confirmIfDuplicate = useCallback(
    async (params: DuplicateCheckParams): Promise<boolean> => {
      // 氏名・メールが揃っていないと同一人物の判定ができないので確認しない
      if (!enabled || !params.student_name.trim() || !params.email.trim()) return true;

      let submittedAt: string | null = null;
      try {
        const res = await fetch('/api/portal/form-responses/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        });
        if (!res.ok) return true;
        const json = (await res.json()) as { exists?: boolean; submitted_at?: string | null };
        if (!json.exists) return true;
        submittedAt = json.submitted_at ?? null;
      } catch {
        return true;
      }

      setPendingSubmittedAt(submittedAt);
      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
      });
    },
    [enabled]
  );

  const settle = (proceed: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setPendingSubmittedAt(undefined);
    resolve?.(proceed);
  };

  const duplicateDialog =
    pendingSubmittedAt === undefined ? null : (
      <PortalDuplicateDialog
        submittedAt={pendingSubmittedAt}
        onCancel={() => settle(false)}
        onConfirm={() => settle(true)}
      />
    );

  return { confirmIfDuplicate, duplicateDialog };
}
