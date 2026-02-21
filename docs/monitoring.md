# 監視・アラート運用ガイド

## ログの確認方法

### Vercel ダッシュボード
1. Vercel → プロジェクト → Logs タブ
2. フィルタ: `AUTH_FAILURE` で認証失敗を検索
3. フィルタ: `SCOPE_VIOLATION` でIDOR試行を検索
4. フィルタ: `500` でサーバーエラーを検索

### Supabase ダッシュボード
1. Supabase → Logs → Postgres Logs
2. RLSで弾かれたクエリが記録される

## 異常の兆候
- 短時間に同一IPから AUTH_FAILURE が多発 → 不正アクセス試行
- SCOPE_VIOLATION の頻発 → IDOR攻撃
- 500エラーの急増 → システム障害

## 対応
- 緊急時: Supabase Dashboard → Authentication → Ban User
- API Key 漏洩疑い: Supabase Dashboard → Settings → API → Rotate Keys
