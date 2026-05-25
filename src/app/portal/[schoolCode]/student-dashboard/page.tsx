'use client';

/**
 * 生徒/保護者ダッシュボード（保護者ポータル経由・未ログイン）
 *
 * URL: /portal/[schoolCode]/student-dashboard?student_code=XXXX
 *
 * 認証：当面は school_code + student_code の組み合わせを擬似認証として扱う。
 *      生徒アカウントが整備されたら、サインインベースに置き換え予定。
 *
 * 表示構成（モック student-view-v3.html に準拠）：
 *  - ヒーロー：生徒名・学年・教室名
 *  - 今後1週間の授業（日付 + 科目だけのシンプル表示）
 *  - 今月の出欠サマリ（出席/欠席/遅刻/振替）
 *  - 科目ごとの最新報告書カード
 */

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Card, CardContent } from '@/components/ui';
import { Button } from '@/components/ui';
import { Loading } from '@/components/ui';

interface DashboardData {
  school: { name: string };
  student: { id: string; last_name: string; first_name: string; grade: number };
  upcoming: Array<{
    id: string;
    entry_date: string;
    time_slot?: { slot_number: number; start_time: string; end_time: string } | { slot_number: number; start_time: string; end_time: string }[];
    subject_ids: string[];
    teacher?: { display_name: string | null } | { display_name: string | null }[];
    kind: 'regular' | 'koushu';
    formation: 'individual' | 'group';
    transfer_from_id: string | null;
  }>;
  attendance_this_month: { present: number; absent: number; late: number; transfer: number };
  latest_reports_by_subject: Array<{
    id: string;
    subject: string;
    lesson_date: string;
    teacher_name: string | null;
    preview: string;
    homework_completion_pct: number | null;
    vocab_test_score: number | null;
    vocab_test_total: number | null;
    vocab_test_passed: boolean | null;
    check_test_score: number | null;
    check_test_total: number | null;
    check_test_passed: boolean | null;
  }>;
}

function gradeLabel(g: number): string {
  if (g <= 6) return `小${g}`;
  if (g <= 9) return `中${g - 6}`;
  return `高${g - 9}`;
}

