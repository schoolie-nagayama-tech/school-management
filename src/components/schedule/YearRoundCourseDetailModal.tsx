'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Users } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Loading,
} from '@/components/ui';
import { SessionDatesEditor } from './SessionDatesEditor';
import {
  getKoushuOverrides,
  getSpecialCourseRoster,
  upsertKoushuOverride,
  deleteKoushuOverride,
  type SpecialCourse,
  type SpecialCourseRosterRow,
} from '@/lib/api/specialCourses';
import {
  resolveKoushuOverride,
  type SpecialCourseKoushuOverride,
  type SpecialCourseSession,
} from '@/lib/utils/specialCourses';
import type { KoushuPeriodInfo } from '@/lib/api/koushu-period';

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course: SpecialCourse;
  /** 上書きを登録できる講習期間。0件なら上書きセクションは案内だけ出す。 */
  periods: KoushuPeriodInfo[];
}

/** 時間割の1行（曜日×コマ×講師）にまとめた表示単位 */
interface ScheduleGroup {
  key: string;
  dayOfWeek: number;
  slotNumber: number | null;
  startTime: string | null;
  endTime: string | null;
  teacherName: string | null;
  members: SpecialCourseRosterRow[];
}

/**
 * 講座に紐づく枠を「曜日×コマ×講師」でまとめる。
 * 枠は生徒1名につき1行（schedule_regular_patterns）なので、そのままだと名簿が
 * 時間割に見えない。クラス単位にまとめて初めて「毎週火曜3限・田中先生・5名」と読める。
 */
