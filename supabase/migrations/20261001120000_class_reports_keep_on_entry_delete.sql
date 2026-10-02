-- ============================================================
-- 授業の行を消しても報告書が黙って消えないようにする（2026-10-01）
-- ============================================================
--
-- ■ なぜ
--   class_reports.schedule_entry_id は schedule_entries への ON DELETE CASCADE だった。
--   座席表の週の再生成は対象週の通常授業を全削除→再INSERTしていたため、再生成のたびに
--   その週の報告書（承認済み＝保護者に公開済みのものも含む）が連鎖で消えていた。
--   再生成は座席表を開いた・通塾日程を保存しただけでも自動で走る。
--
--   アプリ側は再生成を差分反映に直し、報告書付きのコマを触らないようにした
--   （src/lib/schedule/weeklySync.ts）。ここはその最後の砦。アプリ側の判定に漏れがあっても
--   （RLS で報告書が見えない呼び出し元など）、報告書が黙って消える代わりに削除がエラーで止まる。
--
-- ■ RESTRICT ではなく NO ACTION にした理由
--   生徒の削除は students → schedule_entries と students → class_reports の両方が CASCADE。
--   NO ACTION は文の終わりで検査するので、同じ DELETE の中で両方が連鎖削除されれば通る
--   （＝生徒の削除はこれまでどおり報告書ごと消える）。RESTRICT は即時検査なので、
--   連鎖の順番しだいで生徒の削除が失敗し得る。
--
-- ■ 影響
--   - 報告書の付いた授業を物理削除しようとすると 23503 で失敗する。
--     物理削除の経路は 再生成（差分化済み）/ 振替の取り消し（事前チェック済み）/
--     講師の削除（class_reports.teacher_id がもともと RESTRICT なので、報告書を持つ講師は
--     以前から削除できない）の3つだけ。
--   - 授業の論理削除（status='cancelled'）は行を消さないので影響なし。
--
-- ■ 本番への適用: Supabase MCP の apply_migration（db push は使わない）。
-- ============================================================

alter table public.class_reports
  drop constraint if exists class_reports_schedule_entry_id_fkey;

alter table public.class_reports
  add constraint class_reports_schedule_entry_id_fkey
  foreign key (schedule_entry_id) references public.schedule_entries (id)
  on delete no action;
