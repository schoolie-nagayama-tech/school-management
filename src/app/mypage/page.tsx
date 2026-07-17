import { redirect } from 'next/navigation';
import { getPortalContext } from '@/lib/mypage/supabase';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { getPortalScheduleEntries, todayJst, addDaysJst } from '@/lib/mypage/schedule';
import { getPortalReports } from '@/lib/mypage/reports';
import { getPortalChatSummaries } from '@/lib/mypage/chatSummary';
import { getPortalAnnouncements } from '@/lib/mypage/announcements';
import { getFormGuidance } from '@/lib/mypage/formGuidance';
import {
  selectHero,
  selectFeaturedReport,
  toDashboardHero,
  countUnreadReports,
  filterGuidanceForStudent,
} from '@/lib/mypage/dashboardDerive';
import { DashboardView } from '@/components/mypage/DashboardView';
import { LogoutButton } from '@/components/mypage/LogoutButton';
import type { DashboardChild, DashboardNotice } from '@/types/mypage-dashboard';

export const dynamic = 'force-dynamic';

/** 紐づけ生徒（RLS越しに見えた行）の型。 */
interface LinkedStudentRow {
  student_id: string;
  relation: string;
  students: { id: string; last_name: string; first_name: string; grade: number | null } | null;
}

/** 予定を先読みする期間（今日〜+14日）。ScheduleView の週送りとは独立の、ダッシュボード専用の窓。 */
const AGENDA_HORIZON_DAYS = 14;

/**
 * マイページのトップ＝ダッシュボード。ログイン必須。
 *
 * ★ ここが Stage1 の権限境界の実地確認ポイント:
 *   ポータルJWTのクライアントで students を読む。返るのは RLS
 *   （portal_students_select_linked）が許した「自分の紐づけ生徒（在籍中）」だけ。
 *   退塾日を過ぎた生徒は students 埋め込みが RLS で外れ null になる → 一覧に出さない。
 *
 * ★ 全てサーバーコンポーネントで一括組み立て・スピナー無し（承認済みモック準拠）:
 *   子どもが複数いても、各ドメイン（連絡/お知らせ/スケジュール/報告書/手続き）の
 *   取得を「全子ども分まとめて」行い、クライアント（DashboardView）には完成済みの
 *   データを渡す。タブ切替は useState だけで、通信は一切発生しない。
 *
 * ★ アカウント単位で1回だけ取る値（全子どもで共有）:
 *   お知らせ（getPortalAnnouncements）とチャット概要（getPortalChatSummaries）と
 *   手続きハブ（getFormGuidance）は生徒ごとに叩くと同じ結果を人数ぶん重複取得する
 *   ことになるため、生徒ループの外で1回だけ取り、ループ内では絞り込みだけ行う。
 */
export default async function MyPage() {
  const ctx = await getPortalContext();
  if (!ctx) {
    // 未ログイン（cookie無し・JWT無効・期限切れ）はログイン画面へ。
    redirect('/mypage/login');
  }

  const { client, claims } = ctx;

  // 自分のアカウント表示名（portal_accounts の SELECT self ポリシー越し）。
  const { data: account } = await client
    .from('portal_accounts')
    .select('display_name')
    .eq('id', claims.sub)
    .maybeSingle();
  const displayName = account?.display_name ?? 'ようこそ';

  // 紐づけ生徒。students は RLS で在籍中の紐づけ生徒だけが埋め込まれる。
  const { data: linksRaw } = await client
    .from('portal_account_students')
    .select('student_id, relation, students(id, last_name, first_name, grade)');
  const links = (linksRaw ?? []) as unknown as LinkedStudentRow[];
  // RLS で students が外れた（退塾・失効）行は表示しない。
  const visibleStudents = links.filter((l) => l.students != null);

  if (visibleStudents.length === 0) {
    return (
      <div>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold tracking-wide text-text-muted">マイページ</p>
            <h1 className="text-[19px] font-bold text-text-heading">{displayName}</h1>
          </div>
          <LogoutButton />
        </div>
        <div className="rounded-xl border border-border bg-surface-raised p-4 text-sm text-text-muted">
          表示できる生徒がいません。教室から届いた招待で生徒を紐づけてください。
        </div>
      </div>
    );
  }

  const studentIds = visibleStudents.map((l) => l.student_id);
  const today = todayJst();
  const horizon = addDaysJst(today, AGENDA_HORIZON_DAYS);
  const svc = getPortalServiceClient();

  // ── アカウント単位で1回だけ取る値（全子どもで共有） ──
  const [chatSummaries, noticesRaw, guidance] = await Promise.all([
    getPortalChatSummaries(client, svc, claims.sub),
    getPortalAnnouncements(client, claims.sub),
    getFormGuidance(studentIds),
  ]);

  const chatByStudent = new Map(chatSummaries.map((s) => [s.student_id, s]));
  // 「教室からの連絡」カードは最新2件だけ・固定表示（すべては /mypage/announcements）。
  const notices: DashboardNotice[] = noticesRaw.slice(0, 2).map((n) => ({
    id: n.id,
    title: n.title,
    createdAt: n.created_at,
    isRead: n.is_read,
  }));

  // ── 生徒ごとの組み立て（並列） ──
  const students: DashboardChild[] = await Promise.all(
    visibleStudents.map(async (l) => {
      const st = l.students!;
      const name = `${st.last_name} ${st.first_name}`;

      const [entries, reports] = await Promise.all([
        getPortalScheduleEntries(client, l.student_id, today, horizon),
        getPortalReports(client, l.student_id),
      ]);

      const heroEntry = selectHero(entries);
      const unreadCount = countUnreadReports(reports);
      // 代表は「未読があれば最新の未読」（見出しの未読バッジと表示行を食い違わせない）。
      const latestReport = selectFeaturedReport(reports);
      const latestIsUnread = latestReport ? !latestReport.isRead : false;

      const chat = chatByStudent.get(l.student_id);

      return {
        id: l.student_id,
        name,
        grade: st.grade,
        hero: heroEntry ? toDashboardHero(heroEntry, today) : null,
        reports: {
          unreadCount,
          latest: latestReport
            ? {
                id: latestReport.id,
                lessonDate: latestReport.lessonDate,
                subjectNames: latestReport.subjectNames,
                isUnread: latestIsUnread,
                checkTestScore: latestReport.checkTestScore,
                checkTestTotal: latestReport.checkTestTotal,
                checkTestPassed: latestReport.checkTestPassed,
              }
            : null,
        },
        applies: filterGuidanceForStudent(guidance, l.student_id),
        chat: {
          unreadCount: chat?.unread_count ?? 0,
        },
      };
    })
  );

  return <DashboardView displayName={displayName} students={students} notices={notices} />;
}
