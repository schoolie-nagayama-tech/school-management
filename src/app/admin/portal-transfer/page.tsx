'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { ChevronLeft, Plus, Trash2, Repeat, CalendarRange } from 'lucide-react';
import { AdminLayout } from '@/components/layouts';
import { Button, Input, Loading, ToastContainer, Label } from '@/components/ui';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { useLocalSchoolId } from '@/hooks/useLocalSchoolId';
import { useToast } from '@/hooks/useToast';
import { fetchWithAuth } from '@/lib/api/auth';
import { isManagerOrAbove } from '@/lib/utils/roles';

/**
 * 振替の例外設定（保護者ポータル）。manager 以上。
 *
 * 正典: docs/portal-v2-requirements.md §7-3。
 * ナビ（navConfig）には載せない = URL直行でのみ到達（portal-chat と同じ扱い）。
 *
 * 2つの例外を扱う:
 *   1. 生徒×月の「振替追加許可」= その月の上限に extra_count 回ぶん上乗せ。
 *      これが無い限り保護者は上限でハードストップする。
 *   2. 「振替無制限期間」= 対象授業日がこの期間内なら上限判定をスキップ（講習前フリー期間）。
 */

interface PermissionRow {
  id: string;
  school_id: string;
  student_id: string;
  month: string;
  extra_count: number;
  note: string | null;
  created_at: string;
}

interface FreePeriodRow {
  id: string;
  school_id: string;
  start_date: string;
  end_date: string;
  label: string | null;
  created_at: string;
}

