# 指導形態別スケジュール管理（個別・小集団・プログラミング…）計画書

> 2026-07-09 起案、同日改訂。座席表を「指導形態ごとの複数ボード（タブ切替）」に再編し、**指導形態自体を設定画面から作成・削除できる**動的マスタ方式にする計画。正典はこのファイル。

---

## 1. 要件（ユーザー確定事項）

| 項目           | 決定                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 管理イメージ   | **個別・小集団・プログラミングの「3枚のボード」**をタブで切替。1画面同時表示ではない                                                                                     |
| 指導形態の管理 | **形態を設定画面から新規作成・削除できる**（小集団/プログラミングはハードコードしない。将来の速読・英会話等も追加だけで済む）                                            |
| 重複制約       | 同一生徒を同じ時間帯に複数形態へ入れられない（形態横断で時間帯オーバーラップ禁止）                                                                                       |
| 授業の性質     | 毎週固定ルーティン（通塾日程＝週次パターンとして登録し、座席表へ自動生成）                                                                                               |
| クラス概念     | 作らない。曜日×時限×講師の枠に生徒を直接置くだけ（同じ枠＝実質同じクラスとして暗黙管理）                                                                                 |
| 時間帯         | **形態ごとに独立したコマ時間**を設定（例: 小集団=18:00-19:00 / 19:10-20:10 / 20:20-21:20。プログラミングは別枠）                                                         |
| UI原則         | **週間ボードは1画面（スクロールなし）に収める**。現行座席表はカードが大きく縦スクロール必須 → 密度を上げて改修する。新設する形態ボードも同じ原則で設計（2026-07-09追加） |

## 2. アーキテクチャ判断

### 2.1 指導形態マスタ（動的）方式 — enum固定拡張は不採用

初案は formation を4値enumに広げる案だったが、「形態を作成・削除できる」要件により**マスタテーブル方式**に変更する。

```sql
CREATE TABLE schedule_formations (
  key         text PRIMARY KEY,      -- 'individual' / 'group' / 自動生成slug（ユーザー定義分）
  label       text NOT NULL,         -- 表示名: 個別 / 集団 / 小集団 / プログラミング…
  lane_type   text NOT NULL CHECK (lane_type IN ('individual','group')),
              -- 描画と講師重複ポリシーの型:
              --   individual = 1講師1-2名の座席グリッド型
              --   group      = 1講師N名のカードレーン型（小集団/プログラミングはこちら）
  is_system   boolean NOT NULL DEFAULT false, -- individual/group は true（削除・改名不可）
  is_active   boolean NOT NULL DEFAULT true,  -- false でタブ非表示（ソフト削除）
  sort_order  int NOT NULL DEFAULT 100,
  created_at  timestamptz DEFAULT now()
);
-- シード: ('individual','個別','individual',true), ('group','集団','group',true)
```

- 既存5テーブル（`schedule_time_slots` / `schedule_entries` / `schedule_regular_patterns` / `koushu_enrollments` / `schedule_match_proposals`）の formation 列は **CHECK制約 `IN ('individual','group')` を外し、`REFERENCES schedule_formations(key)` の FK に置換**。
- `schedule_time_slots` が既に `UNIQUE(school_id, formation, slot_number)` で形態別コマ時間を持てる設計なので、動的形態がそのまま乗る。ここが本計画の土台。
- **key はユーザーに入力させず自動生成**（例: `f_` + 短ID）。ユーザーが触るのは label のみ。

**作成・削除のルール**:

- 作成: 名称を入力するだけ。lane_type は当面 'group' 固定（1講師N名型）。将来必要なら選択式に
- 無効化（is_active=false）: いつでも可。タブが消えるだけでデータは保持
- 物理削除: 参照データ（コマ時間・パターン・エントリ）が無い場合のみ（FK RESTRICT が自動で守る）。データがある場合はUIで無効化へ誘導
- `individual` / `group` は is_system=true で削除・改名不可（個別=メイン座席グリッド、集団=講習の集団レーンとして既存機能が依存）

### 2.2 フロントの形態メタデータは DB 駆動

