'use client';

/**
 * AdhocPlacementBar（Phase P2）
 *
 * 汎用配置モード（振替の保留プールからの配置 / 授業追加の座席表配置）中に上部へ出すミニバナー。
 * 「配置中: 〈対象者〉 〈科目〉 — 登録済み N コマ」と「完了」ボタンを表示する。
 * 見た目は TransferModeBar を踏襲（青系の細いバー）。
 */

import React from 'react';
import { Button } from '@/components/ui';
import { MapPin } from 'lucide-react';

export interface AdhocPlacementBarProps {
  mode: 'transfer' | 'lesson';
  /** 対象者名（生徒名 or 見込み客名）。 */
  displayName: string;
  /** 科目名（連結済み文字列）。空可。 */
  subjectName: string;
  /** これまでに登録したコマ数（lesson は連続配置でカウント、transfer は1件で終了）。 */
  placedCount: number;
  /** 目標コマ数（lesson のみ）。指定数に達したら親が自動終了する。 */
  targetCount?: number;
  /** 「完了」= 配置モード終了。 */
  onDone: () => void;
}

export function AdhocPlacementBar({
  mode,
  displayName,
  subjectName,
  placedCount,
  targetCount,
  onDone,
}: AdhocPlacementBarProps) {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded px-2 py-1.5 flex flex-wrap justify-between items-center gap-2 print:hidden">
      <div className="flex items-center gap-1.5 min-w-0">
        <MapPin className="text-blue-600 w-4 h-4 flex-shrink-0" />
        <span className="text-xs text-[var(--headline)] truncate">
          <strong>配置中:</strong> {displayName}
          {subjectName && <span className="ml-1 text-blue-700">{subjectName}</span>}
          <span className="mx-1.5 text-blue-300">—</span>
          {mode === 'transfer' ? (
            <span className="text-[var(--paragraph)]">振替先のセル／講師ブロックをクリック</span>
          ) : (
            <span className="text-[var(--paragraph)]">
              置きたいセル／講師をクリック（登録済み {placedCount}
              {targetCount != null ? ` / ${targetCount}` : ''} コマ）
            </span>
          )}
        </span>
      </div>
      <Button variant="secondary" size="sm" className="text-xs h-7" onClick={onDone}>
        完了
      </Button>
    </div>
  );
}
