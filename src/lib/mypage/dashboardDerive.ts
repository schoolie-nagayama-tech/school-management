/**
 * 保護者ポータル ダッシュボード（/mypage トップ）のデータ整形ロジック（純関数）。
 *
 * ★ なぜ純関数として切り出すか:
 *   app/mypage/page.tsx（サーバーコンポーネント）から呼ぶが、DBアクセスを含まない
 *   整形・判定だけのロジックはユニットテストで固定したい。未読数の集計・
 *   「ほかに未読N件」の算出・ヒーロー選択は境界を間違えやすく（例: 最新1件が
 *   未読なら二重に数えてしまう）、間違えると保護者に嘘の件数を見せる実害になる。
 *
 * ★ 'server-only' を付けない理由:
 *   DB/認証に触れないため、テスト（node環境）からも server-only モックなしで
 *   直接 import できるようにする。app/mypage/page.tsx（サーバー専用）から呼ぶ分には
 *   問題ない。
 */
import type { PortalScheduleEntryDto } from '@/types/mypage-schedule';
import type { PortalReportListItem } from '@/types/mypage-report';
import type { FormGuidance } from '@/types/mypage-schedule';
import type { DashboardAppliesSection, DashboardHeroEntry } from '@/types/mypage-dashboard';

/**
 * 予定一覧（今日〜+14日・日付昇順が前提）から「次の授業」ヒーローを選ぶ。
 * 予定が0件なら null。続く予定（agenda）はカードから撤去したので選ばない
 * （「予定をすべて見る」リンク先に譲る）。
 */
export function selectHero(entries: PortalScheduleEntryDto[]): PortalScheduleEntryDto | null {
  return entries[0] ?? null;
}

/** 'HH:MM〜HH:MM' 形式の slotLabel を [開始, 終了] に分ける。引けなければ両方 null。 */
function splitSlotLabel(label: string | null): [string | null, string | null] {
  if (!label) return [null, null];
  const [start, end] = label.split('〜');
  return [start || null, end || null];
}

/** 予定DTO（schedule.ts）→ ヒーロー表示用DTO。講師名は出さない（保護者には不要な情報）。 */
export function toDashboardHero(entry: PortalScheduleEntryDto, today: string): DashboardHeroEntry {
  const [slotStart, slotEnd] = splitSlotLabel(entry.slotLabel);
  return {
    entryDate: entry.entryDate,
    isToday: entry.entryDate === today,
    startTime: entry.startTime ?? slotStart,
    endTime: slotEnd,
    subjectNames: entry.subjectNames,
    isCancelled: entry.status === 'cancelled',
    isTransfer: entry.status === 'transferred_in',
  };
}

/** 未読報告書の件数。 */
export function countUnreadReports(reports: PortalReportListItem[]): number {
  return reports.filter((r) => !r.isRead).length;
}

/**
 * カードに代表として出す報告書を1件選ぶ。
 *
 * ★ 「最新1件」ではなく「未読があれば最新の未読」を出す理由:
 *   見出しの件数バッジは未読数を示す。単純に最新を出すと「バッジは未読1なのに、
 *   表示されている行は既読（新着バッジ無し）」という食い違いが起きる
 *   （「ほかに未読N件」の行を削った簡素化で顕在化。実機で確認）。
 *   未読がある間はそれが保護者に一番見せたいものなので、代表も未読側に揃える。
 *   reports は getPortalReports が新しい順で返す前提（先頭一致で最新の未読になる）。
 */
export function selectFeaturedReport(reports: PortalReportListItem[]): PortalReportListItem | null {
  return reports.find((r) => !r.isRead) ?? reports[0] ?? null;
}

/**
 * 手続きハブのデータ（getFormGuidance の戻り）から、この生徒宛のプッシュ（強調カード）だけを絞り込む。
 *
 * ★ items（「受付中」の静かな一覧）はダッシュボードには出さない:
 *   一覧は「申し込み・手続きへ」リンク先（FormsHub）で見せる。ダッシュボードは
 *   プッシュ（今すぐ対応してほしいもの）だけに絞ってメリハリを付ける。
 */
export function filterGuidanceForStudent(
  guidance: FormGuidance,
  studentId: string
): DashboardAppliesSection {
  return {
    pushes: guidance.pushes.filter((p) => p.studentId === studentId),
  };
}
