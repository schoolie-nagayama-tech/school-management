import { WifiOff } from 'lucide-react';

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-bg text-text-body">
      <WifiOff className="w-12 h-12 text-text-muted" />
      <h1 className="text-xl font-semibold text-text-heading">オフラインです</h1>
      <p className="text-sm text-text-muted text-center max-w-xs">
        ネットワークに接続できません。
        <br />
        接続が回復すると自動的に再開します。
      </p>
    </div>
  );
}
