'use client';

/**
 * バッジ獲得進捗を「巣のはじまり → 大樹と鳥の家族」の成長物語で表現するSVGシーン。
 * システム名 NEST にちなみ、最終的に鳥の家族が住む巣ができる構成。
 *
 * Figma 制作指示書のパレットとパスデータをそのまま使用。
 * Stage 0-1 は Figma で完成したデザインの移植、Stage 2-6 は同じ意匠言語の暫定実装。
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
  '誕生',
  '若木',
  '開花',
  '巣づくり',
  'NEST 完成',
];

export function getStageLabel(earned: number, total: number): string {
  return STAGE_LABELS[getStage(earned, total)];
}

// Figma 指示書のパレット
const C = {
  // 葉 — 4色レイヤー（奥→手前）
  leaf1: '#66BB6A',
  leaf2: '#81C784',
  leaf3: '#A5D6A7',
  leaf4: '#C8E6C9',
  // 幹/茎
  trunk: '#5D4037',
  // 卵/巣
  eggShell: '#FFF8E1',
  eggSpec: '#D7CCC8',
  nestDark: '#8D6E63',
  nestMid: '#795548',
  // ひよこ
  chickBase: '#FFD54F',
  chickShade: '#FFCA28',
  beak: '#FF8F00',
  cheek: '#FFAB91',
  // 成鳥
  birdBase: '#795548',
  birdMid: '#8D6E63',
  birdBelly: '#BCAAA4',
  // 花
  flower: '#F48FB1',
  flowerCenter: '#FFF9C4',
  // 地面影
  shadow: '#D7CCC8',
  // 目
  eye: '#1F2937',
  eyeShine: '#FFFFFF',
};

const STAGE_FRAMES: Record<number, { w: number; h: number }> = {
  0: { w: 80, h: 70 },
  1: { w: 80, h: 75 },
  2: { w: 90, h: 80 },
  3: { w: 100, h: 90 },
  4: { w: 110, h: 100 },
  5: { w: 115, h: 110 },
  6: { w: 120, h: 115 },
};

const VIEW_W = 200;
const VIEW_H = 120;

export function GrowthScene({ earned, total, className = '' }: GrowthSceneProps) {
  const stage = getStage(earned, total);
  const frame = STAGE_FRAMES[stage];
  const tx = (VIEW_W - frame.w) / 2;
  const ty = VIEW_H - frame.h;

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className={`w-full h-auto growth-scene ${className}`}
      preserveAspectRatio="xMidYMax meet"
      aria-label={`成長ステージ: ${STAGE_LABELS[stage]}`}
      role="img"
    >
      <style>{`
        .growth-scene .pop { animation: gs-pop .85s cubic-bezier(.34,1.56,.64,1) both; transform-box: fill-box; transform-origin: bottom center; }
        .growth-scene .sway { animation: gs-sway 6.5s ease-in-out 1s infinite; transform-box: fill-box; transform-origin: bottom center; }
        .growth-scene .bob { animation: gs-bob 3.4s ease-in-out infinite; }
        .growth-scene .rock { animation: gs-rock 7s ease-in-out 2.5s infinite; transform-box: fill-box; transform-origin: center; }
        @keyframes gs-pop { 0% { transform: scaleY(.2) scaleX(.6); opacity: 0; } 100% { transform: scaleY(1) scaleX(1); opacity: 1; } }
        @keyframes gs-sway { 0%,100% { transform: rotate(-.5deg); } 50% { transform: rotate(.5deg); } }
        @keyframes gs-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-1.5px); } }
        @keyframes gs-rock { 0%,80%,100% { transform: rotate(0); } 84% { transform: rotate(2deg); } 88% { transform: rotate(-1.2deg); } 91% { transform: rotate(.6deg); } 94% { transform: rotate(0); } }
        @media (prefers-reduced-motion: reduce) {
          .growth-scene .pop, .growth-scene .sway, .growth-scene .bob, .growth-scene .rock { animation: none; }
        }
      `}</style>

      <g transform={`translate(${tx} ${ty})`}>{renderStage(stage)}</g>
    </svg>
  );
}

function renderStage(stage: number): React.ReactElement {
  switch (stage) {
    case 0:
      return <Stage0 />;
    case 1:
      return <Stage1 />;
    case 2:
      return <Stage2 />;
    case 3:
      return <Stage3 />;
    case 4:
      return <Stage4 />;
    case 5:
      return <Stage5 />;
    case 6:
    default:
      return <Stage6 />;
  }
}

/** ------------------------------------------------------------------ */
/** Stage 0 — はじまり（Figma 移植）                                       */
/** ------------------------------------------------------------------ */
function Stage0(): React.ReactElement {
  return (
    <g>
      <ellipse cx="40" cy="66" rx="30" ry="2" fill={C.shadow} opacity="0.25" />
      <g className="sway">
        <g className="pop">
          {/* 茎 */}
          <path
            d="M 28 65 C 27 58 29 48 28 36"
            stroke={C.trunk}
            strokeWidth="1.4"
            fill="none"
            strokeLinecap="round"
          />
          {/* 左の双葉（3色重ね） */}
          <path d="M 27 42 C 19 36 9 33 3 37 C 6 45 17 48 27 45 Z" fill={C.leaf1} />
          <path d="M 27 42 C 21 37 12 35 7 38 C 10 44 18 47 27 44 Z" fill={C.leaf2} />
          <path d="M 27 42 C 22 39 15 37 11 39 C 13 43 20 46 27 44 Z" fill={C.leaf3} />
          {/* 右の双葉（小・3色重ね） */}
          <path d="M 29 45 C 36 41 45 39 49 42 C 45 48 36 50 29 47 Z" fill={C.leaf1} />
          <path d="M 29 45 C 35 42 42 40 46 43 C 43 47 36 49 29 46 Z" fill={C.leaf2} />
          <path d="M 29 45 C 34 43 39 42 43 44 C 41 47 35 48 29 46 Z" fill={C.leaf3} />
          {/* 芽 */}
          <path d="M 27 36 C 26 33 27 30 28 27 C 30 30 30 33 29 36 Z" fill={C.leaf2} />
          <path d="M 27.5 35 C 27 32 27.5 30 28 28 C 29 30 29 32 28.5 35 Z" fill={C.leaf3} />
        </g>
      </g>
      {/* 巣 */}
      <g className="rock" style={{ transformOrigin: '60px 58px' } as CSSProperties}>
        <path
          d="M 50 60 C 53 56 56 54 60 54 C 64 54 67 56 70 60"
          stroke={C.nestDark}
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 52 60 C 54 57 57 56 60 56 C 63 56 66 57 68 60"
          stroke={C.nestMid}
          strokeWidth="1.1"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 50 60 C 52 63 56 65 60 65 C 64 65 68 63 70 60"
          stroke={C.nestDark}
          strokeWidth="1.7"
          fill="none"
          strokeLinecap="round"
        />
        {/* 卵 */}
        <path
          d="M 60 48 C 64 48 67 51 67 56 C 67 60 64 63 60 63 C 56 63 53 60 53 56 C 53 51 56 48 60 48 Z"
          fill={C.eggShell}
        />
        <path
          d="M 58 50 C 61 50 63 52 64 55 C 64 58 62 60 59 60 C 56 60 55 58 56 55 C 56 52 56 50 58 50 Z"
          fill="#FFFFFF"
          opacity="0.45"
        />
        <circle cx="56" cy="53" r="0.5" fill={C.eggSpec} opacity="0.4" />
        <circle cx="64" cy="52" r="0.4" fill={C.eggSpec} opacity="0.35" />
        <circle cx="66" cy="57" r="0.4" fill={C.eggSpec} opacity="0.3" />
        <circle cx="57" cy="59" r="0.4" fill={C.eggSpec} opacity="0.3" />
      </g>
    </g>
  );
}

