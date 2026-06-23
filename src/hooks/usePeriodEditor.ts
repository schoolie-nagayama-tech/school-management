'use client';

import { useState, useEffect, useCallback } from 'react';
import { getFormPeriods, deletePeriodWithCheck, archivePeriod } from '@/lib/api/form-periods';
import type { FormPeriod, FormType } from '@/types/database';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsePeriodEditorOptions {
  formType: string;
  schoolIds: string[];
}

export interface UsePeriodEditorReturn {
  periods: FormPeriod[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  handleCreate: (data: PeriodSaveData) => Promise<void>;
  handleUpdate: (id: string, data: PeriodSaveData) => Promise<void>;
  handleDelete: (id: string) => Promise<void>;
  handleArchive: (id: string) => Promise<void>;
}

/**
 * Data passed to save operations.
 * This is a superset that covers all fields used across the various
 * form-type editors. Each editor composes the object it needs.
 */
export interface PeriodSaveData {
  period_key?: string;
  title: string;
  settings: Record<string, unknown>;
  publish_start: string | null;
  publish_end: string | null;
  is_active: boolean;
  linked_application_item_id: string | null;
}

// ---------------------------------------------------------------------------
// Shared submission helpers
// ---------------------------------------------------------------------------

/**
 * Determines which school IDs to target for a multi-school update.
 *
 * This logic was duplicated across all 6 period editors. It resolves
 * the correct set of IDs based on the combination of allowedSchools,
 * schoolIds, applyToAllSchools and selectedSchoolIdsForUpdate state.
 */
export function resolveUpdateSchoolIds(opts: {
  allowedSchools?: { id: string; name: string }[];
  selectedSchoolIdsForUpdate: string[];
  schoolIds?: string[];
  applyToAllSchools: boolean;
}): string[] | null {
  const { allowedSchools, selectedSchoolIdsForUpdate, schoolIds, applyToAllSchools } = opts;
  if (allowedSchools && allowedSchools.length > 1) {
    return selectedSchoolIdsForUpdate;
  }
  if (schoolIds && schoolIds.length > 1 && applyToAllSchools) {
    return schoolIds;
  }
  return null;
}

/**
 * Determines which school IDs to target for a multi-school create.
 */
export function resolveCreateSchoolIds(opts: {
  allowedSchools?: { id: string; name: string }[];
  selectedSchoolIdsForCreate: string[];
  schoolIds?: string[];
}): string[] | null {
  const { allowedSchools, selectedSchoolIdsForCreate, schoolIds } = opts;
  if (allowedSchools && allowedSchools.length > 1) {
    return selectedSchoolIdsForCreate;
  }
  if (schoolIds && schoolIds.length > 1) {
    return schoolIds;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Shared hook that manages the period list for a specific form type,
 * including CRUD operations with error handling.
 *
 * Editors can use this to avoid duplicating the list-fetching,
 * delete, and archive logic. The `handleCreate` / `handleUpdate`
 * callbacks accept generic `PeriodSaveData` which the caller
 * can use together with `createFormPeriod` / `updateFormPeriod` etc.
 *
 * For form-type-specific save logic (e.g. zoukoma vs moshi), each
 * editor still composes the settings object and calls the correct
 * per-type API. This hook wraps the common parts: state management,
 * error handling, and list refresh.
 */
export function usePeriodEditor({
  formType,
  schoolIds,
}: UsePeriodEditorOptions): UsePeriodEditorReturn {
  const [periods, setPeriods] = useState<FormPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const schoolId = schoolIds[0] ?? '';

  // ---- Fetch periods ----

  const refresh = useCallback(async () => {
    if (!schoolId || !formType) {
      setPeriods([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await getFormPeriods(schoolId, formType as FormType, false, true);
      setPeriods(data);
    } catch (err) {
      console.error('[usePeriodEditor] Error fetching periods:', err);
      setError(getUserErrorMessage(err, '期間一覧の取得に失敗しました'));
    } finally {
      setLoading(false);
    }
  }, [schoolId, formType]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ---- Create ----

  const handleCreate = useCallback(
    async (data: PeriodSaveData) => {
      setError(null);
      try {
        // The actual API call is done by the caller (editor component)
        // before calling this, or the caller can use the low-level
        // `createFormPeriod` directly. This is provided as a convenience
        // wrapper that does refresh + error handling.
        //
        // For now, this is a passthrough that refreshes the list.
        // The editor component handles the actual create call because
        // each form type has its own settings structure.
        void data; // consumed by the caller
        await refresh();
      } catch (err) {
        console.error('[usePeriodEditor] Error creating period:', err);
        setError(getUserErrorMessage(err, '期間の作成に失敗しました'));
        throw err;
      }
    },
    [refresh]
  );

  // ---- Update ----

  const handleUpdate = useCallback(
    async (id: string, data: PeriodSaveData) => {
      setError(null);
      try {
        void id;
        void data;
        await refresh();
      } catch (err) {
        console.error('[usePeriodEditor] Error updating period:', err);
        setError(getUserErrorMessage(err, '期間の更新に失敗しました'));
        throw err;
      }
    },
    [refresh]
  );

  // ---- Delete ----

  const handleDelete = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const period = periods.find((p) => p.id === id);
        if (!period) {
          throw new Error('指定した期間が見つかりません');
        }
        await deletePeriodWithCheck(period.id, period.period_key, formType as FormType, schoolId);
        await refresh();
      } catch (err) {
        console.error('[usePeriodEditor] Error deleting period:', err);
        setError(getUserErrorMessage(err, '期間の削除に失敗しました'));
        throw err;
      }
    },
    [periods, formType, schoolId, refresh]
  );

  // ---- Archive ----

  const handleArchive = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const period = periods.find((p) => p.id === id);
        if (!period) {
          throw new Error('指定した期間が見つかりません');
        }
        await archivePeriod(period.id, schoolId, formType as FormType, period.period_key);
        await refresh();
      } catch (err) {
        console.error('[usePeriodEditor] Error archiving period:', err);
        setError(getUserErrorMessage(err, '期間のアーカイブに失敗しました'));
        throw err;
      }
    },
    [periods, formType, schoolId, refresh]
  );

  return {
    periods,
    loading,
    error,
    refresh,
    handleCreate,
    handleUpdate,
    handleDelete,
    handleArchive,
  };
}
