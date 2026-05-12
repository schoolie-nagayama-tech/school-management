interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_MAP = {
  sm: 'w-4 h-4 border-2',
  md: 'w-8 h-8 border-[3px]',
  lg: 'w-12 h-12 border-4',
};

export function Spinner({ size = 'md', className = '' }: SpinnerProps) {
  return (
    <div
      className={`${SIZE_MAP[size]} border-ink border-t-transparent rounded-full animate-spin ${className}`}
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

export function InlineLoading({ size = 'sm', label = '読み込み中...', className = '' }: LoadingProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Spinner size={size} />
      {label && <span className="text-sm text-text-muted">{label}</span>}
    </div>
  );
}
