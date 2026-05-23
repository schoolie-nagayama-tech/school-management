'use client';

/**
 * バッジ獲得進捗を「巣のはじまり → 大樹と鳥の家族」の成長物語で表現するSVGシーン。
 * システム名 NEST にちなみ、最終的に鳥の家族が住む巣ができる構成。
 *
 * デザイン: ベジェ曲線で描いた葉に2層フィル（ベース + ハイライト）を重ねる
 * 自然なイラスト調。背景は描かず、優しい朝の光のような彩度を維持。
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

// 参考画像から起こした自然系パレット
const C = {
  // 幹・茎（やや赤みを帯びた焦茶）
  trunk: '#4E342E',
  trunkMid: '#795548',
  trunkLight: '#8D6E63',
  // 葉（4階調）
  leafDark: '#558B2F',
  leafBase: '#7CB342',
  leafLight: '#9CCC65',
  leafShine: '#C5E1A5',
  // 卵
  eggShell: '#F5F0E0',
  eggShine: '#FBF8F0',
  eggSpec1: '#C8B898',
  eggSpec2: '#C0B088',
  // 鳥（kawaii調を維持）
  bird: '#fcd34d',
  birdShade: '#f59e0b',
  wing: '#d97706',
  beak: '#fb923c',
  eye: '#1f2937',
  eyeShine: '#ffffff',
  // 巣
  nestOuter: '#795548',
  nestInner: '#8D6E63',
  // 花
  flower: '#fbcfe8',
  flowerCenter: '#ec4899',
  flowerHeart: '#fef9c3',
  // 地面影
  ground: '#8D6E63',
};

/** たまご型の葉 path — ベジェ曲線 */
function leafPath(cx: number, cy: number, w: number, h: number, contract = 0): string {
  const wc = w * (1 - contract);
  const hc = h * (1 - contract);
  return (
    `M ${cx} ${cy - hc} ` +
    `C ${cx - wc * 0.9} ${cy - hc * 0.55} ` +
    `${cx - wc} ${cy + hc * 0.2} ` +
    `${cx} ${cy + hc} ` +
    `C ${cx + wc} ${cy + hc * 0.2} ` +
    `${cx + wc * 0.9} ${cy - hc * 0.55} ` +
    `${cx} ${cy - hc} Z`
  );
}

/** 葉 — ベース + ハイライトの2層 */
interface LeafProps {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
  base?: string;
}
function Leaf({ cx, cy, w, h, rot, base = C.leafBase }: LeafProps) {
  return (
    <g transform={`rotate(${rot} ${cx} ${cy})`}>
      <path d={leafPath(cx, cy, w, h)} fill={base} />
      <path d={leafPath(cx, cy, w, h, 0.3)} fill={C.leafLight} opacity="0.55" />
    </g>
  );
}

/** 葉のクラスタ — 中央点まわりに8-10枚配置 */
function leafCluster(cx: number, cy: number, scale = 1, keyPrefix = ''): React.ReactElement {
  const config: Array<[number, number, number, number, number, string]> = [
    // [dx, dy, w, h, rot, color]
    [-3.5, 2, 3, 5.5, -55, C.leafBase],
    [3.5, 2, 3, 5.5, 55, C.leafBase],
    [-1.8, -3.8, 2.8, 5, -20, C.leafBase],
    [1.8, -3.8, 2.8, 5, 20, C.leafBase],
    [0, 4, 2.8, 5, 0, C.leafBase],
    [-4.4, -0.8, 2.5, 4.5, -80, C.leafLight],
    [4.4, -0.8, 2.5, 4.5, 80, C.leafLight],
    [0, -5.3, 3, 5, 0, C.leafLight],
    [-1, 0, 2.2, 4, -30, C.leafLight],
    [1, 0, 2.2, 4, 30, C.leafLight],
  ];
  return (
    <g>
      {config.map(([dx, dy, w, h, rot, base], i) => (
        <Leaf
          key={`${keyPrefix}${i}`}
          cx={cx + dx * scale}
          cy={cy + dy * scale}
          w={w * scale}
          h={h * scale}
          rot={rot}
          base={base}
        />
      ))}
    </g>
  );
}

