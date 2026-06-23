/**
 * form-period-api（フォーム期間APIのファクトリ）のテスト
 *
 * 5フォーム(mogi/moshi/shukaisu/soudan/youbi)の期間CRUD重複を集約した中核モジュール。
 * 共通層(form-periods / form-responses / billing / schools)をモックし、
 * ファクトリが「正しい form_type を渡し、settings を decorate し、デフォルト校を補う」こと、
 * 共通ステータス更新ヘルパーが「status_checks をマージし、charged 時のみ請求同期する」ことを検証する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api/form-periods', () => ({
  getFormPeriods: vi.fn(),
  getActiveFormPeriod: vi.fn(),
  getFormPeriod: vi.fn(),
  getFormPeriodByKey: vi.fn(),
  createFormPeriod: vi.fn(),
  updateFormPeriod: vi.fn(),
  deleteFormPeriod: vi.fn(),
  archivePeriod: vi.fn(),
  unarchivePeriod: vi.fn(),
}));
vi.mock('@/lib/api/form-responses', () => ({
  getFormResponse: vi.fn(),
  updateFormResponseStatus: vi.fn(),
}));
vi.mock('@/lib/api/billing', () => ({
  syncFormResponseToBilling: vi.fn(),
}));
vi.mock('@/lib/api/schools', () => ({
  getDefaultSchoolId: vi.fn(() => 'default-school'),
  getSchoolByCode: vi.fn(),
}));

import * as formPeriods from '@/lib/api/form-periods';
import * as formResponses from '@/lib/api/form-responses';
import * as billing from '@/lib/api/billing';
import * as schools from '@/lib/api/schools';
import {
  createPeriodApi,
  updateChargedStatusWithBilling,
  updateStatusChecksWithBilling,
} from '@/lib/api/form-period-api';

// DB から返る汎用 FormPeriod 行のサンプル（settings はJSONカラム）
const dbPeriod = {
  id: 'p1',
  school_id: 's1',
  form_type: 'mogi',
  period_key: '2026-06',
  title: 'テスト期間',
  settings: { foo: 1 },
  publish_start: null,
  publish_end: null,
  is_active: true,
  linked_application_item_id: null,
  is_archived: false,
  archived_at: null,
  created_at: '2026-06-01',
  updated_at: '2026-06-01',
};

// テスト用の最小 Period 型（decorate 後に検証するフィールドだけ持てばよい）
type TestPeriod = {
  id: string;
  school_id: string;
  form_type: 'mogi';
  period_key: string;
  settings: { foo?: number };
};
const api = createPeriodApi<'mogi', TestPeriod>('mogi');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createPeriodApi - 期間取得', () => {
  it('getPeriods は form_type を渡し、settings を decorate して返す', async () => {
    vi.mocked(formPeriods.getFormPeriods).mockResolvedValue([dbPeriod] as never);

    const result = await api.getPeriods('s1');

    expect(formPeriods.getFormPeriods).toHaveBeenCalledWith('s1', 'mogi', false);
    expect(result[0].form_type).toBe('mogi');
    expect(result[0].settings).toEqual({ foo: 1 });
  });

  it('getPeriods は schoolId 省略時にデフォルト校を補う', async () => {
    vi.mocked(formPeriods.getFormPeriods).mockResolvedValue([] as never);

    await api.getPeriods();

    expect(schools.getDefaultSchoolId).toHaveBeenCalled();
    expect(formPeriods.getFormPeriods).toHaveBeenCalledWith('default-school', 'mogi', false);
  });

  it('getPeriod は form_type が一致しなければ null を返す', async () => {
    vi.mocked(formPeriods.getFormPeriod).mockResolvedValue({
      ...dbPeriod,
      form_type: 'moshi',
    } as never);

    expect(await api.getPeriod('p1')).toBeNull();
  });

  it('getPeriod は form_type 一致時に decorate して返す', async () => {
    vi.mocked(formPeriods.getFormPeriod).mockResolvedValue(dbPeriod as never);

    const result = await api.getPeriod('p1');

    expect(result?.form_type).toBe('mogi');
    expect(result?.settings).toEqual({ foo: 1 });
  });

  it('getActivePeriod は学校が見つからなければ null を返す', async () => {
    vi.mocked(schools.getSchoolByCode).mockResolvedValue(null as never);

    expect(await api.getActivePeriod('UNKNOWN')).toBeNull();
    expect(formPeriods.getActiveFormPeriod).not.toHaveBeenCalled();
  });
});

describe('createPeriodApi - 作成/更新/アーカイブ', () => {
  it('createPeriod は school_id と form_type を注入する', async () => {
    vi.mocked(formPeriods.createFormPeriod).mockResolvedValue(dbPeriod as never);

    await api.createPeriod({
      period_key: '2026-07',
      title: '',
      settings: {},
      publish_start: null,
      publish_end: null,
      is_active: false,
      linked_application_item_id: null,
    });

    expect(formPeriods.createFormPeriod).toHaveBeenCalledWith(
      expect.objectContaining({ school_id: 'default-school', form_type: 'mogi' })
    );
  });

  it('archive / unarchive は form_type を付けて共通APIへ委譲する', async () => {
    vi.mocked(formPeriods.archivePeriod).mockResolvedValue({
      periodArchived: true,
      responsesArchived: 3,
    } as never);
    vi.mocked(formPeriods.unarchivePeriod).mockResolvedValue({
      periodUnarchived: true,
      responsesUnarchived: 3,
    } as never);

    await api.archive('p1', 's1', '2026-06');
    await api.unarchive('p1', 's1', '2026-06');

    expect(formPeriods.archivePeriod).toHaveBeenCalledWith('p1', 's1', 'mogi', '2026-06');
    expect(formPeriods.unarchivePeriod).toHaveBeenCalledWith('p1', 's1', 'mogi', '2026-06');
  });
});

describe('updateChargedStatusWithBilling', () => {
  it('既存 status_checks に charged をマージし、請求へ同期する', async () => {
    vi.mocked(formResponses.getFormResponse).mockResolvedValue({
      status_checks: { seated: true },
    } as never);

    await updateChargedStatusWithBilling('r1', true);

    expect(formResponses.updateFormResponseStatus).toHaveBeenCalledWith('r1', {
      seated: true,
      charged: true,
    });
    expect(billing.syncFormResponseToBilling).toHaveBeenCalledWith('r1');
  });

  it('請求同期が失敗しても例外を投げない（警告のみ）', async () => {
    vi.mocked(formResponses.getFormResponse).mockResolvedValue({ status_checks: {} } as never);
    vi.mocked(billing.syncFormResponseToBilling).mockRejectedValue(new Error('boom'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(updateChargedStatusWithBilling('r1', true)).resolves.toBeUndefined();

    warn.mockRestore();
  });
});

describe('updateStatusChecksWithBilling', () => {
  it('回答が見つからなければ例外を投げる', async () => {
    vi.mocked(formResponses.getFormResponse).mockResolvedValue(null as never);

    await expect(updateStatusChecksWithBilling('r1', { seated: true })).rejects.toThrow(
      '回答が見つかりません'
    );
  });

  it('charged を含まない更新では請求同期しない', async () => {
    vi.mocked(formResponses.getFormResponse).mockResolvedValue({ status_checks: {} } as never);

    await updateStatusChecksWithBilling('r1', { seated: true });

    expect(formResponses.updateFormResponseStatus).toHaveBeenCalledWith('r1', { seated: true });
    expect(billing.syncFormResponseToBilling).not.toHaveBeenCalled();
  });

  it('charged を含む更新では請求同期する', async () => {
    vi.mocked(formResponses.getFormResponse).mockResolvedValue({
      status_checks: { seated: true },
    } as never);

    await updateStatusChecksWithBilling('r1', { charged: true });

    expect(formResponses.updateFormResponseStatus).toHaveBeenCalledWith('r1', {
      seated: true,
      charged: true,
    });
    expect(billing.syncFormResponseToBilling).toHaveBeenCalledWith('r1');
  });
});
