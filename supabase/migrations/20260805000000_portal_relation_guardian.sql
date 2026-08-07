-- ============================================================
-- 続柄(relation)を「保護者 / その他（自由入力）」の2択に整理する
--
-- 背景（2026-08-05 判断）:
--   父・母の区別は運用で使っておらず、保護者に選ばせる手間だけが残っていた。
--   実務は「保護者」で足り、それ以外（祖父母・親戚など）は自由入力で拾う。
--
-- ★ RLSへの影響なし:
--   ポータルの可視判定は relation = 'self' か否かだけを見ている
--   （20260714010000_portal_v2_chat_bulletin.sql の bulletin 可視ポリシー:
--    self → '生徒' 宛、self以外 → '保護者' 宛）。
--   father/mother を guardian に寄せても「self ではない＝保護者」は不変なので
--   ポリシーの書き換えは不要。
-- ============================================================

-- ★ 順序に注意: 先に制約を外してから UPDATE する。
--   旧制約は 'guardian' を許さないため、制約を残したまま UPDATE すると
--   その UPDATE 自体が 23514 で弾かれる（2026-08-05 に実際に踏んだ）。
alter table public.portal_account_students
drop constraint if exists portal_account_students_relation_check;

-- 既存の father / mother は guardian に寄せる（どちらも保護者であることに変わりはない）。
update public.portal_account_students
set relation = 'guardian'
where relation in ('father', 'mother');

-- 新しい許容値を貼り直す。インラインcheckの自動命名（<table>_<column>_check）を踏襲する。
alter table public.portal_account_students
add constraint portal_account_students_relation_check check (
  relation in ('self', 'guardian', 'other')
);

-- 「その他」を選んだときの続柄の自由入力（例: 祖母・叔父）。
-- 権限判定には一切使わない（表示・記録用）。relation='other' 以外では NULL。
alter table public.portal_account_students
add column if not exists relation_note text;

comment on column public.portal_account_students.relation_note is 'relation=''other'' のときの続柄の自由入力（例: 祖母）。表示・記録用で権限判定には使わない。それ以外は NULL。';

comment on column public.portal_account_students.relation as '本人(self)/保護者(guardian)/その他(other)。RLSは self か否かだけを見る。';
