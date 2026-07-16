# 保護者ポータル v2 本番デモ — 引継ぎ

作成: 2026-07-16 / ブランチ `feature/portal-v2-release`（**未push・未マージ**）

**目的**: 保護者ポータルv2を本番に「ダミーデータだけのデモ」として置き、教室長（manager以上）に触ってもらう。実データには一切つなげない。
**仕様の正典**: `docs/portal-v2-requirements.md`（デモの設計は **§6-5**）

---

## 1. 現在地（ここまで終わっている）

| | 状態 |
|---|---|
| コード | **完成・検証済み**。`feature/portal-v2-release` に21コミット。作業ツリーはクリーン |
| ローカル検証 | **完了**。フラグOFF（本番と同じ）で通しの動作を実機確認済み |
| 本番DB | **何も触っていない**。マイグレーション5本すべて未適用・デモ校も無し |
| Vercel env | `PORTAL_JWT_PRIVATE_JWK` は**ユーザーが設定済み**（2026-07-16 申告）。未検証 |
| push / merge | **未実施** |

`tsc` green（CIと同じ既定ヒープで通る）／ unit 658 pass ／ ESLint・Prettier clean。

---

## 2. デモの設計（なぜこうなっているか）

**全体フラグ `portal_v2_enabled` は OFF のまま。ONにしてはいけない。**
- グローバルなキー1個なので、ONにすると `/mypage/login` が**本番に一般公開**される
- しかも**レイアウトしか見ておらず `/api/mypage/**` の16本は一切チェックしない**＝緊急遮断として機能しない（画面が消えるだけ）

**代わりにスタッフ認証を通したデモ専用セッションで入る**:
`AppHeader の歯車メニュー`（`isManagerOrAbove`・「教室長ダッシュボード（試作）」の隣）
→ `POST /api/portal-demo/start`（`requireManager`）
→ **`demo: true` クレーム付きの署名済みJWT** → `portal_session` cookie
→ `/mypage` レイアウトの門番は `フラグON || claims.demo`

**隔離は三重**: デモ教室 `is_demo` ＋ デモ生徒 `is_test` ＋ RLS（`portal_students_select_linked` が紐づけ生徒しか見せない）。

**安全弁**:
- `start` API が「紐づけ生徒が**全員** is_test かつ is_demo 校」を毎回検証し、1人でも違えば発行を拒否（紐づけ0件も弾く。`every()` は空配列で vacuous に true になるため）
- `notify.ts` の宛先解決がダミー生徒で必ず空を返す（呼び出し側に依存せず1箇所で塞ぐ）
- デモアカウントの `password_hash` はログイン不能値（フラグを将来ONにしても公開ログイン口にならない）

---

## 3. 本番適用の手順（この順で）

### 3-1. 前提の確認
```
# Vercel の Production env に PORTAL_JWT_PRIVATE_JWK があるか（値は .env.local の31行目と同じ1行JSON）
# 本番Supabaseが鍵を信頼していることは確認済み: kid=ba8b0eaf-2ffc-4513-9bc2-0b9ece8f063d
curl -s https://bniistrbylypnwpfqszb.supabase.co/auth/v1/.well-known/jwks.json
```

### 3-2. マイグレーション5本を本番へ
**`supabase db push` は絶対に使わない**（13本を再適用する地雷。ローカルのファイル名と本番の適用済み版番号がズレている）。
**Supabase MCP の `apply_migration`**（project_id=`bniistrbylypnwpfqszb`）で1本ずつ流す:

1. `20260714000000_portal_v2_foundation.sql`
2. `20260714010000_portal_v2_chat_bulletin.sql`
3. `20260714020000_portal_v2_schedule.sql`
4. `20260715000000_portal_v2_reports.sql`
5. `20260716000000_schools_meeting_booking_url.sql`

**安全性は監査済み**: DROP/TRUNCATE/DELETE なし ／ 既存のスタッフ用ポリシーを1つも触らない ／ RLS 有効化は対象6テーブルすべてで既に有効＝no-op ／ `bulletin_posts` の列追加は40行で既定値が従来挙動を保つ。
前提（本番に既にある）: portal ロール・`portal_uid()`・`class_reports`・publish window 列。

