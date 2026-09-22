'use client';

import { Shield } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { usePrivacyScreen } from './usePrivacyScreen';
import { examCountdownForSchool } from './examCountdown';

export function PrivacyScreen() {
  const { showOverlay, showCountdown, dismiss, isActive } = usePrivacyScreen();
  const { selectedSchoolId } = useAuth();

  if (!isActive || !showOverlay) {
    return null;
  }

  // 抽選に当たったときだけ日数を出す（100回に1回）。対象外の教室・年度なら null が返る。
  // オーバーレイが立っている間しかこの行に来ないので、レンダーのたびに数え直してよい。
  const countdown = showCountdown ? examCountdownForSchool(new Date(), selectedSchoolId) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={dismiss}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          dismiss();
        }
      }}
      className="fixed inset-0 z-[9999] flex items-center justify-center cursor-pointer privacy-screen-fade"
      style={{
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
      aria-label="再開"
    >
      <div className="flex flex-col items-center justify-center pointer-events-none select-none">
        {countdown ? (
          <>
            <p className="text-sm tracking-widest text-gray-500">{countdown.label}</p>
            <p className="mt-1 text-[64px] leading-none font-medium text-gray-800 tabular-nums">
              {countdown.days}
            </p>
            <p className="mt-2 text-sm text-gray-500">日　{countdown.dateLabel}</p>
            <Shield className="w-5 h-5 mt-5 text-gray-300" aria-hidden />
          </>
        ) : (
          <Shield className="w-16 h-16 text-gray-400" aria-hidden />
        )}
      </div>
    </div>
  );
}
