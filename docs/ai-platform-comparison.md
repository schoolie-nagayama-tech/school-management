# NEST への AI 機能導入：呼び出し基盤の比較検討

作成日: 2026-09-01 / 前提: Next.js 14 (App Router) + Supabase + Vercel、TypeScript

> 本書の価格・仕様は 2026-09-01 時点で公式ドキュメントを参照して記載している。出典は §7、確認できなかった項目は §8 に正直に列挙した。
> 為替は **1 USD = 150 円** で換算している（実際の請求は各社のレートによる）。

---

## 1. 結論

- **Anthropic Claude API（Haiku 4.5 を主力、Sonnet 5 を難所だけ）を Vercel AI SDK 経由で叩く構成**を推す。月額 ¥1,100〜2,300 で 3 ユースケースすべてを賄える。
- 決め手は価格ではない（どれを選んでも月 ¥3,000 未満）。**API に送った内容を既定でいっさい保存しない**のは Claude API だけで、生徒の氏名・成績を扱う本システムでは説明責任がいちばん軽い。
- **Google Workspace 契約から自社アプリで Gemini を呼ぶことはできない**（§2）。Gemini を使うなら Google Cloud の別契約・別課金になり、「すでに払っているぶんで賄える」は成立しない。

---

## 2. Google Workspace から引っ張れるのか

### 答え: **いいえ。引っ張れない。**

Workspace の Gemini は「**Workspace の各アプリ（Gmail / Docs / Sheets / Slides / Meet / Chat）の中で人が使うアシスタント機能**」として提供されている。Google の管理者向け公式ドキュメントが列挙しているのも、各アプリのサイドパネル、Meet の議事録、Slides の画像生成、Gemini アプリ、Gemini Notebook といった**アプリ内機能だけ**で、外部アプリ開発者向けの API アクセスへの言及はない。

Workspace のプラン料金（公式価格ページ・日本円、ユーザーあたり月額）:

| プラン            | 月額/ユーザー | AI に関する記載                                                                                                                                      |
| ----------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Business Starter  | ¥800          | 「Gmail の Gemini AI アシスタント」「Gemini アプリでの AI チャット」                                                                                 |
| Business Standard | ¥1,600        | 「Gmail、ドキュメント、Meet などの Gemini AI アシスタント」「複雑なタスク向けの Google の最も高性能な AI モデル」「Gemini Notebook（拡張アクセス）」 |
| Business Plus     | ¥2,500        | Standard と同等の Workspace 内 Gemini ＋ Gemini アプリの拡張アクセス                                                                                 |
| Enterprise        | 要問い合わせ  | 上記＋全 AI ツール／モデルへの拡張アクセス、Drive の AI 分類など                                                                                     |

いずれも**アプリ内機能**の話であり、料金表に API クォータやトークン枠の記載はない。

なお 2025 年 1 月に、それまで別売りだった **Gemini Business / Gemini Enterprise アドオンが Workspace の基本プランへ統合**された。この経緯はユーザーの認識どおりで公式ドキュメントで確認できるが、統合されたのは**アプリ内機能**であって API アクセスではない。

### では何が必要か

自社アプリから Gemini を呼ぶには、Workspace とは**別に**次のどちらかを契約する:

|                | Gemini Developer API（旧 Google AI Studio）      | Vertex AI / Gemini Enterprise Agent Platform                 |
| -------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| エンドポイント | `generativelanguage.googleapis.com`              | `aiplatform.googleapis.com`                                  |
| 始め方         | Google アカウント＋ API キー                     | GCP プロジェクト＋サービスアカウント＋ IAM                   |
| 課金           | Cloud Billing アカウントをリンクして従量課金     | Cloud Billing 必須・従量課金                                 |
| リージョン指定 | **不可**（処理リージョンを制御する仕組みがない） | 可（東京 `asia-northeast1` / 大阪 `asia-northeast2` を含む） |
| 向き           | 個人〜小規模                                     | エンタープライズ（監査ログ・IAM が要る場合）                 |

**どちらも Workspace の料金とは別建て**で、Workspace を契約していても API 側に割引や無料枠は付かない。

