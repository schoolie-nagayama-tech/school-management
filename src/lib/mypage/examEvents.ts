import 'server-only';
import { getPortalServiceClient } from './serviceClient';
import { getMoshiExamDates } from '@/lib/utils/moshiExamDates';
import type { MoshiSettings, MoshiResponseData } from '@/types/forms/moshi';
import type { MogiSettings, MogiResponseData } from '@/types/forms/mogi';
import type { PortalExamEventDto } from '@/types/mypage-schedule';

/**
 * 保護者ポータルの予定リストに混ぜる「申込済み模試」の実施予定を導出する。
 *
 * ★ なぜ schedule_entries と別ソースか:
 *   模試（Vもぎ・全県模試・オープン模試）の実施日は schedule_entries に生成されない
 *   （教室の授業コマではなく、外部会場・自宅受験を含む申込制の行事のため）。
 *   実施予定は form_responses（申込内容）× form_periods（日程マスタ）から組み立てる。
 *
 * ★ service role クライアントで読む理由（formGuidance.ts と同じ判断）:
 *   form_responses / form_periods は portal ロールに grant されていない。
 *   認可（この studentId が呼び出し元アカウントの紐づけ生徒か）は呼び出し側
 *   （requirePortalStudent）が既に済ませている前提で、ここでは行わない。
 *   その代わり linked_student_id と school_id の両方で絞り、データ最小化する
 *   （service role は RLS を素通りするため、取得範囲はアプリ側の責務）。
 */

const YMD = /^\d{4}-\d{2}-\d{2}$/;

interface PeriodRow {
  form_type: string;
  period_key: string;
  title: string;
  settings: Record<string, unknown> | null;
}

interface ResponseRow {
  id: string;
  form_type: string;
  form_period: string;
  response_data: unknown;
}

/** form_type × period_key のキー（形式は formGuidance.ts の appliedKey と揃える）。 */
function periodMapKey(formType: string, periodKey: string): string {
  return `${formType}::${periodKey}`;
}

/**
 * Vもぎ・全県模試の日程ID → 実日付。
 * ★ 罠: MogiDate.id は "YYYY-MM-DD" 単独か、同日に複数種別が並ぶときは
 *   "YYYY-MM-DD__種別" の複合キーになる（MogiPeriodEditor.tsx で採番）。
 *   DateVenueSelection.date_id はこの id をそのまま複製したものなので、
 *   実日付を取るには "__" 以降を切り捨てる必要がある。
 */
function mogiDateIdToDate(dateId: string): string {
  return dateId.includes('__') ? dateId.split('__')[0] : dateId;
}

/** 1件の moshi 回答から実施予定イベントを組み立てる。解決できなければ null。 */
function buildMoshiEvent(row: ResponseRow, period: PeriodRow | undefined): PortalExamEventDto | null {
  const data = row.response_data as Partial<MoshiResponseData> | null | undefined;
  if (!data || typeof data !== 'object') return null;

  let entryDate: string | undefined;
  let timeLabel: string | null;

  if (data.exam_type === 'furikae') {
    entryDate = data.furikae_date;
    timeLabel = data.furikae_time ?? null;
  } else {
    entryDate = data.selected_exam_date;
    timeLabel = data.selected_exam_time ?? null;
  }

  // 旧回答（複数日程対応より前）は selected_exam_date が無いので、期間の先頭日程に
  // フォールバックする（getMoshiExamDates が exam_date 単一値からの復元も面倒を見る）。
  if (!entryDate) {
    const settings = period?.settings as MoshiSettings | undefined;
    const first = getMoshiExamDates(settings)[0];
    if (!first) return null; // フォールバック先も無ければ表示のしようがない
    entryDate = first.date;
    timeLabel = first.time ?? null;
  }

  if (!YMD.test(entryDate)) return null;

  return {
    id: `moshi:${row.id}:${entryDate}`,
    entryDate,
    title: period?.title || '模試',
    timeLabel,
    venueLabel: null, // オープン模試は教室実施のため会場表示は不要
    formType: 'moshi',
  };
}