export function GrowthScene({ earned, total, className = '' }: GrowthSceneProps) {
  const stage = getStage(earned, total);

  return (
    <svg
      viewBox="0 0 300 120"
      className={`w-full h-auto growth-scene ${className}`}
      preserveAspectRatio="xMidYMax meet"
      aria-label={`成長ステージ: ${STAGE_LABELS[stage]}`}
      role="img"
    >
      <style>{`
        .growth-scene .pop { animation: gs-pop .85s cubic-bezier(.34,1.56,.64,1) both; transform-box: fill-box; }
        .growth-scene .sway { animation: gs-sway 6.5s ease-in-out 1s infinite; transform-box: fill-box; }
        .growth-scene .bird-bob { animation: gs-bob 3.4s ease-in-out infinite; }
        .growth-scene .egg-rock { animation: gs-rock 7s ease-in-out 2.5s infinite; transform-box: fill-box; }
        @keyframes gs-pop { 0% { transform: scaleY(0) scaleX(.6); opacity: 0; } 100% { transform: scaleY(1) scaleX(1); opacity: 1; } }
        @keyframes gs-sway { 0%,100% { transform: rotate(-.5deg); } 50% { transform: rotate(.5deg); } }
        @keyframes gs-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-1.5px); } }
        @keyframes gs-rock { 0%,80%,100% { transform: rotate(0); } 84% { transform: rotate(2deg); } 88% { transform: rotate(-1.2deg); } 91% { transform: rotate(.6deg); } 94% { transform: rotate(0); } }
        @media (prefers-reduced-motion: reduce) {
          .growth-scene .pop, .growth-scene .sway, .growth-scene .bird-bob, .growth-scene .egg-rock { animation: none; }
        }
      `}</style>

      {/* 地面影 */}
      <ellipse cx="150" cy="113" rx="90" ry="2.5" fill={C.ground} opacity="0.12" />

      {/* 植物 — pop で立ち上がり、sway で揺れ */}
      <g
        className="sway"
        style={{ transformOrigin: `${plantOrigin(stage)} 110px` } as CSSProperties}
      >
        <g className="pop" style={{ transformOrigin: `${plantOrigin(stage)} 110px` } as CSSProperties}>
          {renderPlant(stage)}
        </g>
      </g>

      {/* 鳥・卵・巣 */}
      <g className={stage === 0 || stage === 1 ? 'egg-rock' : stage >= 2 && stage <= 4 ? 'bird-bob' : undefined}
         style={
           stage === 0 || stage === 1
             ? ({ transformOrigin: '215px 105px' } as CSSProperties)
             : undefined
         }
      >
        {renderBirdScene(stage)}
      </g>
    </svg>
  );
}

function plantOrigin(stage: number): string {
  // 序盤は芽の生え際、後期は幹の根元を回転中心に
  if (stage <= 2) return '100px';
  return '100px';
}

