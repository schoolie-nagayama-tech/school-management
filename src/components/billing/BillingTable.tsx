'use client';

import type { Student, BillingItem, StudentBilling, SeasonType } from '@/types/database';
import { GRADE_LABELS, SEASON_LABELS } from '@/types/database';
import {
  toggleStudentBilling,
  updateBillingItem,
  deleteBillingItem,
  syncOrdersToBilling,
  syncCourseExtraToBilling,
  syncSpecialCourseToBilling,
  autoFillFifthWeekBilling,
  updateBillingValue,
  syncFormToBilling,
  calcFifthWeekBilling,
} from '@/lib/api/billing';
import { getMaterials, createStockTransaction } from '@/lib/api/inventory';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { getFifthWeekDayLabels } from '@/lib/utils/fifthWeek';
import { useAuth } from '@/contexts/AuthContext';
import { useState } from 'react';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { resolveDefaultBillingMonth } from '@/lib/billing/specialCourseBilling';
import { Pencil, Trash2, Zap, Inbox, GraduationCap, BookOpen } from 'lucide-react';

/**
 * 特別講座の受講料列かどうかの判定。
 * 増コマ列と同じく名前ベースで検出する（DBスキーマ変更を避けるため）。
 * value_type='number' で名前に「特別講座」を含み、フォーム連携でない請求項目が対象。
 * 正典 docs/special-courses-plan.md フェーズ2-B。
 */
function isSpecialCourseItem(item: BillingItem): boolean {
  return (
    (item.value_type || 'check') === 'number' &&
    !item.linked_form_type &&
    item.name.includes('特別講座')
  );
}

/**
 * 講習の「取得増コマ」列かどうかの判定。
 * 進捗ダッシュボードと同じく名前ベースで検出する（DBスキーマ変更を避けるため）。
 * value_type='number' で名前に「講習」を含み、フォーム連携でない請求項目を
 * 講習の増コマ同期対象とみなす。
 * 「講習」で判定するのは、テスト対策の増コマ列など別種の「増コマ」を誤検出しないため
 * （zoukoma フォーム連携列とも同期ボタンが競合しないよう除外）。
 *
 * 「講習特別講座」のように両方の語を含む名前は **特別講座側を優先** して除外する。
 * 同じ列に増コマ同期と特別講座同期のボタンが並ぶと、押し間違いで別定義の値に
 * 上書きされる（＝金額列にコマ数が入る）ため。
 */
function isCourseExtraItem(item: BillingItem): boolean {
  return (
    (item.value_type || 'check') === 'number' &&
    !item.linked_form_type &&
    item.name.includes('講習') &&
    !item.name.includes('特別講座')
  );
}

/**
 * 計上済み/未計上の内訳（quantity/value_number）表示を使う項目か。
 * フォーム連携項目・取得増コマ列に加え、既に内訳データ(quantity)が入っている
 * number項目（発注同期の教材発注は除く）も引き続きsplit表示にする。
 *
 * 罠: isCourseExtraItem / isSpecialCourseItem は項目名（「講習」「特別講座」を含むか）で判定している。項目名を変えたり
 * 判定条件を後から変更したりすると、既に計上済み（quantity側に集約済み）のデータが
 * 名前ベースの判定から外れ、通常セル（value_number基準の表示）に「消えた」ように
 * 見えてしまう（実際は quantity に残っているが読まれない）。billing?.quantity != null
 * を fallback 条件に含めることで、分類が変わっても既存の計上済みデータは表示され続ける。
 */
function usesChargedSplit(item: BillingItem, billing?: StudentBilling): boolean {
  if (item.linked_form_type || isCourseExtraItem(item) || isSpecialCourseItem(item)) return true;
  return (
    (item.value_type || 'check') === 'number' &&
    item.source_type !== 'order' &&
    billing?.quantity != null
  );
}

interface BillingTableProps {
  students: Student[];
  items: BillingItem[];
  billings: StudentBilling[];
  onBillingChange?: (studentId: string, billingItemId: string, isBilled: boolean) => void;
  onStudentClick?: (student: Student) => void;
  onItemsChange?: () => void;
  periodStartDate?: string; // For 5th week auto-calc
  periodEndDate?: string; // For order sync
  schoolIds?: string | string[]; // For 5th week auto-calc
  billingPeriodId?: string; // For form sync and 5th week calc
  billingPeriodName?: string; // For 5th week dialog display
  onStockUpdated?: () => void; // 在庫変動後のリフレッシュ通知
}

