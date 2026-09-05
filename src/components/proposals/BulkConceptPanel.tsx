'use client';

/**
 * 選んだ提案書のテーマを、まとめて書き足す。
 *
 * 正典: docs/ai-features-integration-plan.md §2-5
 *
 * ★これが本番の使い方。2026年夏期は776件（263名 × 科目）あり、
 *   1件ずつ開いて書く余裕がないから「予習」の一言で止まっている。
 *
 * ★作った結果をすぐ保存しない。行ごとに前後を見て、使うものだけ反映する。
 *   776件を黙って書き換えたら、どこが変わったか誰にも分からなくなる。
 *
 * ★すでに書き込まれているテーマは、AI側が変えずに返してくることがある。
 *   そのときは「変えていません」と出して、既定で選ばない。
 */

import { useState } from 'react';
import { Sparkles, Loader2, X } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api/auth';
import { updateProposal } from '@/lib/api/proposals';
import { MAX_CONCEPTS_PER_CALL, type ConceptResult } from '@/lib/ai/koushuConcept';

/** 一覧が持っている、表示に要るぶんだけ */
export interface BulkConceptTarget {
  id: string;
  label: string;
  theme: string;
}

interface BulkConceptPanelProps {
  schoolId: string;
  targets: BulkConceptTarget[];
  onApplied: () => void;
  className?: string;
}

interface Row extends BulkConceptTarget {
  after: string;
  use: boolean;
}

export function BulkConceptPanel({
  schoolId,
  targets,
  onApplied,
  className = '',
}: BulkConceptPanelProps) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const run = async () => {
    if (busy || targets.length === 0) return;
    setBusy(true);
    setMessage(null);
    setRows(null);
    setDone(0);

    const collected: ConceptResult[] = [];
    try {
      // ★まとめて1回では投げない。776件は分けて回す（1回が長すぎると落ちる）
      for (let i = 0; i < targets.length; i += MAX_CONCEPTS_PER_CALL) {
        const chunk = targets.slice(i, i + MAX_CONCEPTS_PER_CALL);
        const res = await fetchWithAuth('/api/ai/koushu/concept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ schoolId, proposalIds: chunk.map((t) => t.id) }),
        });
        if (!res.ok) throw new Error('failed');
        const json = (await res.json()) as {
          results: ConceptResult[];
          degraded: boolean;
          disabled: boolean;
        };
        if (json.disabled) {
          setMessage('この教室ではまだ使えません（教室設定でオンにしてください）');
          return;
        }
        collected.push(...json.results);
        setDone(Math.min(i + chunk.length, targets.length));
      }
    } catch {
      setMessage('途中で止まりました。できたぶんだけ下に出しています');
    } finally {
      setBusy(false);
    }

    const byId = new Map(collected.map((r) => [r.proposalId, r.theme]));
    const next: Row[] = targets
      .map((t) => {
        const after = byId.get(t.id);
        if (!after) return null;
        const changed = after.trim() !== t.theme.trim();
        // ★変わらなかったものは既定で選ばない（押させる意味がない）
        return { ...t, after, use: changed };
      })
      .filter((r): r is Row => r !== null);

    if (next.length === 0 && !message) {
      setMessage('いまは書けませんでした。テーマはそのままです');
    }
    setRows(next);
  };

  const apply = async () => {
    if (!rows || saving) return;
    const picked = rows.filter((r) => r.use);
    if (picked.length === 0) return;
    setSaving(true);
    let ok = 0;
    try {
      for (const r of picked) {
        try {
          await updateProposal(r.id, { theme: r.after });
          ok += 1;
        } catch {
          // 1件こけても残りは続ける。件数で結果を伝える
        }
      }
      setMessage(
        ok === picked.length
          ? `${ok}件を反映しました`
          : `${ok}件を反映しました（${picked.length - ok}件は失敗）`
      );
      setRows(null);
      onApplied();
    } finally {
      setSaving(false);
    }
  };

  const pickedCount = rows?.filter((r) => r.use).length ?? 0;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ink/25 bg-ink-subtle px-3 py-2">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-ink" aria-hidden="true" />
        <span className="mr-auto text-xs text-text-muted">
          テーマ欄の一言を、それぞれの単元と成績で書き足します
        </span>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || targets.length === 0}
          className="shrink-0 rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-white disabled:opacity-40"
        >
          {busy ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              {done}/{targets.length}
            </span>
          ) : (
            `${targets.length}件のテーマを書き足す`
          )}
        </button>
      </div>

      {message && <span className="pl-1 text-[11px] text-text-muted">{message}</span>}

      {rows && rows.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {rows.map((r) => {
            const changed = r.after.trim() !== r.theme.trim();
            return (
              <div
                key={r.id}
                className="flex items-start gap-2 rounded-lg border border-ink/20 bg-surface px-3 py-2"
              >
                <input
                  type="checkbox"
                  checked={r.use}
                  onChange={() =>
                    setRows((prev) =>
                      (prev ?? []).map((x) => (x.id === r.id ? { ...x, use: !x.use } : x))
                    )
                  }
                  className="mt-1 shrink-0"
                  aria-label={`${r.label} のテーマを使う`}
                />
                <div className="flex min-w-0 flex-col">
                  <span className="text-xs font-medium text-text-heading">{r.label}</span>
                  {changed ? (
                    <>
                      <span className="text-[11px] text-text-faint line-through">{r.theme}</span>
                      <span className="text-xs text-text-heading">{r.after}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-[11px] text-success">
                        すでに書かれているので変えていません
                      </span>
                      <span className="text-xs text-text-body">{r.theme}</span>
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {/* ★反映するまで保存されない。押すまで元のテーマのまま */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ink/25 bg-surface px-3 py-2">
            <span className="mr-auto text-xs font-bold text-text-heading">
              使う {pickedCount}件 ／ 使わない {rows.length - pickedCount}件
            </span>
            <button
              type="button"
              onClick={() => void apply()}
              disabled={pickedCount === 0 || saving}
              className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              {saving ? '反映中...' : `${pickedCount}件を反映する`}
            </button>
            <button
              type="button"
              onClick={() => {
                setRows(null);
                setMessage(null);
              }}
              className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs text-text-muted"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              やめる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
