'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { Button, ToastContainer } from '@/components/ui';
import { Lightbulb } from 'lucide-react';
import { PeriodListTable } from '@/components/settings/forms';
import {
  getFormPeriods,
  publishPeriod,
  unpublishPeriod,
  deletePeriodWithCheck,
  archivePeriod,
  unarchivePeriod,
  getResponseCountByPeriod,
} from '@/lib/api/form-periods';
import { ZoukomaPeriodEditor } from '@/components/forms/zoukoma/ZoukomaPeriodEditor';
import { MogiPeriodEditor } from '@/components/forms/mogi/MogiPeriodEditor';
import { MoshiPeriodEditor } from '@/components/forms/moshi/MoshiPeriodEditor';
import { SoudanPeriodEditor } from '@/components/forms/soudan/SoudanPeriodEditor';
import { ShukaisuPeriodEditor } from '@/components/forms/shukaisu/ShukaisuPeriodEditor';
import { YoubiPeriodEditor } from '@/components/forms/youbi/YoubiPeriodEditor';
import type { FormPeriod } from '@/types/database';
import type { FormType } from '@/types/database';
import { FORM_TYPE_LABELS } from '@/types/database';
import type { ZoukomaPeriod } from '@/types/forms/zoukoma';
import type { MogiPeriod } from '@/types/forms/mogi';
import type { MoshiPeriod } from '@/types/forms/moshi';
import type { SoudanPeriod } from '@/types/forms/soudan';
import type { ShukaisuPeriod } from '@/types/forms/shukaisu';
import type { YoubiPeriod } from '@/types/forms/youbi';
import { useToast } from '@/hooks/useToast';
import { useAuth } from '@/contexts/AuthContext';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { useMasterData } from '@/contexts/MasterDataContext';

const SUPPORTED_FORM_TYPES: FormType[] = [
  'zoukoma',
  'mogi',
  'moshi',
  'soudan',
  'shukaisu',
  'youbi',
];

