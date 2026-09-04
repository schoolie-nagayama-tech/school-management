'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Copy,
  Ticket,
  Users,
  Link2Off,
  Loader2,
  Printer,
  Download,
  MessageCircle,
  Ban,
  KeyRound,
  CheckCircle2,
  AlertTriangle,
  Info,
  FolderOpen,
  UserPlus,
  Clock,
} from 'lucide-react';
import QRCode from 'qrcode';
import { useMasterData } from '@/contexts/MasterDataContext';
import { buildInviteHandoutHtml } from '@/lib/portal/inviteHandout';
import { Button, ToastContainer } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { fetchWithAuth } from '@/lib/api/auth';
import { isManagerOrAbove, isOwnerOrAbove } from '@/lib/utils/roles';
import { LinkExistingAccountDialog } from './LinkExistingAccountDialog';

/**
 * 生徒詳細モーダル・新規登録直後の導線から使う保護者ポータルのセクション。
 *
 * 4つの機能を持つ:
 *   1) 招待の発行（admin/owner のみ）— /api/admin/portal-invitations（requireAdmin）
 *   2) 登録済みアカウントの紐づけ解除（manager 以上）— /api/admin/students/[id]/portal-links
 *   3) LINE連携の状態確認（manager 以上）— 「通知が届くか」の結論・誰が何名紐づいているか・
 *      そのアカウントが見ている兄弟・直近の送信結果。問い合わせを受けたときに答える材料。
 *   4) 既存アカウントへの紐づけ追加（manager 以上）— 兄弟の2人目以降を招待なしで足す
 *      （LinkExistingAccountDialog）。
 *
 * ★ 権限の出し分け（セクション＝manager以上／招待発行＝owner以上）:
 *   - セクション全体の表示ゲートは isManagerOrAbove。教室長も「誤紐づけを解除する」ために
 *     このセクションを開ける必要があるため。解除APIは manager 以上＋自教室スコープで閉じている。
 *   - 招待発行ブロックだけは isOwnerOrAbove に絞る。招待発行API（portal-invitations）は
 *     requireAdmin（admin/owner のみ、manager 不可）のままで権限を変えていないので、
 *     manager に「押すと403になるボタン」を見せないため UI 側で条件表示する。
 *   招待発行を manager にも開放するときは、先に発行APIを requireManager＋自教室スコープへ
 *   変えてから、canInvite を isManagerOrAbove に広げること（両方同時に。工程表 P2-9）。
 */

const EXPIRES_IN_DAYS = 7;

/**
 * 生徒本人向け招待の発行UIを出すか（2026-08-05 は false）。
 *
 * 運用方針として当面は**全員を保護者として登録する**ため、選択肢自体を出さない
 * （選べると迷いが生まれ、誤って生徒本人で発行すると閲覧範囲が変わってしまう）。
 * API・DB・受諾画面は invite_type='student' を引き続きサポートしているので、
 * 生徒本人アカウントを配る運用を始めるときはこのフラグを true に戻すだけでよい。
 */
const STUDENT_INVITE_ENABLED = false;

interface InvitationRow {
  id: string;
  token: string;
  invite_type: string;
  expires_at: string;
  accepted_at: string | null;
}

/** GET /api/admin/students/[id]/portal-links の1要素（line_user_id の値は返らない）。 */
interface LinkedAccount {
  account_id: string;
  display_name: string;
  login_id: string | null;
  has_line: boolean;
  /** 友だち追加中か。LINE未連携なら null（既定値 true を「友だち」と誤読しないため）。 */
  line_followed: boolean | null;
  line_follow_updated_at: string | null;
  last_login_at: string | null;
  /** この生徒とこのアカウントを紐づけた日時。 */
  linked_at: string;
  relation: string;
  relation_note: string | null;
  /** このアカウントが見ている他の生徒＝兄弟（自教室の分だけ返る）。 */
  other_students: Array<{ student_id: string; student_name: string; grade: number | null }>;
}

