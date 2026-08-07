'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, Ticket } from 'lucide-react';
import { Button } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { fetchWithAuth } from '@/lib/api/auth';
import { isOwnerOrAbove } from '@/lib/utils/roles';

/**
 * 生徒詳細モーダル・新規登録直後の導線から使う保護者ポータル招待の発行セクション。
 *
 * 設定→ポータルアカウント（src/app/settings/portal-accounts/page.tsx）と同じ
 * /api/admin/portal-invitations を叩く簡易版。あちらは教室横断の一覧管理用に残し、
 * こちらは「入会時にその場で招待を発行したい」という教室長の実運用に合わせて
 * 生徒1名分に絞って埋め込む（正典 docs/release-roadmap-2026H2.md P2-9）。
 *
 * ★ 表示ゲートは API の認可に合わせて isOwnerOrAbove（admin/owner）:
 *   /api/admin/portal-invitations は requireAdmin（admin/owner のみ、manager 不可）。
 *   本来の運用主体は教室長（manager）だが、ポータルが admin 限定のクローズドデモの間は
 *   manager に「押すと403になるボタン」を見せないため UI も admin/owner に絞る。
 *   manager 開放時は API を requireManager＋自教室スコープ検証に変えてから、
 *   ここを isManagerOrAbove に広げること（両方同時に。工程表 P2-9 の残注記参照）。
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

interface PortalInviteSectionProps {
  studentId: string;
  studentName: string;
}

export function PortalInviteSection({ studentId, studentName }: PortalInviteSectionProps) {
  const { profile } = useAuth();
  const canView = isOwnerOrAbove(profile?.role);

  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [inviteType, setInviteType] = useState<'guardian' | 'student'>('guardian');
  const [lastUrl, setLastUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

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

  useEffect(() => {
    if (canView) void loadInvitations();
  }, [canView, loadInvitations]);

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
    } catch (e) {
      console.error('[PortalInviteSection] 招待の発行に失敗:', e);
      setErrorMessage('通信に失敗しました');
    } finally {
      setIssuing(false);
    }
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
          </div>
        )}
      </div>
    </div>
  );
}
