# 講習 自動コマ割り 仕様書

> 2026-06-12 設計確定。ユーザーとのQ&Aで決めた設計判断＋Phase R（1対1・45分半コマ）実装調査に基づく。
> 実装の正典はこのファイル。関連: `docs/small-group-programming-schedule-plan.md` §2.8（Phase R）、`docs/schedule-system-handoff.md`。

---

## 0. 一言で

講習期間の申込（生徒×科目×コマ数、**半コマ・1対1込み**）を、生徒の講習可能表と講師の講習シフトに従って、**コマ＋担当講師を同時に**下書き生成する。点数（スコア）は内部処理のみでUIには出さない。確認して公開する現行フローは維持。

---

## 1. 確定した設計判断（Q&Aログ）

| #   | 論点              | 決定                                                                                                                                                     |
| --- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 割当の段階        | **コマ割り＋講師を同時決定**して下書き生成（現行の提案方式を踏襲）                                                                                       |
| 2   | 対象              | 個別のみ自動。**半コマ(45分)・1対1も自動対象**。集団は手動。ユーザー定義形態は対象外（Phase A の §4 スコープ外宣言を維持）                               |
| 3   | 半コマ/1対1の根拠 | **申込時に科目ごとに指定**（→ §3 データ拡張）                                                                                                            |
| 4   | 生徒の出席可能枠  | **講習可能表（提出）が唯一の正**。期間中に通常授業は無い前提（重複判定は講習コマ同士のみ）。**未提出の生徒は自動割り対象外**（理由付きで未割当リストへ） |
| 5   | 講師の出勤        | **講習シフト提出が正典**（seasonal_shift_settings + submissions + slots）。未提出講師は候補外                                                            |
| 6   | 確定順            | **制約の強い順**（出席可能枠が少ない生徒から）。タイブレークは残コマ多い順                                                                               |
| 7   | 詰め方の設定      | **実行時パネルで毎回指定**（前回値を記憶）: 1日上限コマ数(既定2)／連続優先ON/OFF／同一科目の同日可否(既定 不可)／科目の均等分散ON/OFF                    |
| 8   | 講師の継続性      | 同じ生徒×科目は「なるべく同じ講師」だが**優先度低**。全体を埋めることが優先                                                                              |
| 9   | 講師の負荷        | **緩く平準化**（他条件が同等なら担当コマの少ない講師へ）                                                                                                 |
| 10  | 講師不足の枠      | 他の可能枠を探し、**無ければ配置しない**（担当未決定では置かない。理由付き未割当リストへ）                                                               |
| 11  | 再実行            | 実行時に「**下書きを破棄して組み直す／維持して差分だけ埋める**」を選択。公開済み・手動配置は常に固定                                                     |
| 12  | スコア            | 内部のみ。UI に数値は出さない（表示は結果と未割当理由だけ）                                                                                              |

---

## 2. 入力データと正典

| データ       | 正典                                                                                                                 | 備考                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 講習期間     | `course_prep_periods`（season×year×school, schedule_start/end_date）                                                 | 休講日 `schedule_closed_days` を除外                                                            |
| 申込         | `koushu_enrollments`（school+season+student+formation, `koma_by_subject`）                                           | §3 で拡張                                                                                       |
| 生徒の可能枠 | `seasonal_shift_student_submissions` + `_slots`（shift_date × time_slot "HH:MM-HH:MM", available=true）              | time_slot 先頭5文字 → `schedule_time_slots.start_time` で slotId 解決（配置ストリップと同方式） |
| 講師の出勤   | `seasonal_shift_settings`（講習シフト）+ submissions + slots                                                         | 期間に重なる setting の提出。date×slot に展開                                                   |
| 講師の属性   | `user_profiles.teachable_subject_ids / gender`                                                                       | 空=全科目可（既存慣習）                                                                         |
| 生徒の希望   | `students.fixed_teacher_ids / excluded_teacher_ids / preferred_teacher_gender`                                       | excluded・性別不一致・科目外はハード除外。fixed は加点のみ                                      |
| 容量         | `school_class_capacity.max_students_per_teacher_individual`（1講師あたり席数）/ `total_individual_seats`（教室席数） | 席の消費は seatOccupancy で計算（§5）                                                           |
| 既存配置     | `schedule_entries`（kind='koushu', 期間内, active status）                                                           | 公開済み・手動配置。occupancy と残コマの両方に算入                                              |