> 補足: Vertex AI は 2026 年に **Gemini Enterprise Agent Platform** へ改称された。Google の Apps Script 公式ドキュメントも「the Agent Platform API (formerly the Vertex AI API)」と表記している。

### Apps Script 経由という選択肢について

**正式サポートはある。** Apps Script には公式の Advanced Service として「Vertex AI service」が用意されており、Gemini を呼べる。ただしセットアップ要件は次のとおりで、**結局 GCP プロジェクトと Cloud Billing が必要＝課金は同じく別建て**になる。

1. Cloud Billing が有効な Google Cloud プロジェクト
2. Cloud Console で Agent Platform API（旧 Vertex AI API）を有効化
3. Apps Script 側で Vertex AI Advanced Service を ON

つまり「Workspace 契約の範囲で無料で使える裏口」ではない。加えて NEST に組み込む手段としては次の実務的な難点がある:

- **ストリーミング応答が扱えない見込み**（Apps Script は同期 HTTP リクエストベース。②の講評下書きは「書かれていく」見え方が講師の体感待ち時間に効く）
- Apps Script 自体の実行時間クォータの制約を受ける
- NEST の認証・RLS の外側に処理が出るため、生徒データの持ち出し経路が一本増える
- TypeScript の型が効かず、NEST 本体のコードベースから分断される

**Apps Script は採らない**ほうがよい。

---

## 3. 選択肢の比較表

|                                                  | 提供元       | 呼び出し方                                | 代表モデルと価格（USD / 100万トークン, 入力→出力）                                                                                        | データの扱い                                                                                | 実装のしやすさ                                                 |
| ------------------------------------------------ | ------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Claude API**                                   | Anthropic    | `api.anthropic.com` / `@anthropic-ai/sdk` | Haiku 4.5 = $1 → $5<br>Sonnet 5 = $2 → $10<br>Opus 5 = $5 → $25                                                                           | **既定で会話内容を保存しない**。学習利用なし。ZDR 契約も可                                  | ◎ 公式 TS SDK。Edge Runtime 対応明記。`@ai-sdk/anthropic` あり |
| **Gemini Developer API**                         | Google       | AI Studio の API キー                     | 2.5 Flash-Lite = $0.10 → $0.40<br>3.1 Flash-Lite = $0.25 → $1.50<br>3.7 Flash = $0.75 → $3.75（2026-12-31 まで）<br>2.5 Pro = $1.25 → $10 | **有料枠は学習に使わない**（無料枠は使われる）。ログ既定 55 日保持（7/14/28/55 日に変更可） | ○ 公式 TS SDK は `@google/genai`。`@ai-sdk/google` あり        |
| **Vertex AI / Gemini Enterprise Agent Platform** | Google Cloud | GCP プロジェクト＋サービスアカウント      | Gemini 同等（§8 参照）                                                                                                                    | 学習利用なし。リージョン指定・IAM・監査ログあり                                             | △ GCP の IAM 設定とサービスアカウント鍵の管理が増える          |
| **OpenAI API**                                   | OpenAI       | `api.openai.com` / `openai` npm           | gpt-5-nano = $0.05 → $0.40<br>gpt-5-mini = $0.25 → $2.00<br>gpt-5.6-luna = $0.20 → $1.20<br>gpt-5.4 = $2.50 → $15                         | **既定で学習に使わない**。ただし不正利用監視のため**既定 30 日保持**。ZDR は要事前承認      | ◎ 公式 TS SDK。`@ai-sdk/openai` あり                           |
| **Workspace の Gemini**                          | Google       | —                                         | —                                                                                                                                         | —                                                                                           | **自社アプリからは呼べない**（§2）                             |

価格はいずれも標準ティア。バッチ処理は Claude / Gemini とも 50% 引き。

---

## 4. 月額コスト試算

### 4.1 前提に置いたトークン数

| ユースケース         |  入力 | 出力 | 頻度             | 月間コール数 |   月間入力 |    月間出力 |
| -------------------- | ----: | ---: | ---------------- | -----------: | ---------: | ----------: |
| ① 今日やること要約   | 2,000 |  200 | 10 教室 × 30 日  |          300 |     0.60 M |      0.06 M |
| ② 報告書の講評下書き | 1,500 |  300 | 80 件/日 × 25 日 |        2,000 |     3.00 M |      0.60 M |
| ③ 保護者チャット返信 | 1,000 |  300 | 10 件/日 × 25 日 |          250 |     0.25 M |     0.075 M |
| **合計**             |       |      |                  |    **2,550** | **3.85 M** | **0.735 M** |