- `ScheduleEntryFormation` 型は union → `string` に緩める（`'individual'` / `'group'` は定数として保持）
- 初案の `FORMATION_CONFIG`（静的Record）は **`getFormations()` API + コンテキスト/props 渡し**に置換。label・lane_type・sort_order をDBから取得し、タブ描画とポリシー分岐（講師重複・レーン型）に使う
- 判定ヘルパーを `src/lib/utils/formations.ts` 等に集約: `isIndividual(key)` / `isGroupLane(formation, master)` — 直値分岐の一掃先

### 2.3 重複チェック（要件の核）

- **生徒**: `checkStudentTimeConflict`（src/lib/api/schedule.ts:252）は formation 非依存で全パターン/全エントリを時間帯オーバーラップ判定 → **形態横断の重複禁止は既存ロジックがそのまま効く**。新形態の登録経路が必ずこれを通ることを保証するのが作業の中心
- **講師**: 現状 `formation !== 'group'` のときだけチェック（集団は全スキップ＝粗い）。新方針:
  - 同一 (日付, time_slot, formation, 講師) 内の複数生徒は許可（1講師N名）
  - **別の枠との時間帯オーバーラップはブロック**（小集団18:00-19:00を持つ講師に個別18:20は入れられない）
  - `checkTeacherTimeConflict` に「同一枠は除外して時間帯比較」を追加し、lane_type='group' 全体に適用（既存 group の挙動変更になるため回帰確認要）

### 2.4 定員管理

形態が動的なので、列固定の `school_class_capacity` は使わず**汎用テーブル**（初案と同じ、動的方式とは元々相性が良い）:

```sql
school_formation_capacity (
  school_id uuid, formation text REFERENCES schedule_formations(key),
  max_students_per_group int DEFAULT 8,   -- 1枠あたり生徒数上限
  max_concurrent_groups int DEFAULT 1,    -- 同時刻の枠数上限
  UNIQUE(school_id, formation)
)
```

既存 individual/group は現行列のまま（動いているものは触らない）。

### 2.5 データフロー（既存踏襲）

```
設定: 指導形態を作成（例「小集団」）→ 形態別コマ時間を登録 → 定員設定
運用: 週次パターン登録（formation=小集団のkey）
  → schedule_regular_patterns（生徒1人=1行、同じ曜日×時限×講師の行群=暗黙クラス）
  → generateWeeklySchedule が schedule_entries(kind='regular', formation継承) を自動生成
  → 座席表の形態タブに描画。欠席=既存の出欠、振替=既存 createTransferEntry
```

### 2.6 タブ構成

`/schedule` のタブ = 「個別」＋ **is_active なユーザー定義形態**（sort_order順）。

- 「個別」タブ = 現行画面そのまま。講習/テスト対策モード、集団（group）レーンも従来通りここに同居（group はユーザー向けタブには出さない＝講習専用レーンのため）
- 形態タブ = その形態のコマ時間×日付のレーングリッド（1講師N名カード）
- コマ時間未設定の校では空状態＋設定ページへの誘導を表示

### 2.7 UI密度設計 — 「1画面に収まる週間ボード」

現行座席表の問題: 生徒カード・講師カードの余白が大きく、3限だけで画面の大半を占め、夕方の時限を見るのに縦スクロールが必要。

**設計原則**:

- 目標 = 通常運用（1コマあたり講師〜5-6名・稼働3時限程度）が **1080p（実効高さ約950px）に縦スクロールなしで収まる**
- **横方向は増やさない**: 1日セル内の2列化は過去に「生徒名が読めない」で却下済み（Lラウンド）。密度は縦圧縮で稼ぐ
- 超過時（講師数が多い日）はスクロール許容だが、発生頻度を大幅に減らす

**確定仕様（2026-07-09 モックv2＋デザインレビューで確定。正典モック = `docs/mockups/schedule-density-v2.html`）**:

1. **1日セル内は講師ブロック2列**（過去の2列却下は「2段カードのまま押し込んで文字を縮めた」のが敗因。今回は行の構成要素を減らして文字サイズを守る方式で再挑戦し、レビューで条件付きGO→修正済み）
   - 列幅 ~143px（1920px時）。分配は**順序保存の二分割**（講師の表示順を保ち累積高さが半分の位置で分割。高さ均等貪欲は探索順が予測不能になるため不採用）
   - 実測: 平均6講師/コマ×3時限で 806px/837px（1080pスクロールなし）。ストレス（講師10名/生徒20名）でもセル高320pxで収まる。1列だと+523pxオーバーで破綻＝2列が1画面要件の生命線
