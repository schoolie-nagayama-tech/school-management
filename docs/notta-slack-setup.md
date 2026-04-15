# Notta × Slack 連携セットアップ

Notta が各教室の Slack チャネルに自動投稿する AI 要約を、Slack Events API 経由で本アプリに自動取り込みする。

## 1. 全体像

```
Notta (録音) → 各教室の Slack チャネルに AI 要約を自動投稿
    ↓ Events API (message.channels)
本アプリ /api/webhooks/slack/notta
    ↓ channel_id → school_id を解決
    ↓ メッセージをパース（タイトル/日時/長さ/AI Notes）
notta_transcripts テーブルに INSERT
    ↓
/transcriptions で手動で生徒に紐付け
```

## 2. 環境変数

`.env.local`（本番は Vercel）に追加:

```
SLACK_SIGNING_SECRET=<Slack App "Basic Information" → Signing Secret>
```

## 3. 教室とチャネルのマッピング

`schools.slack_channel_id` にチャネルIDを入れる。チャネルIDは Slack でチャネル名を
右クリック →「リンクをコピー」で末尾に現れる `C0XXXXXX` 形式。

```sql
UPDATE schools SET slack_channel_id = 'C0XXXXXXX' WHERE id = 'd187f7a3-633a-46ce-8d32-c56c85d17bac'; -- 永山
UPDATE schools SET slack_channel_id = 'C0YYYYYYY' WHERE id = '9f519794-3673-4e90-b1ea-88a79f70174a'; -- 堀之内
UPDATE schools SET slack_channel_id = 'C0ZZZZZZZ' WHERE id = '9a6b5996-a266-47ed-878f-85e93c2b8b90'; -- 緑園都市
UPDATE schools SET slack_channel_id = 'C0WWWWWWW' WHERE id = 'e26b398c-8e30-47bc-b528-ee92fd45be7f'; -- 清瀬
```

## 4. Slack App 設定

1. https://api.slack.com/apps → **Create New App** → From scratch
2. **Basic Information** → **Signing Secret** をコピーして `SLACK_SIGNING_SECRET` に設定
3. **OAuth & Permissions** → Bot Token Scopes に以下を追加:
   - `channels:history` (public channels)
   - `groups:history` (private channels — 必要に応じて)
4. ワークスペースに **Install App**
5. Notta が投稿する各チャネルで `/invite @<Bot名>` を実行してアプリを招待
6. **Event Subscriptions** を ON
   - **Request URL**: `https://<YOUR-DOMAIN>/api/webhooks/slack/notta`
   - Slack が challenge を送信 → 200 で自動検証通過
   - **Subscribe to bot events** に以下を追加:
     - `message.channels` (public)
     - `message.groups` (private — 必要に応じて)
7. 変更を保存

## 5. 動作確認

- Notta で短い録音を行い、Slack チャネルに投稿されるのを待つ
- 数秒以内に `/transcriptions` に未紐付けとして出現
- 出現しない場合:
  - Vercel / ローカルのログで `[slack-notta]` を確認
  - `slack_channel_id` が正しく設定されているか確認
  - Bot がチャネルに招待されているか確認
  - 投稿メッセージに「タイトル:」「AI Notes」のどちらかが含まれているか確認

## 6. メモ

- `external_id` は `slack:<ts>` 形式で保存するため、Slack が Retry しても重複挿入されない
- `NOTTA_WEBHOOK_SECRET` を使う旧 Zapier ルートも `/api/webhooks/notta` として併存可能
