'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { useAuth } from '@/contexts/AuthContext';
import {
  ChevronDown,
  ChevronUp,
  Search,
  X,
  Users,
  BarChart3,
  CalendarDays,
  FileText,
  Bell,
  ClipboardCheck,
  Settings,
  GraduationCap,
  BookOpen,
  Briefcase,
  UserCog,
  Globe,
  Shield,
  HelpCircle,
  ExternalLink,
  MapPin,
  Lightbulb,
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  type LucideIcon,
} from 'lucide-react';
import type { UserRole } from '@/types/database';
import {
  FAQ_DATA,
  GLOSSARY_DATA,
  type FaqItem,
  type FaqCategoryData,
  type RoleTag,
} from '@/lib/help/faqData';

/**
 * カテゴリ id → アイコン。
 * FAQ本文は src/lib/help/faqData.ts に移したが、アイコンはサーバーから import できないので
 * 表示側のここに残す。カテゴリを増やしたら両方に足すこと。
 */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  students: Users,
  scores: BarChart3,
  schedule: CalendarDays,
  forms: FileText,
  alerts: Bell,
  applications: ClipboardCheck,
  courses: GraduationCap,
  teachers: UserCog,
  business: Briefcase,
  progress: BookOpen,
  portal: Globe,
  settings: Settings,
  users: Shield,
  updates: HelpCircle,
  inquiries: Shield,
};

const ROLE_LABELS: Record<RoleTag, string> = {
  all: 'すべて',
  admin: '管理者',
  manager: '室長',
  teacher: '講師',
};

function mapUserRoleToTag(role: UserRole | undefined): RoleTag {
  if (!role) return 'all';
  if (role === 'admin' || role === 'owner') return 'admin';
  if (role === 'manager') return 'manager';
  if (role === 'teacher') return 'teacher';
  return 'all';
}

