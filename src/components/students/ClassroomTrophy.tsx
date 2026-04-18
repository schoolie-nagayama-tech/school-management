'use client';

import {
  getSchoolTier,
  getNextSchoolTier,
  SCHOOL_TIER_LABEL,
  SCHOOL_TIER_SUBLABEL,
} from '@/lib/school-tier';

interface ClassroomTrophyProps {
  /** 在籍中の生徒数 */
  activeCount: number;
  /** 直近7日の未処理申込数（副指標） */
  unprocessedResponses?: number;
  /** 表示教室名（複数教室選択時は "すべての教室" 等） */
  schoolLabel?: string;
  /** 前月比などあれば（省略可） */
  delta?: number;
}

/**
 * 教室長向けのヒーローバナー。
 * 生徒数ベースの teacher-tier と同じ key 空間に乗せて CSS（tier-attendance,
 * tier-dot-*, tier-pill-*）を流用する。開くたびに "育っている感" を返すのが
 * 主目的なので、大きい数字 + 次ティアまでのカウントダウンを前面に出す。
 */
export function ClassroomTrophy({
  activeCount,
  unprocessedResponses = 0,
  schoolLabel,
  delta,
}: ClassroomTrophyProps) {
  const tier = getSchoolTier(activeCount);
  const next = getNextSchoolTier(activeCount);
  const remaining = next ? next.threshold - activeCount : 0;

  return (
    <section
      className="tier-attendance rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 shadow-sm mb-4 overflow-hidden relative"
      data-teacher-tier={tier.key}
    >
      <div className="relative z-10">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-gray-500 uppercase mb-1">
              {schoolLabel ? `${schoolLabel}・教室ステータス` : '教室ステータス'}
            </p>
            <h2 className="text-[22px] sm:text-[24px] font-bold text-gray-900 leading-tight tracking-tight flex items-center gap-2.5">
              {SCHOOL_TIER_LABEL[tier.key]}
              <span
                className={`tier-dot tier-dot-${tier.key} !w-2.5 !h-2.5`}
                aria-hidden
              />
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              {SCHOOL_TIER_SUBLABEL[tier.key]}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-4">
          <div>
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
              在籍生徒
            </p>
            <p className="text-[38px] sm:text-[42px] font-bold text-gray-900 tabular-nums leading-none">
              {activeCount}
              <span className="text-lg text-gray-400 font-normal ml-1">人</span>
            </p>
            {typeof delta === 'number' && delta !== 0 && (
              <p
                className={`text-xs font-semibold mt-1 ${
                  delta > 0 ? 'text-emerald-600' : 'text-gray-500'
                }`}
              >
                {delta > 0 ? '▲' : '▽'} 先月比 {Math.abs(delta)} 人
              </p>
            )}
          </div>

          {unprocessedResponses > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                未処理の申込
              </p>
              <p className="text-[22px] sm:text-[24px] font-bold text-gray-900 tabular-nums leading-none">
                {unprocessedResponses}
                <span className="text-sm text-gray-400 font-normal ml-1">件</span>
              </p>
            </div>
          )}

          <div className="ml-auto text-right">
            {next ? (
              <>
                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  次のティアまで
                </p>
                <p className="text-sm">
                  あと{' '}
                  <span className="text-gray-900 font-bold text-xl tabular-nums">
                    {remaining}
                  </span>
                  <span className="text-gray-400 text-xs ml-0.5">人で</span>{' '}
                  <span
                    className={`tier-pill tier-pill-${next.key} px-1.5 py-0.5 rounded text-[11px] font-bold`}
                  >
                    {SCHOOL_TIER_LABEL[next.key]}
                  </span>
                </p>
              </>
            ) : (
              <>
                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  最高位
                </p>
                <span
                  className={`tier-pill tier-pill-${tier.key} px-2 py-1 rounded-full text-xs font-bold`}
                >
                  {SCHOOL_TIER_LABEL[tier.key]}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