2. **生徒 = 1行表示**（18px）: 「氏名 学年 [科目色チップ]」。氏名は ellipsis+title。現実的和名での切り詰め率 2.7%（実測）
3. **科目は色チップ**（漢字ラベル併記＝色オンリー依存しない）: 国=indigo / 数算=blue / 英=emerald / 理=teal / 社=amber / HAL=violet。**roseは状態色専用に予約**（科目に使わない）。P/D型色覚対応で背景輝度を段階化＋自色相1px縁
4. **残席は定員チップ「1/2」「2/2」**: 空き=緑数字 / 満員=グレー / **rose=定員超過・異常のみ**。満員rose面は「71%が赤=図地反転」でレビューNG→廃止。「空き探し」=緑数字スキャン
5. **操作アイコンは恒常ガター方式**: 右40pxを常設アクション領域、アイコン常時 opacity .35→ホバーで1。ホバー完全格納は「振バッジが隠れる＋タッチで発見不能」でレビューNG→不採用
6. **振バッジに期限切迫のroseバリアント**（title=期限日）
7. **未配置はカウントバッジでセル最上部**（背の高いセルで沈まない位置）。クリックでチップ展開
8. 講師✕はブロックホバー時のみ / 講師追加は細い「＋」バー / 授業なし時限の折りたたみ維持 / ツールバー・凡例1行統合 / 1列⇔2列トグルは個別タブのみ

**適用範囲**: 個別タブ（現行グリッドの密度改修）＋新設の形態ボード（小集団/プログラミング。集団カードは1列のまま、カード言語・チップだけ統一。小集団は見出しに科目チップ1個、生徒行チップなし）。日次印刷ビューは対象外（A4最適化済みのため独立）。

**モックの履歴**: v1=1列高密度（方向性合意）→ v2=2列＋デザインレビュー反映 → v3=クリックメニュー・空席行・1対1・45分 → v4=列幅縮小・3層サーフェス・講師名中央寄せ → v5=高コントラスト・空き=緑 → v6=実アプリクローム統合・実トークン化 → v7=時限縦積み・行色化・文字サイズ → **v8=転置（日=行）モード追加（実装の正典 = `schedule-density-v8.html`）**。

**最終確定（2026-07-10 ユーザー承認・実装GO）**:

- **既定の向き = 転置（日=行）**。日単位scroll-snap＋sticky時限見出し。「日=列（週俯瞰・1画面）」はトグルで併存し、向きはユーザー設定として永続化
- **文字サイズ = 小（10.5px/行高18px）で固定**。標準/小トグルは実装しない（設定項目を増やさない）
- **体験もバッジ廃止 → 行色**（振替=青行 / 欠席=グレー行＋打消し線 / 体験=success系の行色。行色の意味は凡例に集約）
- **講習モード・テスト対策モードの挙動は変えない**（配置パネル・出席可能ストリップ・配置ハイライト・下書き★・未配置チップ・一括マッチング導線はそのまま。見た目のカード言語だけ新デザインに揃う）

**ユーザーフィードバック第2弾（2026-07-09）による改訂**:

1. **操作はカードクリック→アクションメニュー方式に変更**: 恒常ガター（右40px常設アイコン）を廃止。生徒行クリックでポップオーバー（欠席にする / 振替 / 取消し等）。出欠は**欠席のみ登録**（出席チェックは付けない）。ガター廃止で行がさらに狭くできる
2. **定員チップ「1/2」等は廃止**（満席は見ればわかる、の方針）。代わりに**空席プレースホルダ行**で可視化: 1対2で生徒1名なら破線の「空席」行を1行表示（=残席が構造で見える＋D&Dのドロップ先になる）。満席=空席行なし
3. **講師名の横に座席番号の入力欄**: 既存の `schedule_daily_booth_assignments`（講師×日付→ブース番号、現在は日次印刷用に#アイコンから設定）をインライン入力に昇格

