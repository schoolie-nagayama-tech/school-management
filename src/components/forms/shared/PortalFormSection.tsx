import type { ReactNode } from 'react';

interface PortalFormSectionProps {
  title: string;
  /** タイトル直下の補助説明（任意） */
  description?: string;
  children: ReactNode;
}

/**
 * 保護者ポータルのフォーム内セクション（白カード + タイトル）。
 * 内容に rhythm を与えるための統一パターン。
 */
export function PortalFormSection({ title, description, children }: PortalFormSectionProps) {
  return (
    <section className="bg-white rounded-2xl border border-[#e5e7eb] p-5 sm:p-6">
      <h2 className="text-[15px] font-bold text-[#1a1a1a] tracking-tight mb-4">{title}</h2>
      {description && (
        <p className="text-xs text-[#6b7280] mb-4 -mt-2 leading-relaxed">{description}</p>
      )}
      {children}
    </section>
  );
}
