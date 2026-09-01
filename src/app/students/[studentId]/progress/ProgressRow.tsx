'use client';

import { useEffect, useRef, useState } from 'react';
import type { CurriculumItemWithProgress, ExamType } from '@/types/database';
import { toSurnameOnly } from '@/lib/utils/teacherName';
import {
  INTENT_TAG_COLOR,
  isIntentTag,
  type IntentTag,
  type MeetingColMap,
} from './newProgress.shared';
import type { KoushuGroupStat } from '@/lib/utils/koushuKoma';
import { IntentTagPicker } from './IntentTagPicker';
import { DateInputWithToday } from './DateInputWithToday';
import { TeacherNameInput } from './TeacherNameInput';

// ─────────────────────────────────────────────
// 進行表の1行
// ─────────────────────────────────────────────
export function ProgressRow({
  row,
  rowId,
  highlighted = false,
  examTypes,
  isMeeting,
  meetingCols,
  groupStart = true,
  appliedGroupStart = true,
  proposalGroupSpan = 1,
  appliedGroupSpan = 1,
  inheritedIntentTag = null,
  komaDeviation = null,
  selfName = '',
  isTeacher = false,
  paintActive = false,
  paintMode: _paintMode = null,
  isPaintStart = false,
  isPaintCandidate = false,
  sessionMode = false,
  sessionSelection = null,
  canDirectEdit = true,
  onPaintRowClick,
  onLocalPatch,
  onSaveProgress,
  onSaveLesson,
  onSessionCellToggle,
}: {
  row: CurriculumItemWithProgress;
  /** DOM id（他画面からのディープリンクでこの行までスクロールするためのアンカー） */
  rowId?: string;
  /** ディープリンク遷移直後の一時的なハイライト表示 */
  highlighted?: boolean;
  examTypes: ExamType[];
  isMeeting: boolean;
  meetingCols: MeetingColMap;
  /** 提案結合グループの先頭行（指導意図タグを編集できる / 提案コマ合計を表示） */
  groupStart?: boolean;
  /** 申込結合グループの先頭行（申込コマ合計を表示） */
  appliedGroupStart?: boolean;
  /** 提案結合グループの行数（先頭行の提案セルを rowSpan で縦結合する） */
  proposalGroupSpan?: number;
  /** 申込結合グループの行数（先頭行の申込セルを rowSpan で縦結合する） */
  appliedGroupSpan?: number;
  /** 非先頭行に継承表示する指導意図タグ（読み取り専用） */
  inheritedIntentTag?: IntentTag | null;
  /** この行が予定コマを持つグループで、予定と実施がズレているときの内訳（申込セルに印を出す） */
  komaDeviation?: KoushuGroupStat | null;
  /** ログイン中ユーザーの display_name（講師名欄の自動補完用） */
  selfName?: string;
  /** 講師権限: 講師名を苗字のみ表示 */
  isTeacher?: boolean;
  /** 一括塗りモードが有効か */
  paintActive?: boolean;
  paintMode?: null | 'examRange' | 'intent';
  isPaintStart?: boolean;
  isPaintCandidate?: boolean;
  /** セッション記録モード */
  sessionMode?: boolean;
  /** セッションの選択状態（ハイライト用） */
  sessionSelection?: {
    unitActions: Record<number, 1 | 2 | 3>;
    schoolUnits: Set<number>;
    sessionDate?: string;
  } | null;
  /**
   * 表のセルを直接編集できるか（false のとき指導日・引継ぎ・宿題/遅刻・講師名を「—」で入力無効化）。
   * 直接編集は「既存項目の加筆修正」用途なので基本は常に true。目標必須なのは
   * セッション記録（「授業を記録」）側だけで、そちらは TableView のボタン側でガードする。
   */
  canDirectEdit?: boolean;
  onPaintRowClick?: () => void;
  onLocalPatch: (patch: Partial<CurriculumItemWithProgress['progress']>) => void;
  onSaveProgress: (patch: Record<string, unknown>) => Promise<void>;
  onSaveLesson: (lessonNumber: 1 | 2 | 3, date: string | null) => Promise<void>;
  /** セッション記録モード中のセルクリック */
  onSessionCellToggle?: (curriculumItemId: number, column: 'school' | 1 | 2 | 3) => void;
}) {
  const p = row.progress;
  const lessonDate = (n: 1 | 2 | 3) =>
    (p?.lessons || []).find((l) => l.lesson_number === n)?.lesson_date ?? '';
  // 結合グループは「セル結合」風に見せる（提案書の旧UIと同じ）。
  // 先頭行の提案/申込セルを後続行ぶん rowSpan で縦結合し、合計を中央に1つだけ表示。
  // 2行目以降はそのセル自体を描画しない（rowSpan に吸収される）。
  // 提案結合(group_number)と申込結合(applied_group_number)は別系統なので列ごとに判定する。
  const isProposalGroupMember = p?.group_number != null && !groupStart;
  const isAppliedGroupMember = p?.applied_group_number != null && !appliedGroupStart;
  const isProposalGroupHead = p?.group_number != null && groupStart;
  const isAppliedGroupHead = p?.applied_group_number != null && appliedGroupStart;
  const isGroupedRow = p?.group_number != null || p?.applied_group_number != null;
  // 縦結合したセルの見た目（中央寄せ＋淡い背景＋四辺を濃いめの罫線で囲み、グループの範囲が一目で分かるように）
  const mergedHeadClass = 'text-center align-middle bg-[#f8fafc] border-2 border-[#94a3b8]';
  const examRangeName = examTypes.find((et) => et.id === p?.exam_range_exam_type_id)?.name ?? '';

  // セッション選択状態
  const isSessionSelected = sessionSelection
    ? row.id in (sessionSelection.unitActions || {}) || sessionSelection.schoolUnits?.has(row.id)
    : false;

  // 指導日（1〜3回目）がいずれか入っている＝授業実施済みの行。
  // 実施済み行に薄い緑の帯を敷くことで、スクロールしても「どこまで進んだか（最下層）」が
  // 色の切れ目で一目で分かるようにする。
  const hasAnyLesson = ([1, 2, 3] as const).some((n) => !!lessonDate(n));

  const rowClass = isPaintStart
    ? 'border-b border-[#d1d5db] bg-[#dbeafe] ring-2 ring-[#1e40af] cursor-pointer'
    : isPaintCandidate
      ? 'border-b border-[#d1d5db] hover:bg-[#eff6ff] cursor-pointer'
      : paintActive
        ? 'border-b border-[#d1d5db] hover:bg-[#eff6ff] cursor-pointer'
        : isSessionSelected
          ? 'border-b border-[#d1d5db] bg-[#1e3a5f]/5'
          : hasAnyLesson
            ? 'border-b border-[#d1d5db] bg-[#f0fdf4] hover:bg-[#dcfce7]'
            : 'border-b border-[#d1d5db] hover:bg-[#f9fafb]';

  // 列表示判定（管理モードでも meetingCols で制御）
  const showProposal = meetingCols.proposal;
  const showApplication = !isMeeting && meetingCols.application;
  const showExamRange = meetingCols.examRange;
  const showSchoolProgress = meetingCols.schoolProgress;
  const showLesson = (n: 1 | 2 | 3) =>
    n === 1 ? meetingCols.lesson1 : n === 2 ? meetingCols.lesson2 : meetingCols.lesson3;
  const showHandover = !isMeeting && meetingCols.handover;
  const showHomeworkNotDone = !isMeeting && meetingCols.homeworkNotDone;
  const showTardy = !isMeeting && meetingCols.tardy;
  const showTeacherName = !isMeeting && meetingCols.teacherName;

  return (
    <tr
      id={rowId}
      className={`${rowClass} ${highlighted ? 'progress-row-highlight' : ''}`}
      onClick={paintActive ? onPaintRowClick : undefined}
    >
      <td
        className={`px-3 py-2.5 text-[#6b7280] text-xs ${isGroupedRow ? 'border-l-2 border-l-[#cbd5e1]' : ''}`}
      >
        {row.item_number ?? ''}
      </td>
      <td className="px-3 py-2.5 text-[#1f2937]">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span>{row.title}</span>
          {/* 指導意図: 先頭行は編集可 / 継承行は薄く表示 */}
          {groupStart ? (
            isMeeting ? (
              (() => {
                const tag = isIntentTag(p?.intent_tag) ? (p?.intent_tag as IntentTag) : null;
                return tag ? (
                  <span
                    className={`inline-block px-1.5 py-0 border rounded-full text-[11px] bg-white ${INTENT_TAG_COLOR[tag]}`}
                  >
                    {tag}
                  </span>
                ) : null;
              })()
            ) : (
              <IntentTagPicker
                currentTag={isIntentTag(p?.intent_tag) ? (p?.intent_tag as IntentTag) : null}
                onChange={(t) => {
                  onLocalPatch({ intent_tag: t ?? undefined });
                  onSaveProgress({ intent_tag: t });
                }}
              />
            )
          ) : (
            // 継承行: 薄いゴーストチップ（グループ全体の指導意図が分かるように残す）
            inheritedIntentTag && (
              <span
                className={`inline-block px-1.5 py-0 border border-dashed rounded-full text-[9px] bg-white opacity-50 ${INTENT_TAG_COLOR[inheritedIntentTag]}`}
                title={`このグループの指導意図: ${inheritedIntentTag}`}
              >
                {inheritedIntentTag}
              </span>
            )
          )}
        </div>
      </td>
      {/* 提案: 管理モードは常時編集 / 面談モードは列設定に従う読み取り。
          結合グループは先頭行のみ rowSpan で縦結合表示し、2行目以降はセル自体を描画しない。 */}
      {showProposal && !isProposalGroupMember && (
        <td
          className={`px-3 py-2.5 ${isProposalGroupHead ? mergedHeadClass : ''}`}
          rowSpan={isProposalGroupHead ? proposalGroupSpan : undefined}
        >
          {isMeeting ? (
            <span className="text-[#1f2937] text-xs">
              {p?.proposal_count != null ? `${p.proposal_count}` : '—'}
            </span>
          ) : (
            <input
              type="number"
              min={0}
              defaultValue={p?.proposal_count ?? ''}
              onBlur={(e) => {
                const v = e.target.value === '' ? null : Number(e.target.value);
                onLocalPatch({ proposal_count: v ?? undefined });
                onSaveProgress({ proposal_count: v });
              }}
              className="w-14 px-1.5 py-1 text-xs bg-transparent border border-transparent hover:border-[#e5e7eb] focus:border-[#1e3a5f] focus:bg-white rounded outline-none text-center"
            />
          )}
        </td>
      )}
      {/* 申込: 管理モードのみ & 列設定 ON。結合グループは先頭行のみ rowSpan で縦結合表示。 */}
      {showApplication && !isAppliedGroupMember && (
        <td
          className={`px-3 py-2.5 ${isAppliedGroupHead ? mergedHeadClass : ''}`}
          rowSpan={isAppliedGroupHead ? appliedGroupSpan : undefined}
        >
          {isTeacher ? (
            // 講師は申込コマ数を編集不可（閲覧のみ）。申込は教室長の業務のため。数字のみ表示。
            <span className="block text-xs text-center text-[#1f2937]">
              {p?.application_count ? `${p.application_count}` : '—'}
            </span>
          ) : (
            <input
              type="number"
              min={0}
              defaultValue={p?.application_count || ''}
              onBlur={(e) => {
                const v = e.target.value === '' ? null : Number(e.target.value);
                onLocalPatch({ application_count: v ?? undefined });
                onSaveProgress({ application_count: v });
              }}
              className="w-14 px-1.5 py-1 text-xs bg-transparent border border-transparent hover:border-[#e5e7eb] focus:border-[#1e3a5f] focus:bg-white rounded outline-none text-center"
            />
          )}
          {/* 予定と実施がズレたグループにだけ「実施/予定」を出す。合計バッジだけでは
              「どの単元でズレたか」が分からず、進行表の見た目と残りコマ数が食い違って見える。 */}
          {komaDeviation && (
            <span
              className={`mt-0.5 block text-center text-[10px] font-bold tabular-nums ${
                komaDeviation.delta < 0 ? 'text-emerald-700' : 'text-red-700'
              }`}
              title={
                komaDeviation.delta < 0
                  ? `${komaDeviation.planned}コマ予定の単元を${komaDeviation.consumed}コマで終えています（${-komaDeviation.delta}コマ前倒し）`
                  : `${komaDeviation.planned}コマ予定の単元に${komaDeviation.consumed}コマ使っています（${komaDeviation.delta}コマ超過）`
              }
            >
              実施{komaDeviation.consumed}
            </span>
          )}
        </td>
      )}
      {/* 試験範囲 */}
      {showExamRange && (
        <td className="px-3 py-2.5 text-xs">
          {isMeeting ? (
            examRangeName ? (
              <span className="inline-block px-2 py-0.5 bg-[#eff6ff] text-[#1e40af] rounded-full border border-[#dbeafe] text-[11px]">
                {examRangeName}
              </span>
            ) : (
              <span className="text-[#d1d5db]">—</span>
            )
          ) : (
            <select
              value={p?.exam_range_exam_type_id ?? ''}
              onChange={(e) => {
                const v = e.target.value || null;
                onLocalPatch({ exam_range_exam_type_id: v ?? undefined });
                onSaveProgress({ exam_range_exam_type_id: v });
              }}
              className="w-full px-1.5 py-1 text-xs bg-transparent border border-transparent hover:border-[#e5e7eb] focus:border-[#1e3a5f] focus:bg-white rounded outline-none"
            >
              <option value="">—</option>
              {examTypes.map((et) => (
                <option key={et.id} value={et.id}>
                  {et.name}
                </option>
              ))}
            </select>
          )}
        </td>
      )}
      {/* 学校進度 */}
      {showSchoolProgress &&
        (() => {
          const schoolSelected = sessionSelection?.schoolUnits?.has(row.id);
          return (
            <td
              className={`px-3 py-2.5 text-xs ${sessionMode ? 'cursor-pointer' : ''} ${schoolSelected ? 'bg-[#1e3a5f]/15' : sessionMode ? 'hover:bg-[#1e3a5f]/5' : ''}`}
              onClick={sessionMode ? () => onSessionCellToggle?.(row.id, 'school') : undefined}
            >
              {isMeeting ? (
                <span className="text-[#4b5563]">{p?.school_progress_date ?? '—'}</span>
              ) : sessionMode ? (
                <span
                  className={`inline-block px-1.5 py-0.5 rounded text-xs ${schoolSelected ? 'bg-[#1e3a5f] text-white font-medium' : p?.school_progress_date ? 'bg-[#1e3a5f]/10 text-[#1e3a5f] font-medium' : 'text-gray-400'}`}
                >
                  {schoolSelected
                    ? '学校'
                    : p?.school_progress_date
                      ? (p.school_progress_date as string).replace(/^\d{4}-/, '').replace('-', '/')
                      : '—'}
                </span>
              ) : (
                <DateInputWithToday
                  value={p?.school_progress_date ?? ''}
                  onSave={(v) => {
                    onLocalPatch({ school_progress_date: v ?? undefined });
                    onSaveProgress({ school_progress_date: v });
                  }}
                  disabled={!canDirectEdit}
                />
              )}
            </td>
          );
        })()}
      {/* 1回目 / 2回目 / 3回目 */}
      {([1, 2, 3] as const).map((n) => {
        const lessonSelected = sessionSelection?.unitActions?.[row.id] === n;
        return showLesson(n) ? (
          <td
            key={n}
            className={`px-3 py-2.5 text-xs ${sessionMode ? 'cursor-pointer' : ''} ${lessonSelected ? 'bg-[#1e3a5f]/15' : sessionMode ? 'hover:bg-[#1e3a5f]/5' : ''}`}
            onClick={sessionMode ? () => onSessionCellToggle?.(row.id, n) : undefined}
          >
            {isMeeting ? (
              <span className="text-[#1f2937]">
                {(lessonDate(n) || '').replace(/^\d{4}-/, '') || '—'}
              </span>
            ) : sessionMode ? (
              <span
                className={`inline-block px-1.5 py-0.5 rounded text-xs ${lessonSelected ? 'bg-[#1e3a5f] text-white font-medium' : lessonDate(n) ? 'bg-[#1e3a5f]/10 text-[#1e3a5f] font-medium' : 'text-gray-400'}`}
              >
                {lessonSelected
                  ? (sessionSelection?.sessionDate ?? '')
                      .replace(/^\d{4}-/, '')
                      .replace('-', '/') || `${n}回目`
                  : lessonDate(n)
                    ? lessonDate(n)
                        .replace(/^\d{4}-/, '')
                        .replace('-', '/')
                    : '—'}
              </span>
            ) : (
              <DateInputWithToday
                value={lessonDate(n)}
                onSave={(v) => onSaveLesson(n, v)}
                disabled={!canDirectEdit}
              />
            )}
          </td>
        ) : null;
      })}
      {showHandover && (
        // 列自体も20字ぶん＋左右パディングで固定し、長文で列が横に伸びないようにする
        <td className="px-3 py-2.5 align-top w-[284px] max-w-[284px]">
          {canDirectEdit ? (
            <HandoverCell
              value={p?.handover ?? ''}
              onSave={(v) => {
                onLocalPatch({ handover: v ?? undefined });
                onSaveProgress({ handover: v });
              }}
            />
          ) : (
            <span className="px-1.5 py-1 text-xs text-[#d1d5db]">—</span>
          )}
        </td>
      )}
      {showHomeworkNotDone && (
        <td className="px-3 py-2.5 text-center">
          <input
            type="checkbox"
            checked={!!p?.homework_not_done}
            onChange={(e) => {
              const next = e.target.checked;
              onLocalPatch({ homework_not_done: next });
              onSaveProgress({ homework_not_done: next });
            }}
            className="w-4 h-4 accent-[#d97706] cursor-pointer"
            disabled={!canDirectEdit}
          />
        </td>
      )}
      {showTardy && (
        <td className="px-3 py-2.5 text-center">
          <input
            type="checkbox"
            checked={!!p?.tardy}
            onChange={(e) => {
              const next = e.target.checked;
              onLocalPatch({ tardy: next });
              onSaveProgress({ tardy: next });
            }}
            className="w-4 h-4 accent-[#d97706] cursor-pointer"
            disabled={!canDirectEdit}
          />
        </td>
      )}
      {showTeacherName && (
        <td className="px-3 py-2.5">
          {canDirectEdit ? (
            <TeacherNameInput
              value={isTeacher ? toSurnameOnly(p?.teacher_name) : (p?.teacher_name ?? '')}
              selfName={selfName}
              onSave={(v) => {
                onLocalPatch({ teacher_name: v ?? undefined });
                onSaveProgress({ teacher_name: v });
              }}
            />
          ) : (
            <span className="px-1.5 py-1 text-xs text-[#d1d5db]">—</span>
          )}
        </td>
      )}
    </tr>
  );
}

