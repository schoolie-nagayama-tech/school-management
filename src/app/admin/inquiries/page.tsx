'use client';

/**
 * 問合せ管理 — 一覧ページ。
 * admin / owner のみアクセス可。
 * 現在選択中の教室IDを getSelectedSchoolIds() で取得し、getInquiries() に渡す。
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Loading } from '@/components/ui';
import { Button } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterData } from '@/contexts/MasterDataContext';
import AccessDenied from '@/components/AccessDenied';
import {
  getInquiries,
  type InquiryFilters,
} from '@/lib/api/inquiries';
import type { Inquiry, InquiryStatus } from '@/types/database';
import {
  STATUS_CONFIG,
  STATUS_OPTIONS,
  formatDate,
} from './inquiryConstants';
import { Search, X, Upload, SlidersHorizontal, BarChart3, Send, Truck, ClipboardPaste, QrCode, Bookmark } from 'lucide-react';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { InquiryReminders } from '@/components/inquiries/InquiryReminders';

export default function InquiriesPage() {
  const { profile, getSelectedSchoolIds, selectedSchoolId } = useAuth();
  const { schools: masterSchools } = useMasterData();

  // ロールガード: admin / owner のみ
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner';

  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // ---- フィルタ状態 ----
  const [filterStatus, setFilterStatus] = useState<InquiryStatus | 'all'>('all');
  const [filterGrade, setFilterGrade] = useState('');
  const [filterMedia, setFilterMedia] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // 教室名マップ（school_id → name）
  const [schoolsMap, setSchoolsMap] = useState<Record<string, string>>({});

  // 複数教室表示時のみ「教室」列を表示するか判定
  const schoolIds = getSelectedSchoolIds();
  const isMultiSchool = schoolIds.length > 1;

  // ---- データ取得 ----
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const ids = getSelectedSchoolIds();
      if (ids.length === 0) {
        setErrorMessage('教室が選択されていません');
        setIsLoading(false);
        return;
      }

      // フィルタ条件の組み立て
      const filters: InquiryFilters = {};
      if (filterStatus !== 'all') filters.status = filterStatus;
      if (filterGrade) filters.grade = filterGrade;
      if (filterMedia) filters.media = filterMedia;
      if (filterDateFrom) filters.dateFrom = filterDateFrom;
      if (filterDateTo) filters.dateTo = filterDateTo;
      if (searchQuery.trim()) filters.search = searchQuery.trim();

      const data = await getInquiries(ids, filters);
      setInquiries(data);

      // 教室名マップを更新
      const map: Record<string, string> = {};
      masterSchools.forEach((s) => { map[s.id] = s.name; });
      setSchoolsMap(map);
    } catch (err) {
      setErrorMessage(getUserErrorMessage(err, 'データの取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [
    getSelectedSchoolIds,
    filterStatus,
    filterGrade,
    filterMedia,
    filterDateFrom,
    filterDateTo,
    searchQuery,
    masterSchools,
  ]);

  useEffect(() => {
    if (selectedSchoolId !== null) {
      fetchData();
    }
  }, [fetchData, selectedSchoolId]);

  // ---- サマリー（対応中 / 今月 / 入会率） ----
  const now = new Date();
  const thisMonthCount = inquiries.filter((q) => {
    const d = new Date(q.inquired_at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
  const inProgressCount = inquiries.filter((q) => q.status === 'in_progress').length;
  const enrolledCount = inquiries.filter((q) => q.status === 'enrolled').length;
  const enrollRate =
    inquiries.length > 0
      ? Math.round((enrolledCount / inquiries.length) * 100)
      : 0;

  // ---- ロールチェック前のローディング対応 ----
  if (profile === null) {
    return (
      <AdminLayout headerTitle="問合せ管理">
        <Loading className="min-h-[60vh]" />
      </AdminLayout>
    );
  }

  if (!isAdmin) {
    return (
      <AdminLayout>
        <AccessDenied message="問合せ管理は管理者のみ利用できます" />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      headerTitle="問合せ管理"
      actions={
        <div className="flex items-center gap-2">
          {/* 貼り付けて追加 — 目玉機能につき primary で先頭配置 */}
          <Link href="/admin/inquiries/paste">
            <Button variant="primary" size="sm">
              <ClipboardPaste className="w-4 h-4 mr-1.5" />
              貼り付けて追加
            </Button>
          </Link>
          <Link href="/admin/inquiries/analytics">
            <Button variant="outline" size="sm">
              <BarChart3 className="w-4 h-4 mr-1.5" />
              分析
            </Button>
          </Link>
          {/* 追客メール（本日の送信候補・一括送信） */}
          <Link href="/admin/inquiries/mail">
            <Button variant="outline" size="sm">
              <Send className="w-4 h-4 mr-1.5" />
              追客メール
            </Button>
          </Link>
          {/* 資料発送（ネコポスCSV出力・教室別発送設定） */}
          <Link href="/admin/inquiries/shipping">
            <Button variant="outline" size="sm">
              <Truck className="w-4 h-4 mr-1.5" />
              資料発送
            </Button>
          </Link>
          {/* 公開問合せフォーム（URL・QRコードの管理） */}
          <Link href="/admin/inquiries/form">
            <Button variant="outline" size="sm">
              <QrCode className="w-4 h-4 mr-1.5" />
              公開フォーム
            </Button>
          </Link>
          <Link href="/admin/inquiries/import">
            <Button variant="secondary" size="sm">
              <Upload className="w-4 h-4 mr-1.5" />
              CSV取込
            </Button>
          </Link>
          {/* 本部HP ブックマークレット取込設定 */}
          <Link href="/admin/inquiries/connect">
            <Button variant="outline" size="sm">
              <Bookmark className="w-4 h-4 mr-1.5" />
              HP取込設定
            </Button>
          </Link>
        </div>
      }
    >
      <div>
        {errorMessage && (
          <div className="mb-4 p-4 bg-danger/20 border border-danger rounded-lg">
            <p className="text-sm text-danger">{errorMessage}</p>
          </div>
        )}

        {/* リマインドボード（要対応アラート）— リマインドがなければ何も表示しない */}
        <InquiryReminders schoolIds={schoolIds} />

        {/* サマリーカード */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-surface-raised border border-border rounded-lg p-4">
            <p className="text-xs text-text-muted mb-1">対応中</p>
            <p className="text-2xl font-bold text-blue-700">{inProgressCount}</p>
          </div>
          <div className="bg-surface-raised border border-border rounded-lg p-4">
            <p className="text-xs text-text-muted mb-1">今月の問合せ</p>
            <p className="text-2xl font-bold text-text-heading">{thisMonthCount}</p>
          </div>
          <div className="bg-surface-raised border border-border rounded-lg p-4">
            <p className="text-xs text-text-muted mb-1">入会率（全期間）</p>
            <p className="text-2xl font-bold text-green-700">{enrollRate}%</p>
          </div>
        </div>

        {/* 検索 + フィルタトグル */}
        <div className="mb-4 bg-surface-raised rounded-xl border border-border p-3">
          <form
            onSubmit={(e) => { e.preventDefault(); setSearchQuery(searchInput.trim()); }}
            className="flex items-center gap-2"
          >
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="氏名・電話・メールで検索"
                className="w-full pl-9 pr-8 py-2 border border-border rounded-lg text-sm bg-surface-raised text-text-heading focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-gray-400"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => { setSearchInput(''); setSearchQuery(''); }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <button
              type="submit"
              className="px-3 py-2 bg-ink text-white rounded-lg text-sm hover:bg-ink/80 transition-colors duration-150 shrink-0"
            >
              検索
            </button>
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors duration-150 shrink-0 ${
                showFilters
                  ? 'bg-ink text-white border-ink'
                  : 'bg-surface-raised text-gray-600 border-border hover:bg-gray-50'
              }`}
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span className="hidden sm:inline">絞り込み</span>
            </button>
          </form>
        </div>

        {/* 詳細フィルター（折りたたみ） */}
        {showFilters && (
          <div className="mb-4 bg-surface-raised rounded-xl border border-border p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {/* ステータス */}
              <div>
                <label className="block text-xs font-medium text-text-heading mb-1">ステータス</label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as InquiryStatus | 'all')}
                  className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* 学年 */}
              <div>
                <label className="block text-xs font-medium text-text-heading mb-1">学年</label>
                <input
                  type="text"
                  value={filterGrade}
                  onChange={(e) => setFilterGrade(e.target.value)}
                  placeholder="例: 中2"
                  className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* 媒体 */}
              <div>
                <label className="block text-xs font-medium text-text-heading mb-1">媒体</label>
                <input
                  type="text"
                  value={filterMedia}
                  onChange={(e) => setFilterMedia(e.target.value)}
                  placeholder="例: 友人紹介"
                  className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* 受付日 */}
              <div className="col-span-2 sm:col-span-2 lg:col-span-1">
                <label className="block text-xs font-medium text-text-heading mb-1">受付日</label>
                <div className="flex items-center gap-1">
                  <input
                    type="date"
                    value={filterDateFrom}
                    onChange={(e) => setFilterDateFrom(e.target.value)}
                    className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <span className="text-xs text-gray-400 shrink-0">〜</span>
                  <input
                    type="date"
                    value={filterDateTo}
                    onChange={(e) => setFilterDateTo(e.target.value)}
                    className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs text-gray-500">{inquiries.length}件表示</p>
              <button
                type="button"
                onClick={() => {
                  setFilterStatus('all');
                  setFilterGrade('');
                  setFilterMedia('');
                  setFilterDateFrom('');
                  setFilterDateTo('');
                  setSearchInput('');
                  setSearchQuery('');
                }}
                className="text-xs text-blue-600 hover:text-blue-800 transition-colors duration-150"
              >
                リセット
              </button>
            </div>
          </div>
        )}

        {/* 一覧テーブル */}
        <div className="bg-surface-raised rounded-xl border border-border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-text-heading">問合せ一覧</h2>
            <p className="text-sm text-text-muted">{inquiries.length}件</p>
          </div>

          {isLoading ? (
            <Loading size="md" />
          ) : inquiries.length === 0 ? (
            <div className="text-center py-8 text-text-body">
              該当する問合せがありません。フィルターを変更してください。
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-border text-sm">
                <thead>
                  <tr className="bg-surface-hover">
                    <th className="border border-border px-3 py-2.5 text-left font-medium text-text-heading">受付日</th>
                    {/* 複数教室表示時のみ教室列を出す */}
                    {isMultiSchool && (
                      <th className="border border-border px-3 py-2.5 text-left font-medium text-text-heading">教室</th>
                    )}
                    <th className="border border-border px-3 py-2.5 text-left font-medium text-text-heading">生徒名</th>
                    <th className="border border-border px-3 py-2.5 text-left font-medium text-text-heading">保護者名</th>
                    <th className="border border-border px-3 py-2.5 text-left font-medium text-text-heading">学年</th>
                    <th className="border border-border px-3 py-2.5 text-left font-medium text-text-heading">媒体</th>
                    <th className="border border-border px-3 py-2.5 text-left font-medium text-text-heading">申込内容</th>
                    <th className="border border-border px-3 py-2.5 text-center font-medium text-text-heading">ステータス</th>
                  </tr>
                </thead>
                <tbody>
                  {inquiries.map((inquiry) => {
                    const sc = STATUS_CONFIG[inquiry.status];
                    return (
                      <tr
                        key={inquiry.id}
                        onClick={() => window.location.href = `/admin/inquiries/${inquiry.id}`}
                        className="table-row-hover cursor-pointer"
                      >
                        <td className="border border-border px-3 py-2.5 whitespace-nowrap text-text-body">
                          {formatDate(inquiry.inquired_at)}
                        </td>
                        {isMultiSchool && (
                          <td className="border border-border px-3 py-2.5 text-text-body">
                            {schoolsMap[inquiry.school_id] ?? '—'}
                          </td>
                        )}
                        <td className="border border-border px-3 py-2.5 font-medium text-text-heading">
                          {inquiry.student_name ?? '—'}
                        </td>
                        <td className="border border-border px-3 py-2.5 text-text-body">
                          {inquiry.guardian_name ?? '—'}
                        </td>
                        <td className="border border-border px-3 py-2.5 text-text-body">
                          {inquiry.grade ?? '—'}
                        </td>
                        <td className="border border-border px-3 py-2.5 text-text-body">
                          {inquiry.media ?? '—'}
                        </td>
                        <td className="border border-border px-3 py-2.5 text-text-body">
                          {inquiry.request_type ?? '—'}
                        </td>
                        <td className="border border-border px-3 py-2.5 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${sc.className}`}>
                            {sc.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
