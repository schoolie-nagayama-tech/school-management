import { redirect } from 'next/navigation';

/**
 * 旧「授業生徒数設定」ページ。
 * 定員は「授業の設定」（/schedule/special-courses）の形態タブに統合したので、
 * 既存のブックマーク・リンク切れ防止のためリダイレクトだけ残す。
 */
export default function ClassCapacitySettingsRedirect() {
  redirect('/schedule/special-courses');
}
