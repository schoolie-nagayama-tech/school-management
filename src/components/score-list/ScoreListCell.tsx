'use client';

function formatScore(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

interface ScoreListCellProps {
  value: number | null;
  diff: number | null;
  assessmentId: string;
  subject: string;
  canEdit: boolean;
  isEditing: boolean;
  editValue: string;
  onCellClick: (assessmentId: string, subject: string, value: number | null) => void;
  onCellChange: (value: string) => void;
  onCellBlur: (assessmentId: string, subject: string) => void;
  onCancelEdit: () => void;
}

export function ScoreListCell({
  value,
  diff,
  assessmentId,
  subject,
  canEdit,
  isEditing,
  editValue,
  onCellClick,
  onCellChange,
  onCellBlur,
  onCancelEdit,
}: ScoreListCellProps) {
  if (isEditing) {
    return (
      <td className="border border-border px-1 py-0.5 text-center min-w-[52px]">
        <input
          type="text"
          value={editValue}
          onChange={(e) => onCellChange(e.target.value)}
          onBlur={() => onCellBlur(assessmentId, subject)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCellBlur(assessmentId, subject);
            if (e.key === 'Escape') onCancelEdit();
          }}
          className="w-full px-1 py-0.5 text-center text-xs border border-border rounded focus:outline-none focus:ring-2 focus:ring-ink"
          autoFocus
        />
      </td>
    );
  }

  return (
    <td className="border border-border px-1 py-0.5 text-center min-w-[52px]">
      <div
        className={`min-h-[24px] flex items-center justify-center text-xs ${
          canEdit ? 'cursor-pointer hover:bg-surface-hover rounded' : ''
        }`}
        onClick={canEdit ? () => onCellClick(assessmentId, subject, value) : undefined}
      >
        {value != null ? (
          <span>
            {formatScore(value)}
            <DiffBadge diff={diff} />
          </span>
        ) : (
          <span className="text-text-faint">—</span>
        )}
      </div>
    </td>
  );
}

/** 合計セル（編集不可） */
export function ScoreListSumCell({ value, diff }: { value: number | null; diff: number | null }) {
  return (
    <td className="border border-border px-1 py-0.5 text-center min-w-[52px] bg-surface font-medium">
      <div className="min-h-[24px] flex items-center justify-center text-xs">
        {value != null ? (
          <span>
            {formatScore(value)}
            <DiffBadge diff={diff} />
          </span>
        ) : (
          <span className="text-text-faint">—</span>
        )}
      </div>
    </td>
  );
}

function DiffBadge({ diff }: { diff: number | null }) {
  if (diff == null) return null;
  const rounded = Math.round(diff * 10) / 10;
  if (rounded === 0) {
    return <span className="text-[10px] text-text-faint ml-0.5">(±0)</span>;
  }
  const formatted = formatScore(rounded);
  // 成績増=success緑、成績減=danger赤 で意味を保つ
  if (rounded > 0) {
    return <span className="text-[10px] text-success ml-0.5 font-medium">(+{formatted})</span>;
  }
  return <span className="text-[10px] text-danger ml-0.5 font-medium">({formatted})</span>;
}
