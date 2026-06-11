-- ============================================================
-- 問合せ管理機能（ベータ版）
--
-- 目的:
--   本部HP（FC問合せシステム）で受け付けた問合せを本アプリに取り込み、
--   台帳・コンタクト履歴・追客メール・分析・発送を一元管理する。
--   現状はスプレッドシート + GAS で運用しており、その移管が目的。
--   正典: docs/inquiry-management-requirements.md (v3)
--
-- テーブル:
--   inquiries               問合せ台帳（1行=1問合せ）
--   inquiry_contacts        コンタクト履歴（1問合せに複数。架電・メール・来校の記録）
--   inquiry_school_settings 教室別設定（HP教室CD・メール署名・ヤマト発送情報・Slack）
--   inquiry_mail_templates  追客メールのテンプレ（差し込み変数つき）
--   inquiry_mail_logs       メール送信記録（重複送信防止・既送判定）
--
-- RLS:
--   全テーブル check_school_access(school_id) に統一（admin/owner/manager は全校、
--   teacher は user_schools 所属校のみ）。ベータ期間中の admin 限定は
--   アプリ層（requireAdmin / 設定カードの requiresAdmin）でゲートする。
--   未入会者の PII を含むため anon ポリシーは一切作らない。
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- inquiries: 問合せ台帳
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inquiries (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  -- HP問合せNO。CSV再取込時の upsert キー。手入力レコードは NULL
  hp_inquiry_no         text,
  inquired_at           timestamptz NOT NULL,          -- 受付日時
  -- 氏名（漢字・カナ）
  student_name          text,
  student_name_kana     text,
  guardian_name         text,
  guardian_name_kana    text,
  relationship          text,                          -- 生徒との関係性
  grade                 text,                          -- 学年（小1〜既卒。問合せ時点で固定）
  gender                text,                          -- 男 / 女 / 不明
  -- 連絡先（CSV値をそのまま保持。Excel都合の先頭0付与等の変換はしない）
  phone                 text,
  email                 text,
  -- 住所
  postal_code           text,
  address_pref          text,                          -- 都道府県
  address_detail        text,                          -- ご住所
  address_building      text,                          -- 建物名
  school_name           text,                          -- 在籍学校名
  -- 流入
  media                 text,                          -- 問合媒体（本部HP/塾ナビ/看板・外パンフ/友人紹介/兄弟姉妹/塾選/塾シル/チラシ/Ameba塾探し/直来/電話）
  channel               text,                          -- 問合手段（問合せ経路）
  request_type          text,                          -- 申込内容（資料請求/無料体験授業/学習相談・教室見学/講習/その他）
  device                text,                          -- デバイス（PC/SmartPhone。流入分析用）
  -- 内容
  initial_message       text,                          -- ご質問・ご要望（HP原文）
  purpose               text,                          -- 通塾目的
  preferred_subjects    text,                          -- 希望科目
  juku_experience       text,                          -- 通塾経験
  -- 進捗
  status                text NOT NULL DEFAULT 'in_progress'
                          CHECK (status IN ('in_progress','enrolled','unreachable','lost','trial_lost')),
  material_sent_at      date,                          -- 資送日
  trial_at              timestamptz,                   -- 体験日
  trial_teacher         text,                          -- 体験実施講師
  interview_at          timestamptz,                   -- 入面日
  enrolled_at           date,                          -- 入会日
  weekly_count          integer,                       -- 入会時週回数
  -- 紐付け・補助
  linked_student_id     uuid REFERENCES public.students(id) ON DELETE SET NULL,
  referrer_inquiry_note text,                          -- 紹介元メモ（友人紹介・兄弟姉妹の出所）
  raw_source            jsonb,                         -- 取込元の全項目（取りこぼし防止）
  note                  text,                          -- メモ
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz                    -- ソフトデリート
);

-- 同一教室内で HP問合せNO は一意（再取込の upsert キー。NULL=手入力は重複可）
CREATE UNIQUE INDEX IF NOT EXISTS uq_inquiries_school_hp_no
  ON public.inquiries (school_id, hp_inquiry_no)
  WHERE hp_inquiry_no IS NOT NULL;

