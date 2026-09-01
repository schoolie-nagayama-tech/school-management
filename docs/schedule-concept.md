# 通常授業（通塾日程）の概念説明

## 概要

このシステムは学習塾の「座席表」を管理するシステムです。
「座席表」とは物理的な座席の配置ではなく、**曜日×コマ×講師×生徒の組み合わせを表す授業スケジュール表**です。

## ビジネス用語の定義

### 通常授業（通塾日程）

- 年度単位で設定される、生徒の固定スケジュール
- 「毎週火曜日の2限に、山田先生に数学を教えてもらう」という設定
- 変更がなければ自動継続

### 座席表

- 通常授業のデータをもとに、特定の週のスケジュールを展開したもの
- **入力** = 通常授業パターン（regular_schedules）
- **出力** = 週間スケジュール（schedule_entries）

```
通常授業パターン (設定)          座席表 (展開結果)
┌─────────────────────┐         ┌─────────────────────────────────────┐
│ 生徒A / 火 / 2限    │  ────>  │ 1/7(火)2限: 生徒A                   │
│ / 山田先生 / 数学   │         │ 1/14(火)2限: 生徒A                  │
└─────────────────────┘         │ 1/21(火)2限: 生徒A ...              │
                                └─────────────────────────────────────┘
```

### 授業形態

- **1対1**: 講師1人が生徒1人を指導
- **1対2**: 講師1人が生徒2人を指導（デフォルト）
  - **重要**: 2人は「ペア」ではなく、**別々の授業**を同時に行う
  - 講師が2人を個別に教えているだけ
- **グループ指導**: 講師1人が複数生徒を指導（別時間帯、後で実装）

### コマ（時間帯）

- 1日の授業を区切る単位
- 通常期: 3コマ（例: 1限 16:20-17:50, 2限 17:55-19:25, 3限 19:30-21:00）
- 講習期: 別のコマ設定

### 期間タイプ

```typescript
type PeriodType = 'regular' | 'spring' | 'summer' | 'winter';
// regular: 通常期
// spring: 春期講習
// summer: 夏期講習
// winter: 冬期講習
```

## データモデル

### 既存テーブル

#### 1. time_slots（コマ時間マスタ）

```sql
- id: UUID
- school_id: UUID (教室)
- slot_number: INT (1, 2, 3...)
- start_time: TIME (16:20:00)
- end_time: TIME (17:50:00)
- is_active: BOOLEAN
```

#### 2. regular_schedules（通常授業パターン）

```sql
- id: UUID
- student_id: UUID (生徒)
- school_id: UUID (教室)
- day_of_week: INT (0-6, 日-土)
- time_slot_id: UUID (コマ)
- teacher_id: UUID (講師)
- seat_number: INT | NULL (物理席番号、オプション)
- period_type: PeriodType (通常期/講習)
- is_active: BOOLEAN
```

#### 3. regular_schedule_subjects（通常授業の科目）

```sql
- id: UUID
- regular_schedule_id: UUID
- subject_id: UUID
- display_order: INT
```

#### 4. schedule_entries（授業スケジュール ＝ 座席表の1セル）

```sql
- id: UUID
- school_id: UUID
- date: DATE (2024-01-07)
- time_slot_id: UUID
- student_id: UUID
- teacher_id: UUID
- seat_number: INT | NULL
- status: ScheduleStatus
- transfer_from_id: UUID | NULL (振替元)
- transfer_to_id: UUID | NULL (振替先)
- regular_schedule_id: UUID | NULL (元の通常授業パターン)
- attendance_status: AttendanceStatus | NULL
```

#### 5. schedule_entry_subjects（授業の科目）

```sql
- id: UUID
- schedule_entry_id: UUID
- subject_id: UUID
- display_order: INT
```

## 座席表の表示構造

```
【火曜日 1/7】
┌────────┬──────────────────┬──────────────────┬─────────┐
│  コマ  │    山田先生      │    田中先生      │  追加   │
├────────┼──────────────────┼──────────────────┼─────────┤
│  1限   │ 佐藤太郎(中2)    │ 高橋花子(小6)    │   ＋    │
│16:20-  │ 数学             │ 算数             │         │
│17:50   │ ─────────────────│ ─────────────────│         │
│        │ 鈴木一郎(中3)    │                  │         │
│        │ 英語             │ + 生徒追加       │         │
├────────┼──────────────────┼──────────────────┼─────────┤
│  2限   │ 山本美咲(高1)    │ 伊藤健太(中1)    │   ＋    │
│17:55-  │ 数学             │ 数学             │         │
│19:25   │ ─────────────────│ ─────────────────│         │
│        │ + 生徒追加       │ 渡辺さくら(中2)  │         │
│        │                  │ 理科             │         │
├────────┼──────────────────┼──────────────────┼─────────┤
│  3限   │ ...              │ ...              │   ＋    │
└────────┴──────────────────┴──────────────────┴─────────┘
         ↑                  ↑
    講師ブロック        講師ブロック
    (最大2生徒)         (最大2生徒)

+ 講師追加
```

