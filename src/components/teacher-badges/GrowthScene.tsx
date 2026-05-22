'use client';

/**
 * バッジ獲得進捗を「巣のはじまり → 大樹と鳥の家族」の成長物語で表現するSVGシーン。
 * システム名 NEST にちなみ、最終的に鳥の家族が住む巣ができる構成。
 *
 * Stage の刻み:
 *   0   : 0個 — 草地に卵
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

export function GrowthScene({ earned, total, className = '' }: GrowthSceneProps) {
  const stage = getStage(earned, total);

  return (
    <svg
      viewBox="0 0 320 130"
      className={`w-full h-auto growth-scene ${className}`}
      preserveAspectRatio="xMidYMax meet"
      aria-label={`成長ステージ: ${STAGE_LABELS[stage]}`}
      role="img"
    >
      <style>{`
        .growth-scene .sun-glow { animation: growth-sun-pulse 6s ease-in-out infinite; transform-origin: 280px 28px; }
        .growth-scene .canopy { animation: growth-sway 7s ease-in-out infinite; transform-origin: 85px 110px; }
        .growth-scene .bird-bob { animation: growth-bob 3.4s ease-in-out infinite; }
        @keyframes growth-sun-pulse { 0%,100% { opacity: 0.85; transform: scale(1); } 50% { opacity: 1; transform: scale(1.08); } }
        @keyframes growth-sway { 0%,100% { transform: rotate(-0.6deg); } 50% { transform: rotate(0.6deg); } }
        @keyframes growth-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-1.5px); } }
        @media (prefers-reduced-motion: reduce) {
          .growth-scene .sun-glow, .growth-scene .canopy, .growth-scene .bird-bob { animation: none; }
        }
      `}</style>
      <defs>
        {/* 朝焼けの空 */}
        <linearGradient id="growth-sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#fef3c7" />
          <stop offset="45%" stopColor="#fce7f3" />
          <stop offset="100%" stopColor="#dbeafe" />
        </linearGradient>

        {/* 地面 */}
        <linearGradient id="growth-ground" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#bbf7d0" />
          <stop offset="100%" stopColor="#4ade80" />
        </linearGradient>

        {/* 幹 — ぬくもりのある木目調 */}
        <linearGradient id="growth-trunk" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#78350f" />
          <stop offset="50%" stopColor="#b45309" />
          <stop offset="100%" stopColor="#451a03" />
        </linearGradient>

        {/* 葉 — 立体感を出す放射状 */}
        <radialGradient id="growth-leaves" cx="0.35" cy="0.35" r="0.8">
          <stop offset="0%" stopColor="#bbf7d0" />
          <stop offset="60%" stopColor="#4ade80" />
          <stop offset="100%" stopColor="#15803d" />
        </radialGradient>

        {/* 鳥の体 — 黄→オレンジ */}
        <linearGradient id="growth-bird" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#fef3c7" />
          <stop offset="55%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>

        {/* 巣 */}
        <linearGradient id="growth-nest" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#b45309" />
          <stop offset="100%" stopColor="#451a03" />
        </linearGradient>

        {/* 太陽のグロー */}
        <radialGradient id="growth-sun">
          <stop offset="0%" stopColor="#fde047" />
          <stop offset="70%" stopColor="#fcd34d" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#fcd34d" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 空 */}
      <rect width="320" height="130" fill="url(#growth-sky)" rx="10" />

      {/* 太陽 */}
      <circle cx="280" cy="28" r="22" fill="url(#growth-sun)" className="sun-glow" />
      <circle cx="280" cy="28" r="10" fill="#fde047" />

      {/* 遠景の丘 */}
      <path
        d="M -10 95 Q 80 70 160 90 T 330 85 L 330 130 L -10 130 Z"
        fill="#a7f3d0"
        opacity="0.65"
      />
      <path
        d="M -10 105 Q 100 92 210 102 T 330 100 L 330 130 L -10 130 Z"
        fill="#86efac"
        opacity="0.75"
      />

      {/* 地面 */}
      <path
        d="M -10 110 Q 160 102 330 110 L 330 130 L -10 130 Z"
        fill="url(#growth-ground)"
      />

      {/* 草の演出（軽く） */}
      <g stroke="#16a34a" strokeWidth="1" fill="none" strokeLinecap="round" opacity="0.7">
        <path d="M 30 116 L 30 112 M 32 117 L 33 113" />
        <path d="M 130 117 L 130 114 M 132 117 L 133 114" />
        <path d="M 270 117 L 270 113 M 272 117 L 273 113" />
        <path d="M 165 119 L 165 116" />
      </g>

      {/* 植物（左寄り） */}
      <g className={stage >= 3 ? 'canopy' : undefined}>{renderPlant(stage)}</g>

      {/* 鳥・巣（右寄り） */}
      <g className={stage >= 2 && stage <= 4 ? 'bird-bob' : undefined}>{renderBirdScene(stage)}</g>
    </svg>
  );
}

