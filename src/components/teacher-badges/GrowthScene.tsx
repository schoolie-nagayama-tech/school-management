'use client';

/**
 * バッジ獲得進捗を「巣のはじまり → 大樹と鳥の家族」の成長物語で表現するSVGシーン。
 * システム名 NEST にちなみ、最終的に鳥の家族が住む巣ができる構成。
 *
 * デザイン方針: 背景は描かず、デフォルメ＋フラット塗りで植物と鳥に集中する。
 *
 * Stage の刻み:
 *   0   : 0個 — 卵
 *   1   : 〜15% — 卵が割れる + 芽吹き
 *   2   : 〜30% — 若芽 + ひよこ
 *   3   : 〜55% — 苗木 + 子鳥
 *   4   : 〜75% — 若木 + 鳥
 *   5   : 〜95% — 花咲く木 + 巣
 *   6   : 95%〜 — 大樹 + 鳥の家族
 */

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

// パレット — depositphotos 風の自然な木テイスト
const C = {
  // 葉 — 2トーンで奥行き
  leafLight: '#9ccc65',
  leafDark: '#558b2f',
  // ステム（若い頃の緑色の茎）
  stem: '#7cb342',
  stemDark: '#558b2f',
  // 幹 — 落ち着いた焦茶
  trunk: '#5d4037',
  trunkDark: '#3e2723',
  // 鳥（変更なし、kawaii調）
  bird: '#fcd34d',
  birdShade: '#f59e0b',
  wing: '#d97706',
  beak: '#fb923c',
  eye: '#1f2937',
  eyeShine: '#ffffff',
  eggShell: '#fef3c7',
  eggDot: '#fbbf24',
  // 巣
  nest: '#8d6e63',
  nestDark: '#5d4037',
  // 花
  flower: '#fbcfe8',
  flowerCenter: '#ec4899',
  flowerHeart: '#fef9c3',
};

/** 一枚の葉 — 縦長楕円を回転 */
function leaf(
  cx: number,
  cy: number,
  size: number,
  rot: number,
  color: string,
  key?: number | string,
): React.ReactElement {
  return (
    <ellipse
      key={key}
      cx={cx}
      cy={cy}
      rx={size * 0.42}
      ry={size}
      fill={color}
      transform={`rotate(${rot} ${cx} ${cy})`}
    />
  );
}

