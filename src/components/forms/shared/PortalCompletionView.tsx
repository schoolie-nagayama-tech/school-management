import { Check } from 'lucide-react';

interface PortalCompletionViewProps {
  /** 戻り先ポータルの教室コード */
  schoolCode: string;
  /** 完了タイトル（デフォルト: "お申込みありがとうございます"） */
  title?: string;
  /** 完了サブメッセージ（デフォルト: 確認メール送信の案内） */
  message?: string;
  /** フォーム期間に設定された完了メッセージ（任意） */
  completionMessage?: string | null;
}

/**
 * 保護者ポータルのフォーム送信完了画面。
 * ブランド赤のチェックリングを表示し、ポータルへの戻りリンクを提供する。
 */
export function PortalCompletionView({
  schoolCode,
  title = 'お申込みありがとうございます',
  message = '受付完了メールを保護者様宛にお送りしました。',
  completionMessage,
}: PortalCompletionViewProps) {
  return (
    <div className="bg-white rounded-2xl border border-[#e5e7eb] p-8 sm:p-10 text-center">
      <div className="mb-6">
        <div className="w-14 h-14 rounded-full bg-[color:var(--primary-subtle)] ring-1 ring-[color:var(--primary)]/20 flex items-center justify-center mx-auto mb-6">
          <Check className="w-7 h-7 text-[color:var(--primary)]" />
        </div>
        <h2 className="text-[22px] font-bold text-[#1a1a1a] mb-3 tracking-tight">{title}</h2>
        <p className="text-sm text-[#4b5563] leading-relaxed">{message}</p>
        {completionMessage && (
          <div className="mt-6 p-4 bg-[#f8f8f8] rounded-lg text-left border border-[#e5e7eb]">
            <p className="text-sm text-[#4b5563] whitespace-pre-line leading-relaxed">
              {completionMessage}
            </p>
          </div>
        )}
      </div>
      <a
        href={`/portal/${schoolCode}`}
        className="inline-block px-6 py-3 bg-[color:var(--primary)] text-white font-semibold rounded-lg hover:bg-[color:var(--primary-dark)] transition-colors duration-150"
      >
        ポータルに戻る
      </a>
    </div>
  );
}
