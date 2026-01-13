'use client';

interface CancelAgreementProps {
  agreed: boolean;
  onChange: (agreed: boolean) => void;
  disabled?: boolean;
  error?: string;
}

export function CancelAgreement({
  agreed,
  onChange,
  disabled = false,
  error,
}: CancelAgreementProps) {
  return (
    <div className="space-y-4">
      {/* 注意書きボックス */}
      <div className="bg-[#ffeb3b]/20 border border-[#ff8e3c] rounded-lg p-4">
        <p className="text-sm text-[#0d0d0d] leading-relaxed">
          <strong className="font-semibold">重要:</strong>
          <br />
          Vもぎは申込後のキャンセル・返金ができません。日程・会場をよくご確認の上、お申し込みください。
        </p>
      </div>

      {/* 同意チェックボックス */}
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          id="cancel-agreement"
          checked={agreed}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="w-5 h-5 mt-0.5 text-[#ff8e3c] border-[#0d0d0d] rounded focus:ring-[#ff8e3c] cursor-pointer flex-shrink-0"
        />
        <label
          htmlFor="cancel-agreement"
          className="text-sm text-[#0d0d0d] cursor-pointer flex-1"
        >
          上記の内容を理解し、キャンセルできないことに同意します
          <span className="text-[#d9376e] ml-1">*</span>
        </label>
      </div>

      {/* エラーメッセージ */}
      {error && (
        <p className="text-sm text-[#d9376e] ml-8">{error}</p>
      )}
    </div>
  );
}
