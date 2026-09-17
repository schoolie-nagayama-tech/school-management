'use client';

/**
 * 「生徒のまとめ」の答え合わせチップ（合っていた／ずれていた）。
 *
 * 正典: docs/ai-features-integration-plan.md
 *
 * ★聞くのは1つだけ。「合っていましたか」。理由や自由記述は聞かない。
 *   まとめを読み終わった人が、授業や面談の直前に答えられる量はこれが限界で、
 *   2つ以上聞くとどちらも押されなくなる。
 *
 * ★押したら消す。同じまとめについて何度も聞くと、うるさくて次から読み飛ばされる。
 *   まとめを作り直せばまた出る（作り直したものは別のまとめなので）。
 *
 * ★進行表と面談の2か所で同じ形を使うので、ここに1つだけ置く。
 *   画面ごとに書くと、片方だけ文言や verdict が変わって集計が合わなくなる。
 */

import { FEEDBACK_VERDICTS_BY_FEATURE, FEEDBACK_VERDICT_LABELS } from '@/lib/ai/feedback';
import { STUDENT_DIGEST_FEATURE_KEY } from '@/lib/ai/features';

/** 出すチップ。★機能ごとの一覧から出す（画面で配列を書かない） */
const VERDICTS = FEEDBACK_VERDICTS_BY_FEATURE[STUDENT_DIGEST_FEATURE_KEY];

type DigestVerdict = (typeof VERDICTS)[number];

interface Props {
  /** もう答えたか。true なら「ありがとうございます」だけを出す */
  rated: boolean;
  onRate: (verdict: DigestVerdict) => void;
  className?: string;
}

export function DigestVerdictChips({ rated, onRate, className = '' }: Props) {
  if (rated) {
    return <span className={`text-[11px] text-text-muted ${className}`}>ありがとうございます</span>;
  }

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <span className="text-[11px] text-text-muted">このまとめ、合っていましたか？</span>
      {VERDICTS.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onRate(v)}
          className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-[11px] text-text-body transition-colors hover:border-ink/35"
        >
          {FEEDBACK_VERDICT_LABELS[v]}
        </button>
      ))}
    </div>
  );
}