/** ステージごとの植物 */
function renderPlant(stage: number): React.ReactElement | null {
  if (stage === 0) {
    // 双葉 — 参考画像をそのままシーン座標系へ移植
    return (
      <g>
        {/* 茎（やや傾く） */}
        <path
          d="M 100 110 C 98 100 102 90 99 80"
          stroke={C.trunk}
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
        />
        {/* 左の双葉（大きい） */}
        <path
          d="M 99 82 C 88 70 72 56 60 58 C 62 70 82 86 99 84 Z"
          fill={C.leafBase}
        />
        <path
          d="M 99 82 C 90 72 76 60 66 62 C 68 72 86 84 99 84 Z"
          fill={C.leafLight}
          opacity="0.55"
        />
        <path
          d="M 98 83 C 86 74 72 66 64 62"
          stroke={C.leafDark}
          strokeWidth="0.55"
          fill="none"
          strokeLinecap="round"
          opacity="0.4"
        />
        {/* 右の双葉（小さい） */}
        <path
          d="M 101 84 C 110 74 124 66 132 70 C 128 80 114 90 101 86 Z"
          fill={C.leafBase}
        />
        <path
          d="M 101 84 C 108 76 120 70 126 72 C 124 80 114 88 101 86 Z"
          fill={C.leafLight}
          opacity="0.55"
        />
        <path
          d="M 101 85 C 110 78 122 72 128 72"
          stroke={C.leafDark}
          strokeWidth="0.5"
          fill="none"
          strokeLinecap="round"
          opacity="0.4"
        />
        {/* 新芽のつぼみ */}
        <path
          d="M 98 80 C 96 74 98 68 100 64 C 102 68 102 74 101 80 Z"
          fill={C.leafLight}
        />
        <path
          d="M 99 78 C 98 74 98.5 70 100 67 C 101 70 101 74 100.5 78 Z"
          fill={C.leafShine}
          opacity="0.55"
        />
      </g>
    );
  }
  if (stage === 1) {
    // 若芽 — 茎伸びて新芽が開く
    return (
      <g>
        <path
          d="M 100 110 C 99 100 101 88 100 72"
          stroke={C.trunk}
          strokeWidth="1.7"
          fill="none"
          strokeLinecap="round"
        />
        {/* 双葉（広がった姿） */}
        <path d="M 99 84 C 88 76 72 64 58 66 C 60 76 82 88 99 86 Z" fill={C.leafBase} />
        <path d="M 99 84 C 90 78 76 68 64 70 C 66 78 84 86 99 86 Z" fill={C.leafLight} opacity="0.55" />
        <path d="M 101 86 C 112 78 128 70 134 74 C 130 84 116 92 101 88 Z" fill={C.leafBase} />
        <path d="M 101 86 C 110 80 124 74 128 76 C 126 82 116 88 101 88 Z" fill={C.leafLight} opacity="0.55" />
        {/* 上の新芽（開きはじめ） */}
        <Leaf cx={95} cy={68} w={3.2} h={6} rot={-30} base={C.leafBase} />
        <Leaf cx={105} cy={68} w={3.2} h={6} rot={30} base={C.leafBase} />
        <Leaf cx={100} cy={62} w={3} h={5.5} rot={0} base={C.leafLight} />
      </g>
    );
  }
  if (stage === 2) {
    // 茂み — 茎にクラスタ2つ
    return (
      <g>
        <path
          d="M 100 110 C 99 96 101 80 100 62"
          stroke={C.trunkMid}
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 100 92 C 92 86 84 80 78 76"
          stroke={C.trunkMid}
          strokeWidth="1.4"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 100 92 C 108 86 116 80 122 76"
          stroke={C.trunkMid}
          strokeWidth="1.4"
          fill="none"
          strokeLinecap="round"
        />
        {leafCluster(78, 74, 0.85, 'l-')}
        {leafCluster(122, 74, 0.85, 'r-')}
        {leafCluster(100, 60, 0.95, 't-')}
      </g>
    );
  }
  if (stage === 3) {
    // 茂み大 — 細い茶幹が見え始める
    return (
      <g>
        <path
          d="M 100 110 C 98 95 102 80 100 60"
          stroke={C.trunk}
          strokeWidth="2.6"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 100 90 C 92 82 80 76 70 70"
          stroke={C.trunkMid}
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 100 86 C 110 78 122 72 130 68"
          stroke={C.trunkMid}
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 100 72 C 96 64 92 56 90 50"
          stroke={C.trunkMid}
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
        {leafCluster(70, 68, 0.95, 'l-')}
        {leafCluster(130, 66, 0.95, 'r-')}
        {leafCluster(90, 48, 0.9, 'lt-')}
        {leafCluster(100, 56, 1.05, 'c-')}
      </g>
    );
  }
  if (stage === 4) {
    // 苗木 — 焦茶の幹が明確に
    return (
      <g>
        <path
          d="M 100 110 C 98 86 102 64 101 44"
          stroke={C.trunk}
          strokeWidth="3.6"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 100 84 C 90 76 78 70 64 64"
          stroke={C.trunk}
          strokeWidth="2.4"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 101 76 C 112 70 124 64 138 60"
          stroke={C.trunk}
          strokeWidth="2.4"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 101 60 C 94 50 88 42 84 34"
          stroke={C.trunk}
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 101 50 C 110 42 116 34 122 28"
          stroke={C.trunk}
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
        {leafCluster(64, 62, 1, 'l-')}
        {leafCluster(138, 58, 1, 'r-')}
        {leafCluster(84, 32, 0.95, 'lt-')}
        {leafCluster(122, 26, 0.95, 'rt-')}
        {leafCluster(101, 30, 1.05, 'c-')}
      </g>
    );
  }
  if (stage === 5) {
    // 若木に花
    return (
      <g>
        <path
          d="M 100 110 C 98 80 102 50 102 28"
          stroke={C.trunk}
          strokeWidth="4.8"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 100 86 C 86 76 70 68 54 62"
          stroke={C.trunk}
          strokeWidth="3.2"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 102 76 C 116 68 132 62 146 56"
          stroke={C.trunk}
          strokeWidth="3.2"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 102 56 C 94 44 86 34 80 26"
          stroke={C.trunk}
          strokeWidth="2.6"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 102 46 C 110 36 118 28 124 20"
          stroke={C.trunk}
          strokeWidth="2.6"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 102 30 C 100 24 102 18 102 12"
          stroke={C.trunk}
          strokeWidth="2.3"
          fill="none"
          strokeLinecap="round"
        />
        {leafCluster(54, 60, 1.1, 'l-')}
        {leafCluster(146, 54, 1.1, 'r-')}
        {leafCluster(80, 24, 1, 'lt-')}
        {leafCluster(124, 18, 1, 'rt-')}
        {leafCluster(102, 10, 1.1, 'top-')}
        {leafCluster(94, 50, 0.95, 'mid-l-')}
        {leafCluster(118, 44, 0.95, 'mid-r-')}
        {renderFlowers([[60, 56], [142, 50], [86, 22], [120, 16], [102, 6], [98, 46]])}
      </g>
    );
  }
  // Stage 6 — 大樹
  return (
    <g>
      <path
        d="M 100 110 C 97 76 103 44 102 18"
        stroke={C.trunk}
        strokeWidth="5.8"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M 100 90 C 84 80 64 70 46 64"
        stroke={C.trunk}
        strokeWidth="3.8"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M 102 82 C 120 72 140 64 156 58"
        stroke={C.trunk}
        strokeWidth="3.8"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M 102 64 C 92 52 78 40 68 30"
        stroke={C.trunk}
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M 102 54 C 116 42 130 30 138 18"
        stroke={C.trunk}
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M 102 38 C 96 28 92 20 90 10"
        stroke={C.trunk}
        strokeWidth="2.6"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M 102 30 C 108 22 114 14 116 8"
        stroke={C.trunk}
        strokeWidth="2.6"
        fill="none"
        strokeLinecap="round"
      />
      {leafCluster(46, 62, 1.15, 'l-')}
      {leafCluster(156, 56, 1.15, 'r-')}
      {leafCluster(68, 28, 1.05, 'lt-')}
      {leafCluster(138, 16, 1.05, 'rt-')}
      {leafCluster(90, 8, 1.05, 'tl-')}
      {leafCluster(116, 6, 1.05, 'tr-')}
      {leafCluster(102, 4, 1.15, 'top-')}
      {leafCluster(80, 50, 0.95, 'mid-l-')}
      {leafCluster(128, 42, 0.95, 'mid-r-')}
      {leafCluster(102, 26, 1.05, 'cmid-')}
      {renderFlowers([
        [52, 58], [150, 52], [74, 26], [134, 14], [94, 6], [114, 4],
        [102, 0], [86, 48], [124, 40], [102, 22],
      ])}
    </g>
  );
}