function itemMatchesRole(item: FaqItem, roleFilter: RoleTag): boolean {
  if (roleFilter === 'all') return true;
  if (!item.roles) return true;
  return item.roles.includes(roleFilter);
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const terms = query.trim().split(/\s+/).filter(Boolean);
  const pattern = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const regex = new RegExp(`(${pattern})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="bg-yellow-200 dark:bg-yellow-700/60 text-inherit rounded-sm px-0.5">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

/** 「」で囲まれたUI要素名をバッジ風に強調するレンダラー */
function renderUiText(text: string, searchQuery: string): React.ReactNode {
  // 先にUI要素バッジを処理し、その後に検索ハイライトを適用
  const uiParts = text.split(/(「[^」]+」)/g);
  return uiParts.map((part, i) => {
    if (part.startsWith('「') && part.endsWith('」')) {
      const inner = part.slice(1, -1);
      return (
        <span
          key={i}
          className="inline-flex items-center px-1.5 py-0.5 mx-0.5 text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700 rounded"
        >
          {highlightText(inner, searchQuery)}
        </span>
      );
    }
    return <span key={i}>{highlightText(part, searchQuery)}</span>;
  });
}

function FaqItemDetail({
  item,
  searchQuery,
  onNavigateToQuestion,
}: {
  item: FaqItem;
  searchQuery: string;
  onNavigateToQuestion?: (question: string) => void;
}) {
  return (
    <div className="px-4 pb-4 space-y-3">
      {/* 概要 */}
      <p className="text-sm text-text-body leading-relaxed">
        {renderUiText(item.answer, searchQuery)}
      </p>

      {/* ナビゲーションパス */}
      {item.path && (
        <div className="flex items-start gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700/40 rounded-lg border border-gray-200 dark:border-gray-600">
          <MapPin className="w-4 h-4 text-[var(--primary)] shrink-0 mt-0.5" />
          <div className="text-xs text-text-body">
            <span className="font-medium text-[var(--headline)]">アクセス方法：</span>
            <span className="ml-1">{renderUiText(item.path, searchQuery)}</span>
          </div>
        </div>
      )}

      {/* 操作手順 */}
      {item.steps && item.steps.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-[var(--headline)] flex items-center gap-1.5">
            <ArrowRight className="w-3.5 h-3.5 text-[var(--primary)]" />
            操作手順
          </p>
          <ol className="space-y-1 ml-1">
            {item.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-text-body leading-relaxed">
                <span className="inline-flex items-center justify-center w-5 h-5 mt-0.5 text-[10px] font-bold bg-[var(--primary)] text-white rounded-full shrink-0">
                  {i + 1}
                </span>
                <span className="flex-1">{renderUiText(step, searchQuery)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* 注意点・Tips */}
      {item.tips && item.tips.length > 0 && (
        <div className="px-3 py-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-700/50">
          <p className="text-xs font-medium text-amber-800 dark:text-amber-300 flex items-center gap-1.5 mb-1.5">
            <Lightbulb className="w-3.5 h-3.5" />
            ポイント・注意
          </p>
          <ul className="space-y-1">
            {item.tips.map((tip, i) => (
              <li
                key={i}
                className="text-xs text-amber-900 dark:text-amber-200 flex items-start gap-1.5"
              >
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 opacity-60" />
                <span>{renderUiText(tip, searchQuery)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* リンク & 関連項目 */}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        {item.link && (
          <Link
            href={item.link.href}
            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)] hover:underline"
          >
            {item.link.label}
            <ExternalLink className="w-3 h-3" />
          </Link>
        )}
        {item.related && item.related.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-gray-400">関連：</span>
            {item.related.map((rel, i) => (
              <button
                key={i}
                onClick={() => onNavigateToQuestion?.(rel)}
                className="text-[11px] text-[var(--primary)] hover:underline cursor-pointer"
              >
                {rel}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FaqAccordion({
  category,
  searchQuery,
  defaultOpen,
  onNavigateToQuestion,
}: {
  category: FaqCategoryData;
  searchQuery: string;
  defaultOpen: boolean;
  onNavigateToQuestion?: (question: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [openItems, setOpenItems] = useState<Set<number>>(
    () => new Set(defaultOpen ? category.items.map((_, i) => i) : [])
  );

  useEffect(() => {
    if (defaultOpen) {
      setIsOpen(true);
      setOpenItems(new Set(category.items.map((_, i) => i)));
    }
  }, [defaultOpen, category.items]);

  const toggleItem = (index: number) => {
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const Icon = CATEGORY_ICONS[category.id] ?? HelpCircle;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 bg-[var(--surface)] border-b border-gray-200 dark:border-gray-700 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
      >
        <Icon className="w-5 h-5 text-[var(--primary)] shrink-0" />
        <div className="flex-1 text-left">
          <h2 className="text-base font-semibold text-[var(--headline)]">{category.title}</h2>
          <p className="text-xs text-[var(--paragraph)] mt-0.5">{category.description}</p>
        </div>
        <span className="text-xs text-gray-400 mr-2">{category.items.length}件</span>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
        )}
      </button>
      {isOpen && (
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          {category.items.map((item, index) => (
            <div key={index}>
              <button
                onClick={() => toggleItem(index)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors duration-150"
              >
                <span className="text-sm font-medium text-text-heading pr-2">
                  {highlightText(item.question, searchQuery)}
                </span>
                {openItems.has(index) ? (
                  <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                )}
              </button>
              {openItems.has(index) && (
                <FaqItemDetail
                  item={item}
                  searchQuery={searchQuery}
                  onNavigateToQuestion={onNavigateToQuestion}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function HelpPage() {
  const { profile } = useAuth();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<RoleTag>('all');
  const [showMyRoleOnly, setShowMyRoleOnly] = useState(false);
  const [showGlossary, setShowGlossary] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const myRole = mapUserRoleToTag(profile?.role as UserRole | undefined);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        setSearchQuery('');
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const matchesSearch = useCallback(
    (item: FaqItem): boolean => {
      if (!searchQuery.trim()) return true;
      const terms = searchQuery.trim().toLowerCase().split(/\s+/);
      const target =
        `${item.question} ${item.answer} ${(item.keywords || []).join(' ')}`.toLowerCase();
      return terms.every((term) => target.includes(term));
    },
    [searchQuery]
  );

  const activeRoleFilter = showMyRoleOnly ? myRole : roleFilter;

  const filteredData = useMemo(() => {
    return FAQ_DATA.map((category) => ({
      ...category,
      items: category.items
        .filter(matchesSearch)
        .filter((item) => itemMatchesRole(item, activeRoleFilter)),
    }))
      .filter((category) => category.items.length > 0)
      .filter((category) => !selectedCategory || category.id === selectedCategory);
  }, [searchQuery, selectedCategory, activeRoleFilter, matchesSearch]);

  const totalResults = filteredData.reduce((sum, cat) => sum + cat.items.length, 0);
  const totalAll = FAQ_DATA.reduce((sum, cat) => sum + cat.items.length, 0);
  const isSearching = searchQuery.trim().length > 0;

  const filteredGlossary = useMemo(() => {
    if (!searchQuery.trim()) return GLOSSARY_DATA;
    const terms = searchQuery.trim().toLowerCase().split(/\s+/);
    return GLOSSARY_DATA.filter((item) => {
      const target = `${item.term} ${item.reading || ''} ${item.definition}`.toLowerCase();
      return terms.some((t) => target.includes(t));
    });
  }, [searchQuery]);

  const handleNavigateToQuestion = useCallback((question: string) => {
    setSearchQuery(question);
    setSelectedCategory(null);
    setRoleFilter('all');
    setShowMyRoleOnly(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <AdminLayout headerTitle="ヘルプ">
      <div className="space-y-6">
        <div>
          <Link
            href="/students"
            className="text-sm text-[var(--paragraph)] hover:text-info mb-2 inline-block transition-colors duration-150"
          >
            ← 生徒一覧に戻る
          </Link>
          <h1 className="text-2xl font-bold text-[var(--headline)]">ヘルプ</h1>
          <p className="text-sm text-[var(--paragraph)] mt-1">
            操作方法やよくある質問をカテゴリ別にまとめています。全{totalAll}件
          </p>
        </div>

        {/* 検索 */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="キーワードで検索... (Ctrl+K)"
            className="w-full pl-10 pr-10 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-[var(--headline)] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent transition-shadow"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                searchInputRef.current?.focus();
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* ロールフィルタ */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-[var(--paragraph)] font-medium">表示対象：</span>
          {myRole !== 'all' && (
            <button
              onClick={() => {
                setShowMyRoleOnly(!showMyRoleOnly);
                if (!showMyRoleOnly) setRoleFilter('all');
              }}
              className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                showMyRoleOnly
                  ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                  : 'bg-white dark:bg-gray-800 text-[var(--paragraph)] border-gray-300 dark:border-gray-600 hover:border-[var(--primary)] hover:text-[var(--primary)]'
              }`}
            >
              自分のロール（{ROLE_LABELS[myRole]}）
            </button>
          )}
          {(['all', 'admin', 'manager', 'teacher'] as RoleTag[]).map((role) => (
            <button
              key={role}
              onClick={() => {
                setRoleFilter(role);
                setShowMyRoleOnly(false);
              }}
              className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                !showMyRoleOnly && roleFilter === role
                  ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                  : 'bg-white dark:bg-gray-800 text-[var(--paragraph)] border-gray-300 dark:border-gray-600 hover:border-[var(--primary)] hover:text-[var(--primary)]'
              }`}
            >
              {ROLE_LABELS[role]}
            </button>
          ))}
        </div>

        {/* カテゴリフィルタ */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
              !selectedCategory
                ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                : 'bg-white dark:bg-gray-800 text-[var(--paragraph)] border-gray-300 dark:border-gray-600 hover:border-[var(--primary)] hover:text-[var(--primary)]'
            }`}
          >
            すべて
          </button>
          {FAQ_DATA.map((cat) => {
            const Icon = CATEGORY_ICONS[cat.id] ?? HelpCircle;
            const count = cat.items
              .filter(matchesSearch)
              .filter((item) => itemMatchesRole(item, activeRoleFilter)).length;
            if (count === 0) return null;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
                className={`px-3 py-1.5 text-xs rounded-full border transition-colors flex items-center gap-1.5 ${
                  selectedCategory === cat.id
                    ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                    : 'bg-white dark:bg-gray-800 text-[var(--paragraph)] border-gray-300 dark:border-gray-600 hover:border-[var(--primary)] hover:text-[var(--primary)]'
                }`}
              >
                <Icon className="w-3 h-3" />
                {cat.title}
                <span className="opacity-70">({count})</span>
              </button>
            );
          })}
        </div>

        {/* 検索結果情報 */}
        {(isSearching || activeRoleFilter !== 'all') && (
          <p className="text-sm text-[var(--paragraph)]">
            {isSearching && <>「{searchQuery}」の</>}
            {activeRoleFilter !== 'all' && <>{ROLE_LABELS[activeRoleFilter]}向けの</>}
            検索結果：{totalResults}件
            {totalResults === 0 && '  — キーワードやフィルタを変えてお試しください。'}
          </p>
        )}

        {/* FAQ一覧 */}
        <div className="space-y-4">
          {filteredData.length > 0 ? (
            filteredData.map((category) => (
              <FaqAccordion
                key={category.id}
                category={category}
                searchQuery={searchQuery}
                defaultOpen={isSearching}
                onNavigateToQuestion={handleNavigateToQuestion}
              />
            ))
          ) : (
            <div className="text-center py-12">
              <Search className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-[var(--paragraph)]">
                該当するヘルプ項目が見つかりませんでした。
              </p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory(null);
                  setRoleFilter('all');
                  setShowMyRoleOnly(false);
                }}
                className="mt-2 text-sm text-[var(--primary)] hover:underline"
              >
                フィルターをリセット
              </button>
            </div>
          )}
        </div>
        {/* 用語集 */}
        {(!selectedCategory || selectedCategory === 'glossary') && filteredGlossary.length > 0 && (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800">
            <button
              onClick={() => setShowGlossary(!showGlossary)}
              className="w-full px-4 py-3 bg-[var(--surface)] border-b border-gray-200 dark:border-gray-700 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              <BookOpenCheck className="w-5 h-5 text-[var(--primary)] shrink-0" />
              <div className="flex-1 text-left">
                <h2 className="text-base font-semibold text-[var(--headline)]">用語集</h2>
                <p className="text-xs text-[var(--paragraph)] mt-0.5">
                  システムで使われる専門用語の解説
                </p>
              </div>
              <span className="text-xs text-gray-400 mr-2">{filteredGlossary.length}件</span>
              {showGlossary ? (
                <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
              )}
            </button>
            {showGlossary && (
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {filteredGlossary.map((item, i) => (
                  <div key={i} className="px-4 py-3">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold text-[var(--headline)]">
                        {highlightText(item.term, searchQuery)}
                      </span>
                      {item.reading && (
                        <span className="text-[11px] text-gray-400">（{item.reading}）</span>
                      )}
                    </div>
                    <p className="text-sm text-text-body mt-1 leading-relaxed">
                      {highlightText(item.definition, searchQuery)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
