/**
 * 講習申込の公開設定（公開期間・単価表・学年別終了日）の検証と表示ロジック。
 *
 * 正典仕様: docs/koushu-auto-allocation-spec.md 決定26・29・44（§16-1・§17-2）。
 * 保存先は course_prep_periods の apply_publish_start / apply_publish_end /
 * apply_price_table / schedule_end_by_grade。
 *
 * ★ このファイルは DB クライアントを持たない純ロジックに保つこと。
 *   設定画面（クライアント）とサーバーAPI（/api/courses/prep の upsert_period）の
 *   両方から import して、「画面で通ったものはサーバーでも通る」を1箇所で担保する。
 *   apply_price_table は公開ローダーが lookupUnitPrice で読む jsonb なので、
 *   壊れた形を書き込ませない検証はセキュリティ上の要（保護者に誤った金額を出さない）。
 */

import { GRADE_LABELS } from '@/types/database';
import { MAX_GRADE_FOR_45MIN, type PriceTable } from '@/types/koushu-apply';

/** 単価表の学年ラベル（GRADE_LABELS の値）→ grade 番号の逆引き */
const GRADE_BY_LABEL: Record<string, number> = Object.fromEntries(
  Object.entries(GRADE_LABELS).map(([g, label]) => [label, Number(g)])
);

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** 単価として妥当か（0以上の整数。上限は打鍵ミス検知の目安として100万円） */
function isValidPrice(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1_000_000;
}

/** YYYY-MM-DD 形式か（暦の妥当性まで見る。2026-02-31 のような日付を弾く） */
export function isValidDateString(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T12:00:00');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * 3軸単価表（学年 → 1on1/1on2 → 45/90 → 円）を検証して正規化する。
 * 値が1つも無ければ null（＝未設定）にする。null は「単価表なし」で保存される。
 *
 * 45分は小1〜小4のみ（決定17）。それ以外の学年に45分の単価を置くのは禁止する。
 * 提案書由来の科目は申込時に学年別の45分チェックを通らない経路があるため、
 * 「引ける単価が存在しない」ことをデータ側で保証しておく必要がある。
 */
export function sanitizePriceTable(input: unknown): ValidationResult<PriceTable | null> {
  if (input == null) return { ok: true, value: null };
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: '単価表の形式が不正です' };
  }

  const out: PriceTable = {};
  for (const [gradeLabel, ratios] of Object.entries(input as Record<string, unknown>)) {
    const grade = GRADE_BY_LABEL[gradeLabel];
    if (grade === undefined) {
      return { ok: false, message: `単価表に不明な学年があります: ${gradeLabel}` };
    }
    if (ratios == null) continue;
    if (typeof ratios !== 'object' || Array.isArray(ratios)) {
      return { ok: false, message: `${gradeLabel}の単価の形式が不正です` };
    }

    const ratioOut: PriceTable[string] = {};
    for (const [ratioKey, durations] of Object.entries(ratios as Record<string, unknown>)) {
      if (ratioKey !== '1on1' && ratioKey !== '1on2') {
        return { ok: false, message: `${gradeLabel}に不明な授業形式があります: ${ratioKey}` };
      }
      if (durations == null) continue;
      if (typeof durations !== 'object' || Array.isArray(durations)) {
        return { ok: false, message: `${gradeLabel} ${ratioKey}の単価の形式が不正です` };
      }

      const durationOut: NonNullable<PriceTable[string]['1on1']> = {};
      for (const [durationKey, price] of Object.entries(durations as Record<string, unknown>)) {
        if (durationKey !== '45' && durationKey !== '90') {
          return {
            ok: false,
            message: `${gradeLabel}に不明な授業時間があります: ${durationKey}分`,
          };
        }
        if (price == null || price === '') continue; // 空欄は「未設定」＝その組み合わせは選べない
        if (!isValidPrice(price)) {
          return {
            ok: false,
            message: `${gradeLabel} ${ratioKey} ${durationKey}分の単価が不正です`,
          };
        }
        if (durationKey === '45' && grade > MAX_GRADE_FOR_45MIN) {
          return {
            ok: false,
            message: `45分は小1〜小4のみです（${gradeLabel}には設定できません）`,
          };
        }
        durationOut[durationKey] = price;
      }
      if (Object.keys(durationOut).length > 0) ratioOut[ratioKey] = durationOut;
    }
    if (Object.keys(ratioOut).length > 0) out[gradeLabel] = ratioOut;
  }

  return { ok: true, value: Object.keys(out).length > 0 ? out : null };
}

