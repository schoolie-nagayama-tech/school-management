-- schools に「面談予約URL（Googleカレンダーの予約ページ）」を追加する
--
-- 背景: 保護者ポータル v2 の面談希望（chat template_kind='meeting_request'）は
--   受付の自動返信を返すだけで、保護者は「教室からの折り返し待ち」になっていた。
--   教室ごとに Google カレンダーの予約ページ URL を持たせておけば、自動返信に
--   そのURLを載せて保護者にその場で予約してもらえる（往復が1回減る）。
--
-- なぜ教室（schools）に持たせるか: 予約ページは教室ごとに別物（担当・場所・枠が違う）。
--   システム全体で1本にすると別教室の枠を案内してしまう。
--
-- 空（NULL）は「未設定」＝自動返信にURLを載せない、が既定の挙動。
--   よって既存教室は何もしなくても今までどおり動く（後方互換）。
--
-- ロールバック:
--   ALTER TABLE public.schools DROP COLUMN IF EXISTS meeting_booking_url;

alter table public.schools
  add column if not exists meeting_booking_url text;

comment on column public.schools.meeting_booking_url is
  '面談予約用のGoogleカレンダー予約ページURL。保護者ポータルの面談希望に対する自動返信に載せる。NULL=未設定（URLを載せない）。';