function groupSchedule(rows: SpecialCourseRosterRow[]): ScheduleGroup[] {
  const map = new Map<string, ScheduleGroup>();
  for (const r of rows) {
    const key = `${r.dayOfWeek}_${r.timeSlotId}_${r.teacherId ?? 'none'}`;
    const found = map.get(key);
    if (found) {
      found.members.push(r);
    } else {
      map.set(key, {
        key,
        dayOfWeek: r.dayOfWeek,
        slotNumber: r.slotNumber,
        startTime: r.startTime,
        endTime: r.endTime,
        teacherName: r.teacherName,
        members: [r],
      });
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => a.dayOfWeek - b.dayOfWeek || (a.slotNumber ?? 0) - (b.slotNumber ?? 0)
  );
}

/**
 * 通年講座の詳細モーダル。
 *
 * 上段 = 時間割と名簿（座席表の形態ボードで作った「講座の枠」の読み取り一覧。ここでは編集しない）。
 * 下段 = 講習期の時間上書き（行が無ければ通常の時間割どおり開催）。
 */
export function YearRoundCourseDetailModal({ open, onOpenChange, course, periods }: Props) {
  const [roster, setRoster] = useState<SpecialCourseRosterRow[]>([]);
  const [overrides, setOverrides] = useState<SpecialCourseKoushuOverride[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 上書き編集の対象講習期（未選択=編集していない）と編集中の開催予定
  const [editingPeriod, setEditingPeriod] = useState<KoushuPeriodInfo | null>(null);
  const [editingSessions, setEditingSessions] = useState<SpecialCourseSession[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rosterRows, overrideRows] = await Promise.all([
        // asOfDate=今日: 退塾・曜日変更で終了した履歴行を名簿に混ぜない
        getSpecialCourseRoster(course.id, new Date().toISOString().slice(0, 10)),
        getKoushuOverrides(course.id),
      ]);
      setRoster(rosterRows);
      setOverrides(overrideRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [course.id]);

  useEffect(() => {
    if (!open) return;
    setEditingPeriod(null);
    setEditingSessions([]);
    load();
  }, [open, load]);

  const startEditOverride = (period: KoushuPeriodInfo) => {
    const { sessions } = resolveKoushuOverride(overrides, period.season, period.year);
    setEditingPeriod(period);
    setEditingSessions(sessions);
    setError(null);
  };

  const handleSaveOverride = async () => {
    if (!editingPeriod) return;
    if (editingSessions.some((s) => !s.date || !s.start_time || !s.end_time)) {
      setError('開催予定に未入力の行があります');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await upsertKoushuOverride(
        course.id,
        editingPeriod.season,
        editingPeriod.year,
        editingSessions
      );
      setEditingPeriod(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleClearOverride = async (period: KoushuPeriodInfo) => {
    setSaving(true);
    setError(null);
    try {
      await deleteKoushuOverride(course.id, period.season, period.year);
      if (editingPeriod?.id === period.id) setEditingPeriod(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '解除に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const groups = groupSchedule(roster);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg">
      <DialogHeader>
        <DialogTitle>{course.name}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        {loading ? (
          <Loading size="md" />
        ) : (
          <div className="space-y-6">
            {/* 時間割・名簿（読み取り専用） */}
            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-[var(--paragraph)]" />
                <h3 className="text-sm font-bold text-[var(--headline)]">時間割と名簿</h3>
                <Badge variant="secondary">{roster.length}名</Badge>
              </div>
              <p className="text-xs text-[var(--paragraph)]">
                座席表の形態ボードで「講座の枠」を作ると、ここに反映されます（この画面では編集できません）。
              </p>
              {groups.length === 0 ? (
                <p className="text-xs text-[var(--paragraph)] bg-gray-50 border border-[var(--stroke)] rounded-md px-3 py-3">
                  まだ枠がありません。座席表でこの講座の枠を作ってください。
                </p>
              ) : (
                <div className="space-y-2">
                  {groups.map((g) => (
                    <div
                      key={g.key}
                      className="border border-[var(--stroke)] rounded-lg px-3 py-2 bg-white"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-sm font-medium text-[var(--headline)]">
                          毎週{DOW_LABELS[g.dayOfWeek]}曜
                          {g.slotNumber != null ? ` ${g.slotNumber}限` : ''}
                          {g.startTime && g.endTime
                            ? ` ${g.startTime.slice(0, 5)}〜${g.endTime.slice(0, 5)}`
                            : ''}
                        </span>
                        <span className="text-xs text-[var(--paragraph)]">
                          {g.teacherName ?? '担当未決定'} ・ {g.members.length}名
                          {course.capacity != null ? ` / ${course.capacity}名` : ''}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[var(--paragraph)]">
                        {g.members.map((m) => m.studentName).join('、')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* 講習期の上書き */}
            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-[var(--paragraph)]" />
                <h3 className="text-sm font-bold text-[var(--headline)]">講習期の上書き</h3>
              </div>
              <p className="text-xs text-[var(--paragraph)]">
                上書きを登録しない講習期は、通常の時間割どおり開催します。
              </p>
              {periods.length === 0 ? (
                <p className="text-xs text-[var(--paragraph)] bg-gray-50 border border-[var(--stroke)] rounded-md px-3 py-3">
                  講習期間が設定されていません。先に講習期間を設定してください。
                </p>
              ) : (
                <div className="space-y-2">
                  {periods.map((p) => {
                    const { overridden, sessions } = resolveKoushuOverride(
                      overrides,
                      p.season,
                      p.year
                    );
                    return (
                      <div
                        key={p.id}
                        className="border border-[var(--stroke)] rounded-lg px-3 py-2 bg-white space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-sm font-medium text-[var(--headline)]">
                            {p.label}
                          </span>
                          <div className="flex items-center gap-2">
                            {overridden ? (
                              <Badge>上書きあり（{sessions.length}回）</Badge>
                            ) : (
                              <Badge variant="secondary">通常どおり</Badge>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => startEditOverride(p)}
                              disabled={saving}
                            >
                              {overridden ? '編集' : '上書きを登録'}
                            </Button>
                            {overridden && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleClearOverride(p)}
                                disabled={saving}
                              >
                                解除
                              </Button>
                            )}
                          </div>
                        </div>

                        {editingPeriod?.id === p.id && (
                          <div className="border-t border-[var(--stroke)] pt-3 space-y-3">
                            <SessionDatesEditor
                              value={editingSessions}
                              onChange={setEditingSessions}
                            />
                            <div className="flex items-center gap-2">
                              <Button size="sm" onClick={handleSaveOverride} isLoading={saving}>
                                この講習期の日時を保存
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setEditingPeriod(null)}
                                disabled={saving}
                              >
                                キャンセル
                              </Button>
                            </div>
                            <p className="text-[11px] text-[var(--paragraph)]">
                              空のまま保存すると「この講習期は開催しない」扱いになります。通常どおりに戻すには「解除」を押してください。
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {error && <p className="text-sm text-danger">{error}</p>}
          </div>
        )}
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          閉じる
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