---

## 3. データ拡張（実装フェーズ P1）

### 3-1. 申込: `koma_by_subject` の値をオブジェクト化

現在: `Record<subject_id, number>`（コマ数のみ）。これを後方互換のまま拡張する:

```ts
// 値: number（旧、= { koma: n, ratio: 2, duration: null }） | KomaSpec（新）
interface KomaSpec {
  koma: number; // 本数。45分1本も「1コマ」と数える（残コマ計算の単位=本数）
  ratio?: 1 | 2; // 既定 2。申込時に科目ごとに指定
  duration?: 45 | 90; // 既定 = subjects.duration_minutes。申込時に科目ごとに指定
}
```

- DDL 変更不要（jsonb）。**読み出しは新設の正規化アクセサ `normalizeKomaBySubject()` に一本化**し、number/オブジェクト両対応の分岐を散らさない。既存読み出し箇所（`studentKoushuSummary.ts` / `KoushuPeriodCard.tsx` / `KoushuEnrollmentManager.tsx` / `koushu-period.ts` / `koushu-match.ts`）を全てアクセサ経由に改修。
- `half_position` は**申込に持たせない**。前半/後半はソルバが空き（vacancies）に合わせて決める（詰め込み効率優先）。
- 申込UI（`KoushuEnrollmentFormModal` の科目×個別/集団マトリクス）: 個別セルに比率(1対1/1対2)と時間(90/45)のセレクトを追加。既定値は ratio=`getStudentContractRatioMap()`（通年契約）、duration=`subjects.duration_minutes`。

### 3-2. 提案: `schedule_match_proposals` に3列追加（マイグレ必須）

```sql
ALTER TABLE schedule_match_proposals
  ADD COLUMN ratio smallint NOT NULL DEFAULT 2 CHECK (ratio IN (1,2)),
  ADD COLUMN duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes IN (45,90)),
  ADD COLUMN half_position text CHECK (half_position IS NULL OR half_position IN ('first','second'));
```

- `publishProposal` の entries INSERT でこの3列をスナップショット継承（現状は欠落＝半コマ情報が公開で失われるバグ予備軍）。
- 座席表の下書き擬似エントリ（page.tsx「講習は常に1対2・全コマ」のハードコード）も proposal の3列を反映するよう変更。

---

## 4. 実行時設定（パネル）

`KoushuControlPanel` のマッチング実行部に設定欄（前回値を localStorage 記憶）:

| 設定           | 既定             | 意味                                                                                   |
| -------------- | ---------------- | -------------------------------------------------------------------------------------- |
| 1日上限コマ数  | 2                | 生徒1人の1日の講習コマ上限（本数。45分も1と数える）                                    |
| 連続優先       | ON               | 同日に2本入れるなら連続コマを優先（送迎1回）                                           |
| 同一科目の同日 | 不可             | 同じ科目を同じ日に2本入れてよいか                                                      |
| 科目の均等分散 | ON               | 同一科目のコマを期間全体に等間隔で散らす（間隔だけでなく**絶対位置**も見る。§5-2参照） |
| 再実行モード   | （実行時に選択） | 「下書きを破棄して組み直す」／「下書きを維持して差分だけ埋める」                       |

---

## 5. アルゴリズム

方式は**貪欲（制約の強い順）＋リペア1パス**。スコアは加重和を内部でのみ使用（`MATCH_CONFIG` の暫定重みを継承・調整）。将来の最適化（最小費用流等）は `memory/project_koushu_matching.md` の段階案どおり別フェーズ。

### 5-0. 前処理

