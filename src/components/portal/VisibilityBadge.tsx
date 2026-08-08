'use client';

interface VisibilityBadgeProps {
  itemType: 'internal' | 'external';
  isVisible: boolean;
  activePeriodTitle?: string | null;
  hasRegisteredPeriods?: boolean;
  registeredCount?: number;
  externalUrl?: string | null;
  /** 複数リンク（面談申し込みなど）。link_url ではなくこちらにURLを持つメニューがある */
  externalUrls?: Array<{ url: string; label: string }> | null;
  onToggle: () => void;
}

/** 状態 pill バッジ */
function StatusBadge({ isActive, label }: { isActive: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
        isActive ? 'bg-[#d1fae5] text-[#065f46]' : 'bg-[#f3f4f6] text-[#6b7280]'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-[#059669]' : 'bg-[#9ca3af]'}`} />
      {label}
    </span>
  );
}

/** 操作ボタン */
function ToggleButton({
  isVisible,
  onToggle,
}: {
  isVisible: boolean;
  onToggle: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`px-2.5 py-0.5 rounded text-xs font-medium transition-[transform,background-color] duration-100 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.93] ${
        isVisible
          ? 'bg-[#f3f4f6] text-[#4b5563] hover:bg-[#e5e7eb]'
          : 'bg-[#10b981] text-white hover:bg-[#059669]'
      }`}
    >
      {isVisible ? '非公開にする' : '公開する'}
    </button>
  );
}

export function VisibilityBadge({
  itemType,
  isVisible,
  activePeriodTitle,
  hasRegisteredPeriods = false,
  registeredCount,
  externalUrl,
  externalUrls,
  onToggle,
}: VisibilityBadgeProps) {
  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle();
  };

  // 外部リンクの場合
  //
  // ★ URLの有無は link_url と link_urls の両方で見る: 面談申し込みは対象学年ごとに
  //   複数のリンクを持つため link_urls 側にURLが入り、link_url は null のまま。
  //   link_url だけを見ていたため「URL未設定」と表示され、公開/非公開の切り替えボタンも
  //   出なかった（保護者ポータルには link_urls を見て実際に公開されている状態だった）。
  //
  // ★ URL未設定でも切り替えボタンは出す: 未設定=保護者に出ない状態ではあるが、
  //   公開状態そのものは触れないと「公開中なのに止められない」ことになる。
  if (itemType === 'external') {
    const hasUrl = !!externalUrl || (externalUrls?.length ?? 0) > 0;
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <StatusBadge isActive={isVisible && hasUrl} label={isVisible ? '公開中' : '非公開'} />
          <ToggleButton isVisible={isVisible} onToggle={handleToggle} />
        </div>
        {!hasUrl && (
          <div className="text-xs text-[#6b7280] pl-0.5">URL未設定 · 保護者には表示されません</div>
        )}
      </div>
    );
  }

  // 内部フォーム：期間未作成
  if (!hasRegisteredPeriods && !activePeriodTitle) {
    return <StatusBadge isActive={false} label="未作成" />;
  }

  // 内部フォーム：期間あり
  const subParts: string[] = [];
  if (activePeriodTitle) subParts.push(activePeriodTitle);
  else if (hasRegisteredPeriods) subParts.push('作成済み');
  if (registeredCount !== undefined) subParts.push(`登録済み ${registeredCount}件`);

  const statusLabel = isVisible && activePeriodTitle ? '公開中' : isVisible ? '公開中' : '非公開';

  return (
    <div className="space-y-1">
      {/* 1行目: バッジ + ボタン */}
      <div className="flex items-center gap-2">
        <StatusBadge isActive={isVisible && !!activePeriodTitle} label={statusLabel} />
        <ToggleButton isVisible={isVisible} onToggle={handleToggle} />
      </div>
      {/* 2行目: 期間名 + 登録済み件数 */}
      {subParts.length > 0 && (
        <div className="text-xs text-[#6b7280] pl-0.5">{subParts.join(' · ')}</div>
      )}
    </div>
  );
}
