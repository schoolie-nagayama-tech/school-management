import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  MessageSquare,
  CalendarDays,
  FileText,
  User,
  Megaphone,
  ClipboardList,
} from 'lucide-react';
import { getPortalContext } from '@/lib/mypage/supabase';
import { LogoutButton } from '@/components/mypage/LogoutButton';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';

export const dynamic = 'force-dynamic';

/** relation コードの表示ラベル。 */
const RELATION_LABEL: Record<string, string> = {
  self: '本人',
  father: '父',
  mother: '母',
  other: '保護者',
};

/** 紐づけ生徒（RLS越しに見えた行）の型。 */
interface LinkedStudentRow {
  student_id: string;
  relation: string;
  students: { id: string; last_name: string; first_name: string; grade: number | null } | null;
}

/**
 * マイページ（器）。ログイン必須。
 *
 * ★ ここが Stage1 の権限境界の実地確認ポイント:
 *   ポータルJWTのクライアントで students を読む。返るのは RLS
 *   （portal_students_select_linked）が許した「自分の紐づけ生徒（在籍中）」だけ。
 *   退塾日を過ぎた生徒は students 埋め込みが RLS で外れ null になる → 一覧に出さない。
 *
 * 各ドメイン（連絡/お知らせ/スケジュール/手続き/報告書）は Stage2〜4 で実装済み。
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

  // 紐づけ生徒。students は RLS で在籍中の紐づけ生徒だけが埋め込まれる。
  const { data: linksRaw } = await client
    .from('portal_account_students')
    .select('student_id, relation, students(id, last_name, first_name, grade)');

  const links = (linksRaw ?? []) as unknown as LinkedStudentRow[];
  // RLS で students が外れた（退塾・失効）行は表示しない。
  const visibleStudents = links.filter((l) => l.students != null);

  return (
    <div>
      {/* ヘッダー */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs text-text-muted">マイページ</p>
          <h1 className="text-lg font-bold text-text-heading">
            {account?.display_name ?? 'ようこそ'}
          </h1>
        </div>
        <LogoutButton />
      </div>

      {/* 紐づけ生徒 */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-text-heading">お子さま・生徒</h2>
        {visibleStudents.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface-raised p-4 text-sm text-text-muted">
            表示できる生徒がいません。教室から届いた招待で生徒を紐づけてください。
          </div>
        ) : (
          <ul className="space-y-2">
            {visibleStudents.map((l) => (
              <li
                key={l.student_id}
                className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised p-4"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-hover text-text-muted">
                  <User className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium text-text-heading">
                    {l.students!.last_name} {l.students!.first_name}
                  </p>
                  <p className="text-xs text-text-muted">
                    {RELATION_LABEL[l.relation] ?? l.relation}
                    {l.students!.grade != null && ` ・ ${formatGradeLabel(l.students!.grade)}`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* メニュー。連絡（チャット）・お知らせは Stage2 で有効化。他は準備中。 */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-text-heading">メニュー</h2>
        <div className="grid grid-cols-1 gap-3">
          <LinkCard
            href="/mypage/chat"
            icon={<MessageSquare className="h-5 w-5" />}
            title="教室との連絡"
            description="欠席・遅刻・振替・面談のご連絡"
          />
          <LinkCard
            href="/mypage/announcements"
            icon={<Megaphone className="h-5 w-5" />}
            title="お知らせ"
            description="教室からのお知らせ"
          />
          <LinkCard
            href="/mypage/schedule"
            icon={<CalendarDays className="h-5 w-5" />}
            title="スケジュール"
            description="時間割・今後の予定／欠席・振替の連絡"
          />
          <LinkCard
            href="/mypage/forms"
            icon={<ClipboardList className="h-5 w-5" />}
            title="申し込み・手続き"
            description="模試・増コマ・通塾の変更・ご相談"
          />
          <LinkCard
            href="/mypage/reports"
            icon={<FileText className="h-5 w-5" />}
            title="授業報告書"
            description="授業の報告・宿題"
          />
        </div>
      </section>
    </div>
  );
}

/** 遷移可能なメニューカード。 */
function LinkCard({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised p-4 transition-colors hover:bg-surface-hover"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-hover text-text-muted">
        {icon}
      </span>
      <div>
        <p className="font-medium text-text-heading">{title}</p>
        <p className="text-xs text-text-muted">{description}</p>
      </div>
    </Link>
  );
}
