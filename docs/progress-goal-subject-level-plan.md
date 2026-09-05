# 進行表の目標を「生徒×科目」で持つ（データ移行のみ・UI変更なし）

作成日: 2026-09-05

## 1. 解きたい問題

進行表の目標（`student_textbook_exams`）は親が `student_textbooks`（生徒×テキスト）になっている。
そのため次の2つが起きる。

1. **同じ科目のテキストごとに目標が分かれる。** 「英語の模試で偏差値60」という1つの目標のために
   文法テキストと長文テキストをやっているのに、システム上は「文法テキストの目標」と
   「長文テキストの目標」という別物として管理される。
2. **テキストを終えて次のテキストに移ると目標が取り残される。** 目標は古いテキストにぶら下がったまま
   残り、新しいテキストには目標が無い状態になる。「目標未設定」アラートも科目単位ではなく
   テキスト単位で出るため、同じ科目で重複して鳴る。

目標は本来「科目に対して立てるもの」で、テキストはその達成手段。データの階層が実態と逆になっている。

## 2. この作業の範囲

**データの持ち方だけを変える。画面の見た目・操作は一切変えない。**

- 目標カードの位置、編集モーダル、「次の目標へ」フロー、面談パネル、報告書ヘッダーはそのまま。
- 変わるのは「同じ科目のテキストは同じ目標を共有する」という一点だけ。
  英語の文法テキストと長文テキストのカードには、同じ目標バッジが出る。
  どちらのカードから編集しても同じ目標を編集することになる。
- テキストを完了しても、目標は科目に残るので次のテキストに引き継がれる。

### 決定事項（2026-09-05）

| 論点 | 決定 |
| --- | --- |
| 科目の粒度 | 進行表タブと同じ 5教科＋その他。`categorizeSubject()` の分類をそのまま使う |
| 5科合計・全体の目標 | 作らない |
| 目標点の種別（点数/偏差値/級） | 足さない。`target_score` は今までどおり整数1本 |

## 3. UIを変えずに済ませる仕組み

UI側は `tb.exams`（`StudentTextbookWithDetails.exams`）を読んでいるだけで、
そこに入っている行がどのテーブルの誰の子かは見ていない。
`activeExamOf()` も `tb.exams` から「一番近い将来の試験、無ければ先頭」を選ぶだけ。

したがって **読み込み層で `tb.exams` を「そのテキストの科目の目標」で埋めれば、
UIコンポーネントは1行も変えずに科目単位の挙動になる。**

```
変更前: student_textbooks ─(1:N)→ student_textbook_exams ─(1:N)→ action_goals
変更後: students ─(N: 科目ごと)→ student_textbook_exams ─(1:N)→ action_goals
        student_textbooks ──(表示時に科目キーで解決)──┘
```

`action_goals` はスキーマ変更不要。親の目標が科目単位になるので自動的に科目単位になる。

## 4. DB変更

### 4-1. 列の追加

```sql
alter table public.student_textbook_exams
  add column if not exists student_id  uuid references public.students(id) on delete cascade,
  add column if not exists subject_key text;
```

- `subject_key` は `'国語' | '数学' | '英語' | '理科' | '社会' | 'その他'` の6値。
  **`textbooks.subject` の生の文字列ではなく、`categorizeSubject()` で分類した後の値を入れる。**
  生の値は「英語」「English」「英文法」などバラバラで、そのままだと同じ科目が分かれてしまう。
- ユニーク制約は付けない。同じ科目に複数の目標が時系列で並ぶのが正常（履歴として残す設計）。

インデックス:

```sql
create index if not exists idx_student_textbook_exams_student_subject
  on public.student_textbook_exams (student_id, subject_key, exam_date);
```

### 4-2. 旧FKの扱い（重要）

`student_textbook_id` は**残す**が、意味を「作成元テキストの記録」に変える。読み込みには使わない。

**FKを `ON DELETE CASCADE` から `ON DELETE SET NULL` に必ず変更すること。**
放置すると、テキストを1冊削除しただけで、その科目の他のテキストも共有している目標が
道連れで消える。（提案書FKで同じ罠を踏んで修正した前例がある。
`講習_提案書FK SET NULL＋偽所持是正` 参照）

```sql
alter table public.student_textbook_exams
  drop constraint if exists student_textbook_exams_student_textbook_id_fkey;
alter table public.student_textbook_exams
  alter column student_textbook_id drop not null,
  add constraint student_textbook_exams_student_textbook_id_fkey
    foreign key (student_textbook_id) references public.student_textbooks(id) on delete set null;
```

移行後、`student_id` は NOT NULL にしたい。ただしバックフィル完了を確認してからにするので、
このマイグレーションでは付けない（§4-3 と §6 の検証クエリ参照）。

### 4-3. バックフィル

