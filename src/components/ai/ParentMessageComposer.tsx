'use client';

/**
 * 保護者チャットの返信欄まわりに置く2つの部品。
 *
 * 正典: docs/parent-message-ai-plan.md §5・§5.2〜§5.4
 *
 * 1. QuickReplyChips — ワンタップ定型（AIではない。実データの言い回しをそのまま採用）。
 *    ★常に出す。機能の入切に関係ない。
 * 2. ParentMessageComposer — 「保護者との連絡」AI。箇条書き→文章にする。
 *    ★教室ごとに parent_message がオフなら中で何も描かない（AiWriteBar と同じ約束）。
 *    ★スレッドが振替・欠席の構造化テンプレで終わっていれば、パネルごと出さない
 *      （その場面は座席表・定型で返す領域で、AIの対象外のため）。
 *    ★相手が生徒本人のスレッドにも、最初から出さない（押してから「使えません」と
 *      出すと、打った箇条書きが無駄になる）。
 *
 * ★入口は返信欄の下の別欄のまま（2026-09-10 決定）。返信欄のメモをそのまま文章にする案も
 *   比べたが、返信欄に書いたものがそのまま送れてしまう形より、別欄のほうが事故が少ない。
 */

import { useEffect, useMemo, useState } from 'react';
import { Sparkles, Quote, Undo2, Redo2, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api/auth';
import { PARENT_MESSAGE_FEATURE_KEY } from '@/lib/ai/features';
import {
  checkParentMessageFacts,
  splitPoints,
  type FactCheckResult,
} from '@/lib/ai/parentMessageCheck';
import type { ChatMessage } from '@/types/chat';

/** 実データの言い回しをそのまま採用（作文しない・docs/parent-message-ai-plan.md §7.3）。 */
const QUICK_REPLIES = [
  '承知しました。',
  'お気をつけてお越しください。',
  '確認のうえご連絡します。',
] as const;

export function QuickReplyChips({
  onPick,
}: {
  /** 押した定型文を返信欄の末尾に足す側で受け取る */
  onPick: (phrase: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {QUICK_REPLIES.map((phrase) => (
        <button
          key={phrase}
          type="button"
          onClick={() => onPick(phrase)}
          className="rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] text-text-body transition-colors hover:bg-surface-hover"
        >
          {phrase}
        </button>
      ))}
    </div>
  );
}

interface ComposeResponse {
  body: string;
  quote: { id: string; body: string; created_at: string } | null;
  degraded: boolean;
  disabled: boolean;
  skipped?: 'template' | 'student';
}

/**
 * 作り直しの指示チップ。
 * ★押すと「いま返信欄にある文」をこの指示で直す（箇条書きから作り直さない）。
 *   手で直したところを毎回捨てると、教室長は直すのをやめてしまう。
 */
const REDO_INSTRUCTIONS = [
  'もう少し短く',
  'もっとていねいに',
  '書いた言い方をなるべく残して',
  '相手が聞いた順に',
] as const;

/**
 * 返信欄の中身の履歴1段。
 * ★AIが出した文だけでなく、使う前の文・手で直した文も1段として残す。
 *   「戻す」で取り戻したいのは、たいてい自分で直した文のほうだから。
 */
interface HistoryEntry {
  text: string;
  /** 画面に出す短い説明（「文章にする」「もう少し短く」「手で直した文」…） */
  label: string;
  /** AIが出した段か */
  ai: boolean;
  /** AIが出した段の返信先。教室から始める連絡なら null。AIの段でなければ undefined */
  quote?: ComposeResponse['quote'];
}

interface Props {
  schoolId: string;
  threadId: string;
  /** そのスレッドのメッセージ（振替・欠席テンプレで終わっているかの判定・事実チェックに使う）。古い順 */
  messages: ChatMessage[];
  /**
   * 相手が生徒本人か保護者か（portal_account_students.relation）。'self' なら欄を出さない。
   * まだ分からない・判定できないときは null（その場合は出し、最後はサーバー側が止める）。
   */
  counterpartRelation: string | null;
  /** いまの返信欄の中身 */
  replyText: string;
  /** 返信欄を書き換える（結果は上書き） */
  onReplyTextChange: (text: string) => void;
  /**
   * 「返信先」を受信箱側でも印を付けるための通知。教室から始める連絡（quote無し）のときは null。
   */
  onQuoteChange: (messageId: string | null) => void;
}

export function ParentMessageComposer({
  schoolId,
  threadId,
  messages,
  counterpartRelation,
  replyText,
  onReplyTextChange,
  onQuoteChange,
}: Props) {
  /** この教室で使えるか。null=まだ分からない */
  const [available, setAvailable] = useState<boolean | null>(null);
  const [points, setPoints] = useState('');
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<ComposeResponse['quote'] | undefined>(undefined);
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  /** いま返信欄に出している段。-1=まだAIを使っていない */
  const [pos, setPos] = useState(-1);

  useEffect(() => {
    if (!schoolId) {
      setAvailable(false);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const res = await fetchWithAuth(
          `/api/ai/feature-setting?school_id=${schoolId}&feature=${PARENT_MESSAGE_FEATURE_KEY}`
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

  // スレッドを切り替えたら状態を捨てる（前のスレッドの引用・結果が残ると読み違える）
  useEffect(() => {
    setPoints('');
    setQuote(undefined);
    setMessage(null);
    setHistory([]);
    setPos(-1);
    onQuoteChange(null);
    // onQuoteChange は親から渡される関数で、スレッド切替のたびに参照が変わっても
    // ここでは「リセットする」という1回の呼び出しだけがしたいので依存に含めない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const usedAi = history.some((e) => e.ai);

  /**
   * 送る前の事実チェック。★返信欄を手で直すたびに計算し直す（直したら赤が消えるのが見えるように）。
   * AIを一度も使っていないときは出さない（教室長が自分で書いた文を疑う理由は無い）。
   */
  const check = useMemo<FactCheckResult | null>(() => {
    if (!usedAi || !replyText.trim()) return null;
    return checkParentMessageFacts({
      body: replyText,
      points,
      threadTexts: messages.map((m) => m.body),
      today: new Date(),
    });
  }, [usedAi, replyText, points, messages]);

  // ★振替・欠席の構造化テンプレで終わっているスレッドには、パネルごと出さない
  //   （座席表・定型で返す領域。AIには渡さない・docs/parent-message-ai-plan.md §5.4）
  const lastPortal = [...messages].reverse().find((m) => m.sender_kind === 'portal');
  const endedWithTemplate =
    !!lastPortal &&
    (lastPortal.template_kind === 'absence' || lastPortal.template_kind === 'transfer_request');

  const run = async (instruction?: string) => {
    const text = points.trim();
    if (!text || busy) return;

    // ★押す前の返信欄を1段として残す（使う前の文・手で直した文を「戻す」で取り戻せるように）
    let base = history.slice(0, pos + 1);
    const shown = base[base.length - 1];
    if (!shown || shown.text !== replyText) {
      base = [...base, { text: replyText, label: shown ? '手で直した文' : '使う前', ai: false }];
    }

    setBusy(true);
    setMessage(null);
    try {
      const res = await fetchWithAuth('/api/ai/message/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schoolId,
          threadId,
          points: text,
          instruction,
          // ★作り直しは、いま返信欄にある文に効かせる（手で直したところを捨てない）
          currentDraft: instruction ? replyText : undefined,
        }),
      });
      if (!res.ok) throw new Error('failed');
      const json = (await res.json()) as ComposeResponse;

      if (json.disabled) return setAvailable(false);
      if (json.skipped === 'template') {
        return setMessage('振替・欠席のやりとりのため、ここでは使えません');
      }
      if (json.skipped === 'student') {
        return setMessage('生徒本人とのやりとりのため、ここでは使えません');
      }
      if (json.degraded || !json.body) {
        return setMessage('いまは文章にできませんでした。本文はそのままです');
      }

      const next = [
        ...base,
        { text: json.body, label: instruction ?? '文章にする', ai: true, quote: json.quote },
      ];
      setHistory(next);
      setPos(next.length - 1);
      onReplyTextChange(json.body);
      setQuote(json.quote);
      onQuoteChange(json.quote?.id ?? null);
    } catch {
      setMessage('いまは文章にできませんでした。本文はそのままです');
    } finally {
      setBusy(false);
    }
  };

  /** 履歴を行き来する。★何段でも戻せる（1段だけだと、2回押した時点で元の文に戻れない） */
  const go = (delta: number) => {
    const nextPos = pos + delta;
    const entry = history[nextPos];
    if (!entry) return;
    setPos(nextPos);
    onReplyTextChange(entry.text);
    // AIの段に戻ったらその段の返信先を、そうでなければ返信先の印を外す
    setQuote(entry.ai ? entry.quote : undefined);
    onQuoteChange(entry.ai ? (entry.quote?.id ?? null) : null);
  };

  // ★オフ・未確定・振替欠席テンプレ・生徒本人のあいだは何も出さない（押せる形にしない＝送信が起きない）
  if (available !== true || endedWithTemplate || counterpartRelation === 'self') return null;

  const editedByHand = pos >= 0 && history[pos] && history[pos].text !== replyText;
  const sentences = replyText.match(/[^。！？!?]+[。！？!?]?/g)?.length ?? 0;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-ink/25 bg-ink-subtle px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-ink" aria-hidden="true" />
        <span className="text-xs font-bold text-text-heading">保護者との連絡</span>
      </div>

      <textarea
        value={points}
        onChange={(e) => setPoints(e.target.value)}
        disabled={busy}
        placeholder="何を答えるか（箇条書き）"
        rows={3}
        className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-text-body outline-none placeholder:text-text-faint focus:ring-2 focus:ring-primary"
      />

      <div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={!points.trim() || busy}
          className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-40"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          文章にする
        </button>
      </div>

      {message && <span className="text-[11px] text-text-muted">{message}</span>}

      {usedAi && (
        <div className="flex flex-col gap-2">
          {/* 何に返信しているか。教室から始める連絡なら「返信ではありません」 */}
          {quote !== undefined && (
            <div className="flex items-start gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[11px] text-text-muted">
              <Quote className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              {quote ? (
                <span>
                  返信先: <span className="text-text-body">{quote.body}</span>
                </span>
              ) : (
                <span>返信ではありません（教室からの連絡）</span>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            {REDO_INSTRUCTIONS.map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => void run(label)}
                disabled={busy}
                className="rounded-full border border-ink/25 bg-surface px-2.5 py-1 text-[11px] text-ink transition-opacity disabled:opacity-40"
              >
                {label}
              </button>
            ))}
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-text-muted">
              <button
                type="button"
                onClick={() => go(-1)}
                disabled={busy || pos <= 0}
                className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 hover:bg-surface disabled:opacity-40"
              >
                <Undo2 className="h-3 w-3" aria-hidden="true" />
                戻す
              </button>
              <span className="tabular-nums">
                {pos + 1}/{history.length}
              </span>
              <button
                type="button"
                onClick={() => go(1)}
                disabled={busy || pos >= history.length - 1}
                className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 hover:bg-surface disabled:opacity-40"
              >
                やり直す
                <Redo2 className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-muted">
            <span>
              {editedByHand
                ? '手で直した文をもとに作り直します'
                : `いま表示: ${history[pos]?.label ?? ''}`}
            </span>
            <span className="tabular-nums">
              メモ {splitPoints(points).length}行 → {sentences}文・{replyText.length}字
            </span>
          </div>

          {check && <FactCheckPanel result={check} />}
        </div>
      )}
    </div>
  );
}

/**
 * 送る前の事実チェックの表示。
 *
 * ★直さない。どこを見ればいいかを指すだけ。直すのは教室長。
 * ★確かめられたものも小さく出す。何も出さないと「チェックが動いていない」のか
 *   「問題が無い」のか区別できず、そのうち見なくなる。
 */
function FactCheckPanel({ result }: { result: FactCheckResult }) {
  const problems = result.items.filter((i) => i.level !== 'ok');
  const oks = result.items.filter((i) => i.level === 'ok');
  const dropped = result.coverage.filter((c) => !c.included);
  const clean = problems.length === 0 && dropped.length === 0;

  return (
    <div
      aria-live="polite"
      className={`flex flex-col gap-1.5 rounded-md border px-2.5 py-2 text-[11px] ${
        clean ? 'border-success/30 bg-success-subtle' : 'border-warning/40 bg-warning-subtle'
      }`}
    >
      <div className="flex items-center gap-1.5 font-bold text-text-heading">
        {clean ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
        )}
        {clean
          ? '日付・数字はメモとやりとりの中にあります'
          : `送る前に確かめてください（${problems.length + dropped.length}件）`}
      </div>

      {(problems.length > 0 || dropped.length > 0) && (
        <ul className="flex flex-col gap-1">
          {problems.map((p) => (
            <li key={p.label} className="flex items-baseline gap-2">
              <span
                className={`shrink-0 rounded px-1.5 text-[10px] font-bold ${
                  p.level === 'mismatch'
                    ? 'bg-danger-subtle text-danger'
                    : 'border border-warning/40 bg-surface text-text-body'
                }`}
              >
                {p.level === 'mismatch' ? '食い違い' : 'メモに無い'}
              </span>
              <span className="text-text-body">
                <b className="font-bold text-text-heading">{p.label}</b>
                {p.detail ? ` — ${p.detail}` : ''}
              </span>
            </li>
          ))}
          {dropped.map((c) => (
            <li key={c.line} className="flex items-baseline gap-2">
              <span className="shrink-0 rounded bg-danger-subtle px-1.5 text-[10px] font-bold text-danger">
                入っていない
              </span>
              <span className="text-text-body">・{c.line}</span>
            </li>
          ))}
        </ul>
      )}

      {oks.length > 0 && (
        <p className="text-text-muted">確かめられた: {oks.map((o) => o.label).join('・')}</p>
      )}
    </div>
  );
}
