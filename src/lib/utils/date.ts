// 年月から日数を取得
export function getDaysInMonth(yearMonth: string): number {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

// 年月から日付配列を生成
export function getMonthDates(yearMonth: string): { date: string; dayOfWeek: number; dayLabel: string }[] {
  const [year, month] = yearMonth.split('-').map(Number);
  const daysInMonth = getDaysInMonth(yearMonth);
  const dayLabels = ['日', '月', '火', '水', '木', '金', '土'];
  
  const dates = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    const dateStr = `${yearMonth}-${String(day).padStart(2, '0')}`;
    dates.push({
      date: dateStr,
      dayOfWeek: date.getDay(),
      dayLabel: dayLabels[date.getDay()],
    });
  }
  
  return dates;
}

// 前月の年月を取得
export function getPrevMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  if (month === 1) {
    return `${year - 1}-12`;
  }
  return `${year}-${String(month - 1).padStart(2, '0')}`;
}

// 翌月の年月を取得
export function getNextMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  if (month === 12) {
    return `${year + 1}-01`;
  }
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

// 現在の年月を取得
export function getCurrentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// 年月を表示用にフォーマット
export function formatYearMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  return `${year}年${month}月`;
}
