// アプリ全体の「読み込みクルクル」はこの Spinner に統一する。
// 独自の animate-spin div / lucide Loader2 / Button 内 SVG を直書きせず、必ずこれを使うこと。
interface SpinnerProps {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  // tone: 'ink' は固定色（濃紺）、'current' は親の文字色を継承（色付きボタン内など）
  tone?: 'ink' | 'current';
  className?: string;
}

const SIZE_MAP = {
  xs: 'w-3 h-3 border-2',
  sm: 'w-4 h-4 border-2',
  md: 'w-8 h-8 border-[3px]',
  lg: 'w-12 h-12 border-4',
};

export function Spinner({ size = 'md', tone = 'ink', className = '' }: SpinnerProps) {
  // border-t-transparent は border-top-color なので、後段の border 色クラスより常に優先される
  const toneClass = tone === 'current' ? 'border-current' : 'border-ink';
  return (
    <div
      className={`${SIZE_MAP[size]} ${toneClass} border-t-transparent rounded-full animate-spin ${className}`}
      role="status"
      aria-label="読み込み中"
    />
  );
}

interface LoadingProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  className?: string;
}

export function Loading({ size = 'lg', label = '読み込み中...', className = '' }: LoadingProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-12 ${className}`}>
      <Spinner size={size} />
      {label && <p className="text-sm text-text-muted">{label}</p>}
    </div>
  );
}

export function InlineLoading({
  size = 'sm',
  label = '読み込み中...',
  className = '',
}: LoadingProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Spinner size={size} />
      {label && <span className="text-sm text-text-muted">{label}</span>}
    </div>
  );
}
