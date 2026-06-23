interface PortalFormActionsProps {
  /** リセットハンドラ（省略時はリセットボタンを表示しない） */
  onReset?: () => void;
  isSubmitting: boolean;
  /** 送信ボタンを押せなくする追加条件（同意未チェック等） */
  submitDisabled?: boolean;
  /** 送信ボタンのラベル（デフォルト: "申し込む"） */
  submitLabel?: string;
}

/**
 * 保護者ポータルのフォーム共通アクション行。
 * onReset を渡した場合はリセットボタンも表示する。
 */
export function PortalFormActions({
  onReset,
  isSubmitting,
  submitDisabled = false,
  submitLabel = '申し込む',
}: PortalFormActionsProps) {
  return (
    <div className="flex gap-3 pt-1">
      {onReset && (
        <button
          type="button"
          onClick={onReset}
          disabled={isSubmitting}
          className="px-5 py-3 text-sm text-[#4b5563] font-medium rounded-lg border border-[#e5e7eb] hover:bg-[#f8f8f8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          リセット
        </button>
      )}
      <button
        type="submit"
        disabled={isSubmitting || submitDisabled}
        className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-[color:var(--primary)] text-white font-semibold rounded-lg hover:bg-[color:var(--primary-dark)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSubmitting && (
          <svg
            className="w-4 h-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-80"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            />
          </svg>
        )}
        <span>{isSubmitting ? '送信中...' : submitLabel}</span>
      </button>
    </div>
  );
}
