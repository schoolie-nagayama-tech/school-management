'use client';

/**
 * ステップ2: 小集団・プログラミング（特別講座）。
 * モック `apply-mock` の StepCourses を本実装へ移植。
 * 日時固定・振替不可（決定37）なので可能日程は聞かず、「参加する」を選ぶだけの単純な操作にする（決定36）。
 * 途中参加は次の未開催回から自動（決定45・54）。残り回数・料金はローダーが計算済みの
 * `remainingCount` / `sessions[].held` をそのまま使う（クライアント側で「今日」を再判定しない）。
 */
import { AlertCircle, Check } from 'lucide-react';
import type { ApplyCourse } from '@/types/koushu-apply';
import { WEEKDAY, dow, mmdd, yen } from './koushuApplyClientUtils';

interface StepCoursesProps {
  courses: ApplyCourse[];
  courseJoin: Set<string>;
  toggleCourse: (courseId: string) => void;
  totalCourseFee: number;
}

export function StepCourses({
  courses,
  courseJoin,
  toggleCourse,
  totalCourseFee,
}: StepCoursesProps) {
  if (courses.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--stroke)] p-4 text-center">
        <p className="text-xs text-[var(--paragraph)]">
          この期間に開催予定の小集団・プログラミングはありません。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--paragraph)]">
        小集団・プログラミングの開催予定です。日程は選べません。参加する講座があれば「参加する」を選んでください。
      </p>

      {courses.map((c) => {
        const joined = courseJoin.has(c.courseId);
        const closed = c.remainingCount <= 0;
        const fee = c.unitPrice * c.remainingCount;
        const startIndex = c.sessions.findIndex((s) => !s.held);
        const startSessionNumber = startIndex >= 0 ? startIndex + 1 : c.sessions.length + 1;
        const fullyJoined = startSessionNumber === 1;

        return (
          <div
            key={c.courseId}
            className={`rounded-xl border p-3 ${
              joined ? 'border-ink bg-gray-50' : 'border-[var(--stroke)]'
            } ${closed ? 'opacity-60' : ''}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--headline)]">{c.name}</p>
                <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-[var(--paragraph)]">
                  {c.formation}
                </span>
              </div>
            </div>

            <div className="mt-2 rounded-lg border border-warning bg-warning-subtle px-2.5 py-2 flex gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
              <p className="text-[11px] text-[var(--headline)] leading-relaxed">
                日時は決まっており、変更・振替はできません
                <br />
                途中からのご参加もできます（参加回ぶんのみのご請求）
                <br />
                参加開始をさらに遅らせたい場合は教室へご連絡ください
              </p>
            </div>

            <div className="mt-2 rounded-lg border border-[var(--stroke)] overflow-hidden">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="bg-gray-50 text-[var(--paragraph)]">
                    <th className="py-1 px-2 text-left font-medium">日程</th>
                    <th className="py-1 px-2 text-left font-medium">時間</th>
                    <th className="py-1 px-2 text-left font-medium w-16">状態</th>
                  </tr>
                </thead>
                <tbody>
                  {c.sessions.map((s, i) => (
                    <tr
                      key={s.date}
                      className={`border-t border-gray-100 ${s.held ? 'bg-gray-50' : ''}`}
                    >
                      <td
                        className={`py-1 px-2 ${s.held ? 'text-gray-400' : 'text-[var(--headline)]'}`}
                      >
                        第{i + 1}回 {mmdd(s.date)}({WEEKDAY[dow(s.date)]})
                      </td>
                      <td
                        className={`py-1 px-2 tabular-nums ${s.held ? 'text-gray-400' : 'text-[var(--headline)]'}`}
                      >
                        {s.startTime}〜{s.endTime}
                      </td>
                      <td className="py-1 px-2">
                        {s.held && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-500">
                            開催済み
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--stroke)]">
              {closed ? (
                <p className="text-[11px] text-[var(--paragraph)]">受付終了（全回開催済み）</p>
              ) : (
                <p className="text-[11px] text-[var(--paragraph)]">
                  {!fullyJoined ? (
                    <>
                      {yen(c.unitPrice)} × 残り{c.remainingCount}回（全{c.sessions.length}回中） ={' '}
                      <span className="text-[var(--headline)] font-medium">{yen(fee)}</span>
                    </>
                  ) : (
                    <>
                      {yen(c.unitPrice)} × {c.sessions.length}回 ={' '}
                      <span className="text-[var(--headline)] font-medium">{yen(fee)}</span>
                    </>
                  )}
                </p>
              )}
              <button
                type="button"
                onClick={() => toggleCourse(c.courseId)}
                disabled={closed}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 active:scale-95 disabled:opacity-50 disabled:active:scale-100 ${
                  joined
                    ? 'bg-ink text-white'
                    : 'border border-[var(--stroke)] text-[var(--headline)]'
                }`}
              >
                {joined && <Check className="w-3.5 h-3.5" />}
                {joined ? '参加します' : '参加する'}
              </button>
            </div>
          </div>
        );
      })}

      <div className="rounded-xl bg-gray-50 p-3 flex items-center justify-between">
        <span className="text-sm text-[var(--headline)]">小集団・プログラミング 合計</span>
        <span className="text-base font-semibold text-[var(--headline)] tabular-nums">
          {yen(totalCourseFee)}
        </span>
      </div>
      <p className="text-[10px] text-[var(--paragraph)]">
        税込。通常授業の差し引きはコース料金には適用されません（決定43）。
      </p>
    </div>
  );
}