function formatDateShort(s: string): string {
  const d = new Date(s + 'T12:00:00');
  const week = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()} (${week})`;
}

export default function StudentDashboardPage() {
  const params = useParams();
  const search = useSearchParams();
  const schoolCode = params.schoolCode as string;
  const initialStudentCode = search.get('student_code') ?? '';

  const [studentCode, setStudentCode] = useState(initialStudentCode);
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchData = async (code: string) => {
    if (!code) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const url = new URL('/api/portal/student-dashboard', window.location.origin);
      url.searchParams.set('school_code', schoolCode);
      url.searchParams.set('student_code', code);
      const res = await fetch(url.toString());
      const body = await res.json();
      if (!res.ok) {
        setErrorMsg(body.error || '取得に失敗しました');
        setData(null);
        return;
      }
      setData(body as DashboardData);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (initialStudentCode) fetchData(initialStudentCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 生徒コード未入力 or 取得失敗時：入力フォーム
  if (!data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 space-y-3">
            <h1 className="text-lg font-bold">生徒ダッシュボード</h1>
            <p className="text-sm text-gray-600">
              校舎から案内された生徒コードを入力してください。
            </p>
            <input
              type="text"
              value={studentCode}
              onChange={(e) => setStudentCode(e.target.value)}
              className="w-full px-3 py-2 border rounded-md text-sm"
              placeholder="生徒コード"
            />
            <Button
              className="w-full"
              disabled={isLoading || !studentCode.trim()}
              onClick={() => fetchData(studentCode.trim())}
            >
              {isLoading ? '取得中...' : '表示'}
            </Button>
            {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) return <Loading />;

  const att = data.attendance_this_month;

  return (
    <div className="min-h-screen bg-gray-50 py-6">
      <div className="max-w-3xl mx-auto px-4 space-y-4">

        {/* ヒーロー */}
        <Card>
          <CardContent className="p-5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-md">
            <div className="text-xs opacity-80 uppercase tracking-wide">マイページ</div>
            <h1 className="text-2xl font-bold mt-1">
              {data.student.last_name} {data.student.first_name}
            </h1>
            <div className="text-sm mt-1 opacity-90">
              {gradeLabel(data.student.grade)} ・ {data.school.name}
            </div>
          </CardContent>
        </Card>

        {/* 今後1週間 */}
        <Card>
          <CardContent className="p-4">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
              今後1週間の授業
            </h2>
            {data.upcoming.length === 0 ? (
              <p className="text-sm text-gray-500 py-2">予定はありません</p>
            ) : (
              <ul className="space-y-1">
                {data.upcoming.map((u) => {
                  const slot = Array.isArray(u.time_slot) ? u.time_slot[0] : u.time_slot;
                  const teacher = Array.isArray(u.teacher) ? u.teacher[0] : u.teacher;
                  return (
                    <li
                      key={u.id}
                      className="flex items-center gap-3 p-2 border rounded text-sm bg-white"
                    >
                      <span className="font-bold tabular-nums w-20 flex-shrink-0">
                        {formatDateShort(u.entry_date)}
                      </span>
                      <span className="text-xs text-gray-500 w-16 flex-shrink-0">
                        {slot ? `${slot.start_time?.slice(0, 5)}〜` : ''}
                      </span>
                      <span className="flex-1 min-w-0">
                        担当: {teacher?.display_name ?? '-'}
                      </span>
                      {u.kind === 'koushu' && (
                        <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 text-[10px] rounded font-semibold">
                          講習
                        </span>
                      )}
                      {u.formation === 'group' && (
                        <span className="px-1.5 py-0.5 bg-purple-100 text-purple-800 text-[10px] rounded font-semibold">
                          集団
                        </span>
                      )}
                      {u.transfer_from_id && (
                        <span className="px-1.5 py-0.5 bg-orange-100 text-orange-800 text-[10px] rounded font-semibold">
                          振替
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* 今月の出欠サマリ */}
        <Card>
          <CardContent className="p-4">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
              今月の出欠
            </h2>
            <div className="grid grid-cols-4 gap-2">
              <AttBox label="出席" value={att.present} color="green" />
              <AttBox label="欠席" value={att.absent} color="red" />
              <AttBox label="遅刻" value={att.late} color="amber" />
              <AttBox label="振替" value={att.transfer} color="indigo" />
            </div>
          </CardContent>
        </Card>

        {/* 科目ごとの最新報告 */}
        <Card>
          <CardContent className="p-4">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
              科目ごとの最新の授業報告
            </h2>
            {data.latest_reports_by_subject.length === 0 ? (
              <p className="text-sm text-gray-500 py-2">
                公開済みの報告書はまだありません
              </p>
            ) : (
              <div className="space-y-2">
                {data.latest_reports_by_subject.map((r) => (
                  <div key={r.id} className="p-3 border rounded">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-sm">{r.subject}</span>
                      <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                        {r.lesson_date}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mb-1">担当: {r.teacher_name ?? '-'}</div>
                    <div className="text-xs text-gray-700 line-clamp-2 mb-1">
                      {r.preview || '記述なし'}
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      {r.homework_completion_pct != null && (
                        <span className="px-1.5 py-0.5 bg-gray-100 text-[10px] rounded">
                          宿題 <strong>{r.homework_completion_pct}%</strong>
                        </span>
                      )}
                      {r.vocab_test_score != null && r.vocab_test_total != null && (
                        <span
                          className={`px-1.5 py-0.5 text-[10px] rounded ${
                            r.vocab_test_passed ? 'bg-green-100 text-green-700' : 'bg-gray-100'
                          }`}
                        >
                          単語 <strong>{r.vocab_test_score}/{r.vocab_test_total}</strong>
                        </span>
                      )}
                      {r.check_test_score != null && r.check_test_total != null && (
                        <span
                          className={`px-1.5 py-0.5 text-[10px] rounded ${
                            r.check_test_passed ? 'bg-green-100 text-green-700' : 'bg-gray-100'
                          }`}
                        >
                          確認 <strong>{r.check_test_score}/{r.check_test_total}</strong>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-gray-400 text-center pb-4">
          ※ 仮実装。生徒アカウント整備後にサインインベースに置き換え予定です。
        </p>
      </div>
    </div>
  );
}

function AttBox({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: 'green' | 'red' | 'amber' | 'indigo';
}) {
  const colorClass = {
    green: 'text-green-700',
    red: 'text-red-700',
    amber: 'text-amber-700',
    indigo: 'text-indigo-700',
  }[color];
  return (
    <div className="text-center bg-gray-50 rounded p-2">
      <div className={`text-2xl font-bold ${colorClass}`}>{value}</div>
      <div className="text-[10px] text-gray-500 font-semibold mt-0.5">{label}</div>
    </div>
  );
}
