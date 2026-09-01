# 体験・面談 セルフ予約機能 要件定義

作成日: 2026-06-12
正典の親: docs/inquiry-management-requirements.md（問合せ管理）
関連: docs/schedule-system-handoff.md（座席表システム）

## 1. 背景・確定した方向性

問合せからの予約は2種類あり、難易度が異なる:

| 種類                       | 必要なもの            | リソース                |
| -------------------------- | --------------------- | ----------------------- |
| 相談・教室見学（面談のみ） | 面談1枠               | 教室長1人               |
| 体験授業                   | 体験コマ → 直後に面談 | 体験(席+講師) ＋ 教室長 |

体験は「体験枠（席＋講師）」と「直後の面談（教室長）」の二重調整になるため難しい。これを保護者のセルフ予約で1回で完結させるのが目的。

### ユーザー確定事項（2026-06-12）

- **面談（相談・見学）の空き枠 = Googleカレンダー方式**（教室長のカレンダーの空き）
- **体験の空き枠 = 座席表方式**（席＋講師が空いていて、かつ直後に教室長が空いている枠だけ）
- **体験は「体験＋面談」をセットで確保**（体験枠を選ぶと直後を面談として自動確保）
- **予約するのは保護者**（公開リンクからのセルフ予約）

## 2. 既存資産（調査結果）

再利用:

- `computeFullKeys()`（src/lib/api/placement-availability.ts）— 日付×コマの満席判定（講師出勤×席容量）。体験の空き席判定にそのまま使える
- `getClassCapacity()` / `getActiveTimeSlots()` — 容量設定・コマ時刻
- `createCalendarEvent(userId, params)`（src/lib/google-calendar.ts）— Googleカレンダーにイベント作成（primary、Asia/Tokyo）
- `listCalendarEvents(userId, timeMin, timeMax)` — 予定読み取り。**現スコープ calendar.events のまま空き枠を自前計算できる**（free/busy専用APIもスコープ追加も不要）
- カレンダー連携は **user単位**（google_calendar_tokens.user_id）。教室の特定は schools.notification_emails と calendar_email の照合（createFurikaeCalendarEvents と同方式）
- 公開トークンの作法: invite/[token]、regular-shift public（service roleでAPI検証、anonは列挙不可）

ゼロから:

- 予約トークン（問合せ紐づけ）・公開予約ページ・面談空き枠算出・体験空き枠算出・予約確定処理

## 3. フェーズ分割

### Phase 1: 面談予約（相談・見学）

座席表も体験生問題も絡まない。カレンダー連携＋公開予約ページの土台を固める。**先に着手**。

### Phase 2: 体験予約

座席表エンジン＋面談セット確保。体験生の表現方法（後述）を決めてから。

## 4. データモデル

### inquiry_booking_tokens（予約リンク）

| カラム                 | 備考                                          |
| ---------------------- | --------------------------------------------- |
| id uuid pk             |                                               |
| token text unique      | URL用のランダム文字列                         |
| inquiry_id uuid fk     | 紐づく問合せ                                  |
| school_id uuid fk      |                                               |
| purpose text           | 'interview'（面談）/ 'trial'（体験。Phase 2） |
| expires_at timestamptz | 既定: 発行から14日                            |
| used_at timestamptz    | 予約確定で埋める（再予約はトークン再発行）    |
| created_at             |                                               |

RLS: check_school_access（admin/owner/manager）。anonは触れない。公開予約はAPIルートがservice roleで検証する。

### inquiry_school_settings に予約設定を追加（jsonb 1カラム）

`booking_config jsonb` に集約（カラム乱立を避ける）:

```jsonc
{
  "calendar_email": "manager@example.com", // 空き判定・イベント作成に使う教室長のGoogleアカウント。null=schoolメール照合の先頭
  "interview_days": [2, 3, 4, 5, 6], // 面談受付の曜日(0=日)。既定 火〜土
  "interview_start": "14:00",
  "interview_end": "21:00",
  "interview_duration_min": 60,
  "lead_hours": 24, // 何時間先から予約可
  "window_days": 14, // 何日先まで
  // Phase 2 体験用: trial_days / trial_slot_numbers など後で追加
}
```

### inquiries に列追加

- `interview_event_id text` — 面談のGoogleカレンダーイベントID（変更・取消用）
- （Phase 2）`trial_event_id text`

## 5. Phase 1 機能要件

### F1-1. 予約リンクの発行（管理）

- 問合せ詳細ページに「面談予約リンク」セクション。「リンクを発行」→ inquiry_booking_tokens に purpose='interview' で作成 → 公開URL `${origin}/booking/{token}` を表示・コピー。
- 追客メールのテンプレ変数に `{予約リンク}` を追加（このinquiryの有効な面談トークンURL。無ければ発行時に生成）。← inquiryMail 側の変数に追加。
- 既に interview_at が入っていれば「予約済み: M/D HH:mm」を表示し、取消（カレンダーイベント削除＋interview_at/used_atクリア）も可能。

