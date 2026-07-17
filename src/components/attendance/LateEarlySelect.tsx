'use client';

/** 遅刻早退の入力UI。出勤簿詳細（室長・管理者）で使用する。
 *  講師側の入力欄は廃止し、室長が代わりに入力する運用のため、置き場所はここだけ。 */

/** 全角数字・全角ピリオドを半角へ正規化する。全角のままだと parseInt が NaN になり入力が消えるのを防ぐ。 */
function normalizeFullWidthDigits(value: string): string {
  return value
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.');
}

/** 遅刻早退の選択肢（自由入力で表記ゆれ・全角が混ざるのを避けるため、種別＋分のプルダウンで構成する）。
 *  保存形式は「遅刻15分」のような文字列で、遅刻早退一覧・CSVエクスポートと互換を保つ。 */
const LATE_EARLY_KINDS = ['遅刻', '早退', '欠勤', '中抜け'] as const;

/** 種別を選んだ直後の分数の初期値 */
const LATE_EARLY_DEFAULT_MINUTES = 15;

/** 「遅刻15分」のような文字列を { kind, minutes } に分解。解析できない場合は空で返す（種別未選択扱い）。 */
export function parseLateEarly(value: string): { kind: string; minutes: number | null } {
  const m = value.match(/^(遅刻|早退|中抜け)(\d+)分$/);
  if (m) return { kind: m[1], minutes: parseInt(m[2], 10) };
  if (value === '欠勤') return { kind: '欠勤', minutes: null };
  return { kind: '', minutes: null };
}

/** 種別＋分から保存用文字列を組み立てる。欠勤は分なし、種別未選択は空文字。 */
export function composeLateEarly(kind: string, minutes: number | null): string {
  if (!kind) return '';
  if (kind === '欠勤') return '欠勤';
  if (minutes == null) return '';
  return `${kind}${minutes}分`;
}

/** 遅刻早退セレクタ（種別＋分）。テーブルセルに収まるようネイティブ select をコンパクトに使う。 */
export function LateEarlySelect({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const { kind, minutes } = parseLateEarly(value);
  const selectClass =
    'h-8 text-sm border border-border rounded-md bg-surface-raised px-1 disabled:bg-surface disabled:text-text-faint';
  const needsMinutes = kind !== '' && kind !== '欠勤';
  return (
    <div className="flex items-center gap-1">
      <select
        value={kind}
        disabled={disabled}
        onChange={(e) => {
          const nextKind = e.target.value;
          // 種別変更時：分が必要な種別で未選択なら既定値を入れる
          const nextMinutes =
            nextKind === '欠勤' || nextKind === '' ? null : (minutes ?? LATE_EARLY_DEFAULT_MINUTES);
          onChange(composeLateEarly(nextKind, nextMinutes));
        }}
        className={selectClass}
        aria-label="遅刻早退の種別"
      >
        <option value="">なし</option>
        {LATE_EARLY_KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      {needsMinutes && (
        <div className="flex items-center gap-0.5">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={minutes ?? LATE_EARLY_DEFAULT_MINUTES}
            disabled={disabled}
            // 分は1分単位で任意入力。全角は半角へ正規化し、未入力・0以下は記録なし扱い。
            onChange={(e) => {
              const n = parseInt(normalizeFullWidthDigits(e.target.value), 10);
              onChange(composeLateEarly(kind, Number.isFinite(n) && n > 0 ? n : null));
            }}
            className="w-14 h-8 text-sm text-center border border-border rounded-md bg-surface-raised disabled:bg-surface disabled:text-text-faint"
            aria-label="遅刻早退の分数"
          />
          <span className="text-xs text-text-muted">分</span>
        </div>
      )}
    </div>
  );
}