### 構造のポイント

1. **列 = 講師**: 各列が1人の講師
2. **行 = コマ**: 各行が1つの時間帯
3. **セル = 講師ブロック**: 1人の講師が担当する生徒（最大2人）を表示
4. **1対2の表現**: 同じセル内に2人の生徒が表示されるが、これは同じ授業ではなく**別々の授業**

## 変更パターン

### 1. 恒久的変更（通常授業パターンを変更）

#### 生徒の曜日・コマ変更

```
操作: regular_schedulesのday_of_week, time_slot_idを更新
影響: 以降の週の座席表に反映
```

#### 講師の担当変更

```
操作: regular_schedulesのteacher_idを更新
影響: 以降の週の座席表に反映
```

#### 生徒の追加

```
操作: regular_schedulesに新規レコード作成
入口:
  - 生徒詳細画面から「通塾日程を追加」
  - 座席表から「+ 生徒追加」
```

#### 生徒の削除（退塾・休塾）

```
操作: regular_schedulesのis_activeをfalseに
影響: 以降の週の座席表から消える
```

### 2. 一時的変更（その日のみ）

#### 振替（生徒の日程変更）

```
操作:
  - 元のschedule_entryのstatusを'transferred_out'に
  - 新しいschedule_entryを'transferred_in'で作成
影響: その回のみ
通常授業パターンは変更なし
```

#### 代講（講師の一時変更）

```
操作: schedule_entriesのteacher_idを更新
影響: その回のみ
通常授業パターンは変更なし
```

#### 欠席

```
操作: schedule_entriesのattendance_statusを'absent'に
影響: その回のみ
```

## 生徒の時間重複チェック

### なぜ必要か

個別指導とグループ指導で時間帯が重なる可能性がある：

```
個別指導: 19:30-21:00
グループ: 20:30-21:30
→ 30分重複
```

### チェックロジック

```typescript
async function checkStudentTimeConflict(
  studentId: string,
  dayOfWeek: number,
  startTime: string,
  endTime: string
): Promise<boolean> {
  // その生徒の同じ曜日のスケジュールを取得
  // 時間帯が重複するものがあればtrue
}
```

### チェックタイミング

- 通常授業パターン登録時
- 振替先指定時

## 週間スケジュール生成の流れ

```
1. 通常授業パターン（regular_schedules）を取得
2. 対象週の各日付をループ
3. 各日付の曜日に対応するパターンを抽出
4. 休講日でなければschedule_entriesに展開
5. 既存エントリーがあればスキップ（重複防止）
```

## グループ指導（将来実装）

### 概要

- 個別指導とは**別のコマ設定**（別の時間帯）
- 同じ座席表ページ内でタブ切り替え
- 生徒の時間重複チェックは個別・グループ横断で行う

### データモデル案

```sql
-- グループ指導用のコマ（個別とは別）
time_slots に is_group_class: BOOLEAN を追加？
または group_time_slots テーブルを新設？

-- グループクラス
group_classes
- id: UUID
- school_id: UUID
- name: VARCHAR (例: "中3数学クラス")
- day_of_week: INT
- time_slot_id: UUID
- teacher_id: UUID
- max_students: INT
- period_type: PeriodType

-- グループクラスの生徒
group_class_students
- id: UUID
- group_class_id: UUID
- student_id: UUID
```

## 既存APIの確認

### src/lib/api/schedule.ts に実装済み

