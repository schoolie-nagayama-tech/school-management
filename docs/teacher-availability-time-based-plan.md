# 講師出勤可否の時間帯ベース化 設計計画

作成: 2026-08-17 ／ ステータス: 設計案（実装前・要レビュー）

## 0. 結論

**(a) 時間帯ベースに寄せる。(b) formation をキーに含める案は不採用。**

理由の核心は2つ。

1. **出勤可否は「その時間に教室に居られるか」という物理的事実であり、形態の属性ではない。**
   18:00〜21:20 に居られる講師は、その時間帯に重なる個別コマにも集団コマにも入れる。
   「集団を教えられるか」は資格・スキルの問題で、出勤可否とは別の講師属性（→ §7）。
2. **原本データは既に時間帯ベースである。**
   シフト提出（`regular_shift_submission_slots.time_slot` = "HH:MM-HH:MM"）→
   `teacher_availability_periods.available_time_slots_by_day` の経路は最初から時刻文字列で、
   `available_slot_numbers_by_day` は「同じ時間帯なら slot_number は同じ」という前提で
   **後から逆引きした派生値**（`teacher-availability.ts:116-142`、先勝ちで衝突を握りつぶす）。
   形態別コマ時間はまさにこの前提を壊すので、派生を直すのではなく派生自体をやめる。

(b) を採ると、(i) 講師・管理者が形態ごとに出勤可否を二重入力することになり乖離する、
(ii) `schedule_formations` は動的マスタなので形態を追加するたび全講師の出勤可否が空になる、
(iii) コマ時間を後から変更すると slot_number の意味が静かにズレる——いずれも運用で破綻する。

## 1. 現状の要点（調査結果サマリ）

- **正典は `teacher_availability_periods`**（2026-06-24 一本化済み、school_id スコープ・期間版管理・manual > regular_shift）。
  ペイロードは 3 列: `available_days_of_week` / `available_slot_numbers_by_day`（派生） / `available_time_slots_by_day`（原本）。
- `user_profiles.available_slot_numbers_by_day` は school 非依存の単一値で、閲覧フォールバック専用に降格済み。
  ただし**迂回して直読みする消費者が3つ残存**（§4 の A 群）。
- スケジュール自動生成本体（`generateWeeklySchedule`）は出勤可否を**一切見ない**
  （パターン割当時の `pattern-matching.ts` でのみ判定、しかも slot_number は加点のみで曜日だけがハード条件）。
- 講習アロケータ（`src/lib/koushu-allocator/`）は `seasonal_shift_*` 系の独立テーブルのみを参照し、
  本件 2 テーブルへのアクセスは**皆無 → 本改修のスコープ外**。
- `schedule_time_slots` は `UNIQUE(school_id, formation, slot_number)` で**形態ごとに独立採番**。
  同一校で individual の 3 限と group の 3 限は別時刻になり得る（既に小集団 18:00- 系で現実化）。

## 2. 新しい意味論（正典の定義）

### 2.1 正典

`teacher_availability_periods.available_time_slots_by_day` を唯一の正典に昇格する。

- 形: `{ "0".."6": ["HH:MM-HH:MM", ...] }`（現行と同じ。スキーマ変更不要）
- `available_days_of_week` は従来どおりハードな曜日フィルタとして維持。
- `available_slot_numbers_by_day`（periods 側）は**書き込み・読み取りとも廃止**（列は当面残し、後日 DROP）。

### 2.2 判定ルール（コアの1関数に集約）

「講師 T は 校 S・曜日 D の具体的コマ K(start, end, formation 任意) に入れるか」

1. D が `available_days_of_week` に含まれない → 不可。
2. D の時間帯リストが**空 → その曜日は全時間可**（DB コメントの既存意味論を踏襲。§6-1 参照）。
3. 時間帯リストを区間の集合とみなし、**隣接・近接区間をギャップ橋渡しでマージ**した上で、
   K の [start, end] がマージ後のいずれかの区間に**包含**されていれば可。

- **橋渡しギャップ: 15 分以下**を推奨既定値とする。
  例: 個別コマ 17:00-18:30 と 18:40-20:10 に○を付けた講師は 17:00-20:10 に居るとみなし、
  休憩(18:30-18:40)をまたぐ集団コマ 18:00-19:00 にも入れる。
  単なるオーバーラップ判定にしないのは「18:00-18:30 しか居ない講師が 18:00-19:00 コマに合致する」誤りを防ぐため。
- 実装は `src/lib/api/teacher-availability.ts` に
  `isAvailableForInterval(availability, dow, start, end)` として追加し、全消費者がこれを経由する。
  `getAvailabilityDayMap` の `byDayAndSlotNumber` は廃止し、`byDayIntervals`（マージ済み区間）に置換。

### 2.3 入力 UI の粒度

講師 UI はタイピング最小化の方針どおり**コマのグリッドをクリックする方式を維持**する。
グリッドの行は「その校の全アクティブ形態の `schedule_time_slots` を (start,end) で重複排除し、
開始時刻順に並べたもの」= 時間帯の合併軸。○を付けたセルの時刻区間がそのまま保存値になる。
（形態が増えれば行が自然に増えるだけで、既存の保存値は影響を受けない。）

## 3. 消費者ごとの変更点

