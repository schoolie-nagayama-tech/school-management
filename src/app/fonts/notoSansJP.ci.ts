/**
 * CI のビルド専用の差し替え（next.config.mjs で NEST_SKIP_GOOGLE_FONTS=1 のときだけ使う）。
 *
 * Google へフォントを取りに行かないために、notoSansJP.ts と同じ形の値だけを返す。
 * variable が空なので CSS 変数 --font-sans-jp は定義されず、フォント指定は後ろの候補
 * （globals.css / tailwind.config.ts のフォールバック）に落ちる。CI の成果物は配らないので見た目は問わない。
 * ★本番では使わない。中身を足すときは notoSansJP.ts の書き出しと形を合わせる。
 */
export const notoSansJP = {
  className: '',
  variable: '',
  style: { fontFamily: 'sans-serif' },
};
