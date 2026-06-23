'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getDefaultSchoolId } from '@/lib/api/schools';
import { getActiveTimeSlots } from '@/lib/api/schedule';

/**
 * 現在選択中の教室のコマ時間マスタ（schedule_time_slots）を取得する。
 * シフト設定画面など、講習時間帯をマスタから引きたい画面で共有して使う。
 *
 * - AuthContext の selectedSchoolId が確定するまで fetch しない（fetch ミスマッチ防止）。
 * - 返り値は "HH:MM-HH:MM" 形式の配列＆カンマ連結文字列。
 */
export function useMasterTimeSlots(): {
  slots: string[];
  slotsString: string;
  isLoading: boolean;
} {
  const { selectedSchoolId, getSelectedSchoolIds } = useAuth();
  const [slots, setSlots] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // AuthContext のロード完了前は何もしない（selectedSchoolId が null）
    if (!selectedSchoolId) return;

    let cancelled = false;
    setIsLoading(true);

    const schoolIds = getSelectedSchoolIds();
    const schoolId = schoolIds.length > 0 ? schoolIds[0] : getDefaultSchoolId();

    getActiveTimeSlots(schoolId)
      .then((rows) => {
        if (cancelled) return;
        setSlots(rows.map((r) => `${r.start_time.slice(0, 5)}-${r.end_time.slice(0, 5)}`));
      })
      .catch(() => {
        if (cancelled) return;
        setSlots([]);
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSchoolId]);

  return { slots, slotsString: slots.join(','), isLoading };
}