/** 葉のクラスター — 中心点周りに8枚程度を配置（暗葉→明葉の順で描く） */
function leafCluster(cx: number, cy: number, scale = 1, keyPrefix = ''): React.ReactElement {
  const base = 5 * scale;
  // [dx, dy, rotation, sizeMult, color]
  const config: Array<[number, number, number, number, string]> = [
    // 暗い葉（奥側）
    [-3.2, 1.5, -55, 1, C.leafDark],
    [3.2, 1.5, 55, 1, C.leafDark],
    [-1.8, -3.5, -20, 0.95, C.leafDark],
    [1.8, -3.5, 20, 0.95, C.leafDark],
    [0, 3.5, 0, 0.95, C.leafDark],
    // 明るい葉（手前）
    [-4.2, -0.5, -80, 0.85, C.leafLight],
    [4.2, -0.5, 80, 0.85, C.leafLight],
    [0, -5.2, 0, 0.9, C.leafLight],
    [-1.2, 0, -30, 0.7, C.leafLight],
    [1.2, 0, 30, 0.7, C.leafLight],
  ];
  return (
    <g>
      {config.map(([dx, dy, rot, mult, color], i) =>
        leaf(cx + dx * scale, cy + dy * scale, base * mult, rot, color, `${keyPrefix}${i}`),
      )}
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
        .growth-scene .canopy { animation: growth-sway 7s ease-in-out infinite; transform-origin: 100px 110px; transform-box: fill-box; }
        .growth-scene .bird-bob { animation: growth-bob 3.4s ease-in-out infinite; }
        @keyframes growth-sway { 0%,100% { transform: rotate(-0.7deg); } 50% { transform: rotate(0.7deg); } }
        @keyframes growth-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-1.5px); } }
        @media (prefers-reduced-motion: reduce) {
          .growth-scene .canopy, .growth-scene .bird-bob { animation: none; }
        }
      `}</style>

      {/* 植物（左寄り、ステージ3以降は揺れる） */}
      <g className={stage >= 3 ? 'canopy' : undefined}>{renderPlant(stage)}</g>

      {/* 鳥・巣（右寄り、ステージ2-4ではボブ） */}
      <g className={stage >= 2 && stage <= 4 ? 'bird-bob' : undefined}>{renderBirdScene(stage)}</g>
    </svg>
  );
}

/** ステージごとの植物 — 自然な木イラスト風 */
function renderPlant(stage: number): React.ReactElement | null {
  if (stage === 0) {
    // 土から芽が出始めた瞬間
    return (
      <g>
        <ellipse cx="100" cy="111" rx="7" ry="1.8" fill={C.trunkDark} opacity="0.35" />
        <path d="M 100 110 Q 99 108 100 106" stroke={C.stem} strokeWidth="1.2" fill="none" strokeLinecap="round" />
      </g>
    );
  }
  if (stage === 1) {
    // 双葉 — 茎にたまご型の葉が2枚
    return (
      <g>
        <path d="M 100 110 Q 100 104 100 99" stroke={C.stem} strokeWidth="1.5" fill="none" strokeLinecap="round" />
        {leaf(94, 99, 5.5, -60, C.leafLight)}
        {leaf(106, 99, 5.5, 60, C.leafLight)}
      </g>
    );
  }
  if (stage === 2) {
    // 若芽 — 茎が伸び、葉が増えてふっくら
    return (
      <g>
        <path d="M 100 110 Q 99 96 100 86" stroke={C.stem} strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M 100 96 Q 96 93 92 90" stroke={C.stem} strokeWidth="1.2" fill="none" strokeLinecap="round" />
        <path d="M 100 96 Q 104 93 108 90" stroke={C.stem} strokeWidth="1.2" fill="none" strokeLinecap="round" />
        {leaf(92, 89, 5, -75, C.leafDark)}
        {leaf(108, 89, 5, 75, C.leafDark)}
        {leaf(100, 84, 6, 0, C.leafLight)}
        {leaf(95, 87, 4.5, -30, C.leafLight)}
        {leaf(105, 87, 4.5, 30, C.leafLight)}
      </g>
    );
  }
  if (stage === 3) {
    // 小さな茂み — まだ幹なし、茎と枝で葉のクラスター3つ
    return (
      <g>
        <path d="M 100 110 Q 99 90 100 80" stroke={C.stemDark} strokeWidth="2.2" fill="none" strokeLinecap="round" />
        <path d="M 100 96 Q 92 90 84 84" stroke={C.stemDark} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M 100 96 Q 108 90 116 84" stroke={C.stemDark} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        {leafCluster(84, 82, 0.85, 'c1-')}
        {leafCluster(116, 82, 0.85, 'c2-')}
        {leafCluster(100, 76, 0.95, 'c3-')}
      </g>
    );
  }
  if (stage === 4) {
    // 苗木 — 細い焦茶の幹が見え始める
    return (
      <g>
        {/* 主幹（曲線でやわらかさ） */}
        <path d="M 100 110 Q 99 88 101 70" stroke={C.trunk} strokeWidth="3.5" fill="none" strokeLinecap="round" />
        {/* 枝 */}
        <path d="M 100 88 Q 92 82 80 78" stroke={C.trunk} strokeWidth="2.2" fill="none" strokeLinecap="round" />
        <path d="M 101 84 Q 110 78 122 74" stroke={C.trunk} strokeWidth="2.2" fill="none" strokeLinecap="round" />
        <path d="M 101 78 Q 96 70 92 65" stroke={C.trunk} strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M 101 76 Q 108 70 113 64" stroke={C.trunk} strokeWidth="1.8" fill="none" strokeLinecap="round" />
        {/* クラスター */}
        {leafCluster(80, 76, 0.95, 'c1-')}
        {leafCluster(122, 72, 0.95, 'c2-')}
        {leafCluster(92, 62, 0.9, 'c3-')}
        {leafCluster(113, 60, 0.9, 'c4-')}
        {leafCluster(101, 66, 1, 'c5-')}
      </g>
    );
  }
  if (stage === 5) {
    // 若木 — 幹が太く、枝が広がり、葉のクラスターが増える
    return (
      <g>
        {/* 主幹 */}
        <path d="M 100 110 Q 98 80 102 50" stroke={C.trunk} strokeWidth="5" fill="none" strokeLinecap="round" />
        {/* 枝 */}
        <path d="M 100 86 Q 88 78 72 72" stroke={C.trunk} strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M 101 80 Q 114 72 128 66" stroke={C.trunk} strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M 101 70 Q 94 60 86 52" stroke={C.trunk} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <path d="M 102 60 Q 110 50 118 44" stroke={C.trunk} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <path d="M 102 55 Q 100 42 100 36" stroke={C.trunk} strokeWidth="2.2" fill="none" strokeLinecap="round" />
        {/* クラスター */}
        {leafCluster(72, 70, 1.05, 'c1-')}
        {leafCluster(128, 64, 1.05, 'c2-')}
        {leafCluster(86, 50, 1, 'c3-')}
        {leafCluster(118, 42, 1, 'c4-')}
        {leafCluster(100, 36, 1.1, 'c5-')}
        {leafCluster(98, 58, 0.9, 'c6-')}
        {leafCluster(112, 56, 0.9, 'c7-')}
        {renderFlowers([[78, 68], [126, 62], [92, 48], [114, 42], [100, 32]])}
      </g>
    );
  }
  // Stage 6 — 大樹（さらに枝多く、葉と花が豊富）
  return (
    <g>
      {/* 主幹 */}
      <path d="M 100 110 Q 97 72 102 38" stroke={C.trunk} strokeWidth="6" fill="none" strokeLinecap="round" />
      {/* 主要な枝 */}
      <path d="M 100 90 Q 84 78 64 70" stroke={C.trunk} strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M 101 85 Q 118 76 136 68" stroke={C.trunk} strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M 101 72 Q 90 60 78 50" stroke={C.trunk} strokeWidth="3.2" fill="none" strokeLinecap="round" />
      <path d="M 102 65 Q 116 52 130 42" stroke={C.trunk} strokeWidth="3.2" fill="none" strokeLinecap="round" />
      <path d="M 102 55 Q 96 40 94 28" stroke={C.trunk} strokeWidth="2.8" fill="none" strokeLinecap="round" />
      <path d="M 103 48 Q 110 34 114 22" stroke={C.trunk} strokeWidth="2.8" fill="none" strokeLinecap="round" />
      <path d="M 102 42 Q 102 30 102 20" stroke={C.trunk} strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {/* 葉クラスター（多層） */}
      {leafCluster(64, 68, 1.1, 'c1-')}
      {leafCluster(136, 66, 1.1, 'c2-')}
      {leafCluster(78, 48, 1.05, 'c3-')}
      {leafCluster(130, 40, 1.05, 'c4-')}
      {leafCluster(94, 26, 1.05, 'c5-')}
      {leafCluster(114, 20, 1.05, 'c6-')}
      {leafCluster(102, 18, 1.15, 'c7-')}
      {leafCluster(85, 60, 0.95, 'c8-')}
      {leafCluster(118, 54, 0.95, 'c9-')}
      {leafCluster(100, 44, 1, 'c10-')}
      {renderFlowers([
        [70, 64], [132, 62], [82, 46], [126, 38], [98, 22],
        [110, 18], [102, 14], [88, 56], [120, 50], [100, 40],
      ])}
    </g>
  );
}

/** 花の描画 — シンプルな三層構造 */
function renderFlowers(positions: Array<[number, number]>): React.ReactElement {
  return (
    <g>
      {positions.map(([cx, cy], i) => (
        <g key={i}>
          <circle cx={cx} cy={cy} r="3.2" fill={C.flower} />
          <circle cx={cx} cy={cy} r="1.4" fill={C.flowerCenter} />
          <circle cx={cx} cy={cy} r="0.5" fill={C.flowerHeart} />
        </g>
      ))}
    </g>
  );
}

/** ステージごとの鳥と巣 */
function renderBirdScene(stage: number): React.ReactElement {
  if (stage === 0) {
    // 卵だけ — 中央寄りに大きめに置いて主役感を出す
    return (
      <g>
        <ellipse cx="210" cy="92" rx="14" ry="18" fill={C.eggShell} />
        <ellipse cx="205" cy="82" rx="4" ry="6" fill="#fff" opacity="0.55" />
        <circle cx="213" cy="88" r="0.9" fill={C.eggDot} />
        <circle cx="207" cy="95" r="0.9" fill={C.eggDot} />
        <circle cx="215" cy="100" r="0.9" fill={C.eggDot} />
        <circle cx="204" cy="101" r="0.9" fill={C.eggDot} />
      </g>
    );
  }
  if (stage === 1) {
    // 卵が割れて顔だけ
    return (
      <g>
        <path
          d="M 196 100 Q 196 86 210 86 Q 224 86 224 100 Q 224 111 210 114 Q 196 111 196 100 Z"
          fill={C.eggShell}
        />
        <path
          d="M 196 92 L 199 95 L 204 89 L 209 95 L 214 89 L 219 95 L 224 92"
          stroke={C.eggDot}
          strokeWidth="1"
          fill="none"
          strokeLinecap="round"
        />
        {/* ひよこ頭 */}
        <circle cx="210" cy="88" r="7" fill={C.bird} />
        <circle cx="207" cy="87" r="1.2" fill={C.eye} />
        <circle cx="213" cy="87" r="1.2" fill={C.eye} />
        <circle cx="207" cy="86.5" r="0.4" fill={C.eyeShine} />
        <circle cx="213" cy="86.5" r="0.4" fill={C.eyeShine} />
        <polygon points="216,89 220,90 216,91" fill={C.beak} />
      </g>
    );
  }
  if (stage === 2) {
    // ひよこ — 丸い体に大きな頭
    return (
      <g>
        <ellipse cx="210" cy="98" rx="11" ry="9" fill={C.bird} />
        <ellipse cx="210" cy="103" rx="10" ry="3" fill={C.birdShade} opacity="0.35" />
        <circle cx="210" cy="84" r="10" fill={C.bird} />
        <circle cx="206" cy="83" r="1.6" fill={C.eye} />
        <circle cx="214" cy="83" r="1.6" fill={C.eye} />
        <circle cx="206" cy="82.3" r="0.6" fill={C.eyeShine} />
        <circle cx="214" cy="82.3" r="0.6" fill={C.eyeShine} />
        <polygon points="218,86 223,87 218,88" fill={C.beak} />
        {/* 頬の赤み */}
        <circle cx="201" cy="87" r="1.5" fill="#fda4af" opacity="0.6" />
        <circle cx="219" cy="87" r="1.5" fill="#fda4af" opacity="0.6" />
        {/* 翼の小さな膨らみ */}
        <ellipse cx="201" cy="98" rx="3.5" ry="5" fill={C.birdShade} transform="rotate(-15 201 98)" />
        {/* 足 */}
        <path d="M 205 107 L 205 111 M 203 111 L 207 111" stroke={C.beak} strokeWidth="1.5" strokeLinecap="round" fill="none" />
        <path d="M 215 107 L 215 111 M 213 111 L 217 111" stroke={C.beak} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      </g>
    );
  }
  if (stage === 3) {
    // 子鳥 — ややスリムに、翼がしっかり
    return (
      <g>
        <ellipse cx="215" cy="95" rx="12" ry="10" fill={C.bird} />
        <circle cx="215" cy="80" r="9" fill={C.bird} />
        <circle cx="211" cy="79" r="1.6" fill={C.eye} />
        <circle cx="219" cy="79" r="1.6" fill={C.eye} />
        <circle cx="211" cy="78.3" r="0.6" fill={C.eyeShine} />
        <circle cx="219" cy="78.3" r="0.6" fill={C.eyeShine} />
        <polygon points="223,82 228,83 223,84" fill={C.beak} />
        {/* 翼 */}
        <path d="M 207 91 Q 200 95 204 105 Q 210 102 211 95 Z" fill={C.wing} />
        {/* 尻尾 */}
        <path d="M 226 95 L 233 92 L 230 99 Z" fill={C.wing} />
        {/* 足 */}
        <path d="M 210 105 L 210 110 M 207 110 L 213 110" stroke={C.beak} strokeWidth="1.5" strokeLinecap="round" fill="none" />
        <path d="M 220 105 L 220 110 M 217 110 L 223 110" stroke={C.beak} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      </g>
    );
  }
  if (stage === 4) {
    // 親鳥 — 枝にとまる
    return (
      <g transform="translate(215, 72)">
        <ellipse cx="0" cy="6" rx="12" ry="9" fill={C.bird} />
        <circle cx="0" cy="-4" r="8" fill={C.bird} />
        <circle cx="-3" cy="-5" r="1.6" fill={C.eye} />
        <circle cx="3" cy="-5" r="1.6" fill={C.eye} />
        <circle cx="-3" cy="-5.7" r="0.6" fill={C.eyeShine} />
        <circle cx="3" cy="-5.7" r="0.6" fill={C.eyeShine} />
        <polygon points="7,-2 12,-1 7,0" fill={C.beak} />
        {/* 翼 */}
        <path d="M -4 -1 Q -12 2 -10 11 Q -3 8 -2 4 Z" fill={C.wing} />
        {/* 尻尾 */}
        <path d="M -11 6 L -18 4 L -15 11 Z" fill={C.wing} />
        {/* 足（枝つかむ） */}
        <path d="M -3 14 L -3 17" stroke={C.beak} strokeWidth="1.6" strokeLinecap="round" />
        <path d="M 3 14 L 3 17" stroke={C.beak} strokeWidth="1.6" strokeLinecap="round" />
      </g>
    );
  }
  if (stage === 5) {
    // 巣ができはじめ — 親鳥が縁にとまる
    return (
      <g>
        {/* 巣 */}
        <ellipse cx="215" cy="65" rx="18" ry="7" fill={C.nest} />
        <ellipse cx="215" cy="62" rx="16" ry="5" fill={C.nestDark} />
        {/* 巣の枝のテクスチャ */}
        <g stroke={C.nestDark} strokeWidth="0.8" fill="none" strokeLinecap="round" opacity="0.7">
          <path d="M 200 65 Q 207 67 213 65" />
          <path d="M 215 66 Q 222 68 230 66" />
          <path d="M 207 62 Q 213 64 220 62" />
        </g>
        {/* 親鳥 */}
        <g transform="translate(230, 52)">
          <ellipse cx="0" cy="5" rx="11" ry="8" fill={C.bird} />
          <circle cx="0" cy="-4" r="7.5" fill={C.bird} />
          <circle cx="-3" cy="-5" r="1.4" fill={C.eye} />
          <circle cx="3" cy="-5" r="1.4" fill={C.eye} />
          <circle cx="-3" cy="-5.6" r="0.5" fill={C.eyeShine} />
          <circle cx="3" cy="-5.6" r="0.5" fill={C.eyeShine} />
          <polygon points="6,-2 11,-1 6,0" fill={C.beak} />
          <path d="M -4 -1 Q -11 2 -9 10 Q -3 7 -2 3 Z" fill={C.wing} />
          <path d="M -10 5 L -17 3 L -14 10 Z" fill={C.wing} />
        </g>
      </g>
    );
  }
  // Stage 6 — 巣に家族
  return (
    <g>
      {/* 大きな巣 */}
      <ellipse cx="215" cy="62" rx="25" ry="10" fill={C.nest} />
      <ellipse cx="215" cy="58" rx="22" ry="7" fill={C.nestDark} />
      {/* 巣の枝テクスチャ */}
      <g stroke={C.nestDark} strokeWidth="0.9" fill="none" strokeLinecap="round" opacity="0.6">
        <path d="M 195 62 Q 203 65 211 62" />
        <path d="M 213 63 Q 222 66 232 63" />
        <path d="M 200 58 Q 208 61 216 58" />
        <path d="M 218 59 Q 226 62 234 59" />
        <path d="M 207 55 Q 215 52 224 55" />
      </g>
      {/* 親鳥 */}
      <g transform="translate(238, 45)">
        <ellipse cx="0" cy="5" rx="12" ry="9" fill={C.bird} />
        <circle cx="0" cy="-5" r="8" fill={C.bird} />
        <circle cx="-3" cy="-6" r="1.6" fill={C.eye} />
        <circle cx="3" cy="-6" r="1.6" fill={C.eye} />
        <circle cx="-3" cy="-6.7" r="0.6" fill={C.eyeShine} />
        <circle cx="3" cy="-6.7" r="0.6" fill={C.eyeShine} />
        <polygon points="7,-3 13,-2 7,-1" fill={C.beak} />
        <path d="M -4 -2 Q -12 1 -10 10 Q -3 7 -2 3 Z" fill={C.wing} />
        <path d="M -11 6 L -19 3 L -15 11 Z" fill={C.wing} />
      </g>
      {/* 雛たち */}
      {[200, 211, 222].map((x, i) => (
        <g key={i} transform={`translate(${x}, 53)`}>
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
