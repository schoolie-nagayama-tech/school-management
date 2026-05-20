/**
 * 授業の時間帯（時限）の共通設定
 * 週回数変更・曜日変更などのフォームで利用する「コード,ラベル」形式のリストを教室ごとに保持
 */

export interface ClassPeriodItem {
  code: string;
  label: string;
}

const STORAGE_KEY = (schoolId: string) => `class_periods_${schoolId}`;

const DEFAULT_PERIODS: ClassPeriodItem[] = [
  { code: '4', label: '4限(14:30-16:00)' },
  { code: '5', label: '5限(16:20-17:50)' },
  { code: '6', label: '6限(18:10-19:40)' },
  { code: '7', label: '7限(20:00-21:30)' },
];

/**
 * 教室の授業の時間帯一覧を取得（未設定の場合はデフォルトを返す）
 */
export function getClassPeriods(schoolId: string | undefined): ClassPeriodItem[] {
  if (!schoolId || typeof window === 'undefined') {
    return [...DEFAULT_PERIODS];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY(schoolId));
    if (!raw) return [...DEFAULT_PERIODS];
    const parsed = JSON.parse(raw) as ClassPeriodItem[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [...DEFAULT_PERIODS];
    return parsed.filter((p) => p && typeof p.code === 'string' && typeof p.label === 'string');
  } catch {
    return [...DEFAULT_PERIODS];
  }
}

/**
 * 教室の授業の時間帯一覧を保存
 */
export function setClassPeriods(
  schoolId: string | undefined,
  periods: ClassPeriodItem[]
): void {
  if (!schoolId || typeof window === 'undefined') return;
  const valid = periods.filter((p) => p && p.code.trim() !== '' && p.label.trim() !== '');
  window.localStorage.setItem(STORAGE_KEY(schoolId), JSON.stringify(valid));
}

/**
 * テキスト形式（1行1時限「コード,ラベル」）をパース
 */
export function parsePeriodsText(text: string): ClassPeriodItem[] {
  return text
    .split('\n')
    .map((line) => {
      const [code, ...rest] = line.split(',');
      const label = rest.join(',').trim() || (code?.trim() ?? '');
      return { code: (code?.trim() ?? ''), label };
    })
    .filter((p) => p.code !== '');
}

/**
 * ClassPeriodItem[] をテキスト形式に変換
 */
export function formatPeriodsToText(periods: ClassPeriodItem[]): string {
  return periods.map((p) => `${p.code},${p.label}`).join('\n');
}