/** 花 — 3層構造 */
function renderFlowers(positions: Array<[number, number]>): React.ReactElement {
  return (
    <g>
      {positions.map(([cx, cy], i) => (
        <g key={i}>
          <circle cx={cx} cy={cy} r="3.2" fill={C.flower} />
          <circle cx={cx} cy={cy} r="1.5" fill={C.flowerCenter} />
          <circle cx={cx} cy={cy} r="0.55" fill={C.flowerHeart} />
        </g>
      ))}
    </g>
  );
}

/** ステージごとの鳥と巣 */
function renderBirdScene(stage: number): React.ReactElement {
  if (stage === 0) {
    // 巣の中の卵（参考画像のスタイル）
    return (
      <g>
        {/* 巣 */}
        <path
          d="M 201 108 C 205 100 209 96 215 96 C 221 96 225 100 229 108"
          stroke={C.nestOuter}
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 203 109 C 207 103 211 100 215 100 C 219 100 223 103 227 109"
          stroke={C.nestInner}
          strokeWidth="1.3"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 201 108 C 203 111 209 114 215 114 C 221 114 227 111 229 108"
          stroke={C.nestOuter}
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
        {/* 卵 */}
        <path
          d="M 215 90 C 222 90 227 95 227 103 C 227 109 223 113 215 113 C 207 113 203 109 203 103 C 203 95 208 90 215 90 Z"
          fill={C.eggShell}
        />
        <path
          d="M 212 92 C 217 91 221 94 223 99 C 224 102 222 106 219 107 C 216 108 213 106 212 102 C 211 98 211 94 212 92 Z"
          fill={C.eggShine}
          opacity="0.5"
        />
        {/* 斑点 */}
        <circle cx="209" cy="98" r="0.8" fill={C.eggSpec1} opacity="0.35" />
        <circle cx="220" cy="96" r="0.55" fill={C.eggSpec2} opacity="0.3" />
        <circle cx="222" cy="102" r="0.7" fill={C.eggSpec1} opacity="0.25" />
        <circle cx="210" cy="104" r="0.6" fill={C.eggSpec2} opacity="0.2" />
      </g>
    );
  }
  if (stage === 1) {
    // 卵にひび、ひよこの顔がのぞく
    return (
      <g>
        {/* 巣 */}
        <path d="M 201 108 C 205 100 209 96 215 96 C 221 96 225 100 229 108" stroke={C.nestOuter} strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M 201 108 C 203 111 209 114 215 114 C 221 114 227 111 229 108" stroke={C.nestOuter} strokeWidth="2" fill="none" strokeLinecap="round" />
        {/* 卵下半分 */}
        <path
          d="M 215 96 C 222 96 227 99 227 103 C 227 109 223 113 215 113 C 207 113 203 109 203 103 C 203 99 208 96 215 96 Z"
          fill={C.eggShell}
        />
        {/* ひびのジグザグ */}
        <path
          d="M 204 98 L 207 100 L 210 96 L 213 99 L 216 95 L 219 99 L 222 96 L 225 99 L 227 97"
          stroke={C.eggSpec1}
          strokeWidth="0.7"
          fill="none"
          strokeLinecap="round"
        />
        {/* ひよこ頭 */}
        <circle cx="215" cy="93" r="7" fill={C.bird} />
        <circle cx="212" cy="92" r="1.4" fill={C.eye} />
        <circle cx="218" cy="92" r="1.4" fill={C.eye} />
        <circle cx="212" cy="91.3" r="0.5" fill={C.eyeShine} />
        <circle cx="218" cy="91.3" r="0.5" fill={C.eyeShine} />
        <polygon points="221,94 225,95 221,96" fill={C.beak} />
        {/* 頬の赤み */}
        <circle cx="208" cy="95" r="1.2" fill="#fda4af" opacity="0.6" />
        <circle cx="222" cy="95" r="1.2" fill="#fda4af" opacity="0.6" />
      </g>
    );
  }
  if (stage === 2) {
    // 立ち上がったひよこ + 卵殻の破片
    return (
      <g>
        {/* 卵殻 */}
        <path d="M 232 110 C 236 105 240 107 242 110 L 232 112 Z" fill={C.eggShell} />
        <path d="M 200 110 C 196 106 192 108 192 111 L 200 112 Z" fill={C.eggShell} />
        {/* ひよこ */}
        <ellipse cx="215" cy="100" rx="11" ry="9" fill={C.bird} />
        <ellipse cx="215" cy="105" rx="10" ry="3" fill={C.birdShade} opacity="0.3" />
        <circle cx="215" cy="86" r="10" fill={C.bird} />
        <circle cx="211" cy="85" r="1.6" fill={C.eye} />
        <circle cx="219" cy="85" r="1.6" fill={C.eye} />
        <circle cx="211" cy="84.3" r="0.6" fill={C.eyeShine} />
        <circle cx="219" cy="84.3" r="0.6" fill={C.eyeShine} />
        <polygon points="223,88 228,89 223,90" fill={C.beak} />
        <circle cx="206" cy="89" r="1.5" fill="#fda4af" opacity="0.6" />
        <circle cx="224" cy="89" r="1.5" fill="#fda4af" opacity="0.6" />
        <ellipse cx="206" cy="100" rx="3.5" ry="5" fill={C.birdShade} transform="rotate(-15 206 100)" />
        <path d="M 210 109 L 210 113 M 208 113 L 212 113" stroke={C.beak} strokeWidth="1.6" strokeLinecap="round" fill="none" />
        <path d="M 220 109 L 220 113 M 218 113 L 222 113" stroke={C.beak} strokeWidth="1.6" strokeLinecap="round" fill="none" />
      </g>
    );
  }
  if (stage === 3) {
    // 子鳥
    return (
      <g>
        <ellipse cx="215" cy="98" rx="12" ry="10" fill={C.bird} />
        <circle cx="215" cy="83" r="9" fill={C.bird} />
        <circle cx="211" cy="82" r="1.7" fill={C.eye} />
        <circle cx="219" cy="82" r="1.7" fill={C.eye} />
        <circle cx="211" cy="81.2" r="0.6" fill={C.eyeShine} />
        <circle cx="219" cy="81.2" r="0.6" fill={C.eyeShine} />
        <polygon points="223,85 228,86 223,87" fill={C.beak} />
        <path d="M 206 94 C 200 98 204 108 210 105 C 211 100 210 96 206 94 Z" fill={C.wing} />
        <path d="M 226 98 L 233 95 L 230 102 Z" fill={C.wing} />
        <path d="M 210 108 L 210 113 M 208 113 L 212 113" stroke={C.beak} strokeWidth="1.6" strokeLinecap="round" fill="none" />
        <path d="M 220 108 L 220 113 M 218 113 L 222 113" stroke={C.beak} strokeWidth="1.6" strokeLinecap="round" fill="none" />
      </g>
    );
  }
  if (stage === 4) {
    // 親鳥になりつつ — 枝にとまる
    return (
      <g transform="translate(215, 78)">
        <ellipse cx="0" cy="7" rx="12" ry="9" fill={C.bird} />
        <circle cx="0" cy="-4" r="8" fill={C.bird} />
        <circle cx="-3" cy="-5" r="1.6" fill={C.eye} />
        <circle cx="3" cy="-5" r="1.6" fill={C.eye} />
        <circle cx="-3" cy="-5.7" r="0.6" fill={C.eyeShine} />
        <circle cx="3" cy="-5.7" r="0.6" fill={C.eyeShine} />
        <polygon points="7,-2 12,-1 7,0" fill={C.beak} />
        <path d="M -4 -1 C -12 2 -10 11 -3 8 C -2 4 -3 0 -4 -1 Z" fill={C.wing} />
        <path d="M -11 6 L -18 4 L -15 12 Z" fill={C.wing} />
        <path d="M -3 15 L -3 18" stroke={C.beak} strokeWidth="1.6" strokeLinecap="round" />
        <path d="M 3 15 L 3 18" stroke={C.beak} strokeWidth="1.6" strokeLinecap="round" />
      </g>
    );
  }
  if (stage === 5) {
    // 小さな巣＋親鳥（巣作り）
    return (
      <g>
        {/* 巣 */}
        <path d="M 200 72 C 205 64 211 60 215 60 C 219 60 225 64 230 72" stroke={C.nestOuter} strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M 202 73 C 207 67 211 64 215 64 C 219 64 223 67 228 73" stroke={C.nestInner} strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <path d="M 200 72 C 203 75 209 78 215 78 C 221 78 227 75 230 72" stroke={C.nestOuter} strokeWidth="2" fill="none" strokeLinecap="round" />
        {/* 親鳥 */}
        <g transform="translate(232, 56)">
          <ellipse cx="0" cy="6" rx="11" ry="8" fill={C.bird} />
          <circle cx="0" cy="-4" r="7.5" fill={C.bird} />
          <circle cx="-3" cy="-5" r="1.5" fill={C.eye} />
          <circle cx="3" cy="-5" r="1.5" fill={C.eye} />
          <circle cx="-3" cy="-5.6" r="0.5" fill={C.eyeShine} />
          <circle cx="3" cy="-5.6" r="0.5" fill={C.eyeShine} />
          <polygon points="6,-2 11,-1 6,0" fill={C.beak} />
          <path d="M -4 -1 C -11 1 -9 9 -2 6 C -1 3 -3 0 -4 -1 Z" fill={C.wing} />
          <path d="M -10 5 L -17 3 L -14 10 Z" fill={C.wing} />
        </g>
        {/* 鳥がくわえている小枝 */}
        <path d="M 240 50 L 250 48" stroke={C.trunkMid} strokeWidth="1.2" strokeLinecap="round" />
      </g>
    );
  }
  // Stage 6 — 巣に家族
  return (
    <g>
      {/* 大きな巣 */}
      <path d="M 195 60 C 202 50 210 46 215 46 C 220 46 228 50 235 60" stroke={C.nestOuter} strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M 198 62 C 204 53 210 50 215 50 C 220 50 226 53 232 62" stroke={C.nestInner} strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <path d="M 195 60 C 198 64 206 68 215 68 C 224 68 232 64 235 60" stroke={C.nestOuter} strokeWidth="2.2" fill="none" strokeLinecap="round" />
      {/* 巣の質感 */}
      <g stroke={C.nestOuter} strokeWidth="0.8" fill="none" strokeLinecap="round" opacity="0.5">
        <path d="M 200 60 C 206 62 213 60 218 62" />
        <path d="M 213 58 C 220 60 226 58 230 60" />
      </g>
      {/* 親鳥（巣の右端にとまる） */}
      <g transform="translate(238, 48)">
        <ellipse cx="0" cy="6" rx="11" ry="8.5" fill={C.bird} />
        <circle cx="0" cy="-4" r="8" fill={C.bird} />
        <circle cx="-3" cy="-5" r="1.6" fill={C.eye} />
        <circle cx="3" cy="-5" r="1.6" fill={C.eye} />
        <circle cx="-3" cy="-5.7" r="0.6" fill={C.eyeShine} />
        <circle cx="3" cy="-5.7" r="0.6" fill={C.eyeShine} />
        <polygon points="7,-2 13,-1 7,0" fill={C.beak} />
        <path d="M -4 -1 C -12 2 -10 11 -3 8 C -2 4 -3 0 -4 -1 Z" fill={C.wing} />
        <path d="M -11 6 L -18 4 L -15 12 Z" fill={C.wing} />
      </g>
      {/* 雛たち */}
      {[200, 210, 220].map((x, i) => (
        <g key={i} transform={`translate(${x}, 56)`}>
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
