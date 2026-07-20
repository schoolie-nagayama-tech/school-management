'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BarChart3, Bell, CalendarDays, ClipboardList, FileText } from 'lucide-react';
import { LogoutButton } from './LogoutButton';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';
import type { DashboardChild, DashboardNotice } from '@/types/mypage-dashboard';

/**
 * 保護者ポータル /mypage トップ（ダッシュボード）。
 *
 * 正典: docs/portal-v2-requirements.md、承認済みモック（scratchpad/portal-dashboard-mock.html）。
 *
 * 並び（モック準拠・変えないこと）:
 *   教室からの連絡（最上部）→ 次の授業（ヒーロー）→ 授業報告書 → お申し込み → 成績。
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
 *
 * ★ タイポグラフィは3段階だけに絞る（2026-07-20 フィードバック「文字サイズは3種類くらいに」）:
 *   - 見出し … text-base（ページ名）
 *   - 本文  … text-sm（各カードの主役の一行・リンク）
 *   - 補足  … text-xs（ラベル・日付・副文）
 *   例外はヒーローの時刻（text-[26px]）が1箇所と、バッジ/ピル類の text-[11px] のみ。
 *   新しい要素を足すときも原則この3段階から選ぶ。
 *
 * ★ アイコンは「1セクションに1つまで」（同フィードバック「絵文字が多い」）:
 *   各カードの見出しに置く1つ（Bell / CalendarDays / FileText / ClipboardList / BarChart3）
 *   だけにする。本文中の飾りアイコンやフッターの矢印（ChevronRight）は置かない。
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
        <span className="flex-shrink-0 text-xs font-bold tracking-wide text-text-muted">
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
                    className={`inline-flex flex-shrink-0 items-baseline gap-1 whitespace-nowrap rounded-full border px-2.5 py-[3px] text-xs font-semibold transition-colors ${
                      isActive
                        ? 'border-text-heading bg-text-heading text-surface-raised'
                        : 'border-border bg-surface-raised text-text-body hover:bg-surface-hover'
                    }`}
                  >
                    {s.name}
                    {s.grade != null && (
                      <span
                        className={`text-[11px] font-medium ${
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
      <h1 className="mb-4 text-base font-bold text-text-heading">{displayName}</h1>

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

/**
 * カード（角丸・枠線・末尾に「すべて見る」フッター）。フッターは空状態でも常に出す。
 * ★ フッターに矢印アイコンは置かない（1セクション1アイコンの方針）。青字＋下線帯で
 *   リンクだと分かる。
 */
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
        className="block border-t border-border-subtle px-3.5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-surface-hover"
      >
        {footerLabel}
      </Link>
    </div>
  );
}

/** セクション見出し（アイコン＋ラベル＋件数バッジ）。カード唯一のアイコン。 */
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
      <span className="text-xs font-bold tracking-wide text-text-muted">{label}</span>
      {count != null && count > 0 && <CountBadge count={count} />}
    </div>
  );
}

/** 件数バッジ（未読数・プッシュ件数など、注意を引きたい数だけに使う＝primary）。 */
function CountBadge({ count }: { count: number }) {
  return (
    <span className="ml-0.5 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-primary px-[5px] text-[11px] font-bold leading-none text-text-on-primary">
      {count}
    </span>
  );
}

/** 静かな空状態（各セクション共通）。 */
function EmptySection({ primary, secondary }: { primary: string; secondary?: string }) {
  return (
    <div className="px-1 py-3.5 text-center">
      <p className="text-sm text-text-muted">{primary}</p>
      {secondary && <p className="mt-0.5 text-xs text-text-faint">{secondary}</p>}
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
      className={`inline-flex flex-shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-bold leading-normal ${cls[tone]}`}
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

      {/* チャット行。飾りアイコンは置かず、文言と未読バッジ（見出し）で状態を伝える。 */}
      {chat.unreadCount > 0 ? (
        <Link href="/mypage/chat" className="block py-2">
          <span className="block text-sm font-semibold text-text-heading">
            教室から返信が届いています
          </span>
        </Link>
      ) : (
        <Link href="/mypage/chat" className="block py-2">
          <span className="block text-sm font-semibold text-text-heading">教室との連絡</span>
          <span className="block text-xs text-text-muted">新しい返信はありません</span>
        </Link>
      )}

      <div className="mb-1 mt-2 flex items-center gap-1.5">
        <span className="text-xs font-bold tracking-wide text-text-faint">お知らせ</span>
        <span className="h-px flex-1 bg-border-subtle" />
      </div>

      {notices.length === 0 ? (
        <p className="px-0.5 py-2 text-xs text-text-muted">新しいお知らせはありません</p>
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
                  className={`block text-sm leading-snug ${
                    n.isRead ? 'font-medium text-text-body' : 'font-semibold text-text-heading'
                  }`}
                >
                  {n.title}
                </span>
                <span className="block text-xs tabular-nums text-text-muted">
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
            <span className="text-sm font-bold text-text-heading">
              {formatMDWeekday(hero.entryDate)}
            </span>
            {hero.isTransfer && <Badge tone="ink">振替</Badge>}
            {hero.isCancelled && <Badge tone="primary">休講</Badge>}
          </div>
          {/* ★ ダッシュボード唯一のヒーロー数字（大きな1要素）。ここだけ text-[26px]。 */}
          <div
            className={`text-[26px] font-bold leading-[1.3] tracking-[0.01em] tabular-nums ${
              hero.isCancelled ? 'text-text-faint line-through' : 'text-text-heading'
            }`}
          >
            {hero.startTime ?? '—'}
            <span className="mx-0.5 font-normal text-text-faint">〜</span>
            {hero.endTime ?? '—'}
          </div>
          <div className="mt-px truncate text-sm text-text-body">
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
            <span className="text-sm font-bold tabular-nums text-text-heading">
              {formatMDWeekday(latest.lessonDate)}
            </span>
            <span className="truncate text-xs text-text-muted">
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
              <p className="mb-[3px] text-sm font-bold text-text-heading">{p.title}</p>
              <p className="text-xs text-text-muted">{p.reason}</p>
              {/* CTA。飾りアイコン（外部リンク矢印）は置かない（1セクション1アイコン）。 */}
              <a
                href={p.href}
                className="mt-2 flex w-full items-center justify-center rounded-[9px] bg-ink py-2 text-sm font-bold text-surface-raised transition-opacity hover:opacity-90"
              >
                申し込みへ進む
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
//     （保留・意図的な最小導線）。BarChart3 がこの行の唯一のアイコン。
function GradesLink() {
  return (
    <Link
      href="/mypage/grades"
      className="flex items-center gap-1.5 rounded-xl border border-border-subtle bg-surface-raised px-3.5 py-3 text-sm font-semibold text-ink transition-colors hover:bg-surface-hover"
    >
      <BarChart3 className="h-3.5 w-3.5 text-text-muted" />
      成績（テスト・通知表）
    </Link>
  );
}
