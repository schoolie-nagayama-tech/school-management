'use client';

/**
 * バッジ獲得進捗を「巣のはじまり → 大樹と鳥の家族」の成長物語で表現するSVGシーン。
 * システム名 NEST にちなみ、最終的に鳥の家族が住む巣ができる構成。
 *
 * 参考SVG（148×108）の座標系をそのまま使い、要素を大きく見せる。
 *
 * Stage の刻み:
 *   0   : 0個 — 双葉の芽 + 巣の中の卵
 *   1   : 〜15% — 若芽 + 卵がひび割れひよこの顔
 *   2   : 〜30% — 若い葉茂み + ひよこ
 *   3   : 〜55% — 茎が伸びた茂み + 子鳥
 *   4   : 〜75% — 苗木 + 枝にとまる鳥
 *   5   : 〜95% — 花咲く若木 + 巣作り
 *   6   : 95%〜 — 大樹 + 巣に鳥の家族
 */

import type { CSSProperties } from 'react';

interface GrowthSceneProps {
  earned: number;
  total: number;
  className?: string;
}

function getStage(earned: number, total: number): number {
  if (total === 0 || earned === 0) return 0;
  const ratio = earned / total;
  if (ratio < 0.15) return 1;
  if (ratio < 0.30) return 2;
  if (ratio < 0.55) return 3;
  if (ratio < 0.75) return 4;
  if (ratio < 0.95) return 5;
  return 6;
}

export const STAGE_LABELS = [
  'はじまり',
  '芽吹き',
  'すくすく',
  '若木',
  '育つ木',
  '花咲く',
  'NEST 完成',
];

export function getStageLabel(earned: number, total: number): string {
  return STAGE_LABELS[getStage(earned, total)];
}

// 参考SVGの色設計
const C = {
  stem: '#4E342E',
  trunk: '#5D4037',
  trunkLight: '#795548',
  trunkSoft: '#8D6E63',
  leafDark: '#558B2F',
  leafBase: '#7CB342',
  leafLight: '#9CCC65',
  leafShine: '#C5E1A5',
  eggShell: '#F5F0E0',
  eggShine: '#FBF8F0',
  eggSpec1: '#C8B898',
  eggSpec2: '#C0B088',
  bird: '#FCD34D',
  birdShade: '#F59E0B',
  wing: '#D97706',
  beak: '#FB923C',
  eye: '#1F2937',
  eyeShine: '#ffffff',
  cheek: '#FDA4AF',
  flower: '#F8BBD0',
  flowerCenter: '#EC407A',
  flowerHeart: '#FFF59D',
  ground: '#8D6E63',
};

export function GrowthScene({ earned, total, className = '' }: GrowthSceneProps) {
  const stage = getStage(earned, total);
  const swayOrigin = stage <= 2 ? '54px 98px' : '54px 100px';

  return (
    <svg
      viewBox="0 0 148 108"
      className={`w-full h-auto growth-scene ${className}`}
      preserveAspectRatio="xMidYMax meet"
      aria-label={`成長ステージ: ${STAGE_LABELS[stage]}`}
      role="img"
    >
      <style>{`
        .growth-scene .pop { animation: gs-pop .85s cubic-bezier(.34,1.56,.64,1) both; }
        .growth-scene .sway { animation: gs-sway 6.5s ease-in-out 1s infinite; }
        .growth-scene .bob { animation: gs-bob 3.4s ease-in-out infinite; }
        .growth-scene .rock { animation: gs-rock 7s ease-in-out 2.5s infinite; }
        @keyframes gs-pop { 0% { transform: scaleY(.2) scaleX(.6); opacity: 0; } 100% { transform: scaleY(1) scaleX(1); opacity: 1; } }
        @keyframes gs-sway { 0%,100% { transform: rotate(-.5deg); } 50% { transform: rotate(.5deg); } }
        @keyframes gs-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-1.5px); } }
        @keyframes gs-rock { 0%,80%,100% { transform: rotate(0); } 84% { transform: rotate(2deg); } 88% { transform: rotate(-1.2deg); } 91% { transform: rotate(.6deg); } 94% { transform: rotate(0); } }
        @media (prefers-reduced-motion: reduce) {
          .growth-scene .pop, .growth-scene .sway, .growth-scene .bob, .growth-scene .rock { animation: none; }
        }
      `}</style>

      {/* 地面影 */}
      <ellipse cx="74" cy="100" rx="52" ry="3.5" fill={C.ground} opacity="0.15" />

      {/* 植物 */}
      <g className="sway" style={{ transformOrigin: swayOrigin } as CSSProperties}>
        <g className="pop" style={{ transformOrigin: swayOrigin } as CSSProperties}>
          {renderPlant(stage)}
        </g>
      </g>

      {/* 鳥・卵・巣 */}
      <g
        className={stage === 0 ? 'rock' : stage >= 2 && stage <= 4 ? 'bob' : undefined}
        style={stage === 0 ? ({ transformOrigin: '112px 92px' } as CSSProperties) : undefined}
      >
        {renderBirdScene(stage)}
      </g>
    </svg>
  );
}

