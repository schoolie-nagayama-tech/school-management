'use client';

/**
 * 教室端末の登録ページ（/settings/trusted-devices）。
 *
 * 正典: docs/classroom-device-plan.md §2・§3
 *
 * 教室長以上が、教室の共有PCで1度だけ「この端末を教室端末として登録」する。
 * 登録した端末では講師が従来どおり全機能を使え、それ以外（自宅PC・私物スマホ）では
 * 講師は教室外モードになり、生徒情報系の画面がブロックされる。
 *
 * ★ 登録は「今このブラウザ」に対して行われる:
 *   サーバーが httpOnly クッキーを返すので、必ず教室の端末でこのページを開いて押すこと。
 *   閲覧データ削除・シークレットウィンドウ・別ブラウザではマークが消える（§3）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Button, Input, Modal } from '@/components/ui';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterData } from '@/contexts/MasterDataContext';
import { resetDeviceTrustCache, useClassroomDevice } from '@/contexts/ClassroomDeviceContext';
import { fetchWithAuth } from '@/lib/api/auth';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { ArrowLeft, CheckCircle2, MonitorSmartphone, ShieldOff, XCircle } from 'lucide-react';

interface TrustedDevice {
  id: string;
  school_id: string;
  label: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
  created_by_name: string | null;
}

/** 日時の短縮表示。未使用（null）はハイフン。 */
function formatDateTime(value: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function TrustedDevicesPage() {
  const { profile, schoolIds } = useAuth();
  const { schools: masterSchools } = useMasterData();
  const { refresh: refreshDeviceTrust } = useClassroomDevice();

  const isManager = isManagerOrAbove(profile?.role);

  // 自分の担当教室のみ選ばせる（サーバー側でも isSchoolInScope で再検証する）
  const schools = useMemo(
    () => masterSchools.filter((s) => schoolIds.includes(s.id)),
    [masterSchools, schoolIds]
  );

  const [trusted, setTrusted] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<TrustedDevice[]>([]);
  const [schoolId, setSchoolId] = useState('');
  const [label, setLabel] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<TrustedDevice | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);
  const [error, setError] = useState('');

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetchWithAuth('/api/device-trust/status');
      if (!res.ok) throw new Error('status');
      const data = (await res.json()) as { trusted?: boolean };
      setTrusted(data.trusted === true);
    } catch {
      setTrusted(false);
    }
  }, []);

  const loadDevices = useCallback(async () => {
    try {
      const res = await fetchWithAuth('/api/device-trust/list');
      if (!res.ok) throw new Error('list');
      const data = (await res.json()) as { devices?: TrustedDevice[] };
      setDevices(data.devices ?? []);
    } catch {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    if (!isManager) return;
    loadStatus();
    loadDevices();
  }, [isManager, loadStatus, loadDevices]);

  // 教室が1つならそこに固定。複数なら先頭を初期選択にしておく。
  useEffect(() => {
    if (!schoolId && schools.length > 0) setSchoolId(schools[0].id);
  }, [schools, schoolId]);

  // ラベルの初期値は「教室名 + 受付PC」。室長はここを自由に書き換える。
  useEffect(() => {
    const school = schools.find((s) => s.id === schoolId);
    if (school && !label) setLabel(`${school.name} 受付PC`);
    // label はユーザー入力を上書きしないよう依存に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, schools]);

  async function handleRegister() {
    setError('');
    setIsRegistering(true);
    try {
      const res = await fetchWithAuth('/api/device-trust/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim(), schoolId }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? '登録に失敗しました');
      // 判定キャッシュを捨てて取り直す（同じ端末で講師がログインし直したときに効く）
      resetDeviceTrustCache();
      await Promise.all([loadStatus(), loadDevices(), refreshDeviceTrust()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '登録に失敗しました');
    } finally {
      setIsRegistering(false);
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    setError('');
    setIsRevoking(true);
    try {
      const res = await fetchWithAuth('/api/device-trust/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: revokeTarget.id }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? '失効に失敗しました');
      setRevokeTarget(null);
      resetDeviceTrustCache();
      await Promise.all([loadStatus(), loadDevices(), refreshDeviceTrust()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '失効に失敗しました');
    } finally {
      setIsRevoking(false);
    }
  }

  if (!isManager) {
    return (
      <AdminLayout>
        <AccessDenied message="この機能は教室長以上のみ利用できます" />
      </AdminLayout>
    );
  }

  const schoolName = (id: string): string =>
    masterSchools.find((s) => s.id === id)?.name ?? '不明な教室';

  return (
    <AdminLayout headerTitle="教室端末の登録">
      <div className="max-w-3xl space-y-6">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1.5 text-sm text-info hover:underline"
        >
          <ArrowLeft className="w-4 h-4" />
          設定に戻る
        </Link>

        {/* 説明 */}
        <div className="bg-surface-raised border border-border rounded-xl p-5 space-y-2">
          <h2 className="text-base font-bold text-text-heading">これは何？</h2>
          <p className="text-sm text-text-body">
            教室に設置した端末（共有PC・タブレット）を「教室端末」として登録します。
            登録した端末では講師が従来どおりすべての機能を使えます。登録していない端末
            （自宅のPC・私物スマホ）では、講師は生徒情報を扱う画面を開けなくなり、
            「本日の授業」「自分の予定」「出勤簿」だけが使えます。
          </p>
          <p className="text-xs text-text-muted">
            ※ 教室長以上のアカウントは、どの端末からでも従来どおり全機能を利用できます。
          </p>
        </div>

        {error && (
          <p className="text-sm text-danger bg-danger-subtle border border-border rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {/* この端末の状態 */}
        <div className="bg-surface-raised border border-border rounded-xl p-5">
          <h2 className="text-base font-bold text-text-heading mb-3">今開いている端末の状態</h2>
          {trusted === null ? (
            <p className="text-sm text-text-muted">確認中...</p>
          ) : trusted ? (
            <p className="flex items-center gap-2 text-sm font-medium text-success">
              <CheckCircle2 className="w-4 h-4" />
              この端末は教室端末として登録済みです
            </p>
          ) : (
            <p className="flex items-center gap-2 text-sm font-medium text-text-muted">
              <XCircle className="w-4 h-4" />
              この端末は未登録です（講師がここからログインすると教室外モードになります）
            </p>
          )}
        </div>

        {/* 登録フォーム */}
        <div className="bg-surface-raised border border-border rounded-xl p-5 space-y-4">
          <h2 className="text-base font-bold text-text-heading">この端末を教室端末として登録</h2>
          <p className="text-sm text-text-body">
            ★ 必ず<strong>教室に置いてある端末で、このページを開いて</strong>登録してください。
            登録は「今開いているブラウザ」に対して行われます。
          </p>

          <div className="space-y-1">
            <label htmlFor="school" className="block text-sm font-medium text-text-body">
              教室
            </label>
            <select
              id="school"
              value={schoolId}
              onChange={(e) => setSchoolId(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text-body"
            >
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="label" className="block text-sm font-medium text-text-body">
              端末名
            </label>
            <Input
              id="label"
              value={label}
              maxLength={60}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="例: 長山 受付PC"
            />
            <p className="text-xs text-text-muted">
              紛失や入れ替えのときに、どれを失効させるか判別できる名前にしてください。
            </p>
          </div>

          <Button onClick={handleRegister} disabled={isRegistering || !label.trim() || !schoolId}>
            <MonitorSmartphone className="w-4 h-4 mr-1.5" />
            {isRegistering ? '登録中...' : 'この端末を教室端末として登録'}
          </Button>
        </div>

        {/* 登録済み端末の一覧 */}
        <div className="bg-surface-raised border border-border rounded-xl p-5">
          <h2 className="text-base font-bold text-text-heading mb-3">登録済みの端末</h2>
          {devices.length === 0 ? (
            <p className="text-sm text-text-muted">まだ登録された端末はありません。</p>
          ) : (
            <ul className="space-y-2">
              {devices.map((d) => (
                <li
                  key={d.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text-heading">{d.label}</span>
                      {d.revoked_at && (
                        <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-text-muted">
                          失効済み
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-text-muted">
                      {schoolName(d.school_id)} / 登録 {formatDateTime(d.created_at)}
                      {d.created_by_name ? `（${d.created_by_name}）` : ''} / 最終利用{' '}
                      {formatDateTime(d.last_seen_at)}
                    </div>
                  </div>
                  {!d.revoked_at && (
                    <Button variant="secondary" size="sm" onClick={() => setRevokeTarget(d)}>
                      <ShieldOff className="w-3.5 h-3.5 mr-1" />
                      失効
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 失効の確認 */}
      <Modal
        isOpen={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        title="教室端末の失効"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-body">
            「{revokeTarget?.label}」を失効させます。この端末からログインした講師は、
            以降すべて教室外モード（生徒情報の画面は利用不可）になります。
          </p>
          <p className="text-xs text-text-muted">
            元に戻すには、その端末でこのページを開いて再度登録してください。
          </p>
          <div className="flex justify-end gap-3 pt-2 border-t border-border">
            <Button variant="secondary" onClick={() => setRevokeTarget(null)}>
              キャンセル
            </Button>
            <Button variant="danger" onClick={handleRevoke} disabled={isRevoking}>
              {isRevoking ? '失効中...' : '失効させる'}
            </Button>
          </div>
        </div>
      </Modal>
    </AdminLayout>
  );
}
