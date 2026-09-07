'use client';

/**
 * 文章を「整える」だけのボタン。バー（AiWriteBar）を出すほどではない、
 * 単発のテキスト欄（報告書の講評など）に置く用。
 *
 * 正典: docs/ai-features-integration-plan.md §2-1
 *
 * ★AiWriteBar・ConceptBar と違い「作る」入口を持たない。全文生成はしない
 *   （2026-09-02 決定）という約束を、置き場所そのもので守る。
 *
 * ★行の増減・空文字化は /api/ai/refine 側（parseRefineResult）が機械的に弾く。
 *   ここでは、その保証の上に「戻す」を1段だけ足す（直した結果が気に入らなければ戻せる）。
 */

import { useEffect, useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api/auth';
import { COMPOSE_FEATURE_KEY } from '@/lib/ai/features';
import { toRefineLines, type RefineChange, type RefineKind } from '@/lib/ai/refine';

interface RefineTextButtonProps {
  value: string;
  onChange: (next: string) => void;
  kind: RefineKind;
  schoolId: string;
  className?: string;
}

interface RefineResponse {
  lines: { index: number; text: string }[];
  changes: RefineChange[];
  degraded: boolean;
  disabled: boolean;
}

export function RefineTextButton({
  value,
  onChange,
  kind,
  schoolId,
  className = '',
}: RefineTextButtonProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [changes, setChanges] = useState<RefineChange[] | null>(null);
  /** 「戻す」用に、直す直前の本文を1段だけ覚える */
  const [previous, setPrevious] = useState<string | null>(null);
  /** この教室でAIを使えるか。使えないならボタンごと出さない */
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetchWithAuth(
          `/api/ai/feature-setting?school_id=${schoolId}&feature=${COMPOSE_FEATURE_KEY}`
        );
        if (!alive) return;
        if (!res.ok) return setAvailable(false);
        const json = (await res.json()) as { enabled: boolean };
        setAvailable(json.enabled);
      } catch {
        setAvailable(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [schoolId]);

  const runRefine = async () => {
    if (busy) return;
    const rawLines = value.split('\n');
    const sent = toRefineLines(rawLines);
    if (sent.length === 0) return;

    setBusy(true);
    setMessage(null);
    setChanges(null);
    try {
      const res = await fetchWithAuth('/api/ai/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          schoolId,
          lines: sent.map((l) => ({ index: l.index, text: l.text })),
        }),
      });
      if (!res.ok) throw new Error('failed');
      const json = (await res.json()) as RefineResponse;

      if (json.disabled) return setAvailable(false);
      if (json.degraded) {
        return setMessage('いまは整えられませんでした。本文はそのままです');
      }
      if (json.changes.length === 0) {
        return setMessage('直すところはありませんでした');
      }

      // ★整えた行だけを元の位置（index）に差し戻す。送らなかった行（空行）はそのまま
      const next = [...rawLines];
      for (const line of json.lines) next[line.index] = line.text;

      setPrevious(value);
      onChange(next.join('\n'));
      setChanges(json.changes);
    } catch {
      setMessage('いまは整えられませんでした。本文はそのままです');
    } finally {
      setBusy(false);
    }
  };

  const undo = () => {
    if (previous === null) return;
    onChange(previous);
    setPrevious(null);
    setChanges(null);
    setMessage(null);
  };

  // ★この教室でAIに送らない設定なら、押せる形にしない（送信が起きない）
  if (available !== true) return null;

  const hasText = value.trim().length > 0;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void runRefine()}
          disabled={!hasText || busy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ink/25 bg-ink-subtle px-3 py-1.5 text-xs font-medium text-ink transition-opacity disabled:opacity-40"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          推敲
        </button>

        {previous !== null && (
          <button
            type="button"
            onClick={undo}
            className="shrink-0 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-text-muted"
          >
            戻す
          </button>
        )}
      </div>

      {message && <span className="text-[11px] text-text-muted">{message}</span>}

      {/* ★直した箇所を全部出す。整えた文をそのまま信じさせない（AiWriteBarと同じ考え方） */}
      {changes && changes.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-ink/25 bg-ink-subtle px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-bold text-text-heading">
              直したところ {changes.length}件
            </span>
            <span className="text-[11px] text-text-muted">足した事実はありません</span>
          </div>
          {changes.map((c) => (
            <div key={c.index} className="flex flex-col text-xs">
              <span className="text-text-faint line-through">{c.before}</span>
              <span className="text-text-heading">{c.after}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
