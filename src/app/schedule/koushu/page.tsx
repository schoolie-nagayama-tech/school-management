import { redirect } from 'next/navigation';

// 講習 申込は「申込管理」画面（講習タブ）に統合。旧URLは互換のためリダイレクト。
export default function KoushuRedirectPage() {
  redirect('/schedule/enrollments');
}