既存行の `student_id` / `subject_key` を親テキストから埋める。
`subject_key` の分類は `newProgress.shared.ts` の `categorizeSubject()` と**完全に同じ判定**にする。
ズレると移行後に目標が別科目に飛ぶ。

```sql
update public.student_textbook_exams e
set student_id  = st.student_id,
    subject_key = case
      when t.subject ~ '国語|現代文|古文|漢文|古典'            then 'その他'  -- ← 順序注意（下記）
      else 'その他'
    end
from public.student_textbooks st
join public.textbooks t on t.id = st.textbook_id
where st.id = e.student_textbook_id
  and e.student_id is null;
```

判定順は TS 実装と同じ順序で書くこと（国語 → 数学 → 英語 → 理科 → 社会 → その他）。
`English` は大文字小文字を無視する（TS側は `/English/i`）ので SQL では `~*` を使う。
`t.subject` が NULL の行は `'その他'`。

`textbooks` は **LEFT JOIN** にする。教材マスタの行が消えている、あるいは `textbook_id` が NULL の
`student_textbooks` があると、内部結合では `student_id` まで埋まらず、生徒への紐付けごと失われる。
科目が読めないだけなので `'その他'` に落として拾う。

それでも `student_id` が埋まらないのは `student_textbooks` 自体が消えている孤児行だけ。
**孤児行はマイグレーションで削除しない。** 表示経路が無く既に見えておらず、
書き換え後のRLSでも `students` との結合が成立しないので参照されない。件数を確認してから別途判断する。

```sql
select count(*) from student_textbook_exams where student_id is null;
```

`student_id` の NOT NULL も同じ理由でこのマイグレーションでは付けない。
上のクエリが0件であることを本番で確認してから、別マイグレーションで付ける。

### 4-4. RLS の書き換え（必須・忘れると全滅する）

現行ポリシーは `student_textbooks` を JOIN して school_id を見ている。

```sql
-- 現行（base_schema.sql:6760 付近）
CREATE POLICY "student_textbook_exams_school_scope_auth" ON student_textbook_exams
  TO authenticated USING (EXISTS (
    SELECT 1 FROM student_textbooks st
    WHERE st.id = student_textbook_exams.student_textbook_id
      AND check_school_access(st.school_id)));
```

`student_textbook_id` が NULL の新規行はこの条件を満たさず、**作った本人にも見えなくなる。**
`students` 経由に書き換える。

```sql
drop policy if exists "student_textbook_exams_school_scope_auth" on public.student_textbook_exams;
create policy "student_textbook_exams_school_scope_auth" on public.student_textbook_exams
  to authenticated
  using (exists (select 1 from public.students s
                 where s.id = student_textbook_exams.student_id
                   and public.check_school_access(s.school_id)))
  with check (exists (select 1 from public.students s
                      where s.id = student_textbook_exams.student_id
                        and public.check_school_access(s.school_id)));
```

`action_goals` のポリシーも `student_textbook_exams` → `student_textbooks` の2段JOINなので同様に
`student_textbook_exams` → `students` に書き換える（base_schema.sql:5832 付近）。

**適用順序**: バックフィル → RLS書き換え。逆にすると既存行が一瞬見えなくなる。

### 4-5. 重複目標の集約（本番適用は別ステップ）

移行しただけでは、同じ科目の2冊のテキストに同じ試験の目標が別々に立っていた場合、
科目に2件並ぶ。`activeExamOf()` は1件しか選ばないので画面は壊れないが、
「次の目標へ」の履歴や編集時に紛らわしい。

**マイグレーションでは消さない。** 別のSQLスクリプトで、
`(student_id, subject_key, exam_date, coalesce(exam_type_id::text, custom_exam_name))`
が一致する行を1件に集約する。手順:

1. まず件数と中身をSELECTで出す（何をどう畳むかを人が見る）。
2. 残す1件を決める（`target_score` が入っている方を優先、同点なら `created_at` が新しい方）。
3. 敗者に紐づく `action_goals` を勝者に付け替える（`update action_goals set student_textbook_exam_id = 勝者`）。
4. 敗者を削除。

このステップは本番データを見てから判断する。移行そのものとは切り離す。

## 5. コード変更

### 5-1. `src/lib/api/progress.ts`

- `getStudentTextbookExams(studentTextbookId)` を置き換え、
  `getSubjectExams(studentId, subjectKey)` を追加。
- 生徒の全目標を一括で取り、`subject_key` でグループ化して返す
  `getExamsBySubject(studentId): Promise<Record<SubjectColumn, StudentTextbookExam[]>>` を追加。
  進行表は1生徒ぶんを1回で取れるのでN+1にならない。
- `createStudentTextbookExam` の payload から `student_textbook_id` 必須をやめ、
  `student_id` + `subject_key` を必須にする。`student_textbook_id` は作成元として任意で入れる。

### 5-2. テキストへの hydrate（この変更の要）

