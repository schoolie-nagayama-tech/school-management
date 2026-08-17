'use client';

/**
 * 出勤可能期間パネル (teacher_availability_periods)
 *
 * 講師詳細（閲覧）・講師編集の両ページで共用する。
 * - 通常シフト提出から自動反映された期間 (source=regular_shift) と、
 *   手動編集の期間 (source=manual) の両方を時系列で表示。
 * - 同一日に複数 period がある場合、リード側で manual > regular_shift の優先順位。
 * - 「再同期」ボタンで提出データから手動再構築できる（緊急時の整合性確保用）。
 *
 * 編集（期間の追加/編集/削除）はこのパネル内で完結し、即座に DB に保存される。
 * 親ページの「保存」ボタンとは独立して動く（フォーム送信に乗らない）。
 */

import { useMemo, useState } from 'react';
import {
  deleteAvailabilityPeriod,
  upsertManualAvailability,
  type TeacherAvailabilityPeriod,
} from '@/lib/api/teacher-availability';
import { INDIVIDUAL_FORMATION, type ScheduleTimeSlot } from '@/types/schedule';

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

/** コマ → "HH:MM-HH:MM"。出勤可否の保存キーはこのラベル */
function toTimeLabel(slot: Pick<ScheduleTimeSlot, 'start_time' | 'end_time'>): string {
  return `${(slot.start_time ?? '').slice(0, 5)}-${(slot.end_time ?? '').slice(0, 5)}`;
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-400 py-2">{children}</p>;
}

