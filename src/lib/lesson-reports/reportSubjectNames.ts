/**
 * 授業報告書ごとの科目名を引く。
 *
 * class_reports は科目を持たず、元の授業（schedule_entries.subject_ids）から逆引きする。
 * 生徒の報告書一覧（/students/[id]/lesson-reports）と生徒ハブの「授業の様子」の両方で使うため、
 * ページから切り出した（同じ逆引きを2か所に書くと片方だけ直して食い違う）。
 */
import { supabase } from '@/lib/supabase';
import type { ClassReport } from '@/types/class-report';

// schedule_entries / subjects の生成型が報告書まわりの取得に追いついていないため、既存ページと同じく any で引く
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** subject_ids から科目名を取得するための補助マップ生成 */
async function fetchSubjectsMap(subjectIds: string[]): Promise<Map<string, string>> {
  if (subjectIds.length === 0) return new Map();
  const { data } = await db.from('subjects').select('id, name').in('id', subjectIds);
  const m = new Map<string, string>();
  for (const s of (data || []) as { id: string; name: string }[]) m.set(s.id, s.name);
  return m;
}

/**
 * 報告書ID → 科目名（複数なら「・」でつなぐ。引けなければ「その他」）。
 * 呼び出し側は報告書を件数で絞ってから渡すこと（.in() に渡すIDが1000を超えないように）。
 */
export async function attachSubjectNames(reports: ClassReport[]): Promise<Map<string, string>> {
  if (reports.length === 0) return new Map();
  const entryIds = reports.map((r) => r.schedule_entry_id);
  const { data } = await db.from('schedule_entries').select('id, subject_ids').in('id', entryIds);
  type EntryRow = { id: string; subject_ids: string[] };
  const entryMap = new Map<string, string[]>();
  for (const e of (data || []) as EntryRow[]) {
    entryMap.set(e.id, e.subject_ids || []);
  }
  // 全 subject_id を集める
  const allSubjectIds = Array.from(new Set(Array.from(entryMap.values()).flat()));
  const subjectsMap = await fetchSubjectsMap(allSubjectIds);
  // 報告書ID → 科目名一覧
  const result = new Map<string, string>();
  for (const r of reports) {
    const subIds = entryMap.get(r.schedule_entry_id) ?? [];
    const names = subIds.map((id) => subjectsMap.get(id)).filter((n): n is string => !!n);
    result.set(r.id, names.join('・') || 'その他');
  }
  return result;
}
