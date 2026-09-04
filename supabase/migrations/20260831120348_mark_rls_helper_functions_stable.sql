-- ============================================================
-- 本番適用済み（2026-08-31 / MCP apply_migration 経由）。db push で再適用しないこと。
-- ============================================================
-- 2026-08-31 の品質診断で発見: RLS ヘルパー関数が VOLATILE（修飾なし）のまま定義されていた。
-- check_school_access は本番の 122 ポリシーから参照されている＝ほぼ全テーブルの読み取りに乗る。
--
-- VOLATILE 関数はプランナが結果を使い回せないため、スキャンした行ごとに関数本体が実行される。
-- 中身は user_profiles の PK 検索 ＋ user_schools の EXISTS なので、1行あたり2クエリが上乗せされる。
--
-- 3関数とも SELECT のみで DB を変更せず、1文の実行中に同じ引数なら同じ結果を返す。よって STABLE が
-- 意味的に正しい。ALTER FUNCTION は関数本体を触らないため、認可の判定結果は一切変わらない。
-- 適用後に teacher ロールで「自教室=true / 他教室=false / ロール判定」の回帰確認を実施済み。
--
-- 参考: 後から作られた portal_uid() は最初から STABLE + sql 言語で正しく定義されている。
--       新しく RLS ヘルパーを足すときは STABLE を必ず付けること。
--
-- 残作業: ポリシー内の裸の auth.uid() 39箇所を (select auth.uid()) に包むと、行ごとの再評価が
--         InitPlan に畳まれてさらに効く（Supabase advisor の auth_rls_initplan 警告48件）。
--
-- ★ 存在チェックで包む理由: ローカル/CI の db reset では base_schema の内容次第で
--   一部の関数が無いことがあり、素で ALTER すると 42883 で全体が落ちる。
-- ============================================================

do $$
declare
  sig text;
begin
  foreach sig in array array[
    'public.check_school_access(uuid)',
    'public.check_user_role(text[])',
    'public.check_student_access(uuid)'
  ] loop
    if to_regprocedure(sig) is not null then
      execute format('alter function %s stable', sig);
    end if;
  end loop;
end $$;
