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
--
-- ★ 存在チェックで包む理由:
--   これらは本番で手作業で作られた臨時表で、base_schema（本番dump）にも含まれていない。
--   ローカル/CI の db reset では存在しないため、素で書くと 42P01 で全体が落ちる
--   （実際に RLS Integration Tests がこれで失敗した）。本番だけに効けばよい記録なので、
--   存在するときだけ実行する。
-- ============================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'public._koushu_progress_backup_20260626',
    'public._seasonal_proposal_applied_koma_backup_20260626',
    'public._koushu_applied_fix_backup_20260804'
  ] loop
    if to_regclass(t) is not null then
      execute format('revoke all on table %s from anon, authenticated', t);
      -- revoke だけだと、将来 GRANT を戻す操作をした瞬間に再び全公開に戻る。
      -- ポリシーを1本も作らずに RLS を有効化しておくことで、service role 以外からは
      -- 実質不可視になる（二重の防御）。
      execute format('alter table %s enable row level security', t);
    end if;
  end loop;
end $$;
