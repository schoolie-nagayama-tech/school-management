'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AdminLayout } from '@/components/layouts';
import { getFormResponses, type FormResponseWithStudent } from '@/lib/api/form-responses';
import { getFormPeriods } from '@/lib/api/form-periods';
import { useMasterData } from '@/contexts/MasterDataContext';
import type { FormType, FormPeriod } from '@/types/database';
import { FORM_TYPE_LABELS, GRADE_LABELS } from '@/types/database';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { ChevronUp, ChevronDown, ChevronsUpDown, Search, X, Filter, List, Users } from 'lucide-react';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

// フォーム種別 → フォーム詳細URLパス（/forms/responses/[path]/[period]）
const FORM_TYPE_TO_PATH: Record<string, string> = {
  mogi: 'mogi',       // Vもぎ申込
  moshi: 'moshi',     // 模試申込
  zoukoma: 'zoukoma', // 増コマ申込
  youbi: 'youbi',     // 曜日変更
  shukaisu: 'shukaisu', // 週回数変更
  soudan: 'soudan',   // お客様相談
  kyozai: 'kyozai',   // 教材販売
};

type SortKey = 'created_at' | 'form_type' | 'form_period' | 'school' | 'student_name' | 'grade' | 'status';
type SortOrder = 'asc' | 'desc';

interface QuickFilter {
  label: string;
  color: string;
  activeColor: string;
  filters: {
    formType: FormType | 'all';
    period: string;
    grade: number | 'all';
    linkedStatus: 'all' | 'linked' | 'unlinked';
    chargedStatus: 'all' | 'charged' | 'not_charged';
  };
}

const QUICK_FILTERS: QuickFilter[] = [
  {
    label: '未処理',
    color: 'border-yellow-300 text-yellow-800 bg-yellow-50 hover:bg-yellow-100',
    activeColor: 'bg-yellow-500 text-white border-yellow-500',
    filters: { formType: 'all', period: 'all', grade: 'all', linkedStatus: 'unlinked', chargedStatus: 'all' },
  },
  {
    label: '未計上',
    color: 'border-red-300 text-red-700 bg-red-50 hover:bg-red-100',
    activeColor: 'bg-red-500 text-white border-red-500',
    filters: { formType: 'all', period: 'all', grade: 'all', linkedStatus: 'all', chargedStatus: 'not_charged' },
  },
  {
    label: '計上済み',
    color: 'border-green-300 text-green-700 bg-green-50 hover:bg-green-100',
    activeColor: 'bg-green-500 text-white border-green-500',
    filters: { formType: 'all', period: 'all', grade: 'all', linkedStatus: 'all', chargedStatus: 'charged' },
  },
  {
    label: '増コマ・未計上',
    color: 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50',
    activeColor: 'bg-[#1e3a5f] text-white border-[#1e3a5f]',
    filters: { formType: 'zoukoma', period: 'all', grade: 'all', linkedStatus: 'all', chargedStatus: 'not_charged' },
  },
  {
    label: '模試・未計上',
    color: 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50',
    activeColor: 'bg-[#1e3a5f] text-white border-[#1e3a5f]',
    filters: { formType: 'moshi', period: 'all', grade: 'all', linkedStatus: 'all', chargedStatus: 'not_charged' },
  },
  {
    label: 'Vもぎ・未計上',
    color: 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50',
    activeColor: 'bg-[#1e3a5f] text-white border-[#1e3a5f]',
    filters: { formType: 'mogi', period: 'all', grade: 'all', linkedStatus: 'all', chargedStatus: 'not_charged' },
  },
];

function getSortIcon(currentKey: SortKey, key: SortKey, order: SortOrder) {
  if (currentKey !== key) return <ChevronsUpDown className="h-4 w-4 inline-block ml-1 opacity-50" />;
  return order === 'asc' ? (
    <ChevronUp className="h-4 w-4 inline-block ml-1" />
  ) : (
    <ChevronDown className="h-4 w-4 inline-block ml-1" />
  );
}

