'use client';

/**
 * バッジ獲得進捗を「巣のはじまり → 大樹と鳥の家族」の成長物語で表現するSVGシーン。
 * システム名 NEST にちなみ、最終的に鳥の家族が住む巣ができる構成。
 *
 * 設計方針:
 *   - すべて手描き illustration 調（生成的なクラスタは使わない）
 *   - 葉は大きなベジェ曲線ブロブ + ハイライト2層
 *   - 幹は塗りつぶしのテーパー型
 *   - 鳥は kawaii 装飾なしのシルエット（目はドット1個、頬の赤み等なし）
 *   - 参考SVG（viewBox 148×108）の座標系を維持
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

const C = {
  stem: '#4E342E',
  trunk: '#5D4037',
  trunkShade: '#3E2723',
  trunkSoft: '#8D6E63',
  trunkLight: '#A1887F',
  leafDark: '#558B2F',
  leafBase: '#7CB342',
  leafLight: '#9CCC65',
  leafShine: '#C5E1A5',
  eggShell: '#F5F0E0',
  eggShine: '#FBF8F0',
  eggSpec1: '#C8B898',
  eggSpec2: '#C0B088',
  bird: '#F4B860',
  birdShade: '#D98F3D',
  wing: '#A05A1F',
  beak: '#5D4037',
  eye: '#1F2937',
  flower: '#F8BBD0',
  flowerCenter: '#EC407A',
  flowerHeart: '#FFF59D',
  ground: '#8D6E63',
};

export function GrowthScene({ earned, total, className = '' }: GrowthSceneProps) {
  const stage = getStage(earned, total);

  return (
    <svg
      viewBox="0 0 148 108"
      className={`w-full h-auto growth-scene ${className}`}
      preserveAspectRatio="xMidYMax meet"
      aria-label={`成長ステージ: ${STAGE_LABELS[stage]}`}
      role="img"
    >
      <style>{`
        .growth-scene .pop { animation: gs-pop .85s cubic-bezier(.34,1.56,.64,1) both; transform-box: fill-box; transform-origin: 54px 98px; }
        .growth-scene .sway { animation: gs-sway 6.5s ease-in-out 1s infinite; transform-box: fill-box; transform-origin: 54px 100px; }
        .growth-scene .rock { animation: gs-rock 7s ease-in-out 2.5s infinite; transform-box: fill-box; transform-origin: 112px 92px; }
        @keyframes gs-pop { 0% { transform: scaleY(.2) scaleX(.6); opacity: 0; } 100% { transform: scaleY(1) scaleX(1); opacity: 1; } }
        @keyframes gs-sway { 0%,100% { transform: rotate(-.5deg); } 50% { transform: rotate(.5deg); } }
        @keyframes gs-rock { 0%,80%,100% { transform: rotate(0); } 84% { transform: rotate(2deg); } 88% { transform: rotate(-1.2deg); } 91% { transform: rotate(.6deg); } 94% { transform: rotate(0); } }
        @media (prefers-reduced-motion: reduce) {
          .growth-scene .pop, .growth-scene .sway, .growth-scene .rock { animation: none; }
        }
      `}</style>

      <ellipse cx="74" cy="100" rx="52" ry="3" fill={C.ground} opacity="0.12" />

      <g className="sway">
        <g className="pop">{renderPlant(stage)}</g>
      </g>

      <g
        className={stage === 0 ? 'rock' : undefined}
        style={stage === 0 ? ({ transformOrigin: '112px 92px' } as CSSProperties) : undefined}
      >
        {renderBirdScene(stage)}
      </g>
    </svg>
  );
}

/** 葉のブロブ — 一個の大きな有機シェイプを 2層フィルで描く */
function leafBlob(d: string, hd: string, base: string = C.leafBase): React.ReactElement {
  return (
    <g>
      <path d={d} fill={base} />
      <path d={hd} fill={base === C.leafBase ? C.leafLight : C.leafShine} opacity="0.55" />
    </g>
  );
}

/** 幹/枝 — 塗りつぶしのテーパー型（左右の制御点で形を作る） */
function trunkShape(d: string, fill: string = C.trunk): React.ReactElement {
  return <path d={d} fill={fill} />;
}