1. 期間内日付（休講日除外）× 個別コマ時間 → セル集合。
2. 申込 → **タスク列**に展開: (生徒, 科目, ratio, duration) × 本数。既存配置（公開済み entries）を差し引いた残本数のみ。
3. 生徒可能枠 map（date×slotId）。**可能表未提出の生徒はここで対象外にし、未割当リストへ**（理由: 可能表未提出）。
4. 講師出勤 map（date×slotId → teacherIds）。講習シフト未提出の講師は含めない。
5. occupancy 初期化: 既存 entries（＋再実行モードが「維持」なら既存下書きも）を `Map<teacherId|cell, SeatEntryInput[]>` と教室席数カウントに積む。**席の消費計算は `seatOccupancy.ts` を唯一の正として使う**:
   - 講師セル単位: `canPlaceEntry(existing, incoming, max_students_per_teacher_individual)`（1対1排他・半コマペアリング内包）
   - 教室単位: 講師セルごとの `computeSeatOccupancy().usedSeatCount` の合計 ≤ `total_individual_seats`
   - 生徒の同時刻重複: `computeEffectiveTimeRange` で実効時間帯比較（前半45と後半45は同一コマに共存可）

### 5-1. 生徒の処理順（制約の強い順）

生徒を「可能枠セル数の少ない順 → 残本数の多い順」でソート。生徒内では科目をラウンドロビン（1本ずつ交互）で消化し、特定科目が枠を食い尽くすのを防ぐ。**ラウンドロビンの1周ごとに「残コマ数の多い科目」から回す**（配列順で固定すると先頭科目が良いセルを先取りし続け、後ろの科目が期間の端へ押し出される）。

### 5-2. 1本の配置（候補セル選択）

**ハードフィルタ**（すべて満たすセルのみ候補）:

- 生徒の可能枠である
- 1日上限（講習コマ本数）未満
- 同一科目の同日不可（設定ONのとき）
- 生徒の実効時間帯が既存と重複しない
- 教室席数に空きがある
- **出勤講師のうち1人以上に置ける**: 講師候補 = 出勤 ∩ NG外 ∩ 性別適合 ∩ 科目適合 で、`canPlaceEntry` が真

**半コマの決め方**（duration=45 のタスク）: 候補講師セルの `vacancies` を見て、`kind:'first'|'second'`（片半空き）を**優先して埋める**。無ければ全コマ空き席に 'first' で新規に開く。

**セルの内部スコア**（高い順に採用。数値はUI非表示・暫定）:

- 科目の均等分散（設定ONのとき）: **2つの項の合算**
  - **絶対位置（アンカー・主。+20）**: その科目を N コマ持つ生徒の k 番目（日付順）のコマは、期間全体に均等なら `(k + 0.5) / N` の位置に来るはず。候補日がその理想位置から離れるほど減点し、理想間隔の1.5倍（`ANCHOR_TOLERANCE`）を超えたら加点ゼロ。
  - **局所的な固まり防止（従属。+12）**: 直近の同科目コマとの日間隔が理想間隔（期間日数÷コマ数）以上なら加点。
  - **なぜ絶対位置が要るか**: 間隔だけを見る項は「理想間隔以上なら常に満点」で、しかも同点なら日付昇順で採るため、**期間全体としては前方に寄る**。絶対位置で押さえると「6コマ目は必ず後方を狙う」ようになる。
  - **実測（合成データ・seed 1/7/42/99/2026）**: 均等度の平均 0.811 → **0.872**、最悪ケース 0.772 → **0.858**。seed42 の期別コマ数 30/29/22/21 → **28/28/23/23**。割当コマ数はほぼ不変（seed1 のみ 91→90、他は同数）。
    - 参考: 設定を**OFFにすると** 均等度 0.654 / 期別 41/33/19/9 まで崩れる（＝この2項が効いている証拠）。
  - **重みの決め方**: `spreadAnchor`/`spreadIdeal` を振って比較した。局所項を弱める（12→8）と可能枠が狭い実データで均等度が下がったため、局所項は12のまま絶対位置を20にした。
  - 偏りの計測は `src/lib/koushu-allocator/balance.ts` の `computeSubjectBalance()` を唯一の正とする（画面表示とテストで同じ定義を使う）。`stats.subjectBalance` に載り、シミュレータの「科目バランス」パネルがこれを描画する。