進行表がテキスト一覧を組み立てている箇所で、各 `tb.exams` に
`examsBySubject[categorizeSubject(tb.textbook?.subject)]` を入れる。
これで `TextbookCard` / `activeExamOf` / `ExamGoalEditModal` / `NextGoalModal` /
`ActionGoalsSection` は変更不要になる。

`ExamGoalEditModal` と `NextGoalModal` が保存時に `student_textbook_id` を渡している箇所だけ、
`student_id` + `subject_key` を渡すよう props を差し替える（画面表示は変わらない）。

### 5-3. `src/lib/api/progress-sessions.ts` の `getFeedGoalsByTextbooks()`

報告書ヘッダー・面談パネル・フィードが使う一括取得。
現在は `student_textbook_id` で引いているので、テキストID → 科目キー → 目標 の解決に変える。
戻り値の形（テキストID をキーにした Record）は変えない。呼び出し側は無変更で済む。

### 5-4. `src/lib/api/alerts.ts` の `buildExamOverdueCandidates()`（859行目付近）

現在はテキストをループして `st.exams` を見ている。hydrate 後は同じ目標が
同一科目の全テキストで重複して現れるため、**科目単位でループするか、
`exam.id` で重複を除く**こと。alert の id / alert_key は `exam:${exam.id}` で同一なので
重複が下流で潰れる可能性はあるが、依存しない。

「最新の試験日の目標だけを見る」ロジック（`latestExamDate`）は科目単位でそのまま活かす。
メッセージ内の `textbookName` は科目名に変える（同じ目標が複数テキストに属するため、
特定のテキスト名を出すと嘘になる）。

### 5-5. 型定義

`src/types/database.ts` の `StudentTextbookExam` / `Insert` / `Update` に
`student_id` と `subject_key` を追加。`student_textbook_id` は `string | null` にする。

### 5-6. ヘルプFAQ（`src/lib/help/faqData.ts`）

同じPRで直す。書き換えが要る箇所:

- 578〜597行目「テスト目標の設定」:
  「目標は生徒単位ではなく進行表の**教材ごと**に持つ。同じ生徒でも英語のテキストと数学のテキストで
  別々の目標になる」→ 「目標は**科目ごと**に持つ。同じ科目のテキストは同じ目標を共有する。
  英語の文法テキストと長文テキストには同じ目標が表示され、どちらから編集しても同じ目標が変わる。
  テキストを終えて次のテキストに移っても目標は科目に残る」
- 同FAQの「『目標未設定』アラートの判定は、教材ごとに最新の試験日の目標だけを見る」
  → 「科目ごとに」
- 2834〜2850行目「試験が終わったら次の目標はどう設定しますか？」: 「次の目標へ」は科目の目標を進める、と明記。
- 256行目（面談ワークスペース）: 「教材ごとに目標を表示」→「科目ごと」

書き方は `docs/help-authoring-guide.md` に従う。

## 6. 検証

### 移行の検証（SQL）

```sql
-- 1. 埋まっていない行が無いこと
select count(*) from student_textbook_exams where student_id is null or subject_key is null;

-- 2. 移行前後で目標の総数が変わっていないこと（集約ステップ実行前）
select count(*) from student_textbook_exams;

-- 3. subject_key の分布が textbooks.subject の分布と整合すること
select subject_key, count(*) from student_textbook_exams group by 1 order by 2 desc;

-- 4. 孤児（親テキストが消えている行）の件数
select count(*) from student_textbook_exams e
  left join student_textbooks st on st.id = e.student_textbook_id
  where e.student_textbook_id is not null and st.id is null;
```

### 画面の検証

ローカルで、同一科目に2冊以上テキストがある生徒（本番実測で約38%の生徒が該当）を開いて確認する。

1. 英語のテキスト2冊に**同じ目標バッジ**が出る。
2. 片方のカードから目標を編集すると、もう片方の表示も変わる。
3. 片方のテキストを完了にしても、もう片方の目標が消えない。
4. 「次の目標へ」を実行すると、同科目の全テキストで新しい目標に切り替わる。
5. 行動目標のチェックが同科目の両カードで同期する。
6. 報告書フォームのヘッダーと面談パネルに目標が今までどおり出る。
7. テキストを削除しても、同科目の他テキストの目標が消えない（SET NULL の確認）。
8. 講師アカウントでログインして目標が見える（RLS書き換えの確認）。

## 7. 適用の順番

1. ローカルでマイグレーション作成 → `supabase db reset` で通ることを確認。
2. コード変更 → ローカルで §6 の画面検証。
3. 本番DBへは **MCP の `apply_migration` で適用する**（`db push` は本番に既存版を再適用する地雷がある。
   `開発環境_db pushが本番に再適用する地雷` 参照）。
4. 本番適用後、§6 の検証SQLを本番で実行。
5. 重複集約（§4-5）は本番データを見てから別途判断。
