'use client';

import { useState, useEffect, useCallback } from 'react';
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
import { PortalMenuEditModal, SortableMenuRow } from '@/components/portal';
import { ZoukomaPeriodEditor } from '@/components/forms/zoukoma/ZoukomaPeriodEditor';
import { MogiPeriodEditor } from '@/components/forms/mogi/MogiPeriodEditor';
import { MoshiPeriodEditor } from '@/components/forms/moshi/MoshiPeriodEditor';
import { SoudanPeriodEditor } from '@/components/forms/soudan/SoudanPeriodEditor';
import { ShukaisuPeriodEditor } from '@/components/forms/shukaisu/ShukaisuPeriodEditor';
import { YoubiPeriodEditor } from '@/components/forms/youbi/YoubiPeriodEditor';
import type { ZoukomaPeriod } from '@/types/forms/zoukoma';
import type { MogiPeriod } from '@/types/forms/mogi';
import type { MoshiPeriod } from '@/types/forms/moshi';
import type { SoudanPeriod } from '@/types/forms/soudan';
import type { ShukaisuPeriod } from '@/types/forms/shukaisu';
import type { YoubiPeriod } from '@/types/forms/youbi';
import { getZoukomaPeriods } from '@/lib/api/zoukoma';
import { getMogiPeriods } from '@/lib/api/mogi';
import { getMoshiPeriods } from '@/lib/api/moshi';
import { getSoudanPeriods } from '@/lib/api/soudan';
import { getShukaisuPeriods } from '@/lib/api/shukaisu';
import { getYoubiPeriods } from '@/lib/api/youbi';
import { useToast } from '@/hooks/useToast';
import { getDefaultSchoolId, getSchool, getSchools } from '@/lib/api/schools';
import { initializePortalMenus, getPortalMenus, togglePortalMenuVisibility } from '@/lib/api/portal';
import { getFormPeriods } from '@/lib/api/form-periods';
import { reorderPortalMenus } from '@/lib/api/portal';
import type { PortalMenu, FormType, FormPeriod, School } from '@/types/database';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';

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

// form_typeから設定ページへのパス（存在するページのみ）
const FORM_TYPE_TO_SETTINGS_PATH: Partial<Record<FormType, string>> = {
  zoukoma: '/settings/forms/zoukoma',
  mogi: '/settings/forms/mogi',
  moshi: '/settings/forms/moshi',
  soudan: '/settings/forms/soudan',
  shukaisu: '/settings/forms/shukaisu',
  youbi: '/settings/forms/youbi',
  // 以下は未実装のため、設定ページへのリンクは表示しない
  // kyozai: '/settings/forms/kyozai',
};

