# 問合せ管理機能 実装仕様（現状の正典）

最終更新: 2026-06-18
ステータス: ベータ稼働中（教室長以上に公開）

このドキュメントは「実装済みの全体像」を記録する正典。要件の経緯は
docs/inquiry-management-requirements.md (v3)、予約は docs/inquiry-booking-requirements.md。

---

## 1. 概要・目的

本部HP（FCの問合せ管理システム = tactgroup.net）で受け付けた問合せを本アプリ(NEST)に
取り込み、台帳・追客・分析・発送・予約を一元化する。元はスプレッドシート+GASで運用していた。
入会率41%・連絡不通35%が課題で、追客（リマインド・メール）の改善が主眼。

## 2. 公開範囲・入口

- **対象ロール: 教室長以上（manager / owner / admin）**。2026-06-18にadmin/ownerからmanagerまで拡大。
- 入口は2か所（ベータのためナビ本体には出さない）:
  - 設定ページ `/settings` の「問合せ管理（ベータ）」カード（requiresManager）
  - ヘッダーのギア(設定)ドロップダウン内、「教室長ダッシュボード(試作)」直下
- ルート: `/admin/inquiries` 配下。各ページは `isAdmin = role in {admin,owner,manager}` でガード。
  認証付きAPIは `requireManager`。
- 教室長は getApiAuth/getSelectedSchoolIds により担当校にスコープ（他機能と同じ）。

## 3. データモデル（テーブル）

すべて RLS = `check_school_access(school_id)`（admin/owner/manager全校、teacherは所属校）。
**未入会者PIIのため anon ポリシーは一切作らない。公開系は service role + トークン認可。**

### inquiries（問合せ台帳）
主要カラム: id, school_id, **hp_inquiry_no**(HP問合せNO・再取込upsertキー・手入力はnull),
inquired_at, student_name/kana, guardian_name/kana, relationship, grade(text "中2"等),
gender(男/女/不明), phone(変換なし), email, postal_code, address_pref/detail/building,
school_name, media, channel, request_type, device, initial_message, purpose,
preferred_subjects, juku_experience,
**status**, material_sent_at(date), trial_at, trial_teacher, interview_at, enrolled_at,
weekly_count, lost_reason, linked_student_id, referrer_inquiry_note, raw_source(jsonb),
note, **interview_event_id**(面談Googleカレンダー), trial_event_id(Phase2用), created_by,
created_at, updated_at, deleted_at(ソフトデリート)。

**status は7値（2026-06-18に5→7へ拡張。追客の段階を表す）**:
`in_progress`(対応中) → `trial_waiting`(体験待ち) → `trial_done`(体験済み) → `enrolled`(入会)、
失注: `unreachable`(連絡不通) / `lost`(没) / `trial_lost`(体験没)。
CHECK制約は 20260618_inquiry_status_trial_phases.sql。

### inquiry_contacts（コンタクト履歴 = 行動タイムライン）
inquiry_id, school_id, contacted_at, **method**, direction(outbound/inbound/null),
result, note, created_by。
method = tel/email/sms/visit/other/**material_sent(資料送付)**/**status_change(自動)**。
material_sent と status_change は 20260617 で追加。status_change は status変更時に
updateInquiryWithTimeline が自動 insert（日本語で「対応中 → 体験待ち」）。

### inquiry_school_settings（教室別設定・PK=school_id）
hp_school_code(HP教室CD例5M13), mail_signature, mail_reply_to,
yamato_customer_code, yamato_fare_code(既定01), sender_tel/zip/address/name,
slack_mention_id, **booking_config**(jsonb・予約設定)。
初期: 永山=5M13 / 清瀬=5F72 を投入済み。

### inquiry_mail_templates
school_id(null=全教室共通), name, subject, body, **trigger_days**(N日後=送信候補・null手動),
is_active, sort_order。差込変数 {保護者}{生徒}{教室名}{教室電話}{署名}。
スターター3件(初回/4日後/10日後)投入済み。

