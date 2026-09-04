import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireManager, requireAdmin } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
// Next.js の Data Cache に載せない（削除直後に古い使用状況を返さないため）。
export const fetchCache = 'force-no-store';

/**
 * 教材マスタの単元（curriculum_items）の使用状況確認・削除・付け替えを行うサーバーAPI。
 *
 * ★ なぜブラウザから直に supabase を叩かずサーバー経由にするか（ここを間違えると壊れる）:
 *   curriculum_items 自体は全教室共通のマスタで RLS が「認証済みなら全許可」だが、
 *   参照元（student_progress / seasonal_proposal_units など）は check_school_access で
 *   教室スコープされている。ブラウザのクライアントで数えると自分の教室分しか見えないため、
 *   「使用 0 件」と表示したのに他教室の参照で削除が失敗する、という嘘の表示になる。
 *   参照ごと削除・付け替えも同じ理由で他教室分に手が届かない。よって Service Role で行う。
 */

// PostgREST は range 未指定だと 1000 行で黙って打ち切るため、必ずこの単位でページングする
const PAGE_SIZE = 1000;
// IN 句が長くなりすぎて URL 長制限に当たるのを防ぐ
const ID_CHUNK = 200;

function getSupabaseAdmin(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase env not set');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, cache: 'no-store' })) as typeof fetch,
    },
  });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * 単元を参照しているテーブルの定義。
 *
 * blocks: DB の外部キーが削除を拒否するか。
 *   - student_progress は ON DELETE RESTRICT、test_prep_proposal_units は NO ACTION なので拒否する
 *   - seasonal_* は ON DELETE CASCADE なので削除は通るが、行が道連れで消える（＝警告対象）
 * ownerColumn: 「誰の行か」を表す列。付け替え時の一意制約の衝突判定に使う。
 *   null は一意制約が無いテーブル（衝突が起きないので素直に UPDATE できる）。
 */
const REFERENCING_TABLES = [
  {
    key: 'progress',
    table: 'student_progress',
    label: '進行表',
    blocks: true,
    ownerColumn: 'student_textbook_id',
  },
  {
    key: 'testPrep',
    table: 'test_prep_proposal_units',
    label: 'テスト対策提案書',
    blocks: true,
    ownerColumn: null,
  },
  {
    key: 'seasonalProposal',
    table: 'seasonal_proposal_units',
    label: '講習提案書',
    blocks: false,
    ownerColumn: 'proposal_id',
  },
  {
    key: 'seasonalCourse',
    table: 'seasonal_course_curriculum',
    label: '講習カリキュラム',
    blocks: false,
    ownerColumn: 'course_id',
  },
] as const;

type UsageKey = (typeof REFERENCING_TABLES)[number]['key'] | 'lessonReport';
type Usage = Record<UsageKey, number>;

function emptyUsage(): Usage {
  return { progress: 0, testPrep: 0, seasonalProposal: 0, seasonalCourse: 0, lessonReport: 0 };
}

/**
 * 授業報告の指導単元（lesson_report_units.curriculum_item_ids）。
 *
 * ★ ここだけ他と造りが違う（見落とすと静かにデータが壊れる）:
 *   単元IDを **配列** で持っていて外部キーが無い。つまり単元を削除しても DB は止めず、
 *   配列の中に存在しない ID が residue として残り、授業報告の単元表示が壊れる。
 *   よって使用状況には必ず含め、参照ごと削除・付け替えでは配列も書き換える。
 */
const LESSON_REPORT_UNITS = 'lesson_report_units';

