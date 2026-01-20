'use client';

import { useState, useEffect } from 'react';
import { Modal, Button, Input } from '@/components/ui';
import { updatePortalMenu } from '@/lib/api/portal';
import { validateUrl } from '@/lib/utils/validation';
import type { PortalMenu, PortalMenuUpdate } from '@/types/database';
import { Trash2, Plus } from 'lucide-react';

interface PortalMenuEditModalProps {
  menu: PortalMenu;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onError?: (error: Error) => void;
}

export function PortalMenuEditModal({
  menu,
  isOpen,
  onClose,
  onSuccess,
  onError,
}: PortalMenuEditModalProps) {
  const isMendan = menu.menu_key === 'mendan';
  const [formData, setFormData] = useState({
    title: menu.title,
    description: menu.description || '',
    is_visible: menu.is_visible,
    link_type: menu.link_type,
    link_url: menu.link_url || '',
    link_urls: menu.link_urls || [],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // menu_keyからlink_urlを生成する関数
  const getLinkUrlFromMenuKey = (menuKey: string): string => {
    const menuKeyToUrl: Record<string, string> = {
      zoukoma: '/zoukoma',
      moshi: '/moshi',
      mogi: '/mogi',
      shukaisu: '/shukaisu',
      youbi: '/youbi',
      kyozai: '/kyozai',
      soudan: '/soudan',
    };
    return menuKeyToUrl[menuKey] || '';
  };

  useEffect(() => {
    if (menu) {
      // 既存のlink_urlがある場合はlink_urlsに変換（互換性のため）
      let linkUrls = menu.link_urls || [];
      if (isMendan && menu.link_type === 'external' && menu.link_url && !linkUrls.length) {
        linkUrls = [{ url: menu.link_url, label: menu.title }];
      }
      setFormData({
        title: menu.title,
        description: menu.description || '',
        is_visible: menu.is_visible,
        link_type: menu.link_type,
        link_url: menu.link_url || '',
        link_urls: linkUrls,
      });
      setErrors({});
    }
  }, [menu, isMendan]);

  const validate = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.title.trim()) {
      newErrors.title = 'タイトルを入力してください';
    }

    if (formData.link_type === 'external') {
      if (isMendan) {
        // 面談申し込みの場合は複数リンクを検証
        if (formData.link_urls.length === 0) {
          newErrors.link_urls = '少なくとも1つのリンクを追加してください';
        } else {
          formData.link_urls.forEach((link, index) => {
            if (!link.url.trim()) {
              newErrors[`link_url_${index}`] = 'URLを入力してください';
            } else {
              const urlValidation = validateUrl(link.url);
              if (!urlValidation.isValid) {
                newErrors[`link_url_${index}`] = urlValidation.error || '正しいURL形式を入力してください';
              }
            }
            if (!link.label.trim()) {
              newErrors[`link_label_${index}`] = 'ラベルを入力してください';
            }
          });
        }
      } else {
        // その他の外部リンクは単一URL
        if (!formData.link_url.trim()) {
          newErrors.link_url = '外部URLを入力してください';
        } else {
          const urlValidation = validateUrl(formData.link_url);
          if (!urlValidation.isValid) {
            newErrors.link_url = urlValidation.error || '正しいURL形式を入力してください';
          }
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleAddLink = () => {
    setFormData({
      ...formData,
      link_urls: [...formData.link_urls, { url: '', label: '' }],
    });
  };

  const handleRemoveLink = (index: number) => {
    setFormData({
      ...formData,
      link_urls: formData.link_urls.filter((_, i) => i !== index),
    });
  };

  const handleUpdateLink = (index: number, field: 'url' | 'label', value: string) => {
    const newLinks = [...formData.link_urls];
    newLinks[index] = { ...newLinks[index], [field]: value };
    setFormData({ ...formData, link_urls: newLinks });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);
    try {
      // 内部フォームの場合は、menu_keyから自動生成したlink_urlを使用
      const linkUrl =
        formData.link_type === 'internal'
          ? getLinkUrlFromMenuKey(menu.menu_key)
          : isMendan ? null : formData.link_url.trim() || null;

      const updateData: PortalMenuUpdate = {
        title: formData.title.trim(),
        description: formData.description.trim() || null,
        is_visible: formData.is_visible,
        link_type: formData.link_type,
        link_url: linkUrl,
        link_urls: isMendan && formData.link_type === 'external' ? formData.link_urls : null,
      };

      await updatePortalMenu(menu.id, updateData);
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Error updating menu:', err);
      const errorMessage =
        err instanceof Error
          ? err.message
          : 'メニューの更新に失敗しました';
      const errorObj = new Error(errorMessage);
      if (onError) {
        onError(errorObj);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="メニュー編集">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[#0d0d0d] mb-2">
            タイトル <span className="text-[#d9376e]">*</span>
          </label>
          <Input
            type="text"
            value={formData.title}
            onChange={(e) =>
              setFormData({ ...formData, title: e.target.value })
            }
            error={errors.title}
            required
            disabled={isSubmitting}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[#0d0d0d] mb-2">
            説明文
          </label>
          <textarea
            value={formData.description}
            onChange={(e) =>
              setFormData({ ...formData, description: e.target.value })
            }
            className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg text-sm bg-[#fffffe] text-[#2a2a2a] focus:ring-2 focus:ring-[#ff8e3c] focus:border-[#ff8e3c] disabled:opacity-50"
            rows={3}
            disabled={isSubmitting}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[#0d0d0d] mb-2">
            リンク種別 <span className="text-[#d9376e]">*</span>
          </label>
          <select
            value={formData.link_type}
            onChange={(e) => {
              const newLinkType = e.target.value as 'internal' | 'external';
              // 内部フォームに変更した場合、link_urlを自動生成
              const newLinkUrl =
                newLinkType === 'internal'
                  ? getLinkUrlFromMenuKey(menu.menu_key)
                  : formData.link_url;
              setFormData({
                ...formData,
                link_type: newLinkType,
                link_url: newLinkUrl,
              });
            }}
            className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg text-sm bg-[#fffffe] text-[#2a2a2a] focus:ring-2 focus:ring-[#ff8e3c] focus:border-[#ff8e3c] disabled:opacity-50"
            disabled={isSubmitting}
          >
            <option value="internal">内部フォーム</option>
            <option value="external">外部URL</option>
          </select>
          <p className="text-xs text-[#2a2a2a]/60 mt-1">
            {formData.link_type === 'internal'
              ? '内部フォームの場合はリンク先パスが自動設定されます'
              : '外部URLへのリンク（例: https://calendar.google.com）'}
          </p>
        </div>

        {formData.link_type === 'external' && (
          <div>
            {isMendan ? (
              // 面談申し込みの場合は複数リンク
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-[#0d0d0d]">
                    外部リンク <span className="text-[#d9376e]">*</span>
                  </label>
                  <Button
                    type="button"
                    onClick={handleAddLink}
                    variant="secondary"
                    className="text-xs py-1 px-2"
                    disabled={isSubmitting}
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    リンクを追加
                  </Button>
                </div>
                {errors.link_urls && (
                  <p className="text-xs text-[#d9376e] mb-2">{errors.link_urls}</p>
                )}
                <div className="space-y-3">
                  {formData.link_urls.map((link, index) => (
                    <div key={index} className="p-3 border border-[#0d0d0d] rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-[#0d0d0d]">
                          リンク {index + 1}
                        </label>
                        {formData.link_urls.length > 1 && (
                          <Button
                            type="button"
                            onClick={() => handleRemoveLink(index)}
                            variant="ghost"
                            className="p-1 text-[#d9376e] hover:text-[#c02d5a]"
                            disabled={isSubmitting}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[#0d0d0d] mb-1">
                          ラベル <span className="text-[#d9376e]">*</span>
                        </label>
                        <Input
                          type="text"
                          value={link.label}
                          onChange={(e) => handleUpdateLink(index, 'label', e.target.value)}
                          placeholder="例: 面談予約（Googleカレンダー）"
                          error={errors[`link_label_${index}`]}
                          required
                          disabled={isSubmitting}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[#0d0d0d] mb-1">
                          URL <span className="text-[#d9376e]">*</span>
                        </label>
                        <Input
                          type="text"
                          value={link.url}
                          onChange={(e) => handleUpdateLink(index, 'url', e.target.value)}
                          placeholder="https://example.com"
                          error={errors[`link_url_${index}`]}
                          required
                          disabled={isSubmitting}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-[#2a2a2a]/60 mt-2">
                  複数の外部リンクを設定できます（新しいタブで開きます）
                </p>
              </div>
            ) : (
              // その他の外部リンクは単一URL
              <div>
                <label className="block text-sm font-medium text-[#0d0d0d] mb-2">
                  リンク先URL <span className="text-[#d9376e]">*</span>
                </label>
                <Input
                  type="text"
                  value={formData.link_url}
                  onChange={(e) =>
                    setFormData({ ...formData, link_url: e.target.value })
                  }
                  placeholder="https://example.com"
                  error={errors.link_url}
                  required
                  disabled={isSubmitting}
                />
                <p className="text-xs text-[#2a2a2a]/60 mt-1">
                  外部URLを入力（新しいタブで開きます）
                </p>
              </div>
            )}
          </div>
        )}

        {formData.link_type === 'internal' && (
          <div>
            <label className="block text-sm font-medium text-[#0d0d0d] mb-2">
              リンク先パス（自動設定）
            </label>
            <div className="px-3 py-2 border border-[#0d0d0d] rounded-lg text-sm bg-[#eff0f3] text-[#2a2a2a]">
              {getLinkUrlFromMenuKey(menu.menu_key) || '(未設定)'}
            </div>
            <p className="text-xs text-[#2a2a2a]/60 mt-1">
              内部フォームのパスは自動設定されます（公開期間が設定されている必要があります）
            </p>
          </div>
        )}

        <div className="flex items-center">
          <input
            type="checkbox"
            id="is_visible"
            checked={formData.is_visible}
            onChange={(e) =>
              setFormData({ ...formData, is_visible: e.target.checked })
            }
            className="w-4 h-4 text-[#ff8e3c] border-[#0d0d0d] rounded focus:ring-[#ff8e3c]"
            disabled={isSubmitting}
          />
          <label
            htmlFor="is_visible"
            className="ml-2 text-sm font-medium text-[#0d0d0d]"
          >
            表示する
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-[#0d0d0d]">
          <Button
            type="button"
            onClick={onClose}
            variant="secondary"
            disabled={isSubmitting}
          >
            キャンセル
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? '保存中...' : '保存'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
