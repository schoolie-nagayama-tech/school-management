interface PortalFormHeaderProps {
  /** 小見出し（例: "Vもぎ 申込"）— 大文字・letter-spaced で表示 */
  eyebrow: string;
  /** メインタイトル */
  title: string;
  /** 補足説明（任意、改行保持） */
  description?: string | null;
}

/**
 * 保護者ポータルの各フォーム共通ヘッダー。
 * 青グラデのヒーローは使わず、エディトリアル寄りの静かな見せ方で統一。
 * eyebrow → title → 赤の強調ルール → description の順。
 */
export function PortalFormHeader({ eyebrow, title, description }: PortalFormHeaderProps) {
  return (
    <header className="pt-2 pb-1">
      <p className="text-[11px] font-semibold tracking-[0.18em] text-[color:var(--primary)] uppercase mb-2">
        {eyebrow}
      </p>
      <h1 className="text-[26px] sm:text-[28px] font-bold text-[#1a1a1a] leading-tight tracking-tight">
        {title}
      </h1>
      <div className="mt-3 h-[2px] w-10 bg-[color:var(--primary)] rounded-full" />
      {description && (
        <p className="mt-4 text-[13.5px] text-[#4b5563] leading-relaxed whitespace-pre-line">
          {description}
        </p>
      )}
    </header>
  );
}