/** ------------------------------------------------------------------ */
/** Stage 1 — 芽吹き（Figma 移植）                                         */
/** ------------------------------------------------------------------ */
function Stage1(): React.ReactElement {
  return (
    <g>
      <ellipse cx="40" cy="71" rx="30" ry="2" fill={C.shadow} opacity="0.25" />
      <g className="sway">
        <g className="pop">
          <path
            d="M 28 70 C 27 62 29 50 28 36 C 27 26 29 20 28 14"
            stroke={C.trunk}
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
          />
          {/* Pair 1 (lowest, largest) */}
          <path d="M 27 50 C 19 44 9 41 4 45 C 8 52 18 56 27 53 Z" fill={C.leaf1} />
          <path d="M 27 50 C 21 46 13 44 8 47 C 10 52 19 55 27 52 Z" fill={C.leaf2} />
          <path d="M 27 50 C 22 47 16 46 11 47 C 13 51 20 54 27 52 Z" fill={C.leaf3} />
          <path d="M 29 52 C 36 48 45 46 49 49 C 45 54 36 57 29 54 Z" fill={C.leaf1} />
          <path d="M 29 52 C 35 49 42 47 46 50 C 43 54 36 56 29 53 Z" fill={C.leaf2} />
          <path d="M 29 52 C 34 50 39 49 43 51 C 41 54 35 55 29 53 Z" fill={C.leaf3} />
          {/* Pair 2 */}
          <path d="M 27 38 C 21 33 12 30 7 33 C 10 39 19 42 27 40 Z" fill={C.leaf1} />
          <path d="M 27 38 C 22 35 15 33 10 35 C 12 39 19 41 27 40 Z" fill={C.leaf2} />
          <path d="M 27 38 C 23 36 17 35 13 36 C 14 38 20 40 27 40 Z" fill={C.leaf3} />
          <path d="M 29 40 C 35 36 42 34 47 36 C 44 41 36 43 29 42 Z" fill={C.leaf1} />
          <path d="M 29 40 C 35 37 40 36 44 37 C 42 40 35 42 29 41 Z" fill={C.leaf2} />
          <path d="M 29 40 C 34 38 38 37 42 38 C 40 40 35 41 29 41 Z" fill={C.leaf3} />
          {/* Pair 3 */}
          <path d="M 27 27 C 22 23 14 21 10 23 C 12 27 19 30 27 28 Z" fill={C.leaf1} />
          <path d="M 27 27 C 23 24 17 23 13 24 C 14 27 20 29 27 28 Z" fill={C.leaf2} />
          <path d="M 29 29 C 33 25 39 23 44 24 C 42 28 36 30 29 30 Z" fill={C.leaf1} />
          <path d="M 29 29 C 33 26 38 25 41 26 C 40 28 35 30 29 30 Z" fill={C.leaf2} />
          {/* Pair 4 (smallest) */}
          <path d="M 27 19 C 23 17 18 16 15 17 C 17 20 21 22 27 20 Z" fill={C.leaf2} />
          <path d="M 27 19 C 24 18 20 17 17 18 C 19 19 22 21 27 20 Z" fill={C.leaf3} />
          <path d="M 29 21 C 33 18 38 17 41 18 C 40 21 35 22 29 22 Z" fill={C.leaf2} />
          <path d="M 29 21 C 33 19 37 18 39 19 C 38 21 34 22 29 22 Z" fill={C.leaf3} />
          {/* 大きくなった芽 */}
          <path d="M 26 14 C 25 11 26 7 28 3 C 30 7 31 11 30 14 Z" fill={C.leaf2} />
          <path d="M 27 13 C 26 10 27 7 28 5 C 29 7 30 10 29 13 Z" fill={C.leaf3} />
        </g>
      </g>
      {/* 巣＋ひび割れた卵 */}
      <g>
        <path
          d="M 50 64 C 53 60 56 58 60 58 C 64 58 67 60 70 64"
          stroke={C.nestDark}
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 52 64 C 54 61 57 60 60 60 C 63 60 66 61 68 64"
          stroke={C.nestMid}
          strokeWidth="1.1"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 50 64 C 52 67 56 69 60 69 C 64 69 68 67 70 64"
          stroke={C.nestDark}
          strokeWidth="1.7"
          fill="none"
          strokeLinecap="round"
        />
        {/* 卵下半分 */}
        <path
          d="M 60 56 C 64 56 67 58 67 62 C 67 65 64 67 60 67 C 56 67 53 65 53 62 C 53 58 56 56 60 56 Z"
          fill={C.eggShell}
        />
        {/* ひび — ジグザグ */}
        <path
          d="M 53 55 L 55 57 L 57 54 L 60 56 L 62 53 L 65 56 L 67 54"
          stroke={C.eggSpec}
          strokeWidth="0.8"
          fill="none"
          strokeLinecap="round"
        />
        <circle cx="56" cy="61" r="0.5" fill={C.eggSpec} opacity="0.4" />
        <circle cx="64" cy="60" r="0.4" fill={C.eggSpec} opacity="0.35" />
        <circle cx="58" cy="65" r="0.4" fill={C.eggSpec} opacity="0.3" />
      </g>
    </g>
  );
}