### 2.8 個別指導の授業モデル拡張（1対1/1対2・45分授業）— 2026-07-09 追加要件

**a. 1対1 / 1対2 の選択（2026-07-09 確定）**

- 個別指導は 1対1 か 1対2 を選べる。**1対1の授業は生徒1名で満席**（2人目を入れられない）
- **比率の由来 = 生徒の契約（科目ごと）**。生徒×科目に ratio を持つ契約データが必要（既存に該当テーブルが無ければ `student_subject_contracts(student_id, subject_id, ratio)` 相当を新設。実装時に既存の受講科目データの有無を確認してから決める）
- 通塾日程の登録時に生徒＋科目を選ぶと ratio が自動で決まり、`schedule_regular_patterns.ratio`（1|2）→ `schedule_entries.ratio` にスナップショット継承
- 容量判定: 同一（講師×日付×コマ）内に ratio=1 のエントリがあれば席数1、それ以外は既存の max_students_per_teacher_individual（既定2）
- UI: 1対1 は空席行を出さない＋行に小さな「1:1」表示で満席理由を示す

**b. 45分授業（2026-07-09 確定: 半コマ占有モデル＝案A採用）**

- 正典: `subjects.duration_minutes`（45|90、小4以下の科目に45分が多い）。90分コマの中に45分の生徒が混在する
- **現場運用で「同じ席に前半45分・後半45分の2人を順次入れる」が実在する** → 席の占有を半コマ単位で計算するモデルを採る:
  - エントリに `duration_minutes`（科目から自動スナップショット）＋ `half_position`（'first' | 'second' | NULL=全コマ）を追加
  - 容量 = (講師×日付×コマ×半コマ) 単位の席数計算。90分エントリは両半を占有、45分は片半のみ
  - 生徒の重複チェックも実効時間帯で判定（コマ開始 + 前半/後半オフセットで start/end を導出して timeRangesOverlap へ渡す。45分前半の生徒は同日別コマの後半に入れる等が正しく判定される）
  - UI: 「45前」「45後」ミニチップ。片半だけ空いた席は「空席（後半45分）」の破線プレースホルダ行
  - 45分の実時間割り（前半=コマ開始〜+45分、後半=コマ終了-45分〜終了、間欠なし前提）は実装時に現場の実時刻を確認

### 2.9 UI改訂の確定条件まとめ（v3モックへの入力）

| #   | 条件                                                               | 状態     |
| --- | ------------------------------------------------------------------ | -------- |
| 1   | 2列レイアウト・順序保存二分割・1画面                               | v2で確定 |
| 2   | 科目色チップ（roseは状態専用）                                     | v2で確定 |
| 3   | 出欠→**欠席のみ**。ボタン類廃止、**行クリック→アクションメニュー** | 確定     |
| 4   | 定員チップ廃止 → **空席プレースホルダ行**（1対1は出さない）        | 確定     |
| 5   | 講師名横に**座席番号入力欄**（粒度=講師×日付、既存boothのまま）    | 確定     |
| 6   | 1対1/1対2（1対1=1名で満席、由来=生徒×科目の契約）                  | 確定     |
| 7   | 45分授業 = **半コマ占有モデル**（前半/後半詰め込みあり）           | 確定     |

**フェーズへの影響**: #3,4,5 は Phase U（UI改修）。#6,7 は座席表エンジン（容量計算・重複チェック・パターン生成）に踏み込むため**新フェーズ R（授業モデル拡張: ratio＋45分半コマ）**として Phase A の後に実施（形態マスタとは独立、個別指導のみに効く）。マイグレ: patterns/entries への ratio・duration_minutes・half_position 追加＋生徒×科目契約テーブル（既存データ確認後に設計）。

### 2.10 体験授業・追加授業の追加UI（2026-07-10 追加要件・確定）

モードセレクトの隣に「授業を追加」ボタンを置き、単発コマ（追加授業/体験授業）を登録できるようにする。既存の空きセルクリック起点（AddStudentToSlotModal）に加え、講師・日付・コマも選べる独立モーダルを新設。

**a. 体験の見込み客（未入会）= 問合せ名簿から選ぶ（inquiry_id 方式・確定）**