export default function PortalSettingsPage() {
  // 権限チェック
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessSettings
  );
  const { getSelectedSchoolIds, selectedSchoolId, schoolIds } = useAuth();

  const [menus, setMenus] = useState<PortalMenu[]>([]);
  const [formPeriods, setFormPeriods] = useState<FormPeriod[]>([]);
  const [schoolCodes, setSchoolCodes] = useState<Record<string, string>>({});
  const [allSchools, setAllSchools] = useState<School[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [editingMenu, setEditingMenu] = useState<PortalMenu | null>(null);
  const [editingPeriod, setEditingPeriod] = useState<FormPeriod | null>(null);
  const [editingFormType, setEditingFormType] = useState<FormType | null>(null);
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
      const allSchoolsData = await getSchools();
      setAllSchools(allSchoolsData);

      // 教室コードを取得
      const codes: Record<string, string> = {};
      for (const schoolId of selectedSchoolIds) {
        const school = allSchoolsData.find(s => s.id === schoolId);
        if (school?.code) {
          codes[schoolId] = school.code;
        }
      }
      setSchoolCodes(codes);

      // 複数教室が選択されている場合は最初の教室を使用（ポータル管理は単一教室のみ）
      const schoolId = selectedSchoolIds[0];
      const school = allSchoolsData.find(s => s.id === schoolId);

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
        error instanceof Error ? error.message : 'データの取得に失敗しました'
      );
    } finally {
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds]);

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

  // 公開中の期間タイトルを取得
  const getActivePeriodTitle = (menu: PortalMenu): string | null => {
    if (menu.link_type !== 'internal') {
      return null;
    }

    const formType = MENU_KEY_TO_FORM_TYPE[menu.menu_key];
    if (!formType) {
      return null;
    }

    // 該当フォームタイプの公開中期間を検索
    const now = new Date();
    const activePeriod = formPeriods.find((period) => {
      if (period.form_type !== formType || !period.is_active) {
        return false;
      }

      const start = period.publish_start ? new Date(period.publish_start) : null;
      const end = period.publish_end ? new Date(period.publish_end) : null;

      if (start && start > now) {
        return false;
      }
      if (end && end < now) {
        return false;
      }
      return true;
    });

    if (activePeriod) {
      // 期間キーとタイトルを組み合わせて表示（例: "10月度"）
      return activePeriod.title || activePeriod.period_key;
    }

    return null;
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
    const selectedSchoolIds = getSelectedSchoolIds();
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

  // 期間の作成/編集（「設定」ボタンから直接開く）
  const handleOpenPeriodEditor = async (menu: PortalMenu) => {
    const formType = MENU_KEY_TO_FORM_TYPE[menu.menu_key];
    if (!formType) return;

    setEditingFormType(formType);

    // 該当フォームタイプの期間を取得
    const selectedSchoolIds = getSelectedSchoolIds();
    if (selectedSchoolIds.length === 0) {
      error('教室が選択されていません');
      return;
    }
    const schoolId = selectedSchoolIds[0];
    let periods: FormPeriod[] = [];
    
    try {
      switch (formType) {
        case 'zoukoma':
          periods = await getZoukomaPeriods(schoolId, true);
          break;
        case 'mogi':
          periods = await getMogiPeriods(schoolId, true);
          break;
        case 'moshi':
          periods = await getMoshiPeriods(schoolId, true);
          break;
        case 'soudan':
          periods = await getSoudanPeriods(schoolId, true);
          break;
        case 'shukaisu':
          periods = await getShukaisuPeriods(schoolId, true);
          break;
        case 'youbi':
          periods = await getYoubiPeriods(schoolId, true);
          break;
      }
    } catch (err) {
      console.error('Error fetching periods:', err);
      error('期間の取得に失敗しました');
      return;
    }
    
    // 期間が存在する場合は最新のものを編集、存在しない場合は新規作成
    if (periods.length > 0) {
      // 最新の期間を選択（作成日時の降順）
      const latestPeriod = periods.sort((a, b) => {
        const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bDate - aDate;
      })[0];
      setEditingPeriod(latestPeriod);
    } else {
      // 期間が存在しない場合は新規作成モード（nullを設定）
      setEditingPeriod(null);
    }
  };

  const handleClosePeriodEditor = () => {
    setEditingPeriod(null);
    setEditingFormType(null);
  };

  const handlePeriodUpdateSuccess = () => {
    fetchData();
    handleClosePeriodEditor();
  };

  // 権限チェック中
  if (permissionLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-[#ff8e3c] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-[#2a2a2a]">読み込み中...</p>
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
        {errorMessage && (
          <div className="mb-4 p-4 bg-[#d9376e]/20 border border-[#d9376e] rounded-lg">
            <p className="text-sm text-[#d9376e]">{errorMessage}</p>
          </div>
        )}

        {/* ポータルURL表示 */}
        {portalUrls.length > 0 && (
          <div className="mb-6 bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-6">
            <h2 className="text-lg font-bold text-[#0d0d0d] mb-4">ポータルURL</h2>
            {selectedSchoolId === 'all' ? (
              <div className="space-y-4">
                <div className="p-4 bg-[#ff8e3c]/10 border border-[#ff8e3c] rounded-lg">
                  <p className="text-sm font-medium text-[#0d0d0d] mb-2">
                    すべての教室を選択中
                  </p>
                  <p className="text-xs text-[#2a2a2a]">
                    各教室ごとにポータルURLが異なります。保護者には各教室のURLを共有してください。
                  </p>
                </div>
                <div className="space-y-3">
                  {portalUrls.map(({ school, url }) => (
                    <div key={school.id} className="space-y-1">
                      <label className="block text-sm font-medium text-[#0d0d0d]">
                        {school.code === 'DEFAULT' ? 'デフォルト' : school.name}
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={url}
                          readOnly
                          className="flex-1 px-3 py-2 border border-[#0d0d0d] rounded-lg text-sm bg-[#eff0f3] text-[#2a2a2a]"
                        />
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
                    className="flex-1 px-3 py-2 border border-[#0d0d0d] rounded-lg text-sm bg-[#eff0f3] text-[#2a2a2a]"
                  />
                  <Button onClick={() => handleCopyUrl(portalUrls[0]?.url || '')} className="min-w-[100px]">
                    コピー
                  </Button>
                </div>
                <p className="text-xs text-[#2a2a2a]/60">
                  このURLを保護者に共有してください
                </p>
              </div>
            )}
          </div>
        )}

        {/* フォーム一覧（統合版） */}
        {isLoading ? (
          <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-8 text-center">
            <p className="text-[#2a2a2a]">読み込み中...</p>
          </div>
        ) : (
          <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-6">
            <h2 className="text-lg font-bold text-[#0d0d0d] mb-4">フォーム一覧</h2>
            <div className="overflow-x-auto">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <table className="w-full border-collapse border border-[#0d0d0d] text-sm">
                  <thead>
                    <tr className="bg-[#eff0f3]">
                      <th className="border border-[#0d0d0d] px-4 py-3 text-left">タイトル</th>
                      <th className="border border-[#0d0d0d] px-4 py-3 text-left">
                        現在の公開状況
                      </th>
                      <th className="border border-[#0d0d0d] px-4 py-3 text-left">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <SortableContext
                      items={menus.map((m) => m.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {menus.map((menu, index) => {
                        const formType = MENU_KEY_TO_FORM_TYPE[menu.menu_key];
                        const settingsPath =
                          formType && FORM_TYPE_TO_SETTINGS_PATH[formType];

                        return (
                          <SortableMenuRow
                            key={menu.id}
                            menu={menu}
                            index={index}
                            formType={formType}
                            settingsPath={settingsPath}
                            activePeriodTitle={getActivePeriodTitle(menu)}
                            isSubmitting={isSubmitting}
                            onToggleVisibility={handleToggleVisibility}
                            onEdit={handleEdit}
                            onEditPeriod={formType ? handleOpenPeriodEditor : undefined}
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

        {/* 期間作成/編集モーダル */}
        {editingFormType && (
          <>
            {editingFormType === 'zoukoma' && editingPeriod && (
              <ZoukomaPeriodEditor
                isOpen={!!editingFormType}
                period={editingPeriod as ZoukomaPeriod}
                onClose={handleClosePeriodEditor}
                onSuccess={handlePeriodUpdateSuccess}
              />
            )}
            {editingFormType === 'zoukoma' && !editingPeriod && (
              <ZoukomaPeriodEditor
                isOpen={!!editingFormType}
                period={null}
                onClose={handleClosePeriodEditor}
                onSuccess={handlePeriodUpdateSuccess}
              />
            )}
            {editingFormType === 'mogi' && (
              <MogiPeriodEditor
                isOpen={!!editingFormType}
                period={editingPeriod as MogiPeriod}
                onClose={handleClosePeriodEditor}
                onSuccess={handlePeriodUpdateSuccess}
              />
            )}
            {editingFormType === 'moshi' && (
              <MoshiPeriodEditor
                isOpen={!!editingFormType}
                period={editingPeriod as MoshiPeriod}
                onClose={handleClosePeriodEditor}
                onSuccess={handlePeriodUpdateSuccess}
              />
            )}
            {editingFormType === 'soudan' && (
              <SoudanPeriodEditor
                isOpen={!!editingFormType}
                period={editingPeriod as SoudanPeriod}
                onClose={handleClosePeriodEditor}
                onSuccess={handlePeriodUpdateSuccess}
              />
            )}
            {editingFormType === 'shukaisu' && (
              <ShukaisuPeriodEditor
                isOpen={!!editingFormType}
                period={editingPeriod as ShukaisuPeriod}
                onClose={handleClosePeriodEditor}
                onSuccess={handlePeriodUpdateSuccess}
              />
            )}
            {editingFormType === 'youbi' && (
              <YoubiPeriodEditor
                isOpen={!!editingFormType}
                period={editingPeriod as YoubiPeriod}
                onClose={handleClosePeriodEditor}
                onSuccess={handlePeriodUpdateSuccess}
              />
            )}
          </>
        )}
      </AdminLayout>
    </div>
  );
}
