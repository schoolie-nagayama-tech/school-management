'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, Loading } from '@/components/ui';
import { Button } from '@/components/ui';
import { Badge } from '@/components/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { getSchoolByCode } from '@/lib/api/schools';
import { getTeachersWithAttendance } from '@/lib/api/attendance';
import {
  getCurrentYearMonth,
  getPrevMonth,
  getNextMonth,
  formatYearMonth,
} from '@/lib/utils/date';
import { ATTENDANCE_STATUS_LABELS, ATTENDANCE_STATUS_COLORS } from '@/types/attendance';

interface TeacherWithAttendance {
  id: string;
  name: string;
  sheet_id: string | null;
  status: string;
  total_count: number;
}

export default function AttendancePortalPage() {
  const params = useParams();
  const router = useRouter();
  const schoolCode = params.schoolCode as string;

  const [school, setSchool] = useState<{ id: string; name: string } | null>(null);
  const [teachers, setTeachers] = useState<TeacherWithAttendance[]>([]);
  const [yearMonth, setYearMonth] = useState(getCurrentYearMonth());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      setError(null);
      
      try {
        const schoolData = await getSchoolByCode(schoolCode);
        if (!schoolData) {
          setError('教室が見つかりません');
          return;
        }
        setSchool(schoolData);

        const teachersData = await getTeachersWithAttendance(schoolData.id, yearMonth);
        setTeachers(teachersData);
      } catch (err) {
        console.error('Failed to fetch data:', err);
        setError('データの取得に失敗しました');
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, [schoolCode, yearMonth]);

  const handleTeacherClick = (teacherId: string) => {
    router.push(`/attendance/${schoolCode}/${teacherId}?ym=${yearMonth}`);
  };

  const getStatusColor = (status: string) => {
    return ATTENDANCE_STATUS_COLORS[status as keyof typeof ATTENDANCE_STATUS_COLORS] || 'bg-gray-100 text-gray-800';
  };

  const getStatusLabel = (status: string) => {
    return ATTENDANCE_STATUS_LABELS[status as keyof typeof ATTENDANCE_STATUS_LABELS] || '未入力';
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loading />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-danger text-lg">{error}</p>
          <p className="text-text-body mt-2">URLを確認してください</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="講師勤怠" />

      {/* ヘッダー */}
      <header className="bg-surface-raised border-b">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <h1 className="text-xl font-bold text-center">{school?.name} 講師勤怠</h1>
        </div>
      </header>

      {/* 年月選択 */}
      <div className="bg-surface-raised border-b">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-center gap-4">
          <Button
            variant="ghost"
            onClick={() => setYearMonth(getPrevMonth(yearMonth))}
            className="p-2"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <span className="text-lg font-medium min-w-[120px] text-center">
            {formatYearMonth(yearMonth)}
          </span>
          <Button
            variant="ghost"
            onClick={() => setYearMonth(getNextMonth(yearMonth))}
            className="p-2"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* 講師一覧 */}
      <main className="max-w-4xl mx-auto px-4 py-6">
        {teachers.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-text-body">講師が登録されていません</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {teachers.map((teacher) => (
              <Card
                key={teacher.id}
                className="cursor-pointer hover:shadow-md transition-shadow duration-150"
                onClick={() => handleTeacherClick(teacher.id)}
              >
                <CardContent className="p-4 text-center">
                  <p className="font-medium text-lg mb-2">{teacher.name}</p>
                  <Badge className={getStatusColor(teacher.status)}>
                    {getStatusLabel(teacher.status)}
                  </Badge>
                  <p className="text-sm text-text-body mt-2">
                    {teacher.total_count > 0 ? `${teacher.total_count}コマ` : '未入力'}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