- 体験は入会前の見込み客も受けるため、`students` に存在しない人を扱う必要がある
- **`students` に仮レコードを作らない**（is_test 方式は不採用）。見込み客を名簿・請求・集計に構造的に出さないため、`schedule_entries` に `inquiry_id` を持たせて問合せを直接参照する
- マイグレ:
  - `schedule_entries.student_id` を **NULL 許容化**
  - `schedule_entries.inquiry_id uuid REFERENCES inquiries(id) ON DELETE SET NULL` 追加
  - CHECK: **student_id / inquiry_id はどちらか一方のみ**（`(student_id IS NOT NULL AND inquiry_id IS NULL) OR (student_id IS NULL AND inquiry_id IS NOT NULL)`）。既存行は全て student_id 有り・inquiry_id NULL で通る
  - 部分ユニークインデックス `(school_id, entry_date, time_slot_id, teacher_id, inquiry_id) WHERE inquiry_id IS NOT NULL`（NULL 複数許容の穴を塞ぐ）
- 入会したら既存の `inquiries.linked_student_id` フローで生徒化（このコマの student_id 移行は将来課題、当面は体験履歴として残す）

**b. 問合せ連動（確定）**: 体験コマ登録時に `inquiries.trial_at` にコマ日時をセットし、status を `trial_waiting`（体験待ち）へ自動更新（既に enrolled/trial_done 等の場合は status を下げない guard）

**c. 影響範囲（student_id を nullable にする波及）**: 体験×問合せのコマは終端的（出欠集計・振替・請求の対象外）。既存の student_id 前提ロジックは「student_id が無ければ体験×問合せとして扱う/スキップ」の null ガードで対応。主要な表示は StudentCard が inquiry フォールバックを持つ。checkStudentTimeConflict は見込み客には適用しない（他コマを持たない）

**フェーズ**: 新フェーズ **T（体験・追加授業UI）**。Phase R の授業モデルとは独立。

### 2.11 汎用配置モード（振替保留プール・授業追加の座席表配置・検索統一）— 2026-07-13 追加要件

①振替の保留プール ②授業追加のカレンダー配置・複数コマ一括 ③生徒検索の提案書仕様統一。3件とも講習/テスト対策の配置モードUI（セルハイライト＋クリック配置）に乗せる。

**a. 汎用配置セッション（基盤）**
- 既存の講習（placingKoushuStudent）/テスト対策（placingTestPrep）は**触らず**、第3の並列ステート `placingAdhoc`（mode: 'transfer' | 'lesson'）を追加し、gridPlacing / gridGetPlaceability / gridPlace / gridPlaceWithTeacher の三項連鎖に合流させる
- placeability: 過去日・休講日・生徒の時間重複（振替は excludeScheduleEntryId で元コマ除外、問合せ見込み客はスキップ）。セル背景クリック=担当未決定、講師カードクリック=講師指定（既存文化どおり）
- 配置中は上部にミニバナー（対象者名・科目・登録済みN コマ・「完了」ボタン）。出席可能ストリップは汎用ビルダーで対応（可能枠=全セル、配置済み/満席判定は既存3点セット流用）
- 個別タブ専用（形態ボードは対象外）

**b. ①振替保留プール（マイグレ不要）**
- 「保留」= 振替元を transferred_out 化し transfer_to_id を張らない状態（**既存スキーマで表現可能**。督促ボード getPendingTransfers と同じ条件）
- 保留の入口: TransferModal と TransferModeBar に「振替先が未定 → 保留にする」ボタン。API `holdTransfer`（createTransferEntry の前半を分離）
- プールUI: 座席表上部の折りたたみパネル（テスト対策パネルと同系）に保留中一覧（生徒・元日程・科目・期限残チップ）＋「配置」ボタン → placingAdhoc('transfer') 開始
- 確定: `completeHeldTransfer(fromEntryId, date, slotId, teacherId|null)` — transferred_in 作成＋transfer_to_id リンク（createTransferEntry の後半を分離・teacherId nullable 化で担当未決定振替も許容）。月内回数チェックは既存フロー踏襲

