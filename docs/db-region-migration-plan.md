# DBリージョン移行計画（シンガポール → 東京）

最終更新: 2026-06-22

## 背景・目的

本番アプリの実行環境と DB のリージョンが不一致になっている。

| 要素 | 現状 | あるべき |
| --- | --- | --- |
| Vercel 関数 | `iad1`（米国東部 / x-vercel-id=`hnd1::iad1`） | 今回は変更しない（将来 `hnd1` 推奨） |
| Supabase DB | `ap-southeast-1`（**シンガポール**） | `ap-northeast-1`（**東京**） |

本番は **`school-management-pj`（www.school-ie.com / `schoolie-nagayama-3785` チーム）**。関数（米国東部）と DB（シンガポール）が地球の反対側にあり、RTT は **約200〜250ms/往復**。これが体感速度のボトルネック。DB を東京へ移すと、関数（米東部）↔DB が 米東部↔東京（約150ms）に縮む。さらに将来 Vercel 関数も `hnd1`（東京）に寄せれば関数↔DBが同一リージョン（数ms）になるが、**今回はDB移行のみ**進める。

詳細な計測経緯はメモリ `project_perf_course_progress` を参照。

## 規模（移行コストの見積もり）

2026-06-22 時点の本番 `school-db`（`mzxysqkuuxcfffwlfsvj`）:

| 項目 | 値 |
| --- | --- |
| DB サイズ | **60 MB**（非常に小さい） |
| auth.users（認証ユーザー） | 80 |
| public.students | 327 |
| public.schools | 5 |
| storage.objects | 5（ほぼ未使用） |
| public テーブル数 | 112 |
| 使用中拡張 | pgcrypto / uuid-ossp / pg_net / supabase_vault / pg_stat_statements 等 |

→ 60MB なら `pg_dump`/`restore` は数分で完了。ダウンタイムは数分〜十数分に収まる見込み。

## 移行先（新プロジェクト）

| 項目 | 値 |
| --- | --- |
| 名前 | `school-db-tokyo` |
| Project ID（ref） | `bniistrbylypnwpfqszb` |
| リージョン | `ap-northeast-1`（東京） |
| 組織 | dev-admin's Org（`woncdoxtcwnhxnfdfchy`、Pro） |
| 追加コスト | 月 $10 |

## 移行方式

`xxx_` プレフィックスのマイグレーションが順序不定で多数あるため、**「migrations を順に流して再現」は採らない**。本番から **丸ごと dump → restore** する（スキーマ・データ・RLS・関数・拡張・auth を一括移行）。

> パスワード（DB接続文字列）は Claude では扱わない。以下のコマンドは**ユーザーが自分の環境で実行**する。接続文字列の `[PASSWORD]` は Supabase ダッシュボード（Project Settings → Database）で確認/リセットして埋める。

### 前提ツール
- `supabase` CLI（`npm i -g supabase` もしくは scoop/brew）
- `psql` / `pg_dump`（PostgreSQL 17 クライアント。バージョンを DB に合わせる）

### 接続文字列（Direct connection, port 5432）
```
# 旧（シンガポール）
OLD_DB_URL="postgresql://postgres:[PASSWORD]@db.mzxysqkuuxcfffwlfsvj.supabase.co:5432/postgres"
# 新（東京）
NEW_DB_URL="postgresql://postgres:[PASSWORD]@db.bniistrbylypnwpfqszb.supabase.co:5432/postgres"
```

### 手順

**0) 事前**
- 移行作業の時間帯を決める（利用者が少ない時間。塾なので午前など）。
- 念のため旧DBの自動バックアップが取れていることを確認（Pro なら日次）。

**1) ダンプ（旧DBから）** ※ Supabase 公式の3分割方式
```bash
supabase db dump --db-url "$OLD_DB_URL" -f roles.sql --role-only
supabase db dump --db-url "$OLD_DB_URL" -f schema.sql
supabase db dump --db-url "$OLD_DB_URL" -f data.sql --use-copy --data-only
```
- `schema.sql` には public に加え auth/storage 等のオブジェクトも含まれる。
- 認証ユーザー（auth.users、パスワードハッシュ含む）は data.sql に入る。

**2) リストア（新DBへ）**
```bash
psql "$NEW_DB_URL" -f roles.sql
psql "$NEW_DB_URL" -f schema.sql
psql "$NEW_DB_URL" -f data.sql
```
- エラーが出たら個別に潰す（拡張の有効化順など）。60MB なので試行錯誤も軽い。

**3) ストレージ（5オブジェクト）**
- 数が少ないので、ダッシュボードの Storage から手動でダウンロード→新プロジェクトにアップロードでも可。
- バケットのポリシー（RLS）は schema.sql で再現される。

