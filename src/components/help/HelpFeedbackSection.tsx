'use client';

import { useEffect, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { Loading } from '@/components/ui';
import { fetchWithAuth } from '@/lib/api/auth';
import type { HelpQuestionsResponse } from '@/lib/help/helpFeedback';
import { UnansweredQuestionsTable } from './UnansweredQuestions';

/**
 * AIの答え合わせ（/admin/ai-feedback）に並べる、AIヘルプの評価。
 *
 * ★AIヘルプだけ別の区画にする。他のAI機能は ai_feedback（教室ごと・直近200件）を数えているが、
 *   AIヘルプは help_questions（全社共通・これまでの合計）を数えている。
 *   同じ行に並べると、母数の違う数字を見比べてしまう。
 *
 * ★上の「機能」「判断」の絞り込みは効かない。AIヘルプの評価は ai_feedback の語彙
 *   （そのまま／直して使った…）ではなく「役に立った／立たなかった」で、選択肢を混ぜると
 *   どの機能でも答えにならない語が並ぶ。
 *
 * ★見たいのは「立たなかった」と「答えられなかった」。どちらもFAQに足りないものを指していて、
 *   FAQを書き足せば次から答えられる（AIを賢くするのではなく、FAQを育てる）。
 */
export function HelpFeedbackSection() {
  const [data, setData] = useState<HelpQuestionsResponse | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetchWithAuth('/api/ai/help/questions');
        const json = res.ok ? ((await res.json()) as Partial<HelpQuestionsResponse>) : {};
        if (!alive) return;
        setData({
          rows: json.rows ?? [],
          summary: json.summary ?? null,
          available: json.available ?? false,
        });
      } catch {
        if (alive) setData({ rows: [], summary: null, available: false });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const s = data?.summary ?? null;
  // ★評価を押されなかった数も出す。「立たなかった 3」が多いのか少ないのかは、
  //   押された総数が分からないと判断できない
  const unrated = s ? Math.max(0, s.total - s.helpful - s.notHelpful) : 0;

  return (
    <section className="mt-10">
      <h2 className="mb-1 flex items-center gap-2 text-base font-bold text-text-heading">
        <HelpCircle className="h-4 w-4" aria-hidden="true" />
        AIヘルプ
      </h2>
      <p className="mb-3 text-xs text-text-muted">
        「AIに聞いてみる」への評価です（これまでの合計・全教室共通。上の絞り込みは効きません）。「立たなかった」「答えられなかった」質問はFAQに足りないところなので、FAQを書き足すと次から答えられます。
      </p>

      {data === null ? (
        <Loading />
      ) : !data.available ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
          AIヘルプの記録を読めませんでした
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2">
            {s === null ? (
              <span className="text-[11px] text-text-faint">件数を数えられませんでした</span>
            ) : (
              <>
                <Count label="聞かれた" value={s.total} />
                <Count label="役に立った" value={s.helpful} />
                <Count label="立たなかった" value={s.notHelpful} strong />
                <Count label="評価なし" value={unrated} />
                <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
                <Count label="答えられなかった" value={s.unanswered} strong />
                <Count label="AIを呼べなかった" value={s.degraded} />
              </>
            )}
          </div>

          {data.rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
              答えられなかった質問・「立たなかった」質問はまだありません
            </p>
          ) : (
            <div className="rounded-lg border border-border-subtle bg-surface px-3 py-2">
              <UnansweredQuestionsTable rows={data.rows} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** 件数1つ。★FAQを書き足す材料になるものだけ強調する（画面上側の「読み間違い」と同じ扱い） */
function Count({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs ${
        strong ? 'bg-ink-subtle text-text-heading' : 'text-text-muted'
      }`}
    >
      {label} <b className="font-bold tabular-nums text-text-heading">{value}</b>
    </span>
  );
}
