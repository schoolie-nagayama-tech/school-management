'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBulletinUnread } from '@/contexts/BulletinUnreadContext';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterData } from '@/contexts/MasterDataContext';
import { USER_ROLE_LABELS } from '@/types/database';
import {
  Megaphone,
  ChevronDown,
  X,
  LogOut,
  Settings,
  LayoutDashboard,
  Smartphone,
} from 'lucide-react';
import { TierMedal } from '@/components/teacher/TierMedal';
import { useTeacherBadgeCount } from '@/hooks/useTeacherBadgeCount';
import { usePendingAttendanceCount } from '@/hooks/usePendingAttendanceCount';
import { BadgeFlowerField } from '@/components/badges/HiddenFlower';
import { HEADER_FLOWERS } from '@/components/badges/flowerPlacements';
import { ThemeToggle } from './ThemeToggle';
import { getSurname } from '@/lib/utils/teacherName';
import { PushNotificationButton } from '@/components/ui/PushNotificationButton';
import { buildNavEntries, isLinkActive, isGroupActive } from './navConfig';
import { isSystemAdmin } from '@/lib/utils/roles';
import { canAccessPortalDemo } from '@/lib/mypage/demoAccess';
import { MobileBottomNav } from './MobileBottomNav';
import { useStandalone } from '@/lib/utils/useStandalone';
import { useToast } from '@/hooks/useToast';
import { ToastContainer } from '@/components/ui';
import { fetchWithAuth } from '@/lib/api/auth';

interface AppHeaderProps {
  title: string;
  /** ページ固有の設定ボタン（申込項目管理など）*/
  onSettingsClick?: () => void;
  /** onSettingsClick のラベル（デフォルト: "ページ設定"）*/
  settingsLabel?: string;
  onBulkGradeUpdateClick?: () => void;
}

// ドロップダウンパネル共通クラス生成。
// 常時DOMに残し、opacity + scale の CSS transitionで開閉する。
// enter: 150ms ease-out（即時反応）/ exit: 100ms（より速く閉じて応答感を高める）
function dropdownPanelClass(open: boolean, align: 'left' | 'right' = 'left') {
  const base =
    'absolute top-full mt-1 bg-white rounded-lg border border-gray-200 shadow-xl transition-[opacity,transform] ease-out';
  const origin = align === 'right' ? 'origin-top-right right-0' : 'origin-top-left left-0';
  // open: opacity 1 → full / closed: opacity 0 + scale 95 + pointer-events none（exit後クリック不可）
  const state = open
    ? 'opacity-100 scale-100 pointer-events-auto duration-150'
    : 'opacity-0 scale-95 pointer-events-none duration-100';
  return `${base} ${origin} ${state}`;
}

// ナビリンク共通クラス。hover + active:scale[0.97] で押した感を出す。
function navLinkClass(active: boolean) {
  return `px-2.5 py-1 rounded text-xs font-medium transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97] ${
    active
      ? 'bg-white text-primary font-semibold'
      : 'text-white/90 hover:bg-white/10 hover:text-white'
  }`;
}

// ドロップダウントリガーボタン共通クラス（上記 navLinkClass + flex）
function navDropdownTriggerClass(active: boolean) {
  return `px-2.5 py-1 rounded text-xs font-medium transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97] flex items-center gap-1 ${
    active
      ? 'bg-white text-primary font-semibold'
      : 'text-white/90 hover:bg-white/10 hover:text-white'
  }`;
}

// ドロップダウン内リンク / ボタン共通クラス
function dropdownItemClass(active: boolean) {
  return `block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
    active ? 'bg-primary/10 text-primary font-semibold' : ''
  }`;
}

