/**
 * npm install のたびに、git が .githooks/ のフック（pre-push）を使うように設定する。
 *
 * ★husky を入れずに core.hooksPath だけで済ませている。依存を1つ増やすほどの仕掛けではないため。
 * ★Vercel のビルドや CI には git の作業ツリーが無いことがあるので、失敗しても黙って続ける
 *  （ここで落ちると npm install ごと失敗してデプロイが止まる）。
 * ★worktree でも効く。hooksPath は相対パスなので、各 worktree の .githooks/ が使われる。
 */
const { execSync } = require('child_process');

if (process.env.CI || process.env.VERCEL) process.exit(0);

try {
  execSync('git config core.hooksPath .githooks', { stdio: 'ignore' });
} catch {
  // git が無い・リポジトリでない環境では何もしない
}