- 同日に同科目（許可時のみ発生）は減点
- 連続優先: 同日にこの生徒の既配置があり隣接コマなら加点（設定ONのとき）
- 講師スコア: 固定講師+50 / 過去担当+30 / 科目対応+20 / 性別一致+10 / 出勤+5（既存 MATCH_CONFIG 準拠）
- 講師の継続性: この生徒×科目で既に割り当てた講師なら**小さく加点**（低優先の明示。目安+8）
- 負荷平準化: 期間内の担当本数が少ない講師ほど**小さく加点**（目安: 本数差×1〜2点。決定を覆すのは同点近傍のみ）

候補ゼロのタスクは**その時点では配置せず**スキップ（リペアに回す）。

### 5-3. リペア（1パス）

未割当タスクごとに: 配置済みタスク1件を別の実行可能セルへ**1手だけ動かして**空いたセルに入るか探索（入替え）。見つからなければ未割当確定。未割当は理由を分類して報告:
`可能表未提出` / `可能枠不足`（生徒の枠自体が足りない） / `講師不足`（枠はあるが置ける講師がいない） / `席不足`（教室満席） / `上限到達`（1日上限・同日制約で入らない）

### 5-4. 出力

- `schedule_match_batches` + `schedule_match_proposals`（teacher NOT NULL、**ratio/duration_minutes/half_position 付き**）で下書き保存。
- パネルで確認 → 一括公開/個別公開/却下（現行フロー）。公開時に3列を entries へ継承。
- 座席表には既存の★仮チップで重畳表示（半コマ・1対1の見た目は StudentCard の既存表示に乗る）。

### 5-5. 再実行

- **破棄モード**: この期間・この教室の draft を全削除 → 公開済み・手動配置だけを occupancy に積んで再構築。
- **差分モード**: draft も occupancy と残本数に算入し、埋まっていないタスクだけ追加配置。
- どちらでも公開済み・手動配置には触れない。

---

## 6. 実装フェーズ

| フェーズ          | 内容                                                                                                                                 | 主な変更                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| **P1 データ**     | 申込の KomaSpec 化＋正規化アクセサ／申込UI（比率・時間セレクト）／proposals 3列マイグレ＋publish 継承                                | seasonalCourses.ts, KoushuEnrollmentFormModal, 読み出し5箇所, schedule-match.ts, マイグレ（MCP apply） |
| **P2 アロケータ** | `generateKoushuIndividualProposals` を本仕様で書き直し（可能表正典化・講習シフト正典化・seatOccupancy 統合・制約強い順・実行時設定） | koushu-match.ts（ほぼ全面）, KoushuControlPanel（設定欄・再実行モード）                                |
| **P3 仕上げ**     | リペア1パス／継続性・負荷平準化・連続優先のソフト項／未割当理由の分類表示                                                            | koushu-match.ts, パネル表示                                                                            |

各フェーズで `npx tsc --noEmit`（ヒープ不足時は NODE_OPTIONS=--max-old-space-size=4096）＋ seatOccupancy のテストに割当ロジックのユニットテストを追加（合成データで: 1対1排他・半コマペア・上限・同日制約・分散）。

---

## 7. リスク・注意

- **proposals の3列欠落**は既存バグ予備軍（半コマ情報が公開で消える）。P1 で必ず先に塞ぐ。
- 生徒可能表の time_slot はテキスト "HH:MM-HH:MM"。slot 解決は開始時刻先頭5文字一致（配置ストリップと同実装）。コマ時間を変更した過去期間の提出はズレうる→解決不能スロットは無視し、件数を実行ログに出す。
- 配置ストリップの「満席」判定は現在講師人数の単純比較。P2 で `canPlaceEntry` ベースに揃える（1対1・半コマを正しく反映）。
- 講習の下書き擬似エントリの「常に1対2・全コマ」ハードコード（page.tsx）は P1 で proposal 追随に変更。
- `koushu-match.ts` は formation='individual' 決め打ちを維持（ユーザー定義形態は対象外＝計画書 §4 のスコープ外宣言どおり）。
- 週次再生成は kind='regular' のみ削除のため講習コマは安全（実装済み）。

---

# 第2部: 講習申込のWeb化＋本番配線（2026-07-28 設計確定）