### 4.2 モデル別の月額（合計）

| 区分 | モデル                | 入力 $/M | 出力 $/M | 月額 USD | **月額 円** |
| ---- | --------------------- | -------: | -------: | -------: | ----------: |
| 安い | GPT gpt-5-nano        |     0.05 |     0.40 |    $0.49 |     **¥73** |
| 安い | Gemini 2.5 Flash-Lite |     0.10 |     0.40 |    $0.68 |    **¥102** |
| 安い | GPT gpt-5.6-luna      |     0.20 |     1.20 |    $1.65 |    **¥248** |
| 安い | Gemini 3.1 Flash-Lite |     0.25 |     1.50 |    $2.07 |    **¥310** |
| 安い | GPT gpt-5-mini        |     0.25 |     2.00 |    $2.43 |    **¥365** |
| 中   | Gemini 3.5 Flash-Lite |     0.30 |     2.50 |    $2.99 |    **¥449** |
| 中   | Gemini 3.7 Flash      |     0.75 |     3.75 |    $5.64 |    **¥847** |
| 中   | **Claude Haiku 4.5**  |     1.00 |     5.00 |    $7.53 |  **¥1,129** |
| 高   | Gemini 2.5 Pro        |     1.25 |    10.00 |   $12.16 |  **¥1,824** |
| 高   | **Claude Sonnet 5**   |     2.00 |    10.00 |   $15.05 |  **¥2,258** |
| 高   | GPT gpt-5.6-terra     |     2.00 |    12.00 |   $16.52 |  **¥2,478** |
| 高   | GPT gpt-5.4           |     2.50 |    15.00 |   $20.65 |  **¥3,098** |

### 4.3 ユースケース別の内訳（代表 5 モデル・円/月）

| モデル                | ① 今日やること | ② 報告書講評 | ③ チャット返信 |       合計 |
| --------------------- | -------------: | -----------: | -------------: | ---------: |
| Gemini 2.5 Flash-Lite |            ¥13 |          ¥81 |             ¥8 |   **¥102** |
| GPT gpt-5-mini        |            ¥41 |         ¥293 |            ¥32 |   **¥365** |
| Gemini 3.7 Flash      |           ¥101 |         ¥675 |            ¥70 |   **¥847** |
| Claude Haiku 4.5      |           ¥135 |         ¥900 |            ¥94 | **¥1,129** |
| Claude Sonnet 5       |           ¥270 |       ¥1,800 |           ¥188 | **¥2,258** |

### 4.4 この試算から読み取れること

**コストは意思決定材料にならない。** 最安（¥73）と最高性能クラス（¥3,098）の差は月 ¥3,000 で、講師 1 名の 2 時間分の人件費にも満たない。**「安いから Flash-Lite」ではなく「講師が手直しせずに済む品質か」で選ぶべき**で、品質が低くて講師が全文書き直すなら月 ¥3,000 の節約は完全に逆ざやになる。

さらに下げる余地（必要なら）:

- **プロンプトキャッシュ**: 3 ユースケースとも system prompt（塾の方針・文体ルール・出力フォーマット）が共通で長くなる。Claude のキャッシュ読み出しは基本入力の 0.1 倍なので、入力側が実質 1/10 近くまで落ちる。②の 2,000 コール/月なら効果が大きい。
- **バッチ API（50% 引き）**: ①「今日やること要約」は夜間に一括生成しても成立するのでバッチ向き。②③は対話的なので不可。

**上振れ要因**（試算より高く出る方向）:

