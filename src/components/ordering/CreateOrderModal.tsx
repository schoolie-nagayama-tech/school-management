'use client';

import { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Input, Textarea, InlineLoading } from '@/components/ui';
import {
  SelectShadcn as Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui';
import { Plus, Minus, UserPlus } from 'lucide-react';
import { getStudents } from '@/lib/api/students';
import { getMaterials } from '@/lib/api/inventory';
import { createOrder, createOrderWithBilling } from '@/lib/api/ordering';
import { getBillingPeriods } from '@/lib/api/billing';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { formatGradeLabelOrEmpty } from '@/lib/utils/gradeLabel';
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
  const [isSample, setIsSample] = useState(false);
  const [studentIds, setStudentIds] = useState<string[]>(['']);
  const [materialId, setMaterialId] = useState('');
  const [notes, setNotes] = useState('');
  const [studentSearch, setStudentSearch] = useState('');

  const quantity = studentIds.length;

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
      setStudents(studentsData.filter((s) => s.status === 'active'));
      setMaterials(materialsData);
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
      setIsSample(false);
      setStudentIds(['']);
      setMaterialId('');
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

  // 冊数を増やす
  const addSlot = () => {
    if (studentIds.length >= 20) return;
    setStudentIds((prev) => [...prev, '']);
  };

  // 冊数を減らす
  const removeSlot = (index: number) => {
    if (studentIds.length <= 1) return;
    setStudentIds((prev) => prev.filter((_, i) => i !== index));
  };

  // 生徒を選択
  const setStudentAt = (index: number, value: string) => {
    setStudentIds((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!materialId) {
      setErrorMessage('教材を選択してください');
      return;
    }

    if (!isSample) {
      const filledStudentIds = studentIds.filter((id) => id !== '');
      if (filledStudentIds.length === 0) {
        setErrorMessage('生徒を選択してください（見本の場合は「見本発注」にチェック）');
        return;
      }
    }

    setIsLoading(true);
    setErrorMessage('');
    try {
      const schoolId = schoolIds.length > 0 ? schoolIds[0] : undefined;

      if (isSample) {
        // 見本発注: 生徒なし・1件のみ
        const orderData = {
          material_id: materialId,
          is_sample: true,
          quantity: 1,
          notes: notes || undefined,
        };
        await createOrder(orderData, schoolId);
      } else {
        const filledStudentIds = studentIds.filter((id) => id !== '');
        for (const sid of filledStudentIds) {
          const orderData = {
            material_id: materialId,
            student_id: sid,
            quantity: 1,
            notes: notes || undefined,
          };

          if (autoBilling && activeBillingPeriod) {
            await createOrderWithBilling(orderData, activeBillingPeriod.id, schoolId);
          } else {
            await createOrder(orderData, schoolId);
          }
        }
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

  // 既に他のスロットで選択済みの生徒を除外するヘルパー
  const getAvailableStudents = (currentIndex: number) => {
    const selectedIds = new Set(studentIds.filter((_, i) => i !== currentIndex).filter(Boolean));
    return filteredStudents.filter((s) => !selectedIds.has(s.id));
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
          <div className="py-8">
            <InlineLoading />
          </div>
        ) : (
          <>
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

            {/* 見本発注チェック */}
            <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <input
                type="checkbox"
                id="isSample"
                checked={isSample}
                onChange={(e) => {
                  setIsSample(e.target.checked);
                  if (e.target.checked) {
                    setStudentIds(['']);
                    setStudentSearch('');
                  }
                }}
                className="h-4 w-4 rounded border-gray-300 text-[#1e3a5f] focus:ring-[#1e3a5f]"
              />
              <label htmlFor="isSample" className="text-sm text-[#374151] font-medium">
                見本発注（生徒なし）
              </label>
            </div>

            {/* 冊数と生徒選択（見本でない場合のみ） */}
            {!isSample && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-[#374151]">
                    生徒 <span className="text-red-500">*</span>
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      {quantity}冊 / {studentIds.filter((id) => id !== '').length}名選択済み
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={addSlot}
                    disabled={studentIds.length >= 20}
                    className="flex items-center gap-1 text-xs text-[#1e3a5f] hover:text-[#2d4a6f] disabled:opacity-40 disabled:cursor-not-allowed transition-[color] duration-150 ease-out"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    冊数を追加
                  </button>
                </div>

                {/* 生徒検索 */}
                <Input
                  placeholder="生徒名で検索..."
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  className="mb-2"
                />

                {/* 生徒スロット一覧 */}
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {studentIds.map((sid, index) => {
                    const available = getAvailableStudents(index);
                    return (
                      <div key={index} className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-6 text-right flex-shrink-0">
                          {index + 1}.
                        </span>
                        <Select value={sid} onValueChange={(v) => setStudentAt(index, v)}>
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="生徒を選択" />
                          </SelectTrigger>
                          <SelectContent>
                            {available.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {formatGradeLabelOrEmpty(s.grade)} {s.last_name} {s.first_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {studentIds.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeSlot(index)}
                            className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-[color] duration-150 ease-out flex-shrink-0"
                            title="この行を削除"
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* + ボタン（下部） */}
                {studentIds.length < 20 && (
                  <button
                    type="button"
                    onClick={addSlot}
                    className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 border border-dashed border-gray-300 rounded-lg text-xs text-gray-500 hover:border-[#1e3a5f] hover:text-[#1e3a5f] transition-[color] duration-150 ease-out"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    もう1冊追加
                  </button>
                )}
              </div>
            )}

            {/* 備考 */}
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1">備考</label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="備考を入力（任意）"
                rows={2}
              />
            </div>

            {/* 請求自動反映（見本でない場合のみ） */}
            {!isSample && activeBillingPeriod && (
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
            {isLoading
              ? '作成中...'
              : isSample
                ? '見本を発注'
                : quantity > 1
                  ? `${studentIds.filter((id) => id !== '').length}件をまとめて発注`
                  : '発注を作成'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
