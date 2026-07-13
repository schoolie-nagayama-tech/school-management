'use client';

import React from 'react';
import type { ScheduleEntry, ScheduleTimeSlot } from '@/types/schedule';
import { getSurname } from '@/lib/utils/teacherName';

/**
 * 日次印刷ビュー（A4縦・1日1ページ・コマ縦積み）
 *
 * 設計（2026-07-13 改訂2）:
 *  - 用紙: A4 縦 (210mm × 297mm)、1ページ1日
 *  - コンテンツ幅は A4 印刷可能幅 194mm（= 210mm − 左右マージン 8mm×2）に固定し、
 *    フルブリードな画面幅の影響を受けず右端が切れないようにする（②）
 *  - コマは縦に積む（1列）。上から 1限→最終限
 *  - コマ内は講師（席）ごとにグループ化し、見出しに「座席番号＋姓のみ」を小さく表示（①）。
 *    生徒名は主役として大きく保つ。担当未定は出さない（配布用途では確定分のみ）
 *  - 同じ座席（＝同じ講師）の生徒は枠で囲み、一目でまとまりが分かるようにする（①）
 *  - 「席見出し＋その生徒たち」を1ユニットとして CSS 段組で 2〜3 列に流し、
 *    ユニットが列跨ぎで割れないようにする（break-inside-avoid）
 *  - 座席番号順（未設定は末尾）で並べ、席順を保つ
 *  - 最終日には改ページを付けない（末尾の白紙ページを防ぐ）
 */

/** A4 印刷可能幅: 210mm − 左右マージン 8mm×2 = 194mm（@page margin と整合）。 */
const PRINTABLE_WIDTH_MM = 194;