/** 鳥のシルエット — kawaii 装飾なし */
function bird(cx: number, cy: number, scale = 1, facing: 'left' | 'right' = 'right'): React.ReactElement {
  const s = scale;
  const dir = facing === 'right' ? 1 : -1;
  return (
    <g transform={`translate(${cx} ${cy})${facing === 'left' ? ' scale(-1 1)' : ''}`}>
      {/* 体 */}
      <path
        d={`M 0 0 C ${-9 * s} ${-1 * s} ${-10 * s} ${5 * s} ${-7 * s} ${7 * s} C ${-3 * s} ${9 * s} ${4 * s} ${9 * s} ${8 * s} ${6 * s} C ${11 * s} ${3 * s} ${11 * s} ${-2 * s} ${8 * s} ${-3 * s} C ${5 * s} ${-5 * s} ${1 * s} ${-3 * s} 0 0 Z`}
        fill={C.bird}
      />
      {/* 翼 */}
      <path
        d={`M ${-3 * s} ${1 * s} C ${1 * s} ${0 * s} ${4 * s} ${2 * s} ${4 * s} ${5 * s} C ${1 * s} ${7 * s} ${-3 * s} ${6 * s} ${-3 * s} ${1 * s} Z`}
        fill={C.wing}
        opacity="0.55"
      />
      {/* くちばし */}
      <polygon points={`${8 * s * dir},${-1 * s} ${11 * s * dir},0 ${8 * s * dir},${1 * s}`} fill={C.beak} />
      {/* 目 — ドット1個 */}
      <circle cx={5 * s * dir} cy={-1 * s} r={0.7 * s} fill={C.eye} />
    </g>
  );
}