### 3-3. デモデータを本番へ
`supabase/demo/portal_v2_demo_data.sql` を実行（MCP の `execute_sql`。805行・1トランザクション）。
- **冪等**（何度流しても行数不変）。日付は `current_date` 相対なので、古びたら流し直せば「今日」基準で作り直される
- 固定UUIDは全部 `d0000000-0000-4000-8000-*`。**本番での衝突ゼロを全11テーブルで確認済み**
- ファイル内で唯一の破壊的操作は `delete from schedule_entries where student_id in (デモ生徒2名の固定UUID)`。**本番での削除対象は0件**（デモ生徒がまだ存在しないため）

### 3-4. マージ＆デプロイ
`feature/portal-v2-release` を main へ。CI は lint / format:check / tsc / `npm test`（ユニットのみ）/ build。

### 3-5. 本番での確認
歯車 → 「保護者ポータルV2（試作・ダミーデータ）」→ `/mypage` が開き、デモバナーと「体験 太郎（中2）」「体験 花子（小6）」が出ること。
**未ログインの第三者が `/mypage` を開いても404のまま**であること（＝フラグOFFが効いている）。

---

## 4. この変更が既存に与える影響（実測済み）

**アカウントは変わらない**（デモSQLをローカルで流して差分を取り、認証情報・ロール・表示名・有効無効・既存の教室レコードのハッシュが**一致**することを確認）。

**変わるのは1つだけ**: 教室長以上（11名）の **`user_schools` に行が1つ増える**＝担当教室にデモ校が加わる。
- 目的: 受信箱 `/admin/portal-chat` は `auth.schoolIds` で絞るため、担当でないと「保護者が送る→教室が返す」を体験できない
- 影響: **教室ドロップダウンに「デモ校（保護者ポータル体験）」が1項目増える**（`is_demo` は除外されない。`AppHeader.tsx` は `displaySchools = schools` でフィルタ無し。CLAUDE.md の「除外する」という記述は古い）
- 11名中8名は既に is_demo の「デフォルト教室」を担当済みなので性質は同じ
- 不要なら デモSQL の「2-b) 教室長以上をデモ校の担当に加える」ブロックを外す（その場合スタッフ側は触れず保護者側の体験のみになる）

**既存画面の変更**（main比）: `ordering` 3ファイル（まとめて発注の修正）／ `AppHeader`（歯車メニューに1項目）／ `home-mock`（認可ガード）／ `lesson-reports`（Stage4-A・**本番の class_reports は0件＝誰も使っていない**）／ `BulletinPostModal`（配信先の選択欄が増える。既定=社内で挙動不変）。

---

## 5. デモで何が試せるか

Grow置換の全ループがデモ校で一周できる（**デモ用の特別な分岐は作っていない**。実在教室とまったく同じ仕組みで、違うのはデータだけ）:

1. 講師が**進行表融合UI**で報告書を書く（`/lesson-reports/[scheduleEntryId]`）→ 室長が承認 → **保護者のマイページに出る**
2. 室長が**掲示板に配信先「保護者」で投稿** → 保護者のお知らせに出る
3. 保護者が**欠席・振替・面談**を送る → 室長の受信箱（`/admin/portal-chat`・教室切替でデモ校）に届いて返信できる。面談は自動返信に**Googleカレンダー予約URL**（`/settings/school` で設定）

**投入されるデモデータ**: 教室1 / 講師2 / 生徒2（is_test）/ 時限4 / 通塾パターン5 / 予定26 / 承認済み報告書3 / 単元4 / 教材3（is_active=false）/ お知らせ2 / チャット2スレッド9件 / 手続き2 / ポータルアカウント1。

---

## 6. 残っている課題