**c. ②授業追加の配置モード化・複数コマ一括**
- AddLessonModal を2ステップ化: Step1=種別・対象者（生徒/問合せ）・科目・比率/45分 →「座席表から日程を選ぶ」で placingAdhoc('lesson') 開始
- セルクリックごとに即1コマ登録（講習の落とし込みと同じ方式）。モード継続でクリックを重ねる=複数コマ一括。「完了」で終了
- 体験×問合せ: 最初の登録で trial_at セット＋体験待ち化（既存 markInquiryTrialScheduled）

**d. ③生徒検索の提案書仕様統一**
- 提案書ピッカーの仕様 = 全生徒事前ロード（active のみ）＋クライアント側フィルタ（姓名+かな連結の部分一致）＋学年グルーピング・sticky見出し
- この仕様の共通コンポーネントを新設し AddLessonModal の生徒選択を置換（提案書側は現状維持=同仕様の重複実装は将来統合）。問合せ検索（InquirySearchInput）は対象が異なるため現状のまま

**フェーズ**: **P2（配置モード拡張）**。マイグレ不要。

**P2改訂（2026-07-13 実機フィードバック）**:
1. **コマ数を先に指定**: 授業追加 Step1 にコマ数入力。指定数を配置し終えたら配置モードを自動終了。途中終了時は**残数を未消化プールへ**（新テーブル `schedule_pending_lessons`: 対象者・科目・kind・ratio/45分・残コマ数。保留振替と並ぶパネルから「配置」で再開、配置ごとに残数減・0で削除）
2. 振替保留の期限 = **元授業日の翌月末**（7月の振替→8月末。holdTransfer の期限設定を検証し、違えば修正）
3. **科目セレクトは対象者の学年区分に絞る**（生徒 grade→小/中/高マップ。見込み客は inquiries.grade テキストから推定、不明なら全表示）
4. **配置先の可否を講師カード単位で可視化**: 指導可能科目外・席占有(1対1/満席)・欠勤の講師は淡色＋クリック不可（理由title）。可の講師のみ強調（「指導できない人にも入れられそう」の解消）
5. **追加授業もバッジ→行色**（体験と同様。バッジは test_prep のみ残す。凡例更新）
6. 振替の月内回数制限（週N回=月N回上限・超過は警告後に例外可）は既存実装・保留配置経路でも適用済み＝変更なし

### 2.12 生徒の入れ替え（同コマ内・別講師）— 2026-07-13 確定

両方満席の講師間で生徒AとBを交換したい。現状は一方を別講師に退避→移動→戻す手間。ワンアクションの入れ替えを追加。

- **範囲 = 同じ日・同じコマ・別講師の2人**（時間は変わらない＝teacher_id の交換のみ。ユーザー確定: 同コマ内のみ）
- **指導科目外はブロック**（ユーザー確定）: 受け入れ側講師が相手の科目を指導できない場合は入れ替え不可（エラー表示）。teacher.teachable_subject_ids が空/未設定なら全科目可（既存慣習）
- UI: StudentActionModal に「入れ替え」→ 入れ替えモード（TransferModeBar と同系のバー）。同コマ・別講師の生徒行を候補として強調、それ以外を淡色、対象Aを選択表示。候補の生徒行クリックで交換確定→モード終了。指導科目外なら toast で理由表示しモード継続
- API `swapScheduleEntries(entryAId, entryBId)`（schedule.ts）: 同一 school/date/time_slot・別 teacher を検証→teachable 双方向検証→teacher_id を交換（2回の UPDATE。UNIQUE(school,date,slot,teacher,student) は student が異なるため衝突しない）。cancelled/transferred_out は対象外
- 個別タブ専用。講習/テスト対策/配置/振替モード中は無効（モード排他）。マイグレ不要

## 3. フェーズ計画

### Phase A: 基盤（既存挙動を変えずに土台を作る）

1. **DBマイグレーション**:
   - `schedule_formations` 新設＋ individual/group シード投入
   - 既存5テーブルの CHECK 制約を外し FK（RESTRICT）へ置換
   - `school_formation_capacity` 新設（2.4）
   - RLS: 読み取りは authenticated、書き込みは manager 以上（school_widget_settings と同型で）