- **日本語はトークン効率が悪い**。「入力 1,500 トークン」の前提が実際は 2,000〜2,500 になりうる。**1.5 倍**を見ておくと安全（それでも最高クラスで月 ¥4,600 程度）。
- **Claude Sonnet 5 は新しいトークナイザ**を使っており、同じ文章で約 30% 多くトークンが出ると公式に明記されている（Haiku 4.5 は旧トークナイザ）。Sonnet 5 の実額は **¥2,900 前後**を見ておく。
- **Gemini 3.7 / 3.6 Flash は 2027-01-01 に価格が倍**（$0.75/$3.75 → $1.50/$7.50）になると公式に告知済み。3.7 Flash の ¥847 は 2026-12-31 までの導入価格で、2027 年からは **¥1,693**。

**レート制限は問題にならない**: Anthropic の最下位（Start）ティアでも 1,000 RPM / 入力 200 万 TPM / 出力 40 万 TPM。想定 2,550 コール/月はまったく届かない。

---

## 5. データの扱い・個人情報の論点

### 5.1 各社の既定の扱い（公式記載）

| 提供元                          | 学習利用                                                                                                                                                                                               | 既定の保持                                                                                                  | ゼロデータ保持                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Anthropic**                   | 「Retained data is never used for model training without your express permission」                                                                                                                     | **会話内容（プロンプトと出力）は既定で保持しない**。例外は Covered Models（Fable 5 / Mythos 5）で 30 日保持 | ZDR あり。営業窓口経由で組織単位に有効化       |
| **OpenAI**                      | 「Data sent to the OpenAI API is not used to train or improve OpenAI models (unless you explicitly opt in)」                                                                                           | **不正利用監視ログを既定 30 日**保持                                                                        | ZDR あり。ただし事前承認と追加条件の受諾が必要 |
| **Google（Gemini API 有料枠）** | 「Google doesn't use your prompts ... or responses to improve our products」                                                                                                                           | **ログを既定で最大 55 日**保持。AI Studio 設定で 7 / 14 / 28 / 55 日に変更可                                | 未確認                                         |
| **Google（Gemini API 無料枠）** | 「Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services and machine learning technologies」＝**学習に使われる** | 同上                                                                                                        | —                                              |

読み取り:

- **Anthropic だけが「既定で会話内容を保存しない」**。OpenAI は既定 30 日、Google は既定 55 日（7 日まで短縮可）。保護者への説明や委託先監督の観点では、追加交渉なしで最初から保存されない構成がいちばん軽い。
- **Gemini API の無料枠は入力が学習に使われる**と利用規約に明記されている。試作段階でうっかり無料キーに生徒データを流すのは事故なので、**Gemini を使うなら最初から有料枠で始めること**。

### 5.2 日本の個人情報保護法まわり

NEST が AI 提供元へ生徒の氏名・成績・出欠を送る行為は、**「個人データの取扱いの委託」**（法27条5項1号）として整理するのが自然で、その場合は第三者提供の同意は不要になる。ただし提供元が外国事業者なので、**法28条（外国にある第三者への提供）**と、安全管理措置の一環としての**「外的環境の把握」**が論点になる。個人情報保護委員会も生成 AI サービスの利用について注意喚起を出している。実務上の要点は 3 つ:

1. **利用目的の範囲内か** — 「授業報告書の作成補助」「保護者対応の補助」が現行のプライバシーポリシーの利用目的に読み込めるか確認する。読み込めないなら利用目的を追記する。
2. **入力データが機械学習に利用されないことの確認** — §5.1 のとおり、有料枠であれば主要 3 社とも学習利用しない旨を公表している。この確認記録（規約の該当箇所と確認日）を残す。
3. **委託先としての監督** — 各社の Commercial Terms / DPA により日本法相当の水準が担保されるようにする。

**リージョンについて**: Vertex AI なら東京リージョン（`asia-northeast1`）を指定して推論を国内で走らせられる。ただし Google が**契約上保証するデータレジデンシー（DRZ）コミットメントは米国・EU のみ**とされており、日本はその正式保証の対象外という整理になる（§8 の未確認項目。国内処理を要件にするなら要一次確認）。Gemini Developer API にはそもそもリージョン制御の仕組みがない。Claude API は既定でグローバルルーティング、`inference_geo: "us"` で米国限定にできる（1.1 倍課金）が、日本限定の選択肢はない。