/** 今月の月初日 'YYYY-MM-01'（JST基準）。 */
function currentMonthStart(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${jst.toISOString().slice(0, 7)}-01`;
}

export default function PortalTransferPage() {
  const { profile, isLoading: authLoading } = useAuth();
  const { localSchoolId } = useLocalSchoolId();
  const { toasts, removeToast, success, error: toastError } = useToast();

  const [permissions, setPermissions] = useState<PermissionRow[]>([]);
  const [freePeriods, setFreePeriods] = useState<FreePeriodRow[]>([]);
  const [loading, setLoading] = useState(false);

  // 追加許可フォーム
  const [permStudentId, setPermStudentId] = useState('');
  const [permMonth, setPermMonth] = useState(currentMonthStart());
  const [permExtra, setPermExtra] = useState(1);
  const [permNote, setPermNote] = useState('');
  const [permSaving, setPermSaving] = useState(false);

  // フリー期間フォーム
  const [freeStart, setFreeStart] = useState('');
  const [freeEnd, setFreeEnd] = useState('');
  const [freeLabel, setFreeLabel] = useState('');
  const [freeSaving, setFreeSaving] = useState(false);

  const isManager = isManagerOrAbove(profile?.role);
  // 'all' のときは教室指定なし（API 側が担当教室に絞る）。
  const schoolQs = useMemo(
    () => (localSchoolId && localSchoolId !== 'all' ? `?schoolId=${localSchoolId}` : ''),
    [localSchoolId]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 素の fetch では 401 になる（この API は requireManager/requireAdmin を通るため）。
      // cookie だけに頼らず Authorization ヘッダーを付ける fetchWithAuth を使う
      // ＝このプロジェクトの管理API呼び出しの作法。
      const [permRes, freeRes] = await Promise.all([
        fetchWithAuth(`/api/admin/portal-transfer-permissions${schoolQs}`),
        fetchWithAuth(`/api/admin/transfer-free-periods${schoolQs}`),
      ]);
      const permJson = await permRes.json();
      const freeJson = await freeRes.json();
      setPermissions(permRes.ok ? (permJson.permissions ?? []) : []);
      setFreePeriods(freeRes.ok ? (freeJson.periods ?? []) : []);
    } catch {
      toastError('取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [schoolQs, toastError]);

  useEffect(() => {
    if (isManager) load();
  }, [isManager, load]);

  const grantPermission = async () => {
    if (!permStudentId.trim()) {
      toastError('生徒IDを入力してください');
      return;
    }
    setPermSaving(true);
    try {
      const res = await fetchWithAuth('/api/admin/portal-transfer-permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: permStudentId.trim(),
          month: permMonth,
          extraCount: permExtra,
          note: permNote || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toastError(json.error ?? '付与に失敗しました');
        return;
      }
      success('振替の追加許可を付与しました');
      setPermStudentId('');
      setPermNote('');
      await load();
    } catch {
      toastError('通信に失敗しました');
    } finally {
      setPermSaving(false);
    }
  };

  const revokePermission = async (row: PermissionRow) => {
    try {
      const res = await fetchWithAuth(
        `/api/admin/portal-transfer-permissions?studentId=${encodeURIComponent(row.student_id)}&month=${row.month}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        toastError('取消に失敗しました');
        return;
      }
      success('取り消しました');
      await load();
    } catch {
      toastError('通信に失敗しました');
    }
  };

  const addFreePeriod = async () => {
    if (!freeStart || !freeEnd) {
      toastError('開始日・終了日を入力してください');
      return;
    }
    if (localSchoolId === 'all' || !localSchoolId) {
      toastError('教室を選択してください');
      return;
    }
    setFreeSaving(true);
    try {
      const res = await fetchWithAuth('/api/admin/transfer-free-periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schoolId: localSchoolId,
          startDate: freeStart,
          endDate: freeEnd,
          label: freeLabel || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toastError(json.error ?? '追加に失敗しました');
        return;
      }
      success('振替無制限期間を追加しました');
      setFreeStart('');
      setFreeEnd('');
      setFreeLabel('');
      await load();
    } catch {
      toastError('通信に失敗しました');
    } finally {
      setFreeSaving(false);
    }
  };

  const deleteFreePeriod = async (id: string) => {
    try {
      const res = await fetchWithAuth(
        `/api/admin/transfer-free-periods?id=${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        }
      );
      if (!res.ok) {
        toastError('削除に失敗しました');
        return;
      }
      success('削除しました');
      await load();
    } catch {
      toastError('通信に失敗しました');
    }
  };

  if (authLoading) {
    return (
      <AdminLayout>
        <Loading />
      </AdminLayout>
    );
  }
  if (!isManager) {
    return (
      <AdminLayout>
        <AccessDenied />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="mb-4 flex items-center gap-2">
        <Link
          href="/mypage"
          aria-label="戻る"
          className="text-text-muted transition-colors hover:text-text-heading"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-bold text-text-heading">振替の例外設定（保護者ポータル）</h1>
      </div>
      <p className="mb-6 max-w-2xl text-sm text-text-muted">
        保護者ポータルの振替は「上限（週の通塾コマ数）に達したら選べない」が既定です。
        ここでの設定だけがその例外を開けます。
      </p>

      {loading && <Loading />}

      {/* ── 1. 生徒×月の追加許可 ── */}
      <section className="mb-8 rounded-xl border border-border bg-surface-raised p-4">
        <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-text-heading">
          <Repeat className="h-4 w-4" />
          振替の追加許可（生徒×月）
        </h2>
        <p className="mb-4 text-xs text-text-muted">
          その生徒のその月の上限に、指定回数ぶん上乗せします。保護者側には「教室が今月の振替を追加でN回許可しています」と表示されます。
        </p>

        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-5">
          <div className="md:col-span-2">
            <Input
              label="生徒ID"
              value={permStudentId}
              onChange={(e) => setPermStudentId(e.target.value)}
              placeholder="students.id (uuid)"
            />
          </div>
          <div>
            <Input
              label="対象月"
              type="month"
              value={permMonth.slice(0, 7)}
              // month 入力は 'YYYY-MM'。DB の不変条件（月初日）に合わせて '-01' を付ける。
              onChange={(e) => setPermMonth(e.target.value ? `${e.target.value}-01` : '')}
            />
          </div>
          <div>
            <Input
              label="追加回数"
              type="number"
              min={1}
              value={permExtra}
              onChange={(e) => setPermExtra(Number(e.target.value))}
            />
          </div>
          <div className="flex items-end">
            <Button onClick={grantPermission} isLoading={permSaving} className="w-full">
              <Plus className="mr-1 h-4 w-4" />
              許可する
            </Button>
          </div>
        </div>
        <div className="mb-4">
          <Input
            label="メモ（任意）"
            value={permNote}
            onChange={(e) => setPermNote(e.target.value)}
            placeholder="例: 学校行事が重なったため"
          />
        </div>

        {permissions.length === 0 ? (
          <p className="text-sm text-text-muted">現在、追加許可はありません。</p>
        ) : (
          <ul className="space-y-2">
            {permissions.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-lg border border-border-subtle bg-surface px-3 py-2"
              >
                <div className="min-w-0 text-sm">
                  <p className="truncate font-medium text-text-heading">
                    {p.month.slice(0, 7)} ・ +{p.extra_count}回
                  </p>
                  <p className="truncate text-xs text-text-muted">
                    生徒ID: {p.student_id}
                    {p.note && ` ・ ${p.note}`}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="この許可を取り消す"
                  onClick={() => revokePermission(p)}
                  className="ml-2 flex-none text-text-muted transition-colors hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 2. 振替無制限期間 ── */}
      <section className="rounded-xl border border-border bg-surface-raised p-4">
        <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-text-heading">
          <CalendarRange className="h-4 w-4" />
          振替無制限期間（講習前フリー期間）
        </h2>
        <p className="mb-4 text-xs text-text-muted">
          対象授業日がこの期間内なら、上限判定をスキップします（教室単位）。保護者側には「7/22〜8/9
          は振替制限なし」と表示されます。
        </p>

        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <Label htmlFor="free-start">開始日</Label>
            <Input
              id="free-start"
              type="date"
              value={freeStart}
              onChange={(e) => setFreeStart(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="free-end">終了日</Label>
            <Input
              id="free-end"
              type="date"
              value={freeEnd}
              onChange={(e) => setFreeEnd(e.target.value)}
            />
          </div>
          <div>
            <Input
              label="ラベル（任意）"
              value={freeLabel}
              onChange={(e) => setFreeLabel(e.target.value)}
              placeholder="例: 夏期講習前期間"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={addFreePeriod} isLoading={freeSaving} className="w-full">
              <Plus className="mr-1 h-4 w-4" />
              追加する
            </Button>
          </div>
        </div>

        {freePeriods.length === 0 ? (
          <p className="text-sm text-text-muted">現在、無制限期間はありません。</p>
        ) : (
          <ul className="space-y-2">
            {freePeriods.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between rounded-lg border border-border-subtle bg-surface px-3 py-2"
              >
                <div className="min-w-0 text-sm">
                  <p className="truncate font-medium text-text-heading">
                    {f.start_date} 〜 {f.end_date}
                  </p>
                  {f.label && <p className="truncate text-xs text-text-muted">{f.label}</p>}
                </div>
                <button
                  type="button"
                  aria-label="この期間を削除する"
                  onClick={() => deleteFreePeriod(f.id)}
                  className="ml-2 flex-none text-text-muted transition-colors hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}
