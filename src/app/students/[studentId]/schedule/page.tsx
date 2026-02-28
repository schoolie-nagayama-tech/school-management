'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { StudentRegularScheduleList } from '@/components/students/StudentRegularScheduleList';
import { getStudent } from '@/lib/api/students';
import { useAuth } from '@/contexts/AuthContext';
import AccessDenied from '@/components/AccessDenied';
import type { Student } from '@/types/database';

export default function StudentSchedulePage() {
  const params = useParams();
  const { getSelectedSchoolIds, profile } = useAuth();
  const studentId = params?.studentId as string;
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
        <div className="py-8 text-center text-[var(--paragraph)]">読み込み中...</div>
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
              className="text-[var(--primary)] hover:underline"
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
            className="text-sm text-[var(--paragraph)] hover:text-[var(--primary)]"
          >
            ← 生徒一覧
          </Link>
          <h1 className="text-lg font-semibold text-[var(--headline)]">
            {studentName} の通塾日程
          </h1>
        </div>

        <Card className="bg-[#f8f8f8] border-gray-200">
          <CardHeader>
            <CardTitle>通塾日程</CardTitle>
          </CardHeader>
          <CardContent>
            <StudentRegularScheduleList
              studentId={studentId}
              schoolId={schoolId}
              studentName={studentName}
              studentGrade={student.grade}
              onRefresh={loadStudent}
            />
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
