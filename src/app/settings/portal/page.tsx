'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { AdminLayout } from '@/components/layouts';
import { Button, ToastContainer } from '@/components/ui';
import { ChevronLeft } from 'lucide-react';
import { PortalMenuEditModal, SortableMenuRow } from '@/components/portal';
import { useToast } from '@/hooks/useToast';
import { useMasterData } from '@/contexts/MasterDataContext';
import { initializePortalMenus, getPortalMenus, togglePortalMenuVisibility } from '@/lib/api/portal';
import { getFormPeriods } from '@/lib/api/form-periods';
import { reorderPortalMenus } from '@/lib/api/portal';
import type { PortalMenu, FormType, FormPeriod, School } from '@/types/database';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

// menu_keyからform_typeへのマッピング
const MENU_KEY_TO_FORM_TYPE: Record<string, FormType | null> = {
  zoukoma: 'zoukoma',
  moshi: 'moshi',
  mogi: 'mogi',
  shukaisu: 'shukaisu',
  youbi: 'youbi',
  kyozai: 'kyozai',
  soudan: 'soudan',
  mendan: null, // 面談は外部リンクなのでnull
};

// form_type から期間管理ページへのパス
const FORM_TYPE_TO_PERIODS_PATH: Partial<Record<FormType, string>> = {
  zoukoma: '/settings/forms/zoukoma/periods',
  mogi: '/settings/forms/mogi/periods',
  moshi: '/settings/forms/moshi/periods',
  soudan: '/settings/forms/soudan/periods',
  shukaisu: '/settings/forms/shukaisu/periods',
  youbi: '/settings/forms/youbi/periods',
};

