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
import type {
  DashboardAgendaEntry,
  DashboardAppliesSection,
  DashboardHeroEntry,
} from '@/types/mypage-dashboard';

/**
 * 予定一覧（今日〜+14日・日付昇順が前提）から「次の授業」ヒーローと、続く予定（最大2件）を選ぶ。
 * 予定が0件なら hero=null・agenda=[]。
 */
export function selectHeroAndAgenda(entries: PortalScheduleEntryDto[]): {
  hero: PortalScheduleEntryDto | null;
  agenda: PortalScheduleEntryDto[];
} {
  if (entries.length === 0) return { hero: null, agenda: [] };
  return { hero: entries[0], agenda: entries.slice(1, 3) };
}

/** 'HH:MM〜HH:MM' 形式の slotLabel を [開始, 終了] に分ける。引けなければ両方 null。 */
function splitSlotLabel(label: string | null): [string | null, string | null] {
  if (!label) return [null, null];
  const [start, end] = label.split('〜');
  return [start || null, end || null];
}

/** 予定DTO（schedule.ts）→ ヒーロー表示用DTO。 */
export function toDashboardHero(entry: PortalScheduleEntryDto, today: string): DashboardHeroEntry {
  const [slotStart, slotEnd] = splitSlotLabel(entry.slotLabel);
  return {
    entryDate: entry.entryDate,
    isToday: entry.entryDate === today,
    startTime: entry.startTime ?? slotStart,
    endTime: slotEnd,
    subjectNames: entry.subjectNames,
    teacherName: entry.teacherName,
    isCancelled: entry.status === 'cancelled',
    isTransfer: entry.status === 'transferred_in',
  };
}

/** 予定DTO（schedule.ts）→ 続く予定（アジェンダ行）表示用DTO。 */
export function toDashboardAgendaEntry(entry: PortalScheduleEntryDto): DashboardAgendaEntry {
  return {
    entryDate: entry.entryDate,
    startTime: entry.startTime,
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
 * 「ほかに未読の報告書が N 件」の N。
 * 最新1件はカード本体に既に出ている（新着バッジ付き）ので、それが未読なら
 * 全体の未読数から1引いて二重に数えないようにする。
 */
export function computeMoreUnreadReports(unreadCount: number, latestIsUnread: boolean): number {
  return Math.max(0, unreadCount - (latestIsUnread ? 1 : 0));
}

/**
 * 手続きハブのデータ（getFormGuidance の戻り）から、この生徒宛のぶんだけを絞り込む。
 *
 * ★ items は「受付中」のみに絞る（status === 'open'）:
 *   ダッシュボードは「今やること」を見せる場で、受付終了は申込めず出す価値が薄い。
 *   受付終了も含めた全件は forms ページ（FormsHub）で見せる。
 */
export function filterGuidanceForStudent(
  guidance: FormGuidance,
  studentId: string
): DashboardAppliesSection {
  return {
    pushes: guidance.pushes.filter((p) => p.studentId === studentId),
    items: guidance.items.filter((i) => i.studentId === studentId && i.status === 'open'),
  };
}
