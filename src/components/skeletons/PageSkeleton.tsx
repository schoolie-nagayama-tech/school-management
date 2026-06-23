/**
 * ページ読み込み中に表示するスケルトンUI群。
 * Next.js の loading.tsx から使用し、データフェッチ完了前の体感速度を改善する。
 */

function Shimmer({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 ${className ?? ''}`} />;
}

// ヘッダーバー（AppHeader相当）
function HeaderSkeleton() {
  return (
    <div className="h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-4">
      <Shimmer className="h-5 w-32" />
      <div className="flex-1" />
      <Shimmer className="h-8 w-8 rounded-full" />
    </div>
  );
}

// テーブル行のスケルトン
function TableRowSkeleton({ cols = 5 }: { cols?: number }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-gray-100">
      {Array.from({ length: cols }).map((_, i) => (
        <Shimmer key={i} className={`h-4 ${i === 0 ? 'w-32' : i === 1 ? 'w-48' : 'w-20'}`} />
      ))}
    </div>
  );
}

// テーブル型ページ（生徒一覧、講師一覧、回答一覧、請求など）
export function TablePageSkeleton({
  title,
  rows = 8,
  cols = 5,
}: {
  title?: string;
  rows?: number;
  cols?: number;
}) {
  return (
    <div className="min-h-screen bg-bg">
      <HeaderSkeleton />
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {title && <Shimmer className="h-7 w-48 mb-6" />}
        {/* ツールバー */}
        <div className="flex items-center gap-3 mb-4">
          <Shimmer className="h-9 w-64 rounded-md" />
          <Shimmer className="h-9 w-24 rounded-md" />
          <div className="flex-1" />
          <Shimmer className="h-9 w-28 rounded-md" />
        </div>
        {/* テーブル */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-4 px-4 py-3 border-b border-gray-200 bg-gray-50">
            {Array.from({ length: cols }).map((_, i) => (
              <Shimmer key={i} className="h-3 w-20" />
            ))}
          </div>
          {Array.from({ length: rows }).map((_, i) => (
            <TableRowSkeleton key={i} cols={cols} />
          ))}
        </div>
      </div>
    </div>
  );
}

// カード型グリッドページ（講習一覧など）
export function CardGridPageSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="min-h-screen bg-bg">
      <HeaderSkeleton />
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center gap-3 mb-6">
          <Shimmer className="h-9 w-64 rounded-md" />
          <div className="flex-1" />
          <Shimmer className="h-9 w-28 rounded-md" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: cards }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
              <Shimmer className="h-5 w-3/4 mb-3" />
              <Shimmer className="h-4 w-1/2 mb-2" />
              <Shimmer className="h-4 w-2/3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// スケジュール型ページ（週間グリッド）
export function SchedulePageSkeleton() {
  return (
    <div className="min-h-screen bg-bg">
      <HeaderSkeleton />
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* 週ナビゲーション */}
        <div className="flex items-center gap-3 mb-4">
          <Shimmer className="h-9 w-9 rounded-md" />
          <Shimmer className="h-6 w-40" />
          <Shimmer className="h-9 w-9 rounded-md" />
          <div className="flex-1" />
          <Shimmer className="h-9 w-28 rounded-md" />
        </div>
        {/* 週間グリッド */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="grid grid-cols-8 border-b border-gray-200">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="p-3 border-r border-gray-100 last:border-r-0">
                <Shimmer className="h-4 w-full" />
              </div>
            ))}
          </div>
          {Array.from({ length: 6 }).map((_, row) => (
            <div key={row} className="grid grid-cols-8 border-b border-gray-100 last:border-b-0">
              {Array.from({ length: 8 }).map((_, col) => (
                <div key={col} className="p-3 h-16 border-r border-gray-100 last:border-r-0">
                  {col > 0 && Math.random() > 0.5 && <Shimmer className="h-8 w-full rounded" />}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// 設定ページ（リンクリスト型）
export function SettingsPageSkeleton() {
  return (
    <div className="min-h-screen bg-bg">
      <HeaderSkeleton />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Shimmer className="h-7 w-32 mb-6" />
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="bg-white rounded-lg border border-gray-200 p-4 flex items-center gap-4"
            >
              <Shimmer className="h-10 w-10 rounded-lg" />
              <div className="flex-1">
                <Shimmer className="h-4 w-32 mb-2" />
                <Shimmer className="h-3 w-48" />
              </div>
              <Shimmer className="h-4 w-4" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// フィードページ（タイムライン型）
export function FeedPageSkeleton() {
  return (
    <div className="min-h-screen bg-bg">
      <HeaderSkeleton />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Shimmer className="h-7 w-40 mb-2" />
        <Shimmer className="h-4 w-64 mb-6" />
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-3 mb-3">
                <Shimmer className="h-8 w-8 rounded-full" />
                <Shimmer className="h-4 w-32" />
                <div className="flex-1" />
                <Shimmer className="h-3 w-16" />
              </div>
              <Shimmer className="h-4 w-full mb-2" />
              <Shimmer className="h-4 w-3/4" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
