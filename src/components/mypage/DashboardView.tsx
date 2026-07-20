'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  BarChart3,
  Bell,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  FileText,
  MessageSquare,
} from 'lucide-react';
import { LogoutButton } from './LogoutButton';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';
import type { DashboardChild, DashboardNotice } from '@/types/mypage-dashboard';

/**
 * 保護者ポータル /mypage トップ（ダッシュボード）。
 *
 * 正典: docs/portal-v2-requirements.md、承認済みモック（scratchpad/portal-dashboard-mock.html）。
 *
 * 並び（モック準拠・変えないこと）:
 *   教室からの連絡（最上部）→ 次の授業（ヒーロー）→ 授業報告書 → お申し込み。
 *   連絡事項を最初に届ける方針（教室からの返信・お知らせ）。次の授業は保護者の
 *   最頻の用事（「次いつ連れて行くか」）なのでヒーロー扱いのまま。
 *
 * ★ 全子ども分のデータをサーバー（app/mypage/page.tsx）で先読み済みで受け取る:
 *   ここでは「どの子どもを表示するか」の useState だけを持ち、タブ切替は
 *   通信なしで一瞬。子どもタブは兄弟がいる（students.length > 1）ときだけ出す。
 *
 * ★ 色の使い分け（設計メモ）: 赤（primary）は「今日・新着・未読」だけ。
 *   青（ink）はリンクとCTA。合格=緑（success）／再テスト=黄（warning）。
 *   「受付中」バッジは既存の FormsHub の踏襲で success（緑）。装飾には使わない。
 */
