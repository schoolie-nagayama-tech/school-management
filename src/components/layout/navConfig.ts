import type { Permission, UserProfile } from '@/types/database';
import { isTeacher, isManagerOrAbove } from '@/lib/utils/roles';

/**
 * ヘッダーナビゲーションの構造定義（単一の情報源）。
 *
 * 以前はデスクトップのドロップダウンとモバイルのハンバーガーで
 * メニュー定義が二重管理され、項目欠落・ラベル不一致・権限ゲートの
 * 食い違いが発生していた。ここで構造をデータ化し、PC/スマホの
 * 両方が同じ定義（buildNavEntries）を参照することで乖離を防ぐ。
 */

/** ナビの単独リンク */
export interface NavLink {
  key: string;
  label: string;
  href: string;
  /** active 判定を href の完全一致のみにする（既定は前方一致も含む） */
  exact?: boolean;
  /** href 以外に active 扱いする前方一致パス */
  matchPrefixes?: string[];
}

/** ドロップダウン（PC）/ アコーディオン（スマホ）になるグループ */
export interface NavGroup {
  key: string;
  label: string;
  /** グループのトリガーを active 扱いする前方一致パス（配下ページ全体） */
  matchPrefixes: string[];
  items: NavLink[];
}

export type NavEntry = ({ kind: 'link' } & NavLink) | ({ kind: 'group' } & NavGroup);

export interface NavContext {
  permissions: Permission | null;
  profile: UserProfile | null;
  /** 認証/権限ロード中は全リンクを表示（チラつき防止の既存挙動を踏襲） */
  showAll: boolean;
  /** 講師の自分の出勤簿リンク生成に使う担当教室 */
  schools: { id: string; code: string | null }[];
}

/**
 * 現在のユーザーに表示すべきナビ項目を、表示順で返す。
 * 権限ゲートはここで一元的に評価し、可視な項目だけを返す。
 */
export function buildNavEntries(ctx: NavContext): NavEntry[] {
  const { permissions: p, profile, showAll, schools } = ctx;
  const teacher = isTeacher(profile?.role);
  const entries: NavEntry[] = [];

  // 生徒管理（全ロール）
  if (showAll || p?.canAccessStudents) {
    entries.push({
      kind: 'link',
      key: 'students',
      label: '生徒管理',
      href: '/students',
      exact: true,
    });
  }

  // 進行表確認（教室長以上）
  if (showAll || (p?.canAccessStudents && !teacher)) {
    entries.push({
      kind: 'link',
      key: 'progress-feed',
      label: '進行表確認',
      href: '/progress-feed',
      exact: true,
    });
  }

  // 申込状況
  if (showAll || p?.canAccessApplications) {
    entries.push({
      kind: 'link',
      key: 'applications',
      label: '申込状況',
      href: '/applications',
      exact: true,
    });
  }

  // 問合せ管理（教室長以上）。ページ側のガードがロール基準（manager/owner/admin）の
  // ため、ナビの可視判定も permission ではなくロールで合わせる。サブ機能（分析・
  // 取込・追客メール等）は一覧ページ内のツールバーから辿るので、ナビは単独リンク1本。
  if (showAll || isManagerOrAbove(profile?.role)) {
    entries.push({
      kind: 'link',
      key: 'inquiries',
      label: '問合せ管理',
      href: '/admin/inquiries',
      matchPrefixes: ['/admin/inquiries'],
    });
  }

  // テスト対策（講師はトップレベルに単独表示。教室長以上はフォーム管理グループ内）
  if (teacher) {
    entries.push({
      kind: 'link',
      key: 'test-prep',
      label: 'テスト対策',
      href: '/test-prep-proposals',
    });
  }

  // フォーム管理（教室長以上）
  if (showAll || p?.canAccessPortal) {
    entries.push({
      kind: 'group',
      key: 'form',
      label: 'フォーム管理',
      matchPrefixes: ['/responses', '/forms/responses', '/transcriptions', '/settings/portal'],
      items: [
        {
          key: 'responses',
          label: '回答一覧',
          href: '/responses',
          matchPrefixes: ['/forms/responses'],
        },
        { key: 'transcriptions', label: '面談記録追加', href: '/transcriptions' },
        { key: 'portal', label: 'ポータル設定', href: '/settings/portal' },
        { key: 'test-prep', label: 'テスト対策', href: '/test-prep-proposals' },
      ],
    });
  }

  // 講習管理（教室長以上）
  if (showAll || p?.canAccessCourses) {
    entries.push({
      kind: 'group',
      key: 'course',
      label: '講習管理',
      matchPrefixes: ['/courses'],
      items: [
        { key: 'courses', label: '講習一覧', href: '/courses', exact: true },
        { key: 'progress', label: '進捗管理', href: '/courses/progress' },
        { key: 'schedule', label: '準備スケジュール', href: '/courses/schedule' },
        { key: 'proposals', label: '講習提案書', href: '/courses/proposals' },
      ],
    });
  }

  // 講師（教室長以上はグループ、講師は自分の出勤簿への単独リンク）
  if (teacher) {
    const home = schools[0];
    if (home?.code && profile?.id) {
      entries.push({
        kind: 'link',
        key: 'my-attendance',
        label: '出勤簿',
        href: `/attendance/${home.code}/${profile.id}`,
        matchPrefixes: ['/attendance/'],
      });
    }
  } else {
    entries.push({
      kind: 'group',
      key: 'teacher',
      label: '講師',
      matchPrefixes: [
        '/admin/teachers',
        '/admin/attendance',
        '/admin/teacher-badges',
        '/settings/seasonal-shifts',
      ],
      items: [
        { key: 'teachers', label: '講師一覧', href: '/admin/teachers' },
        { key: 'attendance', label: '出勤簿管理', href: '/admin/attendance' },
        { key: 'shifts', label: 'シフト設定', href: '/settings/seasonal-shifts' },
        { key: 'badges', label: '研修バッジ管理', href: '/admin/teacher-badges' },
      ],
    });
  }

  // 業務管理（教室長以上）
  if (showAll || p?.canAccessBilling) {
    entries.push({
      kind: 'group',
      key: 'business',
      label: '業務管理',
      matchPrefixes: ['/billing', '/ordering', '/inventory', '/tasks'],
      items: [
        { key: 'billing', label: '請求管理', href: '/billing' },
        {
          key: 'ordering',
          label: '教材・発注管理',
          href: '/ordering',
          matchPrefixes: ['/inventory'],
        },
        { key: 'tasks', label: '業務進捗管理表', href: '/tasks' },
      ],
    });
  }

  return entries;
}

/** 単独リンクが現在のパスでアクティブかを判定 */
export function isLinkActive(pathname: string | null, link: NavLink): boolean {
  if (!pathname) return false;
  if (pathname === link.href) return true;
  if (!link.exact && pathname.startsWith(link.href + '/')) return true;
  return (link.matchPrefixes ?? []).some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix)
  );
}

/** グループ（トリガー）が現在のパスでアクティブかを判定 */
export function isGroupActive(pathname: string | null, group: NavGroup): boolean {
  if (!pathname) return false;
  if (group.matchPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) {
    return true;
  }
  return group.items.some((item) => isLinkActive(pathname, item));
}
