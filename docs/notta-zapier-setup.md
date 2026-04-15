# Notta × Zapier 連携セットアップ

Notta（AI文字起こしアプリ）で録音した面談・通話の文字起こしを、Zapier経由で本アプリに自動取り込みする手順。

## 1. 環境変数

`.env.local`（本番は Vercel の Environment Variables）に以下を追加：

```
NOTTA_WEBHOOK_SECRET=<ランダムな長い文字列。例: openssl rand -hex 32>
```

`SUPABASE_SERVICE_ROLE_KEY` と `NEXT_PUBLIC_SUPABASE_URL` は既存のものを利用。

## 2. マイグレーション適用

```
supabase db push
```
または Supabase ダッシュボードの SQL Editor で
`supabase/migrations/xxx_notta_transcripts.sql` を実行。

## 3. Zapier 側の Zap 設定

1. **Trigger**: Notta → "New Transcription" などのイベント
2. **Action**: "Webhooks by Zapier" → "POST"
   - **URL**: `https://<YOUR-DOMAIN>/api/webhooks/notta`
   - **Payload Type**: `json`
   - **Headers**:
     - `Authorization: Bearer <NOTTA_WEBHOOK_SECRET>`
     - `Content-Type: application/json`
   - **Data**:
     ```json
     {
       "school_id": "<教室UUID>",
       "external_id": "{{notta_record_id}}",
       "title": "{{title}}",
       "recorded_at": "{{created_at}}",
       "duration_seconds": "{{duration_seconds}}",
       "transcript": "{{transcript_text}}",
       "audio_url": "{{share_url}}"
     }
     ```

`school_id` は Supabase の `schools` テーブルで確認できる教室のUUIDを直接記述。

## 4. 動作確認

ローカルで:
```bash
curl -X POST http://localhost:3000/api/webhooks/notta \
  -H "Authorization: Bearer $NOTTA_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "school_id": "<教室UUID>",
    "title": "テスト録音",
    "transcript": "これはテスト文字起こしです。",
    "recorded_at": "2026-04-15T10:00:00Z",
    "duration_seconds": 120,
    "external_id": "test-001"
  }'
```

- 201 Created → OK
- 401 Unauthorized → トークン確認
- 409 Conflict → external_id が既に取り込み済み
- 400 → school_id 不正またはバリデーション失敗

## 5. UI で紐付け

`/transcriptions` を開くと未紐付けの文字起こし一覧が表示される。
「紐付け」ボタンから生徒を選択すると、`student_interviews` に面談記録が作成される。