/** ステージごとの植物 */
function renderPlant(stage: number): React.ReactElement | null {
  if (stage === 0) {
    // 参考SVG verbatim
    return (
      <g>
        <path d="M 54 98 C 52 88 56 78 53 68" stroke={C.stem} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M 53 70 C 42 58 26 44 14 46 C 16 58 36 74 53 72 Z" fill={C.leafBase} />
        <path d="M 53 70 C 44 60 30 48 20 50 C 22 60 40 72 53 72 Z" fill={C.leafLight} opacity="0.55" />
        <path d="M 52 71 C 40 62 26 54 18 50" stroke={C.leafDark} strokeWidth="0.55" fill="none" strokeLinecap="round" opacity="0.35" />
        <path d="M 55 72 C 64 62 78 54 86 58 C 82 68 68 78 55 74 Z" fill={C.leafBase} />
        <path d="M 55 72 C 62 64 74 58 80 60 C 78 68 68 76 55 74 Z" fill={C.leafLight} opacity="0.55" />
        <path d="M 55 73 C 64 66 76 60 82 60" stroke={C.leafDark} strokeWidth="0.5" fill="none" strokeLinecap="round" opacity="0.35" />
        <path d="M 52 68 C 50 62 52 56 54 52 C 56 56 56 62 55 68 Z" fill={C.leafLight} />
        <path d="M 53 66 C 52 62 52.5 58 54 55 C 55 58 55 62 54.5 66 Z" fill={C.leafShine} opacity="0.5" />
      </g>
    );
  }
  if (stage === 1) {
    // 茎が伸び、双葉が広がり、新葉が一枚追加
    return (
      <g>
        <path d="M 54 98 C 52 86 56 70 54 54" stroke={C.stem} strokeWidth="1.7" fill="none" strokeLinecap="round" />
        {/* 左葉（広がり） */}
        <path d="M 53 70 C 40 60 22 46 10 48 C 12 62 32 78 53 74 Z" fill={C.leafBase} />
        <path d="M 53 70 C 42 62 26 52 16 54 C 18 62 38 74 53 74 Z" fill={C.leafLight} opacity="0.55" />
        <path d="M 52 71 C 38 64 22 56 14 52" stroke={C.leafDark} strokeWidth="0.55" fill="none" strokeLinecap="round" opacity="0.35" />
        {/* 右葉（広がり） */}
        <path d="M 55 72 C 68 62 86 54 96 58 C 92 68 74 80 55 76 Z" fill={C.leafBase} />
        <path d="M 55 72 C 66 64 80 58 88 60 C 86 68 72 76 55 76 Z" fill={C.leafLight} opacity="0.55" />
        <path d="M 55 73 C 66 66 80 60 88 60" stroke={C.leafDark} strokeWidth="0.5" fill="none" strokeLinecap="round" opacity="0.35" />
        {/* 上の新葉 */}
        <path d="M 53 56 C 48 50 44 40 46 32 C 52 36 56 46 56 56 Z" fill={C.leafBase} />
        <path d="M 53 56 C 50 50 48 42 50 36 C 53 40 55 46 56 56 Z" fill={C.leafLight} opacity="0.55" />
        <path d="M 54 56 C 56 50 60 42 64 38" stroke={C.leafDark} strokeWidth="0.45" fill="none" strokeLinecap="round" opacity="0.35" />
      </g>
    );
  }
  if (stage === 2) {
    // 若い茂み — 2 個の大葉ブロブを構成
    return (
      <g>
        <path d="M 54 98 C 52 80 56 60 54 42" stroke={C.stem} strokeWidth="2" fill="none" strokeLinecap="round" />
        {/* 下の大葉群 */}
        {leafBlob(
          'M 53 74 C 28 64 12 50 6 56 C 8 70 30 82 53 78 Z',
          'M 53 74 C 32 66 18 56 14 60 C 16 70 32 78 53 78 Z',
        )}
        {leafBlob(
          'M 55 74 C 78 62 94 50 100 58 C 96 70 78 84 55 78 Z',
          'M 55 74 C 76 64 90 56 94 62 C 92 70 78 80 55 78 Z',
        )}
        {/* 上の葉ブロブ */}
        {leafBlob(
          'M 52 52 C 36 44 28 32 32 26 C 44 26 56 36 56 50 Z',
          'M 52 52 C 40 44 34 36 38 32 C 46 32 54 38 56 50 Z',
        )}
        {leafBlob(
          'M 56 52 C 70 44 78 32 76 26 C 64 26 56 36 56 50 Z',
          'M 56 52 C 68 44 74 36 72 32 C 64 32 58 38 56 50 Z',
        )}
        {/* てっぺん */}
        {leafBlob(
          'M 50 42 C 46 30 50 18 56 14 C 60 22 60 32 56 42 Z',
          'M 51 40 C 50 30 53 22 55 18 C 57 24 57 32 55 40 Z',
          C.leafLight,
        )}
      </g>
    );
  }
  if (stage === 3) {
    // 茂みが立体的に — 3段の葉ブロブ
    return (
      <g>
        <path d="M 54 98 C 52 74 56 50 54 24" stroke={C.trunk} strokeWidth="2.6" fill="none" strokeLinecap="round" />
        {/* 下段の葉群 */}
        {leafBlob(
          'M 53 72 C 22 60 0 46 0 56 C 4 70 28 84 53 78 Z',
          'M 53 72 C 26 62 8 54 8 60 C 12 68 30 78 53 78 Z',
        )}
        {leafBlob(
          'M 55 72 C 84 58 108 46 108 56 C 104 70 82 86 55 78 Z',
          'M 55 72 C 80 62 102 54 100 60 C 96 68 78 80 55 78 Z',
        )}
        {/* 中段 */}
        {leafBlob(
          'M 52 48 C 30 38 18 24 24 18 C 40 18 56 30 58 46 Z',
          'M 52 48 C 34 40 24 30 30 26 C 42 26 54 36 58 46 Z',
        )}
        {leafBlob(
          'M 56 48 C 78 38 90 24 84 18 C 68 18 56 30 56 46 Z',
          'M 56 48 C 74 40 84 30 78 26 C 66 26 56 36 56 46 Z',
        )}
        {/* 上 */}
        {leafBlob(
          'M 48 30 C 38 20 40 6 48 0 C 56 6 58 18 54 30 Z',
          'M 49 28 C 44 22 46 12 50 8 C 54 12 55 20 53 28 Z',
          C.leafLight,
        )}
        {leafBlob(
          'M 58 30 C 68 20 66 6 58 0 C 50 6 50 18 54 30 Z',
          'M 57 28 C 62 22 60 12 56 8 C 52 12 51 20 53 28 Z',
          C.leafLight,
        )}
      </g>
    );
  }
  if (stage === 4) {
    // 苗木 — 塗りつぶしの幹 + 大きな葉ブロブ
    return (
      <g>
        {/* 幹 — 塗りつぶしテーパー */}
        {trunkShape('M 50 98 C 49 78 53 56 55 30 C 57 56 59 78 58 98 Z')}
        {trunkShape('M 50 98 C 49 78 53 56 54 30 C 55 56 55 78 53 98 Z', C.trunkShade)}
        {/* 枝 */}
        {trunkShape('M 54 64 C 38 56 22 48 16 52 C 26 56 38 62 54 68 Z')}
        {trunkShape('M 54 56 C 70 48 88 38 96 44 C 84 50 68 56 54 60 Z')}
        {/* 大きな葉ブロブ — 左下 */}
        {leafBlob(
          'M 22 56 C 0 50 -8 36 0 28 C 16 24 36 36 38 56 Z',
          'M 22 56 C 6 50 4 40 8 36 C 22 34 34 42 38 56 Z',
        )}
        {/* 右下 */}
        {leafBlob(
          'M 86 48 C 110 44 122 30 116 22 C 100 20 80 34 76 48 Z',
          'M 86 48 C 102 44 110 36 106 32 C 92 32 82 40 76 48 Z',
        )}
        {/* 上中央 */}
        {leafBlob(
          'M 36 28 C 18 18 22 0 36 -2 C 56 0 64 22 56 32 Z',
          'M 36 28 C 24 22 26 10 36 8 C 50 10 56 22 56 32 Z',
        )}
        {leafBlob(
          'M 74 24 C 92 16 90 -2 74 -2 C 56 0 50 18 56 30 Z',
          'M 72 24 C 84 18 82 6 72 6 C 60 8 56 18 56 30 Z',
        )}
        {/* てっぺん */}
        {leafBlob(
          'M 46 8 C 42 -4 50 -16 56 -16 C 64 -16 70 0 64 12 Z',
          'M 48 6 C 46 -2 52 -10 56 -10 C 60 -10 64 -2 62 8 Z',
          C.leafLight,
        )}
      </g>
    );
  }
  if (stage === 5) {
    // 若木に花
    return (
      <g>
        {trunkShape('M 48 98 C 47 76 53 50 56 20 C 59 50 61 76 60 98 Z')}
        {trunkShape('M 48 98 C 48 76 53 50 55 20 C 56 50 56 76 53 98 Z', C.trunkShade)}
        {trunkShape('M 56 60 C 36 50 16 38 8 44 C 22 50 38 58 56 64 Z')}
        {trunkShape('M 56 50 C 74 38 92 24 102 30 C 88 38 70 48 56 54 Z')}
        {trunkShape('M 56 30 C 50 20 46 8 50 0 C 56 6 58 18 58 30 Z')}
        {/* 葉ブロブ */}
        {leafBlob(
          'M 14 48 C -8 42 -16 26 -6 18 C 14 14 38 28 40 50 Z',
          'M 14 48 C 0 42 -4 32 0 28 C 16 24 30 34 40 50 Z',
        )}
        {leafBlob(
          'M 96 36 C 122 32 134 14 124 6 C 104 4 80 22 78 38 Z',
          'M 96 36 C 112 32 120 22 114 18 C 98 18 86 28 78 38 Z',
        )}
        {leafBlob(
          'M 30 14 C 8 4 14 -16 32 -16 C 56 -14 64 8 56 22 Z',
          'M 30 14 C 16 6 20 -6 32 -6 C 50 -4 56 8 56 22 Z',
        )}
        {leafBlob(
          'M 82 8 C 102 -4 96 -22 78 -20 C 56 -16 50 4 56 22 Z',
          'M 80 8 C 92 -2 88 -12 78 -12 C 62 -10 56 6 56 22 Z',
        )}
        {leafBlob(
          'M 42 -4 C 38 -18 48 -32 56 -32 C 64 -32 72 -18 68 -4 C 60 4 50 4 42 -4 Z',
          'M 44 -6 C 42 -16 50 -24 56 -24 C 62 -24 68 -16 66 -6 C 60 -2 52 -2 44 -6 Z',
          C.leafLight,
        )}
        {renderFlowers([[6, 44], [104, 32], [30, 6], [80, 0], [56, -24]])}
      </g>
    );
  }
  // Stage 6 — 大樹
  return (
    <g>
      {trunkShape('M 46 98 C 45 70 53 40 58 4 C 63 40 65 70 62 98 Z')}
      {trunkShape('M 46 98 C 46 70 53 40 56 4 C 58 40 58 70 53 98 Z', C.trunkShade)}
      {trunkShape('M 56 60 C 32 48 8 32 -4 38 C 18 48 38 56 56 64 Z')}
      {trunkShape('M 58 48 C 80 32 104 16 116 22 C 96 34 76 44 58 54 Z')}
      {trunkShape('M 56 28 C 48 14 44 -4 50 -16 C 58 -6 62 10 60 30 Z')}
      {trunkShape('M 58 22 C 70 4 84 -16 90 -8 C 80 6 70 18 60 32 Z')}
      {/* 大きな葉ブロブ */}
      {leafBlob(
        'M 4 44 C -22 38 -28 20 -16 10 C 8 4 36 22 40 48 Z',
        'M 4 44 C -10 40 -14 28 -8 22 C 10 16 28 28 40 48 Z',
      )}
      {leafBlob(
        'M 110 30 C 138 26 146 6 132 -4 C 110 -4 80 16 78 36 Z',
        'M 110 30 C 128 28 132 14 124 8 C 108 8 88 22 78 36 Z',
      )}
      {leafBlob(
        'M 18 -4 C -6 -12 -2 -34 22 -36 C 50 -34 66 -10 56 8 Z',
        'M 18 -4 C 2 -10 4 -22 22 -24 C 44 -22 56 -8 56 8 Z',
      )}
      {leafBlob(
        'M 90 -10 C 116 -22 110 -42 86 -42 C 60 -38 50 -14 56 8 Z',
        'M 90 -10 C 104 -18 100 -30 86 -30 C 66 -28 54 -14 56 8 Z',
      )}
      {leafBlob(
        'M 38 -22 C 26 -38 38 -56 56 -56 C 74 -56 86 -38 74 -22 C 60 -14 50 -14 38 -22 Z',
        'M 40 -24 C 32 -34 42 -46 56 -46 C 70 -46 80 -34 72 -24 C 62 -18 52 -18 40 -24 Z',
        C.leafLight,
      )}
      {leafBlob(
        'M 36 22 C 20 14 14 -2 28 -8 C 46 -6 56 8 56 22 Z',
        'M 36 22 C 24 14 22 4 32 0 C 46 2 54 12 56 22 Z',
      )}
      {leafBlob(
        'M 76 18 C 92 8 96 -8 84 -10 C 66 -6 56 8 56 22 Z',
        'M 76 18 C 86 10 88 0 80 -2 C 66 0 58 10 56 22 Z',
      )}
      {renderFlowers([
        [-8, 40], [122, 24], [16, -16], [94, -22], [54, -50],
        [36, 10], [80, 6], [26, -32], [88, -34],
      ])}
    </g>
  );
}