| 消費者                                       | 現状                                  | 変更                                                                         |
| -------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| `teacher-availability.ts` sync（`:116-142`） | time→slot_number 逆引き（先勝ちバグ） | **逆引きを削除**。time labels をそのまま保存                                 |
| 同 `getAvailabilityDayMap`                   | `byDayAndSlotNumber`                  | `byDayIntervals`（マージ済み）に置換                                         |
| `pattern-matching.ts:202-210`                | slot_number 一致で +5 点              | パターンの time_slot の実時刻で `isAvailableForInterval` → +5 点（挙動同等） |
| `placement-availability.ts:112-194`          | `dow\|slot_number` キーで満席判定     | 個別形態の具体的 time_slot 区間で包含判定に置換                              |
| `WeeklyScheduleGrid`（曜日粒度のみ）         | 変更不要（曜日カードのまま）          | 任意: 将来コマ粒度に精緻化する余地のみ記録                                   |
| `AvailabilityPeriodsPanel`                   | 既に time slots を読み書き            | グリッド生成を §2.3 の合併軸に変更                                           |
| `regular-shift/public` 提出フォーム          | time_slot 文字列で提出                | グリッド生成を §2.3 の合併軸に変更（保存形式は不変）                         |

## 4. 同時に是正するバグ（オプション (a)(b) に関係なく必要）

**A 群: profile 直読みの迂回消費者**（periods の manual 優先を無視している）

1. `RegularPatternForm.tsx:131-167` — `user_profiles` 生カラムでハード除外。
   しかも「空=全コマ可」の意味論を**逆転**解釈（空だと候補から除外）。
   → `getAvailabilityDayMap` 経由 + `isAvailableForInterval` に置換。
2. `TeacherDetailModal.tsx:16-49` — profile 生カラムを表示。→ periods 由来の区間表示に置換。
3. `ScheduleGrid.tsx` — **どこからも import されていないデッドコード**（UTC 曜日判定バグも内包）。→ 削除。

**B 群: 表示の dedup バグ**

4. `admin/teachers/[teacherId]/page.tsx:139-153` と `edit/page.tsx:302-316` —
   複数校のコマを slot_number のみで dedup。`'group' < 'individual'` の order で
   **group が先勝ちし individual の時刻を握りつぶす**。
   → 時間帯ベース表示（校ごとに §2.3 の合併軸を表示）に置き換えれば構造的に消える。

**C 群: 防御**

5. `admin/users/[userId]/route.ts:354-360` — body のキーが object 以外だと `{}` に黙って全消去。
   → 4xx で拒否に変更（profile 列は凍結方向なのでいずれ書き込み自体を廃止）。

## 5. 移行計画

1. **regular_shift 由来の期間行**: 変換不要。`available_time_slots_by_day` は既に正しい原本。
2. **manual 由来の古い期間行**: バックフィル SQL は**不要にした**（当初案から変更）。
   読み取り時に「`available_time_slots_by_day` が空 かつ `available_slot_numbers_by_day` が非空」
   を旧レコードと判定し、その校の **individual** 形態のコマ時間で実時刻に解決する
   （`buildDayIntervals` の `resolveSlotNumber`）。マイグレーションの適用順に依存せず、
   旧行が「全時間可」に化ける事故も起きない。
   なお手動保存時は旧列を `{}` に落とす（残すと「時間帯を空にした曜日」で旧コマが復活するため）。
3. **profile 列フォールバック**: A 群是正で読者がゼロになった時点で表示フォールバックも撤去。
   列 DROP は別マイグレーションで後日（`db push` 地雷があるため本番は MCP apply_migration）。
4. ロールアウト順: コア関数追加 → 消費者置換（読み） → sync の slot_number 派生停止（書き） →
   フォールバック撤去。各段階で既存データと後方互換。**マイグレーション不要**。

## 6. ポリシー決定

1. **「時間帯リストが空 = その曜日は全時間可」は当面維持**（2026-08-17 決定）。
   DB コメント由来の既存意味論で、regular_shift 行との互換のため。
   **2027-02 の本格稼働時に「空 = 不可」へ改定する**（全時間可は全セル○で表現）。
   改定箇所は `buildDayIntervals` の1か所（null を返す分岐）に閉じてある。
2. **橋渡しギャップ = 15 分**（`DEFAULT_BRIDGE_GAP_MINUTES`）。校ごとの休憩実態に合わせて
   引数で調整可能。
3. **コマ時間を後から変更した場合**、保存済みの出勤可否は「講師が申告した時刻」のまま動かない。
   時間割の大改定時はシフト再提出を促す運用になる（slot_number 方式でも意味ズレは起きるため
   時間帯方式の方が「合わなくなったことが目に見える」分だけ安全）。

### 補足: 講師のシフト提出フォームの時間軸

`/regular-shift/[settingId]` の提出フォームの行は `schedule_time_slots` ではなく
**`regular_shift_settings.weekday_slots`（管理者が入力するカンマ区切り文字列）**から作られる。
そのため新形態の時間帯を追加しても提出フォームは自動では増えない。

ただし §2.2 の橋渡しマージにより、個別コマ 17:00-18:30 / 18:40-20:10 を提出した講師は
17:00-20:10 の在室とみなされ、集団コマ 18:00-19:00 にも合致する。
提出軸を細かくするのは「在室していない時間を除きたい」場合のみでよい。

## 7. スコープ外（別課題として記録）

- **形態の指導資格**（例: プログラミングを教えられる講師の限定）は出勤可否と別の講師属性。
  必要になったら `user_profiles` or 別テーブルに `teachable_formations text[]` 相当を追加し、
  pattern-matching / 配置 UI のハードフィルタに使う。本改修とは独立に追加できる。
- 講習アロケータ（`seasonal_shift_*` 系で完結）・`generateWeeklySchedule`（出勤可否を見ない）は無変更。
- `schedule_time_slots` の RLS が authenticated 全員書き込み可の件（形態マスタと非対称）は別途。
