'use client';

import { useState, useEffect } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent, CardHeader, CardTitle, Button, SelectShadcn as Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge } from '@/components/ui';
import { ToastContainer } from '@/components/ui';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { getSchools } from '@/lib/api/schools';
import {
  getAttendanceSummary,
  getAllAttendanceTypes,
} from '@/lib/api/attendance';
import {
  getCurrentYearMonth,
  getPrevMonth,
  getNextMonth,
  formatYearMonth,
} from '@/lib/utils/date';
import {
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_COLORS,
  type AttendanceType,
} from '@/types/attendance';
import type { School } from '@/types/database';

interface SummaryRow {
  id: string;
  school: { id: string; name: string };
  teacher: { id: string; name: string };
  status: string;
  type_totals: Record<string, {
    name: string;
    unit: string;
    unit_price: number;
    total: number;
    amount: number;
  }>;
  grand_total: number;
  total_amount: number;
}

export default function AttendanceSummaryPage() {
  const { toasts, removeToast, success, error: toastError } = useToast();
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('all');
  const [yearMonth, setYearMonth] = useState(getCurrentYearMonth());
  const [attendanceTypes, setAttendanceTypes] = useState<AttendanceType[]>([]);
  const [summaryData, setSummaryData] = useState<SummaryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // 教室一覧を取得
  useEffect(() => {
    async function fetchSchools() {
      try {
        const data = await getSchools();
        setSchools(data);
      } catch (error) {
        console.error('Failed to fetch schools:', error);
        toastError('教室の取得に失敗しました');
      }
    }
    fetchSchools();
  }, [toastError]);

  // 集計データを取得
  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      try {
        const schoolId = selectedSchoolId === 'all' ? null : selectedSchoolId;
        
        const [typesData, summaryResult] = await Promise.all([
          getAllAttendanceTypes(schoolId ? [schoolId] : undefined),
          getAttendanceSummary(schoolId, yearMonth),
        ]);
        
        setAttendanceTypes(typesData);
        setSummaryData(summaryResult);
      } catch (error) {
        console.error('Failed to fetch data:', error);
        toastError('データの取得に失敗しました');
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, [selectedSchoolId, yearMonth, toastError]);

  // CSVエクスポート
  const handleExportCSV = () => {
    if (summaryData.length === 0) {
      toastError('エクスポートするデータがありません');
      return;
    }

    // ヘッダー行
    const typeNames = Array.from(new Set(
      summaryData.flatMap((row) =>
        Object.values(row.type_totals).map((t) => t.name)
      )
    ));
    
    const headers = ['教室', '講師名', 'ステータス', ...typeNames, '合計', '金額合計'];
    
    // データ行
    const rows = summaryData.map((row) => {
      const typeCols = typeNames.map((name) => {
        const typeData = Object.values(row.type_totals).find((t) => t.name === name);
        return typeData?.total || 0;
      });
      
      return [
        row.school?.name || '',
        row.teacher?.name || '',
        ATTENDANCE_STATUS_LABELS[row.status as keyof typeof ATTENDANCE_STATUS_LABELS] || '',
        ...typeCols,
        row.grand_total,
        row.total_amount,
      ];
    });

    // 合計行
    const totalRow = ['合計', '', ''];
    typeNames.forEach((name) => {
      const total = summaryData.reduce((sum, row) => {
        const typeData = Object.values(row.type_totals).find((t) => t.name === name);
        return sum + (typeData?.total || 0);
      }, 0);
      totalRow.push(total.toString());
    });
    totalRow.push(summaryData.reduce((sum, row) => sum + row.grand_total, 0).toString());
    totalRow.push(summaryData.reduce((sum, row) => sum + row.total_amount, 0).toString());

    // CSV生成
    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.join(',')),
      totalRow.join(','),
    ].join('\n');

    // BOM付きUTF-8でダウンロード
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `出勤簿集計_${yearMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    success('CSVをダウンロードしました');
  };

  // 表示用の種別リスト（重複排除）
  const displayTypes = attendanceTypes.filter((type, index, self) =>
    index === self.findIndex((t) => t.name === type.name)
  );

  return (
    <AdminLayout headerTitle="講師勤怠">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">月次集計</h1>
          <Button onClick={handleExportCSV}>
            <Download className="mr-2 h-4 w-4" />
            CSVエクスポート
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <CardTitle>集計データ</CardTitle>
              <div className="flex items-center gap-4">
                <div className="relative w-48">
                  <Select value={selectedSchoolId} onValueChange={setSelectedSchoolId}>
                    <SelectTrigger>
                      <SelectValue placeholder="教室を選択">
                        {selectedSchoolId === 'all' ? '全教室' : schools.find(s => s.id === selectedSchoolId)?.name}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全教室</SelectItem>
                      {schools.map((school) => (
                        <SelectItem key={school.id} value={school.id}>
                          {school.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => setYearMonth(getPrevMonth(yearMonth))}
                    className="p-2"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </Button>
                  <span className="font-medium min-w-[100px] text-center">
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
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8">
                <div className="text-[#4b5563]">読み込み中...</div>
              </div>
            ) : summaryData.length === 0 ? (
              <div className="text-center py-8 text-[#4b5563]">
                データがありません
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>教室</TableHead>
                      <TableHead>講師名</TableHead>
                      <TableHead className="text-center">ステータス</TableHead>
                      {displayTypes.map((type) => (
                        <TableHead key={type.id} className="text-center">
                          {type.name}
                        </TableHead>
                      ))}
                      <TableHead className="text-center">合計</TableHead>
                      <TableHead className="text-right">金額</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summaryData.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>{row.school?.name}</TableCell>
                        <TableCell className="font-medium">
                          {row.teacher?.name}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge className={ATTENDANCE_STATUS_COLORS[row.status as keyof typeof ATTENDANCE_STATUS_COLORS]}>
                            {ATTENDANCE_STATUS_LABELS[row.status as keyof typeof ATTENDANCE_STATUS_LABELS]}
                          </Badge>
                        </TableCell>
                        {displayTypes.map((type) => {
                          const typeData = Object.values(row.type_totals).find(
                            (t) => t.name === type.name
                          );
                          return (
                            <TableCell key={type.id} className="text-center">
                              {typeData?.total || 0}
                              {type.unit === 'hours' ? 'h' : ''}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-center font-medium">
                          {row.grand_total}
                        </TableCell>
                        <TableCell className="text-right">
                          ¥{row.total_amount.toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                    {/* 合計行 */}
                    <TableRow className="bg-gray-100 font-medium">
                      <TableCell colSpan={3}>合計</TableCell>
                      {displayTypes.map((type) => (
                        <TableCell key={type.id} className="text-center">
                          {summaryData.reduce((sum, row) => {
                            const typeData = Object.values(row.type_totals).find(
                              (t) => t.name === type.name
                            );
                            return sum + (typeData?.total || 0);
                          }, 0)}
                          {type.unit === 'hours' ? 'h' : ''}
                        </TableCell>
                      ))}
                      <TableCell className="text-center">
                        {summaryData.reduce((sum, row) => sum + row.grand_total, 0)}
                      </TableCell>
                      <TableCell className="text-right">
                        ¥{summaryData.reduce((sum, row) => sum + row.total_amount, 0).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}
