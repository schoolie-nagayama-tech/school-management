'use client';

/**
 * 成績表の画面の「講習テーマ」欄（教科ごと）。
 * モック: https://claude.ai/artifact/XyCBdngNCCDY6noRMy2Xxs ／ 正典: docs/score-sheet-plan-draft.md §7.1
 *
 * ★テーマは教科ごと。同じ教科の冊（中3のゴール＋過去問など）は同じテーマで保存する。
 * ★「成績表から書く」は、その教科の単元・コマ・目的タグ・根拠から AI が1から書く。
 *   欄に何か書いてあっても指示としては使わない（材料が足りているので一言は要らない）。
 *   書いたあとは手で直せ、「戻す」で書く前に戻せる。
 * ★この教室で「テーマふくらませ」がオフなら、ボタンを出さずに欄だけにする（動かないものは出さない）。
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles, Undo2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { fetchWithAuth } from '@/lib/api/auth';
import { canUseAiFeature, PLAN_THEME_FEATURE_KEY } from '@/lib/ai/features';
import type { ThemeInput, ThemeResult } from '@/lib/ai/scoreSheetTheme';
import { SCORE_SUBJECT_LABEL, type ScoreSubject } from '@/lib/scoreSheet/types';

export interface ThemeSubjectRow {
  subject: ScoreSubject;
  /** 教材名を並べたもの（見出しの補足） */
  booksLabel: string;
  koma: number;
  /** AI に渡す材料。★氏名・偏差値は入れない */
  input: ThemeInput;
}

export function ScoreThemePanel({
  schoolId,
  rows,
  themes,
  onChange,
}: {
  schoolId: string | null;
  rows: ThemeSubjectRow[];
  themes: Record<ScoreSubject, string>;
  onChange: (subject: ScoreSubject, theme: string) => void;
}) {
  const { profile } = useAuth();
  const allowedByRole = canUseAiFeature(profile?.role, PLAN_THEME_FEATURE_KEY);
  // null＝まだ確かめていない。★確かめる前に「オフです」の案内を出さない
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<ScoreSubject[] | null>(null);
  const [message, setMessage] = useState<Partial<Record<ScoreSubject, string>>>({});
  // 書く前の文。★1段だけ戻せれば足りる（書き直しは何度でも押せる）
  const prevRef = useRef<Partial<Record<ScoreSubject, string>>>({});

  useEffect(() => {
    if (!allowedByRole || !schoolId) return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetchWithAuth(
          `/api/ai/feature-setting?school_id=${schoolId}&feature=${PLAN_THEME_FEATURE_KEY}`
        );
        const json = res.ok ? ((await res.json()) as { enabled: boolean }) : null;
        if (alive) setAvailable(!!json?.enabled);
      } catch {
        if (alive) setAvailable(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [schoolId, allowedByRole]);

  const write = async (targets: ThemeSubjectRow[]) => {
    if (busy || !schoolId || targets.length === 0) return;
    const keys = targets.map((t) => t.subject);
    setBusy(keys);
    setMessage({});
    const fail = (text: string) =>
      setMessage(Object.fromEntries(keys.map((k) => [k, text])) as Record<ScoreSubject, string>);
    try {
      const res = await fetchWithAuth('/api/ai/score-sheet/theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schoolId, inputs: targets.map((t) => t.input) }),
      });
      if (!res.ok) throw new Error('failed');
      const json = (await res.json()) as {
        results: ThemeResult[];
        degraded: boolean;
        disabled: boolean;
      };
      if (json.disabled) {
        setAvailable(false);
        return;
      }
      const next: Partial<Record<ScoreSubject, string>> = {};
      for (const k of keys) {
        const hit = json.results.find((r) => r.key === k);
        if (!hit) {
          // ★書けなかった教科の欄は触らない
          next[k] = 'いまは書けませんでした。テーマはそのままです';
          continue;
        }
        prevRef.current[k] = themes[k];
        onChange(k, hit.theme);
        next[k] = '単元と成績表の根拠だけを使いました。直してから保存してください';
      }
      setMessage(next);
    } catch {
      fail('いまは書けませんでした。テーマはそのままです');
    } finally {
      setBusy(null);
    }
  };

  const undo = (s: ScoreSubject) => {
    const prev = prevRef.current[s];
    if (prev === undefined) return;
    onChange(s, prev);
    delete prevRef.current[s];
    setMessage((m) => ({ ...m, [s]: undefined }));
  };

  const canWrite = allowedByRole && available === true && !!schoolId;

  return (
    <section className="p-4 bg-surface-raised rounded-xl border border-border space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-bold text-text-heading">
          講習テーマ<span className="ml-1.5 text-[10px] font-bold text-red-600">必須</span>
        </h2>
        {canWrite && rows.length >= 2 && (
          <button
            type="button"
            onClick={() => void write(rows)}
            disabled={busy !== null}
            className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
          >
            {busy && busy.length >= 2 ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {rows.length}教科まとめて書く
          </button>
        )}
      </div>

      {rows.length === 0 && <p className="text-xs text-text-muted">下書きができると書けます</p>}

      {rows.map((r) => {
        const value = themes[r.subject];
        const running = busy?.includes(r.subject) ?? false;
        return (
          <div key={r.subject} className="rounded-lg border border-border p-3 space-y-1.5">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <label
                htmlFor={`score-theme-${r.subject}`}
                className="text-xs font-bold text-text-heading"
              >
                {SCORE_SUBJECT_LABEL[r.subject]}
              </label>
              <span className="text-[11px] text-text-muted">
                {r.booksLabel}・{r.koma}コマ
              </span>
            </div>
            <div className="flex gap-2 items-center">
              <input
                id={`score-theme-${r.subject}`}
                value={value}
                onChange={(e) => onChange(r.subject, e.target.value)}
                className={`min-w-0 flex-1 px-3 py-2 text-sm border rounded-lg bg-surface-raised ${value.trim() ? 'border-border' : 'border-red-300'}`}
                placeholder={
                  canWrite
                    ? '「成績表から書く」で下書きできます'
                    : '例: 1年生の総復習 / 都立入試対策'
                }
              />
              {canWrite && (
                <>
                  <button
                    type="button"
                    onClick={() => undo(r.subject)}
                    disabled={prevRef.current[r.subject] === undefined || busy !== null}
                    title="書く前に戻す"
                    aria-label="書く前に戻す"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-text-muted disabled:opacity-30"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void write([r])}
                    disabled={busy !== null}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-ink/25 bg-ink-subtle px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-40"
                  >
                    {running ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    成績表から書く
                  </button>
                </>
              )}
            </div>
            {message[r.subject] && (
              <p className="pl-1 text-[11px] text-text-muted">{message[r.subject]}</p>
            )}
          </div>
        );
      })}
      {available === false && rows.length > 0 && allowedByRole && (
        <p className="text-[11px] text-text-faint">
          教室の設定で「テーマふくらませ」をオンにすると、成績表の根拠からテーマを書けます
        </p>
      )}
    </section>
  );
}
