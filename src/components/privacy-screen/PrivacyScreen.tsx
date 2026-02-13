'use client';

import { Shield } from 'lucide-react';
import { usePrivacyScreen } from './usePrivacyScreen';

export function PrivacyScreen() {
  const { showOverlay, dismiss, isActive } = usePrivacyScreen();

  if (!isActive || !showOverlay) {
    return null;
  }

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
        <Shield className="w-16 h-16 text-gray-400" aria-hidden />
      </div>
    </div>
  );
}
