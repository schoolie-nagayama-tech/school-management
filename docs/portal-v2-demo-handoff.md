# 保護者ポータル v2 本番デモ — 引継ぎ

作成: 2026-07-16 / ブランチ `feature/portal-v2-release`（**未push・未マージ**）

**目的**: 保護者ポータルv2を本番に「ダミーデータだけのデモ」として置き、教室長（manager以上）に触ってもらう。実データには一切つなげない。
**仕様の正典**: `docs/portal-v2-requirements.md`（デモの設計は **§6-5**）

---

## 1. 現在地（ここまで終わっている）

| | 状態 |
|---|---|
| コード | **完成・検証済み**。`feature/portal-v2-release` に22コミット。作業ツリーはクリーン |
| ローカル検証 | **完了**。フラグOFF（本番と同じ）で通しの動作を実機確認済み |
| 本番DB | **マイグレーション5本＋デモデータとも適用済み（2026-07-16）**。§3-2・§3-3 完了 |
| Vercel env | `PORTAL_JWT_PRIVATE_JWK` は**ユーザーが設定済み**（2026-07-16 申告）。**未検証**（デモ入口を admin が実際に開くのが最終確認） |
| push / merge | ✅ **完了（2026-07-16・PR #9・main=2686e3d）**。CI全green・本番デプロイ済み |

**§3-5 の本番確認（2026-07-16・外形は済み）**:
- `/mypage` 未ログイン → 404コンテンツ・デモ生徒名の漏れゼロ ✓
- `/api/portal-demo/start`・`/api/mypage/**` 未認証 → 401 JSON ✓
- **残り1つ**: admin がブラウザで 歯車→「保護者ポータルV2」→ デモが開くこと（`PORTAL_JWT_PRIVATE_JWK` の実地検証を兼ねる。失敗したら Vercel env を疑う）
- ★ 副産物の発見: 本番の `/`・`/login` は **cookie無しの素のリクエストに 500ステータス＋エラーシェル**を返す（実ブラウザでは完全描画・実害未確認）。**マージ前の旧ビルドから出ている既存事象**で本件の回帰ではない。別タスクで調査中

**CIをこのPRで直した3点（次に同じ穴に落ちないために）**:
1. `supabase start` が `signing_keys.json`（コミット禁止の実鍵）を要求して即死 → CI では使い捨てES256鍵をその場で生成
2. seed.sql がポータルテーブルを参照し base_schema 単独ではDBが組めなくなった → CI のDB構成を「base_schema＋日付付き増分」（ローカル db:reset と同じレシピ）に変更
3. vault移行2本が両方バージョン `20260714` に解決され schema_migrations の主キー衝突 →「同日8桁2本の罠」を踏んでいた。14桁（20260714100000/110000）へリネーム（本番未適用なので安全）

**保護者ダッシュボード追加（2026-07-16・コミット 073ef96）**: `/mypage` トップがメニューの器からダッシュボードに（連絡→次の授業→報告書→申込。承認済みモック=claude.ai/code/artifact/baef27d7-7c3c-479d-b436-c6761dff2225）。全子ども分をサーバーで先読み・タブ切替は無通信。スケジュール/チャットのロジックをlibへ抽出（ルートの挙動不変）。

`tsc` green（CIと同じ既定ヒープで通る）／ unit 658 pass ／ ESLint・Prettier clean。

---

## 2. デモの設計（なぜこうなっているか）

**全体フラグ `portal_v2_enabled` は OFF のまま。ONにしてはいけない。**
- グローバルなキー1個なので、ONにすると `/mypage/login` が**本番に一般公開**される
- しかも**レイアウトしか見ておらず `/api/mypage/**` の16本は一切チェックしない**＝緊急遮断として機能しない（画面が消えるだけ）

**代わりにスタッフ認証を通したデモ専用セッションで入る**:
`AppHeader の歯車メニュー`（`isSystemAdmin`・「教室長ダッシュボード（試作）」の隣）
→ `POST /api/portal-demo/start`（`requireSystemAdmin`）
→ **`demo: true` クレーム付きの署名済みJWT** → `portal_session` cookie
→ `/mypage` レイアウトの門番は `フラグON || claims.demo`