2. **API**: `src/lib/api/schedule-formations.ts` 新設 — 一覧/作成/改名/無効化/削除（削除は参照ゼロのみ）。key 自動生成
3. **型**: `ScheduleEntryFormation` を string 化、`src/types/database.ts`（10箇所直書き）は supabase gen types で再生成。`src/types/schedule-match.ts:38` も。判定ヘルパー `formations.ts` 新設
4. **危険分岐の是正**（調査で特定済みの決め打ち箇所）:
   - `src/app/schedule/page.tsx:1030,604` — `!== 'group'` → `=== 'individual'`（**最重要**: 放置すると新形態が個別レーンに混入）
   - `src/app/schedule/page.tsx:1204` — テスト対策の時刻マップ構築 `=== 'group'` skip → `!== 'individual'` skip
   - `src/lib/api/schedule.ts:1200` — 講師重複チェック分岐を lane_type 参照に
   - `src/lib/api/schedule.ts:806` — `EntryRow.formation` 型ハードコード解消
   - `src/lib/api/schedule.ts:1304` / `koushu-period.ts:100,125` / `placement-availability.ts:128` / `schedule/page.tsx:553` / `koushu-match.ts:290,354` — individual 決め打ちは講習専用なので現状維持で正しいが、意図コメントを付けて明示
   - `KoushuPeriodCard.tsx:156-161` の三項ラベル → マスタ label 参照
   - `KoushuEnrollmentManager.tsx:103-104` / `KoushuEnrollmentFormModal.tsx:102-113` — 講習申込は individual/group の2列のまま（ユーザー定義形態は講習スコープ外）。ガードを追加して新形態データが来ても混入しないように
5. **検証**: 既存の個別座席表・講習モード・テスト対策モードが無変化であること（回帰）

### Phase B: 設定画面（形態の作成・削除＋コマ時間＋定員）

1. **指導形態管理UI**: `/settings/time-slots` に統合（コマ時間と形態は一体で管理するのが自然）
   - タブ行を schedule_formations 駆動に（is_system の個別/集団＋ユーザー定義形態）
   - 「＋形態を追加」ボタン → 名称入力で作成 → 新タブが生える → そのタブでコマ時間を登録
   - 形態の改名・並び替え・無効化・削除（参照ありは無効化へ誘導）。is_system は操作不可
2. 小集団3枠（18:00/19:10/20:20）・プログラミング枠は**この画面から運用として投入**（マイグレでは入れない）
3. `/settings/class-capacity` にユーザー定義形態のセクション追加（school_formation_capacity のCRUD、形態マスタ駆動で自動的に増減）

### Phase C: 週次パターン登録（通塾日程の形態対応）

1. **専用登録UI**: 「形態別クラス枠登録」— 曜日×時限×講師を選び、生徒を複数選択して一括登録 → 生徒ごとの `schedule_regular_patterns` 行を生成（formation付き）。既存 `RegularPatternForm`（formation未対応）はいじらず、`GroupKomaFormModal` の構造（講師+生徒複数選択）を週次パターン版に転用するのが近道
2. 登録時バリデーション: 生徒ごとに `checkStudentTimeConflict`（形態横断）/ 講師は 2.3 の新ポリシー / 定員は school_formation_capacity
3. `generateWeeklySchedule` の formation 継承確認（ロジックは汎用実装済み、型緩和のみで動く見込み。transferredKeys 保護の回帰確認必須 — 週全DELETE→再INSERT方式のため）
4. `/schedule/regular-patterns` 一覧に形態フィルタ/バッジ（マスタ label）

### Phase U: 座席表の密度改修（1画面化）— 形態機能と独立、先行着手可

1. HTMLモック `docs/mockups/schedule-density-v1.html` で密度スペック（2.7）をユーザー確認
2. `StudentCard` を1行表示に改修（ホバー時アクション表示含む）、`TeacherCard` ヘッダー1行化・残席ドット化
3. 未配置チップのカウントバッジ化＋展開、講師追加の細バー化、ツールバー/凡例の1行統合
4. D&D・配置モード・講習/テスト対策モードの回帰確認（カードDOM構造が変わるためドラッグ識別子まわりに注意）

### Phase D: 座席表タブUI（3枚のボード）

