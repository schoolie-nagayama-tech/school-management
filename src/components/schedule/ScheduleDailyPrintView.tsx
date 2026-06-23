'use client';

import React from 'react';
import type { ScheduleEntry, ScheduleTimeSlot } from '@/types/schedule';

/**
 * 日次印刷ビュー（A4縦・1日1ページ・2列レイアウト）
 *
 * 設計:
 *  - 用紙: A4 縦 (210mm × 297mm)
 *  - 1ページ1日。複数日指定なら page-break-after で改ページ
 *  - コマ枠を 2 列 grid で配置（縦圧縮）。コマ数 5〜7 で 3 行に収まる
 *  - 各コマ内: 講師ごとに mini card、ブース番号 + 講師名 + 生徒一覧
 *  - 文字小さめ + 密度高めで A4 1 枚に収める
 */

function formatDateHeader(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const week = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${d.getFullYear()}年${m}月${day}日 (${week})`;
}

function groupByTeacher(
  entries: ScheduleEntry[],
  date: string,
  slotId: string
): Map<string, ScheduleEntry[]> {
  const filtered = entries.filter(
    (e) =>
      e.entry_date === date &&
      e.time_slot_id === slotId &&
      e.status !== 'cancelled' &&
      e.status !== 'transferred_out'
  );
  const byTeacher = new Map<string, ScheduleEntry[]>();
  for (const entry of filtered) {
    const tid = entry.teacher_id ?? '__unassigned__';
    if (!byTeacher.has(tid)) byTeacher.set(tid, []);
    byTeacher.get(tid)!.push(entry);
  }
  return byTeacher;
}

export interface ScheduleDailyPrintViewProps {
  weekDates: string[];
  timeSlots: ScheduleTimeSlot[];
  entries: ScheduleEntry[];
  schoolName?: string;
  /** 指定時はその日付のみ出力（日付横の印刷アイコン用） */
  singleDate?: string;
  /**
   * 日次のブース番号マップ。{ [date]: Map<teacherId, boothNo> } の形式。
   * 指定された講師にだけブース番号 [N] を講師名の隣に表示する。
   * 渡されなかった日 or 講師は番号無し（後方互換）。
   */
  boothMapByDate?: Map<string, Map<string, number>>;
}

export function ScheduleDailyPrintView({
  weekDates,
  timeSlots,
  entries,
  schoolName = '',
  singleDate,
  boothMapByDate,
}: ScheduleDailyPrintViewProps) {
  const datesToShow = singleDate ? [singleDate] : weekDates;

  return (
    <>
      {/* A4 縦サイズ指定: @page で印刷時の用紙とマージンを最適化 */}
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 8mm;
          }
          #schedule-daily-print {
            font-family: 'Hiragino Sans', 'Yu Gothic', sans-serif;
          }
        }
      `}</style>

      <div id="schedule-daily-print" className="hidden print:block bg-white text-black">
        {datesToShow.map((dateStr) => {
          const boothMap = boothMapByDate?.get(dateStr) ?? new Map<string, number>();
          // 印刷では中身の無いコマ（配置ゼロ）は省いて紙面を詰める。
          // groupByTeacher は配置のある entry だけを束ねるので、groups.size > 0 = そのコマに誰か座っている。
          const slotsWithGroups = timeSlots
            .map((slot) => ({
              slot,
              groups: groupByTeacher(entries, dateStr, slot.id),
            }))
            .filter(({ groups }) => groups.size > 0);

          return (
            <div key={dateStr} className="p-2" style={{ pageBreakAfter: 'always' }}>
              {/* ヘッダー: 教室名 + 日付。1行に収めて縦スペース節約 */}
              <div className="flex items-end justify-between border-b-2 border-black pb-1 mb-2">
                <h2 className="text-lg font-bold leading-tight">{formatDateHeader(dateStr)}</h2>
                {schoolName && (
                  <span className="text-sm font-medium text-gray-700">{schoolName}</span>
                )}
              </div>

              {/* コマを 2 列で並べる。コマ数 6 でも 3 行で収まり、A4縦1枚に余裕 */}
              {/* 空コマを省いた結果その日の配置が全く無い場合は、空グリッドで紙面を浪費しないよう一言だけ出す */}
              {slotsWithGroups.length === 0 && (
                <div className="text-xs text-gray-400 py-4 text-center">
                  この日に配置された授業はありません
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                {slotsWithGroups.map(({ slot, groups }) => {
                  const sortedGroups = Array.from(groups.entries()).sort(([aId], [bId]) => {
                    const a = boothMap.get(aId);
                    const b = boothMap.get(bId);
                    if (a == null && b == null) return 0;
                    if (a == null) return 1;
                    if (b == null) return -1;
                    return a - b;
                  });

                  return (
                    <div
                      key={slot.id}
                      className="border border-gray-400 rounded p-1.5 break-inside-avoid"
                    >
                      {/* コマヘッダー: 限数 + 時間帯 */}
                      <div className="flex items-baseline gap-2 border-b border-gray-300 pb-1 mb-1">
                        <span className="text-base font-bold leading-none">
                          {slot.slot_number}限
                        </span>
                        <span className="text-[10px] text-gray-600 tabular-nums">
                          {slot.start_time?.slice(0, 5)}〜{slot.end_time?.slice(0, 5)}
                        </span>
                        <span className="ml-auto text-[10px] text-gray-500">
                          {Array.from(groups.values()).reduce((sum, arr) => sum + arr.length, 0)} 名
                        </span>
                      </div>

                      {sortedGroups.length === 0 ? (
                        <div className="text-[10px] text-gray-300 py-2 text-center">—</div>
                      ) : (
                        <ul className="space-y-0.5">
                          {sortedGroups.map(([teacherId, slotEntries]) => {
                            const teacher = slotEntries[0]?.teacher;
                            const name =
                              teacherId === '__unassigned__'
                                ? '担当未定'
                                : teacher?.display_name || teacher?.email || teacherId;
                            const boothNo = boothMap.get(teacherId);
                            return (
                              <li key={teacherId} className="text-[10px] leading-tight">
                                <div className="flex items-center gap-1">
                                  {boothNo != null && (
                                    <span
                                      className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 text-[9px] font-bold border border-black bg-black text-white rounded-sm"
                                      style={{ fontVariantNumeric: 'tabular-nums' }}
                                    >
                                      {boothNo}
                                    </span>
                                  )}
                                  <span
                                    className={`font-semibold ${
                                      teacherId === '__unassigned__' ? 'text-gray-500' : ''
                                    }`}
                                  >
                                    {name}
                                  </span>
                                </div>
                                <div className="ml-[20px] text-gray-700">
                                  {slotEntries.map((e, i) => {
                                    const studentName = e.student
                                      ? `${e.student.last_name}${e.student.first_name}`
                                      : e.student_id;
                                    const subj = (e.subjects ?? [])
                                      ?.map((s: { name?: string }) => s?.name)
                                      .filter(Boolean)
                                      .join('/');
                                    return (
                                      <span key={e.id}>
                                        {i > 0 && <span className="text-gray-300">、</span>}
                                        {studentName}
                                        {subj && <span className="text-gray-500">({subj})</span>}
                                      </span>
                                    );
                                  })}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