| # | 内容 |
|---|---|
| 1 | **通知メールの宛先解決**が未実装。`portal_accounts` はPIIを持たない設計で、暫定の `form_responses.email` 経路は実質no-op。恒久策（portal_accounts に通知先を足す / LINE連携）は**未決**。デモでは `notify.ts` のガードで必ず送らない |
| 2 | **help の FAQ_DATA が未更新**（Stage4 A/B・デモとも）。機能変更時にヘルプも更新する運用ルールがある |
| 3 | **ポータルのRLSテスト6本がCIの対象外**。統合CIは `rls-teacher-scope.test.ts` 1本を base_schema のみで走らせる。ポータルのRLS回帰が自動で守られていない |
| 4 | **base_schema が2026-07-08時点**で古い。再生成は `db dump --linked` が `cli_login_postgres` のロール衝突で失敗するため未実施 |
| 5 | v1フォームのプリフィル未実装（リンクのみ）／申込プッシュの「通知1回」が未実装 |
| 6 | **実在の保護者を1人でも招待する前に同意フローが必須**（法務はクローズド期間中に並行策定） |
| 7 | デモの進行表セッション履歴（`progress_sessions`）は0件。報告書を書けば貯まる。過去の積み上がりを見せたいなら要仕込み |

---

## 7. ローカルで動かす

```
npm run dev                          # .env.development.local でローカル向き
# http://localhost:3000
#   スタッフ: staff@test.local / password123
#   （tybiz1452@gmail.com / password123 もローカルDBに直接作ってある。db:reset で消える）
# 歯車 → 「保護者ポータルV2（試作・ダミーデータ）」
```
ローカルのフラグは**本番と同じ false** にしてある（`system_settings.portal_v2_enabled`）。
保護者のログインフォーム（`parent` / `password123`）を試すならフラグを true に戻す。

デモデータの流し直し:
```
docker exec -i supabase_db_student-management psql -U postgres -d postgres \
  -q -v ON_ERROR_STOP=1 < supabase/demo/portal_v2_demo_data.sql
```

---

## 8. 踏んだ罠（次に同じ穴に落ちないために）

- **`supabase db push` は本番に13本を再適用する**。ローカルのファイル名の版番号と本番の記録がズレている。本番DDLは MCP の `apply_migration` で
- **クライアントから `/api/admin/**` を素の `fetch` で叩くと必ず401**。`fetchWithAuth`（`src/lib/api/auth.ts`）を使う。**curlで手動でBearerを付けて通っても、画面が動く証明にはならない**（これでスタッフ側3画面が Stage1〜3 以来ブラウザで一度も動いていなかったのを見逃していた）
- **`auth.users` を手で作るときの罠2つ**: `banned_until='infinity'` は `/users` を500にする（Goのドライバが time.Time に変換できない）／トークン列がNULLだとログインが500になる。`docker logs supabase_auth_*` にGoTrueが原因を明示する
- **`notFound()` が200ステータスで404ページを返す**。遮断の判定にステータスコードを使ってはいけない。**デモ生徒の実名など固有の文字列**で見る
- **devサーバーを起動したままユニットテストを回すと `portal-form-responses.test.ts` が5秒タイムアウトで落ちる**。ルートが `fetch('http://localhost:3000/api/push/send')` を実行するため。CIでは即ECONNREFUSEDでpassするので**CIの問題ではない**
- **エージェントと並行して tsc/vitest を回すと結果が信用できない**（CPU/メモリ競合でヒープクラッシュやタイムアウト）。静かな状態で測り直す
- **ブランチの古いコミットをmainと突き合わせずに「未マージ」と決めつけない**。`61a46f0`（担当NG講師UI）と `15463d0`（トースト）は既にmainに別コミットで入っていた
- **`read_page` / `computer{screenshot}` はこの環境で動かない**。ブラウザ確認は `javascript_tool` でDOMを読む

---

## 9. 次の機能（未設計・ユーザーから提示済み）

1. **保護者はログイン後 Dashboard に着地**させる（現状の `/mypage` はメニューを並べた器）
2. **成績を保護者に開放して入力させる** — ポータル初の本格的な書き込み。`portal` ロールは現在**17オブジェクトのSELECTのみ**なので、書き込みは既存の型（service role API ＋ 入口で `requirePortalStudent`）に乗せる。`portal` に INSERT を grant しない（デフォルト全拒否の利点を捨てない）
   - 論点: どの成績か（`assessments` / `exam_result_score` / `student_textbook_exams` のどれ？）／保護者が入れた値の信頼性（承認で仕切るか）／誰が見るか