1. `/schedule` 上部に形態タブ（マスタ駆動・sort_order順）: 個別＋ユーザー定義形態
2. `GroupLaneGrid` を汎用化（すでに「渡されたスロット群を1レーンとして描く」作りに近い）: formation / capacity / 追加ボタン文言を props 化。行=その形態のコマ時間、列=日付、セル=講師+生徒Nのカード。**カード言語は Phase U の高密度スタイルで統一**
3. セル操作: 生徒の追加（→ Phase C の登録モーダルを日付起点で開く）/ 欠席マーク / 振替（同一形態の別枠へ。`createTransferEntry` 流用）
4. タブ間の見落とし防止: 個別タブのヘッダーに形態別の本日人数サマリチップ（任意・後回し可）

### Phase E: 周辺・仕上げ

1. `/today` / `/my-schedule` / portal student-dashboard のバッジをマスタ label 参照に（現状 group 以外は無表示になるだけなので優先度低）
2. 日次印刷ビュー（`ScheduleDailyPrintView`）への形態別掲載（要否をユーザーに確認してから）
3. ヘルプ `help/page.tsx` FAQ_DATA 更新（機能変更時の必須作業）
4. 引き継ぎノート `docs/schedule-system-handoff.md` に追記

## 4. スコープ外（今回やらない）

- 名前付きクラス管理（ユーザー決定: コマ直置き）。将来必要になったら `schedule_class_groups` テーブル＋pattern への FK で後付け可能
- ユーザー定義形態の**授業報告書**（集団の報告書自体が未実装のため一緒に将来検討）
- 請求連動・講習(koushu)へのユーザー定義形態適用・自動マッチング（koushu-match は individual 決め打ちのまま）
- lane_type='individual' のユーザー定義形態（当面 group 型固定。座席グリッド型を増やす需要が出たら解禁）
- students.is_programming フラグとの連動（既存フラグは生徒属性でスケジュールと独立。登録UIの生徒検索フィルタ初期値程度は Phase C で検討）

## 5. リスク・既知の罠

| リスク                                                                 | 対策                                                                                    |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `!== 'group'` 分岐の見落とし → 新形態が個別レーンに混入                | Phase A で決め打ち箇所を一括是正してから機能を作る（調査済みリストあり）                |
| formation の型を string に緩めることでタイポ検出が失われる             | 定数 `INDIVIDUAL_FORMATION`/`GROUP_FORMATION` を用意し直書き禁止。DB側は FK が守る      |
| generateWeeklySchedule の週全DELETE→再INSERT で振替/キャンセル枠と衝突 | 既知バグの再発点。transferredKeys 保護の回帰テスト必須                                  |
| 講師重複チェックの挙動変更（group全スキップ→枠単位判定）               | 既存集団コマ作成で回帰確認。問題があれば group のみ旧挙動維持のフラグをマスタに持たせる |
| 形態削除でデータ孤児化                                                 | FK RESTRICT＋UIは無効化（is_active=false）優先。物理削除は参照ゼロのみ                  |
| database.ts 生成型の手動編集とのコンフリクト                           | supabase gen types で再生成に統一                                                       |
| 検証時に PWA SW キャッシュで旧JSが配られる                             | caches.delete + reload（既知の罠）                                                      |
| マイグレ適用は CLI 不可                                                | Supabase MCP の apply_migration を使う（新DB bniistrbylypnwpfqszb）                     |

## 6. 実施順序と規模感

**U（密度改修）は他と独立** — モック確認後いつでも着手可。おすすめは U を最初に片付けてから A に入る（現行UIの不満解消が先に届く＋Dで作る形態ボードのカード言語が最初から高密度版で書ける）。

U（密度改修・1画面化）→ A（基盤・是正）→ B（設定・形態管理）→ C（パターン登録）→ D（座席表タブ）→ E（仕上げ）。

- U はコンポーネント改修が主（スキーマ変更なし）。モック合意が前提
- A+B は中規模（マスタ新設＋是正＋設定UI）。ここまでで既存機能の見た目は変わらない（time-slots のタブがマスタ駆動になるのみ）
- C が新規実装の中核（登録モーダル＋バリデーション配線）
- D は GroupLaneGrid 汎用化が主。新規描画コードは少ない見込み
- 各フェーズ完了時に `npx tsc --noEmit` + 既存座席表の回帰確認