### 公開範囲は admin のみ（ユーザー判断 2026-07-16「一旦見えるのはアドミンのみ」）
当初は「教室長に本番で触ってもらう」目的で **manager 以上11名**に開いていたが、まず **admin 4名**に絞った。
広げるときは以下を**3点セットで**揃えること（1つでも欠けると機能しない or 意図より広く開く）:

| # | 箇所 | 現在 |
|---|---|---|
| 1 | `AppHeader.tsx` 歯車メニューの条件 | `isSystemAdmin` |
| 2 | `/api/portal-demo/start` の認可 | `requireSystemAdmin` |
| 3 | デモSQL `2-b)` の `user_schools` 付与範囲 | `up.role = 'admin'` |

★ **`requireAdmin` を使ってはいけない**: 名前に反して **admin と owner の両方**を通す（＝プロジェクトの
「管理者権限」の既定）。UI の `isSystemAdmin`（admin 厳密）と境界がズレ、**メニューに出ない owner が
API を直接叩けば入れる**状態になる。そのため `requireSystemAdmin` を新設した（`src/lib/api-auth.ts`）。
この「owner は admin ではない」前提は `src/__tests__/utils/roles.test.ts` で固定してある。

★ 3点セットの理由: (3) だけ足しても入口(1)(2)が無ければ触れず、(1)(2)だけ開いても user_schools が
無いと**受信箱が空**で双方向を体験できない。

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

### 3-2. マイグレーション5本を本番へ — ✅ **2026-07-16 適用完了**
**`supabase db push` は絶対に使わない**（13本を再適用する地雷。ローカルのファイル名と本番の適用済み版番号がズレている）。
**Supabase MCP の `apply_migration`**（project_id=`bniistrbylypnwpfqszb`）で1本ずつ流した:

1. `20260714000000_portal_v2_foundation.sql` → 本番版名 `portal_v2_foundation`
2. `20260714010000_portal_v2_chat_bulletin.sql` → `portal_v2_chat_bulletin`
3. `20260714020000_portal_v2_schedule.sql` → `portal_v2_schedule`
4. `20260715000000_portal_v2_reports.sql` → `portal_v2_reports`
5. `20260716000000_schools_meeting_booking_url.sql` → `schools_meeting_booking_url`

**適用前に本番で実測して監査を再確認した**（doc の主張はすべて裏が取れた）:
- DROP/TRUNCATE/DELETE なし。`drop policy if exists` は**自分が直後に作り直すポリシーだけ**が対象で、実測でも本番に同名ポリシーは1つも存在しなかった
- RLS 有効化の対象（`bulletin_posts`/`schedule_entries`/`schedule_time_slots` ほか）は**全て既に有効＝no-op**（実測）
- 前提（portal ロール・`portal_uid()`・`class_reports`・publish window 列・ビューが参照する40列）は**全て本番に存在**（実測）

**適用後の実測結果**: 新規テーブル13 ／ 新規ビュー3 ／ `bulletin_posts` に3列 ／ `schools.meeting_booking_url` 1列 ／ portal ポリシー14本。
**フラグは `false` のまま**（`system_settings.portal_v2_enabled`。`on conflict do nothing` で seed）。
**既存への影響ゼロを確認**: `bulletin_posts` は41行すべてが既定 `{社内}`/`all` ＝従来挙動のまま。既存のスタッフ用/anon ポリシー（`bulletin_posts_school_scope_auth` 等）は**1本も消えず全て健在**で、portal ポリシーが別ロールで併存しているだけ。

**Supabase の security advisor が出す指摘のうち、以下は設計どおり**（是正してはいけない）:
- `security_definer_view` ERROR × 3（`portal_teacher_names` / `portal_class_reports` / `portal_lesson_report_units`）＝**列の限定公開の仕組みそのもの**。`security_invoker` にすると下層の PII テーブルを portal に grant する羽目になり目的が崩れる
- `rls_enabled_no_policy` INFO × 2（`portal_invitations` / `portal_report_notifications`）＝**意図したデフォルト拒否**（service role 専用）
- `function_search_path_mutable`（`portal_uid`）＝**この適用より前から本番にあった**既存の指摘。SECURITY DEFINER ではないので呼び出し側権限で動く

**★ 版番号のズレが5本ぶん増えた（`db push` 禁止がさらに重要に）**:
`apply_migration` は適用時刻で版番号を採番するため、本番の記録とローカルのファイル名が対応しない:

