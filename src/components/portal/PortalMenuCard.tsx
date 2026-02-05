'use client';

import Link from 'next/link';
import type { PortalMenu } from '@/types/database';

// ポータル用・緑基調・柔らかく透明感のあるスタイル・タッチしやすい高さ
const cardActive =
  'block w-full min-h-[56px] sm:min-h-[64px] p-4 rounded-2xl border border-emerald-300/50 bg-emerald-500 text-white hover:bg-emerald-600 active:bg-emerald-600/95 shadow-sm transition-all duration-200';
const cardDisabled =
  'block w-full min-h-[56px] sm:min-h-[64px] p-4 rounded-2xl border border-slate-200/80 bg-white/60 backdrop-blur-sm text-slate-500 cursor-not-allowed';

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
        <div className="w-full space-y-3">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-700 mb-0.5">{menu.title}</h2>
            {menu.description && (
              <p className="text-sm text-slate-600">{menu.description}</p>
            )}
          </div>
          <div className="space-y-2">
            {menu.link_urls.map((link, index) => (
              <a
                key={index}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`${cardActive} flex items-center justify-between`}
              >
                <span className="text-base font-medium text-white">{link.label}</span>
                <svg className="w-5 h-5 flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            ))}
          </div>
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
          className={`${cardActive} flex items-start sm:items-center justify-between gap-3`}
        >
          <div className="flex-1 min-w-0">
            <h2 className="text-base sm:text-lg font-bold text-white mb-0.5">{menu.title}</h2>
            {menu.description && <p className="text-sm text-white/90">{menu.description}</p>}
          </div>
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      );
    }
    // 外部リンクが未設定
    return (
      <div className={cardDisabled}>
        <h2 className="text-base sm:text-lg font-bold text-slate-500 mb-0.5">{menu.title}</h2>
        {menu.description && <p className="text-sm text-slate-400">{menu.description}</p>}
        <p className="text-xs font-medium mt-2 text-slate-400">準備中</p>
      </div>
    );
  }

  // 内部フォームの場合
  if (menu.link_type === 'internal') {
    let formUrl: string;
    if (menu.link_url && menu.link_url.startsWith('/portal/')) {
      formUrl = menu.link_url;
    } else {
      formUrl = `/portal/${schoolCode}/${menu.menu_key}`;
    }

    if (isFormActive) {
      return (
        <Link href={formUrl} className={cardActive}>
          <h2 className="text-base sm:text-lg font-bold text-white mb-0.5">{menu.title}</h2>
          {menu.description && <p className="text-sm text-white/90">{menu.description}</p>}
          <span className="sr-only">お申し込みはこちら</span>
        </Link>
      );
    }
    return (
      <div className={cardDisabled}>
        <h2 className="text-base sm:text-lg font-bold text-slate-500 mb-0.5">{menu.title}</h2>
        {menu.description && <p className="text-sm text-slate-400">{menu.description}</p>}
        <p className="text-xs font-medium mt-2 text-slate-400">準備中</p>
      </div>
    );
  }

  return (
    <div className={cardDisabled}>
      <h2 className="text-base sm:text-lg font-bold text-slate-500 mb-0.5">{menu.title}</h2>
      {menu.description && <p className="text-sm text-slate-400">{menu.description}</p>}
      <p className="text-xs font-medium mt-2 text-slate-400">準備中</p>
    </div>
  );
}
