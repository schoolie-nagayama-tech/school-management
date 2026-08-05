/**
 * 講習申込フォーム（保護者向け）の入出力契約。
 *
 * 正典仕様: docs/koushu-auto-allocation-spec.md 第2部（決定13〜54）。
 * 画面の見た目はモック `/schedule/koushu/apply-mock` が設計図。
 *
 * この型は「公開ローダー（GET）」と「送信API（POST）」の両方で共有する。
 * サーバー・クライアントの双方から import されるので、DBクライアントや
 * Node固有APIをこのファイルに持ち込まないこと。
 */

/** 授業形式。1=1対1 / 2=1対2 */
export type ApplyRatio = 1 | 2;
/** 1コマの時間（分）。45は小1〜小4のみ（決定17） */
export type ApplyDuration = 45 | 90;

/** 45分を選べる学年の上限（小4まで）。決定17の業務ルールをコードで1箇所に固定する */
export const MAX_GRADE_FOR_45MIN = 4;

/** 3軸単価表（決定26・§15-2）。course_prep_periods.apply_price_table の形 */
export type PriceTable = Record<
  string, // 学年ラベル（GRADE_LABELS。例 '中2'）
  Partial<Record<'1on1' | '1on2', Partial<Record<'45' | '90', number>>>>
>;

/**
 * 単価を引く。組み合わせが単価表に無ければ null（＝その形式は選べない）。
 * 保護者UIの選択肢生成とサーバー検証の両方でこれを使い、判定を1箇所にする。
 */
export function lookupUnitPrice(
  table: PriceTable | null | undefined,
  gradeLabel: string,
  ratio: ApplyRatio,
  duration: ApplyDuration
): number | null {
  if (!table) return null;
  const v = table[gradeLabel]?.[ratio === 1 ? '1on1' : '1on2']?.[String(duration) as '45' | '90'];
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/**
 * 講習費の対象コマ数（決定27）。
 * 通常授業は月謝で別途もらっているので申込コマから差し引く。0未満には丸めない。
 * 差し引く数は請求ベース（契約の週回数 × 期間の暦上の週数。決定28）で、
 * 実施の有無（振替・休講・欠席）では動かさない。
 */
export function chargeableKoma(appliedKoma: number, regularKoma: number): number {
  return Math.max(0, appliedKoma - regularKoma);
}

// ============================================================
// GET: フォーム初期表示に必要なデータ
// ============================================================

/** 申込1行ぶんの提案（提案書由来）。保護者は形式を変更できない（決定14） */
export interface ApplyProposalLine {
  subjectId: string;
  subjectName: string;
  /** 教材名。複数教材が同一科目にあるときは列挙して1行に合算する（決定34） */
  textbookNames: string[];
  /** テーマ。単元リストは出さない（決定47） */
  theme: string | null;
  proposedKoma: number;
  ratio: ApplyRatio;
  duration: ApplyDuration;
  /** 期間中の通常授業コマ数（請求ベース。決定28） */
  regularKoma: number;
  /** 申込時点の単価。単価表に無ければ null（画面に警告を出す） */
  unitPrice: number | null;
}

/** 保護者が追加できる科目の候補（決定25・48） */
export interface ApplyAddableSubject {
  subjectId: string;
  subjectName: string;
  /** 選べる形式と単価。単価が無い組み合わせは載せない */
  options: Array<{ ratio: ApplyRatio; duration: ApplyDuration; unitPrice: number }>;
}

/** コース（小集団・プログラミング）の開催予定1回ぶん */
export interface ApplyCourseSession {
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  /** 申込時点で開催済み＝参加対象外（決定45） */
  held: boolean;
}

/** コース1件（決定36・37・40・42・45） */
export interface ApplyCourse {
  courseId: string;
  name: string;
  /** 形態キー（schedule_formations.key）。小集団 / プログラミング等 */
  formation: string;
  unitPrice: number;
  sessions: ApplyCourseSession[];
  /** 未開催の回数。料金 = unitPrice × これ（決定42・45） */
  remainingCount: number;
}

/** 生徒の通塾可能日程を聞く枠（決定15。全○初期で×を付けさせる） */
export interface ApplyAvailabilitySlot {
  date: string; // YYYY-MM-DD
  timeSlot: string; // "HH:MM-HH:MM"
}

/** フォーム初期表示のペイロード */
export interface KoushuApplyFormData {
  student: { id: string; name: string; grade: number; gradeLabel: string };
  period: {
    schoolId: string;
    season: string;
    year: number;
    label: string;
    /** 生徒の学年に応じた期間（開始は共通・終了は学年別。決定44） */
    startDate: string;
    endDate: string;
  };
  proposals: ApplyProposalLine[];
  addableSubjects: ApplyAddableSubject[];
  courses: ApplyCourse[];
  /** 開講している枠の全量。ここに無い枠は画面に出さない */
  availabilitySlots: ApplyAvailabilitySlot[];
  /** 45分を選べるか（decided by grade。決定17） */
  allow45: boolean;
  /** 既に申込済みなら読み取り専用で見せる（決定30・53） */
  alreadySubmitted: boolean;
}

// ============================================================
// POST: 送信ボディ
// ============================================================

/** 科目1件の申込 */
export interface KoushuApplySubjectInput {
  subjectId: string;
  koma: number;
  ratio: ApplyRatio;
  duration: ApplyDuration;
}

/** コース1件の申込 */
export interface KoushuApplyCourseInput {
  courseId: string;
}

export interface KoushuApplyRequest {
  /** トークン経由（/koushu-apply/[token]）。生徒コード経由なら null */
  token?: string | null;
  /** 生徒コード経由（/portal/[schoolCode]/koushu）。トークン経由なら null */
  schoolCode?: string | null;
  studentCode?: string | null;

  subjects: KoushuApplySubjectInput[];
  courses: KoushuApplyCourseInput[];
  /**
   * 出られない枠（×を付けた枠）だけを送る。
   * サーバー側で開講枠の全量に対して available=false を立て、
   * 残りは available=true で行を作る（決定15・§9-3。行が無い＝未提出と
   * 区別できなくなるため、全枠ぶんの行を必ず書く）。
   */
  unavailableSlots: ApplyAvailabilitySlot[];
  submitterName?: string;
  submitterEmail?: string;
}

export interface KoushuApplyResponse {
  ok: boolean;
  /** エラー時の日本語メッセージ（保護者にそのまま出せる文言にする） */
  message?: string;
}
