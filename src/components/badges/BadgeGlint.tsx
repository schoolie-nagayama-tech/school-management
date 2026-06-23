'use client';

/**
 * 「今日新しいバッジを獲得した」ことを示す小さな閃光。
 * 名前のすぐ横に置く想定。控えめにキラっとし続ける。
 */

interface BadgeGlintProps {
  size?: number;
  className?: string;
  title?: string;
}

export function BadgeGlint({
  size = 13,
  className = '',
  title = '今日 新しいバッジを獲得しました',
}: BadgeGlintProps) {
  return (
    <span
      className={`inline-flex items-center align-middle ${className}`}
      title={title}
      aria-label={title}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 14 14"
        style={{ animation: 'badge-glint-twinkle 2.4s ease-in-out infinite' }}
      >
        {/* メインの4方向バースト */}
        <path
          d="M 7 0.8 L 7.9 5.7 L 13.2 7 L 7.9 8.3 L 7 13.2 L 6.1 8.3 L 0.8 7 L 6.1 5.7 Z"
          fill="#F59E0B"
        />
        {/* 斜め方向のサブバースト */}
        <g transform="rotate(45 7 7)">
          <path
            d="M 7 3.2 L 7.6 6.4 L 10.8 7 L 7.6 7.6 L 7 10.8 L 6.4 7.6 L 3.2 7 L 6.4 6.4 Z"
            fill="#FCD34D"
          />
        </g>
        {/* 中心のハイライト */}
        <circle cx="7" cy="7" r="1.2" fill="#FEF3C7" />
      </svg>
      <style>{`
        @keyframes badge-glint-twinkle {
          0%, 100% {
            transform: scale(.92) rotate(-4deg);
            opacity: 0.85;
            filter: drop-shadow(0 0 0.5px rgba(245,158,11,0.45));
          }
          50% {
            transform: scale(1.18) rotate(14deg);
            opacity: 1;
            filter: drop-shadow(0 0 2.5px rgba(245,158,11,0.7));
          }
        }
      `}</style>
    </span>
  );
}