/** ステージごとの植物 */
function renderPlant(stage: number): React.ReactElement | null {
  if (stage === 0) {
    // 参考SVGをそのまま — 双葉とつぼみ
    return (
      <g>
        <path d="M 54 98 C 52 88 56 78 53 68" stroke={C.stem} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        {/* 左の双葉（大） */}
        <path d="M 53 70 C 42 58 26 44 14 46 C 16 58 36 74 53 72 Z" fill={C.leafBase} />
        <path d="M 53 70 C 44 60 30 48 20 50 C 22 60 40 72 53 72 Z" fill={C.leafLight} opacity="0.55" />
        <path d="M 52 71 C 40 62 26 54 18 50" stroke={C.leafDark} strokeWidth="0.55" fill="none" strokeLinecap="round" opacity="0.35" />
        {/* 右の双葉（小） */}
        <path d="M 55 72 C 64 62 78 54 86 58 C 82 68 68 78 55 74 Z" fill={C.leafBase} />
        <path d="M 55 72 C 62 64 74 58 80 60 C 78 68 68 76 55 74 Z" fill={C.leafLight} opacity="0.55" />
        <path d="M 55 73 C 64 66 76 60 82 60" stroke={C.leafDark} strokeWidth="0.5" fill="none" strokeLinecap="round" opacity="0.35" />
        {/* つぼみ */}
        <path d="M 52 68 C 50 62 52 56 54 52 C 56 56 56 62 55 68 Z" fill={C.leafLight} />
        <path d="M 53 66 C 52 62 52.5 58 54 55 C 55 58 55 62 54.5 66 Z" fill={C.leafShine} opacity="0.5" />
      </g>
    );
  }
  if (stage === 1) {
    // 若芽 — 茎が伸びて葉が増える
    return (
      <g>
        <path d="M 54 98 C 52 86 56 72 53 56" stroke={C.stem} strokeWidth="1.7" fill="none" strokeLinecap="round" />
        {/* 下の双葉（広がった） */}
        <path d="M 53 70 C 42 60 24 48 12 50 C 14 62 34 76 53 72 Z" fill={C.leafBase} />
        <path d="M 53 70 C 44 62 28 52 18 54 C 20 62 40 74 53 72 Z" fill={C.leafLight} opacity="0.55" />
        <path d="M 55 72 C 66 62 82 54 92 58 C 88 68 72 78 55 74 Z" fill={C.leafBase} />
        <path d="M 55 72 C 64 64 78 58 86 60 C 84 68 72 76 55 74 Z" fill={C.leafLight} opacity="0.55" />
        {/* 中段の葉 */}
        <path d="M 53 60 C 46 54 38 46 32 46 C 34 54 44 62 53 62 Z" fill={C.leafBase} />
        <path d="M 53 60 C 60 54 68 46 74 46 C 72 54 62 62 53 62 Z" fill={C.leafBase} />
        {/* つぼみ（新芽） */}
        <path d="M 52 56 C 50 50 52 44 54 40 C 56 44 56 50 55 56 Z" fill={C.leafLight} />
        <path d="M 53 54 C 52 50 52.5 46 54 43 C 55 46 55 50 54.5 54 Z" fill={C.leafShine} opacity="0.55" />
      </g>
    );
  }
  if (stage === 2) {
    // 茂み — 茎が伸び、複数の葉クラスタ
    return (
      <g>
        <path d="M 54 98 C 52 82 56 64 53 44" stroke={C.stem} strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M 53 76 C 44 70 32 66 24 64" stroke={C.stem} strokeWidth="1.4" fill="none" strokeLinecap="round" />
        <path d="M 53 76 C 62 70 74 66 82 64" stroke={C.stem} strokeWidth="1.4" fill="none" strokeLinecap="round" />
        <path d="M 53 58 C 46 52 38 46 32 44" stroke={C.stem} strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <path d="M 53 58 C 60 52 68 46 74 44" stroke={C.stem} strokeWidth="1.3" fill="none" strokeLinecap="round" />
        {/* 葉群（左下） */}
        <path d="M 24 64 C 14 58 4 50 0 52 C 2 60 14 70 24 66 Z" fill={C.leafBase} />
        <path d="M 24 64 C 16 60 8 54 4 56 C 6 62 16 68 24 66 Z" fill={C.leafLight} opacity="0.55" />
        {/* 葉群（右下） */}
        <path d="M 82 64 C 92 58 102 50 106 52 C 104 60 92 70 82 66 Z" fill={C.leafBase} />
        <path d="M 82 64 C 90 60 98 54 102 56 C 100 62 90 68 82 66 Z" fill={C.leafLight} opacity="0.55" />
        {/* 葉群（左上） */}
        <path d="M 32 44 C 22 40 12 32 10 34 C 12 42 22 50 32 46 Z" fill={C.leafBase} />
        <path d="M 32 44 C 24 40 16 36 14 38 C 16 42 24 48 32 46 Z" fill={C.leafLight} opacity="0.55" />
        {/* 葉群（右上） */}
        <path d="M 74 44 C 84 40 94 32 96 34 C 94 42 84 50 74 46 Z" fill={C.leafBase} />
        <path d="M 74 44 C 82 40 90 36 92 38 C 90 42 82 48 74 46 Z" fill={C.leafLight} opacity="0.55" />
        {/* てっぺん */}
        <path d="M 50 40 C 46 32 48 24 50 18 C 56 24 56 34 54 40 Z" fill={C.leafLight} />
        <path d="M 51 38 C 48 32 50 26 52 22 C 54 26 54 32 53 38 Z" fill={C.leafShine} opacity="0.55" />
      </g>
    );
  }
  if (stage === 3) {
    // 茂み大 — 茎が太く、葉量増加
    return (
      <g>
        <path d="M 54 98 C 52 76 56 54 53 28" stroke={C.trunk} strokeWidth="2.6" fill="none" strokeLinecap="round" />
        <path d="M 53 76 C 42 68 26 62 16 60" stroke={C.trunkLight} strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M 53 76 C 64 68 80 62 90 60" stroke={C.trunkLight} strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M 53 56 C 46 48 38 40 30 36" stroke={C.trunkLight} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M 53 56 C 60 48 68 40 76 36" stroke={C.trunkLight} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M 53 40 C 50 32 52 22 53 14" stroke={C.trunkLight} strokeWidth="1.5" fill="none" strokeLinecap="round" />
        {/* 葉群 — 各枝先 */}
        {leafGroup(16, 60, 1)}
        {leafGroup(90, 60, 1)}
        {leafGroup(30, 36, 0.95)}
        {leafGroup(76, 36, 0.95)}
        {leafGroup(53, 12, 1.05)}
        {leafGroup(53, 48, 0.85)}
      </g>
    );
  }
  if (stage === 4) {
    // 苗木 — 焦茶の幹が明確に
    return (
      <g>
        <path d="M 54 98 C 52 70 56 42 53 18" stroke={C.trunk} strokeWidth="3.5" fill="none" strokeLinecap="round" />
        <path d="M 53 72 C 42 64 28 58 12 56" stroke={C.trunk} strokeWidth="2.3" fill="none" strokeLinecap="round" />
        <path d="M 54 64 C 64 58 80 52 94 50" stroke={C.trunk} strokeWidth="2.3" fill="none" strokeLinecap="round" />
        <path d="M 54 48 C 48 40 42 30 36 24" stroke={C.trunk} strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M 54 40 C 60 32 66 24 72 18" stroke={C.trunk} strokeWidth="2" fill="none" strokeLinecap="round" />
        {/* 葉群 */}
        {leafGroup(12, 56, 1.05)}
        {leafGroup(94, 50, 1.05)}
        {leafGroup(36, 22, 1)}
        {leafGroup(72, 16, 1)}
        {leafGroup(53, 12, 1.1)}
      </g>
    );
  }
  if (stage === 5) {
    // 若木に花
    return (
      <g>
        <path d="M 54 98 C 51 64 58 32 56 8" stroke={C.trunk} strokeWidth="4.4" fill="none" strokeLinecap="round" />
        <path d="M 54 74 C 42 64 26 56 6 52" stroke={C.trunk} strokeWidth="2.8" fill="none" strokeLinecap="round" />
        <path d="M 56 66 C 70 56 84 48 102 44" stroke={C.trunk} strokeWidth="2.8" fill="none" strokeLinecap="round" />
        <path d="M 56 50 C 48 38 40 26 32 18" stroke={C.trunk} strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <path d="M 56 40 C 64 28 72 18 80 8" stroke={C.trunk} strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <path d="M 56 22 C 54 14 54 6 56 0" stroke={C.trunk} strokeWidth="2.1" fill="none" strokeLinecap="round" />
        {leafGroup(6, 52, 1.15)}
        {leafGroup(102, 44, 1.15)}
        {leafGroup(32, 16, 1.05)}
        {leafGroup(80, 6, 1.05)}
        {leafGroup(56, 0, 1.1)}
        {leafGroup(48, 42, 0.95)}
        {leafGroup(72, 36, 0.95)}
        {renderFlowers([[14, 50], [98, 42], [38, 16], [76, 6], [56, -2], [54, 38]])}
      </g>
    );
  }
  // Stage 6 — 大樹
  return (
    <g>
      <path d="M 54 98 C 50 60 58 24 56 -4" stroke={C.trunk} strokeWidth="5.6" fill="none" strokeLinecap="round" />
      <path d="M 54 78 C 38 68 18 60 -4 58" stroke={C.trunk} strokeWidth="3.4" fill="none" strokeLinecap="round" />
      <path d="M 56 68 C 74 58 96 48 116 44" stroke={C.trunk} strokeWidth="3.4" fill="none" strokeLinecap="round" />
      <path d="M 56 52 C 44 40 30 26 22 14" stroke={C.trunk} strokeWidth="2.7" fill="none" strokeLinecap="round" />
      <path d="M 56 40 C 70 26 86 12 96 -2" stroke={C.trunk} strokeWidth="2.7" fill="none" strokeLinecap="round" />
      <path d="M 56 22 C 50 12 46 4 44 -6" stroke={C.trunk} strokeWidth="2.3" fill="none" strokeLinecap="round" />
      <path d="M 56 14 C 64 6 70 -2 72 -8" stroke={C.trunk} strokeWidth="2.3" fill="none" strokeLinecap="round" />
      {leafGroup(-4, 58, 1.2)}
      {leafGroup(116, 44, 1.2)}
      {leafGroup(22, 12, 1.1)}
      {leafGroup(96, -4, 1.1)}
      {leafGroup(44, -8, 1.05)}
      {leafGroup(72, -10, 1.05)}
      {leafGroup(56, -6, 1.2)}
      {leafGroup(38, 30, 1)}
      {leafGroup(86, 22, 1)}
      {leafGroup(56, 10, 1.05)}
      {renderFlowers([
        [4, 54], [110, 42], [28, 8], [92, -6], [50, -10],
        [70, -12], [56, -16], [44, 28], [80, 20], [56, 4],
      ])}
    </g>
  );
}