/** 一覧で「未処理」バッジが付くか（詳細のチェックと同一条件） */
function isUnprocessed(response: FormResponseWithStudent): boolean {
  const sc = (response.status_checks as Record<string, boolean> | undefined) ?? {};
  const linked = !!response.linked_student_id;
  switch (response.form_type) {
    case 'moshi':
      return !linked && !sc.charged && !sc.order;
    case 'zoukoma':
    case 'youbi':
    case 'shukaisu':
      return !linked && !sc.charged && !sc.seated;
    case 'mogi':
      return !linked && !sc.charged;
    case 'soudan':
      return !linked && !sc.handled;
    default:
      return !linked;
  }
}

/** 一覧の処理状態（詳細ページのチェックと同一の status_checks を表示） */
function ResponseStatusBadges({ response }: { response: FormResponseWithStudent }) {
  const sc = (response.status_checks as Record<string, boolean> | undefined) ?? {};
  const linked = !!response.linked_student_id;

  const badge = (label: string, className: string) => (
    <span key={label} className={`px-2 py-1 rounded text-xs font-medium ${className}`}>
      {label}
    </span>
  );

  switch (response.form_type) {
    case 'moshi':
      return (
        <span className="inline-flex flex-wrap items-center gap-1">
          {linked && badge('紐付け済み', 'bg-green-100 text-green-800')}
          {sc.charged && badge('計上済み', 'bg-blue-100 text-blue-800')}
          {sc.order && badge('発注済み', 'bg-purple-100 text-purple-800')}
          {!linked && !sc.charged && !sc.order && badge('未処理', 'bg-yellow-100 text-yellow-800')}
        </span>
      );
    case 'zoukoma':
    case 'youbi':
    case 'shukaisu':
      return (
        <span className="inline-flex flex-wrap items-center gap-1">
          {linked && badge('紐付け済み', 'bg-green-100 text-green-800')}
          {sc.charged && badge('計上済み', 'bg-blue-100 text-blue-800')}
          {sc.seated && badge('座席済み', 'bg-indigo-100 text-indigo-800')}
          {!linked && !sc.charged && !sc.seated && badge('未処理', 'bg-yellow-100 text-yellow-800')}
        </span>
      );
    case 'mogi':
      return (
        <span className="inline-flex flex-wrap items-center gap-1">
          {linked && badge('紐付け済み', 'bg-green-100 text-green-800')}
          {sc.charged && badge('計上済み', 'bg-blue-100 text-blue-800')}
          {!linked && !sc.charged && badge('未処理', 'bg-yellow-100 text-yellow-800')}
        </span>
      );
    case 'soudan':
      return (
        <span className="inline-flex flex-wrap items-center gap-1">
          {linked && badge('紐付け済み', 'bg-green-100 text-green-800')}
          {sc.handled && badge('対応済み', 'bg-blue-100 text-blue-800')}
          {!linked && !sc.handled && badge('未処理', 'bg-yellow-100 text-yellow-800')}
        </span>
      );
    default:
      // kyozai など、詳細で status_checks を使わないフォーム
      return (
        <span className="inline-flex flex-wrap items-center gap-1">
          {linked ? badge('紐付け済み', 'bg-green-100 text-green-800') : badge('未処理', 'bg-yellow-100 text-yellow-800')}
        </span>
      );
  }
}

interface SummaryCardProps {
  formType: string;
  formTypeLabel: string;
  periodKey: string;
  periodLabel: string;
  totalCount: number;
  unprocessedCount: number;
}

function SummaryCard({
  formType,
  formTypeLabel,
  periodKey,
  periodLabel,
  totalCount,
  unprocessedCount,
}: SummaryCardProps) {
  const path = FORM_TYPE_TO_PATH[formType] ?? formType;
  const href = `/forms/responses/${path}/${periodKey}`;

  return (
    <Link href={href}>
      <div className="p-4 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 cursor-pointer transition-colors">
        <h3 className="font-semibold text-gray-900">
          {formTypeLabel} ({periodLabel})
        </h3>
        <p className="text-sm text-gray-600">
          {totalCount}件（未処理: {unprocessedCount}件）
        </p>
      </div>
    </Link>
  );
}

