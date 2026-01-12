'use client';

import Link from 'next/link';
import type { PortalMenu } from '@/types/database';

interface PortalMenuCardProps {
  menu: PortalMenu;
  schoolCode: string;
  isFormActive?: boolean; // フォームが公開期間内かどうか
}

export function PortalMenuCard({ menu, schoolCode, isFormActive = false }: PortalMenuCardProps) {
  // 外部リンクの場合
  if (menu.link_type === 'external') {
    if (menu.link_url) {
      return (
        <a
          href={menu.link_url}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full min-h-[80px] p-4 bg-[#ff8e3c] rounded-lg border border-[#0d0d0d] hover:bg-[#ff9e5c] transition-colors active:bg-[#ff8e3c]"
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h2 className="text-lg font-bold text-[#0d0d0d] mb-1">{menu.title}</h2>
              {menu.description && (
                <p className="text-sm text-[#2a2a2a]">{menu.description}</p>
              )}
            </div>
            <svg
              className="w-5 h-5 text-[#2a2a2a] ml-2 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </div>
        </a>
      );
    }
    // 外部リンクが未設定
    return (
      <div className="block w-full min-h-[80px] p-4 bg-[#eff0f3] rounded-lg border border-[#0d0d0d] opacity-60 cursor-not-allowed">
        <h2 className="text-lg font-bold text-[#2a2a2a] mb-1">{menu.title}</h2>
        {menu.description && (
          <p className="text-sm text-[#2a2a2a]">{menu.description}</p>
        )}
        <p className="text-xs text-[#2a2a2a] mt-2 font-medium">準備中</p>
      </div>
    );
  }

  // 内部フォームの場合
  if (menu.link_type === 'internal') {
    // 内部フォームのURLを生成（link_urlが未設定の場合でも）
    // link_urlが相対パスの場合はそのまま使用、絶対パスの場合は/portal/を付ける
    let formUrl: string;
    if (menu.link_url) {
      // link_urlが設定されている場合
      if (menu.link_url.startsWith('/')) {
        // 既に絶対パスの場合
        formUrl = menu.link_url.startsWith('/portal/') 
          ? menu.link_url 
          : `/portal${menu.link_url}`;
      } else {
        // 相対パスの場合
        formUrl = `/portal/${schoolCode}/${menu.link_url}`;
      }
    } else {
      // link_urlが未設定の場合、/portal/[schoolCode]/[menu_key]を生成
      formUrl = `/portal/${schoolCode}/${menu.menu_key}`;
    }
    
    if (isFormActive) {
      // フォームが公開期間内
      return (
        <Link
          href={formUrl}
          className="block w-full min-h-[80px] p-4 bg-[#ff8e3c] rounded-lg border border-[#0d0d0d] hover:bg-[#ff9e5c] transition-colors active:bg-[#ff8e3c]"
        >
          <h2 className="text-lg font-bold text-[#0d0d0d] mb-1">{menu.title}</h2>
          {menu.description && (
            <p className="text-sm text-[#2a2a2a]">{menu.description}</p>
          )}
        </Link>
      );
    }
    // 公開期間外
    return (
      <div className="block w-full min-h-[80px] p-4 bg-[#eff0f3] rounded-lg border border-[#0d0d0d] opacity-60 cursor-not-allowed">
        <h2 className="text-lg font-bold text-[#2a2a2a] mb-1">{menu.title}</h2>
        {menu.description && (
          <p className="text-sm text-[#2a2a2a]">{menu.description}</p>
        )}
        <p className="text-xs text-[#2a2a2a] mt-2 font-medium">準備中</p>
      </div>
    );
  }

  // フォールバック
  return (
    <div className="block w-full min-h-[80px] p-4 bg-[#eff0f3] rounded-lg border border-[#0d0d0d] opacity-60 cursor-not-allowed">
      <h2 className="text-lg font-bold text-[#2a2a2a] mb-1">{menu.title}</h2>
      {menu.description && (
        <p className="text-sm text-[#2a2a2a]">{menu.description}</p>
      )}
      <p className="text-xs text-[#2a2a2a] mt-2 font-medium">準備中</p>
    </div>
  );
}
