#!/usr/bin/env node
/**
 * ローカル検証用DBを本番と同じ状態に作り直す。
 *
 *   npm run db:rebuild
 *
 * ★ なぜこのスクリプトが要るのか（2026-07-15 に判明した経緯）:
 *   `supabase db reset` だけでは正しいDBが作れない。理由は3つ:
 *
 *   1. **増分マイグレーションの大半は base_schema に焼き込み済み**
 *      `00000000000000_base_schema.sql` は本番のフルスナップショット（2026年7月初旬時点）。
 *      それより前の日付の増分（例: 20260429_push_subscriptions）は既にスナップショットへ
 *      含まれており、再適用すると "policy already exists" で **チェーンが途中で停止する**。
 *
 *   2. **古い増分の再適用は、適用済みのセキュリティ修正を巻き戻す**
 *      例: `xxx_student_interviews.sql` は当時の「Enable all access for all users」
 *      （＝匿名を含む全許可）を作る。スナップショットでは既にロックダウン済みなのに、
 *      これを再適用すると **匿名露出が復活する**。実際に踏んだ。
 *
 *   3. **`xxx_*` / `zzz_*` は Supabase CLI が黙ってスキップする**
 *      ファイル名が `<timestamp>_name.sql` に合わないため。63本が対象。
 *      つまり `db reset` はそもそもこれらを見ていない（＝1と2の理由から、それで正しい）。
 *
 *   結論: **base_schema ＋ スナップショット以降（SNAPSHOT_CUTOFF 以降）の増分だけ**を当てる。
 *   これは CI が base_schema のみをビルドしている方針とも整合する。
 *
 * ★ 新しいマイグレーションを追加したら: 日付が CUTOFF より後なら自動で対象になる。
 *   本番へ適用してスナップショットを取り直した場合は CUTOFF を更新すること。
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import pg from 'pg';

/**
 * base_schema スナップショットの境界。これ以降の日付の増分だけを適用する。
 * 判定根拠: base_schema は students.is_test(20260708) を含むが
 * bulletin_posts.publish_start_at(20260708) を含まない ＝ 7/8 の途中で取得されている。
 */
const SNAPSHOT_CUTOFF = '20260703';
const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

console.log('■ 1/3 base_schema だけでリセット（--local を明示。本番には絶対に触らない）');
// ★ --linked を付けると本番が消える。絶対に付けないこと。
run('npx supabase db reset --local --version 00000000000000');

console.log('\n■ 2/3 スナップショット以降の増分を適用');
const client = new pg.Client({ connectionString: DB_URL });
await client.connect();

const files = fs
  .readdirSync('supabase/migrations')
  .filter((f) => /^\d{8,}_/.test(f) && f.endsWith('.sql'))
  .filter((f) => f.slice(0, 8) >= SNAPSHOT_CUTOFF)
  .sort();

for (const f of files) {
  try {
    await client.query('begin');
    await client.query(fs.readFileSync('supabase/migrations/' + f, 'utf8'));
    await client.query('commit');
    await client.query(
      'insert into supabase_migrations.schema_migrations (version, name) values ($1,$2) on conflict do nothing',
      [f.split('_')[0], f.replace(/^\d+_/, '').replace(/\.sql$/, '')]
    );
    console.log('   + ' + f);
  } catch (e) {
    // スナップショットに既に含まれていた場合はスキップ（想定内）。
    await client.query('rollback').catch(() => {});
    console.log('   - ' + f + '（スキップ: ' + e.message.slice(0, 60) + '）');
  }
}

console.log('\n■ 3/3 健全性チェック');
const leak = await client.query(
  "select count(*)::int n from pg_policies where roles::text like '%public%' and policyname like 'Enable all access%'"
);
const ok = leak.rows[0].n === 0;
console.log('   匿名を含む全許可ポリシー: ' + leak.rows[0].n + '件 ' + (ok ? '(OK)' : '(★異常)'));
await client.end();

// db reset でコンテナが再起動すると Kong が auth へのルートを見失うことがある。
// 放置すると「テストユーザーの作成に失敗」で統合テストが落ちるため、ここで直す。
console.log('   ゲートウェイを再起動して auth 疎通を回復');
try {
  execSync('docker restart supabase_kong_student-management', { stdio: 'ignore' });
} catch {
  console.log('   （kong コンテナが見つからないためスキップ）');
}

console.log('\n完了。次: npm run test:integration');
if (!ok) process.exitCode = 1;
