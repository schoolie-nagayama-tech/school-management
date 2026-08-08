'use client';

import { KOUSHU_PACE_CLASS, koushuPaceLabel, type KoushuKomaSummary } from '@/lib/utils/koushuKoma';

/**
 * 講習プランの残りコマ表示（進行表・テキスト一覧カード・進行表確認フィードで共用）。
 *
 * 出す数字と判定は必ず computeKoushuKoma に揃える。3か所で違う数字が出ると
 * 「どれが本当か」を確かめる手間が増え、一目で分かるという目的が崩れる。
 * 申込コマが0の教材（講習ラベルだけで申込が未転記）は呼び出し側で描画しないこと。
 *
 * ★ ここに出る数字はすべて**進行表（プラン）側**の数字で、実際の授業の残り回数ではない。
 *   「プラン残り」＝申込コマ − 記録済みコマ。欠席・振替・未組みのコマは反映されない。
 *   実際の授業状況（スケジュールの残り回数・欠席）との突合は 2027-02 に向けて別途対応予定。
 *   ラベルを「残り」だけにすると「あと22回通う」と読まれるので、必ずプラン側と明示すること。
 */
export function KoushuKomaBar({ summary }: { summary: KoushuKomaSummary }) {
  const pace = koushuPaceLabel(summary);
  const remaining = Math.max(summary.remaining, 0);
  // 消化率のバー。申込0での除算を避けるため applied>0 前提で呼ばれる想定だが念のためガード。
  const donePct = summary.applied > 0 ? Math.min((summary.done / summary.applied) * 100, 100) : 0;

  return (
    <div
      className="mb-3 flex items-center gap-3 flex-wrap rounded-lg border border-[#e5e7eb] bg-white px-3 py-2"
      title="いずれも進行表（プラン）上の数字です。実際の授業の残り回数・欠席は反映されていません。"
    >
      <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]">
        講習プラン
      </span>
      <div className="flex items-baseline gap-1">
        <span className="text-[11px] text-[#6b7280]">プラン残り</span>
        <span className="text-2xl font-bold leading-none text-[#1f2937] tabular-nums">
          {remaining}
        </span>
        <span className="text-[11px] text-[#6b7280]">コマ</span>
      </div>
      <span className="text-xs text-[#6b7280] tabular-nums">
        申込 {summary.applied} ／ 記録済み {summary.done}
      </span>
      {/* 消化バー: 数字を読まなくても進み具合の当たりが付くように添える */}
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[#e5e7eb]" aria-hidden>
        <div className="h-full rounded-full bg-[#1e3a5f]" style={{ width: `${donePct}%` }} />
      </div>
      <span
        className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${KOUSHU_PACE_CLASS[pace.tone]}`}
        title={`プラン残り${remaining}コマに対し、残りの単元をやり切るのに必要なコマは${summary.needed}コマ`}
      >
        {pace.text}
      </span>
      {summary.needed > 0 && (
        <span className="text-[11px] text-[#6b7280] tabular-nums">
          残り単元に必要 {summary.needed}コマ
        </span>
      )}
    </div>
  );
}

/**
 * 一覧・フィード用のコンパクト版。「残り○コマ」＋判定を1チップにまとめる。
 */
export function KoushuKomaChip({
  summary,
  className = '',
}: {
  summary: KoushuKomaSummary;
  className?: string;
}) {
  const pace = koushuPaceLabel(summary);
  const remaining = Math.max(summary.remaining, 0);

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-bold ${KOUSHU_PACE_CLASS[pace.tone]} ${className}`}
      title={`講習プラン: 申込${summary.applied} / 記録済み${summary.done} / プラン残り${remaining}（残り単元に必要 ${summary.needed}コマ）。実際の授業の残り回数ではありません`}
    >
      プラン残り{remaining}コマ
      <span className="font-normal opacity-80">{pace.text}</span>
    </span>
  );
}
