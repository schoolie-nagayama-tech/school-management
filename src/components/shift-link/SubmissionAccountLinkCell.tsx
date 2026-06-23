'use client';

import { useState } from 'react';
import type { SchoolTeacherAccount } from '@/lib/api/school-teachers';

interface Props {
  /** 紐づけ済み user_id (null/未定義 = 未リンク) */
  userId: string | null | undefined;
  /** 教室の講師アカウント候補（読み込み中は空配列） */
  teacherAccounts: SchoolTeacherAccount[];
  /** 紐づけ中（API呼び出し中）かどうか */
  isUpdating: boolean;
  /** 紐づけ/解除コールバック。userId に null を渡すと解除 */
  onChange: (userId: string | null) => void | Promise<void>;
}

/**
 * 提出一覧の「リンク済みアカウント」セル。
 * - 未リンク: ドロップダウンで講師アカウントを選択
 * - リンク済み: 紐づけ済みアカウント名 + 「解除」ボタン
 * 他の提出に既に紐づいているアカウントは選択肢から除外する（呼び出し側で渡す）。
 */
export function SubmissionAccountLinkCell({
  userId,
  teacherAccounts,
  isUpdating,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);

  const linkedAccount = userId ? (teacherAccounts.find((a) => a.id === userId) ?? null) : null;

  if (userId && linkedAccount) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-text-heading">
          {linkedAccount.display_name ?? linkedAccount.email ?? '名称未設定'}
        </span>
        <button
          type="button"
          disabled={isUpdating}
          onClick={() => onChange(null)}
          className="text-xs text-text-muted hover:text-red-600 hover:underline disabled:opacity-50"
        >
          {isUpdating ? '更新中...' : '解除'}
        </button>
      </div>
    );
  }

  // 紐づけ済み user_id があるのに該当アカウントが選択肢にない場合（無効化や別教室）
  if (userId && !linkedAccount) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-text-muted italic">他教室/無効アカウント</span>
        <button
          type="button"
          disabled={isUpdating}
          onClick={() => onChange(null)}
          className="text-xs text-text-muted hover:text-red-600 hover:underline disabled:opacity-50"
        >
          {isUpdating ? '更新中...' : '解除'}
        </button>
      </div>
    );
  }

  return (
    <div className="text-sm">
      {open ? (
        <select
          autoFocus
          disabled={isUpdating}
          defaultValue=""
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            const id = e.target.value;
            if (id) {
              void onChange(id);
            }
            setOpen(false);
          }}
          className="px-2 py-1 border border-border rounded text-sm bg-surface-raised"
        >
          <option value="" disabled>
            アカウントを選択...
          </option>
          {teacherAccounts.length === 0 && (
            <option value="" disabled>
              候補がありません
            </option>
          )}
          {teacherAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.display_name ?? a.email ?? '名称未設定'}
              {a.email ? ` (${a.email})` : ''}
            </option>
          ))}
        </select>
      ) : (
        <button
          type="button"
          disabled={isUpdating}
          onClick={() => setOpen(true)}
          className="text-xs px-2 py-1 rounded border border-border text-text-body hover:bg-surface hover:text-text-heading disabled:opacity-50"
        >
          {isUpdating ? '更新中...' : '未リンク（紐づける）'}
        </button>
      )}
    </div>
  );
}
