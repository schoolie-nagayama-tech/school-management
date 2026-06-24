'use client';

/**
 * 問合せ管理 — 一覧ページ。
 * admin / owner のみアクセス可。
 * 現在選択中の教室IDを getSelectedSchoolIds() で取得し、getInquiries() に渡す。
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Loading } from '@/components/ui';
import { Button } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterData } from '@/contexts/MasterDataContext';
import AccessDenied from '@/components/AccessDenied';
import {
  getInquiries,
  updateInquiry,
  getInquiryContacts,
  type InquiryFilters,
} from '@/lib/api/inquiries';
import { getMailLogs } from '@/lib/api/inquiryMail';
import type { InquiryContact, InquiryMailLog } from '@/types/database';
import { toast } from 'sonner';
import type { Inquiry, InquiryStatus } from '@/types/database';
import {
  STATUS_CONFIG,
  STATUS_OPTIONS,
  CONTACT_METHOD_LABELS,
  formatDate,
  formatDateTime,
} from './inquiryConstants';
import {
  Search,
  X,
  Upload,
  SlidersHorizontal,
  BarChart3,
  Send,
  Truck,
  ClipboardPaste,
  QrCode,
  Bookmark,
  UserPlus,
  Phone,
  Mail,
  MessageSquare,
  Building2,
  Package,
  ArrowRightLeft,
  Circle,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  Users,
} from 'lucide-react';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { InquiryReminders } from '@/components/inquiries/InquiryReminders';
import { InquiryManualAddModal } from '@/components/inquiries/InquiryManualAddModal';
import { InquiryPeriodSegmented } from '@/components/inquiries/InquiryPeriodSegmented';
import { resolvePeriod, formatPeriodLabel, type PeriodPreset } from '@/lib/utils/inquiryPeriod';

export default function InquiriesPage() {
  const { profile, getSelectedSchoolIds, selectedSchoolId } = useAuth();
  const { schools: masterSchools } = useMasterData();

  // ロールガード: admin / owner のみ
  const isAdmin =
    profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';

  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  // インラインでステータス更新中の問合せID（連打防止・disabled用）
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);

  // ---- 初回描画の同期（レイアウトシフト対策） ----
  // 一覧本体の初回取得が終わったか / リマインドの読み込みが終わったか。
  // 両方そろうまで本文を出さず、リマインド+カード+一覧を一度に描画することで
  // 「一覧が出た後にリマインドが差し込まれて下にズレる」現象を防ぐ。
  const [hasLoaded, setHasLoaded] = useState(false);
  const [remindersReady, setRemindersReady] = useState(false);
  const handleRemindersReady = useCallback(() => setRemindersReady(true), []);

  // アコーディオン展開行のID集合
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // 展開行のタイムラインキャッシュ (inquiryId → アイテム配列)
  type TimelineItem =
    | { kind: 'contact'; at: string; data: InquiryContact }
    | { kind: 'mail_log'; at: string; data: InquiryMailLog };
  const [timelineCache, setTimelineCache] = useState<Map<string, TimelineItem[]>>(new Map());
  const [timelineLoading, setTimelineLoading] = useState<Set<string>>(new Set());

  // ---- 一覧でステータスをその場で切り替える ----
  // 行クリックの遷移とは独立。楽観更新し、失敗時は元に戻してトースト表示する。
  const handleInlineStatusChange = useCallback(
    async (inquiry: Inquiry, newStatus: InquiryStatus) => {
      if (newStatus === inquiry.status) return;
      const prevStatus = inquiry.status;
      // 楽観更新
      setInquiries((list) =>
        list.map((q) => (q.id === inquiry.id ? { ...q, status: newStatus } : q))
      );
      setStatusUpdatingId(inquiry.id);
      try {
        await updateInquiry(inquiry.id, { status: newStatus });
        toast.success(`「${STATUS_CONFIG[newStatus].label}」に変更しました`);
      } catch (err) {
        // 失敗したら元のステータスに戻す
        setInquiries((list) =>
          list.map((q) => (q.id === inquiry.id ? { ...q, status: prevStatus } : q))
        );
        toast.error(getUserErrorMessage(err, 'ステータスの変更に失敗しました'));
      } finally {
        setStatusUpdatingId(null);
      }
    },
    []
  );

  /** 行クリックでアコーディオンを開閉する。初回展開時にタイムラインを遅延フェッチ */
  const handleRowToggle = useCallback(
    async (inquiry: Inquiry) => {
      const id = inquiry.id;
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });

      // キャッシュ済みなら fetch しない
      if (timelineCache.has(id)) return;

      // 初回展開時に fetch
      setTimelineLoading((prev) => new Set(prev).add(id));
      try {
        const [contacts, mailLogs] = await Promise.all([getInquiryContacts(id), getMailLogs(id)]);
        const items: TimelineItem[] = [
          ...contacts.map((c): TimelineItem => ({ kind: 'contact', at: c.contacted_at, data: c })),
          ...mailLogs.map((m): TimelineItem => ({ kind: 'mail_log', at: m.sent_at, data: m })),
        ].sort((a, b) => b.at.localeCompare(a.at));
        setTimelineCache((prev) => new Map(prev).set(id, items));
      } catch {
        // fetch 失敗時はキャッシュに空配列をセット（再試行防止）
        setTimelineCache((prev) => new Map(prev).set(id, []));
      } finally {
        setTimelineLoading((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [timelineCache]
  );

  // ---- フィルタ状態 ----
  const [filterStatus, setFilterStatus] = useState<InquiryStatus | 'all'>('all');
  const [filterGrade, setFilterGrade] = useState('');
  const [filterMedia, setFilterMedia] = useState('');
  // 期間セレクタの状態。一覧のデフォルトは「今月」。
  const [filterPreset, setFilterPreset] = useState<PeriodPreset>('this_month');
  const [filterCustomFrom, setFilterCustomFrom] = useState('');
  const [filterCustomTo, setFilterCustomTo] = useState('');
  // 解決済み日付フィルタ（fetchData の依存に使う）。初期値は当月境界で揃える。
  const [filterDateFrom, setFilterDateFrom] = useState(() => resolvePeriod('this_month').dateFrom);
  const [filterDateTo, setFilterDateTo] = useState(() => resolvePeriod('this_month').dateTo);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  /**
   * 期間ピッカーの onChange ハンドラ。
   * プリセット変更時に resolvePeriod で日付境界を解決し、
   * filterDateFrom / filterDateTo に流してデータ再取得をトリガーする。
   */
  const handlePeriodChange = (preset: PeriodPreset, customFrom: string, customTo: string) => {
    setFilterPreset(preset);
    setFilterCustomFrom(customFrom);
    setFilterCustomTo(customTo);
    const { dateFrom, dateTo } = resolvePeriod(preset, customFrom, customTo);
    setFilterDateFrom(dateFrom);
    setFilterDateTo(dateTo);
  };

  // 教室名マップ（school_id → name）
  const [schoolsMap, setSchoolsMap] = useState<Record<string, string>>({});

  // 複数教室表示時のみ「教室」列を表示するか判定
  const schoolIds = getSelectedSchoolIds();
  const isMultiSchool = schoolIds.length > 1;

  // 教室が切り替わったら本文ゲートを一旦閉じ、新教室のリマインド+一覧が
  // そろってから出す（認証シード前の空→確定の遷移でのズレも防ぐ）。
  const schoolKey = schoolIds.join(',');
  const prevSchoolKeyRef = useRef(schoolKey);
  useEffect(() => {
    if (prevSchoolKeyRef.current !== schoolKey) {
      prevSchoolKeyRef.current = schoolKey;
      setRemindersReady(false);
      setHasLoaded(false);
    }
  }, [schoolKey]);

  // 手入力モーダルの開閉状態
  const [isManualAddOpen, setIsManualAddOpen] = useState(false);

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
      // ステータスはあえてサーバーに渡さない。上部のステータス別カードが
      // 常に全内訳を表示できるよう、ステータス絞り込みはクライアント側で行う。
      const filters: InquiryFilters = {};
      if (filterGrade) filters.grade = filterGrade;
      if (filterMedia) filters.media = filterMedia;
      if (filterDateFrom) filters.dateFrom = filterDateFrom;
      if (filterDateTo) filters.dateTo = filterDateTo;
      if (searchQuery.trim()) filters.search = searchQuery.trim();

      const data = await getInquiries(ids, filters);
      setInquiries(data);

      // 教室名マップを更新
      const map: Record<string, string> = {};
      masterSchools.forEach((s) => {
        map[s.id] = s.name;
      });
      setSchoolsMap(map);
    } catch (err) {
      setErrorMessage(getUserErrorMessage(err, 'データの取得に失敗しました'));
    } finally {
      setIsLoading(false);
      setHasLoaded(true); // 初回完了フラグ（以降は本文を出したまま）
    }
  }, [
    getSelectedSchoolIds,
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

  // ---- ステータス別の件数集計（カードに表示） ----
  // inquiries はステータス未絞り込みで取得しているので、ここで全内訳を数えられる。
  const statusCounts = React.useMemo(() => {
    const counts: Record<InquiryStatus, number> = {
      in_progress: 0,
      trial_waiting: 0,
      trial_done: 0,
      enrolled: 0,
      unreachable: 0,
      lost: 0,
      trial_lost: 0,
    };
    for (const q of inquiries) {
      if (q.status in counts) counts[q.status] += 1;
    }
    return counts;
  }, [inquiries]);

  // ---- 表示対象（ステータスカード/プルダウンによるクライアント側フィルタ） ----
  const displayedInquiries = React.useMemo(
    () => (filterStatus === 'all' ? inquiries : inquiries.filter((q) => q.status === filterStatus)),
    [inquiries, filterStatus]
  );

  // ---- サマリー（入会率 = 選択期間内の入会 / 全件） ----
  const enrollRate =
    inquiries.length > 0 ? Math.round((statusCounts.enrolled / inquiries.length) * 100) : 0;

  // 本文を出してよいか（初回の一覧取得 + リマインド取得が両方そろったら true）。
  // 一度 true になれば以降の絞り込みでは false に戻さず、本文を出したまま更新する。
  const showContent = hasLoaded && remindersReady;

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
        <AccessDenied message="問合せ管理は教室長以上が利用できます" />
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
          {/* 手入力で追加 — 電話・直来など HP に元データが無い問合せを直接登録する */}
          <Button variant="secondary" size="sm" onClick={() => setIsManualAddOpen(true)}>
            <UserPlus className="w-4 h-4 mr-1.5" />
            手入力で追加
          </Button>
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

        {/* 読み込み中インジケータ（本文がそろうまで）。
            リマインド・カード・一覧を一度に出すことで「後から差し込まれて下にズレる」のを防ぐ。 */}
        {!showContent && (
          <div className="py-24">
            <Loading size="md" />
          </div>
        )}

        {/* 本文ラッパ。showContent まで hidden（display:none）。
            InquiryReminders は hidden 中もマウントされ取得を進め、完了を onReady で通知する。 */}
        <div className={showContent ? '' : 'hidden'}>
          {/* リマインドボード（要対応アラート）— リマインドがなければ何も表示しない */}
          <InquiryReminders schoolIds={schoolIds} onReady={handleRemindersReady} />

          {/* 操作バー: 左=集計コンテキスト（期間・入会率） / 右=期間切替・検索・絞り込み */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
              <span>
                集計期間{' '}
                <span className="font-medium text-text-body">
                  {formatPeriodLabel({ dateFrom: filterDateFrom, dateTo: filterDateTo })}
                </span>
              </span>
              <span>
                入会率 <span className="font-bold text-green-700 text-sm">{enrollRate}%</span>
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {/* 期間セレクタ（スライド式） */}
              <InquiryPeriodSegmented
                preset={filterPreset}
                customFrom={filterCustomFrom}
                customTo={filterCustomTo}
                onChange={handlePeriodChange}
              />
              {/* コンパクト検索（Enter で実行・×でクリア） */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setSearchQuery(searchInput.trim());
                }}
                className="relative"
              >
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="氏名・電話・メールで検索"
                  className="w-52 sm:w-60 pl-9 pr-8 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-heading focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-gray-400"
                />
                {searchInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchInput('');
                      setSearchQuery('');
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    aria-label="検索をクリア"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </form>
              {/* 絞り込み（詳細フィルターの開閉） */}
              <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors duration-150 shrink-0 ${
                  showFilters
                    ? 'bg-ink text-white border-ink'
                    : 'bg-surface-raised text-gray-600 border-border hover:bg-gray-50'
                }`}
              >
                <SlidersHorizontal className="h-4 w-4" />
                <span className="hidden sm:inline">絞り込み</span>
              </button>
            </div>
          </div>

          {/* ステータス別カード — クリックでそのステータスに絞り込む（再クリックで解除） */}
          <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {/* 「すべて」カード（総数・絞り込み解除） */}
            <button
              type="button"
              onClick={() => setFilterStatus('all')}
              className={`text-left rounded-lg border p-3 transition-[transform,background-color,border-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98] ${
                filterStatus === 'all'
                  ? 'border-ink bg-surface-hover ring-1 ring-ink/30'
                  : 'border-border bg-surface-raised hover:bg-surface-hover'
              }`}
            >
              <p className="text-[11px] text-text-muted mb-0.5">すべて</p>
              <p className="text-xl font-bold text-text-heading leading-none">{inquiries.length}</p>
            </button>

            {/* 各ステータスのカード */}
            {(Object.keys(STATUS_CONFIG) as InquiryStatus[]).map((s) => {
              const active = filterStatus === s;
              return (
                <button
                  key={s}
                  type="button"
                  // 再クリックで解除（'all' に戻す）
                  onClick={() => setFilterStatus(active ? 'all' : s)}
                  className={`text-left rounded-lg border p-3 transition-[transform,background-color,border-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98] ${
                    active
                      ? 'border-ink bg-surface-hover ring-1 ring-ink/30'
                      : 'border-border bg-surface-raised hover:bg-surface-hover'
                  }`}
                >
                  <span
                    className={`inline-block px-1.5 py-0.5 rounded-full text-[11px] font-medium mb-1 ${STATUS_CONFIG[s].className}`}
                  >
                    {STATUS_CONFIG[s].label}
                  </span>
                  <p className="text-xl font-bold text-text-heading leading-none">
                    {statusCounts[s]}
                  </p>
                </button>
              );
            })}
          </div>

          {/* 詳細フィルター（折りたたみ） */}
          {showFilters && (
            <div className="mb-4 bg-surface-raised rounded-xl border border-border p-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {/* ステータス */}
                <div>
                  <label className="block text-xs font-medium text-text-heading mb-1">
                    ステータス
                  </label>
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value as InquiryStatus | 'all')}
                    className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
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
              </div>
              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs text-gray-500">
                  {displayedInquiries.length}件表示
                  <span className="ml-2 text-text-faint">
                    期間は画面上部の期間セレクタで切り替えできます
                  </span>
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setFilterStatus('all');
                    setFilterGrade('');
                    setFilterMedia('');
                    // 期間は既定の「今月」に戻す
                    const def = resolvePeriod('this_month');
                    setFilterPreset('this_month');
                    setFilterCustomFrom('');
                    setFilterCustomTo('');
                    setFilterDateFrom(def.dateFrom);
                    setFilterDateTo(def.dateTo);
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
              <h2 className="text-lg font-bold text-text-heading">
                問合せ一覧
                {filterStatus !== 'all' && (
                  <span className="ml-2 text-sm font-normal text-text-muted">
                    （{STATUS_CONFIG[filterStatus].label}で絞り込み中）
                  </span>
                )}
              </h2>
              <p className="text-sm text-text-muted">{displayedInquiries.length}件</p>
            </div>

            {isLoading ? (
              <Loading size="md" />
            ) : displayedInquiries.length === 0 ? (
              <div className="text-center py-8 text-text-body">
                該当する問合せがありません。フィルターを変更してください。
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse border border-border text-sm">
                  <thead>
                    <tr className="bg-surface-hover">
                      <th className="border border-border px-3 py-2.5 text-left font-medium text-text-heading">
                        受付日
                      </th>
                      {/* 複数教室表示時のみ教室列を出す */}
                      {isMultiSchool && (
                        <th className="border border-border px-3 py-2.5 text-left font-medium text-text-heading">
                          教室
                        </th>
                      )}
                      <th className="border border-border px-3 py-2.5 text-left font-medium text-text-heading">
                        生徒名
                      </th>
                      <th className="border border-border px-3 py-2.5 text-left font-medium text-text-heading">
                        保護者名
                      </th>
                      <th className="border border-border px-3 py-2.5 text-left font-medium text-text-heading">
                        学年
                      </th>
                      <th className="border border-border px-3 py-2.5 text-left font-medium text-text-heading">
                        媒体
                      </th>
                      <th className="border border-border px-3 py-2.5 text-left font-medium text-text-heading">
                        申込内容
                      </th>
                      <th className="border border-border px-3 py-2.5 text-center font-medium text-text-heading">
                        ステータス
                      </th>
                      <th className="border border-border px-2 py-2.5 text-center font-medium text-text-heading w-8">
                        詳細
                      </th>
                      <th className="border border-border px-2 py-2.5 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedInquiries.map((inquiry) => {
                      const sc = STATUS_CONFIG[inquiry.status];
                      const isExpanded = expandedIds.has(inquiry.id);
                      const isLoadingTimeline = timelineLoading.has(inquiry.id);
                      const timelineItems = timelineCache.get(inquiry.id) ?? [];

                      return (
                        // key はフラグメントに付与する（React の list key 要件）
                        <React.Fragment key={inquiry.id}>
                          {/* メイン行 — クリックでアコーディオン開閉 */}
                          <tr
                            onClick={() => handleRowToggle(inquiry)}
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
                            {/* 生徒名: 未入力で保護者名にフォールバックしている場合は
                              「保護者名」バッジ付きで表示し、表示名が保護者名だと分かるようにする */}
                            <td className="border border-border px-3 py-2.5 font-medium text-text-heading">
                              {inquiry.student_name?.trim() ? (
                                inquiry.student_name
                              ) : inquiry.guardian_name?.trim() ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <span className="italic font-normal text-text-body">
                                    {inquiry.guardian_name}
                                  </span>
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 shrink-0">
                                    保護者名
                                  </span>
                                </span>
                              ) : (
                                '—'
                              )}
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
                            {/* ステータスはその場でプルダウン切替（行クリックのアコーディオン開閉は止める） */}
                            <td
                              className="border border-border px-3 py-2.5 text-center"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <select
                                value={inquiry.status}
                                disabled={statusUpdatingId === inquiry.id}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) =>
                                  handleInlineStatusChange(inquiry, e.target.value as InquiryStatus)
                                }
                                className={`px-2 py-1 rounded-full text-xs font-medium border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60 ${sc.className}`}
                                aria-label="ステータスを変更"
                              >
                                {(Object.keys(STATUS_CONFIG) as InquiryStatus[]).map((s) => (
                                  <option key={s} value={s}>
                                    {STATUS_CONFIG[s].label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            {/* 詳細ページへのリンク（アコーディオン展開とは独立） */}
                            <td
                              className="border border-border px-2 py-2.5 text-center"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <a
                                href={`/admin/inquiries/${inquiry.id}`}
                                aria-label="詳細を開く"
                                className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-surface-hover text-text-muted hover:text-text-heading transition-colors"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            </td>
                            {/* 展開インジケータ */}
                            <td className="border border-border px-2 py-2.5 text-center text-text-muted">
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4 inline" />
                              ) : (
                                <ChevronRight className="w-4 h-4 inline" />
                              )}
                            </td>
                          </tr>

                          {/* アコーディオン展開行 */}
                          {isExpanded && (
                            <tr key={`${inquiry.id}-detail`}>
                              <td
                                colSpan={isMultiSchool ? 11 : 10}
                                className="border border-border bg-surface px-4 py-3"
                              >
                                {isLoadingTimeline ? (
                                  <p className="text-xs text-text-muted">読み込み中...</p>
                                ) : timelineItems.length === 0 ? (
                                  <p className="text-xs text-text-muted">履歴なし</p>
                                ) : (
                                  <div className="space-y-1.5">
                                    {timelineItems.slice(0, 5).map((item) => {
                                      if (item.kind === 'contact') {
                                        const c = item.data;
                                        const Icon =
                                          {
                                            tel: Phone,
                                            email: Mail,
                                            sms: MessageSquare,
                                            visit: Building2,
                                            interview: Users,
                                            other: Circle,
                                            material_sent: Package,
                                            status_change: ArrowRightLeft,
                                          }[c.method] ?? Circle;
                                        return (
                                          <div
                                            key={`c-${c.id}`}
                                            className="flex items-center gap-2 text-xs text-text-body"
                                          >
                                            <Icon className="w-3.5 h-3.5 text-text-muted shrink-0" />
                                            <span className="font-medium">
                                              {CONTACT_METHOD_LABELS[c.method] ?? c.method}
                                            </span>
                                            <span className="text-text-muted">
                                              {formatDate(c.contacted_at)}
                                            </span>
                                            {c.result && (
                                              <span className="px-1.5 py-0.5 bg-surface-hover rounded">
                                                {c.result}
                                              </span>
                                            )}
                                            {c.note && (
                                              <span className="text-text-muted truncate max-w-xs">
                                                {c.note}
                                              </span>
                                            )}
                                          </div>
                                        );
                                      } else {
                                        const m = item.data;
                                        return (
                                          <div
                                            key={`m-${m.id}`}
                                            className="flex items-center gap-2 text-xs text-text-body"
                                          >
                                            <Send className="w-3.5 h-3.5 text-text-muted shrink-0" />
                                            <span className="font-medium">メール送信</span>
                                            <span className="text-text-muted">
                                              {formatDateTime(m.sent_at)}
                                            </span>
                                            <span
                                              className={`px-1.5 py-0.5 rounded ${m.status === 'sent' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'}`}
                                            >
                                              {m.status === 'sent' ? '送信済み' : '失敗'}
                                            </span>
                                            {m.subject && (
                                              <span className="text-text-muted truncate max-w-xs">
                                                {m.subject}
                                              </span>
                                            )}
                                          </div>
                                        );
                                      }
                                    })}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        {/* /本文ラッパ（showContent ゲート） */}
      </div>
      {/* 手入力で追加モーダル */}
      <InquiryManualAddModal
        isOpen={isManualAddOpen}
        onClose={() => setIsManualAddOpen(false)}
        schools={masterSchools}
        defaultSchoolId={selectedSchoolId !== 'all' ? (selectedSchoolId ?? undefined) : undefined}
        onCreated={() => {
          setIsManualAddOpen(false);
          fetchData();
        }}
      />
    </AdminLayout>
  );
}