/** 直近のLINE送信ログ1件（本文は保存していないので種別と結果だけ）。 */
interface RecentLog {
  id: string;
  kind: string;
  status: string;
  detail: string | null;
  recipient_count: number;
  created_at: string;
}

/**
 * 通知種別の日本語ラベル（lib/mypage/notify.ts の NotifyKind に対応）。
 * 振替日の確定は専用の種別を持たず system_message で流れるので、「予定のお知らせ」とまとめる。
 */
const LOG_KIND_LABELS: Record<string, string> = {
  report_published: '授業報告書の公開',
  chat_new_message: 'チャット返信',
  announcement: 'お知らせ',
  system_message: '予定のお知らせ',
};

/**
 * 送信ログの状態表示。
 *
 * ★ status の意味（migration 20260807000000 のコメントが正典）:
 *   sent=実送信 / dry_run=LINE_PUSH_ENABLED 未設定で送っていない /
 *   skipped=宛先ゼロ・ダミーデータ等で送らなかった / error=送信を試みて失敗。
 *   ブロック中の保護者は宛先解決の段階で外れるので error ではなく skipped になる。
 *   スタッフに見せる言葉は「届いた/届いていない」に寄せる。
 */
function logStatusLabel(status: string): { label: string; className: string } {
  switch (status) {
    case 'sent':
      return { label: '送信済', className: 'bg-success-subtle text-success' };
    case 'dry_run':
      return { label: '送信オフ', className: 'bg-surface-hover text-text-muted' };
    case 'skipped':
      return { label: '対象なし', className: 'bg-warning-subtle text-warning' };
    case 'error':
      return { label: '失敗', className: 'bg-danger-subtle text-danger' };
    default:
      return { label: status, className: 'bg-surface-hover text-text-muted' };
  }
}

/** 日時の短縮表示（M/D HH:mm）。一覧に並べたときに詰まらない粒度にする。 */
function shortDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

/** 日付だけの短縮表示（M/D）。 */
function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 学年の表示（1-6=小、7-9=中、10-12=高）。 */
function gradeLabel(grade: number | null): string {
  if (grade == null) return '';
  if (grade <= 6) return `小${grade}`;
  if (grade <= 9) return `中${grade - 6}`;
  return `高${grade - 9}`;
}

interface PortalInviteSectionProps {
  studentId: string;
  studentName: string;
}

/** relation コードを日本語ラベルへ（other は自由入力があればそれを優先）。 */
function relationLabel(relation: string, note: string | null): string {
  if (relation === 'self') return '本人';
  if (relation === 'guardian') return '保護者';
  return note?.trim() || 'その他';
}

