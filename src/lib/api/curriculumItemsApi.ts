import { supabase } from '../supabase';

/**
 * 教材マスタの単元の使用状況確認・削除・付け替えを行うサーバーAPI（/api/curriculum-items）の
 * クライアント側ラッパー。
 *
 * ブラウザから直接 supabase を叩かない理由はサーバー側のコメントを参照（教室スコープの RLS で
 * 他教室の参照が見えず、件数も削除も嘘になるため）。
 */

/** 単元1件がどこで何行使われているか */
export interface CurriculumItemUsage {
  /** 進行表（student_progress）。1行＝生徒1人分。これがあると DB が削除を拒否する */
  progress: number;
  /** テスト対策提案書（test_prep_proposal_units）。これも削除を拒否する */
  testPrep: number;
  /** 講習提案書（seasonal_proposal_units）。削除は通るが道連れで消える */
  seasonalProposal: number;
  /** 講習カリキュラム（seasonal_course_curriculum）。削除は通るが道連れで消える */
  seasonalCourse: number;
  /**
   * 授業報告の指導単元（lesson_report_units.curriculum_item_ids）。
   * 配列で持っていて外部キーが無いため DB は削除を止めない。放置すると
   * 存在しないIDが配列に残るので、参照ごと削除・付け替え時に一緒に書き換える。
   */
  lessonReport: number;
}

export interface BlockedCurriculumItem {
  id: number;
  usage: CurriculumItemUsage;
}

export const emptyCurriculumItemUsage = (): CurriculumItemUsage => ({
  progress: 0,
  testPrep: 0,
  seasonalProposal: 0,
  seasonalCourse: 0,
  lessonReport: 0,
});

/** 削除を拒否される参照を持っているか（進行表・テスト対策提案書） */
export function isCurriculumItemBlocked(usage: CurriculumItemUsage): boolean {
  return usage.progress > 0 || usage.testPrep > 0;
}

/** 何かしらの参照があるか（道連れで消える講習系・授業報告も含む） */
export function hasCurriculumItemUsage(usage: CurriculumItemUsage): boolean {
  return (
    usage.progress > 0 ||
    usage.testPrep > 0 ||
    usage.seasonalProposal > 0 ||
    usage.seasonalCourse > 0 ||
    usage.lessonReport > 0
  );
}

/** 使用状況を合算する（一括操作の集計表示用） */
export function sumCurriculumItemUsage(list: CurriculumItemUsage[]): CurriculumItemUsage {
  return list.reduce((acc, u) => {
    acc.progress += u.progress;
    acc.testPrep += u.testPrep;
    acc.seasonalProposal += u.seasonalProposal;
    acc.seasonalCourse += u.seasonalCourse;
    acc.lessonReport += u.lessonReport;
    return acc;
  }, emptyCurriculumItemUsage());
}

async function callApi<T>(body: Record<string, unknown>): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('認証が必要です。ログインし直してください。');

  const res = await fetch('/api/curriculum-items', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    cache: 'no-store',
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || '操作に失敗しました');
  return data as T;
}

/** 単元の使用状況を取得する（全教室横断の正確な件数） */
export async function getCurriculumItemsUsage(
  ids: number[]
): Promise<Record<number, CurriculumItemUsage>> {
  if (ids.length === 0) return {};
  const data = await callApi<{ usage: Record<number, CurriculumItemUsage> }>({
    action: 'usage',
    ids,
  });
  return data.usage;
}

/**
 * 単元を削除する。使用中（進行表・テスト対策提案書から参照されている）ものは
 * 削除せずスキップして blocked に返す。途中で中断しないので部分削除に気づけないことがない。
 */
export async function deleteCurriculumItems(ids: number[]): Promise<{
  deleted: number[];
  blocked: BlockedCurriculumItem[];
}> {
  return callApi({ action: 'delete', ids });
}

/**
 * 参照ごと削除する（admin / owner 限定）。
 * 進行表・テスト対策提案書の該当行を消してから単元を削除するため、講評や引継ぎも失われる。
 */
export async function forceDeleteCurriculumItems(ids: number[]): Promise<{
  deleted: number[];
  removed: CurriculumItemUsage;
}> {
  return callApi({ action: 'force_delete', ids });
}

/**
 * 単元を別の単元にまとめる（付け替え、admin / owner 限定）。
 * 参照を toId に移してから fromIds を削除する。
 * 誤・正の両方を持つ生徒/提案書は「正しい単元（toId）側を残す」で解消する。
 */
export async function mergeCurriculumItems(
  fromIds: number[],
  toId: number
): Promise<{ merged: number[]; toId: number; moved: number; dropped: number }> {
  return callApi({ action: 'merge', fromIds, toId });
}
