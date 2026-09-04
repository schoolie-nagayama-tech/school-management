-- 目次（curriculum_items）を触ったら、その教材（textbooks）の updated_at を進める。
--
-- ★ なぜ必要か:
--   教材マスタ一覧に「更新日」を出すようにしたが、textbooks の既存トリガーは
--   textbooks 自身の UPDATE でしか発火しない。目次の単元を直しても更新日が動かず、
--   「直したのに更新日が古いまま」＝当てにならない表示になってしまう。
--   実運用で更新されるのは教材情報よりむしろ目次なので、こちらも拾う。
--
-- 行単位トリガーなので一括登録では単元数ぶん textbooks が更新されるが、
-- 対象は1行（同じ教材）で件数も教材1冊分なので許容範囲。

create or replace function public.bump_textbook_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.textbooks
     set updated_at = now()
   where id = coalesce(new.textbook_id, old.textbook_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists curriculum_items_bump_textbook_updated_at on public.curriculum_items;

create trigger curriculum_items_bump_textbook_updated_at
after insert or update or delete on public.curriculum_items
for each row execute function public.bump_textbook_updated_at();
