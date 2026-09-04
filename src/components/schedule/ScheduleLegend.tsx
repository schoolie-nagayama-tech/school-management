'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { getSubjectChip, type SubjectChipTone } from './scheduleBadges';
import styles from './scheduleDensity.module.css';

const TONE_CLASS: Record<SubjectChipTone, string> = {
  indigo: styles.subjIndigo,
  blue: styles.subjBlue,
  emerald: styles.subjEmerald,
  teal: styles.subjTeal,
  amber: styles.subjAmber,
  violet: styles.subjViolet,
  gray: styles.subjGray,
};

/**
 * 座席表の凡例（Phase U）。
 * 状態は「行色」で表現するため、行色の意味を凡例に集約する。
 * 種別バッジ色・科目チップ色は scheduleBadges.ts の単一ソースを参照（StudentCard と一致）。
 */
export function ScheduleLegend() {
  const [open, setOpen] = useState(false);

  return (
    <div className={`print:hidden text-xs ${styles.root}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[var(--paragraph)] hover:text-[var(--headline)]"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        凡例
      </button>
      {open && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 rounded-lg border border-[var(--stroke)] bg-white">
          {/* 行の色（状態） */}
          <span className="text-[var(--paragraph)] font-medium">行の色:</span>
          <RowSwatch className="bg-white border-[var(--stroke)]" label="白=通常" />
          <RowSwatch
            style={{
              background: 'var(--sd-transfer-row-bg)',
              borderColor: 'var(--sd-today-border)',
            }}
            label="青=振替"
          />
          <span className="inline-flex items-center gap-1">
            <span
              className="w-4 h-4 rounded border"
              style={{
                background: 'var(--sd-absent-row-bg)',
                borderColor: 'var(--border-default)',
              }}
            />
            <span className="line-through text-[var(--paragraph-light)]">グレー＝欠席</span>
          </span>
          <RowSwatch
            style={{ background: 'var(--success-subtle)', borderColor: 'var(--success)' }}
            label="緑=体験"
          />
          <RowSwatch
            style={{
              background: 'var(--sd-testprep-row-bg)',
              borderColor: 'var(--sd-warn-border)',
            }}
            label="橙=テスト対策"
          />
          <RowSwatch
            style={{
              background: 'var(--sd-additional-row-bg)',
              borderColor: 'oklch(60% 0.15 300)',
            }}
            label="紫=追加授業"
          />
          <span className="inline-flex items-center gap-1">
            <span className={styles.seatEmpty} style={{ minHeight: 16, width: 40, margin: 0 }}>
              空席
            </span>
            <span className="text-[var(--paragraph)]">緑破線=空席（振替モードのみ）</span>
          </span>

          <span className="w-px h-4 bg-[var(--stroke)]" />

          {/* Phase R: 個別の授業モデル（1対1・45分半コマ） */}
          <span className="text-[var(--paragraph)] font-medium">個別:</span>
          <span className="inline-flex items-center gap-1">
            <span className={styles.ratioTag}>1:1</span>
            <span className="text-[var(--paragraph)]">1対1（生徒1名で満席）</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className={styles.halfChip}>前</span>
            <span className={styles.halfChip}>後</span>
            <span className="text-[var(--paragraph)]">45分の前半/後半</span>
          </span>

          <span className="w-px h-4 bg-[var(--stroke)]" />

          {/* バッジ（単発コマの種別は行色へ移したので、残るのは下書きマークだけ） */}
          <span className="text-[var(--paragraph)] font-medium">印:</span>
          <LegendBadge className="bg-info text-white" label="仮" desc="自動マッチング下書き" />
          <LegendBadge className="bg-success text-white" label="見込" desc="未入会の体験" />

          <span className="w-px h-4 bg-[var(--stroke)]" />

          {/* 科目チップ */}
          <span className="text-[var(--paragraph)] font-medium">科目:</span>
          {['国語', '数学', '英語', '理科', '社会', 'HAL'].map((name) => {
            const { label, tone } = getSubjectChip(name);
            return (
              <span key={name} className={`${styles.subjChip} ${TONE_CLASS[tone]}`} title={name}>
                {label}
              </span>
            );
          })}

          <span className="w-px h-4 bg-[var(--stroke)]" />
          <span className="text-[var(--paragraph)]">
            生徒行クリックで欠席・振替メニュー / 空きのある講師カードは左縁が緑 /
            授業の入っていない講師はコマ枠の下にまとめて表示
          </span>
        </div>
      )}
    </div>
  );
}

function RowSwatch({
  className,
  style,
  label,
}: {
  className?: string;
  style?: React.CSSProperties;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`w-4 h-4 rounded border ${className ?? ''}`} style={style} />
      <span className="text-[var(--paragraph)]">{label}</span>
    </span>
  );
}

function LegendBadge({
  className,
  label,
  desc,
}: {
  className: string;
  label: string;
  desc?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`px-1 py-0.5 rounded text-[9px] font-bold leading-none ${className}`}>
        {label}
      </span>
      {desc && <span className="text-[var(--paragraph)]">{desc}</span>}
    </span>
  );
}
