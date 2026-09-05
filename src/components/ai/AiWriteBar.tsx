'use client';

/**
 * 「おまかせ下書き」のバー。本文の下に置く。
 *
 * 正典: docs/ai-features-integration-plan.md
 *
 * ★入力欄はいつも「作る」の指示。推敲はボタンだけ。
 *   整えるのに指示は要らないので、入力欄を共有しない。状態でボタンを入れ替えない。
 *
 * ★本文があるときに入力欄へ書けば、その指示どおりに作り直す
 *   （「もっと短く」「PCSは12番」）。白紙から作るのと同じ入口にする。
 *
 * ★戻す／やり直すを必ず付ける。どちらも本文をまるごと入れ替える操作なので、
 *   1手で戻せないと怖くて押せない。
 *
 * ★空欄で返させない。以前は指示に無い事実を [いつまで] と空けていたが、
 *   教室長が打つのは「PCS配布」の一言で、骨組みだけが返っていた。
 *   いまは書き切らせて、AIが自分で決めた箇所を下に並べる（＝投稿前の確認）。
 *
 * 掲示板のほかに、引継ぎ・保護者連絡・面談でも同じ形を使う。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, ArrowUp, Undo2, Redo2, Loader2 } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api/auth';
import { BLANK_RE, type ComposeBlock, type FilledNote } from '@/lib/ai/compose';
import { COMPOSE_FEATURE_KEY } from '@/lib/ai/features';
import type { RefineChange } from '@/lib/ai/refine';
import { applyLinesToHtml, blocksToHtml, countBlanksInHtml, htmlToLines } from '@/lib/ai/htmlLines';

interface AiWriteBarProps {
  /** いまの本文（HTML）。空文字なら白紙 */
  value: string;
  onChange: (html: string) => void;
  /** 教室ごとの入切に使う */
  schoolId: string;
  /** 整えるときの種類 */
  kind: 'bulletin';
  placeholder?: string;
  className?: string;
}

interface ComposeResponse {
  blocks: ComposeBlock[];
  filled: FilledNote[];
  degraded: boolean;
  disabled: boolean;
}
interface RefineResponse {
  lines: { index: number; text: string }[];
  changes: RefineChange[];
  degraded: boolean;
  disabled: boolean;
}