### inquiry_mail_logs
inquiry_id, school_id, template_id, method(email/sms), subject, status(sent/failed),
sent_at, sent_by, **resend_email_id**, **opened_at**, **clicked_at**(開封計測用)。

### inquiry_booking_tokens（公開予約トークン）
token(unique), inquiry_id, school_id, purpose(interview/trial), expires_at, used_at。

### inquiry_import_tokens（ブックマークレット取込トークン）
token(unique), label, created_by, revoked, last_used_at。RLSポリシー無し(service roleのみ)。

## 4. 取込（4経路）

1. **HPブックマークレット取込（主・推奨）** — `/admin/inquiries/connect` でトークン発行→
   javascript:ブックマークレットをブックマークバーに登録。本部HPの問合せ画面で1クリック→
   `POST tactgroup.net/contents/boshu/class/applicant/download.php`(body `btn_download=1`,
   PHPSESSID Cookie認証のみ, Shift_JIS CSV)を fetch→ NESTの
   `POST /api/inquiry-import/push?token=...`(text/plain, CORS *, トークン認可, service role)へ送信。
   問合せNOで重複自動スキップ。**教室ごとに1クリック**(今表示中の教室のCSVが返るため)。
2. **CSV取込** — `/admin/inquiries/import` で boshu_applicant_*.csv をアップロード。
3. **貼り付けて追加** — `/admin/inquiries/paste` でHP詳細ページを全選択コピー→貼付→パース→確認→1件登録。
4. **手入力で追加** — 一覧の「手入力で追加」モーダル。電話・直来などHPに無い問合せ用。

CSVパーサ: `src/lib/utils/inquiryCsv.ts`。`parseInquiryCsvText(text)`(サーバー再利用可)と
`parseInquiryCsvFile(file)`(Shift_JIS復号)。マッピング(GAS準拠):
学年正規化(中学２年→中2)、性別(男性→男)、電話(無変換)、媒体=認知動機の優先順位
(友人紹介>看板>チラシ>塾比較サイト→問合手段流用>HP)、申込内容=受付タイプ、結果(入会→enrolled/他→in_progress)。
サーバー取込ロジック: `src/lib/server/inquiryImportPush.ts`。教室名=schools.name完全一致で解決。

## 5. 一覧 `/admin/inquiries`

- リマインドボード(上部) / サマリー(対応中・今月・入会率) / フィルタ / テーブル。
- **行アコーディオン**: 行クリックで展開→直下に直近5件の簡易タイムライン(初回展開時に遅延フェッチ・Mapキャッシュ)。
  詳細へは右端 ExternalLink ボタン。
- **ステータス列のインライン プルダウン切替**(楽観更新+失敗ロールバック+トースト)。行展開・遷移とは独立(stopPropagation)。
- **期間ピッカー**(後述)を絞り込みに搭載。デフォルト=全期間。
- actions: 貼り付けて追加 / 手入力で追加 / 分析 / 追客メール / 資料発送 / 公開フォーム / CSV取込 / HP取込設定。

## 6. 詳細 `/admin/inquiries/[id]`

3層の情報設計:
- **顧客サマリーヘッダー**(全幅): 氏名・ステータスBadge・学年・電話/メールボタン(tel:/mailto:)・要望引用・失注理由。
- **左カラム(やること)**: 「追客タイムライン」(=旧ステータス+コンタクトを統合)、メール送信。
- **右カラム(参照)**: 顧客情報(集約)、面談予約、関連する問合せ(名寄せ)、HP原文、操作(生徒登録/削除)。

### 追客タイムライン(中核)
- 先頭ブロック「現状」: ステータスselect(7値)+条件フィールド(体験待ち/体験済み/体験没/入会=体験日、
  入会=入会日/週回数、没/体験没=失注理由)+メモ+保存。保存は `updateInquiryWithTimeline`。
