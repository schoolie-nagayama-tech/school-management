-- inquiry_contacts.method に「面談」(interview) を追加する。
-- 既存の CHECK 制約を張り替えるだけ（データ移行は不要）。
alter table inquiry_contacts drop constraint if exists inquiry_contacts_method_check;

alter table inquiry_contacts
  add constraint inquiry_contacts_method_check
  check (method = any (array[
    'tel', 'email', 'sms', 'visit', 'interview', 'other', 'material_sent', 'status_change'
  ]::text[]));
