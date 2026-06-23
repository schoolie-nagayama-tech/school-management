'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { InterviewList } from '@/components/students/InterviewList';
import { getStudent } from '@/lib/api/students';
import { getDefaultSchoolId } from '@/lib/api/schools';
import { Button, Loading } from '@/components/ui';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import type { Student } from '@/types/database';

export default function StudentInterviewsPage() {
  const params = useParams();
  const router = useRouter();
  const { getSelectedSchoolIds } = useAuth();
  // 面談記録の閲覧権限ガード（保護者等の直リンク流入を防ぐ。講師は canAccessInterviews=true で通過）
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessInterviews
  );
  const studentId = params.studentId as string;
  const [student, setStudent] = useState<Student | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const schoolId = student?.school_id ?? getSelectedSchoolIds()[0] ?? getDefaultSchoolId();

  useEffect(() => {
    async function fetchStudent() {
      try {
        const schoolIds = getSelectedSchoolIds();
        const data = await getStudent(studentId, schoolIds.length > 0 ? schoolIds : undefined);
        setStudent(data);
      } catch (error) {
        console.error('Error fetching student:', error);
      } finally {
        setIsLoading(false);
      }
    }
    if (studentId) {
      fetchStudent();
    }
  }, [studentId, getSelectedSchoolIds]);

  if (permissionLoading) {
    return (
      <AdminLayout headerTitle="面談記録">
        <Loading className="min-h-[60vh]" />
      </AdminLayout>
    );
  }

  if (!hasPermission) {
    return (
      <AdminLayout headerTitle="面談記録">
        <AccessDenied message="面談記録の閲覧権限がありません" />
      </AdminLayout>
    );
  }

  if (isLoading) {
    return (
      <AdminLayout headerTitle="面談記録">
        <Loading className="min-h-[60vh]" />
      </AdminLayout>
    );
  }

  if (!student) {
    return (
      <AdminLayout headerTitle="面談記録">
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <p className="text-danger text-lg mb-4">生徒が見つかりません</p>
            <Button onClick={() => router.push('/students')}>生徒一覧に戻る</Button>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="面談記録">
      <div>
        {/* ヘッダー */}
        <div className="mb-6">
          <Button variant="ghost" onClick={() => router.push('/students')} className="mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            生徒一覧に戻る
          </Button>
          <h1 className="text-2xl font-bold text-text-heading">
            {student.last_name} {student.first_name} の面談記録
          </h1>
        </div>

        {/* 面談記録リスト */}
        <InterviewList studentId={studentId} schoolId={schoolId} />
      </div>
    </AdminLayout>
  );
}
