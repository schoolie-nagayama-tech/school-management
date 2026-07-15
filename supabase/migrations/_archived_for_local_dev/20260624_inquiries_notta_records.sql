-- 問合せに Notta の記録（文字起こし共有リンク）を複数紐づけられるようにする。
-- 各要素は { url, label, added_at } の JSON。RLS は inquiries 行のアクセス権に従う。
alter table inquiries
  add column if not exists notta_records jsonb not null default '[]'::jsonb;

comment on column inquiries.notta_records is
  'Nottaの記録リンク配列。要素: { url: string, label: string, added_at: ISO文字列 }';
