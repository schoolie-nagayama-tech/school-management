'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  MessageCircle,
  Ban,
  KeyRound,
  Clock,
  XCircle,
  Users,
  Search,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { AdminLayout } from '@/components/layouts';
import { Loading, ToastContainer } from '@/components/ui';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { useLocalSchoolId } from '@/hooks/useLocalSchoolId';
import { useToast } from '@/hooks/useToast';
import { isManagerOrAbove, isSystemAdmin } from '@/lib/utils/roles';
import { fetchWithAuth } from '@/lib/api/auth';

/**
 * LINE連携状況（設定 → LINE連携状況）。教室長（manager）以上・自教室スコープ。
 *
 * 2つの向きを切り替えて見る:
 *   - 生徒別 … 在籍生徒ぜんぶに対して「保護者にLINE通知が届くか」。★未招待の生徒も行に出る。
 *   - アカウント別 … 「この保護者は何人のお子さまを見ているか」。問い合わせの電話を受けたとき用。
 *
 * ★ 既存の /settings/portal-accounts（admin限定・全校横断・アカウント削除まで可能）との違い:
 *   あちらはアカウント起点の棚卸し画面で、未登録の生徒は行として現れない。
 *   こちらは教室長が自分の教室を回すための画面で、削除は持たない（誤操作の影響が大きいため）。
 *   紐づけ0件の残骸アカウントは教室に属さないのでこの画面には出ない＝掃除は admin の仕事。
 */

type LineLinkStatus = 'linked' | 'blocked' | 'idpw' | 'invited' | 'expired' | 'none' | 'excluded';

interface StudentRow {
  student_id: string;
  student_name: string;
  grade: number | null;
  is_test: boolean;
  status: LineLinkStatus;
  linked_count: number;
  accounts: Array<{
    account_id: string;
    display_name: string;
    relation: string;
    relation_note: string | null;
    has_line: boolean;
    line_followed: boolean | null;
    last_login_at: string | null;
  }>;
  invite_expires_at: string | null;
  last_login_at: string | null;
  last_log: { kind: string; status: string; created_at: string } | null;
}

/**
 * 今月のLINE送信実績（全校横断）。APIはアドミンにだけ返す。
 * 課金対象は sent_messages だけで、dry_run は「送信オフのため送っていない」件数。
 */
interface LineUsage {
  month: string;
  sent_messages: number;
  sent_events: number;
  dry_run_events: number;
}

interface AccountRow {
  account_id: string;
  display_name: string;
  login_id: string | null;
  has_line: boolean;
  line_followed: boolean | null;
  line_follow_updated_at: string | null;
  last_login_at: string | null;
  created_at: string;
  linked_count: number;
  students: Array<{
    student_id: string;
    student_name: string;
    grade: number | null;
    relation: string;
    relation_note: string | null;
    linked_at: string;
  }>;
}

/** 状態の表示定義。絞り込みチップとバッジで同じ定義を使う。 */
const STATUS_META: Record<
  LineLinkStatus,
  { label: string; className: string; dot: string; description: string }
> = {
  linked: {
    label: '連携済み',
    className: 'bg-success-subtle text-success border-success/30',
    dot: 'bg-success',
    description: 'LINE通知が届く',
  },
  blocked: {
    label: 'ブロック中',
    className: 'bg-danger-subtle text-danger border-danger/30',
    dot: 'bg-danger',
    description: 'ブロック・友だち解除で届かない',
  },
  idpw: {
    label: 'ID・PWのみ',
    className: 'bg-info-subtle text-info border-info/30',
    dot: 'bg-info',
    description: 'ポータル画面のみ。LINEには届かない',
  },
  invited: {
    label: '招待中',
    className: 'bg-warning-subtle text-warning border-warning/40',
    dot: 'bg-warning',
    description: '受諾待ち',
  },
  expired: {
    label: '期限切れ',
    className: 'bg-danger-subtle text-danger border-danger/30',
    dot: 'bg-danger',
    description: '招待が受諾されないまま失効',
  },
  none: {
    label: '未招待',
    className: 'bg-surface-hover text-text-muted border-border',
    dot: 'bg-border-strong',
    description: 'まだ招待していない',
  },
  excluded: {
    label: '送信対象外',
    className: 'bg-surface-hover text-text-faint border-border-subtle',
    dot: 'bg-border-strong',
    description: '研修用テスト生徒・デモ教室',
  },
};