### F1-2. 公開予約ページ /booking/[token]

- ログイン不要。トークンをAPIで検証 → 教室名・お名前（保護者）・「面談（教室見学・学習相談）のご予約」を表示。
- **空き枠表示**: API が算出した空き枠（日付×時刻）を、日付ごとにボタンで表示。スマホ前提。
- 枠を選択 → 確認 → 「この日時で予約する」。
- 完了画面（「ご予約ありがとうございます。M/D HH:mm にお待ちしております」）。
- 期限切れ・使用済みトークンは「このリンクは無効です。教室までお問い合わせください」。

### F1-3. 面談の空き枠算出（API/lib）

`getInterviewSlots(inquiryId or token)`:

1. booking_config から 曜日・時間帯・枠長・lead_hours・window_days を取得。
2. lead_hours 先〜window_days 先の対象曜日について、interview_start〜interview_end を duration_min 刻みで候補枠を生成。
3. **Googleカレンダー busy を除外**: calendar_email→user_id を解決し listCalendarEvents で対象期間の予定取得 → 重なる候補を除外。カレンダー未連携なら此のステップはスキップ（警告ログ）。
4. **既存の面談予約と重複除外**: 同教室で interview_at が候補と重なる問合せを除外（自前の二重予約防止）。
5. 残った枠を日付ごとにまとめて返す。

### F1-4. 予約確定（公開API・service role）

`POST /api/booking/[token]/confirm { slotStart }`:

1. トークン検証（有効・未使用・期限内）。
2. その枠がまだ空いているか再チェック（手順F1-3を再実行して slotStart が含まれるか）。埋まっていたら 409。
3. inquiry.interview_at = slotStart。
4. Googleカレンダーにイベント作成（createCalendarEvent、calendar_emailのuser）。タイトル「【面談】{保護者}様（{教室名}）」。event_id を inquiry.interview_event_id に保存。
5. token.used_at = now。
6. inquiry_contacts に1件（method='visit', note='面談予約 受付'）。
7. 確認メールは任意（Phase 1ではアプリ完了画面のみ。送れるなら sendInquiryMail で受付確認）。

- anonポリシーは作らない。すべて service role。

### F1-5. グレースフルデグレード

- Googleカレンダー未連携の教室: busy除外をスキップし、設定の受付枠＋自前の重複除外のみで枠を出す（カレンダーイベントも作らず interview_at だけ記録）。管理画面に「カレンダー未連携のため空き判定は手動枠のみ」と注記。

## 6. Phase 2 概要（体験予約・設計のみ）

### 体験の空き枠算出

対象コマ（individual、booking窓内、稼働曜日）ごとに:

- ① computeFullKeys で満席でない（席＋担当可能講師あり）
- ② **直後のコマ時間に教室長がカレンダー上空いている**（面談用。Phase 1のbusy判定を流用）
  の両方を満たす枠だけを保護者に提示。

### 予約確定

- 体験コマを座席表相当に配置、trial_at と interview_at（直後枠）をセット、体験・面談の2イベントをカレンダー作成。

### 未決定: 体験生の表現（要ユーザー判断・Phase 2着手時）

座席表は現状 student_id 必須（docs/schedule-system-handoff.md:437「体験は生徒を先に登録しておく必要あり」）。問合せ由来の未登録者を座らせる方法:

- **A** 仮生徒として登録（在籍/請求/5週目の除外が侵襲大）
- **B** schedule_entries.student_id を nullable 化＋guest_name/inquiry_id 追加（kind='trial'の既存方向に沿うがコアテーブル変更で中リスク）
- **C** 体験予約を別テーブルで保持し空き算出は両方を数える（既存座席表にゼロリスク。座席表表示と生徒化は後追い）← **ベータ推奨**

## 7. セキュリティ

- 予約は未登録者のPII操作。anonポリシーは一切作らない。公開ページのデータ取得・書き込みは全てAPIルートがservice roleで実施し、トークンで認可。
- トークンは推測困難な十分長いランダム値。期限・使い切り。

## 8. リリース

| フェーズ | 内容                                                                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1  | inquiry_booking_tokens / booking_config / 面談空き枠算出 / 公開予約ページ / 予約確定＋カレンダー / 詳細ページのリンク発行・取消 / {予約リンク}メール変数 |
| Phase 2  | 体験空き枠算出（座席表＋直後面談） / 体験予約確定（2イベント） / 体験生表現（A/B/C決定） / 座席表表示・入会時生徒化                                      |

## 9. 残確認事項

- 面談担当（calendar_email）が教室に複数いる場合の扱い（ベータ: booking_config.calendar_email で1つ指定、未指定はschool照合の先頭）。
- 確認メールを自動で送るか（ベータは完了画面のみで可）。
- Phase 2 の体験生表現 A/B/C（C推奨）。
