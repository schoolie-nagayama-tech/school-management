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
 */

import { useEffect, useState } from 'react';
import { Sparkles, Quote, Undo2, Loader2 } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api/auth';
import { PARENT_MESSAGE_FEATURE_KEY } from '@/lib/ai/features';
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

/** 作り直しの指示チップ。押すと同じ箇条書き＋この指示で再実行する。 */
const REDO_INSTRUCTIONS = [
  'もう少し短く',
  'もっとていねいに',
  '書いた言い方をなるべく残して',
  '相手が聞いた順に',
] as const;

interface Props {
  schoolId: string;
  threadId: string;
  /** そのスレッドのメッセージ（振替・欠席テンプレで終わっているかの判定に使う）。古い順 */
  messages: ChatMessage[];
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
  replyText,
  onReplyTextChange,
  onQuoteChange,
}: Props) {
  /** この教室で使えるか。null=まだ分からない */
  const [available, setAvailable] = useState<boolean | null>(null);
  const [points, setPoints] = useState('');
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<ComposeResponse['quote'] | null | undefined>(undefined);
  const [message, setMessage] = useState<string | null>(null);
  /** 押す前の返信欄の中身。1段だけ「戻す」ために覚える */
  const [before, setBefore] = useState<string | null>(null);

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
    setBefore(null);
    onQuoteChange(null);
    // onQuoteChange は親から渡される関数で、スレッド切替のたびに参照が変わっても
    // ここでは「リセットする」という1回の呼び出しだけがしたいので依存に含めない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  // ★振替・欠席の構造化テンプレで終わっているスレッドには、パネルごと出さない
  //   （座席表・定型で返す領域。AIには渡さない・docs/parent-message-ai-plan.md §5.4）
  const lastPortal = [...messages].reverse().find((m) => m.sender_kind === 'portal');
  const endedWithTemplate =
    !!lastPortal &&
    (lastPortal.template_kind === 'absence' || lastPortal.template_kind === 'transfer_request');

  const run = async (instruction?: string) => {
    const text = points.trim();
    if (!text || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetchWithAuth('/api/ai/message/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schoolId, threadId, points: text, instruction }),
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

      setBefore(replyText);
      onReplyTextChange(json.body);
      setQuote(json.quote);
      onQuoteChange(json.quote?.id ?? null);
    } catch {
      setMessage('いまは文章にできませんでした。本文はそのままです');
    } finally {
      setBusy(false);
    }
  };

  const undo = () => {
    if (before === null) return;
    onReplyTextChange(before);
    setBefore(null);
    setQuote(undefined);
    onQuoteChange(null);
  };

  // ★オフ・未確定・振替欠席テンプレのあいだは何も出さない（押せる形にしない＝送信が起きない）
  if (available !== true || endedWithTemplate) return null;

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

      {quote !== undefined && (
        <div className="flex flex-col gap-2">
          {/* 何に返信しているか。教室から始める連絡なら「返信ではありません」 */}
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
            {before !== null && (
              <button
                type="button"
                onClick={undo}
                className="ml-auto inline-flex items-center gap-1 text-[11px] text-text-muted"
              >
                <Undo2 className="h-3 w-3" aria-hidden="true" />
                戻す
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