/** 単元IDごとに、授業報告で使われている行数を数える */
async function countLessonReportUnits(
  admin: SupabaseClient,
  ids: number[]
): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  for (const part of chunk(ids, ID_CHUNK)) {
    let from = 0;
    for (;;) {
      const { data, error } = await admin
        .from(LESSON_REPORT_UNITS)
        .select('id, curriculum_item_ids')
        .overlaps('curriculum_item_ids', part)
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`授業報告の参照確認に失敗しました: ${error.message}`);
      const rows = (data || []) as { id: string; curriculum_item_ids: number[] | null }[];
      for (const row of rows) {
        for (const itemId of row.curriculum_item_ids || []) {
          if (part.includes(itemId)) counts.set(itemId, (counts.get(itemId) || 0) + 1);
        }
      }
      if (rows.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }
  return counts;
}

/**
 * 授業報告の単元配列から対象IDを取り除く（toId 指定時は置き換え＝付け替え）。
 * 配列なので read-modify-write するしかない。重複は潰す。
 */
async function rewriteLessonReportUnits(
  admin: SupabaseClient,
  ids: number[],
  toId: number | null
): Promise<number> {
  let touched = 0;
  for (const part of chunk(ids, ID_CHUNK)) {
    const { data, error } = await admin
      .from(LESSON_REPORT_UNITS)
      .select('id, curriculum_item_ids')
      .overlaps('curriculum_item_ids', part);
    if (error) throw new Error(`授業報告の参照取得に失敗しました: ${error.message}`);
    const rows = (data || []) as { id: string; curriculum_item_ids: number[] | null }[];
    for (const row of rows) {
      const current = row.curriculum_item_ids || [];
      const next: number[] = [];
      for (const itemId of current) {
        const replaced = part.includes(itemId) ? toId : itemId;
        if (replaced === null) continue;
        if (!next.includes(replaced)) next.push(replaced);
      }
      const { error: upError } = await admin
        .from(LESSON_REPORT_UNITS)
        .update({ curriculum_item_ids: next })
        .eq('id', row.id);
      if (upError) throw new Error(`授業報告の更新に失敗しました: ${upError.message}`);
      touched += 1;
    }
  }
  return touched;
}

/** 削除を拒否される参照があるか */
function isBlocked(usage: Usage): boolean {
  return REFERENCING_TABLES.filter((t) => t.blocks).some((t) => usage[t.key] > 0);
}

/**
 * 指定した単元IDを参照している行を全件取得する（1000行の打ち切りを避けるためページング）。
 * 並びが安定するよう主キー id で order してから range する。
 */
