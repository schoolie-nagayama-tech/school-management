'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent, CardHeader, CardTitle, Loading } from '@/components/ui';
import { AttendanceMatrix } from '@/components/students/AttendanceMatrix';
import { getStudent } from '@/lib/api/students';
import { useAuth } from '@/contexts/AuthContext';
import AccessDenied from '@/components/AccessDenied';
import type { Student } from '@/types/database';

export default function StudentSchedulePage() {
  const params = useParams();
  const { getSelectedSchoolIds, profile } = useAuth();
  const studentId = params?.studentId as string;
  const searchParams = useSearchParams();
  const isOnboarding = searchParams?.get('onboarding') === '1';
  const [student, setStudent] = useState<Student | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStudent = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    try {
      const schoolIds = getSelectedSchoolIds();
      const s = await getStudent(studentId, schoolIds.length > 0 ? schoolIds : undefined);
      setStudent(s);
    } catch {
      setStudent(null);
    } finally {
      setLoading(false);
    }
  }, [studentId, getSelectedSchoolIds]);

  useEffect(() => {
    loadStudent();
  }, [loadStudent]);

  // 通塾日程の編集は室長以上のみ。講師はアクセス不可
  if (profile && profile.role === 'teacher') {
    return (
      <AdminLayout headerTitle="通塾日程">
        <AccessDenied />
      </AdminLayout>
    );
  }

  if (loading) {
    return (
      <AdminLayout headerTitle="通塾日程">
        <Loading size="md" />
      </AdminLayout>
    );
  }

  if (!student) {
    return (
      <AdminLayout headerTitle="通塾日程">
        <div className="py-8 text-center text-[var(--paragraph)]">
          生徒が見つかりません
          <div className="mt-4">
            <Link
              href="/students"
              className="text-[var(--primary)] hover:underline transition-[color] duration-150 ease-out"
            >
              生徒一覧へ
            </Link>
          </div>
        </div>
      </AdminLayout>
    );
  }

  const schoolId = student.school_id ?? '';
  const studentName = `${student.last_name} ${student.first_name}`;

  return (
    <AdminLayout headerTitle="通塾日程">
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link
            href="/students"
            className="text-sm text-[var(--paragraph)] hover:text-[var(--primary)] transition-[color] duration-150 ease-out"
          >
            ← 生徒一覧
          </Link>
          <h1 className="text-lg font-semibold text-[var(--headline)]">{studentName} の通塾日程</h1>
        </div>

        <Card className="bg-surface border-gray-200">
          <CardHeader>
            <CardTitle>通塾日程</CardTitle>
          </CardHeader>
          <CardContent>
            <AttendanceMatrix
              studentId={studentId}
              schoolId={schoolId}
              studentGrade={student.grade}
              canEdit={profile?.role !== 'teacher'}
              onPatternChange={loadStudent}
            />
          </CardContent>
        </Card>

        {/* 入会フロー（生徒情報 → 授業スケジュール → 教材発注 → 生徒詳細）の途中だけ次の一手を出す。
            日程が未定でも止まらないよう「あとで」で生徒詳細へ抜けられる。 */}
        {isOnboarding && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-raised p-4">
            <p className="text-sm text-[var(--paragraph)]">
              通塾日程の設定はここまでです。続けて教材の発注に進めます。
            </p>
            <div className="flex items-center gap-2">
              <Link
                href={`/students?detail=${studentId}`}
                className="px-3 py-2 rounded-lg border border-border text-sm text-[var(--paragraph)] hover:bg-surface-hover transition-[background-color] duration-150 ease-out"
              >
                あとで（生徒詳細へ）
              </Link>
              <Link
                href={`/ordering?onboarding=${studentId}`}
                className="px-3 py-2 rounded-lg bg-primary text-text-on-primary text-sm font-medium hover:opacity-90 transition-[opacity] duration-150 ease-out"
              >
                教材発注へ進む
              </Link>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