/** 1件の mogi 回答から実施予定イベントを組み立てる（複数日程選択時は複数件）。 */
function buildMogiEvents(row: ResponseRow, period: PeriodRow | undefined): PortalExamEventDto[] {
  const data = row.response_data as Partial<MogiResponseData> | null | undefined;
  if (!data || !Array.isArray(data.selections) || data.selections.length === 0) return [];

  // venue_label は申込時点で非正規化保存されるので通常は selection 側にあるが、
  // 壊れた/旧データ用に settings.dates からも引けるよう補助マップを用意しておく。
  const settings = period?.settings as MogiSettings | undefined;
  const venueLabelByKey = new Map<string, string>();
  for (const d of settings?.dates ?? []) {
    for (const v of d.venues ?? []) {
      venueLabelByKey.set(`${d.id}::${v.id}`, v.label);
    }
  }

  const events: PortalExamEventDto[] = [];
  for (const sel of data.selections) {
    if (!sel || typeof sel.date_id !== 'string') continue;
    const entryDate = mogiDateIdToDate(sel.date_id);
    if (!YMD.test(entryDate)) continue;

    const venueLabel =
      sel.venue_label || venueLabelByKey.get(`${sel.date_id}::${sel.venue_id}`) || null;

    events.push({
      id: `mogi:${row.id}:${sel.date_id}`,
      entryDate,
      title: period?.title || 'Vもぎ・全県模試',
      timeLabel: null, // Vもぎ・全県模試の日程マスタは時刻を持たない
      venueLabel,
      formType: 'mogi',
    });
  }
  return events;
}

/**
 * 申込済み模試の実施予定を取得する（保護者ポータルの予定リスト用）。
 *
 * @param params.schoolId 生徒の所属校（呼び出し側で解決して渡す。データ最小化のため）。
 * @returns from〜to（両端含む）に entryDate が収まるイベント。日付昇順、重複排除済み。
 */
export async function getPortalExamEvents(params: {
  studentId: string;
  schoolId: string;
  from: string;
  to: string;
}): Promise<PortalExamEventDto[]> {
  const { studentId, schoolId, from, to } = params;
  const svc = getPortalServiceClient();

  const { data: responsesRaw, error: respErr } = await svc
    .from('form_responses')
    .select('id, form_type, form_period, response_data')
    .eq('linked_student_id', studentId)
    .eq('school_id', schoolId)
    .in('form_type', ['moshi', 'mogi'])
    .eq('is_archived', false);

  if (respErr) {
    console.error('[mypage/examEvents] 模試回答の取得に失敗:', respErr.message);
    return [];
  }
  const responses = (responsesRaw ?? []) as unknown as ResponseRow[];
  if (responses.length === 0) return [];

  // form_periods は is_active / 公開期間で絞らない（受付終了後も実施日は表示すべき）。
  const { data: periodsRaw, error: periodErr } = await svc
    .from('form_periods')
    .select('form_type, period_key, title, settings')
    .eq('school_id', schoolId)
    .in('form_type', ['moshi', 'mogi']);

  if (periodErr) {
    // 期間が引けなくても回答自体は残す（title・時刻フォールバックが多少粗くなるだけ）。
    console.error('[mypage/examEvents] 模試期間の取得に失敗:', periodErr.message);
  }
  const periodMap = new Map<string, PeriodRow>();
  for (const p of (periodsRaw ?? []) as unknown as PeriodRow[]) {
    periodMap.set(periodMapKey(p.form_type, p.period_key), p);
  }

  const events: PortalExamEventDto[] = [];
  for (const row of responses) {
    // 1件の壊れたデータ（想定外の response_data 形状など）で予定表全体を
    // 巻き添えにしないよう、行単位で隔離してスキップする。
    try {
      const period = periodMap.get(periodMapKey(row.form_type, row.form_period));
      if (row.form_type === 'moshi') {
        const event = buildMoshiEvent(row, period);
        if (event) events.push(event);
      } else if (row.form_type === 'mogi') {
        events.push(...buildMogiEvents(row, period));
      }
    } catch (e) {
      console.error(
        '[mypage/examEvents] 模試回答の解決に失敗（この件はスキップ）:',
        e instanceof Error ? e.message : e
      );
    }
  }

  const seen = new Set<string>();
  const inRange = events.filter((e) => {
    if (e.entryDate < from || e.entryDate > to) return false;
    if (seen.has(e.id)) return false; // 合成IDで重複排除
    seen.add(e.id);
    return true;
  });

  inRange.sort((a, b) => (a.entryDate < b.entryDate ? -1 : a.entryDate > b.entryDate ? 1 : 0));
  return inRange;
}