/**
 * 学年別の講習終了日（決定44）を検証して正規化する。
 * キーは grade 番号の文字列（'1'〜'13'）。書いていない学年は schedule_end_date にフォールバックする。
 * 開始日より前の終了日は「期間が空」になってしまうので弾く。
 */
export function sanitizeEndByGrade(
  input: unknown,
  scheduleStartDate?: string | null
): ValidationResult<Record<string, string> | null> {
  if (input == null) return { ok: true, value: null };
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: '学年別終了日の形式が不正です' };
  }

  const out: Record<string, string> = {};
  for (const [gradeKey, date] of Object.entries(input as Record<string, unknown>)) {
    if (date == null || date === '') continue; // 空欄＝共通の終了日を使う
    const grade = Number(gradeKey);
    if (!Number.isInteger(grade) || GRADE_LABELS[grade] === undefined) {
      return { ok: false, message: `学年別終了日に不明な学年があります: ${gradeKey}` };
    }
    if (!isValidDateString(date)) {
      return { ok: false, message: `${GRADE_LABELS[grade]}の終了日が不正です` };
    }
    if (scheduleStartDate && date < scheduleStartDate) {
      return {
        ok: false,
        message: `${GRADE_LABELS[grade]}の終了日が講習の開始日より前です`,
      };
    }
    out[String(grade)] = date;
  }

  return { ok: true, value: Object.keys(out).length > 0 ? out : null };
}

/**
 * 公開期間の検証（決定29・§12の非公開担保）。
 *
 * ★ 開始だけ・終了だけの保存を許さない。
 *   公開判定 isApplyPublished は「どちらか欠けていたら非公開」と解釈するので、
 *   開始だけ入れた状態は「公開したつもりで公開されていない」事故になる。
 *   逆に終了だけ入れた状態も意味を持たない。必ず両方セットで扱う。
 */
export function validatePublishWindow(
  start: string | null,
  end: string | null
): ValidationResult<{ start: string | null; end: string | null }> {
  const s = start && start.trim() !== '' ? start : null;
  const e = end && end.trim() !== '' ? end : null;

  if (s === null && e === null) return { ok: true, value: { start: null, end: null } };
  if (s === null || e === null) {
    return { ok: false, message: '公開の開始日時と終了日時は両方を入力してください' };
  }

  const sd = new Date(s);
  const ed = new Date(e);
  if (Number.isNaN(sd.getTime()) || Number.isNaN(ed.getTime())) {
    return { ok: false, message: '公開期間の日時が不正です' };
  }
  if (ed <= sd) {
    return { ok: false, message: '公開の終了日時は開始日時より後にしてください' };
  }
  return { ok: true, value: { start: sd.toISOString(), end: ed.toISOString() } };
}

export type PublishStatus = 'unpublished' | 'scheduled' | 'open' | 'closed';

export const PUBLISH_STATUS_LABELS: Record<PublishStatus, string> = {
  unpublished: '未公開',
  scheduled: '公開予定',
  open: '公開中',
  closed: '公開終了',
};

/**
 * 公開状態を4値で返す（バッジ表示用）。
 * 判定の正典は isApplyPublished（koushuApplyPure.ts）で、ここはその内訳を人に見せるための派生。
 * open を返す条件は isApplyPublished が true を返す条件と一致させること。
 */
export function publishStatusOf(
  start: string | null | undefined,
  end: string | null | undefined,
  now: Date = new Date()
): PublishStatus {
  if (!start || !end) return 'unpublished';
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 'unpublished';
  if (now < s) return 'scheduled';
  if (now > e) return 'closed';
  return 'open';
}

/** timestamptz → <input type="datetime-local"> の値（ローカル時刻のYYYY-MM-DDTHH:MM） */
export function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