つまり**「国内処理」を厳密に求めるなら選択肢は Vertex AI の東京リージョンだけ**だが、契約上の保証までは付かない。現状の NEST は Supabase（東京リージョン・米国法人）・Vercel（米国）・Resend（米国）・Slack（米国）をすでに委託先として使っており、AI 提供元だけ国内処理を必須にする合理性は薄い。**委託として整理し、ポリシーに明記する**方針で足りる。

### 5.3 NEST 側で必要になる実務対応

`docs/legal/privacy-policy.md` 第5条の**委託先一覧に AI 提供元を追記する必要がある**。現状の表は Supabase / Vercel / LINEヤフー / Resend / Google LLC / Slack / Notta の 7 社。ここに 1 行足す:

```
| Anthropic PBC | 米国 | 授業報告書の講評案・返信案の生成補助（入力内容は学習に利用されず、既定で保存されません） |
```

同ファイル末尾のチェックリストにも「第5条の委託先一覧が、公開時点で実際に利用しているサービスと一致しているか」という項目があり、これに引っかかる。**公開前に必ず更新すること。**

あわせて `help/page.tsx` の FAQ_DATA にも「AI の下書きは誰が書いているのか」「保護者に見せる前に確認が要るのか」を追記する（機能変更時のヘルプ更新ルール）。

### 5.4 仮名化はすべきか

**結論: ②では氏名を送らない。ただし全体を通す仮名化パイプラインは作らない。**

- **① 今日やること要約** — 生徒名を出さないと要約の意味が薄い（「田中さんの振替確認」）。ただし**姓のみ**で足りる。学年・成績は不要なので送らない。
- **② 報告書の講評下書き（本命）** — 実は**氏名は要らない**。単元・達成度・テスト結果と、「学年」「呼称（さん/くん）」があれば講評は書ける。**氏名を送らずに生成し、講師が確認する画面で氏名を差し込む**設計にすれば、外部に出る個人情報を大幅に減らせる。実装コストもほぼゼロ。**全体の 78%（2,000 / 2,550 コール）を占めるユースケースなので、ここだけ対処すれば効果が大きい。**
- **③ 保護者チャット返信** — 保護者の文面をそのまま渡す必要があり、氏名が混ざるのは避けられない。ここは仮名化を諦め、委託として整理する。

**送ってはいけないもの**（どのユースケースでも）: 生徒・保護者の住所、電話番号、メールアドレス、LINE のユーザー ID、支払い情報。プロンプト組み立て関数の側で、渡すフィールドを**ホワイトリストで明示的に列挙**する（`select('*')` の結果をそのまま流さない）。

---

## 6. 推奨構成

### 6.1 構成

```
Next.js Route Handler (/api/ai/*)   ← 認証必須・教室スコープ検証
  └─ Vercel AI SDK v7 (ai + @ai-sdk/anthropic)
       └─ Claude API
            ├─ Claude Haiku 4.5   … ①今日やること要約 / ②報告書の講評下書き
            └─ Claude Sonnet 5    … ③保護者チャット返信 / ②の「提出前チェック」
```

- **鍵は Vercel の環境変数**（`ANTHROPIC_API_KEY`）に置き、**サーバー側の Route Handler からのみ呼ぶ**。クライアントから直接 API を叩かない（既存の `fetchWithAuth` / `getApiAuth` の作法に合わせる）。
- ストリーミングは AI SDK の `streamText`、クライアントは `@ai-sdk/react` の `useChat`。②の講評は「書かれていく」見え方があると講師の待ち時間の体感が大きく変わる。

### 6.2 なぜ Claude を推すか

1. **データの扱いがいちばん軽い** — 既定で会話内容を保存しない。ZDR の交渉も、30 日／55 日保持の説明も要らない。生徒データを扱う塾システムでは、これが最大の差。
2. **コスト差が無視できる** — Haiku 4.5 で月 ¥1,129。Gemini Flash-Lite との差は月 ¥1,000。この差で判断する理由がない。
3. **日本語の講評文の質が直接効く** — ②③は「保護者に見せる日本語の文章」なので、文体の自然さがそのまま講師の手直し時間になる。まず Haiku 4.5 で試し、足りなければ Sonnet 5 に上げる（月 ¥2,300 で済む）。
4. **Workspace 経由が使えない以上、Google を選ぶ理由が消える** — 「すでに払っているから安い」が成立しないなら、Gemini は「別契約の外部 API」として Anthropic / OpenAI と同列になる。それなら 1 の差が効く。