export function AvailabilityPeriodsPanel({
  periods,
  teacherId,
  schoolIds,
  schoolNames,
  timeSlots,
  isResyncing,
  onResync,
  onChanged,
}: {
  periods: TeacherAvailabilityPeriod[];
  teacherId: string;
  schoolIds: string[];
  schoolNames: Record<string, string>;
  timeSlots: ScheduleTimeSlot[];
  isResyncing: boolean;
  onResync: () => Promise<void> | void;
  onChanged: () => Promise<void> | void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  // 編集モーダル状態。null=閉じている、'new'=新規、TeacherAvailabilityPeriod=編集
  const [editorTarget, setEditorTarget] = useState<TeacherAvailabilityPeriod | 'new' | null>(null);

  // 期間を「現在有効 / 未来予定 / 過去」に分類
  const current: TeacherAvailabilityPeriod[] = [];
  const future: TeacherAvailabilityPeriod[] = [];
  const past: TeacherAvailabilityPeriod[] = [];
  for (const p of periods) {
    const startsLater = p.effective_from > today;
    const endsBefore = p.effective_until && p.effective_until < today;
    if (startsLater) future.push(p);
    else if (endsBefore) past.push(p);
    else current.push(p);
  }

  const handleDelete = async (p: TeacherAvailabilityPeriod) => {
    if (p.source === 'regular_shift') {
      alert('シフト由来の期間は削除できません。シフト提出を編集/削除してください。');
      return;
    }
    if (
      !confirm(`${p.effective_from} 〜 ${p.effective_until || '無期限'} の期間を削除しますか？`)
    ) {
      return;
    }
    try {
      await deleteAvailabilityPeriod(p.id);
      await onChanged();
    } catch (e) {
      console.error(e);
      alert('削除に失敗しました');
    }
  };

  return (
    <div className="bg-surface-raised border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-gray-800">出勤可能期間</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEditorTarget('new')}
            className="text-xs px-2 py-1 rounded border border-info bg-info-subtle text-info hover:bg-info/10 transition-[background-color] duration-150 ease-out active:scale-[0.97]"
            disabled={schoolIds.length === 0}
            title={schoolIds.length === 0 ? '所属校未設定のため追加不可' : '新しい期間を追加'}
          >
            + 期間を追加
          </button>
          <button
            type="button"
            onClick={() => onResync()}
            disabled={isResyncing}
            className="text-xs px-2 py-1 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-[background-color] duration-150 ease-out active:scale-[0.97]"
            title="シフト提出から teacher_availability_periods を再構築"
          >
            {isResyncing ? '再同期中...' : 'シフトから再同期'}
          </button>
        </div>
      </div>

      {periods.length === 0 ? (
        <EmptyText>登録された期間がありません</EmptyText>
      ) : (
        <div className="space-y-4">
          {current.length > 0 && (
            <PeriodGroup
              label="現在有効"
              accent="success"
              periods={current}
              schoolNames={schoolNames}
              onEdit={(p) => setEditorTarget(p)}
              onDelete={handleDelete}
            />
          )}
          {future.length > 0 && (
            <PeriodGroup
              label="今後の予定"
              accent="info"
              periods={future}
              schoolNames={schoolNames}
              onEdit={(p) => setEditorTarget(p)}
              onDelete={handleDelete}
            />
          )}
          {past.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">
                過去の期間 ({past.length} 件)
              </summary>
              <div className="mt-2">
                <PeriodGroup
                  label=""
                  accent="muted"
                  periods={past}
                  schoolNames={schoolNames}
                  onEdit={(p) => setEditorTarget(p)}
                  onDelete={handleDelete}
                />
              </div>
            </details>
          )}
        </div>
      )}

      {editorTarget !== null && (
        <AvailabilityEditorModal
          initial={editorTarget === 'new' ? null : editorTarget}
          teacherId={teacherId}
          schoolIds={schoolIds}
          schoolNames={schoolNames}
          timeSlots={timeSlots}
          onClose={() => setEditorTarget(null)}
          onSaved={async () => {
            setEditorTarget(null);
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

function PeriodGroup({
  label,
  accent,
  periods,
  schoolNames,
  onEdit,
  onDelete,
}: {
  label: string;
  accent: 'success' | 'info' | 'muted';
  periods: TeacherAvailabilityPeriod[];
  schoolNames: Record<string, string>;
  onEdit: (p: TeacherAvailabilityPeriod) => void;
  onDelete: (p: TeacherAvailabilityPeriod) => void;
}) {
  const accentBorder =
    accent === 'success'
      ? 'border-emerald-200 bg-emerald-50/40'
      : accent === 'info'
        ? 'border-sky-200 bg-sky-50/40'
        : 'border-gray-200 bg-gray-50/40';
  return (
    <div>
      {label && (
        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          {label}
        </div>
      )}
      <ul className="space-y-2">
        {periods.map((p) => (
          <li key={p.id} className={`border rounded-lg p-3 ${accentBorder}`}>
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span
                className={`px-1.5 py-0.5 text-[11px] rounded font-semibold ${
                  p.source === 'manual'
                    ? 'bg-info-subtle text-info'
                    : 'bg-warning-subtle text-warning'
                }`}
                title={
                  p.source === 'manual'
                    ? '手動編集された期間。優先される。'
                    : '通常シフト提出から自動反映された期間。'
                }
              >
                {p.source === 'manual' ? '手動' : 'シフト由来'}
              </span>
              <span className="text-xs text-gray-700">
                {p.effective_from} 〜 {p.effective_until || '無期限'}
              </span>
              {schoolNames[p.school_id] && (
                <span className="text-[11px] text-gray-500">{schoolNames[p.school_id]}</span>
              )}
              <span className="ml-auto flex gap-1">
                <button
                  type="button"
                  onClick={() => onEdit(p)}
                  className="text-[11px] px-1.5 py-0.5 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 transition-[background-color] duration-150 ease-out active:scale-[0.97]"
                >
                  {p.source === 'manual' ? '編集' : '上書きを作成'}
                </button>
                {p.source === 'manual' && (
                  <button
                    type="button"
                    onClick={() => onDelete(p)}
                    className="text-[11px] px-1.5 py-0.5 rounded border border-danger/40 bg-white text-danger hover:bg-danger/5 transition-[background-color] duration-150 ease-out active:scale-[0.97]"
                  >
                    削除
                  </button>
                )}
              </span>
            </div>
            {p.available_days_of_week.length === 0 ? (
              <span className="text-[11px] text-gray-400">出勤可能曜日なし</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {p.available_days_of_week.map((dow) => {
                  const slots = p.available_time_slots_by_day?.[String(dow)] ?? [];
                  const nums = p.available_slot_numbers_by_day?.[String(dow)] ?? [];
                  const slotLabel =
                    slots.length > 0
                      ? slots.join(' / ')
                      : nums.length > 0
                        ? nums.map((n) => `${n}限`).join(' / ')
                        : '時間帯未指定';
                  return (
                    <span
                      key={dow}
                      className="inline-flex flex-col gap-0.5 px-2 py-1 rounded border border-gray-200 bg-white text-[11px]"
                    >
                      <strong className="text-gray-800">{DAY_LABELS[dow]}曜</strong>
                      <span className="text-gray-500">{slotLabel}</span>
                    </span>
                  );
                })}
              </div>
            )}
            {p.notes && <p className="mt-1.5 text-[11px] text-gray-400 italic">{p.notes}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AvailabilityEditorModal({
  initial,
  teacherId,
  schoolIds,
  schoolNames,
  timeSlots,
  onClose,
  onSaved,
}: {
  initial: TeacherAvailabilityPeriod | null;
  teacherId: string;
  schoolIds: string[];
  schoolNames: Record<string, string>;
  timeSlots: ScheduleTimeSlot[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  // 新規 or 編集（シフト由来の上書きも「新規 manual」として扱う）
  const isEdit = !!initial && initial.source === 'manual';

  const [schoolId, setSchoolId] = useState<string>(initial?.school_id ?? schoolIds[0] ?? '');
  const [effectiveFrom, setEffectiveFrom] = useState<string>(initial?.effective_from ?? today);
  const [effectiveUntil, setEffectiveUntil] = useState<string>(initial?.effective_until ?? '');
  const [notes, setNotes] = useState<string>(initial?.notes ?? '');

  // グリッドの行 = 選択中の校舎で有効な全形態のコマを「実時刻」で重複排除した合併軸。
  // 形態ごとに slot_number が独立採番されるため番号で束ねると別時間のコマが潰れる。
  // 形態が増えても行が増えるだけで、保存済みの出勤可否は影響を受けない。
  const gridRows = useMemo(() => {
    const scoped = timeSlots.filter((s) => s.school_id === schoolId);
    // 親が校舎で絞ったリストを渡してくる場合に空にならないようフォールバック
    const source = scoped.length > 0 ? scoped : timeSlots;
    const byLabel = new Map<string, { label: string; start: string; end: string }>();
    for (const s of source) {
      const label = toTimeLabel(s);
      if (!label.includes('-') || byLabel.has(label)) continue;
      byLabel.set(label, {
        label,
        start: (s.start_time ?? '').slice(0, 5),
        end: (s.end_time ?? '').slice(0, 5),
      });
    }
    return Array.from(byLabel.values()).sort((a, b) => a.start.localeCompare(b.start));
  }, [timeSlots, schoolId]);

  // 曜日 → 出勤する時間帯ラベルのセット
  const [grid, setGrid] = useState<Record<string, Set<string>>>(() => {
    const out: Record<string, Set<string>> = {};
    const byDay = initial?.available_time_slots_by_day ?? {};
    for (const [k, arr] of Object.entries(byDay)) {
      const labels = (arr as string[]) ?? [];
      if (labels.length > 0) out[k] = new Set(labels);
    }
    if (Object.keys(out).length > 0) return out;

    // 旧レコード救済: 時間帯が空でコマ番号だけ入っている期間は、個別のコマ時間で復元する
    // （旧 available_slot_numbers_by_day は個別しか無かった時代の値のため）。
    const individual = timeSlots.filter((s) => s.formation === INDIVIDUAL_FORMATION);
    const numberSource = individual.length > 0 ? individual : timeSlots;
    const labelByNumber = new Map<number, string>();
    for (const s of numberSource) {
      if (!labelByNumber.has(s.slot_number)) labelByNumber.set(s.slot_number, toTimeLabel(s));
    }
    for (const [k, arr] of Object.entries(initial?.available_slot_numbers_by_day ?? {})) {
      const labels = ((arr as number[]) ?? [])
        .map((n) => labelByNumber.get(n))
        .filter((l): l is string => Boolean(l));
      if (labels.length > 0) out[k] = new Set(labels);
    }
    return out;
  });
  const [isSaving, setIsSaving] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const toggleCell = (dow: number, timeLabel: string) => {
    setGrid((prev) => {
      const next = { ...prev };
      const key = String(dow);
      const set = new Set(next[key] ?? []);
      if (set.has(timeLabel)) set.delete(timeLabel);
      else set.add(timeLabel);
      next[key] = set;
      return next;
    });
  };

  const handleSave = async () => {
    setErrMsg(null);
    if (!schoolId) {
      setErrMsg('校舎を選択してください');
      return;
    }
    if (!effectiveFrom) {
      setErrMsg('開始日を選択してください');
      return;
    }
    if (effectiveUntil && effectiveUntil < effectiveFrom) {
      setErrMsg('終了日は開始日以降にしてください');
      return;
    }
    setIsSaving(true);
    try {
      // 保存は時間帯ラベルのみ。コマ番号は形態別に独立採番されるため保存しない。
      const timeSlotsByDay: Record<string, string[]> = {};
      const days: number[] = [];
      for (const [k, set] of Object.entries(grid)) {
        if (set.size === 0) continue;
        timeSlotsByDay[k] = Array.from(set).sort();
        days.push(parseInt(k, 10));
      }

      await upsertManualAvailability({
        user_id: teacherId,
        school_id: schoolId,
        effective_from: effectiveFrom,
        effective_until: effectiveUntil || null,
        available_days_of_week: days.sort((a, b) => a - b),
        available_time_slots_by_day: timeSlotsByDay,
        notes: notes || (isEdit ? null : '講師詳細から手動追加'),
      });
      await onSaved();
    } catch (e) {
      console.error(e);
      setErrMsg(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 animate-[fade-in_150ms_ease-out]">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl animate-[popover-enter_150ms_cubic-bezier(0.23,1,0.32,1)]">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-800">
            {isEdit ? '出勤可能期間を編集' : '出勤可能期間を追加'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-800 transition-[color] duration-150 ease-out active:scale-[0.97]"
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!isEdit && initial?.source === 'regular_shift' && (
            <div className="text-xs text-warning bg-warning-subtle border border-warning/30 rounded p-2">
              シフト由来の期間を「上書き」する新しい manual 期間を作ります。 同じ日に manual
              がある場合はそちらが優先表示されます。
            </div>
          )}

          {/* 校舎 */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">校舎</label>
            <select
              value={schoolId}
              onChange={(e) => setSchoolId(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
            >
              {schoolIds.length === 0 && <option value="">(所属校なし)</option>}
              {schoolIds.map((sid) => (
                <option key={sid} value={sid}>
                  {schoolNames[sid] ?? sid}
                </option>
              ))}
            </select>
          </div>

          {/* 期間 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">開始日</label>
              <input
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                終了日 <span className="text-gray-400 font-normal">(空 = 無期限)</span>
              </label>
              <input
                type="date"
                value={effectiveUntil}
                onChange={(e) => setEffectiveUntil(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
              />
            </div>
          </div>

          {/* 曜日×時間帯 グリッド */}
          <div>
            <div className="text-xs font-semibold text-gray-600 mb-1">出勤可能な時間帯</div>
            {gridRows.length === 0 ? (
              <p className="text-xs text-gray-400">コマ時間マスタが未設定です</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="p-1.5 border border-gray-200 bg-gray-50 text-left">時間帯</th>
                      {DAY_LABELS.map((d, i) => (
                        <th
                          key={i}
                          className="p-1.5 border border-gray-200 bg-gray-50 text-center min-w-[40px]"
                        >
                          {d}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {gridRows.map((row) => (
                      <tr key={row.label}>
                        <td className="p-1.5 border border-gray-200 text-gray-700 whitespace-nowrap">
                          {row.start}〜{row.end}
                        </td>
                        {DAY_LABELS.map((_, dayIdx) => {
                          const checked = grid[String(dayIdx)]?.has(row.label) ?? false;
                          return (
                            <td
                              key={dayIdx}
                              onClick={() => toggleCell(dayIdx, row.label)}
                              className={`p-1.5 border border-gray-200 text-center cursor-pointer transition-[background-color] duration-100 ease-out select-none ${
                                checked
                                  ? 'bg-emerald-100 hover:bg-emerald-200'
                                  : 'bg-white hover:bg-gray-50'
                              }`}
                            >
                              {checked && (
                                <span className="inline-block w-2 h-2 rounded-full bg-emerald-600" />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* メモ */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              メモ <span className="text-gray-400 font-normal">(任意)</span>
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="例: 試用期間後の本シフト"
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
            />
          </div>

          {errMsg && (
            <div className="text-xs text-danger bg-danger-subtle border border-danger/30 rounded p-2">
              {errMsg}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="px-3 py-1.5 text-sm rounded bg-ink text-white hover:brightness-[0.85] disabled:opacity-50"
          >
            {isSaving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
