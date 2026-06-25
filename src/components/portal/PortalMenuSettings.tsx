'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import { PortalMenuEditModal } from './PortalMenuEditModal';
import { reorderPortalMenus } from '@/lib/api/portal';
import { getDefaultSchoolId } from '@/lib/api/schools';
import type { PortalMenu } from '@/types/database';

interface PortalMenuSettingsProps {
  menus: PortalMenu[];
  onUpdate: () => void;
}

export function PortalMenuSettings({ menus, onUpdate }: PortalMenuSettingsProps) {
  const [editingMenu, setEditingMenu] = useState<PortalMenu | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleEdit = (menu: PortalMenu) => {
    setEditingMenu(menu);
  };

  const handleCloseModal = () => {
    setEditingMenu(null);
  };

  const handleMoveUp = async (index: number) => {
    if (index === 0) return;

    setIsSubmitting(true);
    try {
      const newMenus = [...menus];
      [newMenus[index - 1], newMenus[index]] = [newMenus[index], newMenus[index - 1]];

      const schoolId = getDefaultSchoolId();
      await reorderPortalMenus(
        schoolId,
        newMenus.map((m) => m.id)
      );
      onUpdate();
    } catch (error) {
      console.error('Error reordering menus:', error);
      setErrorMessage('並び替えに失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMoveDown = async (index: number) => {
    if (index === menus.length - 1) return;

    setIsSubmitting(true);
    try {
      const newMenus = [...menus];
      [newMenus[index], newMenus[index + 1]] = [newMenus[index + 1], newMenus[index]];

      const schoolId = getDefaultSchoolId();
      await reorderPortalMenus(
        schoolId,
        newMenus.map((m) => m.id)
      );
      onUpdate();
    } catch (error) {
      console.error('Error reordering menus:', error);
      setErrorMessage('並び替えに失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (menus.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-[#4b5563]">メニュー項目がありません</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {errorMessage && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {errorMessage}
        </div>
      )}
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[#e5e7eb]">
            <th className="px-4 py-2 text-left text-sm font-medium text-[#1f2937]">表示</th>
            <th className="px-4 py-2 text-left text-sm font-medium text-[#1f2937]">タイトル</th>
            <th className="px-4 py-2 text-left text-sm font-medium text-[#1f2937]">説明文</th>
            <th className="px-4 py-2 text-left text-sm font-medium text-[#1f2937]">リンク種別</th>
            <th className="px-4 py-2 text-left text-sm font-medium text-[#1f2937]">リンク先</th>
            <th className="px-4 py-2 text-left text-sm font-medium text-[#1f2937]">操作</th>
          </tr>
        </thead>
        <tbody>
          {menus.map((menu, index) => (
            <tr key={menu.id} className="border-b border-[#e5e7eb]/20 hover:bg-[#f3f4f6]">
              <td className="px-4 py-3 text-sm text-center">
                {menu.is_visible ? (
                  <span className="text-[#1f2937] font-medium">✓</span>
                ) : (
                  <span className="text-[#4b5563]/40">-</span>
                )}
              </td>
              <td className="px-4 py-3 text-sm text-[#1f2937] font-medium">{menu.title}</td>
              <td className="px-4 py-3 text-sm text-[#4b5563]">{menu.description || '-'}</td>
              <td className="px-4 py-3 text-sm text-[#4b5563]">
                {menu.link_type === 'internal' ? (
                  <span className="text-xs">内部</span>
                ) : (
                  <span className="text-xs">外部</span>
                )}
              </td>
              <td className="px-4 py-3 text-sm text-[#4b5563]">
                {menu.link_url ? (
                  <span className="text-xs break-all">{menu.link_url}</span>
                ) : (
                  <span className="text-[#4b5563]/60">未設定</span>
                )}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleMoveUp(index)}
                    disabled={index === 0 || isSubmitting}
                    className="px-2 py-1 text-xs bg-[#f3f4f6] text-[#4b5563] rounded hover:bg-[#e5e7eb] active:scale-[0.92] transition-[transform,background-color] duration-100 ease-[cubic-bezier(0.23,1,0.32,1)] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => handleMoveDown(index)}
                    disabled={index === menus.length - 1 || isSubmitting}
                    className="px-2 py-1 text-xs bg-[#f3f4f6] text-[#4b5563] rounded hover:bg-[#e5e7eb] active:scale-[0.92] transition-[transform,background-color] duration-100 ease-[cubic-bezier(0.23,1,0.32,1)] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    ↓
                  </button>
                  <Button
                    onClick={() => handleEdit(menu)}
                    variant="secondary"
                    size="sm"
                    disabled={isSubmitting}
                  >
                    編集
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editingMenu && (
        <PortalMenuEditModal
          menu={editingMenu}
          isOpen={!!editingMenu}
          onClose={handleCloseModal}
          onSuccess={onUpdate}
        />
      )}
    </div>
  );
}
