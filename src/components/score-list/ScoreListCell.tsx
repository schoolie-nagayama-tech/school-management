'use client';

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
      <td className="border border-gray-200 px-1 py-0.5 text-center min-w-[52px]">
        <input
          type="text"
          value={editValue}
          onChange={(e) => onCellChange(e.target.value)}
          onBlur={() => onCellBlur(assessmentId, subject)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCellBlur(assessmentId, subject);
            if (e.key === 'Escape') onCancelEdit();
          }}
          className="w-full px-1 py-0.5 text-center text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
          autoFocus
        />
      </td>
    );
  }

  return (
    <td className="border border-gray-200 px-1 py-0.5 text-center min-w-[52px]">
      <div
        className={`min-h-[24px] flex items-center justify-center text-xs ${
          canEdit ? 'cursor-pointer hover:bg-gray-50 rounded' : ''
        }`}
        onClick={canEdit ? () => onCellClick(assessmentId, subject, value) : undefined}
      >
        {value != null ? (
          <span>
            {value}
            <DiffBadge diff={diff} />
          </span>
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </div>
    </td>
  );
}

/** 合計セル（編集不可） */
export function ScoreListSumCell({
  value,
  diff,
}: {
  value: number | null;
  diff: number | null;
}) {
  return (
    <td className="border border-gray-200 px-1 py-0.5 text-center min-w-[52px] bg-gray-50 font-medium">
      <div className="min-h-[24px] flex items-center justify-center text-xs">
        {value != null ? (
          <span>
            {value}
            <DiffBadge diff={diff} />
          </span>
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </div>
    </td>
  );
}

function DiffBadge({ diff }: { diff: number | null }) {
  if (diff == null) return null;
  if (diff === 0) {
    return <span className="text-[10px] text-gray-400 ml-0.5">(±0)</span>;
  }
  if (diff > 0) {
    return <span className="text-[10px] text-green-600 ml-0.5 font-medium">(+{diff})</span>;
  }
  return <span className="text-[10px] text-red-600 ml-0.5 font-medium">({diff})</span>;
}
