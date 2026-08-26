import { redirect } from 'next/navigation';

/** 旧ルート → 「授業の設定」（/schedule/special-courses）へリダイレクト */
export default function ScheduleTimeSlotsRedirect() {
  redirect('/schedule/special-courses');
}