export default function FormPeriodsPage() {
  const params = useParams();
  const formType = params.formType as string;
  const { getSelectedSchoolIds } = useAuth();
  const { schools: masterSchools } = useMasterData();
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessSettings
  );

  const [periods, setPeriods] = useState<FormPeriod[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<FormPeriod | null | 'new'>(null);
  const [allowedSchoolsList, setAllowedSchoolsList] = useState<{ id: string; name: string }[]>([]);
  const { toasts, removeToast, success, error } = useToast();

  const selectedSchoolIds = getSelectedSchoolIds();
  const schoolId = selectedSchoolIds[0] ?? '';
  const isMultiSchool = selectedSchoolIds.length > 1;

  useEffect(() => {
    if (!isMultiSchool) {
      setAllowedSchoolsList([]);
      return;
    }
    const list = masterSchools
      .filter((s) => selectedSchoolIds.includes(s.id))
      .map((s) => ({ id: s.id, name: s.name }));
    setAllowedSchoolsList(list);
  }, [isMultiSchool, selectedSchoolIds.join(','), masterSchools]);
  const formTypeValid = SUPPORTED_FORM_TYPES.includes(formType as FormType);
  const formLabel = FORM_TYPE_LABELS[formType as FormType] ?? formType;

  const fetchPeriods = useCallback(async () => {
    if (!schoolId || !formTypeValid) return;
    setIsLoading(true);
    setErrorMessage('');
    try {
      const data = await getFormPeriods(schoolId, formType as FormType, showArchived, true);
      setPeriods(data);
    } catch (err) {
      console.error('Error fetching periods:', err);
      setErrorMessage(
        err instanceof Error ? err.message : '期間一覧の取得に失敗しました'
      );
    } finally {
      setIsLoading(false);
    }
  }, [schoolId, formType, formTypeValid, showArchived]);

  useEffect(() => {
    if (schoolId && formTypeValid) {
      fetchPeriods();
    }
  }, [fetchPeriods, schoolId, formTypeValid]);

  const getResponseCount = useCallback(
    async (periodKey: string) => {
      return getResponseCountByPeriod(schoolId, formType as FormType, periodKey);
    },
    [schoolId, formType]
  );

  const handlePublish = async (period: FormPeriod) => {
    try {
      setIsSubmitting(true);
      await publishPeriod(period.id, schoolId, formType as FormType);
      await fetchPeriods();
      success('期間を公開しました');
    } catch (err) {
      error(err instanceof Error ? err.message : '公開に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUnpublish = async (period: FormPeriod) => {
    try {
      setIsSubmitting(true);
      await unpublishPeriod(period.id);
      await fetchPeriods();
      success('期間を非公開にしました');
    } catch (err) {
      error(err instanceof Error ? err.message : '非公開に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (period: FormPeriod) => {
    try {
      await deletePeriodWithCheck(period.id, period.period_key, formType as FormType, schoolId);
      await fetchPeriods();
      success('期間を削除しました');
    } catch (err) {
      error(err instanceof Error ? err.message : '削除に失敗しました');
    }
  };

  const handleArchive = async (period: FormPeriod) => {
    try {
      setIsSubmitting(true);
      await archivePeriod(period.id, schoolId, formType as FormType, period.period_key);
      await fetchPeriods();
      success('期間をアーカイブしました');
    } catch (err) {
      error(err instanceof Error ? err.message : 'アーカイブに失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUnarchive = async (period: FormPeriod) => {
    try {
      setIsSubmitting(true);
      const result = await unarchivePeriod(
        period.id,
        schoolId,
        formType as FormType,
        period.period_key
      );
      await fetchPeriods();
      success(`元に戻しました（回答${result.responsesUnarchived}件を含む）`);
    } catch (err) {
      error(err instanceof Error ? err.message : 'アーカイブ解除に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditSuccess = () => {
    setEditingPeriod(null);
    fetchPeriods();
    success('期間を保存しました');
  };

  if (permissionLoading) {
    return (
      <AdminLayout narrow>
        <div className="flex items-center justify-center min-h-[60vh]">
          <p className="text-[#4b5563]">読み込み中...</p>
        </div>
      </AdminLayout>
    );
  }

  if (!hasPermission) {
    return (
      <AdminLayout narrow>
        <AccessDenied message="設定ページは教室長以上のみアクセス可能です" />
      </AdminLayout>
    );
  }

  if (!formTypeValid) {
    return (
      <AdminLayout narrow>
        <div className="max-w-3xl mx-auto px-4 py-8">
          <p className="text-[#ef4444]">このフォーム種別は期間管理に対応していません。</p>
          <Link href="/settings/portal" className="text-[#3b82f6] hover:underline mt-2 inline-block">
            ← ポータル設定に戻る
          </Link>
        </div>
      </AdminLayout>
    );
  }

  return (
    <>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <AdminLayout headerTitle={`${formLabel} - 期間管理`} narrow>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Link
            href="/settings/portal"
            className="inline-flex items-center text-sm text-[#3b82f6] hover:underline mb-6"
          >
            ← ポータル設定に戻る
          </Link>

          {errorMessage && (
            <div className="mb-4 p-4 bg-[#ef4444]/20 border border-[#ef4444] rounded-lg">
              <p className="text-sm text-[#ef4444]">{errorMessage}</p>
            </div>
          )}

          {isMultiSchool && (
            <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              <p className="font-medium mb-1">複数教室を選択中です</p>
              <p>
                新しい期間を作成すると、選択中の{selectedSchoolIds.length}教室に同じ期間が一括で作成されます。編集時に「他教室も同じ内容で更新」にチェックを入れると、選択中の全教室の同じ期間が更新されます。
              </p>
            </div>
          )}
          <div className="mb-6 p-4 bg-[#eff6ff] border border-[#3b82f6]/30 rounded-lg text-sm text-[#1e40af]">
            <p className="font-medium mb-1 flex items-center gap-1"><Lightbulb className="h-4 w-4" />公開できる期間は1つだけです。</p>
            <p>
              新しい期間を公開すると、現在公開中の期間は自動で非公開になります。
            </p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-[#4b5563]">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="rounded border-[#e5e7eb]"
              />
              アーカイブ済みを表示
            </label>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setEditingPeriod('new')}
              disabled={isSubmitting}
            >
              ＋ 新しい期間を作成
            </Button>
          </div>

          {isLoading ? (
            <div className="bg-white rounded-xl border border-[#e5e7eb] p-8 text-center">
              <p className="text-[#4b5563]">読み込み中...</p>
            </div>
          ) : periods.length === 0 ? (
            <div className="bg-white rounded-xl border border-[#e5e7eb] p-8 text-center text-[#4b5563]">
              期間がありません。「＋ 新しい期間を作成」から追加してください。
            </div>
          ) : (
            <PeriodListTable
              periods={periods}
              formType={formType}
              schoolId={schoolId}
              onEdit={(period) => setEditingPeriod(period)}
              onPublish={handlePublish}
              onUnpublish={handleUnpublish}
              onDelete={handleDelete}
              onArchive={handleArchive}
              onUnarchive={handleUnarchive}
              getResponseCount={getResponseCount}
              isSubmitting={isSubmitting}
            />
          )}
        </div>
      </AdminLayout>

      {/* 期間編集モーダル（フォーム種別ごと） */}
      {formType === 'zoukoma' && (editingPeriod === 'new' || editingPeriod) && (
        <ZoukomaPeriodEditor
          isOpen
          period={editingPeriod === 'new' ? null : (editingPeriod as ZoukomaPeriod)}
          schoolId={schoolId}
          schoolIds={isMultiSchool ? selectedSchoolIds : undefined}
          allowedSchools={isMultiSchool ? allowedSchoolsList : undefined}
          onClose={() => setEditingPeriod(null)}
          onSuccess={handleEditSuccess}
        />
      )}
      {formType === 'mogi' && (editingPeriod === 'new' || editingPeriod) && (
        <MogiPeriodEditor
          isOpen
          period={editingPeriod === 'new' ? null : (editingPeriod as MogiPeriod)}
          schoolId={schoolId}
          schoolIds={isMultiSchool ? selectedSchoolIds : undefined}
          allowedSchools={isMultiSchool ? allowedSchoolsList : undefined}
          onClose={() => setEditingPeriod(null)}
          onSuccess={handleEditSuccess}
        />
      )}
      {formType === 'moshi' && (editingPeriod === 'new' || editingPeriod) && (
        <MoshiPeriodEditor
          isOpen
          period={editingPeriod === 'new' ? null : (editingPeriod as unknown as MoshiPeriod)}
          schoolId={schoolId}
          schoolIds={isMultiSchool ? selectedSchoolIds : undefined}
          allowedSchools={isMultiSchool ? allowedSchoolsList : undefined}
          onClose={() => setEditingPeriod(null)}
          onSuccess={handleEditSuccess}
        />
      )}
      {formType === 'soudan' && (editingPeriod === 'new' || editingPeriod) && (
        <SoudanPeriodEditor
          isOpen
          period={editingPeriod === 'new' ? null : (editingPeriod as unknown as SoudanPeriod)}
          schoolId={schoolId}
          schoolIds={isMultiSchool ? selectedSchoolIds : undefined}
          allowedSchools={isMultiSchool ? allowedSchoolsList : undefined}
          onClose={() => setEditingPeriod(null)}
          onSuccess={handleEditSuccess}
        />
      )}
      {formType === 'shukaisu' && (editingPeriod === 'new' || editingPeriod) && (
        <ShukaisuPeriodEditor
          isOpen
          period={editingPeriod === 'new' ? null : (editingPeriod as unknown as ShukaisuPeriod)}
          schoolId={schoolId}
          schoolIds={isMultiSchool ? selectedSchoolIds : undefined}
          allowedSchools={isMultiSchool ? allowedSchoolsList : undefined}
          onClose={() => setEditingPeriod(null)}
          onSuccess={handleEditSuccess}
        />
      )}
      {formType === 'youbi' && (editingPeriod === 'new' || editingPeriod) && (
        <YoubiPeriodEditor
          isOpen
          period={editingPeriod === 'new' ? null : (editingPeriod as unknown as YoubiPeriod)}
          schoolId={schoolId}
          schoolIds={isMultiSchool ? selectedSchoolIds : undefined}
          allowedSchools={isMultiSchool ? allowedSchoolsList : undefined}
          onClose={() => setEditingPeriod(null)}
          onSuccess={handleEditSuccess}
        />
      )}
    </>
  );
}
