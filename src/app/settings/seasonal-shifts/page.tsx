'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Button, ToastContainer } from '@/components/ui';
import { ChevronLeft } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import {
  getSeasonalShiftSettings,
  getSeasonalShiftSubmissions,
  deleteSeasonalShiftSetting,
} from '@/lib/api/seasonal-shift';
import {
  getRegularShiftSettings,
  getRegularShiftSubmissions,
  deleteRegularShiftSetting,
} from '@/lib/api/regular-shift';
import type { SeasonalShiftSetting } from '@/types/seasonal-shift';
import type { RegularShiftSetting } from '@/types/regular-shift';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { useLocalSchoolId } from '@/hooks/useLocalSchoolId';
import { SchoolSwitcher } from '@/components/SchoolSwitcher';

type TabType = 'seasonal' | 'regular';

export default function SeasonalShiftsPage() {
  const { toasts, removeToast, success, error } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessPortal ?? false
  );
  const { localSchoolId, setLocalSchoolId, isAllSelected, availableSchools } = useLocalSchoolId();

  const [activeTab, setActiveTab] = useState<TabType>('seasonal');

  // Seasonal shift state
  const [settings, setSettings] = useState<SeasonalShiftSetting[]>([]);
  const [submissionCounts, setSubmissionCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // Regular shift state
  const [regularSettings, setRegularSettings] = useState<RegularShiftSetting[]>([]);
  const [regularSubmissionCounts, setRegularSubmissionCounts] = useState<Record<string, number>>({});
  const [isRegularLoading, setIsRegularLoading] = useState(true);
  const [regularErrorMessage, setRegularErrorMessage] = useState('');

  const fetchSeasonalData = useCallback(async () => {
    if (!localSchoolId) return;
    setIsLoading(true);
    setErrorMessage('');
    try {
      const data = await getSeasonalShiftSettings(localSchoolId);
      setSettings(data);
      const counts: Record<string, number> = {};
      await Promise.all(
        data.map(async (s) => {
          const list = await getSeasonalShiftSubmissions(s.id);
          counts[s.id] = list.length;
        })
      );
      setSubmissionCounts(counts);
    } catch (err) {
      console.error(err);
      setErrorMessage(err instanceof Error ? err.message : 'シフト設定の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [localSchoolId]);

  const fetchRegularData = useCallback(async () => {
    if (!localSchoolId) return;
    setIsRegularLoading(true);
    setRegularErrorMessage('');
    try {
      const data = await getRegularShiftSettings(localSchoolId);
      setRegularSettings(data);
      const counts: Record<string, number> = {};
      await Promise.all(
        data.map(async (s) => {
          const list = await getRegularShiftSubmissions(s.id);
          counts[s.id] = list.length;
        })
      );
      setRegularSubmissionCounts(counts);
    } catch (err) {
      console.error(err);
      setRegularErrorMessage(err instanceof Error ? err.message : '通常シフト設定の取得に失敗しました');
    } finally {
      setIsRegularLoading(false);
    }
  }, [localSchoolId]);

  useEffect(() => {
    fetchSeasonalData();
    fetchRegularData();
  }, [fetchSeasonalData, fetchRegularData]);

  const handleDeleteSeasonal = async (id: string, name: string) => {
    if (!(await confirm({ title: '削除確認', description: `「${name}」を削除してもよろしいですか？`, confirmLabel: '削除', variant: 'danger' }))) return;
    try {
      await deleteSeasonalShiftSetting(id);
      success('シフト設定を削除しました');
      fetchSeasonalData();
    } catch (err) {
      error(err instanceof Error ? err.message : '削除に失敗しました');
    }
  };

  const handleDeleteRegular = async (id: string, name: string) => {
    if (!(await confirm({ title: '削除確認', description: `「${name}」を削除してもよろしいですか？`, confirmLabel: '削除', variant: 'danger' }))) return;
    try {
      await deleteRegularShiftSetting(id);
      success('通常シフト設定を削除しました');
      fetchRegularData();
    } catch (err) {
      error(err instanceof Error ? err.message : '削除に失敗しました');
    }
  };

  const formatDate = (d: string) => {
    const x = new Date(d);
    return `${x.getFullYear()}/${x.getMonth() + 1}/${x.getDate()}`;
  };

  if (permissionLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center min-h-[40vh]">
          <p className="text-[#4b5563]">読み込み中...</p>
        </div>
      </AdminLayout>
    );
  }
  if (!hasPermission) {
    return (
      <AdminLayout>
        <AccessDenied />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="シフト設定">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div className="max-w-[1600px]">
        <div className="mb-4">
          <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-[#6b7280] hover:text-[#1f2937] transition-colors duration-150">
            <ChevronLeft className="w-4 h-4" />
            設定に戻る
          </Link>
        </div>

        {isAllSelected && (
          <SchoolSwitcher
            schools={availableSchools}
            selectedSchoolId={localSchoolId}
            onChange={setLocalSchoolId}
          />
        )}

        {/* Tab Navigation */}
        <div className="flex border-b border-[#e5e7eb] mb-6">
          <button
            type="button"
            onClick={() => setActiveTab('seasonal')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors duration-150 ${
              activeTab === 'seasonal'
                ? 'border-[#d32f2f] text-[#d32f2f]'
                : 'border-transparent text-[#6b7280] hover:text-[#1f2937]'
            }`}
          >
            講習シフト
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('regular')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors duration-150 ${
              activeTab === 'regular'
                ? 'border-[#d32f2f] text-[#d32f2f]'
                : 'border-transparent text-[#6b7280] hover:text-[#1f2937]'
            }`}
          >
            通常シフト
          </button>
        </div>

        {/* Seasonal Shift Tab */}
        {activeTab === 'seasonal' && (
          <>
            <div className="flex justify-between items-center mb-6">
              <h1 className="text-2xl font-bold text-[#1f2937]">講習期間シフト設定</h1>
              <Link href="/settings/seasonal-shifts/new">
                <Button className="bg-[#d32f2f] hover:bg-[#b71c1c] text-white transition-colors duration-150">
                  新規作成
                </Button>
              </Link>
            </div>

            {errorMessage && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {errorMessage}
              </div>
            )}

            {isLoading ? (
              <p className="text-[#4b5563]">読み込み中...</p>
            ) : settings.length === 0 ? (
              <div className="bg-white rounded-xl border border-[#e5e7eb] p-8 text-center text-[#4b5563]">
                シフト設定がありません。新規作成から追加してください。
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-[#f3f4f6] border-b border-[#e5e7eb]">
                      <th className="px-4 py-3 text-left font-semibold text-[#1f2937]">講習期間名</th>
                      <th className="px-4 py-3 text-left font-semibold text-[#1f2937]">期間</th>
                      <th className="px-4 py-3 text-left font-semibold text-[#1f2937]">締切</th>
                      <th className="px-4 py-3 text-center font-semibold text-[#1f2937]">ステータス</th>
                      <th className="px-4 py-3 text-center font-semibold text-[#1f2937]">提出数</th>
                      <th className="px-4 py-3 text-right font-semibold text-[#1f2937]">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settings.map((s) => (
                      <tr key={s.id} className="border-b border-[#e5e7eb]/60 hover:bg-[#f9fafb] transition-colors duration-150">
                        <td className="px-4 py-3 font-medium text-[#1f2937]">{s.name}</td>
                        <td className="px-4 py-3 text-[#4b5563]">
                          {formatDate(s.start_date)} 〜 {formatDate(s.end_date)}
                        </td>
                        <td className="px-4 py-3 text-[#4b5563]">{formatDate(s.deadline)}</td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-block px-2 py-1 text-xs font-medium rounded ${
                              s.status === 'published'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {s.status === 'published' ? '公開中' : '下書き'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center text-[#4b5563]">
                          {submissionCounts[s.id] ?? 0}件
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/settings/seasonal-shifts/${s.id}/submissions`}
                            className="text-[#3b82f6] hover:underline mr-3"
                          >
                            提出一覧
                          </Link>
                          <Link
                            href={`/settings/seasonal-shifts/${s.id}`}
                            className="text-[#3b82f6] hover:underline mr-3"
                          >
                            編集
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleDeleteSeasonal(s.id, s.name)}
                            className="text-red-600 hover:underline"
                          >
                            削除
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Regular Shift Tab */}
        {activeTab === 'regular' && (
          <>
            <div className="flex justify-between items-center mb-6">
              <h1 className="text-2xl font-bold text-[#1f2937]">通常シフト設定</h1>
              <Link href="/settings/regular-shifts/new">
                <Button className="bg-[#d32f2f] hover:bg-[#b71c1c] text-white transition-colors duration-150">
                  新規作成
                </Button>
              </Link>
            </div>

            {regularErrorMessage && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {regularErrorMessage}
              </div>
            )}

            {isRegularLoading ? (
              <p className="text-[#4b5563]">読み込み中...</p>
            ) : regularSettings.length === 0 ? (
              <div className="bg-white rounded-xl border border-[#e5e7eb] p-8 text-center text-[#4b5563]">
                通常シフト設定がありません。新規作成から追加してください。
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-[#f3f4f6] border-b border-[#e5e7eb]">
                      <th className="px-4 py-3 text-left font-semibold text-[#1f2937]">シフト名</th>
                      <th className="px-4 py-3 text-left font-semibold text-[#1f2937]">締切</th>
                      <th className="px-4 py-3 text-center font-semibold text-[#1f2937]">ステータス</th>
                      <th className="px-4 py-3 text-center font-semibold text-[#1f2937]">提出数</th>
                      <th className="px-4 py-3 text-right font-semibold text-[#1f2937]">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {regularSettings.map((s) => (
                      <tr key={s.id} className="border-b border-[#e5e7eb]/60 hover:bg-[#f9fafb] transition-colors duration-150">
                        <td className="px-4 py-3 font-medium text-[#1f2937]">{s.name}</td>
                        <td className="px-4 py-3 text-[#4b5563]">
                          {s.deadline ? formatDate(s.deadline) : '-'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-block px-2 py-1 text-xs font-medium rounded ${
                              s.status === 'published'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {s.status === 'published' ? '公開中' : '下書き'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center text-[#4b5563]">
                          {regularSubmissionCounts[s.id] ?? 0}件
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/settings/regular-shifts/${s.id}/submissions`}
                            className="text-[#3b82f6] hover:underline mr-3"
                          >
                            提出一覧
                          </Link>
                          <Link
                            href={`/settings/regular-shifts/${s.id}`}
                            className="text-[#3b82f6] hover:underline mr-3"
                          >
                            編集
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleDeleteRegular(s.id, s.name)}
                            className="text-red-600 hover:underline"
                          >
                            削除
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
      {ConfirmDialog}
    </AdminLayout>
  );
}
