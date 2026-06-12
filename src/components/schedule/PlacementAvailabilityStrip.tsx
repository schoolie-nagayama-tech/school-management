'use client';

/**
 * 配置モード用「出席可能日程ストリップ」コンポーネント（案E: ドットマトリクス）
 *
 * 座席表の配置モード中に、対象生徒の通塾可能日程を
 * 「日付 × 時限」のドットマトリクスで可視化する。
 *
 * - グレー = 不可（キーなし）
 * - 黄(amber-400) = 可（通常）/ amber-300（regular_pattern フォールバック時）
 * - 緑(success) = 配置済み
 * - 赤(danger) = 満席（出勤可能講師が全員上限埋まり）
 *
 * 日付ヘッダまたは粒のクリックで onDayClick を呼ぶ → 座席表がその週へジャンプ。
 */

import { Fragment } from 'react';
import type { PlacementStripData, StripCellStatus } from '@/lib/api/placement-availability';

interface Props {
  data: PlacementStripData | null;
  loading: boolean;
  studentName: string;
  subjectName: string;
  /** 座席表で現在表示中の週の月曜日 YYYY-MM-DD */
  weekStartStr: string;
  /** クリックされた日付 YYYY-MM-DD を親に通知 */
  onDayClick: (date: string) => void;
}

// =====================================================
// 日付ユーティリティ
// =====================================================

/** JST 安全な曜日取得（0=日 〜 6=土） */
function getDow(dateStr: string): number {
  return new Date(dateStr + 'T12:00:00').getDay();
}

/** 今日の日付を JST で取得 */
function getTodayJST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
}

/** 月初・週先頭（月曜）列のヘッダ表記: "M/D"、それ以外は "D" のみ */
function buildDateLabel(dateStr: string): { full: string; day: string } {
  const parts = dateStr.split('-');
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  const dayStr = String(day);
  const fullStr = `${month}/${day}`;
  // 月初(1日)か週先頭なら "M/D" 形式
  return { full: fullStr, day: dayStr };
}

// =====================================================
// セル色 / title テキスト
// =====================================================

const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];
const STATUS_LABEL: Record<StripCellStatus, string> = {
  available: '出席可',
  placed: '配置済み',
  full: '満席',
};

/** セルの背景 Tailwind クラスを返す */
function cellBg(
  status: StripCellStatus | null,
  source: PlacementStripData['source']
): string {
  if (status === 'placed') return 'bg-success';
  if (status === 'full') return 'bg-danger';
  if (status === 'available') {
    // regular_pattern フォールバック時は薄め（amber-300）
    return source === 'regular_pattern' ? 'bg-amber-300' : 'bg-amber-400';
  }
  // null = 不可
  return 'bg-gray-200';
}

/** title 属性テキスト。日付・コマ・状態を含む */
function cellTitle(
  dateStr: string,
  slotNumber: number,
  status: StripCellStatus | null
): string {
  const d = new Date(dateStr + 'T12:00:00');
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const dow = DOW_JA[d.getDay()];
  const label = status ? STATUS_LABEL[status] : '出席不可';
  return `${month}/${day}(${dow}) ${slotNumber}限 ${label}`;
}

// =====================================================
// メインコンポーネント
// =====================================================

