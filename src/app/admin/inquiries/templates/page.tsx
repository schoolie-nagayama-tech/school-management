'use client';

/**
 * 問合せメールテンプレート管理ページ。
 * 教室長以上のみアクセス可。
 * 実体は InquiryTemplateManager コンポーネント（追客メールページのタブと共通）。
 */

import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Loading } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import AccessDenied from '@/components/AccessDenied';
import { InquiryTemplateManager } from '@/components/inquiries/InquiryTemplateManager';
import { ChevronLeft } from 'lucide-react';

export default function MailTemplatesPage() {
  const { profile } = useAuth();

  // ロールガード: 教室長以上
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';

  if (profile === null) {
    return (
      <AdminLayout headerTitle="メールテンプレート">
        <Loading className="min-h-[60vh]" />
      </AdminLayout>
    );
  }
  if (!isAdmin) {
    return (
      <AdminLayout>
        <AccessDenied message="この機能は教室長以上が利用できます" />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="メールテンプレート">
      <div className="max-w-4xl">
        {/* 戻るリンク */}
        <Link
          href="/admin/inquiries"
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-heading mb-6 transition-colors duration-150"
        >
          <ChevronLeft className="w-4 h-4" />
          問合せ一覧に戻る
        </Link>

        <InquiryTemplateManager />
      </div>
    </AdminLayout>
  );
}