/** ------------------------------------------------------------------ */
/** Stage 2 — 誕生（暫定: 同じ意匠言語）                                    */
/** ------------------------------------------------------------------ */
function Stage2(): React.ReactElement {
  return (
    <g>
      <ellipse cx="45" cy="76" rx="35" ry="2" fill={C.shadow} opacity="0.25" />
      <g className="sway">
        <g className="pop">
          {/* 茎 */}
          <path
            d="M 28 74 C 27 64 29 50 28 32 C 27 22 29 14 28 8"
            stroke={C.trunk}
            strokeWidth="1.8"
            fill="none"
            strokeLinecap="round"
          />
          {/* 4箇所のクラスタ（3色） */}
          {leafCluster(18, 56, 1.0, 'left')}
          {leafCluster(38, 56, 1.0, 'right')}
          {leafCluster(15, 38, 0.85, 'left')}
          {leafCluster(41, 38, 0.85, 'right')}
          {leafCluster(17, 24, 0.7, 'left')}
          {leafCluster(39, 24, 0.7, 'right')}
          <path d="M 26 12 C 25 8 27 4 28 0 C 30 4 31 8 30 12 Z" fill={C.leaf2} />
          <path d="M 27 11 C 26 8 27 5 28 3 C 29 5 30 8 29 11 Z" fill={C.leaf3} />
        </g>
      </g>
      {/* ひよこ */}
      <g className="bob">
        <ellipse cx="62" cy="58" rx="11" ry="9" fill={C.chickBase} />
        <ellipse cx="62" cy="62" rx="10" ry="3" fill={C.chickShade} opacity="0.5" />
        <circle cx="62" cy="44" r="9" fill={C.chickBase} />
        <ellipse cx="55" cy="46" rx="2" ry="1.5" fill={C.cheek} opacity="0.25" />
        <ellipse cx="69" cy="46" rx="2" ry="1.5" fill={C.cheek} opacity="0.25" />
        <circle cx="58" cy="43" r="1.5" fill={C.eye} />
        <circle cx="66" cy="43" r="1.5" fill={C.eye} />
        <circle cx="58" cy="42.4" r="0.5" fill={C.eyeShine} />
        <circle cx="66" cy="42.4" r="0.5" fill={C.eyeShine} />
        <path d="M 62 47 L 65 49 L 62 51 Z" fill={C.beak} />
        <path d="M 58 67 L 58 73" stroke={C.beak} strokeWidth="1.2" strokeLinecap="round" />
        <path d="M 66 67 L 66 73" stroke={C.beak} strokeWidth="1.2" strokeLinecap="round" />
        <path d="M 53 56 C 50 58 50 62 53 64 C 56 63 56 58 53 56 Z" fill={C.chickShade} />
      </g>
    </g>
  );
}

