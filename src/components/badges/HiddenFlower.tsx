'use client';

import type { CSSProperties } from 'react';

/**
 * 小さな5弁の花。バッジ獲得の数だけアプリのあちこちに散らされる。
 * "隠す" くらい控えめに配置する想定で、デフォルトで小サイズ・低不透明度。
 */

interface HiddenFlowerProps {
  size?: number;
  color?: string;
  centerColor?: string;
  opacity?: number;
  rotate?: number;
  className?: string;
  style?: CSSProperties;
}

export function HiddenFlower({
  size = 12,
  color = '#F48FB1',
  centerColor = '#FFF59D',
  opacity = 0.55,
  rotate = 0,
  className,
  style,
}: HiddenFlowerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      className={className}
      style={{
        ...style,
        transform: `${style?.transform ?? ''} rotate(${rotate}deg)`.trim(),
        opacity,
        pointerEvents: 'none',
      }}
      aria-hidden="true"
    >
      <g transform="translate(6 6)">
        {[0, 72, 144, 216, 288].map((deg) => (
          <ellipse
            key={deg}
            cx="0"
            cy="-3.2"
            rx="1.7"
            ry="2.5"
            fill={color}
            transform={`rotate(${deg})`}
          />
        ))}
        <circle cx="0" cy="0" r="1.4" fill={centerColor} />
      </g>
    </svg>
  );
}

/** ピンク系のシェード — 単調にならないようバリエーション */
export const FLOWER_SHADES = ['#F48FB1', '#F8BBD0', '#F06292', '#FCE4EC'] as const;

export type FlowerPlacement = {
  /** 親要素に対する絶対配置 */
  position: {
    top?: string | number;
    bottom?: string | number;
    left?: string | number;
    right?: string | number;
  };
  size?: number;
  color?: string;
  opacity?: number;
  rotate?: number;
  z?: number;
};

interface BadgeFlowerFieldProps {
  /** 表示する花の数（バッジ獲得数） */
  count: number;
  /** ページごとの花の配置リスト。先頭から count 枚を描画 */
  placements: FlowerPlacement[];
}

/** 親要素に position: relative を必要とする。指定の placements から count 枚だけ表示。 */
export function BadgeFlowerField({ count, placements }: BadgeFlowerFieldProps) {
  if (count <= 0 || placements.length === 0) return null;
  const visible = placements.slice(0, count);
  return (
    <>
      {visible.map((p, i) => (
        <div
          key={i}
          className="absolute pointer-events-none"
          style={{
            top: p.position.top,
            bottom: p.position.bottom,
            left: p.position.left,
            right: p.position.right,
            zIndex: p.z ?? 0,
          }}
        >
          <HiddenFlower
            size={p.size}
            color={p.color ?? FLOWER_SHADES[i % FLOWER_SHADES.length]}
            opacity={p.opacity}
            rotate={p.rotate}
          />
        </div>
      ))}
    </>
  );
}