/** ステージごとの植物（土→芽→若芽→苗木→若木→花咲く木→大樹） */
function renderPlant(stage: number): React.ReactElement {
  if (stage === 0) {
    // 土の盛り上がりと種
    return (
      <g>
        <ellipse cx="85" cy="111" rx="11" ry="3" fill="#78350f" opacity="0.45" />
        <ellipse cx="85" cy="109" rx="3" ry="2" fill="#451a03" />
      </g>
    );
  }
  if (stage === 1) {
    // 芽吹き — 細い茎に双葉
    return (
      <g>
        <ellipse cx="85" cy="111" rx="10" ry="2.5" fill="#78350f" opacity="0.45" />
        <path d="M 85 110 Q 85 105 85 100" stroke="#16a34a" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <ellipse cx="80" cy="101" rx="4" ry="2.5" fill="url(#growth-leaves)" transform="rotate(-35 80 101)" />
        <ellipse cx="90" cy="101" rx="4" ry="2.5" fill="url(#growth-leaves)" transform="rotate(35 90 101)" />
      </g>
    );
  }
  if (stage === 2) {
    // 若芽 — 茎が伸びて葉が増える
    return (
      <g>
        <path d="M 85 110 Q 84 100 85 88" stroke="#16a34a" strokeWidth="2" fill="none" strokeLinecap="round" />
        <ellipse cx="77" cy="95" rx="5.5" ry="3" fill="url(#growth-leaves)" transform="rotate(-30 77 95)" />
        <ellipse cx="93" cy="95" rx="5.5" ry="3" fill="url(#growth-leaves)" transform="rotate(30 93 95)" />
        <ellipse cx="85" cy="85" rx="4" ry="3" fill="url(#growth-leaves)" />
        <ellipse cx="79" cy="88" rx="3" ry="2" fill="url(#growth-leaves)" transform="rotate(-40 79 88)" />
        <ellipse cx="91" cy="88" rx="3" ry="2" fill="url(#growth-leaves)" transform="rotate(40 91 88)" />
      </g>
    );
  }
  if (stage === 3) {
    // 苗木 — 細い幹に小さなキャノピー
    return (
      <g>
        <rect x="83" y="68" width="4" height="44" fill="url(#growth-trunk)" rx="1" />
        <circle cx="85" cy="63" r="18" fill="url(#growth-leaves)" />
        <circle cx="72" cy="73" r="11" fill="url(#growth-leaves)" />
        <circle cx="98" cy="73" r="11" fill="url(#growth-leaves)" />
        <circle cx="80" cy="55" r="9" fill="url(#growth-leaves)" opacity="0.9" />
        <circle cx="92" cy="55" r="9" fill="url(#growth-leaves)" opacity="0.9" />
      </g>
    );
  }
  if (stage === 4) {
    // 若木 — 枝が伸びてキャノピー充実
    return (
      <g>
        <rect x="80" y="52" width="10" height="60" fill="url(#growth-trunk)" rx="1.5" />
        <path d="M 85 68 L 64 80" stroke="url(#growth-trunk)" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M 85 68 L 106 80" stroke="url(#growth-trunk)" strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="85" cy="48" r="26" fill="url(#growth-leaves)" />
        <circle cx="58" cy="65" r="18" fill="url(#growth-leaves)" />
        <circle cx="112" cy="65" r="18" fill="url(#growth-leaves)" />
        <circle cx="72" cy="38" r="14" fill="url(#growth-leaves)" opacity="0.95" />
        <circle cx="98" cy="38" r="14" fill="url(#growth-leaves)" opacity="0.95" />
      </g>
    );
  }
  if (stage === 5) {
    // 花咲く木 — 花が点在
    return (
      <g>
        <rect x="78" y="42" width="14" height="70" fill="url(#growth-trunk)" rx="2" />
        <path d="M 85 58 L 55 75" stroke="url(#growth-trunk)" strokeWidth="4.5" strokeLinecap="round" />
        <path d="M 85 58 L 115 75" stroke="url(#growth-trunk)" strokeWidth="4.5" strokeLinecap="round" />
        <path d="M 85 75 L 68 92" stroke="url(#growth-trunk)" strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="85" cy="38" r="30" fill="url(#growth-leaves)" />
        <circle cx="52" cy="60" r="23" fill="url(#growth-leaves)" />
        <circle cx="118" cy="60" r="23" fill="url(#growth-leaves)" />
        <circle cx="68" cy="30" r="16" fill="url(#growth-leaves)" opacity="0.95" />
        <circle cx="102" cy="30" r="16" fill="url(#growth-leaves)" opacity="0.95" />
        {renderFlowers([
          [62, 42], [78, 25], [102, 42], [92, 55], [55, 50], [115, 50], [85, 18],
        ])}
      </g>
    );
  }
  // Stage 6 — 大樹
  return (
    <g>
      <rect x="75" y="32" width="20" height="80" fill="url(#growth-trunk)" rx="2.5" />
      <path d="M 85 48 L 48 75" stroke="url(#growth-trunk)" strokeWidth="6" strokeLinecap="round" />
      <path d="M 85 48 L 122 75" stroke="url(#growth-trunk)" strokeWidth="6" strokeLinecap="round" />
      <path d="M 85 62 L 62 95" stroke="url(#growth-trunk)" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M 85 62 L 108 95" stroke="url(#growth-trunk)" strokeWidth="4.5" strokeLinecap="round" />
      {/* キャノピー */}
      <circle cx="85" cy="28" r="36" fill="url(#growth-leaves)" />
      <circle cx="46" cy="55" r="27" fill="url(#growth-leaves)" />
      <circle cx="124" cy="55" r="27" fill="url(#growth-leaves)" />
      <circle cx="66" cy="80" r="19" fill="url(#growth-leaves)" />
      <circle cx="104" cy="80" r="19" fill="url(#growth-leaves)" />
      <circle cx="62" cy="18" r="18" fill="url(#growth-leaves)" opacity="0.95" />
      <circle cx="108" cy="18" r="18" fill="url(#growth-leaves)" opacity="0.95" />
      {renderFlowers([
        [58, 30], [100, 35], [75, 12], [118, 50], [45, 55], [85, 50],
        [55, 75], [120, 80], [70, 28], [95, 65],
      ])}
    </g>
  );
}

/** 花の描画 — 中心に淡いピンク */
function renderFlowers(positions: Array<[number, number]>): React.ReactElement {
  return (
    <g>
      {positions.map(([cx, cy], i) => (
        <g key={i}>
          <circle cx={cx} cy={cy} r="3" fill="#fbcfe8" />
          <circle cx={cx} cy={cy} r="1.5" fill="#fce7f3" />
          <circle cx={cx} cy={cy} r="0.6" fill="#fde047" />
        </g>
      ))}
    </g>
  );
}

/** ステージごとの鳥と巣 */
function renderBirdScene(stage: number): React.ReactElement {
  if (stage === 0) {
    // 卵だけ
    return (
      <g>
        <ellipse cx="220" cy="105" rx="8" ry="11" fill="#fefce8" stroke="#fbbf24" strokeWidth="0.8" />
        <ellipse cx="217" cy="100" rx="3" ry="4" fill="#ffffff" opacity="0.55" />
        <circle cx="222" cy="103" r="0.6" fill="#fbbf24" opacity="0.5" />
        <circle cx="218" cy="108" r="0.6" fill="#fbbf24" opacity="0.5" />
        <circle cx="224" cy="110" r="0.6" fill="#fbbf24" opacity="0.5" />
      </g>
    );
  }
  if (stage === 1) {
    // 卵が割れて顔だけ出す
    return (
      <g>
        <path
          d="M 212 105 Q 212 96 220 96 Q 228 96 228 105 Q 228 113 220 116 Q 212 113 212 105 Z"
          fill="#fefce8"
          stroke="#fbbf24"
          strokeWidth="0.8"
        />
        {/* 割れたエッジ */}
        <path
          d="M 213 100 L 215 102 L 217 99 L 219 102 L 221 99 L 223 102 L 225 99 L 227 102"
          stroke="#fbbf24"
          strokeWidth="0.6"
          fill="none"
        />
        {/* ひよこ頭 */}
        <circle cx="220" cy="97" r="5.5" fill="url(#growth-bird)" />
        <circle cx="218" cy="96" r="0.9" fill="#1f2937" />
        <circle cx="222" cy="96" r="0.9" fill="#1f2937" />
        <polygon points="225,98 228,99 225,100" fill="#f97316" />
      </g>
    );
  }
  if (stage === 2) {
    // 立ち上がったひよこ
    return (
      <g>
        {/* 割れた卵の殻が地面に残る */}
        <path d="M 232 110 Q 235 104 240 108 L 232 112 Z" fill="#fefce8" stroke="#fbbf24" strokeWidth="0.6" />
        <path d="M 244 109 Q 247 105 250 108 L 244 111 Z" fill="#fefce8" stroke="#fbbf24" strokeWidth="0.6" />
        {/* ひよこ本体 */}
        <ellipse cx="218" cy="103" rx="8" ry="6" fill="url(#growth-bird)" />
        <circle cx="218" cy="94" r="6" fill="url(#growth-bird)" />
        <circle cx="216" cy="93" r="1" fill="#1f2937" />
        <circle cx="220" cy="93" r="1" fill="#1f2937" />
        <circle cx="216" cy="93" r="0.3" fill="#fff" />
        <circle cx="220" cy="93" r="0.3" fill="#fff" />
        <polygon points="222,95 226,96 222,97" fill="#f97316" />
        {/* 足 */}
        <line x1="215" y1="109" x2="215" y2="112" stroke="#f97316" strokeWidth="1.2" strokeLinecap="round" />
        <line x1="221" y1="109" x2="221" y2="112" stroke="#f97316" strokeWidth="1.2" strokeLinecap="round" />
        {/* 翼の蕾 */}
        <ellipse cx="213" cy="102" rx="2.5" ry="3.5" fill="#d97706" opacity="0.7" transform="rotate(-20 213 102)" />
      </g>
    );
  }
  if (stage === 3) {
    // 子鳥 — 苗木の根元あたり
    return (
      <g>
        <ellipse cx="225" cy="100" rx="10" ry="8" fill="url(#growth-bird)" />
        <circle cx="225" cy="89" r="7" fill="url(#growth-bird)" />
        <circle cx="222" cy="88" r="1.1" fill="#1f2937" />
        <circle cx="228" cy="88" r="1.1" fill="#1f2937" />
        <circle cx="222" cy="87.5" r="0.4" fill="#fff" />
        <circle cx="228" cy="87.5" r="0.4" fill="#fff" />
        <polygon points="231,91 236,92 231,93" fill="#f97316" />
        {/* 翼 */}
        <ellipse cx="219" cy="100" rx="4" ry="6" fill="#d97706" transform="rotate(-15 219 100)" />
        {/* 足 */}
        <line x1="221" y1="107" x2="221" y2="111" stroke="#f97316" strokeWidth="1.4" strokeLinecap="round" />
        <line x1="229" y1="107" x2="229" y2="111" stroke="#f97316" strokeWidth="1.4" strokeLinecap="round" />
      </g>
    );
  }
  if (stage === 4) {
    // 親鳥になりつつある鳥 — 枝にとまる
    return (
      <g>
        {/* 鳥本体（枝の上） */}
        <g transform="translate(225, 75)">
          <ellipse cx="0" cy="5" rx="11" ry="8.5" fill="url(#growth-bird)" />
          <circle cx="0" cy="-5" r="7.5" fill="url(#growth-bird)" />
          <circle cx="-2.5" cy="-6" r="1.2" fill="#1f2937" />
          <circle cx="2.5" cy="-6" r="1.2" fill="#1f2937" />
          <circle cx="-2.5" cy="-6.3" r="0.4" fill="#fff" />
          <circle cx="2.5" cy="-6.3" r="0.4" fill="#fff" />
          <polygon points="6,-3 11,-2 6,-1" fill="#f97316" />
          {/* 翼 */}
          <path d="M -3 -2 Q -10 0 -8 8 Q -3 6 -1 2 Z" fill="#d97706" />
          {/* 尻尾 */}
          <path d="M -10 5 L -16 3 L -14 8 Z" fill="#d97706" />
          {/* 足（枝つかむ） */}
          <line x1="-3" y1="13" x2="-3" y2="16" stroke="#f97316" strokeWidth="1.4" strokeLinecap="round" />
          <line x1="3" y1="13" x2="3" y2="16" stroke="#f97316" strokeWidth="1.4" strokeLinecap="round" />
        </g>
      </g>
    );
  }
  if (stage === 5) {
    // 巣ができはじめ。枝の上に巣＋親鳥
    return (
      <g>
        {/* 巣（小） */}
        <ellipse cx="225" cy="68" rx="16" ry="6" fill="url(#growth-nest)" />
        <ellipse cx="225" cy="65" rx="14" ry="4.5" fill="#92400e" />
        {/* 巣の枝のテクスチャ */}
        <g stroke="#451a03" strokeWidth="0.6" fill="none" strokeLinecap="round">
          <path d="M 213 67 Q 217 69 221 67" />
          <path d="M 224 68 Q 228 70 232 68" />
          <path d="M 218 65 Q 222 67 226 65" />
        </g>
        {/* 親鳥（巣の縁にとまる） */}
        <g transform="translate(238, 55)">
          <ellipse cx="0" cy="5" rx="10" ry="7.5" fill="url(#growth-bird)" />
          <circle cx="0" cy="-4" r="7" fill="url(#growth-bird)" />
          <circle cx="-2.5" cy="-5" r="1.2" fill="#1f2937" />
          <circle cx="2.5" cy="-5" r="1.2" fill="#1f2937" />
          <circle cx="-2.5" cy="-5.3" r="0.4" fill="#fff" />
          <circle cx="2.5" cy="-5.3" r="0.4" fill="#fff" />
          <polygon points="6,-3 11,-2 6,-1" fill="#f97316" />
          <path d="M -3 -1 Q -10 1 -8 9 Q -3 7 -1 3 Z" fill="#d97706" />
          <path d="M -10 5 L -16 3 L -14 8 Z" fill="#d97706" />
        </g>
      </g>
    );
  }
  // Stage 6 — 巣に家族
  return (
    <g>
      {/* 大きな巣 */}
      <ellipse cx="225" cy="62" rx="22" ry="9" fill="url(#growth-nest)" />
      <ellipse cx="225" cy="58" rx="20" ry="6.5" fill="#92400e" />
      {/* 巣の枝テクスチャ */}
      <g stroke="#451a03" strokeWidth="0.7" fill="none" strokeLinecap="round">
        <path d="M 209 61 Q 215 64 221 61" />
        <path d="M 224 62 Q 230 65 236 62" />
        <path d="M 213 58 Q 219 61 225 58" />
        <path d="M 226 59 Q 233 62 239 59" />
        <path d="M 218 56 Q 225 53 232 56" />
      </g>
      {/* 親鳥（巣のふちにとまる） */}
      <g transform="translate(242, 48)">
        <ellipse cx="0" cy="5" rx="11" ry="8" fill="url(#growth-bird)" />
        <circle cx="0" cy="-5" r="7.5" fill="url(#growth-bird)" />
        <circle cx="-2.5" cy="-6" r="1.2" fill="#1f2937" />
        <circle cx="2.5" cy="-6" r="1.2" fill="#1f2937" />
        <circle cx="-2.5" cy="-6.3" r="0.4" fill="#fff" />
        <circle cx="2.5" cy="-6.3" r="0.4" fill="#fff" />
        <polygon points="6,-4 12,-3 6,-2" fill="#f97316" />
        <path d="M -3 -2 Q -11 0 -9 9 Q -3 7 -1 3 Z" fill="#d97706" />
        <path d="M -10 6 L -17 3 L -14 9 Z" fill="#d97706" />
      </g>
      {/* 雛 1 */}
      <g transform="translate(216, 54)">
        <ellipse cx="0" cy="0" rx="4" ry="3.5" fill="url(#growth-bird)" />
        <circle cx="0" cy="-3" r="3" fill="url(#growth-bird)" />
        <circle cx="-1" cy="-3.5" r="0.6" fill="#1f2937" />
        <circle cx="1" cy="-3.5" r="0.6" fill="#1f2937" />
        <polygon points="2.5,-2.5 5,-2 2.5,-1.5" fill="#f97316" />
      </g>
      {/* 雛 2 */}
      <g transform="translate(225, 54)">
        <ellipse cx="0" cy="0" rx="4" ry="3.5" fill="url(#growth-bird)" />
        <circle cx="0" cy="-3" r="3" fill="url(#growth-bird)" />
        <circle cx="-1" cy="-3.5" r="0.6" fill="#1f2937" />
        <circle cx="1" cy="-3.5" r="0.6" fill="#1f2937" />
        <polygon points="2.5,-2.5 5,-2 2.5,-1.5" fill="#f97316" />
      </g>
      {/* 雛 3 */}
      <g transform="translate(234, 54)">
        <ellipse cx="0" cy="0" rx="4" ry="3.5" fill="url(#growth-bird)" />
        <circle cx="0" cy="-3" r="3" fill="url(#growth-bird)" />
        <circle cx="-1" cy="-3.5" r="0.6" fill="#1f2937" />
        <circle cx="1" cy="-3.5" r="0.6" fill="#1f2937" />
        <polygon points="2.5,-2.5 5,-2 2.5,-1.5" fill="#f97316" />
      </g>
    </g>
  );
}