/** ------------------------------------------------------------------ */
/** Stage 3 — 若木（暫定）                                                */
/** ------------------------------------------------------------------ */
function Stage3(): React.ReactElement {
  return (
    <g>
      <ellipse cx="50" cy="86" rx="42" ry="2.5" fill={C.shadow} opacity="0.25" />
      <g className="sway">
        <g className="pop">
          {/* 幹 */}
          <path
            d="M 32 85 C 31 70 33 50 32 26"
            stroke={C.trunk}
            strokeWidth="2.2"
            fill="none"
            strokeLinecap="round"
          />
          {/* 枝 */}
          <path d="M 32 60 C 24 56 16 50 10 46" stroke={C.trunk} strokeWidth="1.5" fill="none" strokeLinecap="round" />
          <path d="M 32 60 C 40 56 48 50 54 46" stroke={C.trunk} strokeWidth="1.5" fill="none" strokeLinecap="round" />
          <path d="M 32 42 C 26 38 22 32 18 26" stroke={C.trunk} strokeWidth="1.4" fill="none" strokeLinecap="round" />
          <path d="M 32 42 C 38 38 42 32 46 26" stroke={C.trunk} strokeWidth="1.4" fill="none" strokeLinecap="round" />
          {/* 葉クラスタ */}
          {leafCluster(10, 44, 1.0, 'left')}
          {leafCluster(54, 44, 1.0, 'right')}
          {leafCluster(18, 24, 0.9, 'left')}
          {leafCluster(46, 24, 0.9, 'right')}
          {leafCluster(32, 18, 1.0, 'right')}
        </g>
      </g>
      {/* 若鳥（茶色） */}
      <g className="bob">
        <ellipse cx="72" cy="68" rx="10" ry="8" fill={C.birdBase} />
        <ellipse cx="72" cy="72" rx="9" ry="3" fill={C.birdBelly} opacity="0.7" />
        <circle cx="72" cy="58" r="7" fill={C.birdMid} />
        <circle cx="69" cy="57" r="1.2" fill={C.eye} />
        <circle cx="75" cy="57" r="1.2" fill={C.eye} />
        <circle cx="69" cy="56.5" r="0.4" fill={C.eyeShine} />
        <circle cx="75" cy="56.5" r="0.4" fill={C.eyeShine} />
        <path d="M 78 59 L 82 60 L 78 61 Z" fill={C.beak} />
        <path d="M 80 68 L 86 66 L 84 72 Z" fill={C.birdBase} />
        <path d="M 68 76 L 68 80" stroke={C.beak} strokeWidth="1.2" strokeLinecap="round" />
        <path d="M 76 76 L 76 80" stroke={C.beak} strokeWidth="1.2" strokeLinecap="round" />
      </g>
    </g>
  );
}