export function PlacementAvailabilityStrip({
  data,
  loading,
  studentName,
  subjectName,
  weekStartStr,
  onDayClick,
}: Props) {
  // ローディング中: 小さく表示
  if (loading) {
    return (
      <div className="print:hidden border border-border-default rounded-lg bg-white p-3 text-xs text-text-muted">
        日程を読み込み中…
      </div>
    );
  }

  // データなし: 何も描画しない
  if (!data) return null;

  const { dates, slots, statusByKey, source, startDate, endDate } = data;
  if (dates.length === 0 || slots.length === 0) return null;

  const today = getTodayJST();
  // 表示中の週の範囲（weekStartStr から +6日）
  const weekEndDate = (() => {
    const d = new Date(weekStartStr + 'T12:00:00');
    d.setDate(d.getDate() + 6);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  })();

  // データ源バッジの設定
  const sourceBadge = (() => {
    if (source === 'regular_pattern') {
      return {
        text: '通塾日程（毎週）※講習可能表 未提出',
        className: 'bg-gray-100 text-gray-600 border border-gray-300',
      };
    }
    if (source === 'zoukoma') {
      return {
        text: '増コマ申込の枠',
        className: 'bg-amber-50 text-amber-700 border border-amber-300',
      };
    }
    // shift_submission
    return {
      text: '講習可能表',
      className: 'bg-green-50 text-green-700 border border-green-300',
    };
  })();

  return (
    <div className="print:hidden border border-border-default rounded-lg bg-white p-2 overflow-x-auto">
      {/* ヘッダ行: 左=タイトル+バッジ / 右=凡例 */}
      <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-border-default flex-wrap min-w-0">
        {/* 左: 生徒名・科目名・ソースバッジ */}
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <span className="text-xs font-semibold text-text-body whitespace-nowrap">
            出席可能日程: {studentName}
          </span>
          {subjectName && (
            <span className="text-xs text-text-muted whitespace-nowrap">（{subjectName}）</span>
          )}
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${sourceBadge.className}`}>
            {sourceBadge.text}
          </span>
        </div>

        {/* 右: 凡例（粒見本） */}
        <div className="flex items-center gap-2 text-[10px] text-text-muted flex-shrink-0">
          <LegendDot color="bg-gray-200" label="不可" />
          <LegendDot color={source === 'regular_pattern' ? 'bg-amber-300' : 'bg-amber-400'} label="可" />
          <LegendDot color="bg-success" label="配置済み" />
          <LegendDot color="bg-danger" label="満席" />
        </div>
      </div>

      {/* regular_pattern フォールバック時の注記 */}
      {source === 'regular_pattern' && (
        <p className="text-[10px] text-text-muted mb-1.5 leading-relaxed">
          通塾日程を参考に表示。講習可能表が提出されると正確な枠に切り替わります。
        </p>
      )}

      {/* マトリクス本体 */}
      {/* 行1: 日付ラベル行 / 行2〜: 時限行 */}
      <div
        className="inline-grid text-[8px]"
        style={{
          gridTemplateColumns: `32px repeat(${dates.length}, auto)`,
        }}
      >
        {/* 左上の空セル */}
        <div />

        {/* 日付ヘッダ行 */}
        {dates.map((dateStr, idx) => {
          const dow = getDow(dateStr);
          const isMonday = dow === 1;
          const isFirstDate = idx === 0;
          const { full: fullLabel, day: dayLabel } = buildDateLabel(dateStr);
          // 月初(1日)または先頭の列は "M/D" 表記
          const isMonthStart = dateStr.endsWith('-01');
          const label = isFirstDate || isMonday || isMonthStart ? fullLabel : dayLabel;

          const isToday = dateStr === today;
          const isInCurrentWeek = dateStr >= weekStartStr && dateStr <= weekEndDate;
          // 土日は薄いグレー文字
          const textColor =
            dow === 0
              ? 'text-red-400'
              : dow === 6
              ? 'text-blue-400'
              : 'text-text-muted';

          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => onDayClick(dateStr)}
              className={[
                'flex flex-col items-center justify-end pb-0.5 cursor-pointer transition-opacity hover:opacity-70 select-none w-5',
                // 週境界(月曜): 左にマージンと細いボーダー
                isMonday && !isFirstDate ? 'border-l border-gray-200 ml-1 pl-1' : '',
                // 表示中週の列背景
                isInCurrentWeek ? 'bg-info/5 rounded-t' : '',
              ].join(' ')}
              title={dateStr}
              aria-label={`${dateStr}の週へ移動`}
            >
              {/* 今日は青ドット */}
              {isToday ? (
                <span className="w-1.5 h-1.5 rounded-full bg-info mb-0.5 block" />
              ) : (
                <span className="w-1.5 h-1.5 mb-0.5 block" />
              )}
              <span className={`leading-none ${textColor} whitespace-nowrap`}>{label}</span>
            </button>
          );
        })}

        {/* 時限行 */}
        {slots.map((slot) => (
          <Fragment key={slot.id}>
            {/* 行頭の時限ラベル */}
            <div
              className="flex items-center justify-end pr-1 text-[9px] text-text-muted leading-none self-center"
            >
              {slot.slot_number}限
            </div>

            {/* 各日付のセル */}
            {dates.map((dateStr, idx) => {
              const dow = getDow(dateStr);
              const isMonday = dow === 1;
              const isFirstDate = idx === 0;
              const cellKey = `${dateStr}_${slot.id}`;
              const status = statusByKey.get(cellKey) ?? null;
              const isInCurrentWeek = dateStr >= weekStartStr && dateStr <= weekEndDate;

              return (
                <div
                  key={cellKey}
                  className={[
                    'flex items-center justify-center py-0.5',
                    // 週境界マージン
                    isMonday && !isFirstDate ? 'border-l border-gray-200 ml-1 pl-1' : '',
                    // 表示中週の列背景
                    isInCurrentWeek ? 'bg-info/5' : '',
                  ].join(' ')}
                  onClick={() => onDayClick(dateStr)}
                  style={{ cursor: 'pointer' }}
                >
                  {/* ドット粒: 10px 角丸 */}
                  <div
                    className={`w-[10px] h-[10px] rounded-[3px] transition-colors hover:opacity-80 ${cellBg(status, source)}`}
                    title={cellTitle(dateStr, slot.slot_number, status)}
                  />
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>

      {/* 期間テキスト（補足情報） */}
      <p className="text-[9px] text-text-muted mt-1 text-right">
        {startDate.slice(5).replace('-', '/')} 〜 {endDate.slice(5).replace('-', '/')}
      </p>
    </div>
  );
}

// =====================================================
// 凡例ドット（ヘッダ右側用）
// =====================================================

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-0.5">
      <span className={`inline-block w-2 h-2 rounded-[2px] ${color}`} />
      <span>{label}</span>
    </span>
  );
}
