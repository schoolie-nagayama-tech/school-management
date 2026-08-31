'use client';

import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui';
import { Button, Input } from '@/components/ui';

export interface TeacherOption {
  id: string;
  display_name: string | null;
  email: string | null;
  is_active?: boolean;
  user_schools?: Array<{ school_id: string }>;
}

interface AddTeacherModalProps {
  open: boolean;
  onClose: () => void;
  teachers: TeacherOption[];
  schoolId: string;
  /** このコマに既に表示されている講師ID（除外するため） */
  existingTeacherIds?: string[];
  onSelect: (teacherId: string) => void;
}

/** 絞り込み欄を出す件数のしきい値。これ以下なら一覧だけで十分見渡せる。 */
const FILTER_THRESHOLD = 12;

export function AddTeacherModal({
  open,
  onClose,
  teachers,
  schoolId,
  existingTeacherIds = [],
  onSelect,
}: AddTeacherModalProps) {
  const [query, setQuery] = useState('');

  // 教室に所属・有効・このコマに未追加の講師のみ表示
  const availableTeachers = useMemo(
    () =>
      teachers.filter(
        (t) =>
          t.is_active !== false &&
          t.user_schools?.some((us) => us.school_id === schoolId) &&
          !existingTeacherIds.includes(t.id)
      ),
    [teachers, schoolId, existingTeacherIds]
  );

  // 開き直すたびに絞り込みを白紙に戻す（前回の入力が残っていると「講師がいない」に見える）
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const label = (t: TeacherOption) => t.display_name || t.email || t.id;

  const shownTeachers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return availableTeachers;
    return availableTeachers.filter((t) => label(t).toLowerCase().includes(q));
  }, [availableTeachers, query]);

  /**
   * 講師カードは1クリックで確定する。ドロップダウン＋確定ボタンだった頃は、
   * 開いたリストがモーダルの overflow に切られて選択そのものができなかった。
   * 追加した講師はコマ上から外せるので、押し間違いは1クリックで戻せる。
   */
  const handlePick = (teacherId: string) => {
    onSelect(teacherId);
    onClose();
  };

  return (
    /* Header / Footer は DialogContent の外に置く（中に入れるとスクロール領域に
       巻き込まれ、タイトルが上端で切れ、ボタンが画面外に出る）。幅は Dialog の size で決まる。 */
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} size="lg">
      <DialogHeader>
        <DialogTitle>講師を追加</DialogTitle>
      </DialogHeader>
      <DialogContent>
        {availableTeachers.length === 0 ? (
          <p className="py-4 text-center text-sm text-text-muted">
            このコマに追加できる講師はいません
          </p>
        ) : (
          <div className="space-y-3">
            {availableTeachers.length > FILTER_THRESHOLD && (
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="名前で絞り込む"
                className="w-full"
              />
            )}
            {shownTeachers.length === 0 ? (
              <p className="py-4 text-center text-sm text-text-muted">
                「{query}」に一致する講師はいません
              </p>
            ) : (
              <div className="grid max-h-[55vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                {shownTeachers.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handlePick(t.id)}
                    className="rounded-lg border border-border bg-surface-raised px-3 py-3 text-left text-sm font-medium text-text-body transition-colors hover:border-primary hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {label(t)}
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-text-faint">クリックするとこのコマに追加します</p>
          </div>
        )}
      </DialogContent>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          キャンセル
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