**4) Edge Functions の再デプロイ**
- 既存の Edge Function（例: 問い合わせメール `inquiry-mail`）を新プロジェクトにデプロイし直す。
- Function の環境変数（secrets）も新プロジェクトに再設定。

**5) pg_cron / その他**
- pg_cron ジョブがあれば移行（Vercel の cron は DB 非依存なので不要）。
- Vault に秘密があれば再投入。

## カットオーバー（env 切り替え）

新DBの検証が済んだら、アプリの接続先を切り替える。

**新プロジェクトの値**（2026-06-22 取得済み）:
- `NEXT_PUBLIC_SUPABASE_URL` = `https://bniistrbylypnwpfqszb.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = 既存アプリは JWT 形式の anon を使っているため、互換性重視で **legacy anon（JWT）** を使う:
  `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJuaWlzdHJieWx5cG53cGZxc3piIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMzA0MDAsImV4cCI6MjA5NzcwNjQwMH0.x6U8wWvE3z3JkpO7Gu8tLNZKpEXjcg4rZMUaknD91wc`
  （新方式の publishable key `sb_publishable_BLpaufOJwTIdPOcy5lYO9w_D17J8fd1` もあるが、移行はまず無変更で動かすため legacy を採用。publishable への切替は移行後に別途）
- `SUPABASE_SERVICE_ROLE_KEY` = **機密。ダッシュボードで取得**（新プロジェクト → Project Settings → API → `service_role` secret）。Claude では取得・記載しない。

**更新箇所**:
1. Vercel の Environment Variables（Production / Preview）を新プロジェクトの値に更新
2. ローカル `.env.local` も更新
3. 再デプロイ

> **重要**: 新プロジェクトは JWT secret が異なるため、**既存ログインセッションは全て無効化**される。切り替え後、全ユーザーが再ログインになる。事前に周知すること。

## 検証チェックリスト（切り替え後）

- [ ] ログインできる（新規セッション発行）
- [ ] 役割別（admin / manager / teacher）でアクセス制御が効く（RLS）
- [ ] 生徒一覧・講習進捗・座席表・提案書が表示される
- [ ] 書き込み（進捗チェック、提案書保存）が反映される
- [ ] 問い合わせメール等の Edge Function が動く
- [ ] 画像（ロゴ等 storage）が表示される
- [ ] `x-vercel-id` が `hnd1`、DB が東京 → レスポンスが体感で速い
- [ ] 主要テーブルの件数が旧DBと一致（students=327, auth.users=80, schools=5 など）

## ロールバック

env を**旧プロジェクトの値に戻して再デプロイするだけ**で即座に戻せる（旧DBはしばらく残す）。切り替え後に問題が出たら躊躇なく戻す。移行成功を数日確認してから旧 `school-db` を停止/削除する。

## 進捗

- [x] 新プロジェクト作成（`school-db-tokyo` / 東京 / Pro）
- [x] 初期化完了・URL/anon キー取得 / service_role 取得（ユーザー）
- [x] リハーサル: dump → restore → 件数検証（**全項目一致**: students327/auth80/schools5/proposals692/units13751/forms316/tables112）
- [x] 新DBリセット（public作り直し＋auth全クリア。**空を確認: public_tables=0/auth.users=0**）
- [x] storage調査（バケット `avatars`/`public-assets` は新DBにも存在。ロゴ5枚のULのみ必要）
- [x] env対象キー確認（下記3キー）
- [x] 【夜・本番】最新ダンプ→リストア→env差替→再デプロイ（2026-06-23 カットオーバー実施）
- [x] **本番が新DBを向いていることを確定**（2026-06-23 検証）:
  - 本番JSバンドル（`/login` のチャンク）が `bniistrbylypnwpfqszb.supabase.co`（新・東京）を参照。旧 `mzxysqkuuxcfffwlfsvj` はどのチャンクにも無し。
  - 新DBの API ログに本番からのライブ PostgREST トラフィック（students/schools/seasonal_proposals/course_prep 等）が **全件 200 OK** で着弾（14:56–14:57 UTC）。
  - 新DBで実セッション発行を確認（永山アカウントのシークレット窓ログイン 13:37 UTC）。
- [x] **メール疎通の実テスト**（2026-06-23 確認済み）。両 Edge Function は ACTIVE・Webhook も新URL/JWTを指す。`RESEND_API_KEY` も新プロジェクトに設定済みで通知メール到達を確認。
- [ ] **ロゴ5枚を新 `public-assets` にUL**。旧公開URLからローカル `~/Desktop/db-migration/logos/` にDL済み（同一パスでドラッグ&ドロップするだけ）。
- [ ] **書き込みの実確認**（進捗チェック保存等）。読み取りRLSはライブ200で確認済み。カットオーバー後はまだ書き込み未発生（深夜帯）。
- [ ] 旧DB停止（成功を数日確認後）

---

## 夜の本番カットオーバー実行チェックリスト

> 利用者がいない時間に、上から順に。所要15〜30分。`$OLD`/`$NEW` は新しいGit Bashなら再設定（シングルでなくダブルクオート＋記号なしPWで）。

### 0. メンテナンス開始（利用を停止）
- [ ] Vercel `school-management-pj` → Settings → Environment Variables（Production）に追加:
  - `MAINTENANCE_MODE` = `true`
  - `MAINTENANCE_BYPASS_TOKEN` = `<任意の長い文字列>`（管理者の動作確認用）
- [ ] 再デプロイ → `https://www.school-ie.com/` で**メンテ画面が出る**ことを確認
- [ ] 自分は `https://www.school-ie.com/?maint_bypass=<token>` で中に入れる（任意）
> これ以降は利用者がアクセスしてもメンテ画面なので、安心して入れ替え作業ができる。

