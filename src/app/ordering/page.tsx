'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { AdminLayout } from '@/components/layouts';
import { Button, Loading, InlineLoading, ToastContainer } from '@/components/ui';
import dynamic from 'next/dynamic';
import type { MaterialFormData } from '@/components/inventory';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { CartItem } from '@/components/ordering/TextbookCatalog';

const MaterialForm = dynamic(() => import('@/components/inventory').then((m) => m.MaterialForm), {
  ssr: false,
});
const StockTransactionModal = dynamic(
  () => import('@/components/inventory').then((m) => m.StockTransactionModal),
  { ssr: false }
);
const TextbookCatalog = dynamic(
  () => import('@/components/ordering/TextbookCatalog').then((m) => m.TextbookCatalog),
  { ssr: false }
);
import {
  getMaterials,
  createMaterial,
  updateMaterial,
  createStockTransaction,
} from '@/lib/api/inventory';
import {
  getOrders,
  createOrder,
  createOrderWithBilling,
  createBulkOrders,
  checkOrderDuplicates,
} from '@/lib/api/ordering';
import { getStudents } from '@/lib/api/students';
import { getBillingPeriods } from '@/lib/api/billing';
import { getTextbooks } from '@/lib/api/textbooks';
import type {
  Material,
  MaterialOrderWithDetails,
  BillingPeriod,
  Textbook,
  OrderStatus,
} from '@/types/database';
import { ORDER_STATUS_LABELS } from '@/types/database';
import { useRequirePermission, useCanEdit } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