export default function PortalSettingsPage() {
  // 権限チェック
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessSettings
  );
  const { getSelectedSchoolIds, selectedSchoolId, schoolIds } = useAuth();
  const { schools: masterSchools } = useMasterData();

  const [menus, setMenus] = useState<PortalMenu[]>([]);
  const [formPeriods, setFormPeriods] = useState<FormPeriod[]>([]);
  const [, setSchoolCodes] = useState<Record<string, string>>({});
  const [allSchools, setAllSchools] = useState<School[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [editingMenu, setEditingMenu] = useState<PortalMenu | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toasts, removeToast, success, error } = useToast();

  // データを取得
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const selectedSchoolIds = getSelectedSchoolIds();
      if (selectedSchoolIds.length === 0) {
        setMenus([]);
        setFormPeriods([]);
        setIsLoading(false);
        return;
      }

      // すべての教室を取得（コード表示用）
      setAllSchools(masterSchools);

      // 教室コードを取得
      const codes: Record<string, string> = {};
      for (const schoolId of selectedSchoolIds) {
        const school = masterSchools.find(s => s.id === schoolId);
        if (school?.code) {
          codes[schoolId] = school.code;
        }
      }
      setSchoolCodes(codes);

      // 複数教室が選択されている場合は最初の教室を使用（ポータル管理は単一教室のみ）
      const schoolId = selectedSchoolIds[0];
      const school = masterSchools.find(s => s.id === schoolId);

      if (!school) {
        throw new Error('教室が見つかりません');
      }

      // メニューを初期化（初回のみ）
      await initializePortalMenus(schoolId);

      // メニュー一覧とフォーム期間を並行取得
      const [menusData, periodsData] = await Promise.all([
        getPortalMenus(schoolId),
        getFormPeriods(schoolId),
      ]);

      setMenus(menusData);
      setFormPeriods(periodsData);
    } catch (error) {
      console.error('Error fetching data:', error);
      setErrorMessage(
        getUserErrorMessage(error, 'データの取得に失敗しました')
      );
    } finally {
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds, masterSchools]);

  // 初回読み込みと教室選択変更時の再読み込み
  useEffect(() => {
    if (selectedSchoolId !== null) {
      fetchData();
    }
  }, [fetchData, selectedSchoolId]);

  // メニュー更新時のコールバック
  const handleMenuUpdate = useCallback(() => {
    fetchData();
  }, [fetchData]);

  // 公開中の期間タイトルを取得（is_active が true の期間を1件）
  const getActivePeriodTitle = (menu: PortalMenu): string | null => {
    if (menu.link_type !== 'internal') {
      return null;
    }

    const formType = MENU_KEY_TO_FORM_TYPE[menu.menu_key];
    if (!formType) {
      return null;
    }

    const activePeriod = formPeriods.find(
      (p) => p.form_type === formType && p.is_active && !p.is_archived
    );
    if (activePeriod) {
      return activePeriod.title || activePeriod.period_key;
    }
    return null;
  };

  // 登録済み期間一覧（フォーム作成有無の確認用）
  const getRegisteredPeriodsForMenu = (menu: PortalMenu): FormPeriod[] => {
    if (menu.link_type !== 'internal') return [];
    const formType = MENU_KEY_TO_FORM_TYPE[menu.menu_key];
    if (!formType) return [];
    return formPeriods.filter((p) => p.form_type === formType);
  };

  // 表示/非表示のトグル
  const handleToggleVisibility = async (menu: PortalMenu) => {
    try {
      setIsSubmitting(true);
      await togglePortalMenuVisibility(menu.id);
      handleMenuUpdate();
      success('表示状態を更新しました');
    } catch (err) {
      console.error('Error toggling visibility:', err);
      const errorMessage =
        err instanceof Error
          ? err.message
          : '表示/非表示の切り替えに失敗しました';
      error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ポータルURLを取得
  const getPortalUrls = (): Array<{ school: School; url: string }> => {
    const urls: Array<{ school: School; url: string }> = [];

    if (selectedSchoolId === 'all') {
      // すべての教室を選択している場合
      for (const schoolId of schoolIds) {
        const school = allSchools.find(s => s.id === schoolId);
        if (school?.code) {
          urls.push({
            school,
            url: `${typeof window !== 'undefined' ? window.location.origin : ''}/portal/${school.code}`,
          });
        }
      }
    } else if (selectedSchoolId) {
      // 特定の教室を選択している場合
      const school = allSchools.find(s => s.id === selectedSchoolId);
      if (school?.code) {
        urls.push({
          school,
          url: `${typeof window !== 'undefined' ? window.location.origin : ''}/portal/${school.code}`,
        });
      }
    }

    return urls;
  };

  const portalUrls = getPortalUrls();

  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      success('URLをコピーしました');
    } catch (err) {
      console.error('Failed to copy:', err);
      error('コピーに失敗しました');
    }
  };

  // ドラッグ&ドロップ用のセンサー
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // ドラッグ終了時の処理
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = menus.findIndex((menu) => menu.id === active.id);
    const newIndex = menus.findIndex((menu) => menu.id === over.id);

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

      // 楽観的UI更新
      const newMenus = arrayMove(menus, oldIndex, newIndex);
      const previousMenus = [...menus]; // エラー時の復元用
      setMenus(newMenus);

      setIsSubmitting(true);
      try {
        const selectedSchoolIds = getSelectedSchoolIds();
        if (selectedSchoolIds.length === 0) {
          throw new Error('教室が選択されていません');
        }
        const schoolId = selectedSchoolIds[0];
        await reorderPortalMenus(
          schoolId,
          newMenus.map((m) => m.id)
        );
        success('並び順を更新しました');
      } catch (err) {
        console.error('Error reordering menus:', err);
        // エラー時は元に戻す
        setMenus(previousMenus);
        error('並び替えに失敗しました');
      } finally {
        setIsSubmitting(false);
      }
  };

  const handleEdit = (menu: PortalMenu) => {
    setEditingMenu(menu);
  };

  const handleCloseModal = () => {
    setEditingMenu(null);
  };

  const handleMenuUpdateSuccess = () => {
    handleMenuUpdate();
    success('メニューを更新しました');
  };

  const handleMenuUpdateError = (err: unknown) => {
    const errorMessage =
      err instanceof Error
        ? err.message
        : 'メニューの更新に失敗しました';
    error(errorMessage);
  };

  // 権限チェック中
  if (permissionLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-text-dangeraintenter">
            <div className="w-12 h-12 border-danger border-ink border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-text-body">読み込み中...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  // 権限なし
  if (!hasPermission) {
    return (
      <AdminLayout>
        <AccessDenied message="設定ページは教室長以上のみアクセス可能です" />
      </AdminLayout>
    );
  }

  return (
    <div>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <AdminLayout headerTitle="ポータル設定">
        <div className="mb-4">
          <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-heading transition-colors duration-150">
            <ChevronLeft className="w-4 h-4" />
            設定に戻る
          </Link>
        </div>
        {errorMessage && (
          <div className="mb-4 p-4 bg-danger/20 border border-danger rounded-lg">
            <p className="text-sm text-danger">{errorMessage}</p>
          </div>
        )}

        {/* ポータルURL表示 */}
        {portalUrls.length > 0 && (
          <div className="mb-6 bg-surface-raised rounded-xl border border-border p-6">
            <h2 className="text-lg font-bold text-text-heading mb-4">ポータルURL</h2>
            {selectedSchoolId === 'all' ? (
              <div className="space-y-4">
                <div className="p-4 bg-info/10 border border-info rounded-lg">
                  <p className="text-sm font-medium text-text-heading mb-2">
                    すべての教室を選択中
                  </p>
                  <p className="text-xs text-text-body">
                    各教室ごとにポータルURLが異なります。保護者には各教室のURLを共有してください。
                  </p>
                </div>
                <div className="space-y-3">
                  {portalUrls.map(({ school, url }) => (
                    <div key={school.id} className="space-y-1">
                      <label className="block text-sm font-medium text-text-heading">
                        {school.code === 'DEFAULT' ? 'デフォルト' : school.name}
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={url}
                          readOnly
                          className="flex-1 px-3 py-2 border border-border rounded-lg text-sm bg-surface-hover text-text-body"
                        />
                        <Button
                          variant="outline"
                          onClick={() => window.open(url, '_blank')}
                          className="min-w-[80px]"
                        >
                          開く
                        </Button>
                        <Button onClick={() => handleCopyUrl(url)} className="min-w-[100px]">
                          コピー
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={portalUrls[0]?.url || ''}
                    readOnly
                    className="flex-1 px-3 py-2 border border-border rounded-lg text-sm bg-surface-hover text-text-body"
                  />
                  <Button
                    variant="outline"
                    onClick={() => window.open(portalUrls[0]?.url || '', '_blank')}
                    className="min-w-[80px]"
                  >
                    開く
                  </Button>
                  <Button onClick={() => handleCopyUrl(portalUrls[0]?.url || '')} className="min-w-[100px]">
                    コピー
                  </Button>
                </div>
                <p className="text-xs text-text-body/60">
                  このURLを保護者に共有してください
                </p>
              </div>
            )}
          </div>
        )}

        {/* フォーム一覧（統合版） */}
        {isLoading ? (
          <div className="bg-surface-raised rounded-xl border border-border p-8 text-text-dangeraintenter">
            <p className="text-text-body">読み込み中...</p>
          </div>
        ) : (
          <div className="bg-surface-raised rounded-xl border border-border p-6">
            <div className="flex items-center justify-between gap-4 mb-4">
              <h2 className="text-lg font-bold text-text-heading">フォーム一覧</h2>
              <Link
                href="/settings/forms/class-periods"
                className="text-xs text-text-muted hover:text-text-heading hover:underline"
                title="週回数・曜日変更などのフォームで使う時限の共通設定"
              >
                授業の時間帯
              </Link>
            </div>
            <div className="overflow-x-auto">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <table className="w-full border-collapse border border-border text-sm">
                  <thead>
                    <tr className="bg-surface-hover">
                      <th className="border border-border px-4 py-3 text-left">タイトル</th>
                      <th className="border border-border px-4 py-3 text-left">
                        現在の公開状況
                      </th>
                      <th className="border border-border px-4 py-3 text-left">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <SortableContext
                      items={menus.map((m) => m.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {menus.map((menu, index) => {
                        const formType = MENU_KEY_TO_FORM_TYPE[menu.menu_key];
                        const periodsPath =
                          formType ? FORM_TYPE_TO_PERIODS_PATH[formType] : undefined;

                        return (
                          <SortableMenuRow
                            key={menu.id}
                            menu={menu}
                            index={index}
                            formType={formType}
                            periodsPath={periodsPath}
                            activePeriodTitle={getActivePeriodTitle(menu)}
                            registeredPeriods={getRegisteredPeriodsForMenu(menu)}
                            isSubmitting={isSubmitting}
                            onToggleVisibility={handleToggleVisibility}
                            onEdit={handleEdit}
                          />
                        );
                      })}
                    </SortableContext>
                  </tbody>
                </table>
              </DndContext>
            </div>
          </div>
        )}

        {/* 編集モーダル */}
        {editingMenu && (
          <PortalMenuEditModal
            menu={editingMenu}
            isOpen={!!editingMenu}
            onClose={handleCloseModal}
            onSuccess={handleMenuUpdateSuccess}
            onError={handleMenuUpdateError}
          />
        )}
      </AdminLayout>
    </div>
  );
}
