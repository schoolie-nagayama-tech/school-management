'use client';

interface VisibilityBadgeProps {
  itemType: 'internal' | 'external';
  isVisible: boolean;
  activePeriodTitle?: string | null; // 公開中の期間名（内部フォームの場合）
  externalUrl?: string | null; // 外部URL（外部リンクの場合）
  onToggle: () => void;
  onEditPeriod?: () => void; // 公開期間を編集するコールバック（内部フォームの場合）
}

export function VisibilityBadge({
  itemType,
  isVisible,
  activePeriodTitle,
  externalUrl,
  onToggle,
  onEditPeriod,
}: VisibilityBadgeProps) {
  // 内部フォームの場合
  if (itemType === 'internal') {
    if (!activePeriodTitle) {
      // 公開中の期間がない → クリックで公開期間を編集
      return (
        <div className="flex items-center gap-2">
          <span className="text-sm text-[#9ca3af]">公開なし</span>
        </div>
      );
    }
    if (isVisible) {
      // 公開中 → クリックで公開期間を編集
      return (
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (onEditPeriod) {
                onEditPeriod();
              } else {
                onToggle();
              }
            }}
            className="bg-[#10b981] text-white px-3 py-1 rounded-full text-sm font-medium hover:bg-[#059669] transition-colors"
            title="公開期間を編集"
          >
            公開中({activePeriodTitle})
          </button>
        </div>
      );
    } else {
      // 非表示 → クリックで公開期間を編集
      return (
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (onEditPeriod) {
                onEditPeriod();
              } else {
                onToggle();
              }
            }}
            className="bg-[#6b7280] text-white px-3 py-1 rounded-full text-sm font-medium hover:bg-[#4b5563] transition-colors"
            title="公開期間を編集"
          >
            非表示
          </button>
        </div>
      );
    }
  }

  // 外部リンクの場合
  if (itemType === 'external') {
    if (!externalUrl) {
      // URL未設定 → グレーアウト、クリック不可
      return (
        <span className="text-sm text-[#9ca3af]">URL未設定</span>
      );
    }
    if (isVisible) {
      return (
        <button
          onClick={onToggle}
          className="bg-[#10b981] text-white px-3 py-1 rounded-full text-sm font-medium hover:bg-[#059669] transition-colors"
        >
          外部リンク
        </button>
      );
    } else {
      return (
        <button
          onClick={onToggle}
          className="bg-[#6b7280] text-white px-3 py-1 rounded-full text-sm font-medium hover:bg-[#4b5563] transition-colors"
        >
          非表示
        </button>
      );
    }
  }

  // フォールバック
  return <span className="text-sm text-[#9ca3af]">-</span>;
}