/** チップの並び順（左から潰していく順序）。 */
const STATUS_ORDER: LineLinkStatus[] = [
  'linked',
  'blocked',
  'idpw',
  'invited',
  'expired',
  'none',
  'excluded',
];

/** 通知種別の日本語ラベル（PortalInviteSection と揃える）。 */
const LOG_KIND_LABELS: Record<string, string> = {
  report_published: '報告書公開',
  chat_new_message: 'チャット返信',
  announcement: 'お知らせ',
  system_message: '予定のお知らせ',
};

function gradeLabel(grade: number | null): string {
  if (grade == null) return '';
  if (grade <= 6) return `小${grade}`;
  if (grade <= 9) return `中${grade - 6}`;
  return `高${grade - 9}`;
}

function shortDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 招待の残り日数（切り上げ）。期限切れは負にならないよう 0 で止める。 */
function daysLeft(iso: string | null): number {
  if (!iso) return 0;
  const diff = Date.parse(iso) - Date.now();
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

function relationLabel(relation: string, note: string | null): string {
  if (relation === 'self') return '本人';
  if (relation === 'guardian') return '保護者';
  return note?.trim() || 'その他';
}

export default function LineStatusPage() {
  const { profile, isLoading: authLoading } = useAuth();
  const { localSchoolId, availableSchools, setLocalSchoolId } = useLocalSchoolId();
  const { toasts, removeToast, error: toastError } = useToast();

  const [view, setView] = useState<'students' | 'accounts'>('students');
  const [studentRows, setStudentRows] = useState<StudentRow[]>([]);
  const [accountRows, setAccountRows] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<LineLinkStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  // 今月のLINE送信実績（全校・コスト管理用）。APIがアドミンにだけ返す。
  const [lineUsage, setLineUsage] = useState<LineUsage | null>(null);

  const canView = isManagerOrAbove(profile?.role);
  const isAdmin = isSystemAdmin(profile?.role);

  const load = useCallback(async () => {
    if (!localSchoolId || localSchoolId === 'all') return;
    setLoading(true);
    try {
      const res = await fetchWithAuth(
        `/api/admin/line-status?school_id=${encodeURIComponent(localSchoolId)}&view=${view}`
      );
      const json = await res.json();
      if (!res.ok) {
        toastError(json.error ?? '取得に失敗しました');
        setStudentRows([]);
        setAccountRows([]);
        return;
      }
      if (view === 'students') {
        setStudentRows(json.rows ?? []);
        // アドミン以外には null が返る（＝カードを出さない）。
        setLineUsage(json.line_usage ?? null);
      } else {
        setAccountRows(json.rows ?? []);
      }
    } catch (e) {
      console.error('[line-status] 取得に失敗:', e);
      toastError('取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [localSchoolId, view, toastError]);

  useEffect(() => {
    if (canView) void load();
  }, [canView, load]);

  /** 状態ごとの件数（チップに出す）。 */
  const counts = useMemo(() => {
    const map = new Map<LineLinkStatus, number>();
    for (const r of studentRows) map.set(r.status, (map.get(r.status) ?? 0) + 1);
    return map;
  }, [studentRows]);

  /** KPI。分母は「送信対象外を除いた在籍生徒」＝実際に連携させたい母数。 */
  const kpi = useMemo(() => {
    const target = studentRows.filter((r) => r.status !== 'excluded');
    const reachable = target.filter((r) => r.status === 'linked').length;
    const needsAction = target.filter(
      (r) => r.status === 'blocked' || r.status === 'expired'
    ).length;
    const notInvited = target.filter((r) => r.status === 'none').length;
    const linkedAccounts = studentRows.reduce((sum, r) => sum + r.linked_count, 0);
    return {
      total: target.length,
      reachable,
      rate: target.length > 0 ? Math.round((reachable / target.length) * 100) : 0,
      needsAction,
      notInvited,
      linkedAccounts,
    };
  }, [studentRows]);

  const filteredStudents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return studentRows.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!needle) return true;
      if (r.student_name.toLowerCase().includes(needle)) return true;
      return r.accounts.some((a) => a.display_name.toLowerCase().includes(needle));
    });
  }, [studentRows, statusFilter, query]);

  const filteredAccounts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return accountRows;
    return accountRows.filter(
      (r) =>
        r.display_name.toLowerCase().includes(needle) ||
        r.students.some((s) => s.student_name.toLowerCase().includes(needle))
    );
  }, [accountRows, query]);

  if (authLoading) {
    return (
      <AdminLayout headerTitle="LINE連携状況">
        <Loading />
      </AdminLayout>
    );
  }

  if (!canView) {
    return (
      <AdminLayout headerTitle="LINE連携状況">
        <AccessDenied message="このページは教室長以上のみアクセスできます" />
      </AdminLayout>
    );
  }

  /** アカウント1件のLINE状態バッジ（生徒別・アカウント別で共用）。 */
  const lineBadge = (hasLine: boolean, followed: boolean | null) => {
    if (!hasLine) {
      return (
        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-info-subtle px-1.5 py-0.5 text-[10px] font-medium text-info">
          <KeyRound className="h-3 w-3" />
          ID・PW
        </span>
      );
    }
    if (followed === false) {
      return (
        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-danger-subtle px-1.5 py-0.5 text-[10px] font-medium text-danger">
          <Ban className="h-3 w-3" />
          ブロック
        </span>
      );
    }
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded bg-success-subtle px-1.5 py-0.5 text-[10px] font-medium text-success">
        <MessageCircle className="h-3 w-3" />
        LINE
      </span>
    );
  };

  /** 紐づけ人数のピル。0名はグレーに沈めて「見られる人がいない」と分かるようにする。 */
  const countPill = (n: number) => (
    <span
      className={`inline-flex items-baseline gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${
        n > 0 ? 'bg-ink-subtle text-ink' : 'bg-surface-hover text-text-faint'
      }`}
    >
      <span className="text-xs">{n}</span>名
    </span>
  );

  return (
    <AdminLayout headerTitle="LINE連携状況">
      <div className="space-y-4">
        <div>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-heading"
          >
            <ChevronLeft className="h-4 w-4" />
            設定に戻る
          </Link>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-bold text-text-heading">
              <MessageCircle className="h-5 w-5" />
              LINE連携状況
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
              保護者にLINE通知が届く状態か、誰が何名紐づいているかを確認できます。
              <span className="inline-flex items-center gap-1 rounded-full bg-ink-subtle px-2 py-0.5 text-[11px] font-medium text-ink">
                <ShieldCheck className="h-3 w-3" />
                教室長は自教室のみ
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* 生徒別 / アカウント別 */}
            <div className="inline-flex gap-0.5 rounded-lg border border-border-subtle bg-surface-hover p-0.5">
              {(
                [
                  { key: 'students', label: '生徒別' },
                  { key: 'accounts', label: 'アカウント別' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setView(opt.key)}
                  className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                    view === opt.key
                      ? 'bg-surface font-bold text-text-heading shadow-sm'
                      : 'text-text-muted hover:text-text-heading'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {availableSchools.length > 1 && (
              <select
                value={localSchoolId}
                onChange={(e) => setLocalSchoolId(e.target.value)}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text-body"
              >
                {availableSchools.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text-body transition-colors hover:bg-surface-hover"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              更新
            </button>
          </div>
        </div>

        {/* KPI（生徒別のときだけ。アカウント別は母数の意味が違うので出さない） */}
        {view === 'students' && (
          <div
            className={`grid grid-cols-2 gap-3 ${
              isAdmin && lineUsage ? 'md:grid-cols-3 xl:grid-cols-5' : 'md:grid-cols-4'
            }`}
          >
            <div className="rounded-xl border border-border-subtle border-t-[3px] border-t-success bg-surface-raised p-3.5">
              <p className="text-[11px] font-medium text-text-muted">通知が届く</p>
              <p className="text-2xl font-bold tabular-nums text-text-heading">
                {kpi.reachable}
                <span className="ml-1 text-sm font-medium text-text-muted">名</span>
              </p>
              <p className="text-[11px] text-text-faint">
                対象{kpi.total}名の{kpi.rate}%
              </p>
            </div>
            <div className="rounded-xl border border-border-subtle border-t-[3px] border-t-danger bg-surface-raised p-3.5">
              <p className="text-[11px] font-medium text-text-muted">要対応</p>
              <p className="text-2xl font-bold tabular-nums text-text-heading">
                {kpi.needsAction}
                <span className="ml-1 text-sm font-medium text-text-muted">名</span>
              </p>
              <p className="text-[11px] text-text-faint">
                ブロック{counts.get('blocked') ?? 0}・期限切れ{counts.get('expired') ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-border-subtle border-t-[3px] border-t-warning bg-surface-raised p-3.5">
              <p className="text-[11px] font-medium text-text-muted">未招待</p>
              <p className="text-2xl font-bold tabular-nums text-text-heading">
                {kpi.notInvited}
                <span className="ml-1 text-sm font-medium text-text-muted">名</span>
              </p>
              <p className="text-[11px] text-text-faint">生徒詳細から招待できます</p>
            </div>
            <div className="rounded-xl border border-border-subtle border-t-[3px] border-t-border-strong bg-surface-raised p-3.5">
              <p className="text-[11px] font-medium text-text-muted">紐づけ済みアカウント</p>
              <p className="text-2xl font-bold tabular-nums text-text-heading">
                {kpi.linkedAccounts}
                <span className="ml-1 text-sm font-medium text-text-muted">名</span>
              </p>
              <p className="text-[11px] text-text-faint">兄弟がいると1人で複数の生徒を見ます</p>
            </div>

            {/* ★ 送信通数はアドミンだけ。教室ではなく LINE アカウント全体（＝全校）の数字で、
                プラン判断のための実測値。APIも isSystemAdmin のときしか返さない。 */}
            {isAdmin && lineUsage && (
              <div className="rounded-xl border border-border-subtle border-t-[3px] border-t-info bg-surface-raised p-3.5">
                <p className="text-[11px] font-medium text-text-muted">
                  今月のLINE送信
                  <span className="ml-1 text-text-faint">全校</span>
                </p>
                <p className="text-2xl font-bold tabular-nums text-text-heading">
                  {lineUsage.sent_messages}
                  <span className="ml-1 text-sm font-medium text-text-muted">通</span>
                </p>
                <p className="text-[11px] text-text-faint">
                  {lineUsage.dry_run_events > 0
                    ? // 送信オフ（LINE_PUSH_ENABLED 未設定）の間は実送信ゼロで dry_run が積まれる。
                      // 「0通なのにログはある」を誤解させないよう、その件数も添える。
                      `送信オフで見送り${lineUsage.dry_run_events}件／${lineUsage.month}`
                    : `${lineUsage.sent_events}回の配信／${lineUsage.month}`}
                </p>
              </div>
            )}
          </div>
        )}

        {/* 絞り込み */}
        <div className="flex flex-wrap items-center gap-2">
          {view === 'students' && (
            <>
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  statusFilter === 'all'
                    ? 'border-ink bg-ink text-text-on-primary'
                    : 'border-border bg-surface text-text-body hover:bg-surface-hover'
                }`}
              >
                すべて <span className="tabular-nums font-bold">{studentRows.length}</span>
              </button>
              {STATUS_ORDER.map((key) => {
                const n = counts.get(key) ?? 0;
                if (n === 0) return null;
                const meta = STATUS_META[key];
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setStatusFilter(key)}
                    title={meta.description}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      statusFilter === key
                        ? 'border-ink bg-ink text-text-on-primary'
                        : 'border-border bg-surface text-text-body hover:bg-surface-hover'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                    {meta.label} <span className="tabular-nums font-bold">{n}</span>
                  </button>
                );
              })}
            </>
          )}

          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                view === 'students' ? '生徒名・保護者名で検索' : '保護者名・生徒名で検索'
              }
              className="w-56 rounded-lg border border-border bg-surface py-1.5 pl-8 pr-3 text-xs text-text-body placeholder:text-text-faint"
            />
          </div>
        </div>

        {loading ? (
          <Loading />
        ) : view === 'students' ? (
          <StudentTable rows={filteredStudents} lineBadge={lineBadge} countPill={countPill} />
        ) : (
          <AccountTable rows={filteredAccounts} lineBadge={lineBadge} countPill={countPill} />
        )}
      </div>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}

/** 生徒別の表。未招待の生徒も行として並ぶのがこの表の役割。 */
function StudentTable({
  rows,
  lineBadge,
  countPill,
}: {
  rows: StudentRow[];
  lineBadge: (hasLine: boolean, followed: boolean | null) => React.ReactNode;
  countPill: (n: number) => React.ReactNode;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-border-subtle bg-surface-raised p-8 text-center text-sm text-text-muted">
        該当する生徒がいません。
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-raised">
      <table className="w-full min-w-[900px] border-collapse">
        <thead>
          <tr className="bg-surface-hover">
            <th className="px-3.5 py-2.5 text-left text-[11px] font-bold text-text-muted">生徒</th>
            <th className="px-3.5 py-2.5 text-left text-[11px] font-bold text-text-muted">状態</th>
            <th className="px-3.5 py-2.5 text-left text-[11px] font-bold text-text-muted">
              紐づけ
            </th>
            <th className="px-3.5 py-2.5 text-left text-[11px] font-bold text-text-muted">
              紐づいているアカウント
            </th>
            <th className="px-3.5 py-2.5 text-left text-[11px] font-bold text-text-muted">
              最終ログイン
            </th>
            <th className="px-3.5 py-2.5 text-left text-[11px] font-bold text-text-muted">
              直近の通知
            </th>
            <th className="px-3.5 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const meta = STATUS_META[r.status];
            const needsAction = r.status === 'blocked' || r.status === 'expired';
            return (
              <tr
                key={r.student_id}
                className={`border-t border-border-subtle ${needsAction ? 'bg-danger-subtle/40' : ''}`}
              >
                <td className="px-3.5 py-2.5">
                  <div className="font-medium text-text-heading">{r.student_name}</div>
                  <div className="text-[11px] text-text-faint">
                    {gradeLabel(r.grade)}
                    {r.is_test && '・研修用'}
                  </div>
                </td>
                <td className="px-3.5 py-2.5">
                  <span
                    className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.className}`}
                  >
                    {r.status === 'blocked' && <Ban className="h-3 w-3" />}
                    {r.status === 'expired' && <XCircle className="h-3 w-3" />}
                    {r.status === 'invited' && <Clock className="h-3 w-3" />}
                    {meta.label}
                    {r.status === 'invited' && r.invite_expires_at
                      ? ` 残${daysLeft(r.invite_expires_at)}日`
                      : ''}
                    {r.status === 'expired' && r.invite_expires_at
                      ? ` ${shortDate(r.invite_expires_at)}`
                      : ''}
                  </span>
                </td>
                <td className="px-3.5 py-2.5">{countPill(r.linked_count)}</td>
                <td className="px-3.5 py-2.5">
                  {r.accounts.length === 0 ? (
                    <span className="text-xs text-text-faint">
                      {r.status === 'invited' || r.status === 'expired' ? '受諾待ち' : '—'}
                    </span>
                  ) : (
                    <div className="space-y-0.5">
                      {r.accounts.map((a) => (
                        <div key={a.account_id} className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs text-text-body">{a.display_name}</span>
                          <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-text-muted">
                            {relationLabel(a.relation, a.relation_note)}
                          </span>
                          {lineBadge(a.has_line, a.line_followed)}
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                <td className="whitespace-nowrap px-3.5 py-2.5 text-xs tabular-nums text-text-muted">
                  {shortDateTime(r.last_login_at)}
                </td>
                <td className="whitespace-nowrap px-3.5 py-2.5 text-xs tabular-nums text-text-muted">
                  {r.last_log ? (
                    <>
                      {LOG_KIND_LABELS[r.last_log.kind] ?? r.last_log.kind}{' '}
                      {shortDate(r.last_log.created_at)}
                    </>
                  ) : (
                    <span className="text-text-faint">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3.5 py-2.5 text-right">
                  {/* 招待の発行・紐づけの追加は生徒詳細の「保護者ポータル」から行う（導線を1本にする）。
                      ?detail= は生徒管理ページが持つ「詳細モーダルを自動で開く」パラメータ。 */}
                  <Link
                    href={`/students?detail=${encodeURIComponent(r.student_id)}`}
                    className="rounded border border-border px-2 py-1 text-[11px] font-medium text-text-body transition-colors hover:bg-surface-hover"
                  >
                    生徒詳細
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** アカウント別の表。電話を受けたときに名前で引く用途。 */
function AccountTable({
  rows,
  lineBadge,
  countPill,
}: {
  rows: AccountRow[];
  lineBadge: (hasLine: boolean, followed: boolean | null) => React.ReactNode;
  countPill: (n: number) => React.ReactNode;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-border-subtle bg-surface-raised p-8 text-center text-sm text-text-muted">
        この教室の生徒に紐づくアカウントはありません。
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-raised">
        <table className="w-full min-w-[820px] border-collapse">
          <thead>
            <tr className="bg-surface-hover">
              <th className="px-3.5 py-2.5 text-left text-[11px] font-bold text-text-muted">
                アカウント
              </th>
              <th className="px-3.5 py-2.5 text-left text-[11px] font-bold text-text-muted">
                ログイン方法
              </th>
              <th className="px-3.5 py-2.5 text-left text-[11px] font-bold text-text-muted">
                LINE
              </th>
              <th className="px-3.5 py-2.5 text-left text-[11px] font-bold text-text-muted">
                紐づく生徒
              </th>
              <th className="px-3.5 py-2.5 text-left text-[11px] font-bold text-text-muted">
                最終ログイン
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.account_id}
                className={`border-t border-border-subtle ${
                  r.has_line && r.line_followed === false ? 'bg-danger-subtle/40' : ''
                }`}
              >
                <td className="px-3.5 py-2.5">
                  <div className="font-medium text-text-heading">{r.display_name}</div>
                  <div className="text-[11px] tabular-nums text-text-faint">
                    {shortDate(r.created_at)} 登録
                  </div>
                </td>
                <td className="whitespace-nowrap px-3.5 py-2.5 text-xs text-text-muted">
                  {r.has_line ? 'LINEログイン' : `ID・PW（${r.login_id ?? '—'}）`}
                </td>
                <td className="px-3.5 py-2.5">
                  {lineBadge(r.has_line, r.line_followed)}
                  {r.has_line && r.line_followed === false && r.line_follow_updated_at && (
                    <span className="ml-1 text-[10px] tabular-nums text-text-faint">
                      {shortDate(r.line_follow_updated_at)}〜
                    </span>
                  )}
                </td>
                <td className="px-3.5 py-2.5">
                  <div className="flex items-center gap-1.5">
                    {countPill(r.linked_count)}
                    <Users className="h-3.5 w-3.5 text-text-faint" />
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {r.students.map((s) => (
                      <div key={s.student_id} className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-text-body">
                          {s.student_name}（{gradeLabel(s.grade)}）
                        </span>
                        <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-text-muted">
                          {relationLabel(s.relation, s.relation_note)}
                        </span>
                      </div>
                    ))}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3.5 py-2.5 text-xs tabular-nums text-text-muted">
                  {shortDateTime(r.last_login_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="rounded-lg border border-dashed border-border bg-surface p-3 text-[11px] leading-relaxed text-text-muted">
        表示名はLINEのプロフィール名がそのまま入るため、保護者の本名と一致しないことがあります。
        誰か分からない行は、紐づく生徒から辿ってください。
        兄弟が別教室にいる場合、ここには自教室のお子さまだけが表示されます。
      </p>
    </div>
  );
}