### 6.3 Vercel AI SDK を挟む理由 / AI Gateway は要るか

**AI SDK は挟む。** 直接 `@anthropic-ai/sdk` を使ってもよいが、AI SDK ならプロバイダの差し替えが実質 1 行（`anthropic('claude-haiku-4-5')` → `google('gemini-3.7-flash')`）。本件は「どのモデルが日本語の講評に向くか」を実際に走らせて比べたい性質のタスクなので、**比較のしやすさそのものが価値**になる。現行は `ai` v7 系。

**AI Gateway は当面は不要、ただし選択肢として有力。** 公式ドキュメントに「AI Gateway charges no markup and no platform fee on tokens. You pay the provider's list price」と明記されており、**トークン単価はプロバイダ直と同額**。BYOK も可能。得られるものは:

- 単一エンドポイント／単一キーで多数モデルにアクセス（比較検証がさらに楽）
- プロバイダ障害時の自動フェイルオーバー、プロバイダ別タイムアウト設定
- 支出監視・トレースなどの可観測性
- 既定でプロンプト／出力をログしない。ZDR オプションもあり（リクエスト単位の ZDR は無料）

月 2,550 コールの規模でフェイルオーバーや可観測性が要るかというと、**最初は要らない**。ただし「複数モデルを実際に比べたい」フェーズでは Gateway 経由のほうが手数が少ないので、**検証期間だけ Gateway、本番は直接**という使い分けも合理的。マークアップがない以上、どちらを選んでもコスト試算は変わらない。

### 6.4 段階的な進め方

1. **②の報告書講評だけ**で始める。いちばんボリュームが大きく（全体の 78%）、効果が見えやすく、氏名を落とせるので個人情報リスクも最小。
2. 内部フラグ（admin 限定）で数週間回し、**講師が採用した割合／手直し量**を測る。ここで質が出なければ、モデルを上げるかプロンプトを直す。
3. 質が出たら①③へ広げる。同時にプライバシーポリシーの委託先一覧とヘルプ FAQ を更新して公開する。
4. **月次の使用量アラート**を入れておく（想定 2,550 コール/月。桁が違ったらループかリトライ暴走を疑う）。

### 6.5 実装上の注意

- **Vercel の Function 実行時間**は Hobby / Pro とも既定 300 秒（Pro は最大 800 秒まで拡張可）。短文生成なら余裕だが、Route Handler に `export const maxDuration = ...` を明示しておく。
- **リトライとフォールバック**: 429 / 5xx は指数バックオフで 2 回まで再試行し、それでも駄目なら「AI 下書きは今回使えません」と出して**講師が手書きできる状態に必ず戻す**。AI が落ちても業務が止まらないことが最優先。
- **プロンプトは DB ではなくコードに置く**（バージョン管理して差分を追えるようにする）。文体ルールの調整は必ず何度も発生する。
- **出力は必ず「下書き」として提示し、講師の確認・編集を経てから保存する**。AI の出力がそのまま保護者に届く経路は作らない。
- Google を試す場合、**SDK は `@google/genai`**。旧 `@google/generative-ai` は 2025-11-30 に非推奨化済みなので使わない。

---

## 7. 参照した一次情報

### 価格

- Gemini API 価格（公式）: https://ai.google.dev/gemini-api/docs/pricing
- Claude API 価格（公式）: https://platform.claude.com/docs/en/about-claude/pricing
- OpenAI API 価格（公式）: https://developers.openai.com/api/docs/pricing
- Google Workspace 料金（公式・日本）: https://workspace.google.com/pricing
- Vercel AI Gateway 価格（公式）: https://vercel.com/docs/ai-gateway/pricing

### Workspace と Gemini の関係