### A. 最新ダンプ（今日の更新分を反映）
- [ ] **Docker Desktop を起動**（クジラ緑）。`docker ps` が通ること
- [ ] Git Bash で:
  ```bash
  export PATH="$HOME/scoop/apps/postgresql/current/bin:$PATH"
  cd ~/Desktop/db-migration
  supabase db dump --db-url "$OLD" -f roles.sql --role-only
  supabase db dump --db-url "$OLD" -f schema.sql
  supabase db dump --db-url "$OLD" -f data.sql --use-copy --data-only
  ```

### B. リストア（新・東京DBへ）
> 新DBはリセット済みで空。Claude側で再度「空」を確認してから流すと安全（声かけてください）。
- [ ] ```bash
  psql "$NEW" -f roles.sql
  psql "$NEW" -f schema.sql
  psql "$NEW" -f data.sql
  ```
- [ ] Claudeが件数検証（旧と一致するか）

### C. ロゴ5枚を storage にUL（`public-assets` バケット）
新ダッシュボード → Storage → `public-assets` に、同じパスでUL:
- [ ] `school-logos/9a6b5996-a266-47ed-878f-85e93c2b8b90/logo_1773980399532.jpg`（緑園都市）
- [ ] `school-logos/9f519794-3673-4e90-b1ea-88a79f70174a/logo_1773980376176.jpg`（京王堀之内）
- [ ] `school-logos/d0dea5b6-7f4c-4160-9ea6-3b91b4f895a0/logo.jpg`（デフォルト教室）
- [ ] `school-logos/d187f7a3-633a-46ce-8d32-c56c85d17bac/logo_1773980342251.jpg`（永山）
- [ ] `school-logos/e26b398c-8e30-47bc-b528-ee92fd45be7f/logo_1773980388523.jpg`（清瀬）
> 旧ダッシュボードの同パスからDL→新へUL。表示が崩れても業務影響は軽微なので後回しでも可。

### D. env 差し替え（3キー）→ 本番切替
対象キー（`.env.local` と Vercel Production の両方）:
| キー | 新しい値 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://bniistrbylypnwpfqszb.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 計画書上部の legacy anon（JWT）|
| `SUPABASE_SERVICE_ROLE_KEY` | 新プロジェクトの service_role（ユーザー保有・機密）|

- [ ] `.env.local` を新値に（ClaudeがURL/anonは編集可。service_roleはユーザー）
- [ ] **Vercel** `school-management-pj` → Environment Variables（Production）の Supabase3キーを新値に更新 ← 本番切替の本体
- [ ] **同時に `MAINTENANCE_MODE` を `false`（または削除）** してメンテ解除
- [ ] 再デプロイ（Vercel）← これで「新DB接続＋メンテ解除」が一度に反映される

### E. 検証
- [ ] ログインできる（全員再ログインになる旨は事前周知）
- [ ] 役割別（admin/manager/teacher）でRLSが効く
- [ ] 生徒一覧・講習進捗・座席表・提案書が表示／書き込みできる
- [ ] ロゴが表示される
- [ ] 体感が速くなった（DBが東京になり、関数↔DBの往復が短縮）。※関数は今回 `iad1` のまま
- [ ] 件数が旧と一致

### ロールバック
env を旧値に戻して再デプロイで即復帰。**旧DBは数日残す**。問題なければ旧 `school-db` を停止/削除。