async function selectReferencingRows(
  admin: SupabaseClient,
  table: string,
  columns: string,
  curriculumItemIds: number[]
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (const ids of chunk(curriculumItemIds, ID_CHUNK)) {
    let from = 0;
    for (;;) {
      const { data, error } = await admin
        .from(table)
        .select(columns)
        .in('curriculum_item_id', ids)
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`${table} の参照確認に失敗しました: ${error.message}`);
      const page = (data || []) as unknown as Record<string, unknown>[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }
  return rows;
}

/** 単元IDごとの使用状況（全教室横断の正確な件数）を集計する */
async function collectUsage(admin: SupabaseClient, ids: number[]): Promise<Record<number, Usage>> {
  const result: Record<number, Usage> = {};
  for (const id of ids) result[id] = emptyUsage();

  for (const def of REFERENCING_TABLES) {
    const rows = await selectReferencingRows(admin, def.table, 'id, curriculum_item_id', ids);
    for (const row of rows) {
      const itemId = row.curriculum_item_id as number;
      if (result[itemId]) result[itemId][def.key] += 1;
    }
  }

  // 外部キーの無い配列参照（授業報告）も必ず数える
  const lessonReportCounts = await countLessonReportUnits(admin, ids);
  lessonReportCounts.forEach((count, itemId) => {
    if (result[itemId]) result[itemId].lessonReport = count;
  });

  return result;
}

/** 単元本体を削除する（参照が残っていれば DB 側で弾かれる） */
async function deleteItems(admin: SupabaseClient, ids: number[]): Promise<void> {
  for (const part of chunk(ids, ID_CHUNK)) {
    const { error } = await admin.from('curriculum_items').delete().in('id', part);
    if (error) throw new Error(`単元の削除に失敗しました: ${error.message}`);
  }
}

/** 参照行を単元ID指定で削除する（参照ごと削除で使う） */
async function deleteReferencingRows(
  admin: SupabaseClient,
  table: string,
  curriculumItemIds: number[]
): Promise<void> {
  for (const part of chunk(curriculumItemIds, ID_CHUNK)) {
    const { error } = await admin.from(table).delete().in('curriculum_item_id', part);
    if (error) throw new Error(`${table} の参照行の削除に失敗しました: ${error.message}`);
  }
}

/**
 * 参照を fromIds から toId へ付け替える。
 *
 * ★ 一意制約の衝突（誤・正の両方を持つ生徒/提案書）の扱い:
 *   student_progress は UNIQUE(student_textbook_id, curriculum_item_id)、
 *   seasonal_proposal_units は UNIQUE(proposal_id, curriculum_item_id)、
 *   seasonal_course_curriculum は UNIQUE(course_id, curriculum_item_id) を持つ。
 *   単純な UPDATE は衝突して失敗するので、既に付け替え先を持っている行は
 *   「正しい単元側（toId）を残して、誤った単元側の行を捨てる」方針で解消する（運用合意）。
 */
async function mergeReferences(
  admin: SupabaseClient,
  fromIds: number[],
  toId: number
): Promise<{ moved: number; dropped: number }> {
  let moved = 0;
  let dropped = 0;

  for (const def of REFERENCING_TABLES) {
    const columns = def.ownerColumn
      ? `id, curriculum_item_id, ${def.ownerColumn}`
      : 'id, curriculum_item_id';
    const fromRows = await selectReferencingRows(admin, def.table, columns, fromIds);
    if (fromRows.length === 0) continue;

    const idsToMove: (string | number)[] = [];
    const idsToDrop: (string | number)[] = [];

    if (def.ownerColumn) {
      // 付け替え先を既に持っている「持ち主」を先に洗い出す
      const toRows = await selectReferencingRows(admin, def.table, columns, [toId]);
      const taken = new Set(toRows.map((r) => String(r[def.ownerColumn as string])));
      for (const row of fromRows) {
        const owner = String(row[def.ownerColumn as string]);
        if (taken.has(owner)) {
          idsToDrop.push(row.id as string | number);
        } else {
          // 同じ持ち主の誤単元が複数あるときも2件目以降は衝突するので、ここで押さえる
          taken.add(owner);
          idsToMove.push(row.id as string | number);
        }
      }
    } else {
      // 一意制約が無いテーブルは全件そのまま付け替えでよい
      for (const row of fromRows) idsToMove.push(row.id as string | number);
    }

    for (const part of chunk(idsToMove, ID_CHUNK)) {
      const { error } = await admin
        .from(def.table)
        .update({ curriculum_item_id: toId })
        .in('id', part);
      if (error) throw new Error(`${def.label}の付け替えに失敗しました: ${error.message}`);
    }
    for (const part of chunk(idsToDrop, ID_CHUNK)) {
      const { error } = await admin.from(def.table).delete().in('id', part);
      if (error) throw new Error(`${def.label}の重複行の整理に失敗しました: ${error.message}`);
    }

    moved += idsToMove.length;
    dropped += idsToDrop.length;
  }

  return { moved, dropped };
}

/** body.ids を検証して正の整数の配列に正規化する */
function parseIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ids = value.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return null;
  return Array.from(new Set(ids));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = String(body?.action || '');

    // 参照ごと削除・付け替えは全教室のデータに手を入れるので admin/owner に限定する
    const needsAdmin = action === 'force_delete' || action === 'merge';
    const authError = needsAdmin ? await requireAdmin(request) : await requireManager(request);
    if (authError) return authError;

    const admin = getSupabaseAdmin();

    if (action === 'usage') {
      const ids = parseIds(body?.ids);
      if (!ids) return NextResponse.json({ error: 'ids が必要です' }, { status: 400 });
      const usage = await collectUsage(admin, ids);
      return NextResponse.json({ usage });
    }

    if (action === 'delete') {
      const ids = parseIds(body?.ids);
      if (!ids) return NextResponse.json({ error: 'ids が必要です' }, { status: 400 });
      const usage = await collectUsage(admin, ids);
      // 使用中の単元は最初から除外して削除する（途中で例外を投げて中断しない）
      const deletable = ids.filter((id) => !isBlocked(usage[id]));
      const blocked = ids.filter((id) => isBlocked(usage[id]));
      if (deletable.length > 0) await deleteItems(admin, deletable);
      return NextResponse.json({
        deleted: deletable,
        blocked: blocked.map((id) => ({ id, usage: usage[id] })),
      });
    }

    if (action === 'force_delete') {
      const ids = parseIds(body?.ids);
      if (!ids) return NextResponse.json({ error: 'ids が必要です' }, { status: 400 });
      const usage = await collectUsage(admin, ids);
      // 削除を拒否する参照（進行表・テスト対策提案書）を先に外してから単元を消す。
      // CASCADE の講習提案書・講習カリキュラムは単元削除で自動的に消える。
      for (const def of REFERENCING_TABLES) {
        if (def.blocks) await deleteReferencingRows(admin, def.table, ids);
      }
      // 外部キーが無く残骸になる授業報告の配列は、こちらで取り除く
      await rewriteLessonReportUnits(admin, ids, null);
      await deleteItems(admin, ids);
      const removed = ids.reduce((acc, id) => {
        for (const def of REFERENCING_TABLES) acc[def.key] += usage[id][def.key];
        return acc;
      }, emptyUsage() as Usage);
      return NextResponse.json({ deleted: ids, removed });
    }

    if (action === 'merge') {
      const fromIds = parseIds(body?.fromIds);
      const toId = Number(body?.toId);
      if (!fromIds) return NextResponse.json({ error: 'fromIds が必要です' }, { status: 400 });
      if (!Number.isInteger(toId) || toId <= 0) {
        return NextResponse.json({ error: 'toId が必要です' }, { status: 400 });
      }
      if (fromIds.includes(toId)) {
        return NextResponse.json({ error: '同じ単元にはまとめられません' }, { status: 400 });
      }

      // ★ 教材をまたぐ付け替えを禁止する。
      //   進行表の行は「生徒の所持教材（student_textbooks）」にぶら下がっているため、
      //   別教材の単元に付け替えると「教材Aの進行表に教材Bの単元がある」状態になって壊れる。
      const { data: items, error: itemsError } = await admin
        .from('curriculum_items')
        .select('id, textbook_id')
        .in('id', [...fromIds, toId]);
      if (itemsError) {
        return NextResponse.json(
          { error: `単元の取得に失敗しました: ${itemsError.message}` },
          { status: 500 }
        );
      }
      const rows = (items || []) as { id: number; textbook_id: number }[];
      if (rows.length !== fromIds.length + 1) {
        return NextResponse.json({ error: '存在しない単元が含まれています' }, { status: 400 });
      }
      const target = rows.find((r) => r.id === toId)!;
      if (rows.some((r) => r.textbook_id !== target.textbook_id)) {
        return NextResponse.json({ error: '別の教材の単元へはまとめられません' }, { status: 400 });
      }

      const { moved, dropped } = await mergeReferences(admin, fromIds, toId);
      // 授業報告の配列も付け替える（重複は潰す）
      await rewriteLessonReportUnits(admin, fromIds, toId);
      await deleteItems(admin, fromIds);
      return NextResponse.json({ merged: fromIds, toId, moved, dropped });
    }

    return NextResponse.json({ error: '不明な action です' }, { status: 400 });
  } catch (err) {
    console.error('curriculum-items API error:', err);
    const message = err instanceof Error ? err.message : '不明なエラー';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
