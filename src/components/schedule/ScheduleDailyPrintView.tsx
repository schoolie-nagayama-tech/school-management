'use client';

import React from 'react';
import type { ScheduleEntry, ScheduleTimeSlot } from '@/types/schedule';

/**
 * 日次印刷ビュー（A4縦・1日1ページ・コマ縦積み）
 *
 * 設計（2026-07-13 改訂）:
 *  - 用紙: A4 縦 (210mm × 297mm)、1ページ1日
 *  - コマは縦に積む（1列）。上から 1限→最終限
 *  - 講師名・担当未定は出さない。生徒名を主役に大きく表示する（配布用途）
 *  - 生徒は各コマ内で複数列に流し、名前を大きく保ちつつ紙面に収める
 *  - ブース番号は表示しないが、席のまとまりを保つため並び順のソートには使う
 *  - 最終日には改ページを付けない（末尾の白紙ページを防ぐ）
 */

function formatDateHeader(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const week = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${d.getFullYear()}年${m}月${day}日 (${week})`;
}

/**
 * そのコマに座っている生徒を集める。
 * - 担当未定（teacher_id なし）は印刷に出さない（配布用途では確定分のみ）
 * - キャンセル・振替元も除外
 * - ブース番号（講師×日付）→ 氏名 の順でソートし、席のまとまりを保つ
 */
function collectStudents(
  entries: ScheduleEntry[],
  date: string,
  slotId: string,
  boothMap: Map<string, number>
): ScheduleEntry[] {
  const filtered = entries.filter(
    (e) =>
      e.entry_date === date &&
      e.time_slot_id === slotId &&
      e.status !== 'cancelled' &&
      e.status !== 'transferred_out' &&
      !!e.teacher_id &&
      e.teacher_id !== '__unassigned__'
  );

  return filtered.sort((a, b) => {
    const ba = boothMap.get(a.teacher_id!) ?? Number.MAX_SAFE_INTEGER;
    const bb = boothMap.get(b.teacher_id!) ?? Number.MAX_SAFE_INTEGER;
    if (ba !== bb) return ba - bb;
    const na = a.student ? `${a.student.last_name}${a.student.first_name}` : '';
    const nb = b.student ? `${b.student.last_name}${b.student.first_name}` : '';
    return na.localeCompare(nb, 'ja');
  });
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
   * 表示はしないが、生徒の並び順（席のまとまり）を保つソートに使う。
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
        {datesToShow.map((dateStr, dateIdx) => {
          const boothMap = boothMapByDate?.get(dateStr) ?? new Map<string, number>();
          // 生徒が1人でもいるコマだけ出す（配置ゼロのコマは紙面を詰めるため省く）
          const slotsWithStudents = timeSlots
            .map((slot) => ({
              slot,
              students: collectStudents(entries, dateStr, slot.id, boothMap),
            }))
            .filter(({ students }) => students.length > 0);

          // 末尾の白紙ページ対策: 最終日には改ページを付けない
          const isLast = dateIdx === datesToShow.length - 1;

          return (
            <div
              key={dateStr}
              className="p-2"
              style={isLast ? undefined : { pageBreakAfter: 'always' }}
            >
              {/* ヘッダー: 日付 + 教室名。1行に収めて縦スペース節約 */}
              <div className="flex items-end justify-between border-b-2 border-black pb-1 mb-2">
                <h2 className="text-lg font-bold leading-tight">{formatDateHeader(dateStr)}</h2>
                {schoolName && (
                  <span className="text-sm font-medium text-gray-700">{schoolName}</span>
                )}
              </div>

              {slotsWithStudents.length === 0 && (
                <div className="text-xs text-gray-400 py-4 text-center">
                  この日に配置された授業はありません
                </div>
              )}

              {/* コマを縦に積む（1列）。上から 1限→最終限。 */}
              <div className="space-y-2">
                {slotsWithStudents.map(({ slot, students }) => (
                  <div key={slot.id} className="border border-gray-400 rounded break-inside-avoid">
                    {/* コマヘッダー: 限数 + 時間帯 + 人数 */}
                    <div className="flex items-baseline gap-2 border-b border-gray-300 bg-gray-100 px-2 py-1">
                      <span className="text-base font-bold leading-none">{slot.slot_number}限</span>
                      <span className="text-[11px] text-gray-600 tabular-nums">
                        {slot.start_time?.slice(0, 5)}〜{slot.end_time?.slice(0, 5)}
                      </span>
                      <span className="ml-auto text-[11px] text-gray-600">
                        {students.length} 名
                      </span>
                    </div>

                    {/* 生徒名を主役に大きく。名前を保ちつつ収めるため複数列に流す。 */}
                    <ul className="grid grid-cols-3 gap-x-3 gap-y-0.5 px-2 py-1.5">
                      {students.map((e) => {
                        const studentName = e.student
                          ? `${e.student.last_name}${e.student.first_name}`
                          : (e.inquiry?.student_name ?? '');
                        const subj = (e.subjects ?? [])
                          .map((s: { name?: string }) => s?.name)
                          .filter(Boolean)
                          .join('/');
                        return (
                          <li key={e.id} className="flex items-baseline gap-1 leading-tight">
                            <span className="text-[15px] font-bold">{studentName}</span>
                            {subj && <span className="text-[10px] text-gray-500">({subj})</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
