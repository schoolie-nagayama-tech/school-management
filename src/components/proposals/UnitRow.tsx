'use client';

import { Check, Minus, Plus, Unlink, X } from 'lucide-react';
import type { CurriculumItem } from '@/types/database';
import {
  GROUP_BG,
  GROUP_CIRCLE_NUMS,
  GROUP_COLORS,
  GROUP_TEXT_COLORS,
  INTENT_TAG_COLOR,
  INTENT_TAGS,
  type IntentTag,
  type UnitDraft,
} from './proposalEditor.shared';

/**
 * カリキュラム単元1行のUI。提案コマ・申込コマの増減、提案結合/申込結合の解除、
 * 意図タグの付与を担う。状態は親(ProposalEditor)が UnitDraft で保持し、
 * この行は表示と操作イベントの発火（onUpdate 等）に専念する。
 */
export function UnitRow({
  index,
  item,
  draft,
  done,
  appliedMode,
  groupMembers,
  appliedGroupMembers,
  onToggle,
  onSelectStart,
  onSelectEnter,
  onUpdate,
  onUngroup,
  onUngroupAll,
  onUngroupApplied,
  onUngroupAllApplied,
  showApplied = true,
  showIntent = true,
}: {
  index: number;
  item: CurriculumItem;
  draft: UnitDraft;
  done: boolean;
  appliedMode: boolean;
  /**
   * 申込コマの列（±ステッパーと申込結合ボタン）を出すか。
   * 講習テンプレートには「申込」という概念が無いので false で使う。
   */
  showApplied?: boolean;
  /**
   * 指導意図のタグを出すか。
   * テンプレートは意図を持たない（生徒ごとに決めるもの）ので false で使う。
   */
  showIntent?: boolean;
  groupMembers?: UnitDraft[];
  appliedGroupMembers?: UnitDraft[];
  onToggle: (shiftKey: boolean) => void;
  onSelectStart: (shiftKey: boolean) => void;
  onSelectEnter: () => void;
  onUpdate: (patch: Partial<UnitDraft>) => void;
  onUngroup: () => void;
  onUngroupAll: () => void;
  onUngroupApplied: () => void;
  onUngroupAllApplied: () => void;
}) {
  const isGrouped = draft.group_id > 0;
  const isGroupHead =
    groupMembers && groupMembers[0]?.curriculum_item_id === draft.curriculum_item_id;
  // 申込を出さない画面（講習テンプレート）では、申込コマは常に無いものとして扱う
  const hasApplied = showApplied && draft.applied_koma > 0;
  // 提案コマ・申込コマのどちらかが入っていれば有効（提案0・申込1の単元も操作可能に）
  const isActive = draft.koma_count > 0 || hasApplied;
  // 申込結合: applied_group_id でまとめた単元。head のみ申込±を出し、合計も head 1件で計上。
  const isAppliedGrouped = draft.applied_group_id > 0 && hasApplied;
  const isAppliedGroupHead =
    appliedGroupMembers && appliedGroupMembers[0]?.curriculum_item_id === draft.curriculum_item_id;

  const handleCardClick = () => {
    // 申込編集フェーズ（提案済み/公開済み）では行クリックで申込コマを足す。
    // 下書き中は従来どおり提案コマを足す。申込を出さない画面では常に提案コマ。
    if (appliedMode && showApplied) {
      onUpdate({ applied_koma: draft.applied_koma + 1 });
    } else {
      onUpdate({ koma_count: draft.koma_count + 1 });
    }
  };

  const groupColorIdx = isGrouped ? (draft.group_id - 1) % GROUP_COLORS.length : 0;

  const rowColor = !isActive
    ? draft.selected
      ? 'border border-primary/30 bg-primary/5'
      : 'border border-border-subtle bg-surface-raised'
    : hasApplied
      ? 'border border-success/30 bg-success-subtle'
      : isGrouped
        ? `border ${GROUP_BG[groupColorIdx]}`
        : 'border border-accent-ink/20 bg-accent-ink-subtle';

  const checkColor = !draft.selected
    ? 'border-border-strong hover:border-text-muted'
    : 'bg-primary border-primary text-white';

  return (
    <div
      data-unit-idx={index}
      onPointerEnter={onSelectEnter}
      className={`rounded-lg transition-[background-color,border-color] duration-150 ease-out ${rowColor} ${
        isGrouped && isActive ? `border-l-4 ${GROUP_COLORS[groupColorIdx]}` : ''
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        {/* チェック＝ドラッグハンドルも兼ねる。押した瞬間に選択開始し、そのままなぞると範囲選択。 */}
        <button
          onPointerDown={(e) => {
            if (e.button !== 0) return; // 左ボタンのみ
            e.preventDefault(); // テキスト選択・フォーカス暴れを防ぐ
            onSelectStart(e.shiftKey);
          }}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              onToggle(e.shiftKey);
            }
          }}
          className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 cursor-pointer touch-none transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-90 ${checkColor}`}
          aria-label={draft.selected ? `${item.title} を選択解除` : `${item.title} を選択`}
        >
          {draft.selected && <Check className="w-3 h-3" />}
        </button>

        <button
          type="button"
          onClick={handleCardClick}
          className="flex-1 min-w-0 text-left cursor-pointer group active:opacity-70 transition-opacity duration-100"
        >
          <span
            className={`text-sm transition-[color] duration-150 ease-out ${
              done
                ? 'text-text-faint line-through'
                : isActive
                  ? 'font-medium text-text-heading group-hover:text-accent-ink'
                  : 'text-text-body group-hover:text-text-heading'
            }`}
          >
            {item.title}
          </span>
          {done && <span className="ml-1.5 text-[10px] text-text-faint">指導済</span>}
          {isGrouped && isActive && (
            <span className={`ml-1.5 text-[10px] font-bold ${GROUP_TEXT_COLORS[groupColorIdx]}`}>
              {GROUP_CIRCLE_NUMS[(draft.group_id - 1) % GROUP_CIRCLE_NUMS.length]}
            </span>
          )}
          {isAppliedGrouped && (
            <span className="ml-1.5 text-[10px] font-bold text-success" title="申込結合">
              申{GROUP_CIRCLE_NUMS[(draft.applied_group_id - 1) % GROUP_CIRCLE_NUMS.length]}
            </span>
          )}
          {isActive && draft.intent_tag && (
            <span
              className={`ml-1.5 inline-block px-1.5 py-0 border rounded-full text-[9px] font-medium ${INTENT_TAG_COLOR[draft.intent_tag as IntentTag] ?? 'text-text-muted border-border-default'}`}
            >
              {draft.intent_tag}
            </span>
          )}
        </button>

        {isActive && (
          <div className="flex items-center gap-2 shrink-0">
            {/* 提案コマ ±（提案結合はheadのみ表示。合計はhead1件で計上） */}
            {(!isGrouped || isGroupHead) && (
              <div className="flex items-center gap-0.5" title="提案コマ">
                <button
                  onClick={() => onUpdate({ koma_count: Math.max(0, draft.koma_count - 1) })}
                  className="w-5 h-5 flex items-center justify-center text-text-faint hover:text-text-body rounded hover:bg-surface-hover active:bg-border-default transition-[background-color,color] duration-100 ease-out"
                  aria-label="提案コマ数を減らす"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <span className="w-6 text-center text-sm font-bold text-accent-ink">
                  {draft.koma_count}
                </span>
                <button
                  onClick={() => onUpdate({ koma_count: draft.koma_count + 1 })}
                  className="w-5 h-5 flex items-center justify-center text-text-faint hover:text-text-body rounded hover:bg-surface-hover active:bg-border-default transition-[background-color,color] duration-100 ease-out"
                  aria-label="提案コマ数を増やす"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* 提案±と申込±が両方出るときだけ区切り */}
            {showApplied &&
              (!isGrouped || isGroupHead) &&
              (!isAppliedGrouped || isAppliedGroupHead) && (
                <div className="w-px h-4 bg-border-default" />
              )}

            {/* 申込コマ ±（申込結合はheadのみ表示。合計はhead1件で計上） */}
            {showApplied && (!isAppliedGrouped || isAppliedGroupHead) && (
              <div className="flex items-center gap-0.5" title="申込コマ">
                <button
                  onClick={() => onUpdate({ applied_koma: Math.max(0, draft.applied_koma - 1) })}
                  className="w-5 h-5 flex items-center justify-center text-text-faint hover:text-text-body rounded hover:bg-surface-hover active:bg-border-default transition-[background-color,color] duration-100 ease-out"
                  aria-label="申込コマ数を減らす"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <span
                  className={`w-6 text-center text-sm font-bold ${hasApplied ? 'text-success' : 'text-text-faint'}`}
                >
                  {draft.applied_koma}
                </span>
                <button
                  onClick={() => onUpdate({ applied_koma: draft.applied_koma + 1 })}
                  className="w-5 h-5 flex items-center justify-center text-text-faint hover:text-text-body rounded hover:bg-surface-hover active:bg-border-default transition-[background-color,color] duration-100 ease-out"
                  aria-label="申込コマ数を増やす"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* 提案結合の解除 */}
        {isGrouped && isActive && !isGroupHead && (
          <button
            onClick={onUngroup}
            className="p-0.5 text-text-faint hover:text-text-muted rounded hover:bg-surface-hover active:scale-95 transition-[background-color,color,transform] duration-100 shrink-0"
            title="グループから外す"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}

        {isGrouped && isActive && isGroupHead && (
          <button
            onClick={onUngroupAll}
            className="p-0.5 text-text-faint hover:text-danger rounded hover:bg-surface-hover active:scale-95 transition-[background-color,color,transform] duration-100 shrink-0"
            title="グループ解除"
          >
            <Unlink className="w-3.5 h-3.5" />
          </button>
        )}

        {/* 申込結合の解除（success色で提案結合と区別） */}
        {isAppliedGrouped && !isAppliedGroupHead && (
          <button
            onClick={onUngroupApplied}
            className="p-0.5 text-success/70 hover:text-success rounded hover:bg-surface-hover active:scale-95 transition-[background-color,color,transform] duration-100 shrink-0"
            title="申込結合から外す"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}

        {isAppliedGrouped && isAppliedGroupHead && (
          <button
            onClick={onUngroupAllApplied}
            className="p-0.5 text-success/70 hover:text-success rounded hover:bg-surface-hover active:scale-95 transition-[background-color,color,transform] duration-100 shrink-0"
            title="申込結合を解除"
          >
            <Unlink className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {isActive && showIntent && (
        <div className="px-3 pb-2 pt-0">
          <div className="flex items-center gap-1 flex-wrap">
            {INTENT_TAGS.map((tag) => {
              const active = draft.intent_tag === tag;
              const color = INTENT_TAG_COLOR[tag];
              return (
                <button
                  key={tag}
                  onClick={() => onUpdate({ intent_tag: active ? null : tag })}
                  className={`px-1.5 py-0.5 text-[10px] font-medium border rounded-full transition-[background-color,border-color,color,transform] duration-100 ease-out active:scale-95 ${
                    active
                      ? `${color} bg-white border-current`
                      : 'text-text-faint border-border-default hover:border-text-muted hover:text-text-muted'
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
