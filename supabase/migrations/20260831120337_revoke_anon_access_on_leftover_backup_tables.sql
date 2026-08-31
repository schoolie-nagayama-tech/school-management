-- ============================================================
-- 本番適用済み（2026-08-31 / MCP apply_migration 経由）。db push で再適用しないこと。
-- ============================================================
-- 2026-08-31 の品質診断で発見: 臨時に作ったバックアップ表3つが RLS 無効のまま public に置かれ、
-- anon / authenticated に SELECT/INSERT/UPDATE/DELETE/TRUNCATE が付いていた。
-- ＝クライアントJSに埋め込まれた公開キーを持つ誰でも、中身を読め・改竄でき・TRUNCATE で消せる状態。
--
-- 原因は設計ミスではなく運用の抜け。Supabase は public スキーマの新規テーブルに既定で
-- anon/authenticated への GRANT を付けるため、RLS を有効化しない臨時テーブルは自動的に全公開になる。
-- 恒久テーブルの RLS 設計自体は正しく、匿名で読める面は公開情報のみで個人情報の露出はゼロだった。
--
-- 表そのものの削除（DROP）はしない。役目が終わっているかの判断は別途行う。
-- ============================================================

revoke all on table public._koushu_progress_backup_20260626 from anon, authenticated;
revoke all on table public._seasonal_proposal_applied_koma_backup_20260626 from anon, authenticated;
revoke all on table public._koushu_applied_fix_backup_20260804 from anon, authenticated;

-- revoke だけだと、将来 GRANT を戻す操作をした瞬間に再び全公開に戻る。
-- ポリシーを1本も作らずに RLS を有効化しておくことで、service role 以外からは実質不可視になる（二重の防御）。
alter table public._koushu_progress_backup_20260626 enable row level security;
alter table public._seasonal_proposal_applied_koma_backup_20260626 enable row level security;
alter table public._koushu_applied_fix_backup_20260804 enable row level security;