-- 一覧は school×期間×ステータスで絞るため複合インデックス
CREATE INDEX IF NOT EXISTS idx_inquiries_school_inquired
  ON public.inquiries (school_id, inquired_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inquiries_status
  ON public.inquiries (status) WHERE deleted_at IS NULL;
-- 名寄せ・重複検出（電話/メール一致）用
CREATE INDEX IF NOT EXISTS idx_inquiries_phone ON public.inquiries (phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inquiries_email ON public.inquiries (email) WHERE email IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- inquiry_contacts: コンタクト履歴
--   現スプレッドシートの 1st/2nd/3rd 固定枠をやめ、無制限の履歴に正規化。
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inquiry_contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id   uuid NOT NULL REFERENCES public.inquiries(id) ON DELETE CASCADE,
  -- RLS を inquiry と独立に効かせるため school_id を非正規化で保持
  school_id    uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  contacted_at timestamptz NOT NULL DEFAULT now(),
  method       text NOT NULL DEFAULT 'tel' CHECK (method IN ('tel','email','sms','visit','other')),
  direction    text CHECK (direction IN ('outbound','inbound')),  -- 発信 / 受信
  result       text,                                  -- つながった / 不在 / 留守電 など
  note         text,                                  -- 反応メモ（現「1stct反応」相当）
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,  -- 対応者（成約分析用）
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inquiry_contacts_inquiry
  ON public.inquiry_contacts (inquiry_id, contacted_at DESC);

-- ────────────────────────────────────────────────────────────
-- inquiry_school_settings: 教室別設定
--   GAS にハードコードされていた教室情報を設定画面で編集可能にする。
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inquiry_school_settings (
  school_id            uuid PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,
  hp_school_code       text,                           -- HP教室CD（例: 5M13）。CSV取込のマッピング補助
  -- メール（件名・署名のみ教室別に差し替える方針）
  mail_signature       text,                           -- 署名ブロック
  mail_reply_to        text,                           -- 返信先（教室メール）
  -- ヤマトB2クラウド（ネコポス発送）ご依頼主情報
  yamato_customer_code text,                           -- 請求先顧客コード
  yamato_fare_code     text DEFAULT '01',              -- 運賃管理番号
  sender_tel           text,
  sender_zip           text,
  sender_address       text,
  sender_name          text,                           -- 例: スクールIE永山校
  slack_mention_id     text,                           -- Slack通知のメンション先
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- inquiry_mail_templates: 追客メールテンプレ
--   差し込み変数: {保護者} {生徒} {教室名} {教室電話} {署名}
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inquiry_mail_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid REFERENCES public.schools(id) ON DELETE CASCADE,  -- NULL=全教室共通
  name         text NOT NULL,                          -- 例: 初回問合せ
  subject      text NOT NULL DEFAULT '',
  body         text NOT NULL DEFAULT '',
  -- 問合せから N 日後に「本日の送信候補」として提示。NULL=手動専用（キャンペーン等）
  trigger_days integer,
  is_active    boolean NOT NULL DEFAULT true,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inquiry_mail_templates_school
  ON public.inquiry_mail_templates (school_id, sort_order);

-- ────────────────────────────────────────────────────────────
-- inquiry_mail_logs: メール送信記録
--   送信候補の既送判定・重複送信防止。method=sms も同枠で管理。
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inquiry_mail_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id  uuid NOT NULL REFERENCES public.inquiries(id) ON DELETE CASCADE,
  school_id   uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.inquiry_mail_templates(id) ON DELETE SET NULL,
  method      text NOT NULL DEFAULT 'email' CHECK (method IN ('email','sms')),
  subject     text,
  status      text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','failed')),
  sent_at     timestamptz NOT NULL DEFAULT now(),
  sent_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inquiry_mail_logs_inquiry
  ON public.inquiry_mail_logs (inquiry_id, sent_at DESC);

-- ────────────────────────────────────────────────────────────
-- updated_at 自動更新トリガ（既存の update_updated_at_column を流用）
-- ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS update_inquiries_updated_at ON public.inquiries;
CREATE TRIGGER update_inquiries_updated_at
  BEFORE UPDATE ON public.inquiries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_inquiry_school_settings_updated_at ON public.inquiry_school_settings;
CREATE TRIGGER update_inquiry_school_settings_updated_at
  BEFORE UPDATE ON public.inquiry_school_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_inquiry_mail_templates_updated_at ON public.inquiry_mail_templates;
CREATE TRIGGER update_inquiry_mail_templates_updated_at
  BEFORE UPDATE ON public.inquiry_mail_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ────────────────────────────────────────────────────────────
-- RLS（全テーブル check_school_access(school_id) に統一）
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.inquiries               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inquiry_contacts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inquiry_school_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inquiry_mail_templates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inquiry_mail_logs       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inquiries_school_scope_auth" ON public.inquiries;
CREATE POLICY "inquiries_school_scope_auth"
  ON public.inquiries FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "inquiry_contacts_school_scope_auth" ON public.inquiry_contacts;
CREATE POLICY "inquiry_contacts_school_scope_auth"
  ON public.inquiry_contacts FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "inquiry_school_settings_school_scope_auth" ON public.inquiry_school_settings;
CREATE POLICY "inquiry_school_settings_school_scope_auth"
  ON public.inquiry_school_settings FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

-- mail_templates は school_id NULL（全教室共通）を許容。
-- check_school_access(NULL) は admin/owner/manager で TRUE を返すため共通テンプレは
-- 管理者ロールが操作可。teacher は NULL 校テンプレを読めない（早期 return の手前で false）。
DROP POLICY IF EXISTS "inquiry_mail_templates_scope_auth" ON public.inquiry_mail_templates;
CREATE POLICY "inquiry_mail_templates_scope_auth"
  ON public.inquiry_mail_templates FOR ALL TO authenticated
  USING (school_id IS NULL OR public.check_school_access(school_id))
  WITH CHECK (school_id IS NULL OR public.check_school_access(school_id));

DROP POLICY IF EXISTS "inquiry_mail_logs_school_scope_auth" ON public.inquiry_mail_logs;
CREATE POLICY "inquiry_mail_logs_school_scope_auth"
  ON public.inquiry_mail_logs FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

-- ────────────────────────────────────────────────────────────
-- 教室別設定の初期行（既知の HP教室CD を投入。未知分は UI で補完）
--   永山=5M13 / 清瀬=5F72 は判明済み。他は NULL（設定画面で入力）。
--   school 名で参照し school_id はハードコードしない。
-- ────────────────────────────────────────────────────────────
INSERT INTO public.inquiry_school_settings (school_id, hp_school_code, sender_name)
SELECT s.id, v.code, 'スクールIE' || replace(s.name, '校', '') || '校'
FROM (VALUES ('永山校','5M13'), ('清瀬校','5F72')) AS v(name, code)
JOIN public.schools s ON s.name = v.name
ON CONFLICT (school_id) DO NOTHING;

COMMIT;
