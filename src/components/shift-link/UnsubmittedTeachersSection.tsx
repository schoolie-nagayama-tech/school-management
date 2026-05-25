'use client';

import type { SchoolTeacherAccount } from '@/lib/api/school-teachers';

interface Props {
  /** 教室の講師アカウント一覧 */
  teacherAccounts: SchoolTeacherAccount[];
  /** 既に提出があり user_id が紐づいているアカウントの ID 集合 */
  submittedUserIds: Set<string>;
  /** 講師アカウント数取得中はローディング表示にする */
  isLoading?: boolean;
}

/**
 * 提出一覧ページの「未提出講師」セクション。
 * 教室所属の role=teacher のアカウントのうち、当該シフト設定への提出が
 * 紐づいていないアカウントを一覧表示する。
 */
export function UnsubmittedTeachersSection({
  teacherAccounts,
  submittedUserIds,
  isLoading,
}: Props) {
  const unsubmitted = teacherAccounts.filter((a) => !submittedUserIds.has(a.id));

  return (
    <details className="bg-surface-raised rounded-xl border border-border overflow-hidden mb-6">
      <summary className="cursor-pointer px-4 py-3 font-medium text-text-heading hover:bg-surface-hover transition-colors">
        未提出講師
        <span className="ml-2 text-sm text-text-muted">
          {isLoading ? '...' : `${unsubmitted.length} 名 / 教室登録 ${teacherAccounts.length} 名`}
        </span>
      </summary>
      <div className="px-4 py-3 border-t border-border">
        {isLoading ? (
          <p className="text-sm text-text-muted">読み込み中...</p>
        ) : teacherAccounts.length === 0 ? (
          <p className="text-sm text-text-muted">
            この教室には講師アカウントが登録されていません。
          </p>
        ) : unsubmitted.length === 0 ? (
          <p className="text-sm text-text-body">全員提出済みです。</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {unsubmitted.map((a) => (
              <li
                key={a.id}
                className="px-3 py-1.5 rounded-lg border border-border text-sm bg-surface text-text-body"
                title={a.email ?? ''}
              >
                {a.display_name ?? a.email ?? '名称未設定'}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
