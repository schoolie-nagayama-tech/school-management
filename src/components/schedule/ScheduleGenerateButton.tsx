'use client';

import { useState } from 'react';
import { Button, Spinner } from '@/components/ui';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui';
import { Calendar } from 'lucide-react';
import { generateWeeklySchedule, hasEntriesForWeek } from '@/lib/api/schedule';

interface ScheduleGenerateButtonProps {
  schoolId: string;
  weekStartDate: string;
  onGenerated?: (count: number) => void;
  userId?: string;
}

export function ScheduleGenerateButton({
  schoolId,
  weekStartDate,
  onGenerated,
  userId,
}: ScheduleGenerateButtonProps) {
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [hasExisting, setHasExisting] = useState(false);

  const handleClick = async () => {
    if (!schoolId || !weekStartDate) return;
    setLoading(true);
    try {
      const exists = await hasEntriesForWeek(schoolId, weekStartDate);
      setHasExisting(exists);
      setConfirmOpen(true);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!schoolId || !weekStartDate) return;
    setLoading(true);
    try {
      const result = await generateWeeklySchedule(schoolId, weekStartDate, userId);
      setConfirmOpen(false);
      onGenerated?.(result.entries_created);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button onClick={handleClick} disabled={loading}>
        {loading ? (
          <Spinner size="sm" tone="current" className="mr-2" />
        ) : (
          <Calendar className="mr-2 h-4 w-4" />
        )}
        スケジュール生成
      </Button>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>スケジュールを生成しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {hasExisting
                ? 'この週には既にスケジュールが登録されています。上書きしますか？'
                : '通塾日程から、選択中の週のスケジュールを一括生成します。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmOpen(false)}>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>
              {loading ? '生成中...' : '生成する'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
