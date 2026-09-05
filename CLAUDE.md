# NEST（塾管理システム）

塾の教室運営を回すシステム。使うのは講師・教室長・エリアマネージャー・システム管理者で、
2027年2月から保護者も加わる。

ここには**守ってほしい決まりだけ**を置く。詳しい手順や経緯は `docs/` の各正典へ。

## 書き方

- **日本語で書く。** コード内のコメント、UI文言、コミットメッセージ、PRの説明すべて。
- **意図をコメントに残す。** 何をしているかではなく、なぜそうしたか。特に「一見おかしいが理由がある」
  箇所は理由を書く（後から読んだ人が"正しく"直して壊すのを防ぐ）。
- **装飾的な絵文字を使わない。** アイコンが要るなら `lucide-react`。

## ヘルプを同じPRで直す

機能を**足した・変えた・消した**ときは、同じPRの中で `src/lib/help/faqData.ts` のFAQも直す。

FAQは画面の説明であると同時に、**AIヘルプ（`/api/ai/help`）が答えを作る唯一の材料**でもある。
書き漏らせばAIは「載っていません」と黙り、実装と違うことが書いてあれば、それを疑わずに
自信たっぷりに間違いを案内する。**間違ったヘルプは、無いヘルプより悪い。**

★`faqData.ts` を編集する前に **[docs/help-authoring-guide.md](docs/help-authoring-guide.md)** を読む。
どのフィールドに何を書くか、まだ公開しない機能の扱い（`roles` で隠さない）、
出す前のチェックリストがそこにある。

## UIの前提

- **保護者ポータル（`/mypage`・`/portal`）は100%スマホ。** 375px幅で設計し、その幅で確認する。
  入れるか迷ったら削る。★講師名は出さない。
- **講師のUIはタイピングを最小化する。** 選ぶものはクリックかドラッグにして、
  質が要る文章だけ手で書かせる。講師は授業の合間に触る。
- **ナビゲーションは `src/components/layout/navConfig.ts` に一元化。**
  ロール判定は `src/lib/utils/roles.ts`。画面ごとに書かない。

## API・認証

- サーバー側の認証は `getApiAuth`（`src/lib/api-auth.ts`）を通す。
- ★**クライアントから `/api/admin/**`を叩くときは`fetchWithAuth`（`src/lib/api/auth.ts`）必須。**
素の `fetch` ではトークンが乗らず401になる。
- 保護者・フォームなど未ログインから触る経路は、service role を使う専用ルートに閉じる
  （`getPortalServiceClient`）。クライアントに service role を出さない。

## DB

- ★**本番のDDLは Supabase MCP の `apply_migration` で当てる。`supabase db push` を本番に向けない。**
  本番の版番号はローカルと一致しておらず、適用済みのものを再適用する。
- ローカル開発とマイグレーションの手順は `supabase/LOCAL_DEV.md`。
- ★**PostgREST は未ページングの `.select()` を1000行で静かに切り捨てる。**
  「保存されない」という不具合の正体が、実は読み込み側の切り捨てだったことがある。
- ★Supabaseの既定権限で `anon` / `authenticated` に ALL が付く。止めているのはRLSだけなので、
  機微なテーブルは revoke してから必要な権限を付け直す。
- 集計を書くときは研修用データを外す。研修生徒 `is_test`、デモ教室 `is_demo`。

## 検証

```bash
npm test              # vitest
npm run format        # prettier --write
npm run lint
```

- ★**ローカルで `npx tsc --noEmit` を実行しない。** メモリ不足で落ちる。
  型チェックはCI（`.github/workflows/ci.yml`）に一本化してある。
- テストの方針は `docs/testing.md`。

## 言語の罠

- ★`tsconfig.json` に `target` が無くES5扱いになるため、`[...set]` `[...map]` や
  Map/Set への `for-of` が **TS2802** で落ちる。`Array.from()` を使う。
