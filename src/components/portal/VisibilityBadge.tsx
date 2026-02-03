'use client';

interface VisibilityBadgeProps {
  itemType: 'internal' | 'external';
  isVisible: boolean;
  activePeriodTitle?: string | null; // 公開中の期間名（内部フォームの場合）
  /** 期間が1件以上登録されているか（フォーム作成有無の確認用） */
  hasRegisteredPeriods?: boolean;
  externalUrl?: string | null; // 外部URL（外部リンクの場合）
  onToggle: () => void;
  onEditPeriod?: () => void; // 公開期間を編集するコールバック（内部フォームの場合）
}

export function VisibilityBadge({
  itemType,
  isVisible,
  activePeriodTitle,
  hasRegisteredPeriods = false,
  externalUrl,
  onToggle,
  onEditPeriod,
}: VisibilityBadgeProps) {
  // 内部フォームの場合
  if (itemType === 'internal') {
    if (!activePeriodTitle) {
      // 公開中の期間がない → フォーム作成有無を表示し、公開/非公開ボタン＋詳細設定リンク
      return (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {hasRegisteredPeriods ? (
              <span className="text-sm text-[#6b7280]">作成済み・未公開</span>
            ) : (
              <span className="text-sm text-[#9ca3af]">公開なし（期間未作成）</span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              className={
                isVisible
                  ? 'px-3 py-1 rounded text-sm font-medium bg-[#6b7280] text-white hover:bg-[#4b5563]'
                  : 'px-3 py-1 rounded text-sm font-medium bg-[#10b981] text-white hover:bg-[#059669]'
              }
            >
              {isVisible ? '非公開にする' : '公開する'}
            </button>
          </div>
          {onEditPeriod && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEditPeriod();
              }}
              className="text-xs text-[#3b82f6] hover:underline text-left"
            >
              詳細設定で期間を編集
            </button>
          )}
        </div>
      );
    }
    // 公開中の期間あり → 状態ラベル ＋ 公開/非公開を切り替えるボタン
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={
              isVisible
                ? 'text-sm font-medium text-[#059669]'
                : 'text-sm text-[#6b7280]'
            }
          >
            {isVisible ? `公開中（${activePeriodTitle}）` : '非公開'}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className={
              isVisible
                ? 'px-3 py-1 rounded text-sm font-medium bg-[#6b7280] text-white hover:bg-[#4b5563]'
                : 'px-3 py-1 rounded text-sm font-medium bg-[#10b981] text-white hover:bg-[#059669]'
            }
          >
            {isVisible ? '非公開にする' : '公開する'}
          </button>
        </div>
        {onEditPeriod && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEditPeriod();
            }}
            className="text-xs text-[#3b82f6] hover:underline text-left"
          >
            詳細設定で期間を編集
          </button>
        )}
      </div>
    );
  }

  // 外部リンクの場合
  if (itemType === 'external') {
    if (!externalUrl) {
      return (
        <span className="text-sm text-[#9ca3af]">URL未設定</span>
      );
    }
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={
            isVisible
              ? 'text-sm font-medium text-[#059669]'
              : 'text-sm text-[#6b7280]'
          }
        >
          {isVisible ? '外部リンク・公開中' : '非公開'}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className={
            isVisible
              ? 'px-3 py-1 rounded text-sm font-medium bg-[#6b7280] text-white hover:bg-[#4b5563]'
              : 'px-3 py-1 rounded text-sm font-medium bg-[#10b981] text-white hover:bg-[#059669]'
          }
        >
          {isVisible ? '非公開にする' : '公開する'}
        </button>
      </div>
    );
  }

  // フォールバック
  return <span className="text-sm text-[#9ca3af]">-</span>;
}
