'use client';

/**
 * 「テーマふくらませ」のバー（1件ぶん）。
 *
 * 正典: docs/ai-features-integration-plan.md §2-5
 *
 * ★入力欄を作らない。教室長がテーマ欄に書いた一言（「予習」など）が、そのまま指示。
 *   別の欄に打たせると、忙しいから「予習」で済ませている人にもう一度打たせることになる。
 *
 * ★テーマは1行のまま。複数行にしないので、一覧も印刷も申込フォームも触らない。
 *
 * まとめて作るほうが本番の使い方（1期776件）。ここは1件だけ直したいときに使う。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, ArrowUp, Undo2, Redo2, Loader2 } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api/auth';
import { PLAN_THEME_FEATURE_KEY } from '@/lib/ai/features';
import type { ConceptResult } from '@/lib/ai/koushuConcept';

interface ConceptBarProps {
  proposalId: string;
  schoolId: string;
  value: string;
  onChange: (theme: string) => void;
  className?: string;
}

export function ConceptBar({
  proposalId,
  schoolId,
  value,
  onChange,
  className = '',
}: ConceptBarProps) {
  const [busy, setBusy] = useState<'make' | 'refine' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** この教室で成績をAIに送ってよいか。だめならバーごと出さない */
  const [available, setAvailable] = useState<boolean | null>(null);

  const historyRef = useRef<string[]>([value]);
  const posRef = useRef(0);
  const [, forceRender] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetchWithAuth(
          `/api/ai/feature-setting?school_id=${schoolId}&feature=${PLAN_THEME_FEATURE_KEY}`
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

  const replace = useCallback(
    (next: string) => {
      const hist = historyRef.current.slice(0, posRef.current + 1);
      hist.push(next);
      historyRef.current = hist;
      posRef.current = hist.length - 1;
      onChange(next);
      forceRender((n) => n + 1);
    },
    [onChange]
  );

  const step = useCallback(
    (delta: number) => {
      const next = posRef.current + delta;
      if (next < 0 || next >= historyRef.current.length) return;
      posRef.current = next;
      setMessage(null);
      onChange(historyRef.current[next]);
      forceRender((n) => n + 1);
    },
    [onChange]
  );

  const runMake = async () => {
    if (busy) return;
    setBusy('make');
    setMessage(null);
    try {
      const res = await fetchWithAuth('/api/ai/koushu/concept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schoolId, proposalIds: [proposalId] }),
      });
      if (!res.ok) throw new Error('failed');
      const json = (await res.json()) as {
        results: ConceptResult[];
        degraded: boolean;
        disabled: boolean;
      };
      if (json.disabled) return setAvailable(false);
      const hit = json.results.find((r) => r.proposalId === proposalId);
      if (json.degraded || !hit) {
        // ★作れなかったらテーマは触らない
        return setMessage('いまは書けませんでした。テーマはそのままです');
      }
      replace(hit.theme);
      setMessage('この生徒の単元と成績だけを使いました');
    } catch {
      setMessage('いまは書けませんでした。テーマはそのままです');
    } finally {
      setBusy(null);
    }
  };

  const runRefine = async () => {
    const text = value.trim();
    if (!text || busy) return;
    setBusy('refine');
    setMessage(null);
    try {
      const res = await fetchWithAuth('/api/ai/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'proposal_theme',
          schoolId,
          lines: [{ index: 0, text }],
        }),
      });
      if (!res.ok) throw new Error('failed');
      const json = (await res.json()) as {
        lines: { index: number; text: string }[];
        changes: unknown[];
        degraded: boolean;
        disabled: boolean;
      };
      if (json.disabled || json.degraded) {
        return setMessage('いまは整えられませんでした。テーマはそのままです');
      }
      if (json.changes.length === 0) return setMessage('直すところはありませんでした');
      replace(json.lines[0]?.text ?? text);
      setMessage('言い回しだけ直しました。内容は変えていません');
    } catch {
      setMessage('いまは整えられませんでした。テーマはそのままです');
    } finally {
      setBusy(null);
    }
  };

  // ★この教室で成績をAIに送らない設定なら、押せる形にしない
  if (available !== true) return null;

  const word = value.trim();
  const shown = word.length > 14 ? `${word.slice(0, 14)}…` : word;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex items-center gap-2 rounded-full border border-ink/25 bg-ink-subtle py-1.5 pl-3 pr-1.5">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-ink" aria-hidden="true" />
        {/* ★入力欄ではない。テーマ欄の言葉を材料にすることを伝えるだけ */}
        <span className="min-w-0 flex-1 truncate text-xs text-text-muted">
          {word
            ? `「${shown}」を単元と成績で書き足します`
            : '単元と成績から書きます（欄が空なので）'}
        </span>

        <button
          type="button"
          onClick={() => void runRefine()}
          disabled={!word || busy !== null}
          className="shrink-0 rounded-full border border-ink/25 bg-surface px-3 py-1 text-xs font-medium text-ink disabled:opacity-40"
        >
          {busy === 'refine' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '推敲'}
        </button>

        <button
          type="button"
          onClick={() => void runMake()}
          disabled={busy !== null}
          title="書き足す"
          aria-label="書き足す"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-white disabled:opacity-35"
        >
          {busy === 'make' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArrowUp className="h-3.5 w-3.5" />
          )}
        </button>

        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={posRef.current === 0}
            title="戻す"
            aria-label="戻す"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface text-text-muted disabled:opacity-30"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={posRef.current >= historyRef.current.length - 1}
            title="やり直す"
            aria-label="やり直す"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface text-text-muted disabled:opacity-30"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {message && <span className="pl-1 text-[11px] text-text-muted">{message}</span>}
    </div>
  );
}
