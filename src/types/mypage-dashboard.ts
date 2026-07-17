import type { GuidancePush } from './mypage-schedule';

/**
 * 保護者ポータル ダッシュボード（/mypage トップ）の共有型。
 *
 * ★ なぜ lib/mypage/* から型を切り出すか:
 *   lib/mypage/dashboardDerive.ts はサーバー（app/mypage/page.tsx）から呼ぶが、
 *   ここで作る DTO の形は DashboardView（クライアントコンポーネント）にそのまま渡す。
 *   mypage-schedule.ts / mypage-report.ts と同じ理由で、型だけをこの中立な
 *   ファイルに置く（実装はサーバー側の dashboardDerive.ts / page.tsx に残す）。
 *
 * ダッシュボードはサーバーで全子ども分を組み立てて一括で渡す（§アーキテクチャ方針）。
 * クライアント側は先読み済みのデータを出し分けるだけで、タブ切替で通信しない。
 */

/** 「次の授業」ヒーロー1件（その生徒の直近予定の先頭）。 */
export interface DashboardHeroEntry {
  /** 'YYYY-MM-DD' */
  entryDate: string;
  /** entryDate が今日（JST）か。 */
  isToday: boolean;
  /** 'HH:MM'。時限が引けなければ null。 */
  startTime: string | null;
  /** 'HH:MM'。slotLabel（'17:00〜18:30'）から分離。引けなければ null。 */
  endTime: string | null;
  subjectNames: string[];
  isCancelled: boolean;
  isTransfer: boolean;
}

/** 授業報告書セクションの最新1件。 */
export interface DashboardLatestReport {
  id: string;
  /** 'YYYY-MM-DD' */
  lessonDate: string;
  subjectNames: string[];
  isUnread: boolean;
  checkTestScore: number | null;
  checkTestTotal: number | null;
  checkTestPassed: boolean | null;
}

/** 授業報告書セクション1件分。 */
export interface DashboardReportsSection {
  /** その生徒の未読報告書の総数。 */
  unreadCount: number;
  /** 最新1件（無ければ null＝報告書なし）。 */
  latest: DashboardLatestReport | null;
}

/** お申し込みセクション（この生徒に絞り込み済み）。 */
export interface DashboardAppliesSection {
  /** 強調カード（タイトル＋理由＋CTA）のみ。「受付中」の静かな一覧は forms ページで見せる。 */
  pushes: GuidancePush[];
}

/** チャット概要（この生徒宛のスレッド）。 */
export interface DashboardChatSummary {
  unreadCount: number;
}

/** お知らせ1件（アカウント単位で共有・全子どもタブで同じ内容）。 */
export interface DashboardNotice {
  id: string;
  title: string;
  /** ISO日時（bulletin_posts.created_at）。表示整形は DashboardView 側で行う。 */
  createdAt: string;
  isRead: boolean;
}

/** 子ども1人分のダッシュボードデータ一式。 */
export interface DashboardChild {
  id: string;
  name: string;
  grade: number | null;
  /** 直近の予定が無ければ null。 */
  hero: DashboardHeroEntry | null;
  reports: DashboardReportsSection;
  applies: DashboardAppliesSection;
  chat: DashboardChatSummary;
}
