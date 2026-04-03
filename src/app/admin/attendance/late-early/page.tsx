'use client';

import { useState, useEffect } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent, CardHeader, CardTitle, Button, SelectShadcn as Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui';
import { ToastContainer } from '@/components/ui';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { useMasterData } from '@/contexts/MasterDataContext';
import { getLateEarlyList } from '@/lib/api/attendance';
import {
  getCurrentYearMonth,
  getPrevMonth,
  getNextMonth,
  formatYearMonth,
} from '@/lib/utils/date';
import type { School } from '@/types/database';

interface LateEarlyRecord {
  id: string;
  date: string;
  late_early: string | null;
  note: string | null;
  sheet: {
    id: string;
    teacher: { id: string; name: string } | null;
    school: { id: string; name: string } | null;
  };
}

export default function LateEarlyListPage() {
  const { toasts, removeToast, success, error: toastError } = useToast();
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('all');
  const [yearMonth, setYearMonth] = useState(getCurrentYearMonth());
  const [records, setRecords] = useState<LateEarlyRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const { schools: masterSchools } = useMasterData();

  // 教室一覧をコンテキストから取得
  useEffect(() => {
    if (masterSchools.length > 0) setSchools(masterSchools);
  }, [masterSchools]);

  // 遅刻早退データを取得
  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      try {
        const schoolId = selectedSchoolId === 'all' ? null : selectedSchoolId;
        const data = await getLateEarlyList(schoolId, yearMonth);
        setRecords(data);
      } catch (error) {
        console.error('Failed to fetch data:', error);
        toastError('データの取得に失敗しました');
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, [selectedSchoolId, yearMonth, toastError]);

  // 日付フォーマット
  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    const dayLabels = ['日', '月', '火', '水', '木', '金', '土'];
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const dayOfWeek = dayLabels[date.getDay()];
    return `${month}/${day}(${dayOfWeek})`;
  };

  // CSVエクスポート
  const handleExportCSV = () => {
    if (records.length === 0) {
      toastError('エクスポートするデータがありません');
      return;
    }

    const headers = ['日付', '教室', '講師名', '遅刻早退', '備考'];
    const rows = records.map((record) => [
      record.date,
      record.sheet?.school?.name || '',
      record.sheet?.teacher?.name || '',
      record.late_early,
      record.note || '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');

    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `遅刻早退一覧_${yearMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    success('CSVをダウンロードしました');
  };

  return (
    <AdminLayout headerTitle="講師勤怠">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">遅刻・早退一覧</h1>
          <Button onClick={handleExportCSV}>
            <Download className="mr-2 h-4 w-4" />
            CSVエクスポート
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <CardTitle>
                {records.length > 0 && (
                  <span className="text-[#4b5563] font-normal text-sm ml-2">
                    （{records.length}件）
                  </span>
                )}
              </CardTitle>
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
            ) : records.length === 0 ? (
              <div className="text-center py-8 text-[#4b5563]">
                遅刻・早退のデータがありません
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>日付</TableHead>
                    <TableHead>教室</TableHead>
                    <TableHead>講師名</TableHead>
                    <TableHead>遅刻早退</TableHead>
                    <TableHead>備考</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell>{formatDate(record.date)}</TableCell>
                      <TableCell>{record.sheet?.school?.name}</TableCell>
                      <TableCell className="font-medium">
                        {record.sheet?.teacher?.name}
                      </TableCell>
                      <TableCell className="text-red-600 font-medium">
                        {record.late_early}
                      </TableCell>
                      <TableCell className="text-[#4b5563]">
                        {record.note || '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}
