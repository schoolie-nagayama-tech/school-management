'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getPendingAttendanceCount } from '@/lib/api/attendance';

/**
 * 自分が次に動かすべき出勤簿の件数。
 *
 * 教室長は「講師から提出された（＝確認して管理者へ出す）」件数、
 * 管理者・オーナーは「承認待ち」の件数。対象ステータスの定義は API 側に置いている。
 *
 * ★ 出勤簿には通知が無く、画面を開くまで気づけなかったため、
 *   ヘッダーのバッジとお知らせバーで件数だけ外に出す。
 *
 * @returns 件数。対象ロール外・未ログイン・取得失敗は 0
 */
export function usePendingAttendanceCount(): number {
  const { profile, getSelectedSchoolIds } = useAuth();
  const [count, setCount] = useState(0);

  const role = profile?.role;
  // 教室切替で対象が変わるため、選択中の教室IDを依存に含める（配列は毎回新しいので文字列化）
  const schoolIds = getSelectedSchoolIds();
  const schoolKey = schoolIds.join(',');

  useEffect(() => {
    if (!role) {
      setCount(0);
      return;
    }
    let cancelled = false;
    getPendingAttendanceCount(schoolKey ? schoolKey.split(',') : [], role)
      .then((n) => {
        if (!cancelled) setCount(n);
      })
      .catch(() => {
        if (!cancelled) setCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [role, schoolKey]);

  return count;
}
