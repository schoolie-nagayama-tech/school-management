import { CalendarClock } from 'lucide-react';

export const V2_TITLE =
  '2027年2月の保護者向けリリース（座席表の運用開始・保護者アカウント）から稼働';

/**
 * 「2月から」タグ。座席表か保護者アカウントが無いと成り立たない表示の目印。
 *
 * 2027年2月の保護者向けリリースまでは動かない（またはデモ教室だけ）ことを、見て分かるようにする。
 * ★対応が要るものではないので色は持たせず、枠線だけの中立な見た目にする（色は対応が要るものに取っておく）。
 *
 * compact はヘッダー2行目用。1200px 未満で文字まで出すと行が折り返してヘッダーの高さが変わるため、
 * その幅ではアイコンだけにする（説明は title で出る）。
 */
export function V2Tag({ compact = false }: { compact?: boolean }) {
  return (
    <span
      title={V2_TITLE}
      className={`inline-flex shrink-0 items-center gap-[3px] whitespace-nowrap rounded-full border border-border px-1.5 align-middle text-[11px] font-normal leading-[1.6] text-text-muted ${
        compact ? 'max-[1199px]:border-transparent max-[1199px]:px-0' : ''
      }`}
    >
      <CalendarClock className="h-[11px] w-[11px] shrink-0" aria-hidden="true" />
      <span className={compact ? 'max-[1199px]:sr-only' : ''}>2月から</span>
    </span>
  );
}
