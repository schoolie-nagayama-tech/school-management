'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api/auth';
import { exampleQuestions } from '@/lib/help/exampleQuestions';
import type { RoleTag } from '@/lib/help/faqData';

/**
 * ヘルプに日本語で質問して、FAQの中から答えてもらう入力欄。
 *
 * ★答えるのはFAQに書いてあることだけ。無ければ「載っていません」と言って、
 *   従来のキーワード検索の結果を出す（判断が要る質問に憶測で答えると運用事故になる）。
 *
 * 2か所で使う:
 *   - variant="page"    … /help の最上部（歯車メニューから入ってくる導線）
 *   - variant="popover" … 各ページの ContextHelp の中（いまのパスを添えて聞く）
 *   - variant="modal"   … ヘッダーの「AIに聞いてみる」で開く中央のダイアログ
 *
 * 正典: docs/ai-help-plan.md
 */

interface UsedItem {
  id: string;
  question: string;
  categoryTitle: string;
}

interface FallbackItem extends UsedItem {
  href?: string;
}

interface AiHelpResponse {
  answer: string;
  steps: string[];
  used: UsedItem[];
  page: { href: string; label: string } | null;
  unanswered: boolean;
  degraded: boolean;
  fallback: FallbackItem[];
  degradedReason?: DegradedReason | null;
  /** APIが返した理由の原文（adminのみ） */
  degradedDetail?: string | null;
  logId?: string | null;
}

type DegradedReason =
  | 'not_configured'
  | 'auth'
  | 'rate_limit'
  | 'no_credit'
  | 'workspace_required'
  | 'bad_request'
  | 'unavailable';

/**
 * ★「AIが使えません」だけだと、設定を直すべきか待つべきかが分からない。
 *   社内だけが読む画面なので、理由をそのまま出す。
 */
const DEGRADED_LABEL: Record<DegradedReason, string> = {
  not_configured: 'AIの設定がまだです',
  auth: 'AIの鍵が正しくありません',
  rate_limit: 'AIが混み合っています',
  no_credit: 'AIの残高が足りません',
  workspace_required: 'AIのワークスペース指定が要ります',
  bad_request: 'AIの呼び出しに失敗しました',
  unavailable: 'AIが使えません',
};

const DEGRADED_HINT: Record<DegradedReason, string> = {
  not_configured:
    '管理者が設定すると使えるようになります。それまではキーワードで探した結果を出します。',
  auth: '管理者に鍵の確認をお願いしてください。それまではキーワードで探した結果を出します。',
  rate_limit: '少し待ってからもう一度お試しください。いまはキーワードで探した結果を出します。',
  no_credit:
    '管理者がクレジットを購入すると使えるようになります。それまではキーワードで探した結果を出します。',
  workspace_required:
    '管理者が設定すると使えるようになります。それまではキーワードで探した結果を出します。',
  bad_request: '不具合の可能性があります。いまはキーワードで探した結果を出します。',
  unavailable: 'いまAIに聞けないので、キーワードで探した結果を出します。',
};

interface Props {
  variant?: 'page' | 'popover' | 'modal';
  /** 質問した人の役割。質問の例を出し分けるのに使う（絞り込み自体はサーバー側で行う） */
  role?: RoleTag;
  /** ContextHelp から渡す、そのページの話題。質問の例の先頭に出す */
  pageTopics?: string[];
  /** キーワード検索へ渡すときのコールバック（/help でのみ使う） */
  onFallbackSearch?: (query: string) => void;
}

