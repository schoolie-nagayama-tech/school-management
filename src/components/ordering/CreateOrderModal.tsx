'use client';

import { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Input, Textarea } from '@/components/ui';
import { SelectShadcn as Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui';
import { getStudents } from '@/lib/api/students';
import { getMaterials } from '@/lib/api/inventory';
import { createOrder, createOrderWithBilling } from '@/lib/api/ordering';
import { getBillingPeriods } from '@/lib/api/billing';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import type { Student, Material, BillingPeriod } from '@/types/database';

interface CreateOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
  schoolIds: string[];
}

export function CreateOrderModal({ isOpen, onClose, onCreated, schoolIds }: CreateOrderModalProps) {
  const [students, setStudents] = useState<Student[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [activeBillingPeriod, setActiveBillingPeriod] = useState<BillingPeriod | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [autoBilling, setAutoBilling] = useState(true);

  // フォーム
  const [studentId, setStudentId] = useState('');
  const [materialId, setMaterialId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [studentSearch, setStudentSearch] = useState('');

  // データ取得
  const fetchData = useCallback(async () => {
    if (schoolIds.length === 0) return;
    setIsFetching(true);
    try {
      const [studentsData, materialsData, billingPeriods] = await Promise.all([
        getStudents(undefined, schoolIds),
        getMaterials(schoolIds),
        getBillingPeriods(schoolIds).catch(() => [] as BillingPeriod[]),
      ]);
      // activeのみ
      setStudents(studentsData.filter((s) => s.status === 'active'));
      setMaterials(materialsData);
      // アクティブな請求期間を取得
      const active = billingPeriods.find((p) => p.is_active) || null;
      setActiveBillingPeriod(active);
    } catch (error) {
      console.error('Error fetching data for order modal:', error);
    } finally {
      setIsFetching(false);
    }
  }, [schoolIds]);

  useEffect(() => {
    if (isOpen) {
      fetchData();
      // フォームリセット
      setStudentId('');
      setMaterialId('');
      setQuantity(1);
      setNotes('');
      setStudentSearch('');
      setErrorMessage('');
      setAutoBilling(true);
    }
  }, [isOpen, fetchData]);

  // 生徒検索結果
  const filteredStudents = studentSearch
    ? students.filter((s) => {
        const name = `${s.last_name}${s.first_name}${s.last_name_kana}${s.first_name_kana}`;
        return name.toLowerCase().includes(studentSearch.toLowerCase());
      })
    : students;

  const handleSubmit = async () => {
    if (!studentId || !materialId) {
      setErrorMessage('生徒と教材を選択してください');
      return;
    }
    if (quantity < 1) {
      setErrorMessage('数量は1以上を入力してください');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');
    try {
      const schoolId = schoolIds.length > 0 ? schoolIds[0] : undefined;
      const orderData = {
        material_id: materialId,
        student_id: studentId,
        quantity,
        notes: notes || undefined,
      };

      if (autoBilling && activeBillingPeriod) {
        await createOrderWithBilling(orderData, activeBillingPeriod.id, schoolId);
      } else {
        await createOrder(orderData, schoolId);
      }
      onCreated();
      onClose();
    } catch (error) {
      console.error('Error creating order:', error);
      setErrorMessage(getUserErrorMessage(error, '発注の作成に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="新規発注">
      <div className="space-y-4">
        {errorMessage && (
          <div className="bg-[#ef4444]/20 text-[#ef4444] px-4 py-2 rounded border border-[#ef4444] text-sm">
            {errorMessage}
          </div>
        )}

        {isFetching ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-8 h-8 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin"></div>
            <span className="ml-3 text-[#4b5563]">読み込み中...</span>
          </div>
        ) : (
          <>
            {/* 生徒選択 */}
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1">
                生徒 <span className="text-red-500">*</span>
              </label>
              <Input
                placeholder="生徒名で検索..."
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                className="mb-2"
              />
              <Select value={studentId} onValueChange={setStudentId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="生徒を選択" />
                </SelectTrigger>
                <SelectContent>
                  {filteredStudents.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.last_name} {s.first_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 教材選択 */}
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1">
                教材 <span className="text-red-500">*</span>
              </label>
              <Select value={materialId} onValueChange={setMaterialId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="教材を選択" />
                </SelectTrigger>
                <SelectContent>
                  {materials.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 数量 */}
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1">
                数量
              </label>
              <Input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-24"
              />
            </div>

            {/* 備考 */}
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1">
                備考
              </label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="備考を入力（任意）"
                rows={3}
              />
            </div>
            {/* 請求自動反映 */}
            {activeBillingPeriod && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="autoBilling"
                  checked={autoBilling}
                  onChange={(e) => setAutoBilling(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-[#1e3a5f] focus:ring-[#1e3a5f]"
                />
                <label htmlFor="autoBilling" className="text-sm text-[#374151]">
                  請求に自動反映（{activeBillingPeriod.name}）
                </label>
              </div>
            )}
          </>
        )}

        {/* ボタン */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading || isFetching}>
            {isLoading ? '作成中...' : '発注を作成'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