/** 花 — 控えめな3層 */
function renderFlowers(positions: Array<[number, number]>): React.ReactElement {
  return (
    <g>
      {positions.map(([cx, cy], i) => (
        <g key={i}>
          <circle cx={cx} cy={cy} r="2.4" fill={C.flower} />
          <circle cx={cx} cy={cy} r="1" fill={C.flowerCenter} />
          <circle cx={cx} cy={cy} r="0.4" fill={C.flowerHeart} />
        </g>
      ))}
    </g>
  );
}

/** ステージごとの鳥・卵・巣 */
function renderBirdScene(stage: number): React.ReactElement {
  if (stage === 0) {
    // 参考SVG verbatim — 巣の中の卵
    return (
      <g>
        <path d="M 98 96 C 102 88 106 84 112 84 C 118 84 122 88 126 96" stroke={C.trunkSoft} strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M 100 97 C 104 91 108 88 112 88 C 116 88 120 91 124 97" stroke={C.trunkLight} strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <path d="M 98 96 C 100 99 106 102 112 102 C 118 102 124 99 126 96" stroke={C.trunkSoft} strokeWidth="2" fill="none" strokeLinecap="round" />
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
    // 卵にひび（中は見せない）
    return (
      <g>
        <path d="M 98 96 C 102 88 106 84 112 84 C 118 84 122 88 126 96" stroke={C.trunkSoft} strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M 100 97 C 104 91 108 88 112 88 C 116 88 120 91 124 97" stroke={C.trunkLight} strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <path d="M 98 96 C 100 99 106 102 112 102 C 118 102 124 99 126 96" stroke={C.trunkSoft} strokeWidth="2" fill="none" strokeLinecap="round" />
        {/* 上半分 — 少しずれる */}
        <path d="M 110 78 C 117 78 122 83 122 88 L 102 87 C 102 83 105 78 110 78 Z" fill={C.eggShell} transform="rotate(-8 112 85)" />
        {/* 下半分 */}
        <path d="M 112 88 C 119 88 124 90 124 91 C 124 97 120 101 112 101 C 104 101 100 97 100 91 C 100 90 105 88 112 88 Z" fill={C.eggShell} />
        {/* ひび — ジグザグ */}
        <path d="M 100 90 L 103 91 L 106 87 L 109 90 L 112 86 L 115 89 L 118 87 L 121 90 L 124 89" stroke={C.eggSpec1} strokeWidth="0.6" fill="none" strokeLinecap="round" />
        <circle cx="107" cy="92" r="0.6" fill={C.eggSpec2} opacity="0.25" />
        <circle cx="117" cy="96" r="0.7" fill={C.eggSpec1} opacity="0.25" />
      </g>
    );
  }
  if (stage === 2) {
    // 卵殻のかけら + ひよこシルエット
    return (
      <g>
        {/* 卵殻のかけら（2片） */}
        <path d="M 96 102 C 98 96 103 96 105 100 L 96 102 Z" fill={C.eggShell} />
        <path d="M 124 100 C 122 95 128 95 130 100 L 124 100 Z" fill={C.eggShell} />
        {/* ひよこ — シンプルなシルエット */}
        {bird(112, 94, 1.1)}
      </g>
    );
  }
  if (stage === 3) {
    // 鳥 — もう少しおとな
    return <g>{bird(112, 86, 1.15)}</g>;
  }
  if (stage === 4) {
    // 枝の上の鳥
    return <g>{bird(110, 72, 1.15)}</g>;
  }
  if (stage === 5) {
    // 巣 + 親鳥
    return (
      <g>
        <path d="M 96 58 C 100 50 106 46 112 46 C 118 46 124 50 128 58" stroke={C.trunkSoft} strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M 98 59 C 102 53 108 50 112 50 C 116 50 122 53 126 59" stroke={C.trunkLight} strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <path d="M 96 58 C 98 62 104 65 112 65 C 120 65 126 62 128 58" stroke={C.trunkSoft} strokeWidth="2" fill="none" strokeLinecap="round" />
        {bird(128, 46, 1.05, 'left')}
        {/* 巣に運ぶ小枝 */}
        <path d="M 116 44 L 122 42" stroke={C.trunk} strokeWidth="1" strokeLinecap="round" />
      </g>
    );
  }
  // Stage 6 — 巣に家族
  return (
    <g>
      {/* 巣 */}
      <path d="M 92 46 C 98 36 108 32 114 32 C 120 32 132 36 138 46" stroke={C.trunkSoft} strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M 95 48 C 100 40 108 36 114 36 C 120 36 128 40 135 48" stroke={C.trunkLight} strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <path d="M 92 46 C 94 51 102 55 114 55 C 126 55 136 51 138 46" stroke={C.trunkSoft} strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <g stroke={C.trunkSoft} strokeWidth="0.7" fill="none" strokeLinecap="round" opacity="0.45">
        <path d="M 98 46 C 104 48 112 46 117 48" />
        <path d="M 112 44 C 119 46 126 44 132 46" />
      </g>
      {/* 親鳥 */}
      {bird(138, 36, 1.1, 'left')}
      {/* 雛 — 簡略 */}
      {[100, 110, 120].map((x, i) => (
        <g key={i} transform={`translate(${x} 44)`}>
          <ellipse cx="0" cy="0" rx="4" ry="3.4" fill={C.bird} />
          <circle cx="-1.5" cy="-1" r="0.7" fill={C.eye} />
          <polygon points="3,0 5,1 3,2" fill={C.beak} />
        </g>
      ))}
    </g>
  );
}
