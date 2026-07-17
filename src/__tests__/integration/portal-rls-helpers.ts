/**
 * 保護者ポータル RLS 回帰テスト用ヘルパー。
 *
 * なぜ既存の rls-helpers.ts（signInWithPassword 方式）と別建てなのか:
 *   ポータルアカウント（portal_accounts）は GoTrue のユーザーではないので
 *   signInWithPassword でトークンを得られない。本番では自前署名の ES256 JWT を
 *   使うが、ローカルスタックはその署名鍵（本番にインポート済みのポータル鍵）を
 *   持たないため、supabase-js 経由で「ポータルJWTが受理される」経路を再現できない。
 *
 *   RLS ポリシーが読むのは最終的に request.jwt.claims（sub）と実行ロールだけ
 *   なので、ここでは Postgres へ直接接続し、トランザクション内で
 *     - request.jwt.claims に sub / role をセット
 *     - SET LOCAL ROLE portal / authenticated / anon
 *   してからクエリする。これでポリシー述語を決定論的に検証できる（JWT署名層は
 *   認証の関心事であって、RLS 述語の関心事ではないため、この分離は妥当）。
 *
 * ポータルは専用ロール `portal` で動く（既存の authenticated 向けポリシー群からの
 * 構造的隔離。migration 20260714000000 参照）。authenticated はスタッフの
 * 回帰確認（ポータル隔離でスタッフ側が壊れていないこと）に使う。
 *
 * 実行前提: supabase start 済み、.env.test に DATABASE_URL があること。
 */
import { Client } from 'pg';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env.test') });

const DATABASE_URL = process.env.DATABASE_URL!;

/** RLS検証に使うDBロール。portal=ポータル利用者 / authenticated=スタッフ / anon=未ログイン */
export type RlsRole = 'portal' | 'authenticated' | 'anon';

/**
 * 指定ロール・クレームで SELECT を実行し、行を返す。
 * トランザクションで包み、常に ROLLBACK して副作用を残さない。
 *
 * @param role   'portal' | 'authenticated' | 'anon'（DBロール）
 * @param sub    JWTの sub 相当（portal のとき portal_uid() になる）。anon は null。
 * @param sql    実行するSQL（$1, $2... のプレースホルダ可）
 * @param params バインドパラメータ
 */
export async function selectAs(
  role: RlsRole,
  sub: string | null,
  sql: string,
  params: unknown[] = []
): Promise<Record<string, unknown>[]> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    // JWTのクレーム相当を GUC にセット（portal_uid() / auth.uid() がここから sub を読む）。
    // role クレームも実ロールと一致させる（本番のPostgREST挙動の再現）。
    if (sub) {
      const claims = JSON.stringify({ sub, role, ...(role === 'portal' ? { portal: true } : {}) });
      await client.query("select set_config('request.jwt.claims', $1, true)", [claims]);
    }
    // 以降のクエリを対象ロールで実行（RLS が有効になる）。
    await client.query(`SET LOCAL ROLE ${role}`);
    const res = await client.query(sql, params);
    await client.query('ROLLBACK');
    return res.rows as Record<string, unknown>[];
  } catch (e) {
    // permission denied 等（RLS/GRANT による拒否）はそのまま投げ、呼び出し側で扱う。
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    await client.end();
  }
}

/**
 * selectAs のラッパー。RLS/権限で弾かれた場合を「0件 or エラー」の真偽で返す。
 * 「読めないこと」を検証するテスト向け。
 * @returns 読めた行数（エラーで弾かれたら -1）
 */
export async function tryCountAs(
  role: RlsRole,
  sub: string | null,
  sql: string,
  params: unknown[] = []
): Promise<number> {
  try {
    const rows = await selectAs(role, sub, sql, params);
    return rows.length;
  } catch {
    return -1; // permission denied 等
  }
}