| ローカルのファイル名 | 本番に記録された版番号 |
|---|---|
| `20260714000000_portal_v2_foundation` | `20260716070016` |
| `20260714010000_portal_v2_chat_bulletin` | `20260716070103` |
| `20260714020000_portal_v2_schedule` | `20260716070137` |
| `20260715000000_portal_v2_reports` | `20260716070218` |
| `20260716000000_schools_meeting_booking_url` | `20260716070230` |

→ 今後 `supabase db push` を打つと**この5本も未適用と判定されて再実行される**（既存13本の地雷に追加）。
中身は冪等（`if not exists` / `on conflict do nothing` / `drop policy if exists`＋作り直し）なので事故っても壊れにくいが、**db push は引き続き絶対に使わない**。

### 3-3. デモデータを本番へ — ✅ **2026-07-16 投入完了**
`supabase/demo/portal_v2_demo_data.sql` を MCP の `execute_sql` で実行（1トランザクション・エラーなし）。
- **投入後の実測が期待値と完全一致**: 教室1 / 生徒2(is_test) / 予定26(振替1・休講1込み) / 承認済み報告書3(単元4) / お知らせ2 / チャット2スレッド9件 / 手続き2 / ポータルアカウント1(紐づけ2) / 時限4 / パターン5 / 教材3 / デモ講師auth 2
- **admin限定を本番で確認**: デモ校の user_schools に入ったのは **admin 4名ちょうど**・manager/owner は0名
- 実行前チェックも全クリーン: 固定UUID `d0000000-*` の衝突ゼロ（12テーブル実測）／ delete 対象0件
- **冪等**（何度流しても行数不変）。日付は `current_date` 相対なので、古びたら流し直せば「今日」基準で作り直される
- 破壊的操作は3つ: `delete from schedule_entries`（デモ生徒2名の固定UUID限定）＋ `update schedule_entries` 2箇所（振替/休講バッジ用・**デモ生徒の行だけをサブクエリで選ぶ**）。旧記述「deleteだけ」は不正確だったので訂正
- ★ 実行手段のメモ: MCP `execute_sql` はファイルを読めないため全文をパラメータで渡す。転記ミス防止に「スクラッチへ書き出し→元ファイルと diff --strip-trailing-cr → md5一致確認」を先に行うこと（今回この照合が実際にコメント行の転記ミスを1件検出した）

### 3-4. マージ＆デプロイ
`feature/portal-v2-release` を main へ。CI は lint / format:check / tsc / `npm test`（ユニットのみ）/ build。

**マージ前の「既存ユーザーの使用感」棚卸し（2026-07-16 実施・ユーザー指示）**:
main比223ファイルのうちスタッフが触る面を全て精査した。**既存ユーザーに見える変更は以下だけ**:

| 誰に | 何が見える | 挙動 |
|---|---|---|
| 全スタッフ | 掲示板の投稿モーダルに「配信先」欄 | **既定=社内（`useState(['社内'])`・API側も既定社内）＝従来挙動不変**。触らなければ何も変わらない |
| 全スタッフ | 発注ページのまとめて発注の成否表示・カート維持 | **意図したバグ修正**（b9fcd6f） |
| manager以上 | `/settings/school` に面談予約URL欄（1項目追加） | 未設定なら何も起きない |
| admin 4名のみ | 歯車メニューに2項目＋教室ドロップダウンにデモ校 | admin限定（3点セット済み） |
| 講師 | `/lesson-reports` 記入フォームの刷新（Stage4-A） | **本番 class_reports=0件＝誰も使っていない**画面 |
| 保護者・一般 | 何も見えない | フラグOFF・`/mypage` は404のまま |

**全リクエストに効く箇所も確認済み**: `middleware.ts` と `AuthContext` の変更は `/mypage` 系パスの除外追加のみ（スタッフのパスに影響なし）。`package.json` は依存の追加のみ（既存の版上げなし）。
**デプロイ時の既知の注意**: serwist SW の CacheFirst により、デプロイ直後はPWAが旧バンドルを配ることがある（既知の罠・対策済みだが、直後に画面が変に見えたらまずSWキャッシュを疑う）。