export function AppHeader({
  title: _title,
  onSettingsClick,
  settingsLabel,
  onBulkGradeUpdateClick,
}: AppHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    profile,
    permissions,
    signOut,
    isLoading: authLoading,
    schoolIds,
    selectedSchoolId,
    setSelectedSchoolId,
  } = useAuth();
  const { schools: masterSchools } = useMasterData();
  // 未読件数は BulletinUnreadContext に一元化済み（自前のポーリングは廃止）
  const { unreadCount: bulletinUnreadCount } = useBulletinUnread();
  // 出勤簿は通知が無く画面を開くまで気づけないため、ナビの「出勤簿管理」に件数バッジを出す
  const pendingAttendanceCount = usePendingAttendanceCount();

  const handleSchoolChange = (schoolId: string | 'all') => {
    setSelectedSchoolId(schoolId);
    setShowSchoolDropdown(false);
    router.refresh();
  };
  // MasterData の教室一覧から担当教室だけを表示（getSchools の三重取得を避ける）
  const schools = useMemo(
    () => masterSchools.filter((school) => schoolIds.includes(school.id)),
    [masterSchools, schoolIds]
  );
  const displaySchools = schools;
  const [showSchoolDropdown, setShowSchoolDropdown] = useState(false);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  // PCナビ: 現在開いているドロップダウンのキー（同時に1つだけ開く）
  const [openDropdownKey, setOpenDropdownKey] = useState<string | null>(null);
  // スマホナビ: 展開中のグループ（アコーディオン。複数同時に開ける）
  const [openMobileGroups, setOpenMobileGroups] = useState<Set<string>>(() => new Set());

  // PCナビドロップダウン: ホバーで開閉（150ms遅延で閉じて誤クローズを防ぐ）
  const navCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleNavEnter = useCallback((key: string) => {
    if (navCloseTimer.current) clearTimeout(navCloseTimer.current);
    setOpenDropdownKey(key);
  }, []);

  const handleNavLeave = useCallback((key: string) => {
    navCloseTimer.current = setTimeout(() => {
      // 別グループに既に移っていれば閉じない
      setOpenDropdownKey((cur) => (cur === key ? null : cur));
    }, 150);
  }, []);

  // スマホ: グループの展開/折りたたみをトグル
  const toggleMobileGroup = useCallback((key: string) => {
    setOpenMobileGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // 保護者ポータルV2 デモの起動状態（多重クリックで複数セッションを発行しないため）
  const [startingPortalDemo, setStartingPortalDemo] = useState(false);
  const { toasts, removeToast, error: toastError } = useToast();

  /**
   * 保護者ポータルV2 のデモセッションを発行して /mypage へ移動する。
   *
   * サーバー側（/api/portal-demo/start）が権限・ダミーデータ検証をすべて行う。
   * ここは入口の導線であって認可の境界ではないので、失敗理由はサーバーの文言を出す。
   */
  const handlePortalDemo = useCallback(async () => {
    if (startingPortalDemo) return;
    setStartingPortalDemo(true);
    try {
      // 素の fetch では 401 になる（実機で確認）。この API は requireSystemAdmin を通るため、
      // cookie だけに頼らず Authorization ヘッダーを付ける fetchWithAuth を使う
      // ＝プロジェクトの管理API呼び出しの作法（getApiAuth 側も Bearer を見る）。
      const res = await fetchWithAuth('/api/portal-demo/start', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastError(data?.error ?? 'デモの起動に失敗しました');
        setStartingPortalDemo(false);
        return;
      }
      // 保護者用シェル（別レイアウト・別主体）へ移るので実遷移させる。
      window.location.href = '/mypage';
    } catch {
      toastError('デモの起動に失敗しました');
      setStartingPortalDemo(false);
    }
  }, [startingPortalDemo, toastError]);

  // ルート変更時にモバイルメニューを自動で閉じる
  useEffect(() => {
    setShowMobileMenu(false);
  }, [pathname]);

  // permissionsがnullの場合は、すべてのリンクを表示（ローディング中の場合）
  const showAllLinks = !permissions || authLoading;

  // ナビ項目（PC/スマホ共通の単一定義）。権限ゲートは navConfig 側で評価済み。
  // 教室外モード（講師＋教室端末マーク無し）では教室限定の項目を落とす（正典 §2）。
  const navEntries = useMemo(
    () => buildNavEntries({ permissions, profile, showAll: showAllLinks, schools }),
    [permissions, profile, showAllLinks, schools]
  );

  // 講師のみ: バッジ獲得数に応じてヘッダーにティアメダルを表示
  const isTeacher = profile?.role === 'teacher';
  const badgeCount = useTeacherBadgeCount();

  // インストール済みPWA(standalone)では教室長以上のホームをダッシュボード(/home)にする。
  // ブラウザ/PCや講師は従来どおり /students をホーム扱いにする。
  const isStandalone = useStandalone();
  const showPwaHome = isStandalone && !isTeacher;
  const homeHref = showPwaHome ? '/home' : '/students';

  // 現在選択中の教室名を取得
  const getCurrentSchoolDisplayName = (): string => {
    if (selectedSchoolId === 'all') {
      return 'すべての教室';
    }
    if (selectedSchoolId) {
      const school = schools.find((s) => s.id === selectedSchoolId);
      if (school) {
        return school.code === 'DEFAULT' ? 'デフォルト' : school.name;
      }
    }
    return '';
  };

  const schoolDisplayName = getCurrentSchoolDisplayName();

  // クリック外でドロップダウンを閉じる（教室選択・設定のみ — ナビはホバー制御）
  useEffect(() => {
    if (!showSchoolDropdown && !showSettingsDropdown) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (showSchoolDropdown && !target.closest('.school-dropdown-container')) {
        setShowSchoolDropdown(false);
      }
      if (showSettingsDropdown && !target.closest('.settings-dropdown-container')) {
        setShowSettingsDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSchoolDropdown, showSettingsDropdown]);

  return (
    <>
      {/* ヘッダー由来の操作（ポータルデモ起動など）の失敗を出すトースト */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <header className="relative bg-primary shadow-md print:hidden">
        <BadgeFlowerField count={badgeCount ?? 0} placements={HEADER_FLOWERS} />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-4">
              {/* NESTロゴ（スマホのナビは下部のボトムタブ＋メニューシートに集約）。
                  PWA(standalone)の教室長以上はダッシュボード /home をホームにする。 */}
              <Link href={homeHref} className="shrink-0">
                <span className="text-white font-black text-2xl tracking-[0.4em] pr-[0.4em] select-none">
                  NEST
                </span>
              </Link>
              <div className="hidden lg:block h-6 w-px bg-white/30"></div>
              <nav className="hidden lg:flex items-center gap-3">
                {/* PCナビ: navConfig の単一定義から描画（単独リンク or ホバードロップダウン） */}
                {navEntries.map((entry) =>
                  entry.kind === 'link' ? (
                    <Link
                      key={entry.key}
                      href={entry.href}
                      className={navLinkClass(isLinkActive(pathname, entry))}
                    >
                      {entry.label}
                    </Link>
                  ) : (
                    <div
                      key={entry.key}
                      className="relative"
                      onMouseEnter={() => handleNavEnter(entry.key)}
                      onMouseLeave={() => handleNavLeave(entry.key)}
                    >
                      <button className={navDropdownTriggerClass(isGroupActive(pathname, entry))}>
                        {entry.label}
                        <ChevronDown
                          className={`w-3 h-3 transition-[transform] duration-150 ease-out ${openDropdownKey === entry.key ? 'rotate-180' : ''}`}
                        />
                      </button>
                      {/* ドロップダウンは常時DOMに残留し opacity + scale で enter/exit をアニメート */}
                      <div
                        className={`${dropdownPanelClass(openDropdownKey === entry.key)} z-50 min-w-[160px]`}
                        aria-hidden={openDropdownKey !== entry.key}
                      >
                        <div className="py-1">
                          {entry.items.map((item) => (
                            <Link
                              key={item.key}
                              href={item.href}
                              className={`${dropdownItemClass(isLinkActive(pathname, item))} flex items-center justify-between gap-2`}
                            >
                              {item.label}
                              {item.key === 'attendance' && pendingAttendanceCount > 0 && (
                                <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-warning px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                                  {pendingAttendanceCount}
                                </span>
                              )}
                            </Link>
                          ))}
                        </div>
                      </div>
                    </div>
                  )
                )}
              </nav>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-3">
              {displaySchools.length > 1 && schoolDisplayName && (
                <div className="relative school-dropdown-container">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowSchoolDropdown(!showSchoolDropdown);
                    }}
                    className="text-white px-2.5 py-1.5 bg-white/20 rounded-lg hover:bg-white/30 transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97] flex items-center gap-1 text-xs font-medium shrink-0 whitespace-nowrap max-w-[110px] sm:max-w-none"
                  >
                    <span className="truncate">{schoolDisplayName}</span>
                    <ChevronDown
                      className={`w-3 h-3 transition-[transform] duration-150 ease-out ${showSchoolDropdown ? 'rotate-180' : ''}`}
                    />
                  </button>
                  <div
                    className={`${dropdownPanelClass(showSchoolDropdown, 'right')} z-50 min-w-[200px] ring-1 ring-black/5`}
                    onClick={(e) => e.stopPropagation()}
                    aria-hidden={!showSchoolDropdown}
                  >
                    <div className="py-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSchoolChange('all');
                        }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          selectedSchoolId === 'all'
                            ? 'bg-primary/10 text-primary font-semibold'
                            : ''
                        }`}
                      >
                        すべての教室
                      </button>
                      {displaySchools.map((school) => (
                        <button
                          key={school.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSchoolChange(school.id);
                          }}
                          className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors flex items-center gap-2 ${
                            selectedSchoolId === school.id
                              ? 'bg-primary/10 text-primary font-semibold'
                              : ''
                          }`}
                        >
                          <span>{school.code === 'DEFAULT' ? 'デフォルト' : school.name}</span>
                          {school.is_demo && (
                            <span className="ml-auto px-1.5 py-0.5 bg-gray-200 text-gray-500 text-[10px] rounded font-normal">
                              デモ
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {displaySchools.length === 1 && schoolDisplayName && (
                <div
                  className="text-xs font-medium text-white/90 px-3 py-1.5 bg-white/20 rounded-lg max-w-[120px] truncate"
                  title={schoolDisplayName}
                >
                  {schoolDisplayName}
                </div>
              )}
              {isTeacher && badgeCount !== null && <TierMedal count={badgeCount} />}
              {profile && !authLoading && (
                <button
                  onClick={signOut}
                  className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97]"
                  title="ログアウト"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              )}
              {profile && !authLoading && (
                <div className="relative settings-dropdown-container">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowSettingsDropdown(!showSettingsDropdown);
                    }}
                    className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97]"
                    title="設定"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                  <div
                    className={`${dropdownPanelClass(showSettingsDropdown, 'right')} z-50 min-w-[200px]`}
                    onClick={(e) => e.stopPropagation()}
                    aria-hidden={!showSettingsDropdown}
                  >
                    <div className="py-1">
                      {/* ユーザー情報 */}
                      {profile && !authLoading && (
                        <div className="px-3 py-2.5 border-b border-gray-100">
                          <div className="text-xs font-semibold text-gray-900 leading-tight">
                            {isTeacher
                              ? getSurname(profile) || profile.email
                              : profile.display_name || profile.email}
                          </div>
                          <div className="text-[10px] text-gray-500 leading-tight mt-0.5">
                            {USER_ROLE_LABELS[profile.role]}
                          </div>
                        </div>
                      )}
                      {/* ページ固有設定 */}
                      {onBulkGradeUpdateClick && (
                        <button
                          onClick={() => {
                            onBulkGradeUpdateClick();
                            setShowSettingsDropdown(false);
                          }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors duration-150"
                        >
                          一括学年更新
                        </button>
                      )}
                      {onSettingsClick && (
                        <button
                          onClick={() => {
                            onSettingsClick();
                            setShowSettingsDropdown(false);
                          }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors duration-150"
                        >
                          {settingsLabel ?? '設定'}
                        </button>
                      )}
                      <Link
                        href="/settings"
                        className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          pathname === '/settings'
                            ? 'bg-primary/10 text-primary font-semibold'
                            : 'text-text-heading'
                        }`}
                        onClick={() => setShowSettingsDropdown(false)}
                      >
                        すべての設定
                      </Link>
                      <div className="border-t border-border my-1" />
                      {/* 試作・クローズドな機能の入口。
                          通常ナビ（navConfig）には載せず、ここが唯一の入口。
                          検討用モック /home-mock は admin 限定のまま据え置き
                          （試用向けの本ルートは /dashboard に分離済み・navConfig に掲載）。 */}
                      {isSystemAdmin(profile?.role) && (
                        <Link
                          href="/home-mock"
                          className="flex items-center gap-2 px-3 py-2 text-xs text-text-heading hover:bg-gray-50 transition-colors"
                          onClick={() => setShowSettingsDropdown(false)}
                        >
                          <LayoutDashboard className="w-3.5 h-3.5" aria-hidden />
                          教室長ダッシュボード（試作）
                        </Link>
                      )}
                      {/* ポータルV2デモの導線。公開範囲は canAccessPortalDemo が単一の判定点
                          （API 側 /api/portal-demo/start も同じヘルパーで認可する。
                           開放時はヘルパー1箇所＋デモSQLの user_schools 付与を揃える）。 */}
                      {canAccessPortalDemo(profile?.role) && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowSettingsDropdown(false);
                            handlePortalDemo();
                          }}
                          disabled={startingPortalDemo}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-heading transition-colors hover:bg-gray-50 disabled:opacity-50"
                        >
                          <Smartphone className="w-3.5 h-3.5 shrink-0" aria-hidden />
                          保護者ポータルV2（試作・ダミーデータ）
                        </button>
                      )}
                      {(isSystemAdmin(profile?.role) || canAccessPortalDemo(profile?.role)) && (
                        <div className="border-t border-border my-1" />
                      )}
                      {/* テーマ切替 */}
                      <div className="px-3 py-2 flex items-center justify-between">
                        <span className="text-xs text-gray-600">テーマ</span>
                        <ThemeToggle />
                      </div>
                      {/* ヘルプ */}
                      <Link
                        href="/help"
                        className="block px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
                        onClick={() => setShowSettingsDropdown(false)}
                      >
                        ヘルプ
                      </Link>
                      {/* プッシュ通知 */}
                      {!isTeacher && (
                        <div className="px-3 py-2 flex items-center justify-between">
                          <span className="text-xs text-gray-600">プッシュ通知</span>
                          {selectedSchoolId && selectedSchoolId !== 'all' ? (
                            <PushNotificationButton schoolId={selectedSchoolId} compact />
                          ) : schools.length > 0 ? (
                            <PushNotificationButton schoolId={schools[0].id} compact />
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {/* 座席表：システム管理者のみ表示 */}
              {profile && isSystemAdmin(profile.role) && (
                <Link
                  href="/schedule"
                  className={`p-1.5 rounded-lg transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97] ${
                    pathname === '/schedule' || pathname?.startsWith('/schedule')
                      ? 'bg-white text-primary'
                      : 'text-white/80 hover:text-white hover:bg-white/10'
                  }`}
                  title="座席表（開発中）"
                >
                  <LayoutDashboard className="w-4 h-4" aria-hidden />
                </Link>
              )}
            </div>
          </div>
          {/* 連絡掲示板未読アラート（講師のみ）
            slide-in-bar: globals.css で定義済み（@starting-style でフェードイン）*/}
          {bulletinUnreadCount > 0 && (
            <Link
              href="/students"
              className="slide-in-bar block py-2 px-4 bg-amber-400 text-amber-950 font-bold text-sm text-center hover:bg-amber-500 transition-colors duration-150"
            >
              <Megaphone className="inline h-4 w-4 mr-1" />
              連絡掲示板に未読が{bulletinUnreadCount}件あります
            </Link>
          )}
        </div>
      </header>

      {/* スマホ用メニューシート（ボトムタブの「メニュー」で開く）。
          scrim ＋ 下からスライドする白パネル。常時DOMに残し transform でアニメート。
          リンク遷移時は pathname 変更の useEffect が showMobileMenu を false にして自動で閉じる。 */}
      <div
        className={`lg:hidden print:hidden fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 ${
          showMobileMenu ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={() => setShowMobileMenu(false)}
        aria-hidden
      />
      <div
        id="mobile-menu-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="メニュー"
        aria-hidden={!showMobileMenu}
        className={`lg:hidden print:hidden fixed bottom-0 left-0 right-0 z-50 max-h-[82vh] overflow-y-auto rounded-t-2xl bg-white shadow-2xl transition-transform duration-300 ease-out ${
          showMobileMenu ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        {/* ハンドル ＋ タイトル ＋ 閉じる（スクロールしても上部に固定） */}
        <div className="sticky top-0 z-10 border-b border-gray-100 bg-white px-4 pb-2 pt-2">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-gray-300" />
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">メニュー</span>
            <button
              type="button"
              onClick={() => setShowMobileMenu(false)}
              aria-label="閉じる"
              className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-50 hover:text-gray-700 active:scale-95"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <nav
          className="space-y-0.5 px-2 py-2 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]"
          aria-label="全機能メニュー"
        >
          {/* PWA(standalone)の教室長以上のみ: ダッシュボードへの導線をメニュー先頭に出す */}
          {showPwaHome && (
            <Link
              href="/home"
              className={`block rounded-md px-4 py-2.5 text-sm transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.98] ${
                pathname === '/home'
                  ? 'bg-primary/10 font-semibold text-primary'
                  : 'text-gray-800 hover:bg-gray-50'
              }`}
            >
              ホーム
            </Link>
          )}
          {/* PCと同じ navConfig 定義から描画。グループはタップ開閉のアコーディオン。 */}
          {navEntries.map((entry) =>
            entry.kind === 'link' ? (
              <Link
                key={entry.key}
                href={entry.href}
                className={`block rounded-md px-4 py-2.5 text-sm transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.98] ${
                  isLinkActive(pathname, entry)
                    ? 'bg-primary/10 font-semibold text-primary'
                    : 'text-gray-800 hover:bg-gray-50'
                }`}
              >
                {entry.label}
              </Link>
            ) : (
              <div key={entry.key}>
                <button
                  type="button"
                  onClick={() => toggleMobileGroup(entry.key)}
                  aria-expanded={openMobileGroups.has(entry.key)}
                  className={`flex w-full items-center justify-between rounded-md px-4 py-2.5 text-sm transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.98] ${
                    isGroupActive(pathname, entry)
                      ? 'font-semibold text-primary'
                      : 'text-gray-800 hover:bg-gray-50'
                  }`}
                >
                  <span>{entry.label}</span>
                  <ChevronDown
                    className={`h-4 w-4 text-gray-400 transition-transform duration-200 ease-out ${
                      openMobileGroups.has(entry.key) ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                <div
                  className="overflow-hidden"
                  style={{
                    maxHeight: openMobileGroups.has(entry.key)
                      ? `${entry.items.length * 44 + 8}px`
                      : 0,
                    transition: 'max-height 220ms var(--ease-out)',
                  }}
                  aria-hidden={!openMobileGroups.has(entry.key)}
                >
                  <div className="space-y-0.5 py-0.5 pl-3">
                    {entry.items.map((item) => (
                      <Link
                        key={item.key}
                        href={item.href}
                        className={`flex items-center justify-between gap-2 rounded-md px-4 py-2 text-sm transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.98] ${
                          isLinkActive(pathname, item)
                            ? 'bg-primary/10 font-semibold text-primary'
                            : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {item.label}
                        {item.key === 'attendance' && pendingAttendanceCount > 0 && (
                          <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-warning px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                            {pendingAttendanceCount}
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            )
          )}
          {/* テーマ切替・ヘルプ・ユーザー情報 */}
          <div className="mt-1 flex items-center justify-between border-t border-gray-100 px-4 pt-3">
            <span className="text-xs text-gray-500">テーマ</span>
            <ThemeToggle />
          </div>
          <Link
            href="/help"
            className="block rounded-md px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            ヘルプ
          </Link>
          {profile && (
            <div className="mt-1 border-t border-gray-100 px-4 pt-3 text-xs text-gray-500">
              <div className="font-semibold text-gray-900">
                {isTeacher
                  ? getSurname(profile) || profile.email
                  : profile.display_name || profile.email}
              </div>
              <div>{USER_ROLE_LABELS[profile.role]}</div>
            </div>
          )}
        </nav>
      </div>

      {/* スマホ: 下部固定のボトムタブ（主要画面 ＋ メニュー） */}
      <MobileBottomNav
        menuOpen={showMobileMenu}
        onMenuToggle={() => setShowMobileMenu((v) => !v)}
      />
    </>
  );
}