現状は提案書を紙に印刷して申込ませ、申込コマ数を `student_progress.application_count` に手入力している。
これをWeb化し、**科目・授業形式・45分・通塾可能日程を申込時にすべて揃える**。
それにより第1部のアロケータが本番データで動くようになる（現状は科目がハッシュの仮置き、可能表が通塾日程のフォールバック）。

## 8. 確定した設計判断（第2部）

| #   | 論点                                   | 決定                                                                                                                          |
| --- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 13  | 申込の入力者                           | **保護者がスマホで直接**。紙運用を置き換える。教室の入力代行は作らない                                                        |
| 14  | 授業形式(1対1/1対2)・45分/90分の決定権 | **教室が提案時に決める**。保護者は確認のみ（料金に直結するため）                                                              |
| 15  | 通塾可能日程の聞き方                   | **日別カレンダー（日×コマ）で全○初期・出られない所に×**。可能枠を最大化したいので減点方式にする                               |
| 16  | 科目の正典                             | **`subjects` を唯一の正典**にし、`textbooks` に `subject_id` を追加（§9-1）                                                   |
| 17  | 45分の表現                             | **申込側に持つ**（`subjects.duration_minutes` は既定値扱い）。**業務ルール: 45分は小1〜小4のみ選択可**。この前提は崩さない    |
| 18  | 高校の理科・社会                       | `subjects` に generic な 理科(high)・社会(high) を追加。細分化済みの化学・物理等はそのまま併存                                |
| 19  | 申込フォームの入口                     | **2経路とも用意**: 講習提案書からトークンURL/QR（個別配布）＋ポータルから生徒コード入力                                       |
| 20  | 申込データの保存先                     | **`koushu_enrollments` に直書き**（専用の公開API）。`form_responses` には相乗りしない＝`form_type` に `'koushu'` を追加しない |
| 21  | 自動配置の実行単位                     | **学年を複数選択して実行**。学年ごとに順次実行しても既存配置として尊重されるので衝突しない                                    |
| 22  | 公開時期                               | **2027年2月のスケジュール公開時に切替。それまで全部非公開**（§12）                                                            |

## 9. データモデルの変更

### 9-1. 科目の値空間を1つにする（最優先・他の全部の前提）

**問題**: 申込は `koma_by_subject` のキー＝`subjects.id`（UUID）、講習提案書は `textbooks.subject`（自由入力text・FKなし）。値空間が2つに割れており「提案書を見せて申込ませる」が成立しない。

**実データの確認結果**（本番・2026-07-28時点）:

- `textbooks.subject` は **6値のみ**（英語135/国語131/数学117/算数99/理科86/社会80）で**全て `subjects.name` と完全一致**
- `subjects`(53件) は **科目名 × `grade_category` × `duration_minutes`** で行が分かれる
- `textbooks` にも `grade_category` があるため `(subject, grade_category)` で解決可能:

| 判定     | 教材数 | 内容                                                                                                     |
| -------- | ------ | -------------------------------------------------------------------------------------------------------- |
| 一意     | 447    | そのまま解決                                                                                             |
| 候補2つ  | 181    | 小学の算数・国語・英語。差は90分/45分だけ → **90分の行に寄せる**（教材は内容の単位であり授業長ではない） |
| 該当なし | 20     | 高校の理科12・社会7（`subjects` 側に generic 行が無い）＋`grade_category` NULL 1件                       |

**手順（この順序で）**:

1. `subjects` に 理科(high, 90) / 社会(high, 90) を追加（決定18）
2. `textbooks` に `subject_id uuid REFERENCES subjects(id)` を追加（NULL可）
3. バックフィル: `(textbooks.subject, textbooks.grade_category)` → `subjects(name, grade_category)` かつ `duration_minutes = 90` で解決。`grade_category` NULL の1件は手当て
4. `textbooks.subject`（text）は**表示用に残す**（既存の多数の参照を壊さないため）。以降の新規ロジックは `subject_id` を使う
5. 解決できなかった行を数えて運用に出す（黙って NULL のまま進めない）

**罠**: `subjects` は school_id を持たない（全教室共通マスタ）。同名複数行は学年カテゴリと45分の違いなので、school で分岐する実装を書かないこと。