### 3-5. 本番での確認
**admin で**歯車 → 「保護者ポータルV2（試作・ダミーデータ）」→ `/mypage` が開き、デモバナーと「体験 太郎（中2）」「体験 花子（小6）」が出ること。
**未ログインの第三者が `/mypage` を開いても404のまま**であること（＝フラグOFFが効いている）。
**admin 以外（owner / 教室長 / 講師）には歯車メニューに項目が出ない**こと（＝公開範囲が admin のみ）。

---

## 4. この変更が既存に与える影響（実測済み）

**アカウントは変わらない**（デモSQLをローカルで流して差分を取り、認証情報・ロール・表示名・有効無効・既存の教室レコードのハッシュが**一致**することを確認）。

**変わるのは1つだけ**: **admin（4名）**の **`user_schools` に行が1つ増える**＝担当教室にデモ校が加わる。
- 目的: 受信箱 `/admin/portal-chat` は `auth.schoolIds` で絞るため、担当でないと「保護者が送る→教室が返す」を体験できない
- 影響: **その4名の教室ドロップダウンに「デモ校（保護者ポータル体験）」が1項目増える**（`is_demo` は除外されない。`AppHeader.tsx` は `displaySchools = schools` でフィルタ無し＝2026-07-16 実機再確認。CLAUDE.md とデモSQLに元々あった「除外する」という記述は**誤り**で、両方訂正済み）
- **教室長（manager）・エリアマネージャー（owner）・講師には何も起きない**（2026-07-16 に admin 限定へ変更。以前の版では manager 以上11名に増えると書いてあった）
- 不要なら デモSQL の「2-b)」ブロックを外す（その場合スタッフ側は触れず保護者側の体験のみになる）

**既存画面の変更**（main比）: `ordering` 3ファイル（まとめて発注の修正）／ `AppHeader`（歯車メニューに1項目・**admin のみ**）／ `home-mock`（認可ガード）／ `lesson-reports`（Stage4-A・**本番の class_reports は0件＝誰も使っていない**）／ `BulletinPostModal`（配信先の選択欄が増える。既定=社内で挙動不変）。
→ **admin 以外のスタッフから見て、この変更で見た目が変わる箇所は `BulletinPostModal` の配信先欄だけ**（既定=社内で挙動不変）。

---

## 5. デモで何が試せるか

Grow置換の全ループがデモ校で一周できる（**デモ用の特別な分岐は作っていない**。実在教室とまったく同じ仕組みで、違うのはデータだけ）:

1. 講師が**進行表融合UI**で報告書を書く（`/lesson-reports/[scheduleEntryId]`）→ 室長が承認 → **保護者のマイページに出る**
2. 室長が**掲示板に配信先「保護者」で投稿** → 保護者のお知らせに出る
3. 保護者が**欠席・振替**を送る → 室長の受信箱（`/admin/portal-chat`・教室切替でデモ校）に届いて返信できる。時限は**実在スロットのプルダウン**（自由入力は廃止。2026-07-16 フィードバック反映で AbsenceSheet と ChatView の二重実装の両方を select 化）
4. **面談希望は予約URL直行**（2026-07-16 変更）: 教室に `meeting_booking_url` が設定されていれば、面談希望を押すと**チャットを介さず「予約ページを開く」ボタン**が出て Google カレンダーの予約ページへ直行する。未設定の教室だけ従来のチャット送信フォームが残る（後方互換）。URL設定は `/settings/school`

★ 上の「講師」「室長」は**役割**であって担当者ではない。公開範囲を admin に絞ったので、
**この3ループは admin 1人が全役をやって一周する**（admin は階層上、講師・室長の画面をすべて操作できる）。
教室長に実際に触ってもらう段階になったら §2 の3点セットを manager 以上に戻す。

**投入されるデモデータ**: 教室1 / 講師2 / 生徒2（is_test）/ 時限4 / 通塾パターン5 / 予定26 / 承認済み報告書3 / 単元4 / 教材3（is_active=false）/ お知らせ2 / チャット2スレッド9件 / 手続き2 / ポータルアカウント1。

**⚠ デモSQLは 2026-07-16 の本番投入後に1点更新された**: 報告書に科目別欄（`subject_specific`。太郎数学=計算練習／太郎英語=単語練習＋プリント自由記述／花子=null）を追加。保護者面の科目別セクション（同日に表示側を実装）をデモで見せるため。**本番はまだ旧内容のまま**なので、デプロイ前に同ファイルを本番へ再実行すること（冪等・on conflict で上書き反映される）。

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
