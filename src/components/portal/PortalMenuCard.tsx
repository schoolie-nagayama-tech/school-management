'use client';

import Link from 'next/link';
import type { PortalMenu } from '@/types/database';

interface PortalMenuCardProps {
  menu: PortalMenu;
  schoolCode: string;
  isFormActive?: boolean; // フォームが公開期間内かどうか
}

export function PortalMenuCard({ menu, schoolCode, isFormActive = false }: PortalMenuCardProps) {
  const isMendan = menu.menu_key === 'mendan';
  
  // 外部リンクの場合
  if (menu.link_type === 'external') {
    // 面談申し込みで複数リンクがある場合
    if (isMendan && menu.link_urls && menu.link_urls.length > 0) {
      return (
        <div className="w-full space-y-2">
          <div className="mb-2">
            <h2 className="text-lg font-bold text-[#1f2937] mb-1">{menu.title}</h2>
            {menu.description && (
              <p className="text-sm text-[#4b5563]">{menu.description}</p>
            )}
          </div>
          {menu.link_urls.map((link, index) => (
            <a
              key={index}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full min-h-[60px] p-3 bg-[#3b82f6] rounded-lg border border-[#e5e7eb] hover:bg-[#60a5fa] transition-colors active:bg-[#3b82f6]"
            >
              <div className="flex items-center justify-between">
                <span className="text-base font-medium text-[#1f2937]">{link.label}</span>
                <svg
                  className="w-4 h-4 text-[#4b5563] ml-2 flex-shrink-0"
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
          ))}
        </div>
      );
    }
    
    // 単一外部リンクの場合
    if (menu.link_url) {
      return (
        <a
          href={menu.link_url}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full min-h-[80px] p-4 bg-[#3b82f6] rounded-lg border border-[#e5e7eb] hover:bg-[#60a5fa] transition-colors active:bg-[#3b82f6]"
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h2 className="text-lg font-bold text-[#1f2937] mb-1">{menu.title}</h2>
              {menu.description && (
                <p className="text-sm text-[#4b5563]">{menu.description}</p>
              )}
            </div>
            <svg
              className="w-5 h-5 text-[#4b5563] ml-2 flex-shrink-0"
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
      <div className="block w-full min-h-[80px] p-4 bg-[#f3f4f6] rounded-lg border border-[#e5e7eb] opacity-60 cursor-not-allowed">
        <h2 className="text-lg font-bold text-[#4b5563] mb-1">{menu.title}</h2>
        {menu.description && (
          <p className="text-sm text-[#4b5563]">{menu.description}</p>
        )}
        <p className="text-xs text-[#4b5563] mt-2 font-medium">準備中</p>
      </div>
    );
  }

  // 内部フォームの場合
  if (menu.link_type === 'internal') {
    // 内部フォームのURLを生成
    // 常に /portal/[schoolCode]/[menu_key] の形式を使用
    // link_urlが設定されていても、menu_keyを優先して使用
    let formUrl: string;
    if (menu.link_url && menu.link_url.startsWith('/portal/')) {
      // link_urlが既に /portal/ で始まる完全なURLの場合（例: /portal/DEFAULT/moshi）
      formUrl = menu.link_url;
    } else {
      // link_urlが未設定、または相対パスの場合、menu_keyを使用
      formUrl = `/portal/${schoolCode}/${menu.menu_key}`;
    }
    
    if (isFormActive) {
      // フォームが公開期間内
      return (
        <Link
          href={formUrl}
          className="block w-full min-h-[80px] p-4 bg-[#3b82f6] rounded-lg border border-[#e5e7eb] hover:bg-[#60a5fa] transition-colors active:bg-[#3b82f6]"
        >
          <h2 className="text-lg font-bold text-[#1f2937] mb-1">{menu.title}</h2>
          {menu.description && (
            <p className="text-sm text-[#4b5563]">{menu.description}</p>
          )}
        </Link>
      );
    }
    // 公開期間外
    return (
      <div className="block w-full min-h-[80px] p-4 bg-[#f3f4f6] rounded-lg border border-[#e5e7eb] opacity-60 cursor-not-allowed">
        <h2 className="text-lg font-bold text-[#4b5563] mb-1">{menu.title}</h2>
        {menu.description && (
          <p className="text-sm text-[#4b5563]">{menu.description}</p>
        )}
        <p className="text-xs text-[#4b5563] mt-2 font-medium">準備中</p>
      </div>
    );
  }

  // フォールバック
  return (
    <div className="block w-full min-h-[80px] p-4 bg-[#f3f4f6] rounded-lg border border-[#e5e7eb] opacity-60 cursor-not-allowed">
      <h2 className="text-lg font-bold text-[#4b5563] mb-1">{menu.title}</h2>
      {menu.description && (
        <p className="text-sm text-[#4b5563]">{menu.description}</p>
      )}
      <p className="text-xs text-[#4b5563] mt-2 font-medium">準備中</p>
    </div>
  );
}