### 9-2. 申込の `koma_by_subject` を KomaSpec 化（§3-1 の実装）

`koushu_enrollments` は**本番0行**なので移行負担なし。ただし後方互換アクセサは既存コードのために用意する。

```ts
// 現在: Record<subjectId, number>
// 変更後: Record<subjectId, number | KomaSpec>
export interface KomaSpec {
  koma: number;
  ratio: 1 | 2;
  duration: 45 | 90;
}
export function normalizeKomaBySubject(v: unknown): Record<string, KomaSpec>;
// number が来たら { koma: n, ratio: 2, duration: 90 } に正規化（既定値）
```

`duration: 45` は**生徒の学年が1〜4のときのみ許可**（決定17）。API側でも検証しUIでも出さない。

### 9-3. 通塾可能日程の保存先

**`seasonal_shift_student_submissions` ＋ `_slots` に一本化**（§2の既定方針どおり。新テーブルを作らない）。

- 親: `student_id`, `submitter_email/name`, `allow_edit`, `edit_token`, `matching_consumed`
- 子: `shift_date` × `time_slot`("HH:MM-HH:MM") × `available boolean`
- **×方式の保存**: 画面は全○初期だが、DBには**開講枠すべての行を書き**、×を付けた枠だけ `available=false` にする（「行が無い＝未提出」という第1部の意味論を守るため。行が無いと可能表未提出と区別できない）
- 開講枠の正典は `seasonal_shift_slot_settings`(`slot_date` × `time_slot` × `is_open`)。`setting_id` は講師版と共通の `seasonal_shift_settings` を流用する既存設計に従う

### 9-4. 提案テーブルの3列追加（既存バグの是正・P1）

`schedule_entries` には `ratio`/`duration_minutes`/`half_position` があるのに `publishProposal` の INSERT に含まれず、`schedule_match_proposals` にも列が無い。**公開時に必ず既定値で書かれる**（調査で現存を確認済み）。

1. `schedule_match_proposals` に `ratio smallint DEFAULT 2 CHECK(1,2)` / `duration_minutes integer CHECK(45,90)` / `half_position text CHECK('first','second')` を追加
2. `publishProposal`（`src/lib/api/schedule-match.ts:114-168`）の INSERT ペイロードに3列を追加
3. `KoushuControlPanel` の下書き一覧に3列を表示

## 10. 講習申込フォーム（保護者向け・非公開で構築）

### 10-1. ルートと本人確認

| 入口                   | URL                           | 本人確認                                                         |
| ---------------------- | ----------------------------- | ---------------------------------------------------------------- |
| 講習提案書から個別配布 | `/koushu-apply/[token]`       | トークン（`test_prep_proposals.token` の前例に倣い乱数列を発行） |
| ポータルから           | `/portal/[schoolCode]/koushu` | `student_code` 完全一致（`/seasonal-shift-student` と同方式）    |

どちらも解決後は同一のフォーム本体コンポーネントを描画する。トークンは失効・再発行可能にする。

**注意**: 生徒個別の可能枠を扱う既存フォームは `/portal/` 配下ではなく `/seasonal-shift-student/[settingId]` にある。zoukoma フォームは学校設定から機械的に日程表を生成しているだけで生徒個別ではない（設計時に混同しないこと）。

### 10-2. 画面の流れ（スマホ375px前提）

1. **提案の確認** — 提案書の科目・単元・提案コマ数を読み取り専用で表示。授業形式と45分/90分も**教室が決めた値を表示するだけ**（決定14）
2. **申込コマ数の確定** — 科目ごとに数値を入れる（提案コマ数を初期値に。0=申込なし）
3. **通塾可能日程** — 開講枠を日×コマのカレンダーで全○表示し、出られない枠に×を付ける（決定15）
4. **確認 → 送信**

### 10-3. 送信API

`POST /api/koushu-apply` を新設。service-role クライアントで RLS をバイパスする既存パターン（`src/app/api/portal/form-responses/route.ts` / `src/app/api/seasonal-shift-student/submit/route.ts`）に倣う。