export function PortalInviteSection({ studentId, studentName }: PortalInviteSectionProps) {
  const { profile, selectedSchoolId } = useAuth();
  const { schools } = useMasterData();
  // セクション自体は教室長（manager）以上に見せる。招待発行だけ owner 以上に絞る（下の canInvite）。
  const canView = isManagerOrAbove(profile?.role);
  const canInvite = isOwnerOrAbove(profile?.role);

  const { toasts, removeToast, success, error: toastError } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [inviteType, setInviteType] = useState<'guardian' | 'student'>('guardian');
  const [lastUrl, setLastUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  // 受諾URLのQRコード（PNG data URL）。URLが決まってから非同期で作る。
  const [qrDataUrl, setQrDataUrl] = useState('');

  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccount[]>([]);
  const [recentLogs, setRecentLogs] = useState<RecentLog[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);

  // その生徒宛の発行済み招待一覧を取得（一覧APIは既に student_id フィルタに対応済み）
  const loadInvitations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(
        `/api/admin/portal-invitations?student_id=${encodeURIComponent(studentId)}`
      );
      const json = await res.json();
      setInvitations(res.ok ? (json.invitations ?? []) : []);
    } catch (e) {
      console.error('[PortalInviteSection] 招待一覧の取得に失敗:', e);
      setInvitations([]);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  // その生徒に紐づく登録済みアカウント一覧を取得（manager 以上・自教室スコープはAPIで検証）
  const loadLinks = useCallback(async () => {
    setLoadingLinks(true);
    try {
      const res = await fetchWithAuth(
        `/api/admin/students/${encodeURIComponent(studentId)}/portal-links`
      );
      const json = await res.json();
      setLinkedAccounts(res.ok ? (json.accounts ?? []) : []);
      setRecentLogs(res.ok ? (json.recent_logs ?? []) : []);
    } catch (e) {
      console.error('[PortalInviteSection] 紐づけ一覧の取得に失敗:', e);
      setLinkedAccounts([]);
      setRecentLogs([]);
    } finally {
      setLoadingLinks(false);
    }
  }, [studentId]);

  useEffect(() => {
    if (!canView) return;
    // 招待発行UIを持つ owner 以上のときだけ招待一覧も取る（manager は解除のみ）。
    if (canInvite) void loadInvitations();
    void loadLinks();
  }, [canView, canInvite, loadInvitations, loadLinks]);

  // 受諾URLが決まったらQRを作る。紙に印刷しても読める余白と誤り訂正で出す。
  useEffect(() => {
    if (!lastUrl) {
      setQrDataUrl('');
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(lastUrl, { width: 512, margin: 2, errorCorrectionLevel: 'M' })
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch((e) => {
        console.error('[PortalInviteSection] QRの生成に失敗:', e);
        if (!cancelled) setQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [lastUrl]);

  // manager 未満には何も出さない（教師は不可）
  if (!canView) return null;

  const handleIssue = async () => {
    setIssuing(true);
    setErrorMessage('');
    setLastUrl('');
    try {
      const res = await fetchWithAuth('/api/admin/portal-invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: studentId, invite_type: inviteType }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMessage(json.error ?? '招待の発行に失敗しました');
        return;
      }
      setLastUrl(json.accept_url);
      await loadInvitations();
      // 発行後に受諾されると登録済みへ移るため、こちらも更新して即反映させる。
      await loadLinks();
    } catch (e) {
      console.error('[PortalInviteSection] 招待の発行に失敗:', e);
      setErrorMessage('通信に失敗しました');
    } finally {
      setIssuing(false);
    }
  };

  // 紐づけ解除（この生徒とこの保護者の閲覧権だけを切る。アカウント本体は消えない）。
  const handleUnlink = async (account: LinkedAccount) => {
    const ok = await confirm({
      title: '紐づけの解除',
      description: `${studentName} さんと「${account.display_name}」の紐づけを解除しますか？この保護者は以降 ${studentName} さんの情報を見られなくなります（アカウント自体は削除されません）。`,
      confirmLabel: '解除する',
      cancelLabel: 'キャンセル',
      variant: 'danger',
    });
    if (!ok) return;

    setUnlinkingId(account.account_id);
    try {
      const res = await fetchWithAuth(
        `/api/admin/students/${encodeURIComponent(studentId)}/portal-links`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account_id: account.account_id }),
        }
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toastError(json.error ?? '解除に失敗しました');
        return;
      }
      success('紐づけを解除しました');
      await loadLinks();
    } catch (e) {
      console.error('[PortalInviteSection] 紐づけ解除に失敗:', e);
      toastError('通信に失敗しました');
    } finally {
      setUnlinkingId(null);
    }
  };

  /** 有効期限の表示。招待は発行から EXPIRES_IN_DAYS 日で切れる。 */
  const expiresLabel = (() => {
    const d = new Date();
    d.setDate(d.getDate() + EXPIRES_IN_DAYS);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  })();

  /** QR画像をPNGで保存（LINEやメールで送るとき用）。 */
  const downloadQr = () => {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    // ファイル名に使えない文字を潰す（生徒名は自由入力）
    a.download = `mypage_invite_${studentName.replace(/[s/\:*?"<>|・（）]/g, '_')}.png`;
    a.click();
  };

  /**
   * 配布用のA4シートを別ウィンドウで開いて印刷する。
   * アプリ側で window.print() しないのは、このセクションが生徒詳細モーダルの中にあり、
   * モーダルの外側まで用紙に乗ってしまうため（詳細は lib/portal/inviteHandout.ts）。
   */
  const printHandout = () => {
    if (!lastUrl || !qrDataUrl) return;
    const schoolName =
      selectedSchoolId && selectedSchoolId !== 'all'
        ? (schools.find((sc) => sc.id === selectedSchoolId)?.name ?? '')
        : '';
    const html = buildInviteHandoutHtml({
      studentName,
      url: lastUrl,
      qrDataUrl,
      expiresLabel,
      schoolName,
      inviteType,
    });
    const w = window.open('', '_blank');
    if (!w) {
      setErrorMessage('印刷ページを開けませんでした。ブラウザのポップアップ許可をご確認ください');
      return;
    }
    w.document.write(html);
    w.document.close();
    // 画像（QR）の読み込みを待ってから印刷ダイアログを出す。待たないと白い枠だけ印刷される。
    w.onload = () => w.print();
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('[PortalInviteSection] コピーに失敗:', e);
      setErrorMessage('コピーに失敗しました');
    }
  };

  /**
   * 「この生徒の保護者にLINE通知が届くか」を1行に畳んだ結論。
   *
   * 面談中に開いて3秒で判断できることを狙う。判定は一覧API（/api/admin/line-status）の
   * STATUS_RANK と同じ考え方で、複数アカウントがあるときは一番良い状態を代表にする。
   */
  const verdict = (() => {
    if (loadingLinks) return null;
    if (linkedAccounts.length === 0) {
      return {
        tone: 'todo' as const,
        title: 'まだ登録されていません',
        description:
          '保護者アカウントが無いため、ポータルもLINE通知も使えません。招待を発行するか、兄弟の保護者アカウントに紐づけてください。',
      };
    }

    const reachable = linkedAccounts.filter((a) => a.has_line && a.line_followed !== false);
    const blocked = linkedAccounts.filter((a) => a.has_line && a.line_followed === false);

    if (reachable.length > 0) {
      const rest = linkedAccounts.length - reachable.length;
      return {
        tone: 'ok' as const,
        title: 'LINE通知が届きます',
        description:
          rest > 0
            ? `${linkedAccounts.length}名のうち${reachable.length}名のLINEに届きます。残りの方はポータル画面のみです。`
            : '授業報告書の公開・振替の確定・チャット返信がLINEに届きます。',
      };
    }

    if (blocked.length > 0) {
      const since = blocked[0].line_follow_updated_at;
      return {
        tone: 'ng' as const,
        title: 'LINE通知は届きません',
        description: `公式アカウントがブロック（または友だち解除）されています${
          since ? `（${shortDate(since)} に検知）` : ''
        }。ポータル画面へのログインは今までどおり使えます。`,
      };
    }

    return {
      tone: 'ng' as const,
      title: 'LINE通知は届きません',
      description:
        'ID・パスワードのみのアカウントです。ポータル画面は見られますが、LINEには届きません。LINEログインをご案内してください。',
    };
  })();

  const verdictStyle = {
    ok: { wrap: 'border-success/30 bg-success-subtle', title: 'text-success', Icon: CheckCircle2 },
    ng: { wrap: 'border-danger/30 bg-danger-subtle', title: 'text-danger', Icon: AlertTriangle },
    todo: { wrap: 'border-warning/40 bg-warning-subtle', title: 'text-warning', Icon: Info },
  } as const;

  /** アカウント1件のLINE状態バッジ。 */
  const accountBadge = (acc: LinkedAccount) => {
    if (!acc.has_line) {
      return (
        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-info-subtle px-1.5 py-0.5 text-[10px] font-medium text-info">
          <KeyRound className="h-3 w-3" />
          ID・PWのみ
        </span>
      );
    }
    if (acc.line_followed === false) {
      return (
        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-danger-subtle px-1.5 py-0.5 text-[10px] font-medium text-danger">
          <Ban className="h-3 w-3" />
          ブロック中
        </span>
      );
    }
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded bg-success-subtle px-1.5 py-0.5 text-[10px] font-medium text-success">
        <MessageCircle className="h-3 w-3" />
        友だち追加中
      </span>
    );
  };

  // 招待の状態ラベル（設定→ポータルアカウントと同じ判定基準）
  const statusOf = (inv: InvitationRow): { label: string; className: string } => {
    if (inv.accepted_at) return { label: '受諾済み', className: 'text-green-600' };
    if (new Date(inv.expires_at) < new Date())
      return { label: '期限切れ', className: 'text-red-500' };
    return { label: '未受諾', className: 'text-[#4b5563]' };
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-[#1f2937] mb-3 flex items-center gap-1.5">
        <Ticket className="w-4 h-4" />
        保護者ポータル
      </h3>
      <div className="p-3 bg-[#f8fafc] rounded-lg border border-[#e5e7eb] space-y-3">
        {/* ★ 結論を最初に出す: 「この保護者にLINE通知が届くのか」。
            その下に、誰が何名紐づいているか（兄弟含む）と直近の送信結果を置く。 */}
        {loadingLinks ? (
          <p className="text-xs text-[#9ca3af]">読み込み中...</p>
        ) : (
          verdict && (
            <div
              className={`flex items-start gap-2.5 rounded-lg border p-2.5 ${verdictStyle[verdict.tone].wrap}`}
            >
              {(() => {
                const Icon = verdictStyle[verdict.tone].Icon;
                return (
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${verdictStyle[verdict.tone].title}`} />
                );
              })()}
              <div className="min-w-0">
                <p className={`text-xs font-bold ${verdictStyle[verdict.tone].title}`}>
                  {verdict.title}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-[#4b5563]">
                  {verdict.description}
                </p>
              </div>
            </div>
          )
        )}

        {/* 登録済みアカウント（manager 以上で表示。紐づけの追加・解除の入口） */}
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <p className="flex items-center gap-1.5 text-xs font-medium text-[#4b5563]">
              <Users className="w-3.5 h-3.5" />
              この生徒を見られる人
            </p>
            <span
              className={`inline-flex items-baseline gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${
                linkedAccounts.length > 0 ? 'bg-ink-subtle text-ink' : 'bg-[#f1f5f9] text-[#9ca3af]'
              }`}
            >
              <span className="text-xs">{linkedAccounts.length}</span>名
            </span>
            <button
              type="button"
              onClick={() => setLinkDialogOpen(true)}
              className="ml-auto inline-flex shrink-0 items-center gap-1 rounded border border-[#e5e7eb] bg-white px-2 py-1 text-[11px] font-medium text-[#1f2937] transition-colors hover:bg-[#f1f5f9]"
            >
              <UserPlus className="h-3 w-3" />
              登録済みの保護者から選ぶ
            </button>
          </div>

          {loadingLinks ? (
            <p className="text-xs text-[#9ca3af]">読み込み中...</p>
          ) : linkedAccounts.length === 0 ? (
            <p className="text-xs text-[#6b7280]">このお子さまに紐づくアカウントはありません。</p>
          ) : (
            <div className="space-y-1.5">
              {linkedAccounts.map((acc) => (
                <div
                  key={acc.account_id}
                  className="rounded border border-[#e5e7eb] bg-white px-2 py-1.5 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[#1f2937] truncate">{acc.display_name}</span>
                    <span className="shrink-0 rounded bg-[#f1f5f9] px-1.5 py-0.5 text-[10px] text-[#4b5563]">
                      {relationLabel(acc.relation, acc.relation_note)}
                    </span>
                    {accountBadge(acc)}
                    <button
                      type="button"
                      onClick={() => handleUnlink(acc)}
                      disabled={unlinkingId === acc.account_id}
                      className="ml-auto inline-flex shrink-0 items-center gap-1 rounded border border-[#e5e7eb] px-2 py-1 text-[11px] font-medium text-[#dc2626] transition-colors hover:bg-red-50 disabled:opacity-50"
                    >
                      {unlinkingId === acc.account_id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Link2Off className="w-3 h-3" />
                      )}
                      解除
                    </button>
                  </div>

                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] tabular-nums text-[#9ca3af]">
                    <span>{acc.has_line ? 'LINEログイン' : `ID: ${acc.login_id ?? '—'}`}</span>
                    <span>紐づけ {shortDate(acc.linked_at)}</span>
                    <span>最終ログイン {shortDateTime(acc.last_login_at)}</span>
                  </div>

                  {/* ★ 兄弟の可視化: 問い合わせで「弟の分も見えていますか」に即答するための行。
                      他教室の兄弟はAPI側で落としているので、ここには自教室の子だけが出る。 */}
                  <div className="mt-1 flex items-start gap-1.5 rounded bg-[#f8fafc] px-2 py-1 text-[10px] text-[#6b7280]">
                    <FolderOpen className="mt-0.5 h-3 w-3 shrink-0 text-[#9ca3af]" />
                    {acc.other_students.length === 0 ? (
                      <span>この生徒だけに紐づいています</span>
                    ) : (
                      <span>
                        このアカウントは{' '}
                        <span className="font-medium text-[#4b5563]">
                          {acc.other_students
                            .map((s) => `${s.student_name}（${gradeLabel(s.grade)}）`)
                            .join('・')}
                        </span>{' '}
                        も見ています
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 直近の通知（line_message_logs をそのまま履歴として読む。本文は保存していない） */}
        {recentLogs.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[#4b5563]">
              <Clock className="w-3.5 h-3.5" />
              直近の通知
            </p>
            <div className="overflow-hidden rounded border border-[#e5e7eb] bg-white">
              {recentLogs.map((log) => {
                const st = logStatusLabel(log.status);
                return (
                  <div
                    key={log.id}
                    className="flex items-center gap-2 border-b border-[#f1f5f9] px-2 py-1.5 text-[11px] last:border-b-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-[#4b5563]">
                      {LOG_KIND_LABELS[log.kind] ?? log.kind}
                    </span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${st.className}`}
                    >
                      {st.label}
                    </span>
                    <span className="shrink-0 tabular-nums text-[#9ca3af]">
                      {shortDateTime(log.created_at)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 招待発行ブロック（owner 以上のみ。発行APIが admin/owner 限定のため） */}
        {canInvite && (
          <div className="space-y-3 border-t border-[#e5e7eb] pt-3">
            {/* 発行済み一覧 */}
            {loading ? (
              <p className="text-xs text-[#9ca3af]">読み込み中...</p>
            ) : invitations.length === 0 ? (
              <p className="text-xs text-[#6b7280]">まだ招待を発行していません。</p>
            ) : (
              <div className="space-y-1">
                {invitations.map((inv) => {
                  const st = statusOf(inv);
                  return (
                    <div key={inv.id} className="flex items-center justify-between text-xs gap-2">
                      <span className="text-[#4b5563] shrink-0">
                        {inv.invite_type === 'guardian' ? '保護者' : '生徒本人'}
                      </span>
                      <span className={`font-medium ${st.className}`}>{st.label}</span>
                      <span className="text-[#9ca3af] ml-auto">
                        期限 {new Date(inv.expires_at).toLocaleDateString('ja-JP')}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 招待タイプ選択 + 発行（生徒本人は当面非表示＝保護者固定） */}
            <div className="flex items-center gap-2 pt-2 border-t border-[#e5e7eb]">
              {STUDENT_INVITE_ENABLED ? (
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setInviteType('guardian')}
                    className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                      inviteType === 'guardian'
                        ? 'border-[#1e3a5f] bg-[#1e3a5f]/10 font-medium text-[#1e3a5f]'
                        : 'border-[#e5e7eb] text-[#4b5563] hover:bg-white'
                    }`}
                  >
                    保護者
                  </button>
                  <button
                    type="button"
                    onClick={() => setInviteType('student')}
                    className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                      inviteType === 'student'
                        ? 'border-[#1e3a5f] bg-[#1e3a5f]/10 font-medium text-[#1e3a5f]'
                        : 'border-[#e5e7eb] text-[#4b5563] hover:bg-white'
                    }`}
                  >
                    生徒本人
                  </button>
                </div>
              ) : (
                <span className="text-xs text-[#4b5563]">保護者向けの招待を発行します</span>
              )}
              <Button
                type="button"
                size="sm"
                onClick={handleIssue}
                isLoading={issuing}
                className="ml-auto"
              >
                招待を発行
              </Button>
            </div>

            {errorMessage && <p className="text-xs text-red-500">{errorMessage}</p>}

            {lastUrl && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-2.5">
                <p className="mb-1.5 text-[11px] font-medium text-[#1f2937]">
                  受諾URL（{studentName} の{inviteType === 'guardian' ? '保護者' : '本人'}
                  に共有してください。有効期限{EXPIRES_IN_DAYS}日）
                </p>
                <div className="flex gap-1.5">
                  <input
                    readOnly
                    value={lastUrl}
                    onFocus={(e) => e.target.select()}
                    className="flex-1 rounded border border-[#e5e7eb] bg-white px-2 py-1 text-[11px] text-[#4b5563]"
                  />
                  <button
                    type="button"
                    onClick={() => copy(lastUrl)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-white bg-[#1e3a5f] rounded hover:bg-[#16304d] transition-colors"
                  >
                    <Copy className="w-3 h-3" />
                    {copied ? 'コピー済み' : 'コピー'}
                  </button>
                </div>

                {/* QRコードと配布用の紙。保護者にURLを打たせずに済むようにする。 */}
                {qrDataUrl && (
                  <div className="mt-2.5 flex items-center gap-3 border-t border-blue-200 pt-2.5">
                    {/* eslint-disable-next-line @next/next/no-img-element -- data URL のQRは next/image の最適化対象外 */}
                    <img
                      src={qrDataUrl}
                      alt="受諾URLのQRコード"
                      className="h-24 w-24 rounded border border-[#e5e7eb] bg-white"
                    />
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <p className="text-[11px] text-[#4b5563]">
                        QRコードを読み取ってもらうと、URLを入力せずに登録できます。
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={printHandout}
                          className="inline-flex items-center gap-1 rounded bg-[#1e3a5f] px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-[#16304d]"
                        >
                          <Printer className="h-3 w-3" />
                          印刷して渡す
                        </button>
                        <button
                          type="button"
                          onClick={downloadQr}
                          className="inline-flex items-center gap-1 rounded border border-[#c7d2dd] bg-white px-2 py-1 text-[11px] font-medium text-[#1e3a5f] transition-colors hover:bg-[#eef3f8]"
                        >
                          <Download className="h-3 w-3" />
                          QRを保存
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 兄弟の追加登録。招待の往復なしで既存アカウントに紐づける（POST portal-links）。 */}
      <LinkExistingAccountDialog
        isOpen={linkDialogOpen}
        onClose={() => setLinkDialogOpen(false)}
        studentId={studentId}
        studentName={studentName}
        onLinked={() => {
          success('紐づけました');
          void loadLinks();
        }}
      />

      {ConfirmDialog}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