/** 葉群 — 中心点まわりに参考スタイルのたまご型葉を5-6枚 */
function leafGroup(cx: number, cy: number, scale = 1): React.ReactElement {
  // [path-base, path-highlight] — ベジェ曲線で6枚の葉、それぞれ位置と角度違い
  // ペアごとに [base, highlight] のレイヤード
  const s = scale;
  // 葉の相対座標生成
  const leaves: Array<{ d: string; hd: string; base: string }> = [
    // 下左
    {
      d: `M ${cx} ${cy + 2 * s} C ${cx - 8 * s} ${cy - 2 * s} ${cx - 16 * s} ${cy + 6 * s} ${cx - 18 * s} ${cy + 12 * s} C ${cx - 12 * s} ${cy + 14 * s} ${cx - 4 * s} ${cy + 10 * s} ${cx} ${cy + 4 * s} Z`,
      hd: `M ${cx - 2 * s} ${cy + 3 * s} C ${cx - 8 * s} ${cy + 0 * s} ${cx - 14 * s} ${cy + 7 * s} ${cx - 16 * s} ${cy + 11 * s} C ${cx - 10 * s} ${cy + 12 * s} ${cx - 4 * s} ${cy + 9 * s} ${cx - 2 * s} ${cy + 4 * s} Z`,
      base: C.leafBase,
    },
    // 下右
    {
      d: `M ${cx} ${cy + 2 * s} C ${cx + 8 * s} ${cy - 2 * s} ${cx + 16 * s} ${cy + 6 * s} ${cx + 18 * s} ${cy + 12 * s} C ${cx + 12 * s} ${cy + 14 * s} ${cx + 4 * s} ${cy + 10 * s} ${cx} ${cy + 4 * s} Z`,
      hd: `M ${cx + 2 * s} ${cy + 3 * s} C ${cx + 8 * s} ${cy + 0 * s} ${cx + 14 * s} ${cy + 7 * s} ${cx + 16 * s} ${cy + 11 * s} C ${cx + 10 * s} ${cy + 12 * s} ${cx + 4 * s} ${cy + 9 * s} ${cx + 2 * s} ${cy + 4 * s} Z`,
      base: C.leafBase,
    },
    // 上左
    {
      d: `M ${cx} ${cy - 1 * s} C ${cx - 6 * s} ${cy - 8 * s} ${cx - 12 * s} ${cy - 14 * s} ${cx - 16 * s} ${cy - 14 * s} C ${cx - 14 * s} ${cy - 8 * s} ${cx - 6 * s} ${cy - 2 * s} ${cx} ${cy - 3 * s} Z`,
      hd: `M ${cx - 2 * s} ${cy - 2 * s} C ${cx - 7 * s} ${cy - 8 * s} ${cx - 11 * s} ${cy - 13 * s} ${cx - 14 * s} ${cy - 13 * s} C ${cx - 12 * s} ${cy - 8 * s} ${cx - 6 * s} ${cy - 4 * s} ${cx - 2 * s} ${cy - 4 * s} Z`,
      base: C.leafLight,
    },
    // 上右
    {
      d: `M ${cx} ${cy - 1 * s} C ${cx + 6 * s} ${cy - 8 * s} ${cx + 12 * s} ${cy - 14 * s} ${cx + 16 * s} ${cy - 14 * s} C ${cx + 14 * s} ${cy - 8 * s} ${cx + 6 * s} ${cy - 2 * s} ${cx} ${cy - 3 * s} Z`,
      hd: `M ${cx + 2 * s} ${cy - 2 * s} C ${cx + 7 * s} ${cy - 8 * s} ${cx + 11 * s} ${cy - 13 * s} ${cx + 14 * s} ${cy - 13 * s} C ${cx + 12 * s} ${cy - 8 * s} ${cx + 6 * s} ${cy - 4 * s} ${cx + 2 * s} ${cy - 4 * s} Z`,
      base: C.leafLight,
    },
    // 中央前
    {
      d: `M ${cx} ${cy + 5 * s} C ${cx - 5 * s} ${cy + 2 * s} ${cx - 6 * s} ${cy - 4 * s} ${cx} ${cy - 8 * s} C ${cx + 6 * s} ${cy - 4 * s} ${cx + 5 * s} ${cy + 2 * s} ${cx} ${cy + 5 * s} Z`,
      hd: `M ${cx} ${cy + 4 * s} C ${cx - 3 * s} ${cy + 2 * s} ${cx - 4 * s} ${cy - 3 * s} ${cx} ${cy - 6 * s} C ${cx + 4 * s} ${cy - 3 * s} ${cx + 3 * s} ${cy + 2 * s} ${cx} ${cy + 4 * s} Z`,
      base: C.leafBase,
    },
  ];
  return (
    <g>
      {leaves.map((l, i) => (
        <g key={i}>
          <path d={l.d} fill={l.base} />
          <path d={l.hd} fill={l.base === C.leafBase ? C.leafLight : C.leafShine} opacity="0.55" />
        </g>
      ))}
    </g>
  );
}