- Google Workspace with Gemini（管理者向け公式）: https://knowledge.workspace.google.com/admin/generative-ai/workspace-with-gemini/google-workspace-with-gemini
- Gemini AI features now included in Workspace subscriptions（2025-01 の統合・公式）: https://knowledge.workspace.google.com/admin/gemini/gemini-ai-features-now-included-in-google-workspace-subscriptions
- AI Expanded Access アドオンの比較（公式）: https://knowledge.workspace.google.com/admin/getting-started/editions/compare-google-ai-expansion-add-ons
- Gemini API の課金設定（公式）: https://ai.google.dev/gemini-api/docs/billing
- Apps Script の Vertex AI service（公式）: https://developers.google.com/apps-script/advanced/vertex-ai
- Vertex AI のロケーション一覧（公式）: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations
- Gemini API 利用可能地域（公式）: https://ai.google.dev/gemini-api/docs/available-regions

### データの扱い

- Anthropic「API and data retention」（公式）: https://platform.claude.com/docs/en/manage-claude/api-and-data-retention
- Anthropic 商用データ保持ポリシー: https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data
- OpenAI「Data controls in the OpenAI platform」（公式）: https://developers.openai.com/api/docs/guides/your-data
- OpenAI Enterprise privacy: https://openai.com/enterprise-privacy/
- Gemini API 利用規約（無料枠／有料枠のデータ利用・公式）: https://ai.google.dev/gemini-api/terms
- Gemini API ログ保持ポリシー（公式）: https://ai.google.dev/gemini-api/docs/logs-policy
- Vercel AI Gateway のセキュリティ／コンプライアンス（公式）: https://vercel.com/docs/ai-gateway/security-and-compliance
- 個人情報保護委員会「生成AIサービスの利用に関する注意喚起等について」: https://www.ppc.go.jp/news/careful_information/230602_AI_utilize_alert/

### 実装・運用

- Vercel AI SDK ドキュメント: https://ai-sdk.dev/docs/introduction
- AI SDK × Next.js App Router: https://ai-sdk.dev/docs/getting-started/nextjs-app-router
- Vercel AI Gateway GA アナウンス: https://vercel.com/changelog/ai-gateway-is-now-generally-available
- Anthropic レート制限（公式）: https://platform.claude.com/docs/en/api/rate-limits
- OpenAI レート制限（公式）: https://developers.openai.com/api/docs/guides/rate-limits
- Vercel Function の実行時間（公式）: https://vercel.com/docs/functions/configuring-functions/duration
- Gemini API のクライアントライブラリ（公式・`@google/genai`）: https://ai.google.dev/gemini-api/docs/libraries
- 旧 `@google/generative-ai` の非推奨告知: https://github.com/google-gemini/deprecated-generative-ai-js

---

## 8. 未確認の項目

一次情報で確定できなかったものを正直に列挙する。**Gemini / Vertex AI を採用する場合は、これらを先に潰すこと。**

- **Vertex AI（Gemini Enterprise Agent Platform）のモデル別トークン単価**が Gemini Developer API と同一かどうか。公式価格ページが改称に伴うリダイレクトで取得できなかった。本書の Gemini 価格はすべて Gemini Developer API のもの。
- **Vertex AI のデータレジデンシー保証が米国・EU のみ**という点。複数の独立した情報源で一貫しているが、該当ページが JavaScript 描画のため一次ページの直接確認が取れていない。日本国内処理を要件にするなら、ブラウザで直接確認すること。
- **Gemini API の不正利用監視専用ログ**の保持日数と無効化可否。プロジェクトログ（55 日、変更可）とは別に存在することは公式に明記されているが、日数の記載がない。
- **Gemini Developer API に ZDR 相当のオプションがあるか。**
- **Gemini 3.1 Pro Preview の価格**。公式価格ページでプレビュー扱いのため GA 価格として扱わなかった。本試算では GA の Gemini 2.5 Pro / 3.7 Flash を使用。
- **Workspace の USD 建て正式価格**。取得環境の地域判定により日本円表示しか取れなかった（本書は日本円で記載しているので実害はない）。
- **Apps Script Vertex AI service のクォータ・実行時間上限・ストリーミング対応可否**の明文記載。§2 の記述は Apps Script 一般の制約からの推定を含む。
- **Vercel AI Gateway の無料クレジット額**。公式ドキュメントに金額の明記が見つからなかった。
- **OpenAI のティア別・モデル別 RPM/TPM の具体値**。現行の公式ページに数値表がなく、ダッシュボード（要ログイン）参照となっている。
