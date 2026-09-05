// ProposalEditor とその子コンポーネント(UnitRow)で共有する型・定数・純粋ヘルパー。
// 巨大化した ProposalEditor.tsx から、挙動を持たない定義だけを切り出したもの。
import type { ProposalStatus, SeasonType } from '@/types/database';

/** 単元1行ぶんの編集状態（提案コマ・申込コマ・結合グループ・意図タグ） */
export interface UnitDraft {
  curriculum_item_id: number;
  koma_count: number;
  applied_koma: number;
  reason: string;
  selected: boolean;
  group_id: number;
  // 申込専用の結合グループ（提案結合 group_id とは独立）
  applied_group_id: number;
  intent_tag: string | null;
}

export const INTENT_TAGS = [
  '予習',
  '復習',
  '苦手克服',
  '苦手補強',
  '定着',
  '直前演習',
  '応用発展',
] as const;
export type IntentTag = (typeof INTENT_TAGS)[number];

export const INTENT_TAG_COLOR: Record<IntentTag, string> = {
  予習: 'text-purple-700 border-purple-200',
  復習: 'text-blue-700 border-blue-200',
  苦手克服: 'text-rose-700 border-rose-200',
  苦手補強: 'text-red-700 border-red-200',
  定着: 'text-emerald-700 border-emerald-200',
  直前演習: 'text-amber-700 border-amber-200',
  応用発展: 'text-indigo-700 border-indigo-200',
};

export const STATUS_FLOW: ProposalStatus[] = ['draft', 'sent', 'approved'];

export const GROUP_COLORS = [
  'border-l-blue-500',
  'border-l-purple-500',
  'border-l-amber-500',
  'border-l-emerald-500',
  'border-l-rose-500',
  'border-l-cyan-500',
];

export const GROUP_TEXT_COLORS = [
  'text-blue-600',
  'text-purple-600',
  'text-amber-600',
  'text-emerald-600',
  'text-rose-600',
  'text-cyan-600',
];

export const GROUP_CIRCLE_NUMS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

export const GROUP_BG = [
  'bg-blue-50',
  'bg-purple-50',
  'bg-amber-50',
  'bg-emerald-50',
  'bg-rose-50',
  'bg-cyan-50',
];

// アクティブ（現在の状態）のみ塗りつぶし＋リング＋チェックで強調。
// 非アクティブは色を持たないゴースト表示にして「今どれが選択中か」を一目で分かるようにする。
export const STATUS_COLORS: Record<string, { active: string }> = {
  draft: { active: 'bg-text-muted text-white ring-2 ring-text-muted/30' },
  sent: { active: 'bg-info text-white ring-2 ring-info/30' },
  approved: { active: 'bg-emerald-600 text-white ring-2 ring-emerald-600/30' },
};
export const STATUS_INACTIVE =
  'bg-transparent text-text-faint border border-border-default hover:bg-surface-hover hover:text-text-muted';

// 科目バッジ配色（提案書一覧・講習一覧と統一）
export const SUBJECT_BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  英語: { bg: 'bg-blue-50', text: 'text-blue-700' },
  数学: { bg: 'bg-red-50', text: 'text-red-700' },
  算数: { bg: 'bg-red-50', text: 'text-red-700' },
  国語: { bg: 'bg-green-50', text: 'text-green-700' },
  理科: { bg: 'bg-amber-50', text: 'text-amber-700' },
  社会: { bg: 'bg-purple-50', text: 'text-purple-700' },
};
export const DEFAULT_SUBJECT_BADGE = { bg: 'bg-gray-100', text: 'text-gray-600' };

/** 現在月から既定のシーズンを判定（2〜4月=春 / 5〜9月=夏 / それ以外=冬） */
export function getCurrentSeason(): SeasonType {
  const month = new Date().getMonth() + 1;
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 9) return 'summer';
  return 'winter';
}

/**
 * これから準備する講習のシーズン（1〜3月=春 / 4〜8月=夏 / 9〜12月=冬）。
 *
 * `getCurrentSeason` は「今どのシーズンにいるか」で、既存データの絞り込みに使う。
 * こちらは「次にどのシーズンを作るか」。講習の雛形は実施の数か月前から作るので、
 * 新規作成の既定値には今のシーズンではなくこちらを使う。
 * 例: 9月は夏期が終わって冬期の準備に入っているので、既定は冬期。
 */
export function getPreparingSeason(): SeasonType {
  const month = new Date().getMonth() + 1;
  if (month <= 3) return 'spring';
  if (month <= 8) return 'summer';
  return 'winter';
}
