import {
  getFormPeriods,
  getActiveFormPeriod,
  getFormPeriod,
  getFormPeriodByKey,
  createFormPeriod,
  updateFormPeriod,
  deleteFormPeriod,
  archivePeriod,
  unarchivePeriod,
} from './form-periods';
import { getFormResponse, updateFormResponseStatus } from './form-responses';
import { syncFormResponseToBilling } from './billing';
import { getDefaultSchoolId, getSchoolByCode } from './schools';
import type { FormPeriodInsert, FormPeriodUpdate, FormType } from '@/types/database';

/**
 * 各フォーム（Vもぎ・模試・週回数・曜日・お客様相談）の期間管理APIは、
 * form_type と settings の型が違うだけで処理は完全に同一だった。
 * そのコピペを1か所に集約するためのファクトリ。
 *
 * 使い方: `const api = createPeriodApi<'mogi', MogiPeriod>('mogi')` のように
 * フォーム種別リテラルと、そのフォームの Period 型を渡す。返ってきた関数を
 * 各 *.ts で `export const getMogiPeriods = api.getPeriods` のように既存名で
 * 再エクスポートすることで、呼び出し側を一切変えずに重複を解消できる。
 *
 * 注意: zoukoma だけは getDefaultSchoolId の扱い・作成時バリデーション・update の
 * シグネチャが独自仕様のため、このファクトリには載せていない（zoukoma.ts を参照）。
 *
 * @typeParam TFormType - フォーム種別リテラル（'mogi' 等）
 * @typeParam TPeriod   - そのフォームの Period 型（MogiPeriod 等）。戻り値の型に使う
 */
export function createPeriodApi<TFormType extends FormType, TPeriod>(formType: TFormType) {
  // DB から来た汎用 FormPeriod を、フォーム固有の Period 型へ整える。
  // settings は JSON カラムなので各フォームの設定型へキャストする。
  const decorate = (period: { settings: Record<string, unknown> }): TPeriod =>
    ({
      ...period,
      form_type: formType,
      settings: period.settings || {},
    }) as unknown as TPeriod;

  /** 期間一覧を取得（schoolId 省略時はデフォルト校） */
  async function getPeriods(schoolId?: string, includeArchived = false): Promise<TPeriod[]> {
    const targetSchoolId = schoolId || getDefaultSchoolId();
    const periods = await getFormPeriods(targetSchoolId, formType, includeArchived);
    return periods.map(decorate);
  }

  /** 公開中の期間を取得（ポータル用、schoolCode 起点） */
  async function getActivePeriod(schoolCode: string): Promise<TPeriod | null> {
    const school = await getSchoolByCode(schoolCode);
    if (!school) return null;
    const period = await getActiveFormPeriod(school.id, formType);
    return period ? decorate(period) : null;
  }

  /** 期間を1件取得（form_type が一致しなければ null） */
  async function getPeriod(id: string): Promise<TPeriod | null> {
    const period = await getFormPeriod(id);
    if (!period || period.form_type !== formType) return null;
    return decorate(period);
  }

  /** 期間を period_key で取得（プレビュー用） */
  async function getPeriodByKey(schoolId: string, periodKey: string): Promise<TPeriod | null> {
    const period = await getFormPeriodByKey(schoolId, formType, periodKey);
    return period ? decorate(period) : null;
  }

  /** 期間を作成（school_id 省略時はデフォルト校） */
  async function createPeriod(
    data: Omit<FormPeriodInsert, 'school_id' | 'form_type'>,
    schoolId?: string
  ): Promise<TPeriod> {
    const targetSchoolId = schoolId ?? getDefaultSchoolId();
    const period = await createFormPeriod({
      ...data,
      school_id: targetSchoolId,
      form_type: formType,
      settings: (data.settings || {}) as unknown as Record<string, unknown>,
    });
    return decorate(period);
  }

  /** 期間を更新 */
  async function updatePeriod(id: string, data: FormPeriodUpdate): Promise<TPeriod> {
    const period = await updateFormPeriod(id, {
      ...data,
      settings: data.settings ? (data.settings as unknown as Record<string, unknown>) : undefined,
    });
    return decorate(period);
  }

  /** 期間を削除 */
  async function deletePeriod(id: string): Promise<void> {
    await deleteFormPeriod(id);
  }

  /** 期間をアーカイブ（紐づく回答もまとめてアーカイブ） */
  async function archive(
    id: string,
    schoolId: string,
    periodKey: string
  ): Promise<{ periodArchived: boolean; responsesArchived: number }> {
    return archivePeriod(id, schoolId, formType, periodKey);
  }

  /** 期間のアーカイブを解除 */
  async function unarchive(
    id: string,
    schoolId: string,
    periodKey: string
  ): Promise<{ periodUnarchived: boolean; responsesUnarchived: number }> {
    return unarchivePeriod(id, schoolId, formType, periodKey);
  }

  return {
    getPeriods,
    getActivePeriod,
    getPeriod,
    getPeriodByKey,
    createPeriod,
    updatePeriod,
    deletePeriod,
    archive,
    unarchive,
  };
}

/**
 * 回答の計上状態(charged)を status_checks にマージして更新し、請求側の is_billed へ同期する。
 * Vもぎ・模試・お客様相談で共通の処理（同期失敗は警告のみで握りつぶす）。
 */
export async function updateChargedStatusWithBilling(
  responseId: string,
  charged: boolean
): Promise<void> {
  const response = await getFormResponse(responseId);
  const current = (response?.status_checks || {}) as Record<string, boolean>;
  await updateFormResponseStatus(responseId, { ...current, charged });
  // 請求側の is_billed へ同期（AND判定）
  try {
    await syncFormResponseToBilling(responseId);
  } catch (err) {
    console.warn('請求への計上同期に失敗:', err);
  }
}

/**
 * 回答の status_checks（charged / seated）を部分マージして更新する。
 * 週回数変更・曜日変更で共通。charged が含まれるときだけ請求側へ同期する。
 */
export async function updateStatusChecksWithBilling(
  responseId: string,
  statusChecks: { charged?: boolean; seated?: boolean }
): Promise<void> {
  const response = await getFormResponse(responseId);
  if (!response) throw new Error('回答が見つかりません');
  const current = (response.status_checks || {}) as Record<string, boolean>;
  await updateFormResponseStatus(responseId, { ...current, ...statusChecks });
  // charged が含まれる場合のみ請求側へ同期
  if (statusChecks.charged !== undefined) {
    try {
      await syncFormResponseToBilling(responseId);
    } catch (err) {
      console.warn('請求への計上同期に失敗:', err);
    }
  }
}
