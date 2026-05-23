'use client';

/**
 * バッジ獲得数を金色の小さな星でさりげなく表示する。
 * 出勤簿の名前下などに置いて「努力の証」感を演出するための装飾。
 *
 * - 8〜11px の小サイズ
 * - 5枚目ごとに少し大きく濃い金で抑揚をつける
 * - 多くなったら折返し（max-w で制限）
 * - 初回マウント時に1枚ずつふわっと点灯
 */

interface BadgeStarsProps {
  count: number;
  /** 1行あたりの最大幅（CSS値） */
  maxWidth?: string;
  /** 基本サイズ px */
  size?: number;
  className?: string;
}

export function BadgeStars({ count, maxWidth = '160px', size = 9, className = '' }: BadgeStarsProps) {
  if (count <= 0) return null;
  return (
    <div
      className={`inline-flex flex-wrap items-center justify-center gap-[3px] mx-auto ${className}`}
      style={{ maxWidth }}
      aria-label={`獲得バッジ ${count}個`}
    >
      {Array.from({ length: count }).map((_, i) => (
        <BadgeStar key={i} idx={i} size={size} />
      ))}
      <style>{`
        @keyframes badge-star-twinkle {
          0% { opacity: 0; transform: scale(.4) rotate(-20deg); }
          70% { opacity: 1; transform: scale(1.15) rotate(2deg); }
          100% { opacity: 1; transform: scale(1) rotate(0); }
        }
      `}</style>
    </div>
  );
}

interface BadgeStarProps {
  idx: number;
  size: number;
}

function BadgeStar({ idx, size }: BadgeStarProps) {
  const isAccent = idx % 5 === 0;
  const actualSize = isAccent ? size + 1.5 : size;
  const fill = isAccent ? '#F59E0B' : '#FCD34D';
  const opacity = isAccent ? 0.95 : 0.85;
  return (
    <svg
      width={actualSize}
      height={actualSize}
      viewBox="0 0 12 12"
      style={{
        animation: `badge-star-twinkle .55s cubic-bezier(.34,1.56,.64,1) both`,
        animationDelay: `${Math.min(idx * 40, 600)}ms`,
        filter: 'drop-shadow(0 1px 0.5px rgba(217,119,6,0.35))',
      }}
      aria-hidden="true"
    >
      <path
        d="M 6 1 L 7.35 4.4 L 11 4.8 L 8.3 7.3 L 9.05 11 L 6 9.15 L 2.95 11 L 3.7 7.3 L 1 4.8 L 4.65 4.4 Z"
        fill={fill}
        opacity={opacity}
      />
    </svg>
  );
}