export default function ResponsesPage() {
  // 権限チェック
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessApplications
  );
  const { getSelectedSchoolIds, selectedSchoolId } = useAuth();
  const { schools: masterSchools } = useMasterData();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [responses, setResponses] = useState<FormResponseWithStudent[]>([]);
  const [formPeriods, setFormPeriods] = useState<FormPeriod[]>([]);
  const [schoolsMap, setSchoolsMap] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // フィルター（URLパラメータから初期値を復元）
  const [filterFormType, setFilterFormType] = useState<FormType | 'all'>(
    (searchParams.get('type') as FormType) || 'all'
  );
  const [filterPeriod, setFilterPeriod] = useState<string>(
    searchParams.get('period') || 'all'
  );
  const [filterGrade, setFilterGrade] = useState<number | 'all'>(() => {
    const g = searchParams.get('grade');
    return g ? Number(g) : 'all';
  });
  const [filterLinkedStatus, setFilterLinkedStatus] = useState<
    'all' | 'linked' | 'unlinked'
  >((searchParams.get('linked') as 'all' | 'linked' | 'unlinked') || 'all');
  const [filterChargedStatus, setFilterChargedStatus] = useState<
    'all' | 'charged' | 'not_charged'
  >((searchParams.get('charged') as 'all' | 'charged' | 'not_charged') || 'all');
  const [filterDateFrom, setFilterDateFrom] = useState(searchParams.get('dateFrom') || '');
  const [filterDateTo, setFilterDateTo] = useState(searchParams.get('dateTo') || '');
  const [searchName, setSearchName] = useState(searchParams.get('search') || '');
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '');
  const [viewMode, setViewMode] = useState<'list' | 'grouped'>(
    (searchParams.get('view') as 'list' | 'grouped') || 'grouped'
  );

  // ソート
  const [sortKey, setSortKey] = useState<SortKey>(
    (searchParams.get('sort') as SortKey) || 'created_at'
  );
  const [sortOrder, setSortOrder] = useState<SortOrder>(
    (searchParams.get('order') as SortOrder) || 'desc'
  );

  // フィルター変更時にURLパラメータを同期
  useEffect(() => {
    const params = new URLSearchParams();
    if (filterFormType !== 'all') params.set('type', filterFormType);
    if (filterPeriod !== 'all') params.set('period', filterPeriod);
    if (filterGrade !== 'all') params.set('grade', String(filterGrade));
    if (filterLinkedStatus !== 'all') params.set('linked', filterLinkedStatus);
    if (filterChargedStatus !== 'all') params.set('charged', filterChargedStatus);
    if (filterDateFrom) params.set('dateFrom', filterDateFrom);
    if (filterDateTo) params.set('dateTo', filterDateTo);
    if (searchName) params.set('search', searchName);
    if (viewMode !== 'grouped') params.set('view', viewMode);
    if (sortKey !== 'created_at') params.set('sort', sortKey);
    if (sortOrder !== 'desc') params.set('order', sortOrder);
    const qs = params.toString();
    const newUrl = qs ? `?${qs}` : '/responses';
    router.replace(newUrl, { scroll: false });
  }, [filterFormType, filterPeriod, filterGrade, filterLinkedStatus, filterChargedStatus, filterDateFrom, filterDateTo, searchName, viewMode, sortKey, sortOrder, router]);

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortOrder('asc');
      return key;
    });
  }, []);

  // クイックフィルター適用
  const applyQuickFilter = useCallback((qf: QuickFilter) => {
    setFilterFormType(qf.filters.formType);
    setFilterPeriod(qf.filters.period);
    setFilterGrade(qf.filters.grade);
    setFilterLinkedStatus(qf.filters.linkedStatus);
    setFilterChargedStatus(qf.filters.chargedStatus);
    setSearchInput('');
    setSearchName('');
  }, []);

  // 現在のフィルター状態がクイックフィルターと一致するか
  const isQuickFilterActive = useCallback((qf: QuickFilter) => {
    return (
      filterFormType === qf.filters.formType &&
      filterPeriod === qf.filters.period &&
      filterGrade === qf.filters.grade &&
      filterLinkedStatus === qf.filters.linkedStatus &&
      filterChargedStatus === qf.filters.chargedStatus &&
      !searchName
    );
  }, [filterFormType, filterPeriod, filterGrade, filterLinkedStatus, filterChargedStatus, searchName]);

  // ソート済み一覧
  const sortedResponses = useMemo(() => {
    const list = [...responses];
    list.sort((a, b) => {
      let aVal: string | number | boolean;
      let bVal: string | number | boolean;
      switch (sortKey) {
        case 'created_at':
          aVal = new Date(a.created_at).getTime();
          bVal = new Date(b.created_at).getTime();
          return sortOrder === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
        case 'form_type':
          aVal = FORM_TYPE_LABELS[a.form_type] ?? a.form_type;
          bVal = FORM_TYPE_LABELS[b.form_type] ?? b.form_type;
          break;
        case 'form_period':
          aVal = a.form_period ?? '';
          bVal = b.form_period ?? '';
          break;
        case 'school':
          aVal = schoolsMap[a.school_id] ?? '';
          bVal = schoolsMap[b.school_id] ?? '';
          break;
        case 'student_name':
          aVal = a.linked_student
            ? `${a.linked_student.last_name} ${a.linked_student.first_name}`
            : a.student_name ?? '';
          bVal = b.linked_student
            ? `${b.linked_student.last_name} ${b.linked_student.first_name}`
            : b.student_name ?? '';
          break;
        case 'grade':
          aVal = a.grade ?? 0;
          bVal = b.grade ?? 0;
          return sortOrder === 'asc'
            ? (aVal as number) - (bVal as number)
            : (bVal as number) - (aVal as number);
        case 'status':
          aVal = a.linked_student_id ? 1 : 0;
          bVal = b.linked_student_id ? 1 : 0;
          return sortOrder === 'asc'
            ? (aVal as number) - (bVal as number)
            : (bVal as number) - (aVal as number);
        default:
          return 0;
      }
      const aStr = String(aVal);
      const bStr = String(bVal);
      const cmp = aStr.localeCompare(bStr, 'ja');
      return sortOrder === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [responses, sortKey, sortOrder, schoolsMap]);

  // 生徒ごとにグルーピング
  interface StudentGroup {
    studentKey: string;
    studentName: string;
    grade: number;
    schoolName: string;
    schoolId: string;
    responses: FormResponseWithStudent[];
    hasUncharged: boolean;
    hasUnprocessed: boolean;
  }

  const groupedByStudent = useMemo((): StudentGroup[] => {
    const map = new Map<string, StudentGroup>();
    for (const r of sortedResponses) {
      // 紐付け済みならlinked_student_idでグルーピング、なければstudent_name+school_idで
      const name = r.linked_student
        ? `${r.linked_student.last_name} ${r.linked_student.first_name}`
        : r.student_name ?? '不明';
      const key = r.linked_student_id
        ? `linked_${r.linked_student_id}`
        : `name_${name}_${r.school_id}`;

      if (!map.has(key)) {
        map.set(key, {
          studentKey: key,
          studentName: name,
          grade: r.grade,
          schoolName: schoolsMap[r.school_id] ?? '-',
          schoolId: r.school_id,
          responses: [],
          hasUncharged: false,
          hasUnprocessed: false,
        });
      }
      const group = map.get(key)!;
      group.responses.push(r);
      const sc = (r.status_checks as Record<string, boolean> | undefined) ?? {};
      if (!sc.charged) group.hasUncharged = true;
      if (isUnprocessed(r)) group.hasUnprocessed = true;
    }
    return Array.from(map.values());
  }, [sortedResponses, schoolsMap]);

  // データ取得
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) {
        setErrorMessage('教室が選択されていません');
        setIsLoading(false);
        return;
      }

      const filters: Parameters<typeof getFormResponses>[1] = {};
      if (filterFormType !== 'all') {
        filters.formType = filterFormType;
      }
      if (filterPeriod !== 'all') {
        filters.formPeriod = filterPeriod;
      }
      if (filterGrade !== 'all') {
        filters.grade = filterGrade;
      }
      if (filterLinkedStatus !== 'all') {
        filters.linkedStatus = filterLinkedStatus;
      }
      if (filterChargedStatus !== 'all') {
        filters.chargedStatus = filterChargedStatus;
      }
      if (searchName.trim()) {
        filters.search = searchName.trim();
      }
      if (filterDateFrom) {
        filters.dateFrom = filterDateFrom;
      }
      if (filterDateTo) {
        filters.dateTo = filterDateTo;
      }

      // 複数教室の期間を取得してperiod_keyで重複排除
      const fetchPeriods = async () => {
        if (filterFormType === 'all') return [];
        const allPeriods = await Promise.all(
          schoolIds.map((sid) => getFormPeriods(sid, filterFormType))
        );
        const seen = new Set<string>();
        return allPeriods.flat().filter((p) => {
          if (seen.has(p.period_key)) return false;
          seen.add(p.period_key);
          return true;
        });
      };

      const [responsesData, periodsData] = await Promise.all([
        getFormResponses(schoolIds, filters),
        fetchPeriods(),
      ]);

      setResponses(responsesData);
      setFormPeriods(periodsData);

      // 教室名マップを取得（一覧で教室名表示用）
      const map: Record<string, string> = {};
      masterSchools.forEach((s) => { map[s.id] = s.name; });
      setSchoolsMap(map);
    } catch (error) {
      console.error('Error fetching data:', error);
      setErrorMessage(
        getUserErrorMessage(error, 'データの取得に失敗しました')
      );
    } finally {
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds, filterFormType, filterPeriod, filterGrade, filterLinkedStatus, filterChargedStatus, filterDateFrom, filterDateTo, searchName, masterSchools]);

  useEffect(() => {
    if (selectedSchoolId !== null) {
      fetchData();
    }
  }, [fetchData, selectedSchoolId]);

  const formatDateTime = (date: string) => {
    const d = new Date(date);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  // サマリー計算（未処理＝一覧で「未処理」バッジが付く件数）
  const summary = (() => {
    const byFormType: Record<string, { total: number; unprocessed: number }> = {};
    responses.forEach((response) => {
      const key = `${response.form_type}_${response.form_period}`;
      if (!byFormType[key]) {
        byFormType[key] = { total: 0, unprocessed: 0 };
      }
      byFormType[key].total++;
      if (isUnprocessed(response)) {
        byFormType[key].unprocessed++;
      }
    });
    return byFormType;
  })();

  // 権限チェック中
  if (permissionLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-[#4b5563]">読み込み中...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  // 権限なし
  if (!hasPermission) {
    return (
      <AdminLayout>
        <AccessDenied />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="回答管理">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {errorMessage && (
          <div className="mb-4 p-4 bg-[#ef4444]/20 border border-[#ef4444] rounded-lg">
            <p className="text-sm text-[#ef4444]">{errorMessage}</p>
          </div>
        )}

        {/* クイックフィルター */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-gray-400 mr-1" />
          {QUICK_FILTERS.map((qf) => {
            const active = isQuickFilterActive(qf);
            return (
              <button
                key={qf.label}
                type="button"
                onClick={() => {
                  if (active) {
                    setFilterFormType('all');
                    setFilterPeriod('all');
                    setFilterGrade('all');
                    setFilterLinkedStatus('all');
                    setFilterChargedStatus('all');
                  } else {
                    applyQuickFilter(qf);
                  }
                }}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  active ? qf.activeColor : qf.color
                }`}
              >
                {qf.label}
              </button>
            );
          })}
        </div>

        {/* 名前検索 */}
        <div className="mb-4 bg-white rounded-xl border border-[#e5e7eb] p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSearchName(searchInput.trim());
            }}
            className="flex items-center gap-3"
          >
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="生徒名で検索（例：田中）"
                className="w-full pl-10 pr-10 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#1f2937] focus:outline-none focus:ring-2 focus:ring-[#3b82f6] placeholder:text-gray-400"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput('');
                    setSearchName('');
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-[#1e3a5f] text-white rounded-lg text-sm hover:bg-[#2c4f7c] transition-colors"
            >
              検索
            </button>
          </form>
          {searchName && (
            <p className="mt-2 text-sm text-gray-500">
              「{searchName}」の検索結果: {responses.length}件
            </p>
          )}
        </div>

        {/* フィルター */}
        <div className="mb-6 bg-white rounded-xl border border-[#e5e7eb] p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#1f2937] mb-2">
                フォーム種別
              </label>
              <select
                value={filterFormType}
                onChange={(e) => {
                  setFilterFormType(e.target.value as FormType | 'all');
                  setFilterPeriod('all');
                }}
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
              >
                <option value="all">すべて</option>
                {Object.entries(FORM_TYPE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#1f2937] mb-2">
                期間
              </label>
              <select
                value={filterPeriod}
                onChange={(e) => setFilterPeriod(e.target.value)}
                disabled={filterFormType === 'all' || formPeriods.length === 0}
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:outline-none focus:ring-2 focus:ring-[#3b82f6] disabled:bg-[#f3f4f6] disabled:cursor-not-allowed"
              >
                <option value="all">{filterFormType === 'all' ? 'フォーム種別を選択してください' : 'すべて'}</option>
                {formPeriods.map((period) => (
                  <option key={period.period_key} value={period.period_key}>
                    {period.period_key} {period.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#1f2937] mb-2">
                学年
              </label>
              <select
                value={filterGrade}
                onChange={(e) =>
                  setFilterGrade(
                    e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10)
                  )
                }
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
              >
                <option value="all">すべて</option>
                {Object.entries(GRADE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#1f2937] mb-2">
                紐付け状態
              </label>
              <select
                value={filterLinkedStatus}
                onChange={(e) =>
                  setFilterLinkedStatus(e.target.value as 'all' | 'linked' | 'unlinked')
                }
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
              >
                <option value="all">すべて</option>
                <option value="linked">紐付け済み</option>
                <option value="unlinked">未紐付け</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#1f2937] mb-2">
                計上状態
              </label>
              <select
                value={filterChargedStatus}
                onChange={(e) =>
                  setFilterChargedStatus(e.target.value as 'all' | 'charged' | 'not_charged')
                }
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
              >
                <option value="all">すべて</option>
                <option value="charged">計上済み</option>
                <option value="not_charged">未計上</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#1f2937] mb-2">
                申込日
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="date"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                  className="w-full px-2 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                />
                <span className="text-xs text-gray-400 shrink-0">〜</span>
                <input
                  type="date"
                  value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                  className="w-full px-2 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                />
              </div>
            </div>
          </div>
          {(filterFormType !== 'all' || filterPeriod !== 'all' || filterGrade !== 'all' || filterLinkedStatus !== 'all' || filterChargedStatus !== 'all' || filterDateFrom || filterDateTo || searchName) && (
            <div className="mt-3 flex items-center justify-between">
              <p className="text-sm text-gray-500">
                {responses.length}件表示
              </p>
              <button
                type="button"
                onClick={() => {
                  setFilterFormType('all');
                  setFilterPeriod('all');
                  setFilterGrade('all');
                  setFilterLinkedStatus('all');
                  setFilterChargedStatus('all');
                  setFilterDateFrom('');
                  setFilterDateTo('');
                  setSearchInput('');
                  setSearchName('');
                }}
                className="text-sm text-blue-600 hover:text-blue-800 cursor-pointer"
              >
                フィルターをリセット
              </button>
            </div>
          )}
        </div>

        {/* サマリーセクション */}
        {Object.keys(summary).length > 0 && (
          <div className="mb-6 bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">サマリー</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(summary).map(([key, stats]) => {
                const [formType, periodKey] = key.split('_');
                const period = formPeriods.find((p) => p.period_key === periodKey);
                const formTypeLabel = FORM_TYPE_LABELS[formType as FormType] ?? formType;
                const periodLabel = period ? `${periodKey} ${period.title}` : periodKey;
                return (
                  <SummaryCard
                    key={key}
                    formType={formType}
                    formTypeLabel={formTypeLabel}
                    periodKey={periodKey}
                    periodLabel={periodLabel}
                    totalCount={stats.total}
                    unprocessedCount={stats.unprocessed}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* 回答一覧 */}
        <div className="bg-white rounded-xl border border-[#e5e7eb] p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-[#1f2937]">回答一覧</h2>
            <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setViewMode('grouped')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                  viewMode === 'grouped'
                    ? 'bg-[#1e3a5f] text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Users className="h-4 w-4" />
                生徒別
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                  viewMode === 'list'
                    ? 'bg-[#1e3a5f] text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                <List className="h-4 w-4" />
                一覧
              </button>
            </div>
          </div>
          {isLoading ? (
            <div className="text-center py-8 text-[#4b5563]">読み込み中...</div>
          ) : responses.length === 0 ? (
            <div className="text-center py-8 text-[#4b5563]">回答がありません。フィルターを変更するか、フォームの公開後に回答が届くとここに表示されます。</div>
          ) : viewMode === 'grouped' ? (
            /* 生徒別ビュー */
            <div className="space-y-3">
              <p className="text-sm text-gray-500 mb-2">{groupedByStudent.length}名の生徒 / {responses.length}件の回答</p>
              {groupedByStudent.map((group) => (
                <div
                  key={group.studentKey}
                  className={`border rounded-lg overflow-hidden ${
                    group.hasUncharged ? 'border-red-200' : 'border-gray-200'
                  }`}
                >
                  {/* 生徒ヘッダー */}
                  <div className={`px-4 py-3 flex items-center justify-between ${
                    group.hasUncharged ? 'bg-red-50' : 'bg-gray-50'
                  }`}>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-[#1f2937]">{group.studentName}</span>
                      <span className="text-xs text-gray-500 bg-white px-2 py-0.5 rounded border border-gray-200">
                        {GRADE_LABELS[group.grade] || group.grade}
                      </span>
                      <span className="text-xs text-gray-500">
                        {group.schoolName}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-500">{group.responses.length}件</span>
                      {group.hasUncharged && (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">未計上あり</span>
                      )}
                      {group.hasUnprocessed && (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">未処理あり</span>
                      )}
                    </div>
                  </div>
                  {/* 回答リスト */}
                  <table className="w-full text-sm">
                    <tbody>
                      {group.responses.map((response) => (
                        <tr key={response.id} className="border-t border-gray-100 table-row-hover">
                          <td className="px-4 py-2 w-24 text-gray-500">
                            {formatDateTime(response.created_at)}
                          </td>
                          <td className="px-4 py-2 w-32 font-medium">
                            {FORM_TYPE_LABELS[response.form_type]}
                          </td>
                          <td className="px-4 py-2 w-28 text-gray-500">
                            {response.form_period}
                          </td>
                          <td className="px-4 py-2">
                            <ResponseStatusBadges response={response} />
                          </td>
                          <td className="px-4 py-2 w-16 text-right">
                            <Link
                              href={`/forms/responses/${FORM_TYPE_TO_PATH[response.form_type] ?? response.form_type}/${response.form_period}?schoolId=${response.school_id}`}
                              className="text-sm text-blue-600 hover:text-blue-800"
                            >
                              詳細
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ) : (
            /* 一覧ビュー */
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-[#e5e7eb] text-sm">
                <thead>
                  <tr className="bg-[#f3f4f6]">
                    <th className="border border-[#e5e7eb] px-4 py-3 text-left">
                      <button
                        type="button"
                        onClick={() => handleSort('created_at')}
                        className="font-medium text-[#1f2937] hover:text-[#3b82f6] flex items-center"
                      >
                        日時
                        {getSortIcon(sortKey, 'created_at', sortOrder)}
                      </button>
                    </th>
                    <th className="border border-[#e5e7eb] px-4 py-3 text-left">
                      <button
                        type="button"
                        onClick={() => handleSort('form_type')}
                        className="font-medium text-[#1f2937] hover:text-[#3b82f6] flex items-center"
                      >
                        種別
                        {getSortIcon(sortKey, 'form_type', sortOrder)}
                      </button>
                    </th>
                    <th className="border border-[#e5e7eb] px-4 py-3 text-left">
                      <button
                        type="button"
                        onClick={() => handleSort('form_period')}
                        className="font-medium text-[#1f2937] hover:text-[#3b82f6] flex items-center"
                      >
                        期間
                        {getSortIcon(sortKey, 'form_period', sortOrder)}
                      </button>
                    </th>
                    <th className="border border-[#e5e7eb] px-4 py-3 text-left">
                      <button
                        type="button"
                        onClick={() => handleSort('school')}
                        className="font-medium text-[#1f2937] hover:text-[#3b82f6] flex items-center"
                      >
                        教室
                        {getSortIcon(sortKey, 'school', sortOrder)}
                      </button>
                    </th>
                    <th className="border border-[#e5e7eb] px-4 py-3 text-left">
                      <button
                        type="button"
                        onClick={() => handleSort('student_name')}
                        className="font-medium text-[#1f2937] hover:text-[#3b82f6] flex items-center"
                      >
                        生徒名
                        {getSortIcon(sortKey, 'student_name', sortOrder)}
                      </button>
                    </th>
                    <th className="border border-[#e5e7eb] px-4 py-3 text-left">
                      <button
                        type="button"
                        onClick={() => handleSort('grade')}
                        className="font-medium text-[#1f2937] hover:text-[#3b82f6] flex items-center"
                      >
                        学年
                        {getSortIcon(sortKey, 'grade', sortOrder)}
                      </button>
                    </th>
                    <th className="border border-[#e5e7eb] px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => handleSort('status')}
                        className="font-medium text-[#1f2937] hover:text-[#3b82f6] flex items-center mx-auto"
                      >
                        処理状態
                        {getSortIcon(sortKey, 'status', sortOrder)}
                      </button>
                    </th>
                    <th className="border border-[#e5e7eb] px-4 py-3 text-left">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedResponses.map((response) => (
                    <tr key={response.id} className="table-row-hover">
                      <td className="border border-[#e5e7eb] px-4 py-3">
                        {formatDateTime(response.created_at)}
                      </td>
                      <td className="border border-[#e5e7eb] px-4 py-3">
                        {FORM_TYPE_LABELS[response.form_type]}
                      </td>
                      <td className="border border-[#e5e7eb] px-4 py-3">
                        {response.form_period}
                      </td>
                      <td className="border border-[#e5e7eb] px-4 py-3">
                        {schoolsMap[response.school_id] ?? '-'}
                      </td>
                      <td className="border border-[#e5e7eb] px-4 py-3">
                        {response.linked_student
                          ? `${response.linked_student.last_name} ${response.linked_student.first_name}`
                          : response.student_name}
                      </td>
                      <td className="border border-[#e5e7eb] px-4 py-3">
                        {GRADE_LABELS[response.grade] || response.grade}
                      </td>
                      <td className="border border-[#e5e7eb] px-4 py-3 text-center">
                        <ResponseStatusBadges response={response} />
                      </td>
                      <td className="border border-[#e5e7eb] px-4 py-3">
                        <div className="flex gap-2">
                          <Link
                            href={`/forms/responses/${FORM_TYPE_TO_PATH[response.form_type] ?? response.form_type}/${response.form_period}?schoolId=${response.school_id}`}
                            className="text-sm text-[#4b5563] hover:text-[#1f2937]"
                          >
                            詳細
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