/**
 * 表内の引継ぎメモセル。
 * 従来は1行のテキストエリアで、入力済みでも1行に切れて読みづらかった。
 * 入力済み・非編集時は全文を折り返して読みやすく表示し（クリックで編集）、
 * 編集時は内容量に合わせて高さが自動で伸びるテキストエリアにする。
 */
function HandoverCell({ value, onSave }: { value: string; onSave: (v: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setText(value), [value]);

  // 編集開始時にフォーカスし、内容量に合わせて高さを合わせる
  useEffect(() => {
    if (editing && taRef.current) {
      const el = taRef.current;
      el.focus();
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [editing]);

  const commit = () => {
    const next = text.trim() || null;
    if ((next ?? '') !== (value ?? '')) onSave(next);
    setEditing(false);
  };

  // 入力済み・非編集: 全文を折り返して表示（クリックで編集に入る）
  if (!editing && value) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        // 全角20字あたりで折り返す（max-w-[20em] は text-[13px] 基準で 260px = 全角20字）。
        // break-words は URL や英数字の長い連続を溢れさせないため。
        className="w-full min-w-[9rem] max-w-[20em] cursor-text whitespace-pre-wrap break-words rounded border border-transparent bg-[#f8fafc] px-1.5 py-1 text-left text-[13px] leading-snug text-gray-800 transition-colors duration-150 ease-out hover:border-[#e5e7eb]"
        title="クリックで編集"
      >
        {value}
      </button>
    );
  }

  // 空欄 or 編集中: 高さ自動調整のテキストエリア
  return (
    <textarea
      ref={taRef}
      value={text}
      placeholder="引継ぎメモ"
      rows={1}
      onFocus={() => setEditing(true)}
      onChange={(e) => {
        setText(e.target.value);
        e.target.style.height = 'auto';
        e.target.style.height = `${e.target.scrollHeight}px`;
      }}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      // 表示時と同じ幅で折り返す（編集に入った瞬間に行の折れ方が変わらないように）
      className="w-full min-h-[30px] min-w-[9rem] max-w-[20em] resize-none overflow-hidden rounded border border-transparent bg-transparent px-1.5 py-1 align-top text-[13px] leading-snug outline-none hover:border-[#e5e7eb] focus:border-[#1e3a5f] focus:bg-white"
    />
  );
}