/** ------------------------------------------------------------------ */
/** Stage 4 — 開花（暫定）                                                */
/** ------------------------------------------------------------------ */
function Stage4(): React.ReactElement {
  return (
    <g>
      <ellipse cx="55" cy="96" rx="48" ry="3" fill={C.shadow} opacity="0.25" />
      <g className="sway">
        <g className="pop">
          <path
            d="M 36 95 C 35 76 37 52 36 20"
            stroke={C.trunk}
            strokeWidth="2.8"
            fill="none"
            strokeLinecap="round"
          />
          <path d="M 36 70 C 26 66 14 60 6 56" stroke={C.trunk} strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <path d="M 36 70 C 46 66 58 60 66 56" stroke={C.trunk} strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <path d="M 36 50 C 28 46 22 40 16 32" stroke={C.trunk} strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <path d="M 36 50 C 44 46 50 40 56 32" stroke={C.trunk} strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <path d="M 36 32 C 32 26 30 18 30 12" stroke={C.trunk} strokeWidth="1.4" fill="none" strokeLinecap="round" />
          <path d="M 36 32 C 40 26 42 18 42 12" stroke={C.trunk} strokeWidth="1.4" fill="none" strokeLinecap="round" />
          {leafCluster(6, 54, 1.0, 'left')}
          {leafCluster(66, 54, 1.0, 'right')}
          {leafCluster(16, 30, 0.9, 'left')}
          {leafCluster(56, 30, 0.9, 'right')}
          {leafCluster(30, 10, 0.85, 'left')}
          {leafCluster(42, 10, 0.85, 'right')}
          {leafCluster(36, 4, 0.95, 'right')}
          {/* 花 */}
          {flower(12, 50)}
          {flower(60, 50)}
          {flower(22, 28)}
          {flower(50, 28)}
          {flower(30, 14)}
          {flower(42, 14)}
        </g>
      </g>
      {/* 鳥つがい */}
      <g className="bob">
        {smallBird(82, 70, 'right')}
        {smallBird(98, 80, 'left')}
      </g>
    </g>
  );
}

