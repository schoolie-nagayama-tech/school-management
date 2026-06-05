import { redirect } from 'next/navigation';

// テスト対策 申込は「申込管理」画面（テスト対策タブ）に統合。旧URLは互換のためリダイレクト。
export default function ZoukomaRedirectPage() {
  redirect('/schedule/enrollments?tab=testprep');
}