1. 公開期間チェック（`is_active` / 期間内）→ 期間が無ければ 404（§12の非公開担保）
2. トークン or `student_code` から `student_id` を解決
3. `koushu_enrollments` を upsert（`upsertKoushuEnrollment` を KomaSpec 対応に拡張）
4. `seasonal_shift_student_submissions` ＋ `_slots` を upsert
5. 45分が学年1〜4以外に来ていたら 400 で弾く
6. 通知（メール/プッシュ）は失敗しても申込自体は成功扱い（既存パターン踏襲）

### 10-4. 入口の管理UI

- **ポータル設定**（`src/app/settings/portal/page.tsx`）: 公開期間の管理へのリンクを追加。`FORM_TYPE_TO_PERIODS_PATH` には載せない（`form_type` を増やさないため独立エントリにする）
- **講習提案書**（`src/app/courses/proposals/page.tsx`）: 生徒ごとの行に「申込リンク発行 / QR表示 / 申込状況（未・済）」を追加。**公開期間が無い間はボタンを無効化**

## 11. 本番配線UI（/schedule）

`KoushuControlPanel` は現状ワンクリック実行のみ（設定欄・再実行モードは未実装）。ここに実行パネルを作る。

- **学年の複数選択**（決定21）。小学生/中学生/受験生のショートカット付き。学年は `src/types/database.ts` の `GRADE_LABELS`(1〜13) を import して使う
  - **罠**: `gradeLabel` 相当のローカル実装が38ファイルに重複しており、その多くは grade=13(既卒) を「高4」と誤表示する。新規UIでは必ず `GRADE_LABELS` を使う
- **実行時設定**（§4の表）: 1日上限コマ数／連続優先／同一科目の同日可否／科目の均等分散。前回値を localStorage 記憶
- **再実行モード**: `schedule_match_batches.mode` に `overwrite`/`diff`/`partial` の3値が既にあるがUIが無い。§5-5 の破棄/差分をここに出す
- 実行 → 下書き（`schedule_match_batches` + `schedule_match_proposals`）→ 座席表に★仮チップ重畳 → 個別/一括公開（既存フロー）
- 室長以上のみ表示

## 12. 非公開の担保と切替計画

**2027年2月のスケジュール公開時に切替。それまで保護者から見える面には一切出さない。**

機能フラグは新設せず、次の2点で担保する:

1. **公開期間が無い＝保護者に見えない**。`/koushu-apply/[token]` と `/portal/[schoolCode]/koushu` は公開期間レコードが無ければ404
2. **管理側UIはロールガード**（室長以上）。提案書の「リンク発行」ボタンは公開期間が無い間は無効

**並走**: 紙運用（提案書印刷 → `student_progress.application_count` 手入力）は2027年2月まで維持する。新旧どちらのデータ経路も壊さないこと。切替時に、どちらを申込の正典とするかを一度だけ切り替える。

## 13. 実装フェーズ（第2部）

| フェーズ            | 内容                                                                                            | 前提                     |
| ------------------- | ----------------------------------------------------------------------------------------------- | ------------------------ |
| **Q1 科目の統合**   | `subjects` に高校理社2行追加 → `textbooks.subject_id` 追加＋バックフィル → 解決不能件数の可視化 | なし。**他の全部の前提** |
| **Q2 データ拡張**   | `koma_by_subject` の KomaSpec 化＋正規化アクセサ／`schedule_match_proposals` 3列＋publish継承   | Q1                       |
| **Q3 申込フォーム** | 公開ルート2本＋送信API＋スマホUI（提案確認→コマ数→×カレンダー）                                 | Q1, Q2                   |
| **Q4 入口**         | ポータル設定の公開期間管理／提案書のリンク・QR・申込状況                                        | Q3                       |
| **Q5 本番配線**     | /schedule 実行パネル（学年複数選択・設定・再実行モード）→下書き→公開                            | Q2                       |
| **Q6 切替**         | 2027年2月。紙運用からの移行                                                                     | Q3〜Q5                   |

各フェーズで `npx tsc --noEmit`（`NODE_OPTIONS=--max-old-space-size=4096`）＋ Prettier ＋ 既存テストを通す。本番DDLは MCP の `apply_migration` で当てる（`db push` はローカルとの版番号不一致で13本再適用する地雷がある）。