function formatDateHeader(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const week = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${d.getFullYear()}年${m}月${day}日 (${week})`;
}

/** 講師グループ（席）: 座席番号＋見出し表示名（姓のみ）＋その生徒エントリ群。 */
interface TeacherGroup {
  teacherId: string;
  /** 座席番号（ブース番号）。未設定なら null。 */
  boothNo: number | null;
  /** 見出しに出す姓（フォールバックは display_name の先頭語）。 */
  surname: string;
  students: ScheduleEntry[];
}

/**
 * そのコマを講師（席）ごとのグループに集約する。
 * - 担当未定（teacher_id なし）は印刷に出さない（配布用途では確定分のみ）
 * - キャンセル・振替元も除外
 * - グループはブース番号（講師×日付）→ 姓 の順に並べ、席のまとまり・席順を保つ
 * - 各グループ内の生徒は氏名でソート
 */
function collectTeacherGroups(
  entries: ScheduleEntry[],
  date: string,
  slotId: string,
  boothMap: Map<string, number>
): TeacherGroup[] {
  const filtered = entries.filter(
    (e) =>
      e.entry_date === date &&
      e.time_slot_id === slotId &&
      e.status !== 'cancelled' &&
      e.status !== 'transferred_out' &&
      !!e.teacher_id &&
      e.teacher_id !== '__unassigned__' &&
      !e.teacher_id.startsWith('__unassigned__:')
  );

  // teacher_id でグループ化。見出し名は最初に見つかった entry.teacher から姓を取る。
  const byTeacher = new Map<string, TeacherGroup>();
  for (const e of filtered) {
    const tid = e.teacher_id!;
    let group = byTeacher.get(tid);
    if (!group) {
      const surname = e.teacher
        ? getSurname({ last_name: e.teacher.last_name, display_name: e.teacher.display_name }) ||
          e.teacher.display_name ||
          '担当'
        : '担当';
      group = { teacherId: tid, boothNo: boothMap.get(tid) ?? null, surname, students: [] };
      byTeacher.set(tid, group);
    }
    group.students.push(e);
  }

  const groups = Array.from(byTeacher.values());
  // グループ内は氏名順。
  for (const g of groups) {
    g.students.sort((a, b) => {
      const na = a.student ? `${a.student.last_name}${a.student.first_name}` : '';
      const nb = b.student ? `${b.student.last_name}${b.student.first_name}` : '';
      return na.localeCompare(nb, 'ja');
    });
  }
  // グループはブース番号→姓の順（席順を保つ）。
  groups.sort((a, b) => {
    const ba = boothMap.get(a.teacherId) ?? Number.MAX_SAFE_INTEGER;
    const bb = boothMap.get(b.teacherId) ?? Number.MAX_SAFE_INTEGER;
    if (ba !== bb) return ba - bb;
    return a.surname.localeCompare(b.surname, 'ja');
  });
  return groups;
}

export interface ScheduleDailyPrintViewProps {
  weekDates: string[];
  timeSlots: ScheduleTimeSlot[];
  entries: ScheduleEntry[];
  schoolName?: string;
  /** 指定時はその日付のみ出力（日付横の印刷アイコン用） */
  singleDate?: string;
  /**
   * 日次の座席番号マップ。{ [date]: Map<teacherId, boothNo> } の形式。
   * 席見出しに番号を表示し、並び順（席順）にも使う。
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
      {/* A4 縦サイズ指定: @page で印刷時の用紙とマージンを最適化。
          コンテンツ幅は印刷可能幅 194mm に固定し、フルブリードな画面幅で右端が
          切れるのを防ぐ（②）。内部要素の overflow も抑止する。 */}
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 8mm;
          }
          #schedule-daily-print {
            font-family: 'Hiragino Sans', 'Yu Gothic', sans-serif;
            width: ${PRINTABLE_WIDTH_MM}mm;
            max-width: 100%;
            margin: 0 auto;
            box-sizing: border-box;
            overflow: hidden;
          }
          #schedule-daily-print * {
            box-sizing: border-box;
          }
          /* CSS 段組で講師ユニットを 2〜3 列に流す（Tailwind の columns ユーティリティは
             印刷計算が読みにくいので、幅基準の段組をここで明示する）。 */
          #schedule-daily-print .print-teacher-flow {
            column-width: 60mm;
            column-gap: 4mm;
          }
          #schedule-daily-print .print-teacher-unit {
            break-inside: avoid;
            -webkit-column-break-inside: avoid;
          }
        }
      `}</style>

      <div id="schedule-daily-print" className="hidden print:block bg-white text-black">
        {datesToShow.map((dateStr, dateIdx) => {
          const boothMap = boothMapByDate?.get(dateStr) ?? new Map<string, number>();
          // 生徒が1人でもいるコマだけ出す（配置ゼロのコマは紙面を詰めるため省く）
          const slotsWithGroups = timeSlots
            .map((slot) => {
              const groups = collectTeacherGroups(entries, dateStr, slot.id, boothMap);
              const count = groups.reduce((n, g) => n + g.students.length, 0);
              return { slot, groups, count };
            })
            .filter(({ count }) => count > 0);

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

              {slotsWithGroups.length === 0 && (
                <div className="text-xs text-gray-400 py-4 text-center">
                  この日に配置された授業はありません
                </div>
              )}

              {/* コマを縦に積む（1列）。上から 1限→最終限。 */}
              <div className="space-y-2">
                {slotsWithGroups.map(({ slot, groups, count }) => (
                  <div key={slot.id} className="border border-gray-400 rounded break-inside-avoid">
                    {/* コマヘッダー: 限数 + 時間帯 + 人数 */}
                    <div className="flex items-baseline gap-2 border-b border-gray-300 bg-gray-100 px-2 py-1">
                      <span className="text-base font-bold leading-none">{slot.slot_number}限</span>
                      <span className="text-[11px] text-gray-600 tabular-nums">
                        {slot.start_time?.slice(0, 5)}〜{slot.end_time?.slice(0, 5)}
                      </span>
                      <span className="ml-auto text-[11px] text-gray-600">{count} 名</span>
                    </div>

                    {/* 席（＝講師）ごとのユニットを段組で 2〜3 列に流す。
                        各ユニット＝「座席番号＋姓の見出し（小）＋生徒名（大）」を枠で囲む。
                        同じ座席のまとまりが一目で分かる。ユニットは列跨ぎで割らない。 */}
                    <div className="print-teacher-flow px-2 py-1.5">
                      {groups.map((g) => (
                        <div
                          key={g.teacherId}
                          className="print-teacher-unit mb-1.5 border border-gray-400 rounded"
                        >
                          {/* 席見出し: 座席番号（あれば）＋姓のみ・小さめ。下に細い区切り。 */}
                          <div className="flex items-center gap-1 bg-gray-100 border-b border-gray-300 px-1 py-0.5 leading-tight">
                            {g.boothNo != null && (
                              <span className="inline-flex items-center justify-center min-w-[15px] h-[15px] px-0.5 text-[9px] font-bold border border-black bg-black text-white rounded-sm tabular-nums">
                                {g.boothNo}
                              </span>
                            )}
                            <span className="text-[10px] font-semibold text-gray-600">
                              {g.surname}
                            </span>
                          </div>
                          <ul className="px-1 py-0.5">
                            {g.students.map((e) => {
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
                                  {subj && (
                                    <span className="text-[10px] text-gray-500">({subj})</span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))}
                    </div>
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