export function BillingTable({
  students,
  items,
  billings,
  onBillingChange,
  onStudentClick,
  onItemsChange,
  periodStartDate,
  periodEndDate,
  schoolIds,
  billingPeriodId,
  billingPeriodName,
  onStockUpdated,
}: BillingTableProps) {
  const { profile } = useAuth();
  const isTeacher = profile?.role === 'teacher';
  const isManagerOrAbove =
    profile?.role === 'manager' || profile?.role === 'owner' || profile?.role === 'admin';
  const [updatingCells, setUpdatingCells] = useState<Set<string>>(new Set());
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [autoFilling, setAutoFilling] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [editingCell, setEditingCell] = useState<{ studentId: string; itemId: string } | null>(
    null
  );
  const [editingValue, setEditingValue] = useState<string>('');
  // 取得増コマ同期ダイアログ（対象請求項目 + 選択中の季節・年）
  const [courseExtraSyncItemId, setCourseExtraSyncItemId] = useState<string | null>(null);
  const [syncSeason, setSyncSeason] = useState<SeasonType>('summer');
  const [syncYear, setSyncYear] = useState<number>(new Date().getFullYear());
  const [courseExtraSyncing, setCourseExtraSyncing] = useState(false);
  // 特別講座 同期ダイアログ（対象請求項目 + 通年/講習の別と対象期間）
  const [specialCourseSyncItemId, setSpecialCourseSyncItemId] = useState<string | null>(null);
  const [specialCourseMode, setSpecialCourseMode] = useState<'year_round' | 'koushu'>('year_round');
  // 対象月は "YYYY-MM"。月謝先取り（翌月分を当月に請求する）運用があるため既定は出すが固定しない
  const [specialCourseMonth, setSpecialCourseMonth] = useState<string>('');
  const [specialCourseSeason, setSpecialCourseSeason] = useState<SeasonType>('summer');
  const [specialCourseYear, setSpecialCourseYear] = useState<number>(new Date().getFullYear());
  const [specialCourseSyncing, setSpecialCourseSyncing] = useState(false);
  const { success, error: toastError } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  /** 特別講座の同期ダイアログを開く。対象月の既定は請求期間名 → 開始日の順に決める */
  const openSpecialCourseSync = (itemId: string) => {
    const defaultMonth = resolveDefaultBillingMonth(billingPeriodName, periodStartDate);
    setSpecialCourseMonth(`${defaultMonth.year}-${String(defaultMonth.month).padStart(2, '0')}`);
    setSpecialCourseMode('year_round');
    setSpecialCourseSyncItemId(itemId);
  };

  // 特別講座の受講料（金額）を同期する。通年講座は対象月、講習講座は季節・年で対象を決める
  const handleSpecialCourseSync = async () => {
    if (!specialCourseSyncItemId || !schoolIds) return;
    const [yearStr, monthStr] = specialCourseMonth.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    if (specialCourseMode === 'year_round' && (!year || !month)) {
      toastError('対象月を選んでください');
      return;
    }
    setSpecialCourseSyncing(true);
    try {
      const result = await syncSpecialCourseToBilling(
        specialCourseSyncItemId,
        schoolIds,
        specialCourseMode === 'year_round'
          ? { mode: 'year_round', year, month }
          : { mode: 'koushu', season: specialCourseSeason, year: specialCourseYear }
      );
      // 単価未設定の講座は計上していないので、黙って0円にせず講座名を伝える
      const skipped =
        result.skippedCourseNames.length > 0
          ? `（単価未設定のため未計上: ${result.skippedCourseNames.join('・')}）`
          : '';
      if (result.synced === 0) {
        success(`対象は0件でした${skipped}`);
      } else {
        success(`${result.synced}名の特別講座受講料を同期しました${skipped}`);
      }
      setSpecialCourseSyncItemId(null);
      onItemsChange?.();
    } catch (err) {
      toastError(getUserErrorMessage(err, '同期に失敗しました'));
    } finally {
      setSpecialCourseSyncing(false);
    }
  };

  // 取得増コマを進捗管理表から同期する（季節・年を明示指定）
  const handleCourseExtraSync = async () => {
    if (!courseExtraSyncItemId || !schoolIds) return;
    setCourseExtraSyncing(true);
    try {
      const result = await syncCourseExtraToBilling(
        courseExtraSyncItemId,
        schoolIds,
        syncSeason,
        syncYear
      );
      success(`${result.synced}名の取得増コマを同期しました`);
      setCourseExtraSyncItemId(null);
      onItemsChange?.();
    } catch (err) {
      toastError(getUserErrorMessage(err, '同期に失敗しました'));
    } finally {
      setCourseExtraSyncing(false);
    }
  };

  // 請求状況をマップ化（student_id + billing_item_id -> billing）
  const billingMap = new Map<string, StudentBilling>();
  billings.forEach((b) => {
    billingMap.set(`${b.student_id}-${b.billing_item_id}`, b);
  });

  // 項目ごとにquantityを持つかどうかを判定
  const itemHasQuantity = (itemId: string): boolean => {
    return students.some((student) => {
      const key = `${student.id}-${itemId}`;
      const billing = billingMap.get(key);
      return billing?.quantity != null && billing.quantity > 0;
    });
  };

  // 集計行の計算
  const summaryData = items.map((item) => {
    const totalStudents = students.length;
    const hasQuantityData = itemHasQuantity(item.id);
    const valueType = item.value_type || 'check';

    let billedCount = 0;
    let quantitySum = 0;
    let numberSum = 0;
    let numberBilledCount = 0;
    let numberHasValueCount = 0;
    let textBilledCount = 0;
    let textHasValueCount = 0;

    students.forEach((student) => {
      const key = `${student.id}-${item.id}`;
      const billing = billingMap.get(key);

      if (valueType === 'number') {
        if (billing?.is_billed) numberBilledCount++;
        // フォーム連携項目は計上済みコマ数を quantity に持つため、value_number が0でも
        // quantity>0 なら「値あり」に数える（計上済み生徒が集計から漏れないように）
        const vn = billing?.value_number ?? 0;
        const q = billing?.quantity ?? 0;
        if (vn !== 0 || q > 0) {
          numberHasValueCount++;
          numberSum += vn + q;
        }
      } else if (valueType === 'text') {
        if (billing?.is_billed) textBilledCount++;
        if (billing?.value_text != null && billing.value_text !== '') textHasValueCount++;
      } else {
        // check type (default)
        const isBilled =
          billing?.is_billed === true || (billing?.quantity != null && billing.quantity > 0);
        if (isBilled) billedCount++;
        if (billing?.quantity != null && billing.quantity > 0) {
          quantitySum += billing.quantity;
        }
      }
    });

    const billedRate = totalStudents > 0 ? Math.round((billedCount / totalStudents) * 100) : 0;

    return {
      itemId: item.id,
      valueType,
      totalStudents,
      billedCount,
      billedRate,
      hasQuantityData,
      quantitySum,
      numberSum,
      numberBilledCount,
      numberHasValueCount,
      textBilledCount,
      textHasValueCount,
    };
  });

  const handleCellClick = async (studentId: string, billingItemId: string) => {
    if (!onBillingChange) return;

    const key = `${studentId}-${billingItemId}`;
    const existing = billingMap.get(key);
    const currentIsBilled = existing?.is_billed === true;
    const newIsBilled = !currentIsBilled;

    setUpdatingCells((prev) => new Set(prev).add(key));

    try {
      await toggleStudentBilling(studentId, billingItemId, newIsBilled);
      onBillingChange(studentId, billingItemId, newIsBilled);
    } catch (error) {
      console.error('Failed to toggle billing status:', error);
      toastError('請求状況の更新に失敗しました');
    } finally {
      setUpdatingCells((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const isVocabBookItem = (item: BillingItem) => item.name === '単語練習帳';

  // 単語練習帳ワンクリックトグル: 値なし→1(在庫-1), 値あり→クリア(在庫+1)
  const handleVocabToggle = async (
    studentId: string,
    itemId: string,
    currentBilling: StudentBilling | undefined
  ) => {
    if (isTeacher || !onBillingChange) return;
    const hasValue = currentBilling?.value_number != null && currentBilling.value_number !== 0;
    // 計上済みは誤って冊数を消さないよう、未計上に戻してからでないとクリアできない。
    // （消すと計上フラグだけ残り「冊数だけ消えた」状態になるのを防ぐ）
    if (hasValue && currentBilling?.is_billed) {
      toastError('計上済みのため消せません。先に「計上」を外して未計上にしてから消してください。');
      return;
    }
    const key = `${studentId}-${itemId}`;
    setUpdatingCells((prev) => new Set(prev).add(key));
    try {
      const newValue = hasValue ? null : 1;
      await updateBillingValue(studentId, itemId, { value_number: newValue });

      // 値セット時に在庫-1、クリア時に在庫+1
      try {
        const targetSchoolIds = Array.isArray(schoolIds) ? schoolIds : schoolIds ? [schoolIds] : [];
        if (targetSchoolIds.length > 0) {
          const allMaterials = await getMaterials(targetSchoolIds);
          const vocabMaterial = allMaterials.find((m) => m.name === '単語練習帳');
          if (vocabMaterial) {
            await createStockTransaction({
              material_id: vocabMaterial.id,
              school_id: vocabMaterial.school_id,
              transaction_type: newValue ? 'out' : 'in',
              quantity: 1,
              reason: newValue
                ? '単語練習帳セットによる自動出庫'
                : '単語練習帳クリアによる自動入庫',
            });
            onStockUpdated?.();
          }
        }
      } catch {
        // 在庫連携は best-effort
      }

      onItemsChange?.();
    } catch (err) {
      toastError(err instanceof Error ? err.message : '値の更新に失敗しました');
    } finally {
      setUpdatingCells((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  // Number cell edit handler
  const handleNumberCellClick = (
    studentId: string,
    itemId: string,
    currentBilling: StudentBilling | undefined
  ) => {
    if (isTeacher) return;
    setEditingCell({ studentId, itemId });
    setEditingValue(
      currentBilling?.value_number != null ? String(currentBilling.value_number) : ''
    );
  };

  // Text cell edit handler
  const handleTextCellClick = (
    studentId: string,
    itemId: string,
    currentBilling: StudentBilling | undefined
  ) => {
    if (isTeacher) return;
    setEditingCell({ studentId, itemId });
    setEditingValue(currentBilling?.value_text || '');
  };

  // Save edited value
  const handleSaveEditedValue = async (valueType: 'number' | 'text') => {
    if (!editingCell) return;
    const { studentId, itemId } = editingCell;
    const key = `${studentId}-${itemId}`;
    setUpdatingCells((prev) => new Set(prev).add(key));
    try {
      if (valueType === 'number') {
        const numVal = editingValue.trim() === '' ? null : Number(editingValue);
        await updateBillingValue(studentId, itemId, { value_number: numVal });
      } else {
        const textVal = editingValue.trim() === '' ? null : editingValue.trim();
        await updateBillingValue(studentId, itemId, { value_text: textVal });
      }
      onItemsChange?.();
    } catch (err) {
      toastError(err instanceof Error ? err.message : '値の更新に失敗しました');
    } finally {
      setUpdatingCells((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      setEditingCell(null);
      setEditingValue('');
    }
  };

  // Charged toggle for number/text cells
  // item を渡すと、フォーム連携項目では計上済み(quantity)/未計上(value_number)の内訳も
  // 付け替える（計上=全件計上済みに、解除=全件未計上に）。これにより同期後も「✓計上 N」が
  // 残り、計上済みが空欄に潰れて見えなくなる問題を防ぐ。
  const handleChargedToggle = async (
    studentId: string,
    itemId: string,
    currentBilling: StudentBilling | undefined,
    item?: BillingItem
  ) => {
    if (isTeacher || !onBillingChange) return;
    const key = `${studentId}-${itemId}`;
    setUpdatingCells((prev) => new Set(prev).add(key));
    try {
      const newIsBilled = !currentBilling?.is_billed;
      // split 扱いにするかは呼び出し側で usesChargedSplit(item, billing) 済み判定を渡している
      if (item) {
        // 計上済み + 未計上 = 総コマ数。計上で全部 quantity 側へ、解除で全部 value_number 側へ。
        const total = (currentBilling?.value_number ?? 0) + (currentBilling?.quantity ?? 0);
        await updateBillingValue(
          studentId,
          itemId,
          newIsBilled
            ? { is_billed: true, value_number: 0, quantity: total }
            : { is_billed: false, value_number: total, quantity: 0 }
        );
        onBillingChange(studentId, itemId, newIsBilled);
        // 内訳(quantity/value_number)の表示を最新化するため再取得
        onItemsChange?.();
      } else {
        await updateBillingValue(studentId, itemId, { is_billed: newIsBilled });
        onBillingChange(studentId, itemId, newIsBilled);
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : '計上の更新に失敗しました');
    } finally {
      setUpdatingCells((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  // Form sync handler
  const handleFormSync = async (_itemId: string) => {
    if (!billingPeriodId || !schoolIds) return;
    const confirmed = await confirm({
      title: 'フォーム回答同期',
      description:
        'フォーム回答から請求データを同期しますか？\n紐付け済みの回答件数が反映されます（増コマは申込コマ数）。',
      confirmLabel: '同期する',
      variant: 'default',
    });
    if (!confirmed) return;

    setSyncing(true);
    try {
      const result = await syncFormToBilling(billingPeriodId, schoolIds);
      success(`${result.synced}件の請求データを同期しました`);
      onItemsChange?.();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'フォーム同期に失敗しました');
    } finally {
      setSyncing(false);
    }
  };

  // 5th week calc handler (new version using calcFifthWeekBilling)
  // 5週目は翌月分（月謝は翌月分を請求するため）
  // 表示月は calcFifthWeekBilling と同じロジックで算出（期間名ベース）
  const handleCalcFifthWeek = async () => {
    if (!billingPeriodId || !schoolIds) return;

    // billingPeriodNameから年月を取得（例: "2026年4月請求" → 2026, 4）
    // calcFifthWeekBillingと同じロジック: 請求月 + 1 = 対象月
    let baseYear: number;
    let baseMonth: number;
    const nameMatch = billingPeriodName?.match(/(\d{4})年(\d{1,2})月/);
    if (nameMatch) {
      baseYear = Number(nameMatch[1]);
      baseMonth = Number(nameMatch[2]) + 1; // 翌月が対象
      if (baseMonth > 12) {
        baseMonth -= 12;
        baseYear++;
      }
    } else if (periodStartDate) {
      // フォールバック: periodStartDateから+2ヶ月
      const [yearStr, monthStr] = periodStartDate.split('-');
      baseYear = Number(yearStr);
      baseMonth = Number(monthStr) + 2;
      if (baseMonth > 12) {
        baseMonth -= 12;
        baseYear++;
      }
    } else {
      return;
    }

    const dayLabels = getFifthWeekDayLabels(baseYear, baseMonth);

    const description = dayLabels
      ? `${baseYear}年${baseMonth}月の5週目コマ数を通塾日程から自動計算しますか？\n\n${baseYear}年${baseMonth}月は${dayLabels}曜日に5週目があります。`
      : `${baseYear}年${baseMonth}月には5週目がありません。\n全生徒に「0」を入力します。`;

    const confirmed = await confirm({
      title: '5週目自動計算（翌月分）',
      description,
      confirmLabel: '自動計算',
      variant: 'default',
    });
    if (!confirmed) return;

    setAutoFilling(true);
    try {
      const result = await calcFifthWeekBilling(billingPeriodId, schoolIds);
      if (!dayLabels) {
        success(`${result.updated}名に5週目 = 0 を入力しました`);
      } else {
        success(`${result.updated}名の5週目コマ数を自動計算しました`);
      }
      onItemsChange?.();
    } catch (err) {
      toastError(err instanceof Error ? err.message : '5週目の自動計算に失敗しました');
    } finally {
      setAutoFilling(false);
    }
  };

  // 5週目自動計算ハンドラ (legacy) - 翌月分
  const handleAutoFillFifthWeek = async (itemId: string) => {
    if (!schoolIds) return;

    // billingPeriodNameから年月を取得（請求月 + 1 = 対象月）
    let year: number;
    let month: number;
    const nameMatch = billingPeriodName?.match(/(\d{4})年(\d{1,2})月/);
    if (nameMatch) {
      year = Number(nameMatch[1]);
      month = Number(nameMatch[2]) + 1; // 翌月が対象
      if (month > 12) {
        month = 1;
        year++;
      }
    } else if (periodStartDate) {
      // フォールバック: periodStartDateから+2ヶ月
      const [yearStr, monthStr] = periodStartDate.split('-');
      year = Number(yearStr);
      month = Number(monthStr) + 2;
      if (month > 12) {
        month -= 12;
        year++;
      }
    } else {
      return;
    }
    const dayLabels = getFifthWeekDayLabels(year, month);

    const description = dayLabels
      ? `翌月（${year}年${month}月）の5週目コマ数を通塾日程から自動計算しますか？\n\n${year}年${month}月は${dayLabels}曜日に5週目があります。`
      : `${year}年${month}月には5週目がありません。\n全生徒に「0」を入力します。`;

    const confirmed = await confirm({
      title: '5週目自動計算（翌月分）',
      description,
      confirmLabel: '自動計算',
      variant: 'default',
    });

    if (!confirmed) return;

    setAutoFilling(true);
    try {
      const result = await autoFillFifthWeekBilling(itemId, periodStartDate!, schoolIds);
      if (!dayLabels) {
        success(`${result.updated}名に5週目 = 0 を入力しました`);
      } else {
        success(`${result.updated}名の5週目コマ数を自動計算しました`);
      }
      onItemsChange?.();
    } catch (err) {
      toastError(err instanceof Error ? err.message : '5週目の自動計算に失敗しました');
    } finally {
      setAutoFilling(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
      <div className="overflow-auto max-h-[calc(100vh-200px)]">
        <table className="w-full border-collapse table-fixed">
          <thead className="sticky top-0 z-30">
            <tr className="bg-[#1e3a5f] border-b border-[#e5e7eb]">
              <th className="px-3 py-2 text-left text-white text-xs font-semibold border-r border-[#2d4a6f] sticky left-0 bg-[#1e3a5f] z-40 w-[60px]">
                学年
              </th>
              <th
                className="px-3 py-2 text-left text-white text-xs font-semibold border-r border-[#2d4a6f] sticky left-[60px] bg-[#1e3a5f] z-40 w-[160px]"
                style={{ boxShadow: '4px 0 6px -2px rgba(0,0,0,0.15)' }}
              >
                名前
              </th>
              {items.map((item) => {
                const isFifthWeekItem = item.name.includes('5週目');
                const showAutoFillButton =
                  isFifthWeekItem &&
                  onBillingChange &&
                  isManagerOrAbove &&
                  periodStartDate &&
                  schoolIds;
                return (
                  <th
                    key={item.id}
                    className="px-3 py-2 text-center text-xs font-semibold border-r border-[#2d4a6f] text-white relative group"
                  >
                    {onBillingChange && isManagerOrAbove && editingItemId === item.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onBlur={async () => {
                            if (editingName.trim() && editingName.trim() !== item.name) {
                              try {
                                await updateBillingItem(item.id, { name: editingName.trim() });
                                success('項目名を更新しました');
                                onItemsChange?.();
                              } catch (err) {
                                toastError(
                                  err instanceof Error ? err.message : '項目名の更新に失敗しました'
                                );
                              }
                            }
                            setEditingItemId(null);
                            setEditingName('');
                          }}
                          onKeyDown={async (e) => {
                            if (e.key === 'Enter') {
                              e.currentTarget.blur();
                            } else if (e.key === 'Escape') {
                              setEditingItemId(null);
                              setEditingName('');
                            }
                          }}
                          autoFocus
                          className="flex-1 px-2 py-1 text-sm border border-[#e5e7eb] rounded bg-white text-[#1f2937] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                        />
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <div className="flex items-center justify-center gap-1 w-full">
                          {onBillingChange && isManagerOrAbove ? (
                            <>
                              <div
                                className="flex-1 flex items-center justify-center gap-1 cursor-pointer hover:bg-white/10 rounded px-1 py-0.5 transition-[background-color] duration-150 ease-out"
                                onClick={() => {
                                  setEditingItemId(item.id);
                                  setEditingName(item.name);
                                }}
                                title="クリックして編集"
                              >
                                <span className="text-xs text-white">{item.name}</span>
                                <Pencil className="h-3 w-3 text-white/40 opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
                              </div>
                              <button
                                className="text-[11px] text-red-300 hover:text-red-200 opacity-0 group-hover:opacity-100 transition-opacity px-1 py-0.5 rounded hover:bg-red-500/20"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (
                                    await confirm({
                                      title: '削除確認',
                                      description: `「${item.name}」を削除してもよろしいですか？この列の全ての請求データも削除されます。`,
                                      confirmLabel: '削除',
                                      variant: 'danger',
                                    })
                                  ) {
                                    setDeletingItemId(item.id);
                                    try {
                                      await deleteBillingItem(item.id);
                                      success('項目を削除しました');
                                      onItemsChange?.();
                                    } catch (err) {
                                      toastError(
                                        err instanceof Error
                                          ? err.message
                                          : '項目の削除に失敗しました'
                                      );
                                    } finally {
                                      setDeletingItemId(null);
                                    }
                                  }
                                }}
                                disabled={deletingItemId === item.id}
                                title="削除"
                              >
                                {deletingItemId === item.id ? (
                                  <span className="text-xs">...</span>
                                ) : (
                                  <Trash2 className="h-3 w-3" />
                                )}
                              </button>
                            </>
                          ) : (
                            <span className="text-xs text-white">{item.name}</span>
                          )}
                        </div>
                        {/* アクションボタン（1列に1つだけ） */}
                        {(showAutoFillButton ||
                          (item.linked_form_type && !isTeacher && billingPeriodId && schoolIds) ||
                          (item.source_type === 'order' &&
                            !isTeacher &&
                            periodStartDate &&
                            schoolIds) ||
                          (isCourseExtraItem(item) && !isTeacher && schoolIds)) && (
                          <div className="flex items-center gap-1">
                            {showAutoFillButton && (
                              <button
                                className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-400/30 text-amber-200 hover:bg-amber-400/50 transition-[background-color] duration-150 ease-out disabled:opacity-50"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (billingPeriodId) {
                                    handleCalcFifthWeek();
                                  } else {
                                    handleAutoFillFifthWeek(item.id);
                                  }
                                }}
                                disabled={autoFilling}
                                title="通塾日程から5週目コマ数を自動計算"
                              >
                                {autoFilling ? (
                                  '...'
                                ) : (
                                  <>
                                    <Zap className="inline h-3 w-3 mr-0.5" />
                                    自動計算
                                  </>
                                )}
                              </button>
                            )}
                            {item.linked_form_type &&
                              !isTeacher &&
                              billingPeriodId &&
                              schoolIds && (
                                <button
                                  className="text-[11px] px-1.5 py-0.5 rounded-full bg-cyan-400/30 text-cyan-200 hover:bg-cyan-400/50 transition-[background-color] duration-150 ease-out disabled:opacity-50"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleFormSync(item.id);
                                  }}
                                  disabled={syncing}
                                  title="フォーム回答から件数を同期"
                                >
                                  {syncing ? (
                                    '...'
                                  ) : (
                                    <>
                                      <Inbox className="inline h-3 w-3 mr-0.5" />
                                      同期
                                    </>
                                  )}
                                </button>
                              )}
                            {item.source_type === 'order' &&
                              !isTeacher &&
                              periodStartDate &&
                              schoolIds && (
                                <button
                                  className="text-[11px] px-1.5 py-0.5 rounded-full bg-purple-400/30 text-purple-200 hover:bg-purple-400/50 transition-[background-color] duration-150 ease-out"
                                  title="発注管理から同期"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    if (
                                      !(await confirm({
                                        title: '発注管理から同期',
                                        description: `「${item.name}」を発注管理から自動同期しますか？\n期間内の発注が請求に反映されます。`,
                                        confirmLabel: '同期する',
                                      }))
                                    )
                                      return;
                                    try {
                                      const result = await syncOrdersToBilling(
                                        item.id,
                                        schoolIds,
                                        periodStartDate,
                                        periodEndDate || periodStartDate
                                      );
                                      success(`${result.synced}名の発注を同期しました`);
                                      onItemsChange?.();
                                    } catch (err) {
                                      toastError(getUserErrorMessage(err, '同期に失敗しました'));
                                    }
                                  }}
                                >
                                  <Inbox className="inline h-3 w-3 mr-0.5" />
                                  同期
                                </button>
                              )}
                            {/* 取得増コマ列: 進捗管理表から同期（季節・年はダイアログで選ぶ） */}
                            {isCourseExtraItem(item) && !isTeacher && schoolIds && (
                              <button
                                className="text-[11px] px-1.5 py-0.5 rounded-full bg-emerald-400/30 text-emerald-200 hover:bg-emerald-400/50 transition-[background-color] duration-150 ease-out"
                                title="進捗管理表の取得増コマを同期"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCourseExtraSyncItemId(item.id);
                                }}
                              >
                                <GraduationCap className="inline h-3 w-3 mr-0.5" />
                                進捗から同期
                              </button>
                            )}
                            {/* 特別講座列: 講座の単価×受講回数（金額）を同期。対象はダイアログで選ぶ */}
                            {isSpecialCourseItem(item) && !isTeacher && schoolIds && (
                              <button
                                className="text-[11px] px-1.5 py-0.5 rounded-full bg-sky-400/30 text-sky-100 hover:bg-sky-400/50 transition-[background-color] duration-150 ease-out"
                                title="特別講座の受講料を同期"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openSpecialCourseSync(item.id);
                                }}
                              >
                                <BookOpen className="inline h-3 w-3 mr-0.5" />
                                特別講座から同期
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
            {/* 集計行 */}
            <tr className="bg-[#f0f4f8] border-b border-[#e5e7eb]">
              <td className="px-3 py-1.5 text-left text-[#4b5563] text-xs border-r border-[#e5e7eb] sticky left-0 bg-[#f0f4f8] z-40 w-[60px]">
                集計
              </td>
              <td
                className="px-3 py-1.5 text-left text-[#4b5563] text-xs border-r border-[#e5e7eb] sticky left-[60px] bg-[#f0f4f8] z-40 w-[160px]"
                style={{ boxShadow: '4px 0 6px -2px rgba(0,0,0,0.08)' }}
              ></td>
              {summaryData.map((summary) => (
                <td
                  key={summary.itemId}
                  className="px-3 py-1.5 text-center text-[#4b5563] text-[11px] border-r border-[#e5e7eb] bg-[#f0f4f8]"
                >
                  {summary.valueType === 'number' ? (
                    // 合計値（上・太字）＋ 計上済みは人数でカウント（下）
                    // 数値項目は「コマ」とは限らない（金額等もあり得る）ため単位は付けない
                    <div className="flex flex-col items-center">
                      <span className="text-[11px] font-bold text-[#1e3a5f]">
                        合計 {summary.numberSum}
                      </span>
                      <span
                        className={`text-[11px] ${summary.numberBilledCount === summary.numberHasValueCount && summary.numberHasValueCount > 0 ? 'text-green-600' : 'text-orange-500'}`}
                      >
                        計上 {summary.numberBilledCount}/{summary.numberHasValueCount}名
                      </span>
                    </div>
                  ) : summary.valueType === 'text' ? (
                    <div className="flex flex-col items-center">
                      <span className="text-[11px] font-bold text-[#1e3a5f]">
                        {summary.textHasValueCount}名
                      </span>
                      <span
                        className={`text-[11px] ${summary.textBilledCount === summary.textHasValueCount && summary.textHasValueCount > 0 ? 'text-green-600' : 'text-orange-500'}`}
                      >
                        計上 {summary.textBilledCount}/{summary.textHasValueCount}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center">
                      <span className="text-[11px] font-bold text-[#1e3a5f]">
                        {summary.billedCount}/{summary.totalStudents}
                      </span>
                      {summary.hasQuantityData && (
                        <span className="text-[11px] text-[#4b5563]">
                          計{summary.quantitySum}コマ
                        </span>
                      )}
                    </div>
                  )}
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map((student, idx) => {
              const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-[#f8fafc]';
              return (
                <tr
                  key={student.id}
                  className={`border-b border-[#e5e7eb] hover:bg-[#e8f0fe] transition-[background-color] duration-150 ease-out ${rowBg}`}
                >
                  <td
                    className={`px-3 py-2 text-xs text-[#4b5563] border-r border-[#e5e7eb] sticky left-0 ${rowBg} z-20 w-[60px]`}
                  >
                    {GRADE_LABELS[student.grade] || student.grade}
                  </td>
                  <td
                    className={`px-3 py-2 text-xs text-[#1f2937] border-r border-[#e5e7eb] sticky left-[60px] ${rowBg} z-20 w-[160px] whitespace-nowrap transition-[background-color] duration-150 ease-out ${
                      onStudentClick ? 'cursor-pointer hover:text-[#3b82f6]' : ''
                    }`}
                    style={{ boxShadow: '4px 0 6px -2px rgba(0,0,0,0.08)' }}
                    onClick={() => onStudentClick?.(student)}
                  >
                    {student.last_name} {student.first_name}
                  </td>
                  {items.map((item) => {
                    const key = `${student.id}-${item.id}`;
                    const billing = billingMap.get(key);
                    const valueType = item.value_type || 'check';
                    const isUpdating = updatingCells.has(key);
                    const canEditCell = !isTeacher;
                    const isEditingThis =
                      editingCell?.studentId === student.id && editingCell?.itemId === item.id;

                    if (valueType === 'number') {
                      const hasValue = billing?.value_number != null && billing.value_number !== 0;
                      const isBilled = billing?.is_billed === true;
                      const bgClass =
                        hasValue && isBilled ? 'bg-green-100' : hasValue ? 'bg-yellow-50' : '';

                      // 単語練習帳: ワンクリックで 1/クリア 切替
                      if (isVocabBookItem(item)) {
                        return (
                          <td
                            key={item.id}
                            className={`px-1 py-1 text-center border-r border-[#e5e7eb] transition-[background-color] duration-150 ease-out ${bgClass} ${
                              isUpdating ? 'opacity-50' : ''
                            } ${canEditCell && onBillingChange ? 'cursor-pointer hover:bg-blue-50' : ''}`}
                            onClick={() => {
                              if (!isUpdating && canEditCell && onBillingChange) {
                                handleVocabToggle(student.id, item.id, billing);
                              }
                            }}
                            title={
                              hasValue
                                ? isBilled
                                  ? '計上済み（消すには先に計上を外す）'
                                  : '1（クリックでクリア）'
                                : 'クリックで1をセット'
                            }
                          >
                            {isUpdating ? (
                              <span className="text-[#4b5563] text-xs">...</span>
                            ) : (
                              <div className="flex flex-col items-center gap-0.5">
                                <span
                                  className={`text-sm font-bold ${hasValue ? (isBilled ? 'text-green-700' : 'text-[#1e3a5f]') : 'text-gray-300'}`}
                                >
                                  {hasValue ? billing?.value_number : '-'}
                                </span>
                                {canEditCell && onBillingChange && hasValue && (
                                  <button
                                    className={`text-[11px] leading-none rounded-md px-2 py-0.5 font-medium transition-[background-color,color] duration-150 ease-out ${
                                      isBilled
                                        ? 'bg-green-500 text-white hover:bg-green-600'
                                        : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                                    }`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleChargedToggle(student.id, item.id, billing);
                                    }}
                                    title={
                                      isBilled
                                        ? '計上済（クリックで解除）'
                                        : '未計上（クリックで計上）'
                                    }
                                  >
                                    {isBilled ? '✓ 計上' : '計上'}
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        );
                      }

                      // フォーム連携の number セル: 計上済み(quantity)と未計上/新規(value_number)を分けて表示。
                      // 同期しても計上済み(✓計上 N・緑)は残り、新規分だけ別に出るので「計上済みが消えて分からなくなる」を防ぐ。
                      // quantity が未設定(=新ロジックで未同期の旧データ)の行は従来表示にフォールバックし、
                      // 同期 or 計上で quantity が入った後に内訳表示へ切り替わる（旧計上済みが新規に化けるのを防ぐ）。
                      if (usesChargedSplit(item, billing) && billing?.quantity != null) {
                        const charged = billing?.quantity ?? 0;
                        const pending = billing?.value_number ?? 0;
                        const total = charged + pending;
                        const fullyCharged = pending === 0 && charged > 0;
                        const cellBg =
                          total === 0
                            ? ''
                            : fullyCharged
                              ? 'bg-green-100'
                              : charged > 0
                                ? 'bg-lime-50'
                                : 'bg-yellow-50';
                        return (
                          <td
                            key={item.id}
                            className={`px-1 py-1 text-center border-r border-[#e5e7eb] transition-[background-color] duration-150 ease-out ${cellBg} ${
                              isUpdating ? 'opacity-50' : ''
                            }`}
                          >
                            {isUpdating ? (
                              <span className="text-[#4b5563] text-xs">...</span>
                            ) : total === 0 ? (
                              <span className="text-sm text-gray-300">-</span>
                            ) : (
                              <div className="flex flex-col items-center gap-1">
                                {/* 計上済み: 数字を上に＋下に緑「✓計上」ピル（計上済みは同期しても残る） */}
                                {charged > 0 && (
                                  <div className="flex flex-col items-center gap-0.5">
                                    <span className="text-sm font-bold text-green-700">
                                      {charged}
                                    </span>
                                    {canEditCell && onBillingChange && pending === 0 ? (
                                      <button
                                        className="text-[11px] leading-none rounded-md px-2 py-0.5 font-medium bg-green-500 text-white hover:bg-green-600 transition-[background-color] duration-150 ease-out"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleChargedToggle(student.id, item.id, billing, item);
                                        }}
                                        title="計上済（クリックで全件解除）"
                                      >
                                        ✓ 計上
                                      </button>
                                    ) : (
                                      <span
                                        className="text-[11px] leading-none rounded-md px-2 py-0.5 font-medium bg-green-100 text-green-700"
                                        title="計上済みコマ数"
                                      >
                                        ✓ 計上
                                      </span>
                                    )}
                                  </div>
                                )}
                                {/* 未計上（新規）: 数字を上に＋下にグレー「計上」ピル */}
                                {pending > 0 && (
                                  <div className="flex flex-col items-center gap-0.5">
                                    <span
                                      className="text-sm font-bold text-[#1e3a5f]"
                                      title="未計上（新規）コマ数"
                                    >
                                      {pending}
                                    </span>
                                    {canEditCell && onBillingChange && (
                                      <button
                                        className="text-[11px] leading-none rounded-md px-2 py-0.5 font-medium bg-gray-200 text-gray-600 hover:bg-gray-300 transition-[background-color] duration-150 ease-out"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleChargedToggle(student.id, item.id, billing, item);
                                        }}
                                        title="未計上を計上する"
                                      >
                                        計上
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        );
                      }

                      // 通常の number セル
                      return (
                        <td
                          key={item.id}
                          className={`px-1 py-1 text-center border-r border-[#e5e7eb] transition-[background-color] duration-150 ease-out relative ${bgClass} ${
                            isUpdating ? 'opacity-50' : ''
                          } ${canEditCell && onBillingChange && !isEditingThis ? 'cursor-pointer hover:bg-blue-50' : ''}`}
                          onClick={() => {
                            if (!isUpdating && !isEditingThis && canEditCell && onBillingChange) {
                              handleNumberCellClick(student.id, item.id, billing);
                            }
                          }}
                          title={
                            hasValue
                              ? `${billing?.value_number}（クリックで編集）`
                              : 'クリックで入力'
                          }
                        >
                          {isUpdating ? (
                            <span className="text-[#4b5563] text-xs">...</span>
                          ) : isEditingThis ? (
                            <input
                              type="number"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onBlur={() => handleSaveEditedValue('number')}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur();
                                if (e.key === 'Escape') {
                                  setEditingCell(null);
                                  setEditingValue('');
                                }
                              }}
                              onClick={(e) => e.stopPropagation()}
                              autoFocus
                              className="w-full px-2 py-1 text-sm text-center border-2 border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
                            />
                          ) : (
                            // 数字を上に大きく＋下に計上ピル（計上済み=緑「✓計上」／未計上=グレー「計上」）
                            <div className="flex flex-col items-center gap-0.5">
                              <span
                                className={`text-sm font-bold ${hasValue ? (isBilled ? 'text-green-700' : 'text-[#1e3a5f]') : 'text-gray-300'}`}
                              >
                                {hasValue ? billing?.value_number : '-'}
                              </span>
                              {canEditCell && onBillingChange && hasValue && (
                                <button
                                  className={`text-[11px] leading-none rounded-md px-2 py-0.5 font-medium transition-[background-color,color] duration-150 ease-out ${
                                    isBilled
                                      ? 'bg-green-500 text-white hover:bg-green-600'
                                      : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                                  }`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // フォーム連携・取得増コマ項目なら item を渡して計上済み/未計上の内訳(quantity)も付与し、
                                    // 旧データを新表示へ移行させる。それ以外は従来どおり is_billed のみ更新。
                                    handleChargedToggle(
                                      student.id,
                                      item.id,
                                      billing,
                                      usesChargedSplit(item, billing) ? item : undefined
                                    );
                                  }}
                                  title={
                                    isBilled
                                      ? '計上済（クリックで解除）'
                                      : '未計上（クリックで計上）'
                                  }
                                >
                                  {isBilled ? '✓ 計上' : '計上'}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      );
                    }

                    if (valueType === 'text') {
                      const hasValue = billing?.value_text != null && billing.value_text !== '';
                      const isBilled = billing?.is_billed === true;
                      const bgClass =
                        hasValue && isBilled ? 'bg-green-100' : hasValue ? 'bg-yellow-50' : '';

                      return (
                        <td
                          key={item.id}
                          className={`px-1 py-1 text-center border-r border-[#e5e7eb] transition-[background-color] duration-150 ease-out relative ${bgClass} ${
                            isUpdating ? 'opacity-50' : ''
                          } ${canEditCell && onBillingChange && !isEditingThis ? 'cursor-pointer hover:bg-blue-50' : ''}`}
                          onClick={() => {
                            if (!isUpdating && !isEditingThis && canEditCell && onBillingChange) {
                              handleTextCellClick(student.id, item.id, billing);
                            }
                          }}
                          title={
                            hasValue ? `${billing?.value_text}（クリックで編集）` : 'クリックで入力'
                          }
                        >
                          {isUpdating ? (
                            <span className="text-[#4b5563] text-xs">...</span>
                          ) : isEditingThis ? (
                            <input
                              type="text"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onBlur={() => handleSaveEditedValue('text')}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur();
                                if (e.key === 'Escape') {
                                  setEditingCell(null);
                                  setEditingValue('');
                                }
                              }}
                              onClick={(e) => e.stopPropagation()}
                              autoFocus
                              className="w-full px-2 py-1 text-sm border-2 border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
                            />
                          ) : (
                            <div className="flex flex-col items-center gap-0.5">
                              {/* テキスト表示（複数行対応） */}
                              <span
                                className={`text-xs whitespace-pre-wrap break-all text-left leading-tight ${
                                  hasValue
                                    ? isBilled
                                      ? 'text-green-700'
                                      : 'text-[#1e3a5f]'
                                    : 'text-gray-300'
                                }`}
                              >
                                {hasValue ? billing?.value_text : '-'}
                              </span>
                              {/* 計上ボタン */}
                              {canEditCell && onBillingChange && hasValue && (
                                <button
                                  className={`text-[11px] leading-none rounded-md px-2 py-0.5 font-medium transition-[background-color,color] duration-150 ease-out ${
                                    isBilled
                                      ? 'bg-green-500 text-white hover:bg-green-600'
                                      : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                                  }`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // フォーム連携・取得増コマ項目なら item を渡して計上済み/未計上の内訳(quantity)も付与し、
                                    // 旧データを新表示へ移行させる。それ以外は従来どおり is_billed のみ更新。
                                    handleChargedToggle(
                                      student.id,
                                      item.id,
                                      billing,
                                      usesChargedSplit(item, billing) ? item : undefined
                                    );
                                  }}
                                  title={
                                    isBilled
                                      ? '計上済（クリックで解除）'
                                      : '未計上（クリックで計上）'
                                  }
                                >
                                  {isBilled ? '✓ 計上' : '計上'}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      );
                    }

                    // Default: check type
                    const hasQuantity = billing?.quantity != null && billing.quantity > 0;
                    const isBilled = billing?.is_billed === true || hasQuantity;

                    return (
                      <td
                        key={item.id}
                        className={`px-3 py-2 text-center border-r border-[#e5e7eb] transition-[background-color] duration-150 ease-out ${
                          isBilled ? 'bg-green-100' : ''
                        } ${
                          isUpdating
                            ? 'opacity-50'
                            : onBillingChange && canEditCell
                              ? 'cursor-pointer hover:bg-[#3b82f6]/10'
                              : 'cursor-default'
                        }`}
                        onClick={() =>
                          onBillingChange &&
                          !isUpdating &&
                          canEditCell &&
                          handleCellClick(student.id, item.id)
                        }
                        title={
                          isTeacher
                            ? '閲覧のみ'
                            : hasQuantity
                              ? `${billing?.quantity}コマ（クリックで解除）`
                              : isBilled
                                ? '請求済（クリックで解除）'
                                : '未請求（クリックで請求済に）'
                        }
                      >
                        {isUpdating ? (
                          <span className="text-[#4b5563]">...</span>
                        ) : hasQuantity ? (
                          <span className="text-sm font-semibold text-green-700">
                            {billing?.quantity}
                          </span>
                        ) : isBilled ? (
                          <span className="text-sm font-semibold text-green-700">✓</span>
                        ) : (
                          <span></span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {ConfirmDialog}

      {/* 取得増コマ 同期ダイアログ（対象の講習を季節・年で選ぶ） */}
      {courseExtraSyncItemId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white shadow-xl border border-[#e5e7eb]">
            <div className="px-5 py-4 border-b border-[#e5e7eb]">
              <h3 className="text-sm font-bold text-[#1f2937] flex items-center gap-1.5">
                <GraduationCap className="h-4 w-4 text-emerald-600" />
                進捗管理表から取得増コマを同期
              </h3>
              <p className="text-xs text-[#6b7280] mt-1">
                対象の講習を選んでください。各生徒の取得増コマ数がこの列に反映されます。
              </p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-xs text-[#6b7280] mb-1">季節</label>
                <select
                  value={syncSeason}
                  onChange={(e) => setSyncSeason(e.target.value as SeasonType)}
                  className="w-full px-2 py-1.5 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#1f2937] focus:outline-none focus:ring-2 focus:ring-emerald-400"
                >
                  {(Object.keys(SEASON_LABELS) as SeasonType[]).map((s) => (
                    <option key={s} value={s}>
                      {SEASON_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[#6b7280] mb-1">年</label>
                <input
                  type="number"
                  value={syncYear}
                  onChange={(e) => setSyncYear(parseInt(e.target.value, 10) || syncYear)}
                  className="w-full px-2 py-1.5 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#1f2937] focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>
            </div>
            <div className="px-5 py-4 border-t border-[#e5e7eb] flex justify-end gap-2">
              <button
                onClick={() => setCourseExtraSyncItemId(null)}
                disabled={courseExtraSyncing}
                className="px-3 py-1.5 rounded-lg text-sm text-[#4b5563] hover:bg-[#f3f4f6] transition-[background-color] duration-150 ease-out disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                onClick={handleCourseExtraSync}
                disabled={courseExtraSyncing}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-[background-color] duration-150 ease-out disabled:opacity-50"
              >
                {courseExtraSyncing ? '同期中...' : '同期する'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 特別講座 同期ダイアログ（通年講座＝対象月 / 講習講座＝季節・年） */}
      {specialCourseSyncItemId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white shadow-xl border border-[#e5e7eb]">
            <div className="px-5 py-4 border-b border-[#e5e7eb]">
              <h3 className="text-sm font-bold text-[#1f2937] flex items-center gap-1.5">
                <BookOpen className="h-4 w-4 text-sky-600" />
                特別講座の受講料を同期
              </h3>
              <p className="text-xs text-[#6b7280] mt-1">
                講座の単価 × 受講回数を合計した「金額（円）」がこの列に入ります。
              </p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-xs text-[#6b7280] mb-1">対象</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSpecialCourseMode('year_round')}
                    className={`flex-1 px-2 py-1.5 rounded-lg text-sm border transition-[background-color,border-color] duration-150 ease-out ${
                      specialCourseMode === 'year_round'
                        ? 'bg-sky-600 text-white border-sky-600'
                        : 'bg-white text-[#4b5563] border-[#e5e7eb] hover:bg-[#f3f4f6]'
                    }`}
                  >
                    通年講座（月次）
                  </button>
                  <button
                    type="button"
                    onClick={() => setSpecialCourseMode('koushu')}
                    className={`flex-1 px-2 py-1.5 rounded-lg text-sm border transition-[background-color,border-color] duration-150 ease-out ${
                      specialCourseMode === 'koushu'
                        ? 'bg-sky-600 text-white border-sky-600'
                        : 'bg-white text-[#4b5563] border-[#e5e7eb] hover:bg-[#f3f4f6]'
                    }`}
                  >
                    講習講座（期に1回）
                  </button>
                </div>
              </div>
              {specialCourseMode === 'year_round' ? (
                <div>
                  <label className="block text-xs text-[#6b7280] mb-1">対象月</label>
                  <input
                    type="month"
                    value={specialCourseMonth}
                    onChange={(e) => setSpecialCourseMonth(e.target.value)}
                    className="w-full px-2 py-1.5 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#1f2937] focus:outline-none focus:ring-2 focus:ring-sky-400"
                  />
                  <p className="text-[11px] text-[#6b7280] mt-1">
                    その月に座席表で開催される回数を数えます。翌月分を先取りで請求する場合は、
                    対象月を翌月にしてください。
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs text-[#6b7280] mb-1">季節</label>
                    <select
                      value={specialCourseSeason}
                      onChange={(e) => setSpecialCourseSeason(e.target.value as SeasonType)}
                      className="w-full px-2 py-1.5 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#1f2937] focus:outline-none focus:ring-2 focus:ring-sky-400"
                    >
                      {(Object.keys(SEASON_LABELS) as SeasonType[]).map((s) => (
                        <option key={s} value={s}>
                          {SEASON_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[#6b7280] mb-1">年</label>
                    <input
                      type="number"
                      value={specialCourseYear}
                      onChange={(e) =>
                        setSpecialCourseYear(parseInt(e.target.value, 10) || specialCourseYear)
                      }
                      className="w-full px-2 py-1.5 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#1f2937] focus:outline-none focus:ring-2 focus:ring-sky-400"
                    />
                  </div>
                  <p className="text-[11px] text-[#6b7280]">
                    講習講座は申込のコマ数 × 単価で計算します。
                  </p>
                </>
              )}
              <p className="text-[11px] text-[#9ca3af]">
                単価が未設定の講座は計上されません（同期後に講座名をお知らせします）。
              </p>
            </div>
            <div className="px-5 py-4 border-t border-[#e5e7eb] flex justify-end gap-2">
              <button
                onClick={() => setSpecialCourseSyncItemId(null)}
                disabled={specialCourseSyncing}
                className="px-3 py-1.5 rounded-lg text-sm text-[#4b5563] hover:bg-[#f3f4f6] transition-[background-color] duration-150 ease-out disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                onClick={handleSpecialCourseSync}
                disabled={specialCourseSyncing}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-sky-600 text-white hover:bg-sky-700 transition-[background-color] duration-150 ease-out disabled:opacity-50"
              >
                {specialCourseSyncing ? '同期中...' : '同期する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