export default function OrderingPage() {
  // Permissions
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessOrdering
  );
  const canEdit = useCanEdit('canEditOrdering');
  const { getSelectedSchoolIds, selectedSchoolId } = useAuth();
  const { toasts, removeToast, success, error: toastError } = useToast();

  // 入会フロー（?onboarding=<studentId>）から来たか。来ていれば発注対象を初期選択し、
  // 生徒詳細へ抜ける導線を出す。
  const searchParams = useSearchParams();
  const onboardingStudentId = searchParams?.get('onboarding') || null;

  // Data state
  const [materials, setMaterials] = useState<Material[]>([]);
  const [orders, setOrders] = useState<MaterialOrderWithDetails[]>([]);
  const [students, setStudents] = useState<
    { id: string; school_id: string; last_name: string; first_name: string; grade: number | null }[]
  >([]);
  const [textbooks, setTextbooks] = useState<Textbook[]>([]);
  // 生徒名は students の読み込み後に確定する。未確定でもバナーは出す（名前だけ後から入る）
  const onboardingStudentName = useMemo(() => {
    if (!onboardingStudentId) return '';
    const s = students.find((st) => st.id === onboardingStudentId);
    return s ? `${s.last_name} ${s.first_name}` : '';
  }, [onboardingStudentId, students]);
  const [activeBillingPeriod, setActiveBillingPeriod] = useState<BillingPeriod | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // Material form modal
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);

  // Stock modals
  const [stockTxnMaterial, setStockTxnMaterial] = useState<Material | null>(null);
  const [stockTxnMode, setStockTxnMode] = useState<'in' | 'out' | 'adjust'>('in');
  const [isStockTxnOpen, setIsStockTxnOpen] = useState(false);

  // Fetch all data
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) {
        setErrorMessage('教室が選択されていません');
        setIsLoading(false);
        return;
      }

      const [materialsData, ordersData, studentsData, billingPeriods, textbooksData] =
        await Promise.all([
          getMaterials(schoolIds),
          getOrders(schoolIds).catch(() => [] as MaterialOrderWithDetails[]),
          getStudents(undefined, schoolIds),
          getBillingPeriods(schoolIds).catch(() => [] as BillingPeriod[]),
          getTextbooks().catch(() => [] as Textbook[]),
        ]);

      setMaterials(materialsData);
      setOrders(ordersData);
      setTextbooks(textbooksData);
      setStudents(
        studentsData
          .filter((s) => s.status === 'active')
          .map((s) => ({
            id: s.id,
            school_id: s.school_id,
            last_name: s.last_name,
            first_name: s.first_name,
            grade: s.grade,
          }))
      );
      const active = billingPeriods.find((p) => p.is_active) || null;
      setActiveBillingPeriod(active);
    } catch (error) {
      console.error('Error fetching data:', error);
      setErrorMessage(getUserErrorMessage(error, 'データの取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds]);

  useEffect(() => {
    if (selectedSchoolId !== null) {
      fetchData();
    }
  }, [fetchData, selectedSchoolId]);

  const schoolIds = useMemo(() => getSelectedSchoolIds(), [getSelectedSchoolIds]);

  // カート保存のスコープ。教室を切り替えたら別教室の生徒・教材が混ざるため保存分は捨てる。
  const cartScopeKey = useMemo(() => schoolIds.join(','), [schoolIds]);

  // 発注済み（未キャンセル・実生徒）の「生徒ID::教材名ラベル」集合。カタログの生徒選択肢に
  // 「発注済」を注記するための即時判定（追加fetchなし。ロード済み orders から作る）。
  const existingOrderPairs = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      if (o.status === 'cancelled' || o.is_sample || !o.student_id || !o.material?.name) continue;
      set.add(`${o.student_id}::${o.material.name}`);
    }
    return set;
  }, [orders]);

  // 二重発注の確認ダイアログ。確定時にサーバー再判定した重複を提示し、除外/含める/中止を選ばせる。
  type DuplicateRow = {
    key: string;
    studentLabel: string;
    textbookName: string;
    /** 表示ラベル。所持なら「所持」、発注済みなら実際のステータス（未確認/発注済み/…） */
    reason: string;
    /** 所持による重複か（バッジの色分け用） */
    owned: boolean;
  };
  const [dupPrompt, setDupPrompt] = useState<{ rows: DuplicateRow[]; total: number } | null>(null);
  // ダイアログの選択結果を handleBulkOrder 側の await に渡すための resolver。
  const dupResolverRef = useRef<((choice: 'exclude' | 'include' | 'cancel') => void) | null>(null);

  const resolveDupChoice = useCallback((choice: 'exclude' | 'include' | 'cancel') => {
    const resolve = dupResolverRef.current;
    dupResolverRef.current = null;
    setDupPrompt(null);
    resolve?.(choice);
  }, []);

  const askDuplicateDecision = useCallback(
    (rows: DuplicateRow[], total: number): Promise<'exclude' | 'include' | 'cancel'> =>
      new Promise((resolve) => {
        dupResolverRef.current = resolve;
        setDupPrompt({ rows, total });
      }),
    []
  );

  // --- Material CRUD ---
  const handleCreateMaterial = async (data: MaterialFormData) => {
    const targetSchoolIds = schoolIds.length > 0 ? schoolIds : undefined;
    await createMaterial(
      {
        name: data.name,
        description: data.description || null,
        category: data.category || null,
        unit: data.unit,
        low_stock_threshold: data.low_stock_threshold,
      },
      targetSchoolIds
    );
    fetchData();
  };

  const handleUpdateMaterial = async (data: MaterialFormData) => {
    if (!editingMaterial) return;
    await updateMaterial(editingMaterial.id, {
      name: data.name,
      description: data.description || null,
      category: data.category || null,
      unit: data.unit,
      low_stock_threshold: data.low_stock_threshold,
    });
    fetchData();
  };

  // --- Stock ---
  const handleStockTransaction = async (txnData: { quantity: number; reason: string }) => {
    if (!stockTxnMaterial) return;
    const schoolId = schoolIds.length > 0 ? schoolIds[0] : '';
    await createStockTransaction({
      school_id: schoolId,
      material_id: stockTxnMaterial.id,
      transaction_type: stockTxnMode,
      quantity: txnData.quantity,
      reason: txnData.reason || null,
    });
    fetchData();
  };

  const handleStockAdjust = (material: Material) => {
    setStockTxnMaterial(material);
    setStockTxnMode('adjust');
    setIsStockTxnOpen(true);
  };

  const SAMPLE_VALUE = '__SAMPLE__';
  // 単語練習帳は教室ごとに在庫を持つため、発注時に生徒の所属教室から減算する。
  // 他の教材は従来通り選択中の最初の教室 (schoolIds[0]) で扱う。
  const VOCAB_BOOK_NAME = '単語練習帳';

  // --- Textbook Ordering (with auto stock decrement) ---
  const handleTextbookOrder = async (
    textbookName: string,
    studentId: string,
    quantity: number,
    notes: string
  ) => {
    const isSample = studentId === SAMPLE_VALUE;
    const isVocab = textbookName === VOCAB_BOOK_NAME;

    // 単語練習帳 + 実生徒の場合は生徒の所属教室を、それ以外は schoolIds[0] を使う
    const student = !isSample ? students.find((s) => s.id === studentId) : null;
    const targetSchoolId =
      isVocab && student?.school_id
        ? student.school_id
        : schoolIds.length > 0
          ? schoolIds[0]
          : undefined;

    // 該当教室の material を取得（単語練習帳は教室別レコードを正確に当てる必要がある）
    let material = materials.find(
      (m) => m.name === textbookName && (targetSchoolId ? m.school_id === targetSchoolId : true)
    );

    if (!material) {
      // 該当教室分の material を作成（単語練習帳は targetSchoolId のみ、他は schoolIds 全体に作成）
      material = await createMaterial(
        { name: textbookName, category: 'テキスト', unit: '冊' },
        isVocab && targetSchoolId ? [targetSchoolId] : schoolIds.length > 0 ? schoolIds : undefined
      );
    }

    const orderData = {
      material_id: material.id,
      ...(isSample ? { is_sample: true } : { student_id: studentId }),
      quantity,
      notes: notes || undefined,
    };

    if (!isSample && activeBillingPeriod) {
      await createOrderWithBilling(orderData, activeBillingPeriod.id, targetSchoolId);
    } else {
      await createOrder(orderData, targetSchoolId);
    }

    // Auto-decrement stock by creating an 'out' transaction
    if (targetSchoolId) {
      try {
        await createStockTransaction({
          school_id: targetSchoolId,
          material_id: material.id,
          transaction_type: 'out',
          quantity,
          reason: isSample ? '見本発注による自動出庫' : '発注による自動出庫',
        });
      } catch {
        // Stock decrement is best-effort; don't block the order
        console.warn('Auto stock decrement failed');
      }
    }

    // Refresh all data
    fetchData();
  };

  // --- Bulk Order (Cart) ---
  // 単語練習帳は生徒の所属教室から在庫減算するため、item ごとに対象教室を決定して
  // 発注レコード・在庫減算の school_id を分ける（他の教材は schoolIds[0] のまま）。
  const handleBulkOrder = async (items: CartItem[]) => {
    const fallbackSchoolId = schoolIds.length > 0 ? schoolIds[0] : undefined;

    // ─── 二重発注チェック（確定前・サーバー再判定） ───
    // ロード済みデータでは拾えない「他ユーザーの発注」「前セッションから残ったカート」「所持済み」も
    // 含め、実生徒の (生徒×テキスト) をサーバーで再判定する。見本は対象外。
    let effectiveItems = items;
    const dupCandidates = items
      .filter((it) => it.studentId !== SAMPLE_VALUE && it.textbook?.id != null)
      .map((it) => ({ item: it, studentId: it.studentId, textbookId: it.textbook.id }));
    if (dupCandidates.length > 0) {
      const dupKeys = new Set<string>();
      const ownedKeys = new Set<string>();
      // 発注が理由の重複は、そのステータス（未確認/発注済み/発送済み/配布済み）まで覚えておく。
      // 「未確認」＝まだ取次に出していない状態を「発注済み」と出すと、実物が来ていないのに
      // 発注できないように読めるため。
      const orderStatusKeys = new Map<string, OrderStatus>();
      try {
        const results = await checkOrderDuplicates(
          dupCandidates.map(({ studentId, textbookId }) => ({ studentId, textbookId }))
        );
        for (const r of results) {
          if (r.isDuplicate) {
            dupKeys.add(`${r.studentId}:${r.textbookId}`);
            if (r.alreadyOwned) ownedKeys.add(`${r.studentId}:${r.textbookId}`);
            if (r.activeOrderStatus) {
              orderStatusKeys.set(`${r.studentId}:${r.textbookId}`, r.activeOrderStatus);
            }
          }
        }
      } catch (err) {
        // 判定に失敗しても発注自体は止めない（重複防止はベストエフォート）。
        console.warn('二重発注チェックに失敗しました（スキップ）:', err);
      }

      if (dupKeys.size > 0) {
        // 重複行を提示（同一キーはまとめる）。理由は所持/発注済みのどちらか。
        const seen = new Set<string>();
        const rows: DuplicateRow[] = [];
        for (const { item, studentId, textbookId } of dupCandidates) {
          const key = `${studentId}:${textbookId}`;
          if (!dupKeys.has(key) || seen.has(key)) continue;
          seen.add(key);
          const owned = ownedKeys.has(key);
          const orderStatus = orderStatusKeys.get(key);
          rows.push({
            key,
            studentLabel: item.studentLabel,
            textbookName: item.textbook.name,
            reason: owned ? '所持' : orderStatus ? ORDER_STATUS_LABELS[orderStatus] : '発注済み',
            owned,
          });
        }

        const choice = await askDuplicateDecision(rows, dupCandidates.length);
        if (choice === 'cancel') {
          // カートを残すため throw（TextbookCatalog 側の catch が握りつぶし、cart は維持される）。
          throw new Error('duplicate-order-cancelled');
        }
        if (choice === 'exclude') {
          effectiveItems = items.filter((it) => {
            if (it.studentId === SAMPLE_VALUE || it.textbook?.id == null) return true;
            return !dupKeys.has(`${it.studentId}:${it.textbook.id}`);
          });
          if (effectiveItems.length === 0) {
            success('重複のみだったため発注しませんでした（全件が既に発注済み/所持）');
            throw new Error('duplicate-order-all-excluded');
          }
        }
        // choice === 'include' の場合は effectiveItems = items のまま（重複も発注）。
      }
    }
    const excludedCount = items.length - effectiveItems.length;

    // (school_id, material name) で材料をキャッシュ。単語練習帳は教室別レコードを使うので
    // material_name 単独では衝突するためキーに school_id を含める。
    const materialKey = (name: string, schoolId: string | undefined) =>
      `${schoolId ?? ''}::${name}`;
    const materialCache = new Map<string, Material>();
    for (const m of materials) {
      materialCache.set(materialKey(m.name, m.school_id), m);
    }

    type Entry = {
      material_id: string;
      student_id?: string;
      is_sample?: boolean;
      quantity: number;
      notes?: string;
      targetSchoolId: string | undefined;
    };
    const orderEntries: Entry[] = [];

    // 教材の解決〜発注レコード作成は逐次 await のため、途中で失敗すると前半だけ DB に残る。
    // 何件通ったかを数えておき、失敗時のトーストで知らせる（黙って部分成功すると、
    // 画面上は「押しても何も起きない」ように見えて原因にたどり着けないため）。
    let createdCount = 0;
    try {
      for (const item of effectiveItems) {
        const isSample = item.studentId === SAMPLE_VALUE;
        const isVocab = item.textbookName === VOCAB_BOOK_NAME;
        const student = !isSample ? students.find((s) => s.id === item.studentId) : null;
        const targetSchoolId = isVocab && student?.school_id ? student.school_id : fallbackSchoolId;

        let material = materialCache.get(materialKey(item.textbookName, targetSchoolId));
        if (!material) {
          material = await createMaterial(
            { name: item.textbookName, category: 'テキスト', unit: '冊' },
            isVocab && targetSchoolId
              ? [targetSchoolId]
              : schoolIds.length > 0
                ? schoolIds
                : undefined
          );
          materialCache.set(materialKey(material.name, material.school_id), material);
        }

        orderEntries.push({
          material_id: material.id,
          ...(isSample ? { is_sample: true } : { student_id: item.studentId }),
          quantity: item.quantity,
          targetSchoolId,
        });
      }

      // 発注レコード作成（target school 別にグルーピング）
      if (activeBillingPeriod) {
        for (const entry of orderEntries) {
          const { targetSchoolId, ...orderData } = entry;
          await createOrderWithBilling(orderData, activeBillingPeriod.id, targetSchoolId);
          createdCount++;
        }
      } else {
        // 単語練習帳が混在すると school_id が異なるため、bulk insert は単一 school 用に分割
        const hasMixedSchool =
          new Set(orderEntries.map((e) => e.targetSchoolId)).size > 1 ||
          orderEntries.some((e) => e.is_sample);
        if (hasMixedSchool) {
          for (const entry of orderEntries) {
            const { targetSchoolId, ...orderData } = entry;
            await createOrder(orderData, targetSchoolId);
            createdCount++;
          }
        } else {
          const { targetSchoolId } = orderEntries[0] ?? { targetSchoolId: fallbackSchoolId };
          const payload = orderEntries.map(({ targetSchoolId: _ts, ...rest }) => rest);
          const created = await createBulkOrders(
            payload as Array<{ material_id: string; student_id: string; quantity: number }>,
            targetSchoolId
          );
          createdCount = created.length;
        }
      }
    } catch (err) {
      // ここで fetchData() を呼んではいけない。setIsLoading(true) で TextbookCatalog が
      // アンマウントされ、失敗時に残したいカート（同コンポーネントの useState）ごと消えるため。
      // 部分成功した分は次回の再取得で拾える。カートを残すため呼び出し元へ再throwする。
      const reason = getUserErrorMessage(err, '発注の登録に失敗しました');
      toastError(
        createdCount > 0
          ? `${effectiveItems.length}件中${createdCount}件だけ登録されました: ${reason}`
          : reason
      );
      throw err;
    }

    // 在庫減算（item ごとに targetSchoolId を使う）
    for (const entry of orderEntries) {
      if (!entry.targetSchoolId) continue;
      try {
        await createStockTransaction({
          school_id: entry.targetSchoolId,
          material_id: entry.material_id,
          transaction_type: 'out',
          quantity: entry.quantity,
          reason: entry.is_sample ? '見本発注による自動出庫' : '発注による自動出庫',
        });
      } catch {
        console.warn('Auto stock decrement failed');
      }
    }

    fetchData();
    // ボタン名は「まとめて発注」だが、実際に作られるのは未確認レコードで取次への発注ではない。
    // 行き先を明示しないと「発注できていない」と誤解されるため、ステータスまで書く。
    // 二重発注で除外した件数があれば併記する。
    success(
      excludedCount > 0
        ? `${createdCount}件を発注リストに登録しました（未確認）／重複${excludedCount}件は除外`
        : `${createdCount}件を発注リストに登録しました（未確認）`
    );
  };

  const handleFormClose = () => {
    setIsFormOpen(false);
    setEditingMaterial(null);
  };

  // Loading
  if (permissionLoading) {
    return (
      <AdminLayout>
        <Loading className="min-h-[60vh]" />
      </AdminLayout>
    );
  }

  // Access denied
  if (!hasPermission) {
    return (
      <AdminLayout>
        <AccessDenied />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="教材・発注管理">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      {/* Error Message */}
      {errorMessage && (
        <div className="mb-4 bg-danger/20 text-danger px-4 py-2 rounded border border-danger">
          {errorMessage}
        </div>
      )}

      {/* 入会フロー（生徒情報 → 授業スケジュール → 教材発注 → 生徒詳細）の最後の一手。
          発注が要らない生徒もいるので、発注せずに生徒詳細へ抜けられるようにしておく。 */}
      {onboardingStudentId && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-700">
            {onboardingStudentName
              ? `${onboardingStudentName} の入会手続きの最後です。`
              : '入会手続きの最後です。'}
            必要な教材をカートに入れて発注してください。発注が不要ならそのまま完了できます。
          </p>
          <Link
            href={`/students?detail=${onboardingStudentId}`}
            className="px-4 py-2 rounded-lg bg-[#1e3a5f] text-white text-sm font-medium hover:opacity-90 transition-[opacity] duration-150 ease-out whitespace-nowrap"
          >
            完了して生徒詳細へ
          </Link>
        </div>
      )}

      {/* Header Actions */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-gray-900">教材・発注管理</h2>
        <div className="flex items-center gap-2">
          <Link
            href="/ordering/history"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition-[background-color] duration-150 ease-out active:scale-[0.97]"
          >
            発注履歴
            {(() => {
              const unconfirmed = orders.filter((o) => o.status === 'unconfirmed').length;
              const ordered = orders.filter((o) => o.status === 'ordered').length;
              const delivered = orders.filter((o) => o.status === 'delivered').length;
              return (
                <>
                  {unconfirmed > 0 && (
                    <span
                      className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-bold bg-yellow-100 text-yellow-700"
                      title="未確認"
                    >
                      未確認 {unconfirmed}
                    </span>
                  )}
                  {ordered > 0 && (
                    <span
                      className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-700"
                      title="発注済み"
                    >
                      発注済 {ordered}
                    </span>
                  )}
                  {delivered > 0 && (
                    <span
                      className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-bold bg-green-100 text-green-700"
                      title="発送済み"
                    >
                      発送済 {delivered}
                    </span>
                  )}
                </>
              );
            })()}
          </Link>
          {canEdit && (
            <Button
              onClick={() => {
                setEditingMaterial(null);
                setIsFormOpen(true);
              }}
              className="text-sm"
            >
              教材登録
            </Button>
          )}
        </div>
      </div>

      {/* Textbook Catalog (main content) */}
      {isLoading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8">
          <InlineLoading />
        </div>
      ) : (
        <TextbookCatalog
          textbooks={textbooks}
          students={students}
          initialStudentId={onboardingStudentId ?? undefined}
          canEdit={canEdit}
          materials={materials}
          onOrder={handleTextbookOrder}
          onBulkOrder={handleBulkOrder}
          schoolScopeKey={cartScopeKey}
          existingOrderPairs={existingOrderPairs}
          onStockAdjust={handleStockAdjust}
          onStockRegister={async (textbookName: string) => {
            // 在庫未登録のテキスト → まず Material を作成してから在庫調整モーダルを開く
            try {
              const schoolIds = getSelectedSchoolIds();
              const newMaterial = await createMaterial(
                { name: textbookName, category: 'テキスト', unit: '冊', low_stock_threshold: 3 },
                schoolIds
              );
              setStockTxnMaterial(newMaterial);
              setStockTxnMode('in');
              setIsStockTxnOpen(true);
            } catch (err) {
              setErrorMessage(getUserErrorMessage(err, '教材の登録に失敗しました'));
            }
          }}
        />
      )}

      {/* Material Form Modal */}
      {isFormOpen && (
        <MaterialForm
          isOpen={isFormOpen}
          onClose={handleFormClose}
          onSubmit={editingMaterial ? handleUpdateMaterial : handleCreateMaterial}
          material={editingMaterial}
        />
      )}

      {/* 二重発注 確認ダイアログ */}
      {dupPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
            <div className="flex items-start gap-3 border-b border-gray-200 px-5 py-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
              <div>
                <h3 className="text-base font-bold text-gray-900">二重発注の可能性</h3>
                <p className="mt-0.5 text-xs text-gray-500">
                  カート{dupPrompt.total}件のうち、次の{dupPrompt.rows.length}
                  件は所持済み、または発注リストに残っています（右のラベルが現在の状態です）。
                </p>
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto px-5 py-3">
              <ul className="space-y-1.5">
                {dupPrompt.rows.map((r) => (
                  <li
                    key={r.key}
                    className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 text-sm text-gray-800">
                      <span className="font-medium">{r.studentLabel}</span>
                      <span className="mx-1.5 text-gray-300">/</span>
                      <span className="truncate text-gray-600">{r.textbookName}</span>
                    </span>
                    <span
                      className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        r.owned ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                      }`}
                    >
                      {r.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-2 border-t border-gray-200 px-5 py-4">
              {/* 全件が重複だと除外して残るものが無い。押しても何も起きずカートだけ残るので無効化する */}
              <Button
                onClick={() => resolveDupChoice('exclude')}
                disabled={dupPrompt.total - dupPrompt.rows.length === 0}
                className="w-full text-sm"
              >
                重複を除いて発注（{dupPrompt.total - dupPrompt.rows.length}件）
              </Button>
              <div className="flex gap-2">
                <button
                  onClick={() => resolveDupChoice('include')}
                  className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
                >
                  重複も含めて発注（{dupPrompt.total}件）
                </button>
                <button
                  onClick={() => resolveDupChoice('cancel')}
                  className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-500 hover:bg-gray-50"
                >
                  キャンセル
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stock Transaction Modal */}
      {isStockTxnOpen && stockTxnMaterial && (
        <StockTransactionModal
          isOpen={isStockTxnOpen}
          onClose={() => {
            setIsStockTxnOpen(false);
            setStockTxnMaterial(null);
          }}
          material={stockTxnMaterial}
          mode={stockTxnMode}
          onSubmit={handleStockTransaction}
        />
      )}
    </AdminLayout>
  );
}