```typescript
// コマ時間
getTimeSlots(schoolId): TimeSlot[]
getActiveTimeSlots(schoolId): TimeSlot[]
createTimeSlot(schoolId, formData): TimeSlot
updateTimeSlot(id, formData): TimeSlot
deleteTimeSlot(id): void

// 休講日
getClosedDays(schoolId?, startDate?, endDate?): ClosedDay[]
isClosedDay(schoolId, date): boolean
createClosedDay(schoolId, formData): ClosedDay
deleteClosedDay(id): void

// 通常授業パターン
getRegularSchedules(schoolId, periodType): RegularSchedule[]
getStudentRegularSchedules(studentId, periodType): RegularSchedule[]
createRegularSchedule(schoolId, formData): RegularSchedule
updateRegularSchedule(id, formData): RegularSchedule
deleteRegularSchedule(id): void

// 授業スケジュール（座席表の中身）
getScheduleEntries(schoolId, startDate, endDate): ScheduleEntry[]
createScheduleEntry(schoolId, formData): ScheduleEntry
updateScheduleEntry(id, formData): ScheduleEntry
deleteScheduleEntry(id): void
createTransfer(sourceId, schoolId, targetData): { source, target }

// 週次生成
generateWeeklySchedule(schoolId, weekStartDate, periodType, generatedBy): ScheduleGenerationLog

// 座席表表示用
getWeeklyScheduleData(schoolId, weekStartDate): WeeklySchedule
```

## 型定義の確認

### src/types/schedule.ts に定義済み

```typescript
// 期間タイプ
type PeriodType = 'regular' | 'spring' | 'summer' | 'winter';

// スケジュールステータス
type ScheduleStatus =
  | 'scheduled'
  | 'completed'
  | 'cancelled'
  | 'transferred_out'
  | 'transferred_in';

// 出席ステータス
type AttendanceStatus = 'present' | 'absent' | 'late';

// 通常授業パターン
interface RegularSchedule {
  id: string;
  student_id: string;
  school_id: string;
  day_of_week: number;
  time_slot_id: string;
  teacher_id: string;
  seat_number: number | null;
  period_type: PeriodType;
  is_active: boolean;
  // JOINデータ
  student?: { id; last_name; first_name; grade };
  teacher?: { id; display_name; email };
  time_slot?: TimeSlot;
  subjects?: RegularScheduleSubject[];
}

// 授業スケジュール
interface ScheduleEntry {
  id: string;
  school_id: string;
  date: string;
  time_slot_id: string;
  student_id: string;
  teacher_id: string;
  status: ScheduleStatus;
  transfer_from_id: string | null;
  transfer_to_id: string | null;
  regular_schedule_id: string | null;
  attendance_status: AttendanceStatus | null;
  // JOINデータ
  student?: { id; last_name; first_name; grade };
  teacher?: { id; display_name; email };
  time_slot?: TimeSlot;
  subjects?: ScheduleEntrySubject[];
}
```

## 現在の実装状況

### 実装済み

- ✅ データモデル（テーブル定義）
- ✅ 型定義（TypeScript）
- ✅ API関数（CRUD操作）
- ✅ 座席表ページの基本表示（週間ビュー）
- ✅ 週次スケジュール生成ロジック
- ✅ 週表示の改善（日ごと・コマごとの見やすい表示、キャプション「横＝日付・縦＝コマ」）
- ✅ 生徒カードのドラッグ＆ドロップによる振替（ドロップ先に講師が1人の場合は即振替、複数人の場合は振替先講師選択モーダル）
- ✅ 生徒カードのクリック振替（振替アイコンまたは右クリックメニュー「振替」→ 振替先セルをクリック）
- ✅ 講師カードのドラッグ＆ドロップによる移動
- ✅ セルクリックでの振替先指定
- ✅ 出席記録・編集・削除（右クリックメニュー）
- ✅ 振替操作UI（TransferModal による振替先日付・コマ・講師選択）

### 未実装

- ❌ 座席表からの生徒追加UI（「+ 生徒追加」でモーダルから新規登録）
- ❌ 座席表からの生徒削除UI（講師ブロック単位の削除は確認ダイアログあり）
- ❌ 生徒詳細画面からの通塾日程管理（通常授業パターンの一覧・追加・編集）
- ❌ 時間重複チェック
- ❌ グループ指導対応
- ❌ 印刷・PDF出力

## UIデザイン指針

新しいデザインシステムに準拠：

- ページ背景: 白 `bg-white`
- カード背景: 薄グレー `bg-[#f8f8f8]`
- ボーダー: `border-gray-200`
- プライマリボタン: ネイビー `bg-[#1e3a5f]`
- セカンダリボタン: ネイビー透過 `border-[#1e3a5f] text-[#1e3a5f]`
- ヘッダー: 赤 `bg-[#d32f2f]`