export function AiWriteBar({
  value,
  onChange,
  schoolId,
  kind,
  placeholder,
  className = '',
}: AiWriteBarProps) {
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState<'compose' | 'refine' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [changes, setChanges] = useState<RefineChange[] | null>(null);
  /** AIが自分で決めたところ。★投稿前に見せる（本文には印を入れない） */
  const [filled, setFilled] = useState<FilledNote[] | null>(null);
  /** この教室でAIを使えるか。使えないならバーごと出さない */
  const [available, setAvailable] = useState<boolean | null>(null);

  /** 戻す／やり直す。★このバーが入れ替えた本文だけを覚える */
  const historyRef = useRef<string[]>([value]);
  const posRef = useRef(0);
  const [, forceRender] = useState(0);

  const hasBody = htmlToLines(value).length > 0;
  const blanks = countBlanksInHtml(value, BLANK_RE);

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

  /** 本文を入れ替える。★履歴に積んで戻せるようにする */
  const replaceBody = useCallback(
    (html: string) => {
      const hist = historyRef.current.slice(0, posRef.current + 1);
      hist.push(html);
      historyRef.current = hist;
      posRef.current = hist.length - 1;
      onChange(html);
      forceRender((n) => n + 1);
    },
    [onChange]
  );

  const step = useCallback(
    (delta: number) => {
      const next = posRef.current + delta;
      if (next < 0 || next >= historyRef.current.length) return;
      posRef.current = next;
      // ★履歴を戻したら、直したところ・補ったところの一覧も消す（画面の文と合わなくなる）
      setChanges(null);
      setFilled(null);
      setMessage(null);
      onChange(historyRef.current[next]);
      forceRender((n) => n + 1);
    },
    [onChange]
  );

  const runCompose = async () => {
    const text = instruction.trim();
    if (!text || busy) return;
    setBusy('compose');
    setMessage(null);
    setChanges(null);
    setFilled(null);
    try {
      const res = await fetchWithAuth('/api/ai/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schoolId,
          instruction: text,
          // 本文があれば作り直し。★手で書いた分も材料に含める
          currentLines: htmlToLines(value).map((l) => l.text),
        }),
      });
      if (!res.ok) throw new Error('failed');
      const json = (await res.json()) as ComposeResponse;

      if (json.disabled) return setAvailable(false);
      if (json.degraded || json.blocks.length === 0) {
        // ★作れなかったら本文は触らない
        return setMessage('いまは下書きを作れませんでした。本文はそのままです');
      }

      replaceBody(blocksToHtml(json.blocks));
      setInstruction('');
      setFilled(json.filled);
      setMessage('下書きを作りました。投稿する前に読んでください');
    } catch {
      setMessage('いまは下書きを作れませんでした。本文はそのままです');
    } finally {
      setBusy(null);
    }
  };

  const runRefine = async () => {
    const lines = htmlToLines(value);
    if (lines.length === 0 || busy) return;
    setBusy('refine');
    setMessage(null);
    setChanges(null);
    try {
      const res = await fetchWithAuth('/api/ai/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          schoolId,
          lines: lines.map((l) => ({ index: l.index, text: l.text })),
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

      replaceBody(applyLinesToHtml(value, json.lines));
      setChanges(json.changes);
    } catch {
      setMessage('いまは整えられませんでした。本文はそのままです');
    } finally {
      setBusy(null);
    }
  };

  // ★この教室でAIに送らない設定なら、押せる形にしない（送信が起きない）
  if (available !== true) return null;

  const canUndo = posRef.current > 0;
  const canRedo = posRef.current < historyRef.current.length - 1;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex items-center gap-2 rounded-full border border-ink/25 bg-ink-subtle py-1.5 pl-3 pr-1.5">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-ink" aria-hidden="true" />
        <input
          type="text"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void runCompose();
            }
          }}
          disabled={busy !== null}
          placeholder={
            placeholder ??
            (hasBody ? 'どう直しますか（例: もっと短く）' : '何を知らせますか（箇条書きでOK）')
          }
          className="min-w-0 flex-1 bg-transparent text-[13px] text-text-heading outline-none placeholder:text-text-faint"
        />

        {/* 推敲は入力欄を使わない。いまの本文を整えるだけ */}
        <button
          type="button"
          onClick={() => void runRefine()}
          disabled={!hasBody || busy !== null}
          className="shrink-0 rounded-full border border-ink/25 bg-surface px-3 py-1 text-xs font-medium text-ink transition-opacity disabled:opacity-40"
        >
          {busy === 'refine' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            '推敲'
          )}
        </button>

        <button
          type="button"
          onClick={() => void runCompose()}
          disabled={!instruction.trim() || busy !== null}
          title={hasBody ? 'この指示で作り直す' : '下書きを作る'}
          aria-label={hasBody ? 'この指示で作り直す' : '下書きを作る'}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-white transition-opacity disabled:opacity-35"
        >
          {busy === 'compose' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>

        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={!canUndo}
            title="戻す"
            aria-label="戻す"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface text-text-muted disabled:opacity-30"
          >
            <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={!canRedo}
            title="やり直す"
            aria-label="やり直す"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface text-text-muted disabled:opacity-30"
          >
            <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {message && <span className="pl-1 text-[11px] text-text-muted">{message}</span>}

      {/* ★AIが自分で決めたところ。本文はきれいなまま書き切らせ、確認はここに集める。
          文中に〔推測〕を挟むと汚くて読まれないので、文とゲートを分けている。
          ★これは自己申告なので漏れる。だから「本文も読んでください」と必ず添える。 */}
      {filled && filled.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-warning bg-warning-subtle px-3 py-2.5">
          <span className="text-xs font-bold text-text-heading">
            AIが決めたところ {filled.length}件（合っているか見てください）
          </span>
          <ul className="flex flex-col gap-1">
            {filled.map((f, i) => (
              <li key={`${f.kind}-${i}`} className="flex items-baseline gap-2 text-xs">
                <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-[10px] text-text-muted">
                  {f.kind}
                </span>
                <span className="min-w-0 text-text-heading">{f.what}</span>
              </li>
            ))}
          </ul>
          <span className="text-[11px] text-text-muted">
            ここに出ないぶんもあります。投稿する前に本文をひととおり読んでください
          </span>
        </div>
      )}

      {/* ★空欄は作らせない決まりだが、言うことを聞かずに [ ] を出すことがある。
          そのまま投稿すると講師が読むので、見つけたら知らせる（保険） */}
      {blanks > 0 && (
        <div className="rounded-lg border border-warning bg-warning-subtle px-3 py-2 text-xs text-text-heading">
          <b className="font-bold">［　］が{blanks}か所残っています。</b>
          直接書くか、上の欄に「PCSは12番」のように足してください
        </div>
      )}

      {/* ★直した箇所を全部出す。整えた文をそのまま信じさせない */}
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
              <span className="font-mono text-[10px] text-text-faint">{c.index + 1}行目</span>
              <span className="text-text-faint line-through">{c.before}</span>
              <span className="text-text-heading">{c.after}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
