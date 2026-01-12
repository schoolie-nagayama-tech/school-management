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
import { AppHeader } from '@/components/layout';
import { Button, ToastContainer } from '@/components/ui';
import { PortalMenuEditModal, SortableMenuRow, PeriodPublishEditor } from '@/components/portal';
import { useToast } from '@/hooks/useToast';
import { getDefaultSchoolId, getSchool } from '@/lib/api/schools';
import { initializePortalMenus, getPortalMenus, togglePortalMenuVisibility } from '@/lib/api/portal';
import { getFormPeriods } from '@/lib/api/form-periods';
import { reorderPortalMenus } from '@/lib/api/portal';
import type { PortalMenu, FormType, FormPeriod } from '@/types/database';

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
  // 以下は未実装のため、設定ページへのリンクは表示しない
  // moshi: '/settings/forms/moshi',
  // shukaisu: '/settings/forms/shukaisu',
  // youbi: '/settings/forms/youbi',
  // kyozai: '/settings/forms/kyozai',
  // soudan: '/settings/forms/soudan',
};

export default function PortalSettingsPage() {
  const [menus, setMenus] = useState<PortalMenu[]>([]);
  const [formPeriods, setFormPeriods] = useState<FormPeriod[]>([]);
  const [schoolCode, setSchoolCode] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [editingMenu, setEditingMenu] = useState<PortalMenu | null>(null);
  const [editingPeriod, setEditingPeriod] = useState<FormPeriod | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toasts, removeToast, success, error } = useToast();

  // データを取得
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const schoolId = getDefaultSchoolId();
      const school = await getSchool(schoolId);

      if (!school) {
        throw new Error('教室が見つかりません。環境変数NEXT_PUBLIC_DEFAULT_SCHOOL_IDが正しいか確認してください。');
      }

      if (school.code) {
        setSchoolCode(school.code);
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
  }, []);

  // 初回読み込み
  useEffect(() => {
    fetchData();
  }, [fetchData]);

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

  const portalUrl = schoolCode
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/portal/${schoolCode}`
    : '';

  const handleCopyUrl = async () => {
    if (!portalUrl) return;
    try {
      await navigator.clipboard.writeText(portalUrl);
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
      const schoolId = getDefaultSchoolId();
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

  // 期間の公開設定を編集
  const handleEditPeriod = (menu: PortalMenu) => {
    const formType = MENU_KEY_TO_FORM_TYPE[menu.menu_key];
    if (!formType) return;

    // 該当フォームタイプの期間を取得（最新のものを選択）
    const periodsForForm = formPeriods.filter((p) => p.form_type === formType);
    if (periodsForForm.length === 0) {
      error('該当する期間が見つかりません');
      return;
    }

    // 最新の期間を選択（作成日時の降順）
    const latestPeriod = periodsForForm.sort((a, b) => {
      const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bDate - aDate;
    })[0];

    setEditingPeriod(latestPeriod);
  };

  const handleClosePeriodEditor = () => {
    setEditingPeriod(null);
  };

  const handlePeriodUpdateSuccess = () => {
    fetchData();
    handleClosePeriodEditor();
  };

  return (
    <div className="min-h-screen bg-[#eff0f3]">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <AppHeader title="ポータル設定" />

      {/* メインコンテンツ */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {errorMessage && (
          <div className="mb-4 p-4 bg-[#d9376e]/20 border border-[#d9376e] rounded-lg">
            <p className="text-sm text-[#d9376e]">{errorMessage}</p>
          </div>
        )}

        {/* ポータルURL表示 */}
        {schoolCode && (
          <div className="mb-6 bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-6">
            <h2 className="text-lg font-bold text-[#0d0d0d] mb-4">ポータルURL</h2>
            <div className="flex gap-2">
              <input
                type="text"
                value={portalUrl}
                readOnly
                className="flex-1 px-3 py-2 border border-[#0d0d0d] rounded-lg text-sm bg-[#eff0f3] text-[#2a2a2a]"
              />
              <Button onClick={handleCopyUrl} className="min-w-[100px]">
                コピー
              </Button>
            </div>
            <p className="text-xs text-[#2a2a2a]/60 mt-2">
              このURLを保護者に共有してください
            </p>
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
                      <th className="border border-[#0d0d0d] px-4 py-3 text-left">表示</th>
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
                            onEditPeriod={formType === 'zoukoma' || formType === 'mogi' ? handleEditPeriod : undefined}
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

        {/* 期間公開設定編集モーダル */}
        {editingPeriod && (
          <PeriodPublishEditor
            isOpen={!!editingPeriod}
            period={editingPeriod}
            formType={editingPeriod.form_type}
            onClose={handleClosePeriodEditor}
            onSuccess={handlePeriodUpdateSuccess}
          />
        )}
      </div>
    </div>
  );
}