/** ------------------------------------------------------------------ */
/** Stage 5 — 巣づくり（暫定）                                             */
/** ------------------------------------------------------------------ */
function Stage5(): React.ReactElement {
  return (
    <g>
      <ellipse cx="58" cy="106" rx="52" ry="3" fill={C.shadow} opacity="0.25" />
      <g className="sway">
        <g className="pop">
          <path
            d="M 40 105 C 39 80 41 50 40 12"
            stroke={C.trunk}
            strokeWidth="3.2"
            fill="none"
            strokeLinecap="round"
          />
          <path d="M 40 78 C 28 74 14 68 4 64" stroke={C.trunk} strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M 40 78 C 52 74 66 68 76 64" stroke={C.trunk} strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M 40 56 C 30 52 22 44 16 36" stroke={C.trunk} strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <path d="M 40 56 C 50 52 58 44 64 36" stroke={C.trunk} strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <path d="M 40 36 C 34 30 30 22 28 14" stroke={C.trunk} strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <path d="M 40 36 C 46 30 50 22 52 14" stroke={C.trunk} strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <path d="M 40 16 C 40 10 40 6 40 2" stroke={C.trunk} strokeWidth="1.4" fill="none" strokeLinecap="round" />
          {leafCluster(4, 62, 1.05, 'left')}
          {leafCluster(76, 62, 1.05, 'right')}
          {leafCluster(16, 34, 1.0, 'left')}
          {leafCluster(64, 34, 1.0, 'right')}
          {leafCluster(28, 12, 0.9, 'left')}
          {leafCluster(52, 12, 0.9, 'right')}
          {leafCluster(40, 0, 1.0, 'right')}
          {flower(10, 58)}
          {flower(70, 58)}
          {flower(22, 32)}
          {flower(58, 32)}
          {flower(40, 4)}
          {/* 巣 (枝の上に) */}
          <path
            d="M 70 50 C 73 46 76 44 80 44 C 84 44 87 46 90 50"
            stroke={C.nestDark}
            strokeWidth="1.8"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M 70 50 C 72 53 76 55 80 55 C 84 55 88 53 90 50"
            stroke={C.nestDark}
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
          {/* 卵 3個 */}
          <ellipse cx="76" cy="48" rx="2.5" ry="3" fill={C.eggShell} />
          <ellipse cx="80" cy="47.5" rx="2.5" ry="3" fill={C.eggShell} />
          <ellipse cx="84" cy="48" rx="2.5" ry="3" fill={C.eggShell} />
        </g>
      </g>
      {/* 鳥 2羽 */}
      <g className="bob">
        {smallBird(94, 50, 'left')}
        {smallBird(60, 80, 'right')}
      </g>
    </g>
  );
}

/** ------------------------------------------------------------------ */
/** Stage 6 — NEST 完成（暫定）                                           */
/** ------------------------------------------------------------------ */
function Stage6(): React.ReactElement {
  return (
    <g>
      <ellipse cx="60" cy="111" rx="55" ry="3" fill={C.shadow} opacity="0.25" />
      <g className="sway">
        <g className="pop">
          <path
            d="M 42 110 C 41 80 43 48 42 8"
            stroke={C.trunk}
            strokeWidth="3.8"
            fill="none"
            strokeLinecap="round"
          />
          <path d="M 42 82 C 28 78 12 70 0 66" stroke={C.trunk} strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <path d="M 42 82 C 56 78 72 70 84 66" stroke={C.trunk} strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <path d="M 42 60 C 30 56 20 46 12 36" stroke={C.trunk} strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M 42 60 C 54 56 64 46 72 36" stroke={C.trunk} strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M 42 40 C 34 32 28 22 24 12" stroke={C.trunk} strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <path d="M 42 40 C 50 32 56 22 60 12" stroke={C.trunk} strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <path d="M 42 18 C 40 12 38 6 38 2" stroke={C.trunk} strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <path d="M 42 18 C 44 12 46 6 46 2" stroke={C.trunk} strokeWidth="1.6" fill="none" strokeLinecap="round" />
          {leafCluster(0, 64, 1.1, 'left')}
          {leafCluster(84, 64, 1.1, 'right')}
          {leafCluster(12, 34, 1.0, 'left')}
          {leafCluster(72, 34, 1.0, 'right')}
          {leafCluster(24, 10, 0.95, 'left')}
          {leafCluster(60, 10, 0.95, 'right')}
          {leafCluster(42, -2, 1.05, 'right')}
          {leafCluster(38, 0, 0.85, 'left')}
          {flower(8, 60)}
          {flower(78, 60)}
          {flower(18, 30)}
          {flower(66, 30)}
          {flower(30, 6)}
          {flower(54, 6)}
          {flower(42, -4)}
          {/* 巣（枝の上） */}
          <path
            d="M 70 56 C 74 52 78 50 84 50 C 90 50 94 52 98 56"
            stroke={C.nestDark}
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M 70 56 C 73 60 78 62 84 62 C 90 62 95 60 98 56"
            stroke={C.nestDark}
            strokeWidth="2.2"
            fill="none"
            strokeLinecap="round"
          />
          {/* 雛 3 羽 */}
          {[76, 84, 92].map((x, i) => (
            <g key={i}>
              <ellipse cx={x} cy="52" rx="3" ry="2.5" fill={C.chickBase} />
              <circle cx={x} cy="50" r="2.5" fill={C.chickBase} />
              <circle cx={x - 0.8} cy="49.7" r="0.4" fill={C.eye} />
              <circle cx={x + 0.8} cy="49.7" r="0.4" fill={C.eye} />
              <path d={`M ${x + 2.5} 50.5 L ${x + 4} 51 L ${x + 2.5} 51.5 Z`} fill={C.beak} />
            </g>
          ))}
        </g>
      </g>
      {/* 親鳥（枝に止まる） */}
      <g className="bob">
        {smallBird(102, 60, 'left')}
      </g>
      {/* 飛ぶ鳥（翼を広げた） */}
      <g>
        <ellipse cx="20" cy="20" rx="4" ry="2.5" fill={C.birdBase} />
        <path d="M 16 20 C 12 16 8 16 6 18 C 10 20 14 20 16 20 Z" fill={C.birdMid} />
        <path d="M 24 20 C 28 16 32 16 34 18 C 30 20 26 20 24 20 Z" fill={C.birdMid} />
        <path d="M 23 19 L 25 19 L 23 20 Z" fill={C.beak} />
      </g>
    </g>
  );
}

