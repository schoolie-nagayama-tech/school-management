-- Notta文字起こしを問合せ(inquiries)にも紐づけられるようにする。
-- 生徒への linked_student_id と並列。入会(生徒登録)時にこの紐付けを
-- linkTranscriptToStudent へ引き継いで面談記録(student_interviews)化する。
alter table notta_transcripts
  add column if not exists linked_inquiry_id uuid references inquiries(id) on delete set null;

create index if not exists idx_notta_transcripts_linked_inquiry
  on notta_transcripts(linked_inquiry_id) where linked_inquiry_id is not null;

comment on column notta_transcripts.linked_inquiry_id is
  '問合せに紐付いた文字起こし（入会前）。入会で生徒登録時に生徒の面談記録へ引き継ぐ。';
