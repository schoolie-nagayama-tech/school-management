'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent, CardHeader, CardTitle, Loading } from '@/components/ui';
import {
  SelectShadcn as Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui';
import { Input } from '@/components/ui';
import { Label } from '@/components/ui';
import { ToastContainer } from '@/components/ui';
import { ClosedDayForm } from '@/components/schedule/ClosedDayForm';
import { ClosedDayList } from '@/components/schedule/ClosedDayList';
import { useToast } from '@/hooks/useToast';
import { useMasterData } from '@/contexts/MasterDataContext';
import { getClosedDays, createClosedDay, deleteClosedDay } from '@/lib/api/schedule';
import type { ScheduleClosedDay, ScheduleClosedDayFormData } from '@/types/schedule';
import type { School } from '@/types/database';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';

function getMonthRange(yearMonth: string): { from: string; to: string } {
  const [y, m] = yearMonth.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

export default function ClosedDaysPage() {
  const { profile } = useAuth();
  const { toasts, removeToast, success, error: toastError } = useToast();
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('');
  const [yearMonth, setYearMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [closedDays, setClosedDays] = useState<ScheduleClosedDay[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);

  const { schools: masterSchools } = useMasterData();

  useEffect(() => {
    if (masterSchools.length > 0) {
      setSchools(masterSchools);
      if (!selectedSchoolId) setSelectedSchoolId(masterSchools[0].id);
    }
  }, [masterSchools, selectedSchoolId]);

  useEffect(() => {
    if (!selectedSchoolId) return;
    setIsLoading(true);
    const { from, to } = getMonthRange(yearMonth);
    getClosedDays(selectedSchoolId, { from, to })
      .then(setClosedDays)
      .catch(() => toastError('休講日の取得に失敗しました'))
      .finally(() => setIsLoading(false));
  }, [selectedSchoolId, yearMonth, toastError]);

  const handleAdd = (form: ScheduleClosedDayFormData) => {
    const schoolId = form.is_global ? null : selectedSchoolId;
    return createClosedDay(schoolId, form).then(() => {
      success('休講日を登録しました');
      const { from, to } = getMonthRange(yearMonth);
      return getClosedDays(selectedSchoolId || '', { from, to }).then(setClosedDays);
    });
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteClosedDay(id);
      success('休講日を削除しました');
      const { from, to } = getMonthRange(yearMonth);
      const data = await getClosedDays(selectedSchoolId, { from, to });
      setClosedDays(data);
    } catch (e) {
      toastError((e as Error).message);
    }
  };

  const isAdmin =
    profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';
  if (!profile) {
    return (
      <AdminLayout headerTitle="座席表">
        <Loading size="md" />
      </AdminLayout>
    );
  }
  if (!isAdmin) {
    return (
      <AdminLayout headerTitle="座席表">
        <AccessDenied message="座席表の設定は管理者のみ利用できます。" />
      </AdminLayout>
    );
  }

  const selectedSchool = schools.find((s) => s.id === selectedSchoolId);

  return (
    <AdminLayout headerTitle="座席表">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/schedule"
              className="text-sm text-[var(--paragraph)] hover:text-[var(--primary)] transition-colors duration-150"
            >
              ← 座席表に戻る
            </Link>
            <h1 className="text-2xl font-bold text-[var(--headline)]">休講日設定</h1>
          </div>
          <div className="flex items-center gap-4">
            <Select value={selectedSchoolId} onValueChange={setSelectedSchoolId}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="教室を選択">{selectedSchool?.name}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {schools.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Label htmlFor="yearMonth" className="text-sm whitespace-nowrap">
                表示月
              </Label>
              <Input
                id="yearMonth"
                type="month"
                value={yearMonth}
                onChange={(e) => setYearMonth(e.target.value)}
                className="w-36"
              />
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>休講日一覧</CardTitle>
          </CardHeader>
          <CardContent>
            <ClosedDayList
              closedDays={closedDays}
              onDelete={handleDelete}
              onAdd={() => setFormOpen(true)}
              isLoading={isLoading}
            />
          </CardContent>
        </Card>
      </div>

      <ClosedDayForm open={formOpen} onClose={() => setFormOpen(false)} onSubmit={handleAdd} />

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}
