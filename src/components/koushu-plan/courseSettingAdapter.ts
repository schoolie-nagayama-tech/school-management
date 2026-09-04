/**
 * 単元ドラフト（UnitDraft）と講習テンプレートの単元設定（seasonal_course_curriculum）の相互変換。
 *
 * 提案書とテンプレートは同じ「単元 × コマ数 × 結合」を扱うが、保存形が2点だけ違う:
 *
 *   1. 結合の表し方   … 提案書 `group_id: number`(0=なし) / テンプレ `group_number: number | null`(null=なし)
 *   2. 結合内のコマ数 … テンプレは **先頭の単元にだけ値を入れ、残りは0** にする（先頭のみ規約）
 *
 * 2 が重要。読み出し側 `convertToCourseCurriculumRows` はグループ内の proposal_count を
 * **合計** して1グループのコマ数とするため、全メンバーに値を入れるとコマ数が membership 倍に膨らむ。
 * 変換をこの1か所に集約して、書き手ごとに規約がぶれるのを防ぐ。
 */
import type { UnitDraft } from '@/components/proposals/proposalEditor.shared';
import type { DraftMap } from './unitDraftLogic';

/** seasonal_course_curriculum に書き込む1行ぶん */
export interface CourseCurriculumSetting {
  curriculum_item_id: number;
  proposal_count: number;
  group_number: number | null;
}

/** 変換元として最低限必要なフィールド（提案書の unit でもドラフトでも受けられるように緩くする） */
export interface UnitLike {
  curriculum_item_id: number;
  koma_count: number;
  group_id: number;
}

/**
 * 単元ドラフト → テンプレートの単元設定。
 *
 * - 並び順は `orderedIds`（画面に出ている順）に従う。どれが「グループの先頭」かはこの順で決まる。
 * - グループのコマ数は**先頭メンバーの koma_count** を採用する。
 *   合計計算 `calcTotalKoma` もグループを最初に見つけた1件で数えるので、両者の結果が一致する。
 * - コマ0でもグループに属する単元は書き出す。捨てるとグループの片割れが欠けて結合が壊れる。
 */
export function draftsToCourseSettings(
  units: UnitLike[],
  orderedIds: number[]
): CourseCurriculumSetting[] {
  const byId = new Map<number, UnitLike>();
  for (const u of units) byId.set(u.curriculum_item_id, u);

  const result: CourseCurriculumSetting[] = [];
  // 各グループで先頭に来た単元を覚える（2件目以降は 0 を書く）
  const groupHeadSeen = new Set<number>();

  for (const id of orderedIds) {
    const u = byId.get(id);
    if (!u) continue;

    const inGroup = u.group_id > 0;
    if (!inGroup) {
      if (u.koma_count <= 0) continue;
      result.push({
        curriculum_item_id: id,
        proposal_count: u.koma_count,
        group_number: null,
      });
      continue;
    }

    const isHead = !groupHeadSeen.has(u.group_id);
    if (isHead) groupHeadSeen.add(u.group_id);
    result.push({
      curriculum_item_id: id,
      // 先頭のみ規約。読み出し側がグループ内を合計するため、残りは必ず0にする
      proposal_count: isHead ? u.koma_count : 0,
      group_number: u.group_id,
    });
  }

  return result;
}

/**
 * テンプレートの単元設定 → 単元ドラフト（ひな形取込）。
 *
 * - `group_number` は既存のドラフトと衝突しないよう `startGroupId` から振り直す。
 * - 未グループかつ0コマの単元は取り込まない（使わない単元）。
 * - グループ内は0コマでも1コマ扱いで有効化する。合計はグループで1回しか数えないので増えない。
 *
 * @returns 更新後のドラフトと、次に使えるグループID
 */
export function courseSettingsToDrafts(
  base: DraftMap,
  settings: CourseCurriculumSetting[],
  startGroupId: number
): { drafts: DraftMap; nextGroupId: number } {
  // 採番を先に済ませる（React の updater は複数回呼ばれ得るので、副作用を外に出す）
  let nextGroupId = startGroupId;
  const groupRemap = new Map<number, number>();
  for (const s of settings) {
    const g = s.group_number;
    if (g != null && g > 0 && !groupRemap.has(g)) {
      groupRemap.set(g, nextGroupId);
      nextGroupId++;
    }
  }

  const drafts = new Map(base);
  for (const s of settings) {
    const inGroup = s.group_number != null && s.group_number > 0;
    if (s.proposal_count <= 0 && !inGroup) continue;
    const d = drafts.get(s.curriculum_item_id);
    if (!d) continue;

    drafts.set(s.curriculum_item_id, {
      ...d,
      koma_count: inGroup ? s.proposal_count || 1 : s.proposal_count,
      group_id: inGroup ? groupRemap.get(s.group_number as number)! : 0,
      selected: d.selected,
    } as UnitDraft);
  }

  return { drafts, nextGroupId };
}
