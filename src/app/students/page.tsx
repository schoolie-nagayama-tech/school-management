import { Suspense } from 'react';
import { StudentsPageClient } from './StudentsPageClient';
import { BulletinBoard } from '@/components/bulletin/BulletinBoard';
import { AlertBoard } from '@/components/alerts';
import { prefetchBulletinInitial } from '@/lib/api/bulletin-server';
import { prefetchAlertInitial } from '@/lib/api/alert-server';
import { prefetchNotificationInitial } from '@/lib/api/notification-server';

// 掲示板の初期データをサーバーで取得し BulletinBoard を初期描画する非同期サーバーコンポーネント。
// Suspense 内に置くことで、ページ本体(StudentsPageClient)は即ストリーミングされ、
// 掲示板はデータが揃い次第ストリーミングされる（本体描画をブロックしない）。
async function BulletinServerSlot() {
  const initial = await prefetchBulletinInitial();
  // 取得失敗(null)時は initialData 無し → BulletinBoard が従来通りクライアント取得にフォールバック
  return <BulletinBoard initialData={initial ?? undefined} />;
}

// アラート(Light)の初期データをサーバーで取得し AlertBoard を初期描画する非同期サーバーコンポーネント。
// AlertBoard は onStudentClick 等のクライアントクロージャ prop を取らないため、bulletin と同様に
// Suspense スロットとしてストリーミングできる（Heavy アラートは従来どおりクライアントで遅延取得）。
async function AlertServerSlot() {
  const initial = await prefetchAlertInitial();
  return <AlertBoard initialData={initial ?? undefined} />;
}

export default async function StudentsPage() {
  // 通知フィードは onStudentClick（クライアントのクロージャ）を必要とするため、bulletin/alert のように
  // Server Component の Suspense スロットへ切り出せない（React18/Next14 では client コンポーネントへ
  // promise を渡して use() で解くパターンが未対応）。そこで初期データだけサーバーで先取りし、
  // シリアライズ可能な prop として StudentsPageClient に渡す（取得失敗時は undefined → 従来取得）。
  // bulletin/alert はクロージャ不要なので Suspense スロットでストリーミングする。
  const notificationInitialData = await prefetchNotificationInitial();

  // 掲示板プレースホルダ（既存の動的 import loading と同じ）
  const boardFallback = <div className="h-64 rounded-xl bg-surface border border-border-subtle" />;

  return (
    <StudentsPageClient
      notificationInitialData={notificationInitialData ?? undefined}
      bulletinSlot={
        <Suspense fallback={boardFallback}>
          <BulletinServerSlot />
        </Suspense>
      }
      alertSlot={
        <Suspense fallback={boardFallback}>
          <AlertServerSlot />
        </Suspense>
      }
    />
  );
}