export function DashboardView({
  displayName,
  students,
  notices,
}: {
  displayName: string;
  students: DashboardChild[];
  notices: DashboardNotice[];
}) {
  const [activeId, setActiveId] = useState<string>(students[0]?.id ?? '');
  const active = students.find((s) => s.id === activeId) ?? students[0] ?? null;

  return (
    <div>
      {/* ページヘッダー: 「マイページ」ラベル ＋（右）子どもタブ＋ログアウト */}
      <div className="mb-[3px] flex items-center justify-between gap-2.5">
        <span className="flex-shrink-0 text-[11px] font-bold tracking-wide text-text-muted">
          マイページ
        </span>
        <div className="flex min-w-0 items-center gap-2">
          {students.length > 1 && (
            <div
              className="flex min-w-0 gap-[5px] overflow-x-auto"
              role="tablist"
              aria-label="お子さまの切り替え"
            >
              {students.map((s) => {
                const isActive = s.id === activeId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveId(s.id)}
                    className={`inline-flex flex-shrink-0 items-baseline gap-1 whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[11.5px] font-semibold transition-colors ${
                      isActive
                        ? 'border-text-heading bg-text-heading text-surface-raised'
                        : 'border-border bg-surface-raised text-text-body hover:bg-surface-hover'
                    }`}
                  >
                    {s.name}
                    {s.grade != null && (
                      <span
                        className={`text-[10px] font-medium ${
                          isActive ? 'text-surface-raised/75' : 'text-text-muted'
                        }`}
                      >
                        {formatGradeLabel(s.grade)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <LogoutButton />
        </div>
      </div>
      <h1 className="mb-4 text-[19px] font-bold text-text-heading">{displayName}</h1>

      {active == null ? (
        <div className="rounded-xl border border-border bg-surface-raised p-4 text-sm text-text-muted">
          表示できる生徒がいません。
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <CommunicationCard chat={active.chat} notices={notices} />
          <ScheduleCard child={active} />
          <ReportsCard child={active} />
          <AppliesCard child={active} />
          <GradesLink />
        </div>
      )}
    </div>
  );
}

// ============================================================
// 共通の小部品
// ============================================================

/** カード（角丸・枠線・末尾に「すべて見る」フッター）。フッターは空状態でも常に出す。 */
function DashCard({
  children,
  footerLabel,
  footerHref,
  bodyClassName,
}: {
  children: React.ReactNode;
  footerLabel: string;
  footerHref: string;
  bodyClassName?: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-raised">
      <div className={bodyClassName ?? 'p-3.5'}>{children}</div>
      <Link
        href={footerHref}
        className="flex items-center justify-between border-t border-border-subtle px-3.5 py-2.5 text-[12.5px] font-semibold text-ink transition-colors hover:bg-surface-hover"
      >
        {footerLabel}
        <ChevronRight className="h-[15px] w-[15px]" />
      </Link>
    </div>
  );
}

/** セクション見出し（アイコン＋ラベル＋件数バッジ）。 */
function SectionHead({
  icon,
  label,
  count,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <div className="mb-2.5 flex items-center gap-1.5">
      <span className="h-3.5 w-3.5 flex-shrink-0 text-text-muted">{icon}</span>
      <span className="text-[11px] font-bold tracking-wide text-text-muted">{label}</span>
      {count != null && count > 0 && <CountBadge count={count} />}
    </div>
  );
}

/** 件数バッジ（未読数・プッシュ件数など、注意を引きたい数だけに使う＝primary）。 */
function CountBadge({ count }: { count: number }) {
  return (
    <span className="ml-0.5 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-primary px-[5px] text-[10.5px] font-bold leading-none text-text-on-primary">
      {count}
    </span>
  );
}

/** 静かな空状態（各セクション共通）。 */
function EmptySection({ primary, secondary }: { primary: string; secondary?: string }) {
  return (
    <div className="px-1 py-3.5 text-center">
      <p className="text-[12.5px] text-text-muted">{primary}</p>
      {secondary && <p className="mt-0.5 text-[11px] text-text-faint">{secondary}</p>}
    </div>
  );
}

/** 小バッジ（今日・振替・休講・新着・合格・再テスト）。 */
function Badge({
  tone,
  children,
}: {
  tone: 'primary' | 'ink' | 'new' | 'success' | 'warning';
  children: React.ReactNode;
}) {
  const cls: Record<typeof tone, string> = {
    primary: 'bg-primary-subtle text-primary',
    ink: 'bg-ink-subtle text-ink',
    new: 'bg-primary text-text-on-primary',
    success: 'bg-success-subtle text-success',
    warning: 'bg-warning-subtle text-warning',
  };
  return (
    <span
      className={`inline-flex flex-shrink-0 items-center rounded-full px-2 py-0.5 text-[10.5px] font-bold leading-normal ${cls[tone]}`}
    >
      {children}
    </span>
  );
}

const DOW_JP = ['日', '月', '火', '水', '木', '金', '土'];

/** 'YYYY-MM-DD' → '7/16(木)'。次の授業・報告書の日付表記（他画面と揃え、曜日つき）。 */
function formatMDWeekday(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}/${d}(${DOW_JP[dow]})`;
}

/** ISO日時 → '7/11'（お知らせの日付表記。曜日なし・JST基準）。 */
function formatMD(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}`;
}

// ============================================================
// 1) 教室からの連絡
// ============================================================

function CommunicationCard({
  chat,
  notices,
}: {
  chat: DashboardChild['chat'];
  notices: DashboardNotice[];
}) {
  return (
    <DashCard
      footerLabel="お知らせ一覧へ"
      footerHref="/mypage/announcements"
      bodyClassName="px-3.5 pb-2 pt-3"
    >
      <SectionHead
        icon={<Bell className="h-full w-full" />}
        label="教室からの連絡"
        count={chat.unreadCount}
      />

      {chat.unreadCount > 0 ? (
        <Link href="/mypage/chat" className="flex items-center gap-2.5 py-2">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-primary-subtle text-primary">
            <MessageSquare className="h-[15px] w-[15px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-text-heading">
              教室から返信が届いています
            </span>
          </span>
        </Link>
      ) : (
        <Link href="/mypage/chat" className="flex items-center gap-2.5 py-2">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-surface-hover text-text-muted">
            <MessageSquare className="h-[15px] w-[15px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-text-heading">教室との連絡</span>
            <span className="block text-[11.5px] text-text-muted">新しい返信はありません</span>
          </span>
        </Link>
      )}

      <div className="mb-1 mt-2 flex items-center gap-1.5">
        <span className="text-[10.5px] font-bold tracking-wide text-text-faint">お知らせ</span>
        <span className="h-px flex-1 bg-border-subtle" />
      </div>

      {notices.length === 0 ? (
        <p className="px-0.5 py-2 text-[11.5px] text-text-muted">新しいお知らせはありません</p>
      ) : (
        <div className="divide-y divide-border-subtle">
          {notices.map((n) => (
            <Link
              key={n.id}
              href="/mypage/announcements"
              className="flex items-start gap-2 py-2 first:pt-0"
            >
              <span
                className={`mt-[7px] h-[7px] w-[7px] flex-none rounded-full ${
                  n.isRead ? 'bg-transparent' : 'bg-info'
                }`}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-[12.5px] leading-snug ${
                    n.isRead ? 'font-medium text-text-body' : 'font-semibold text-text-heading'
                  }`}
                >
                  {n.title}
                </span>
                <span className="block text-[11px] tabular-nums text-text-muted">
                  {formatMD(n.createdAt)}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </DashCard>
  );
}

// ============================================================
// 2) 次の授業（ヒーロー）
// ============================================================

function ScheduleCard({ child }: { child: DashboardChild }) {
  const { hero } = child;
  return (
    <DashCard footerLabel="予定をすべて見る" footerHref="/mypage/schedule">
      <SectionHead icon={<CalendarDays className="h-full w-full" />} label="次の授業" />

      {hero == null ? (
        <EmptySection
          primary="直近の授業予定はありません"
          secondary="予定が組まれるとここに表示されます"
        />
      ) : (
        <>
          <div className="mb-0.5 flex flex-wrap items-center gap-2">
            {hero.isToday && <Badge tone="primary">今日</Badge>}
            <span className="text-[13px] font-bold text-text-heading">
              {formatMDWeekday(hero.entryDate)}
            </span>
            {hero.isTransfer && <Badge tone="ink">振替</Badge>}
            {hero.isCancelled && <Badge tone="primary">休講</Badge>}
          </div>
          <div
            className={`text-[26px] font-bold leading-[1.3] tracking-[0.01em] tabular-nums ${
              hero.isCancelled ? 'text-text-faint line-through' : 'text-text-heading'
            }`}
          >
            {hero.startTime ?? '—'}
            <span className="mx-0.5 font-normal text-text-faint">〜</span>
            {hero.endTime ?? '—'}
          </div>
          <div className="mt-px truncate text-[13px] text-text-body">
            {hero.subjectNames.join('・') || '授業'}
          </div>
        </>
      )}
    </DashCard>
  );
}

// ============================================================
// 3) 授業報告書
// ============================================================

function ReportsCard({ child }: { child: DashboardChild }) {
  const { reports } = child;
  const latest = reports.latest;
  const hasTestChip =
    latest != null &&
    latest.checkTestScore != null &&
    latest.checkTestTotal != null &&
    latest.checkTestPassed != null;

  return (
    <DashCard footerLabel="報告書をすべて見る" footerHref="/mypage/reports">
      <SectionHead
        icon={<FileText className="h-full w-full" />}
        label="授業報告書"
        count={reports.unreadCount}
      />

      {latest == null ? (
        <EmptySection
          primary="まだ報告書はありません"
          secondary="授業の報告書が届くとここに表示されます"
        />
      ) : (
        <Link
          href={`/mypage/reports/${latest.id}`}
          className={`block rounded-[10px] border border-border-subtle px-3 py-2.5 ${
            latest.isUnread ? 'border-l-4 border-l-primary pl-[9px]' : ''
          }`}
        >
          <div className="mb-[3px] flex flex-wrap items-center gap-[7px]">
            {latest.isUnread && <Badge tone="new">新着</Badge>}
            <span className="text-[12.5px] font-bold tabular-nums text-text-heading">
              {formatMDWeekday(latest.lessonDate)}
            </span>
            <span className="truncate text-[12px] text-text-muted">
              {latest.subjectNames.join('・')}
            </span>
          </div>
          {hasTestChip && (
            <div className="mt-[7px] flex flex-wrap gap-[5px]">
              <Badge tone={latest.checkTestPassed ? 'success' : 'warning'}>
                確認テスト {latest.checkTestScore}/{latest.checkTestTotal} ・{' '}
                {latest.checkTestPassed ? '合格' : '再テスト'}
              </Badge>
            </div>
          )}
        </Link>
      )}
    </DashCard>
  );
}

// ============================================================
// 4) お申し込み
// ============================================================

function AppliesCard({ child }: { child: DashboardChild }) {
  const { applies } = child;
  const hasAnything = applies.pushes.length > 0;

  return (
    <DashCard footerLabel="申し込み・手続きへ" footerHref="/mypage/forms">
      <SectionHead
        icon={<ClipboardList className="h-full w-full" />}
        label="お申し込み"
        count={applies.pushes.length}
      />

      {!hasAnything ? (
        <EmptySection primary="いまお申し込みいただくものはありません" />
      ) : (
        <div className="flex flex-col gap-2">
          {applies.pushes.map((p) => (
            <div
              key={`push-${p.formType}-${p.periodKey}`}
              className="rounded-xl border-[1.5px] border-primary px-3 py-2.5"
            >
              <p className="mb-[3px] text-[13.5px] font-bold text-text-heading">{p.title}</p>
              <p className="text-[12px] text-text-muted">{p.reason}</p>
              <a
                href={p.href}
                className="mt-2 flex w-full items-center justify-center gap-[5px] rounded-[9px] bg-ink py-2 text-[13px] font-bold text-surface-raised transition-opacity hover:opacity-90"
              >
                申し込みへ進む
                <ExternalLink className="h-[14px] w-[14px]" />
              </a>
            </div>
          ))}
        </div>
      )}
    </DashCard>
  );
}

// ============================================================
// 5) 成績への導線（静かなリンク行）
// ============================================================
//   ★ カード化（DashCard）しない理由: このダッシュボードは直前に大幅簡素化した
//     ばかり（feature/dashboard-simplify）で、成績のためにまたカードを1枚増やすと
//     「情報量を削ってメリハリを付ける」という方針に逆行する。まずはデモで
//     実際の使われ方・見せ方を確認してから、カード化するかどうかを判断する
//     （保留・意図的な最小導線）。見た目は他カードのフッターリンクと同じトーンに揃える。
function GradesLink() {
  return (
    <Link
      href="/mypage/grades"
      className="flex items-center justify-between rounded-xl border border-border-subtle bg-surface-raised px-3.5 py-3 text-[12.5px] font-semibold text-ink transition-colors hover:bg-surface-hover"
    >
      <span className="flex items-center gap-1.5">
        <BarChart3 className="h-3.5 w-3.5 text-text-muted" />
        成績（テスト・通知表）
      </span>
      <ChevronRight className="h-[15px] w-[15px]" />
    </Link>
  );
}
