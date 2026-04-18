interface PortalErrorBannerProps {
  message: string;
}

export function PortalErrorBanner({ message }: PortalErrorBannerProps) {
  return (
    <div
      role="alert"
      className="bg-[color:var(--primary-subtle)] border border-[color:var(--primary)]/30 rounded-lg p-4"
    >
      <p className="text-sm text-[color:var(--primary-dark)]">{message}</p>
    </div>
  );
}

export function PortalPreviewBanner() {
  return (
    <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg">
      <p className="text-xs text-amber-900 font-medium">
        ＜プレビューモード＞ 管理者確認用です。実際の回答は送信されません。
      </p>
    </div>
  );
}
