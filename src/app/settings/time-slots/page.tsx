import { redirect } from 'next/navigation';

/**
 * 旧「コマ時間設定」ページ。
 * コマ時間は「授業の設定」（/schedule/special-courses）に統合したので、
 * 既存のブックマーク・リンク切れ防止のためリダイレクトだけ残す。
 */
export default function TimeSlotsSettingsRedirect() {
  redirect('/schedule/special-courses');
}