export function AiHelpAsk({ variant = 'page', role = 'all', pageTopics, onFallbackSearch }: Props) {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AiHelpResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<boolean | null>(null);

  const examples = useMemo(() => exampleQuestions(role, pageTopics), [role, pageTopics]);
  const isPopover = variant === 'popover';
  // ダイアログの中では外側の枠が二重になるので、囲いを外して中身だけ出す
  const isModal = variant === 'modal';

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || q.length > 200) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setFeedback(null);
    try {
      const res = await fetchWithAuth('/api/ai/help', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // クエリ文字列は個人情報が載りうるのでパスだけ送る（サーバー側でも落としている）
        body: JSON.stringify({ question: q, path: window.location.pathname }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? 'うまく答えられませんでした。もう一度お試しください。');
        return;
      }
      setResult((await res.json()) as AiHelpResponse);
    } catch {
      setError('通信できませんでした。もう一度お試しください。');
    } finally {
      setLoading(false);
    }
  }, []);

  const sendFeedback = useCallback(
    async (helpful: boolean) => {
      setFeedback(helpful);
      const logId = result?.logId;
      if (!logId) return;
      try {
        await fetchWithAuth('/api/ai/help/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ logId, helpful }),
        });
      } catch {
        /* 記録に失敗しても画面は進める（答えは出ているので実害が無い） */
      }
    },
    [result]
  );

  const pickExample = (q: string) => {
    setValue(q);
    void ask(q);
  };

  return (
    <section
      className={
        isModal
          ? ''
          : isPopover
            ? 'rounded-lg border border-border-subtle bg-surface-hover/50 p-3'
            : 'rounded-xl border border-ink/25 bg-ink-subtle p-4'
      }
    >
      {!isPopover && (
        <div className="flex items-center gap-1.5 mb-2">
          <Sparkles className="w-4 h-4 text-ink" aria-hidden="true" />
          <h2 className="text-sm font-bold text-ink">何に困っていますか</h2>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(value);
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={200}
          placeholder={
            isPopover ? 'この画面のことを聞く' : '普通の言葉で聞いてください（例: 振替のやり方）'
          }
          aria-label="ヘルプに質問する"
          className={`flex-1 min-w-0 rounded-lg border border-border bg-surface text-text-heading placeholder:text-text-faint focus:outline-none focus:ring-2 focus:ring-ink/25 focus:border-ink transition-shadow ${
            isModal ? 'px-3.5 py-2.5 text-base' : 'px-3 py-2 text-sm'
          }`}
        />
        <button
          type="submit"
          disabled={loading || value.trim() === ''}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-ink text-white disabled:opacity-45 disabled:cursor-not-allowed hover:opacity-90 transition-opacity whitespace-nowrap inline-flex items-center gap-1.5"
        >
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
          {loading ? '探しています' : '聞く'}
        </button>
      </form>

      {/* ★歯車から入ると手がかりが無いので、押すだけで聞ける例を出す */}
      {!result && !loading && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {examples.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => pickExample(q)}
              className="px-2.5 py-1 text-xs rounded-full border border-border bg-surface text-text-muted hover:bg-surface-hover hover:text-text-body transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {!isPopover && (
        <p className="mt-2.5 text-xs text-text-muted">
          ヘルプに書いてあることだけを答えます。
          <b className="font-bold text-text-body">生徒名や保護者名は書かないでください</b>
          （質問は記録に残ります）。
        </p>
      )}

      {error && (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {result && (
        <AnswerCard
          result={result}
          feedback={feedback}
          onFeedback={sendFeedback}
          onFallbackSearch={onFallbackSearch}
          question={value}
        />
      )}
    </section>
  );
}

function AnswerCard({
  result,
  feedback,
  onFeedback,
  onFallbackSearch,
  question,
}: {
  result: AiHelpResponse;
  feedback: boolean | null;
  onFeedback: (helpful: boolean) => void;
  onFallbackSearch?: (query: string) => void;
  question: string;
}) {
  const answered = !result.unanswered && !result.degraded && result.answer.trim() !== '';

  // 左の色線で状態を出す。答えたときだけ ink（AIの色）、それ以外は控えめにする
  const accent = answered
    ? 'border-l-ink'
    : result.degraded
      ? 'border-l-border-strong'
      : 'border-l-warning';

  return (
    <div
      className={`mt-3 rounded-lg border border-border border-l-[3px] ${accent} bg-surface p-3.5`}
    >
      <span
        className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${
          answered
            ? 'bg-ink-subtle text-ink'
            : result.degraded
              ? 'bg-surface-hover text-text-muted'
              : 'bg-warning-subtle text-text-body'
        }`}
      >
        {answered
          ? 'ヘルプから'
          : result.degraded
            ? DEGRADED_LABEL[result.degradedReason ?? 'unavailable']
            : 'ヘルプに載っていません'}
      </span>

      {answered ? (
        <p className="mt-2.5 text-sm leading-[1.85] text-text-heading whitespace-pre-wrap">
          {result.answer}
        </p>
      ) : (
        <p className="mt-2.5 text-sm leading-[1.85] text-text-body">
          {result.degraded
            ? DEGRADED_HINT[result.degradedReason ?? 'unavailable']
            : 'この質問はヘルプに載っていません。近いかもしれない項目を出します。'}
        </p>
      )}

      {/* ★管理者にだけ、APIが返した理由の原文を出す。原因はここにしか書かれていない */}
      {result.degradedDetail && (
        <p className="mt-2 rounded-md bg-surface-hover px-2.5 py-2 font-mono text-[11px] leading-relaxed text-text-muted break-all">
          {result.degradedDetail}
        </p>
      )}

      {result.steps.length > 0 && (
        <ol className="mt-3 rounded-lg border border-border-subtle bg-surface-hover/40 px-4 py-3 pl-8 list-decimal text-sm leading-[1.9] text-text-body space-y-0.5">
          {result.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}

      {result.page && (
        <Link
          href={result.page.href}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-info bg-info-subtle text-sm font-medium text-info hover:opacity-90 transition-opacity"
        >
          {result.page.label}
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      )}

      {result.used.length > 0 && answered && (
        <div className="mt-3 pt-2.5 border-t border-border-subtle">
          <span className="text-[11px] text-text-faint">元のFAQ</span>
          <ul className="mt-1 space-y-0.5">
            {result.used.map((u) => (
              <li key={u.id} className="text-xs text-text-body">
                <span className="text-text-faint">{u.categoryTitle}</span>
                <span className="mx-1.5 text-text-faint">/</span>
                {u.question}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ★候補が1件も無いときの逃げ道。答えられず候補も空だと画面に何も残らず、
          利用者は同じ質問を言い換えて聞き直すしかなくなる（実ログで同じ質問の
          聞き直しが複数回あった）。検索へ送る導線だけは必ず出す。 */}
      {!answered && result.fallback.length === 0 && (
        <div className="mt-3 rounded-lg border border-dashed border-border-strong bg-surface-hover/40 px-3 py-2.5">
          <p className="text-xs text-text-body">
            近いヘルプ項目が見つかりませんでした。言葉を変えて探すこともできます。
          </p>
          {onFallbackSearch ? (
            <button
              type="button"
              onClick={() => onFallbackSearch(question)}
              className="mt-2 text-xs text-info hover:underline"
            >
              この言葉でヘルプ全体を検索する
            </button>
          ) : (
            <Link
              href={`/help?q=${encodeURIComponent(question)}`}
              className="mt-2 inline-block text-xs text-info hover:underline"
            >
              この言葉でヘルプ全体を検索する
            </Link>
          )}
        </div>
      )}

      {result.fallback.length > 0 && (
        <div className="mt-3 rounded-lg border border-dashed border-border-strong bg-surface-hover/40 px-3 py-2.5">
          <span className="text-[11px] text-text-faint">キーワードで探した結果</span>
          <ul className="mt-1 space-y-0.5">
            {result.fallback.map((f) => (
              <li key={f.id} className="text-xs text-text-body">
                <span className="text-text-faint">{f.categoryTitle}</span>
                <span className="mx-1.5 text-text-faint">/</span>
                {f.question}
              </li>
            ))}
          </ul>
          {/* ★答えられなかったときの逃げ道。/help ではその場で検索欄に流し込み、
              ヘッダー・各ページから聞いたときは /help?q= へ送る。
              以前は onFallbackSearch を渡す /help だけにボタンがあり、質問の大半を
              占めるヘッダー経由（AIが答えられないと候補が出るだけ）が行き止まりだった。 */}
          {onFallbackSearch ? (
            <button
              type="button"
              onClick={() => onFallbackSearch(question)}
              className="mt-2 text-xs text-info hover:underline"
            >
              この言葉でヘルプ全体を検索する
            </button>
          ) : (
            <Link
              href={`/help?q=${encodeURIComponent(question)}`}
              className="mt-2 inline-block text-xs text-info hover:underline"
            >
              この言葉でヘルプ全体を検索する
            </Link>
          )}
        </div>
      )}

      {answered && (
        <div className="mt-3 flex items-center gap-2">
          {feedback === null ? (
            <>
              <span className="text-xs text-text-faint">この答えは</span>
              <button
                type="button"
                onClick={() => onFeedback(true)}
                className="px-2.5 py-1 text-xs rounded-full border border-border bg-surface text-text-muted hover:bg-surface-hover transition-colors"
              >
                役に立った
              </button>
              <button
                type="button"
                onClick={() => onFeedback(false)}
                className="px-2.5 py-1 text-xs rounded-full border border-border bg-surface text-text-muted hover:bg-surface-hover transition-colors"
              >
                立たなかった
              </button>
            </>
          ) : (
            <span className="text-xs text-text-faint">
              {feedback ? 'ありがとうございます。' : 'ヘルプの改善に使わせていただきます。'}
            </span>
          )}
        </div>
      )}

      {!answered && !result.degraded && (
        <p className="mt-3 text-xs text-text-faint">
          この質問は記録され、ヘルプを書き足すときの材料になります。
        </p>
      )}
    </div>
  );
}