- タイムライン: inquiry_contacts + inquiry_mail_logs を contacted_at/sent_at 降順で統合表示。
  method別アイコン、電話の result でバッジ色分け(つながった=緑/不在留守電=黄/拒否番号違い=赤/折返し=青)。
- コンタクト追加フォーム: method=tel/email/sms/visit/material_sent/other、result は method別候補の datalist。
  **資料送付を記録すると material_sent_at も同期**(未設定時、二重記録回避でupdateInquiryは素のもの使用)。
- ボタン操作は sonner トースト(保存しました等)。Toaster はルートレイアウトに配線済み。

### 操作
- 「生徒として登録」: createStudent(学年テキスト→GRADE_LABELS逆引きで数値化)+linked_student_id紐付け。
- ソフトデリート(確認モーダル)。

## 7. 分析 `/admin/inquiries/analytics`

`src/lib/utils/inquiryAnalytics.ts`(純関数 computeInquiryAnalytics) + recharts。
- 決定内訳(ドーナツ,7値)、ファネル(問合せ→体験→入面→入会, date基準)、月次推移、媒体別(件数/入会率/連絡不通率)、
  リードタイム(問合せ→入会・体験→入会の中央値/平均)、商圏(郵便番号前3桁・在籍学校別)、失注理由内訳。
- **期間ピッカー**: デフォルト=今年。即時反映。
- **「去年と比較」トグル**: 今年+前年同期間を並列取得し、サマリーに前年値と±差分、月次推移に前年系列を重ねる。

### 期間ピッカー(共通) `src/lib/utils/inquiryPeriod.ts` + `InquiryPeriodPicker.tsx`
プリセット: 今月/先月/直近30日/直近90日/今四半期/今年/去年/全期間/カスタム。JST固定。
shiftByYear(年比較・2/29は2/28クランプ)。一覧と分析で共通。

## 8. リマインド `src/lib/utils/inquiryReminders.ts`(純関数)

コアの alerts.ts には触れず別実装。一覧上部に表示。**直近60日窓**(過去一括取込のノイズ防止)。
- 初回コンタクト未実施: in_progress + 履歴0件 + 1日以上(3日以上=緊急)
- 対応遅延: in_progress/unreachable + 体験日/入面日なし + 経過日が3/5/7/10/14/21/30(GAS互換, 14日以上=緊急)
- 資料未発送: **in_progress** + 資料請求 + 資送日なし + 3日以上
- 体験後フォロー: 体験日が過去1日以上 + status in {in_progress, **trial_done**}

## 9. メール送信(手動) `src/lib/api/inquiryMail.ts`

Resend。Edge Function `supabase/functions/send-inquiry-mail`(RESEND_API_KEYはVault,
from=school-ie.com固定で表示名のみ教室別, reply_to対応, verify_jwt=true, 返信前提でフッターなし)。
**送信は全て手動**(自動送信なし)。
- テンプレ管理 `/admin/inquiries/templates`(変数チップ+ライブプレビュー+自分宛てテスト送信)。
- 詳細からテンプレ差込送信+送信履歴。
- `/admin/inquiries/mail`(本日の送信候補=trigger_days到達の未送信)。
- **開封計測**: Resend Webhook `/api/webhooks/resend`(Svix署名検証)→ opened_at/clicked_at。
  運用前にResendダッシュボードでWebhook追加(email.opened/clicked)+ RESEND_WEBHOOK_SECRET設定。

## 10. 資料発送(ネコポス) `/admin/inquiries/shipping`

ヤマトB2クラウド外部データ取込CSV。**送り状種類=A**(ネコポス)。**投函完了メールなし**(有料化)。
保護者名が空orカナのみなら生徒名を宛名。教室別発送設定(顧客コード等)+予約設定もこのページ。
出力と同時に material_sent_at 記録可。`src/lib/utils/yamatoB2.ts`。

## 11. 公開問合せフォーム `/inquiry/[schoolCode]` + 管理 `/admin/inquiries/form`