/** ------------------------------------------------------------------ */
/** Helpers                                                            */
/** ------------------------------------------------------------------ */

/** 3色レイヤの葉クラスター（同方向） */
function leafCluster(cx: number, cy: number, scale: number, dir: 'left' | 'right'): React.ReactElement {
  const offsets: Array<[number, number]> = dir === 'left' ? [[-2, -2], [0, 0], [2, 2]] : [[2, -2], [0, 0], [-2, 2]];
  const colors = [C.leaf1, C.leaf2, C.leaf3];
  const w = 9 * scale;
  const h = 6 * scale;
  return (
    <g key={`lc-${cx}-${cy}`}>
      {colors.map((color, i) => {
        const x = cx + offsets[i][0] * scale;
        const y = cy + offsets[i][1] * scale;
        const d =
          dir === 'left'
            ? `M ${x} ${y} C ${x - w} ${y - h * 0.5} ${x - w} ${y + h * 0.5} ${x - w * 0.3} ${y + h * 0.7} C ${x - w * 0.1} ${y + h * 0.5} ${x} ${y + h * 0.3} ${x} ${y} Z`
            : `M ${x} ${y} C ${x + w} ${y - h * 0.5} ${x + w} ${y + h * 0.5} ${x + w * 0.3} ${y + h * 0.7} C ${x + w * 0.1} ${y + h * 0.5} ${x} ${y + h * 0.3} ${x} ${y} Z`;
        return <path key={i} d={d} fill={color} />;
      })}
    </g>
  );
}

/** 花 */
function flower(cx: number, cy: number): React.ReactElement {
  return (
    <g key={`fl-${cx}-${cy}`}>
      <circle cx={cx} cy={cy} r="2.2" fill={C.flower} opacity="0.85" />
      <circle cx={cx} cy={cy} r="0.8" fill={C.flowerCenter} />
    </g>
  );
}

/** 小型の成鳥 */
function smallBird(cx: number, cy: number, facing: 'left' | 'right'): React.ReactElement {
  const dir = facing === 'right' ? 1 : -1;
  return (
    <g key={`bird-${cx}-${cy}`} transform={facing === 'left' ? `translate(${cx * 2} 0) scale(-1 1)` : undefined}>
      <ellipse cx={cx} cy={cy} rx="7" ry="5.5" fill={C.birdBase} />
      <ellipse cx={cx - 1} cy={cy + 1.5} rx="5.5" ry="2.5" fill={C.birdBelly} opacity="0.85" />
      <circle cx={cx + 4} cy={cy - 3} r="4.5" fill={C.birdMid} />
      <circle cx={cx + 5} cy={cy - 3.5} r="0.9" fill={C.eye} />
      <circle cx={cx + 5} cy={cy - 3.8} r="0.3" fill={C.eyeShine} />
      <path d={`M ${cx + 8} ${cy - 3} L ${cx + 11} ${cy - 2.5} L ${cx + 8} ${cy - 2} Z`} fill={C.beak} />
      <path d={`M ${cx - 7} ${cy + 1} L ${cx - 11} ${cy} L ${cx - 8} ${cy + 4} Z`} fill={C.birdBase} />
    </g>
  );
}