/** 花 — 3層構造 */
function renderFlowers(positions: Array<[number, number]>): React.ReactElement {
  return (
    <g>
      {positions.map(([cx, cy], i) => (
        <g key={i}>
          <circle cx={cx} cy={cy} r="2.6" fill={C.flower} />
          <circle cx={cx} cy={cy} r="1.2" fill={C.flowerCenter} />
          <circle cx={cx} cy={cy} r="0.45" fill={C.flowerHeart} />
        </g>
      ))}
    </g>
  );
}

/** ステージごとの鳥・卵・巣 */
function renderBirdScene(stage: number): React.ReactElement {
  if (stage === 0) {
    // 参考SVGをそのまま — 巣の中の卵
    return (
      <g>
        <path d="M 98 96 C 102 88 106 84 112 84 C 118 84 122 88 126 96" stroke={C.trunkLight} strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M 100 97 C 104 91 108 88 112 88 C 116 88 120 91 124 97" stroke={C.trunkSoft} strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <path d="M 98 96 C 100 99 106 102 112 102 C 118 102 124 99 126 96" stroke={C.trunkLight} strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M 112 78 C 119 78 124 83 124 91 C 124 97 120 101 112 101 C 104 101 100 97 100 91 C 100 83 105 78 112 78 Z" fill={C.eggShell} />
        <path d="M 109 80 C 114 79 118 82 120 87 C 121 90 119 94 116 95 C 113 96 110 94 109 90 C 108 86 108 82 109 80 Z" fill={C.eggShine} opacity="0.5" />
        <circle cx="106" cy="86" r="0.8" fill={C.eggSpec1} opacity="0.35" />
        <circle cx="117" cy="84" r="0.55" fill={C.eggSpec2} opacity="0.3" />
        <circle cx="119" cy="90" r="0.7" fill={C.eggSpec1} opacity="0.25" />
        <circle cx="107" cy="92" r="0.6" fill={C.eggSpec2} opacity="0.2" />
      </g>
    );
  }
  if (stage === 1) {
    // 卵の上半分にひび、ひよこ顔
    return (
      <g>
        <path d="M 98 96 C 102 88 106 84 112 84 C 118 84 122 88 126 96" stroke={C.trunkLight} strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M 98 96 C 100 99 106 102 112 102 C 118 102 124 99 126 96" stroke={C.trunkLight} strokeWidth="2" fill="none" strokeLinecap="round" />
        {/* 卵下半分 */}
        <path d="M 112 84 C 119 84 124 88 124 93 C 124 97 120 101 112 101 C 104 101 100 97 100 93 C 100 88 105 84 112 84 Z" fill={C.eggShell} />
        {/* ひびのジグザグ */}
        <path d="M 101 86 L 104 88 L 108 84 L 112 87 L 116 84 L 120 88 L 123 86" stroke={C.eggSpec1} strokeWidth="0.7" fill="none" strokeLinecap="round" />
        {/* ひよこの頭 */}
        <circle cx="112" cy="80" r="7" fill={C.bird} />
        <circle cx="109" cy="79" r="1.4" fill={C.eye} />
        <circle cx="115" cy="79" r="1.4" fill={C.eye} />
        <circle cx="109" cy="78.4" r="0.45" fill={C.eyeShine} />
        <circle cx="115" cy="78.4" r="0.45" fill={C.eyeShine} />
        <polygon points="118,81 122,82 118,83" fill={C.beak} />
        <circle cx="105" cy="82" r="1.1" fill={C.cheek} opacity="0.6" />
        <circle cx="119" cy="82" r="1.1" fill={C.cheek} opacity="0.6" />
      </g>
    );
  }
  if (stage === 2) {
    // ひよこ + 卵殻のかけら
    return (
      <g>
        {/* 卵殻 */}
        <path d="M 127 98 C 131 94 134 96 136 99 L 127 100 Z" fill={C.eggShell} />
        <path d="M 95 99 C 91 95 88 97 88 100 L 95 101 Z" fill={C.eggShell} />
        {/* ひよこ */}
        <ellipse cx="112" cy="90" rx="11" ry="9" fill={C.bird} />
        <ellipse cx="112" cy="95" rx="10" ry="3" fill={C.birdShade} opacity="0.3" />
        <circle cx="112" cy="76" r="10" fill={C.bird} />
        <circle cx="108" cy="75" r="1.6" fill={C.eye} />
        <circle cx="116" cy="75" r="1.6" fill={C.eye} />
        <circle cx="108" cy="74.3" r="0.55" fill={C.eyeShine} />
        <circle cx="116" cy="74.3" r="0.55" fill={C.eyeShine} />
        <polygon points="120,78 125,79 120,80" fill={C.beak} />
        <circle cx="103" cy="79" r="1.4" fill={C.cheek} opacity="0.6" />
        <circle cx="121" cy="79" r="1.4" fill={C.cheek} opacity="0.6" />
        <ellipse cx="103" cy="90" rx="3.5" ry="5" fill={C.birdShade} transform="rotate(-15 103 90)" />
        <path d="M 107 99 L 107 103 M 105 103 L 109 103" stroke={C.beak} strokeWidth="1.5" strokeLinecap="round" fill="none" />
        <path d="M 117 99 L 117 103 M 115 103 L 119 103" stroke={C.beak} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      </g>
    );
  }
  if (stage === 3) {
    // 子鳥
    return (
      <g>
        <ellipse cx="112" cy="88" rx="12" ry="10" fill={C.bird} />
        <circle cx="112" cy="73" r="9" fill={C.bird} />
        <circle cx="108" cy="72" r="1.6" fill={C.eye} />
        <circle cx="116" cy="72" r="1.6" fill={C.eye} />
        <circle cx="108" cy="71.2" r="0.55" fill={C.eyeShine} />
        <circle cx="116" cy="71.2" r="0.55" fill={C.eyeShine} />
        <polygon points="120,75 125,76 120,77" fill={C.beak} />
        <circle cx="103" cy="76" r="1.4" fill={C.cheek} opacity="0.6" />
        <circle cx="121" cy="76" r="1.4" fill={C.cheek} opacity="0.6" />
        <path d="M 103 84 C 96 88 100 98 107 95 C 108 90 107 86 103 84 Z" fill={C.wing} />
        <path d="M 123 88 L 130 85 L 127 92 Z" fill={C.wing} />
        <path d="M 107 98 L 107 103 M 105 103 L 109 103" stroke={C.beak} strokeWidth="1.5" strokeLinecap="round" fill="none" />
        <path d="M 117 98 L 117 103 M 115 103 L 119 103" stroke={C.beak} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      </g>
    );
  }
  if (stage === 4) {
    // 親鳥
    return (
      <g transform="translate(112, 70)">
        <ellipse cx="0" cy="7" rx="12" ry="9" fill={C.bird} />
        <circle cx="0" cy="-4" r="8" fill={C.bird} />
        <circle cx="-3" cy="-5" r="1.6" fill={C.eye} />
        <circle cx="3" cy="-5" r="1.6" fill={C.eye} />
        <circle cx="-3" cy="-5.7" r="0.55" fill={C.eyeShine} />
        <circle cx="3" cy="-5.7" r="0.55" fill={C.eyeShine} />
        <polygon points="7,-2 12,-1 7,0" fill={C.beak} />
        <circle cx="-8" cy="-2" r="1.4" fill={C.cheek} opacity="0.55" />
        <circle cx="8" cy="-2" r="1.4" fill={C.cheek} opacity="0.55" />
        <path d="M -4 -1 C -12 2 -10 11 -3 8 C -2 4 -3 0 -4 -1 Z" fill={C.wing} />
        <path d="M -11 6 L -18 4 L -15 12 Z" fill={C.wing} />
        <path d="M -3 15 L -3 18" stroke={C.beak} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M 3 15 L 3 18" stroke={C.beak} strokeWidth="1.5" strokeLinecap="round" />
      </g>
    );
  }
  if (stage === 5) {
    // 小さな巣 + 親鳥
    return (
      <g>
        <path d="M 100 60 C 104 52 110 48 116 48 C 122 48 128 52 132 60" stroke={C.trunkLight} strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M 102 61 C 106 55 112 52 116 52 C 120 52 124 55 130 61" stroke={C.trunkSoft} strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <path d="M 100 60 C 102 64 108 67 116 67 C 124 67 130 64 132 60" stroke={C.trunkLight} strokeWidth="2" fill="none" strokeLinecap="round" />
        {/* 親鳥 */}
        <g transform="translate(130, 44)">
          <ellipse cx="0" cy="6" rx="10" ry="8" fill={C.bird} />
          <circle cx="0" cy="-4" r="7" fill={C.bird} />
          <circle cx="-2.5" cy="-5" r="1.4" fill={C.eye} />
          <circle cx="2.5" cy="-5" r="1.4" fill={C.eye} />
          <circle cx="-2.5" cy="-5.6" r="0.5" fill={C.eyeShine} />
          <circle cx="2.5" cy="-5.6" r="0.5" fill={C.eyeShine} />
          <polygon points="6,-2 11,-1 6,0" fill={C.beak} />
          <path d="M -4 -1 C -11 1 -9 9 -2 6 C -1 3 -3 0 -4 -1 Z" fill={C.wing} />
          <path d="M -10 5 L -17 3 L -14 10 Z" fill={C.wing} />
        </g>
        {/* くわえた小枝 */}
        <path d="M 138 38 L 146 36" stroke={C.trunk} strokeWidth="1.2" strokeLinecap="round" />
      </g>
    );
  }
  // Stage 6 — 巣に家族
  return (
    <g>
      <path d="M 94 46 C 100 36 110 32 116 32 C 122 32 132 36 138 46" stroke={C.trunkLight} strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M 97 48 C 102 40 110 36 116 36 C 122 36 130 40 135 48" stroke={C.trunkSoft} strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <path d="M 94 46 C 96 51 104 55 116 55 C 128 55 136 51 138 46" stroke={C.trunkLight} strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <g stroke={C.trunkLight} strokeWidth="0.8" fill="none" strokeLinecap="round" opacity="0.5">
        <path d="M 100 46 C 106 48 114 46 119 48" />
        <path d="M 114 44 C 121 46 128 44 132 46" />
      </g>
      {/* 親鳥 */}
      <g transform="translate(138, 34)">
        <ellipse cx="0" cy="6" rx="11" ry="8.5" fill={C.bird} />
        <circle cx="0" cy="-4" r="8" fill={C.bird} />
        <circle cx="-3" cy="-5" r="1.6" fill={C.eye} />
        <circle cx="3" cy="-5" r="1.6" fill={C.eye} />
        <circle cx="-3" cy="-5.7" r="0.55" fill={C.eyeShine} />
        <circle cx="3" cy="-5.7" r="0.55" fill={C.eyeShine} />
        <polygon points="7,-2 13,-1 7,0" fill={C.beak} />
        <path d="M -4 -1 C -12 2 -10 11 -3 8 C -2 4 -3 0 -4 -1 Z" fill={C.wing} />
        <path d="M -11 6 L -18 4 L -15 12 Z" fill={C.wing} />
      </g>
      {/* 雛たち */}
      {[100, 110, 120].map((x, i) => (
        <g key={i} transform={`translate(${x}, 42)`}>
          <ellipse cx="0" cy="0" rx="4.5" ry="3.8" fill={C.bird} />
          <circle cx="0" cy="-3.5" r="3.5" fill={C.bird} />
          <circle cx="-1.2" cy="-4" r="0.7" fill={C.eye} />
          <circle cx="1.2" cy="-4" r="0.7" fill={C.eye} />
          <polygon points="3,-3 5.5,-2.5 3,-2" fill={C.beak} />
        </g>
      ))}
    </g>
  );
}