ログイン不要・service role挿入・ハニーポット。?src=チラシ/看板 で media 自動記録(自社フォーム/チラシ/看板・外パンフ)。
管理ページに教室×流入元別のURL・QRコード(qrcode依存・PNG保存)。

## 12. 面談セルフ予約(Phase 1) `docs/inquiry-booking-requirements.md`

相談・見学=面談のみ(Googleカレンダー方式)。`/booking/[token]` 公開ページ。
教室長カレンダーを listCalendarEvents で読みbusy除外(scope calendar.eventsのまま、free/busy専用API不要)。
確定で interview_at + カレンダーイベント(createCalendarEvent) + コンタクト記録。取消はdeleteCalendarEvent。
詳細ページから予約リンク発行/コピー/取消。booking_config(受付曜日/時間帯/calendar_email/lead/window)。
**Phase 2(体験予約=座席表エンジン+直後面談セット確保)は未実装**。体験生の表現(A仮生徒/B schedule_entries.student_id nullable化/C別テーブル, C推奨)は着手時にユーザーと決める。

## 13. Slack通知 `src/app/api/cron/inquiry-slack-report` + `src/lib/slack.ts`

vercel.json cron(平日13時)。日次サマリー/対応遅延(メンション)/月曜は週次。
slack_mention_id は inquiry_school_settings。`notifyInquiryReport`。

## 14. 環境変数・運用前設定(本番)

- Resend実送信は既存 RESEND_API_KEY(Vault)で動作。**開封計測**は Resend Webhook設定 + `RESEND_WEBHOOK_SECRET`(Vercel)。
- Slack通知は `SLACK_WEBHOOK_INQUIRIES`(無ければ SLACK_WEBHOOK_MATERIALS)と `CRON_SECRET`。
- ブックマークレット取込: connect画面でトークン発行→各教室で1クリック運用。
- 教室別設定(署名・返信先・差出人・ヤマト顧客コード・予約受付枠・slack_mention)を shipping ページで入力。

## 15. マイグレーション一覧(問合せ関連)

- 20260611_inquiry_management.sql — 5テーブル+RLS
- 20260612_inquiry_extensions.sql — 開封計測(resend_email_id/opened_at/clicked_at)+lost_reason
- 20260612_inquiry_booking.sql — inquiry_booking_tokens + booking_config + interview/trial_event_id
- 20260612_inquiry_import_tokens.sql — ブックマークレット取込トークン
- 20260617_inquiry_contacts_method_extend.sql — method に material_sent/status_change
- 20260618_inquiry_status_trial_phases.sql — status に trial_waiting/trial_done

## 16. 検証・既知の罠

- **検証は本番DB(school-db=mzxysqkuuxcfffwlfsvj)にテストデータを入れて実機確認→削除のサイクル**。
- **認証付きAPI(/api/inquiries/[id]/booking-token, /api/inquiry-import/token)は
  Authorization: Bearer ${session.access_token} 必須**(cookieだけでは401。getApiAuthはBearer優先)。
- **devでコード変更が反映されないときは serwist サービスワーカーのキャッシュ**。
  caches.delete + reload(本番はハードリロード Ctrl+Shift+R)。.next クリアでは直らない。
- PostgREST 1000行上限: 取込・一覧・集計はページング(fetchAllPaged)。
- 本番の実取込データ: 永山校306件(2023〜の履歴含む。HPは結果が入会か空欄のみなので大半in_progress)。
- 実データは永山校のみ取込済み。清瀬/京王堀之内/緑園都市は未取込(教室切替して各1クリック必要)。

## 17. 未実装・残タスク

- 体験予約 Phase 2(座席表連携)
- Slack/開封計測の本番Webhook・環境変数設定(ユーザー作業)
- 古いin_progress(実態は没/連絡不通)の一括整理(必要なら)
- 1クリックで全教室を回すブックマークレット拡張(教室切替の通信を要確認)
