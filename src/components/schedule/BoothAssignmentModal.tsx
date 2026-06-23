'use client';

/**
 * 日次ブース番号設定モーダル
 *
 * 用途：印刷前に「この日の各講師にブース番号を割り当てる」操作を行う。
 * 印刷ボタンの隣に「ブース番号設定」のアクションがあって、そこから開く想定。
 *
 * 仕様：
 *  - その日に entries に登場する講師を全員リストアップ
 *  - 各講師に 0（=未設定）〜 N（=ブース番号）を入力
 *  - 番号 0 / 空 は未設定として保存しない
 *  - 同じ番号が複数講師に割り当てられたらエラー表示
 *  - 保存ボタンで一括 setDailyBoothAssignments
 *  - 「自動割当」ボタンで講師名順に 1, 2, 3... を割り振る補助あり
 */

import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui';
import { Button } from '@/components/ui';
import type { ScheduleEntry } from '@/types/schedule';
import { getDailyBoothAssignments, setDailyBoothAssignments } from '@/lib/api/schedule-daily-booth';
import { useToast } from '@/hooks/useToast';
import { Wand2 } from 'lucide-react';

export interface BoothAssignmentModalProps {
  open: boolean;
  onClose: () => void;
  schoolId: string;
  /** 対象日 'YYYY-MM-DD' */
  date: string;
  /** 当日のエントリ（講師抽出に使用） */
  entries: ScheduleEntry[];
  /** 教室全体の同時席数（番号上限・自動割当に使用） */
  totalSeats: number;
  /** 保存成功時に呼ぶ。親で再フェッチして印刷ビューに反映する */
  onSaved?: () => void;
}

interface Row {
  teacherId: string;
  teacherName: string;
  /** 0 は未設定扱い */
  boothNo: number;
}

export function BoothAssignmentModal({
  open,
  onClose,
  schoolId,
  date,
  entries,
  totalSeats,
  onSaved,
}: BoothAssignmentModalProps) {
  const { success, error: toastError } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // 当日に登場するユニークな講師（id + 表示名）
  const teachers = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entries) {
      if (e.entry_date !== date) continue;
      if (e.status === 'cancelled' || e.status === 'transferred_out') continue;
      const name = e.teacher?.display_name || e.teacher?.email || e.teacher_id;
      if (!map.has(e.teacher_id)) map.set(e.teacher_id, name);
    }
    // 名前順に
    return Array.from(map.entries())
      .map(([teacherId, teacherName]) => ({ teacherId, teacherName }))
      .sort((a, b) => a.teacherName.localeCompare(b.teacherName, 'ja'));
  }, [entries, date]);

  // モーダル開いた時に、既存割当を取得 → 行初期化
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const existing = await getDailyBoothAssignments(schoolId, date);
        const map = new Map(existing.map((a) => [a.teacher_id, a.booth_no]));
        setRows(
          teachers.map((t) => ({
            teacherId: t.teacherId,
            teacherName: t.teacherName,
            boothNo: map.get(t.teacherId) ?? 0,
          }))
        );
      } catch (e) {
        toastError(e instanceof Error ? e.message : '読み込みに失敗しました');
      }
    })();
  }, [open, schoolId, date, teachers, toastError]);

  // 番号重複検出（0は重複OK＝未設定）
  const duplicateBooths = useMemo(() => {
    const counts = new Map<number, number>();
    for (const r of rows) {
      if (r.boothNo > 0) counts.set(r.boothNo, (counts.get(r.boothNo) ?? 0) + 1);
    }
    return new Set(
      Array.from(counts.entries())
        .filter(([, c]) => c > 1)
        .map(([n]) => n)
    );
  }, [rows]);

  const hasDuplicates = duplicateBooths.size > 0;

  // 名前順に1から自動採番（既存設定は上書き）
  const autoAssign = () => {
    setRows((prev) =>
      prev.map((r, idx) => ({ ...r, boothNo: idx + 1 <= totalSeats ? idx + 1 : 0 }))
    );
  };

  // 全クリア
  const clearAll = () => {
    setRows((prev) => prev.map((r) => ({ ...r, boothNo: 0 })));
  };

  const onSave = async () => {
    if (hasDuplicates) {
      toastError('同じ番号が複数の講師に割り当てられています');
      return;
    }
    setIsSaving(true);
    try {
      const payload = rows
        .filter((r) => r.boothNo > 0)
        .map((r) => ({ teacher_id: r.teacherId, booth_no: r.boothNo }));
      await setDailyBoothAssignments(schoolId, date, payload);
      success('ブース番号を保存しました');
      onSaved?.();
      onClose();
    } catch (e) {
      toastError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>ブース番号設定 ({date})</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>
              印刷時に講師名の隣に表示される番号です。教室全体席数: <strong>{totalSeats}</strong>
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={autoAssign} type="button">
                <Wand2 className="w-3.5 h-3.5 mr-1" />
                自動割当
              </Button>
              <Button variant="outline" size="sm" onClick={clearAll} type="button">
                全クリア
              </Button>
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-muted">
              この日に授業のある講師が見つかりません
            </p>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto border rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-surface sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">講師名</th>
                    <th className="text-left px-3 py-2 font-medium w-32">ブース番号</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.teacherId} className="border-t">
                      <td className="px-3 py-2">{r.teacherName}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          max={Math.max(totalSeats, 99)}
                          value={r.boothNo || ''}
                          placeholder="未設定"
                          className={`w-20 px-2 py-1 border rounded ${
                            duplicateBooths.has(r.boothNo)
                              ? 'border-danger bg-danger-subtle'
                              : 'border-border-default'
                          }`}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            const next = Number.isNaN(v) ? 0 : Math.max(0, v);
                            setRows((prev) =>
                              prev.map((row) =>
                                row.teacherId === r.teacherId ? { ...row, boothNo: next } : row
                              )
                            );
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {hasDuplicates && (
            <div className="text-sm text-danger">
              重複している番号:{' '}
              {Array.from(duplicateBooths)
                .sort((a, b) => a - b)
                .join(', ')}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            キャンセル
          </Button>
          <Button onClick={onSave} disabled={isSaving || hasDuplicates}>
            {isSaving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
