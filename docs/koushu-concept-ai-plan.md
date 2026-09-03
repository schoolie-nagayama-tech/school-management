# 講習プランのコンセプトをAIに書かせる（設計書）

作成: 2026-09-03 ／ 状態: **モックで確認中**
対象: `src/components/proposals/ProposalEditor.tsx`（講習提案書の編集画面）
モック: [AIに書かせる場所](https://claude.ai/code/artifact/b60623a6-6bcf-4068-89f5-21685579aac0) の「講習プランのコンセプト」タブ
前提: [docs/ai-platform-comparison.md](./ai-platform-comparison.md)（基盤＝Claude API）

---

## 0. 何をするか

提案書に **「このプランのコンセプト」** を足す。何コマ取るかの手前にある
**「この科目で何をやるつもりか」** を保護者に渡す。

**★推薦文ではない。** 教室長が方針を箇条書きで置き、AIは背景（成績・面談・報告書・進行表・
前回の講習）を踏まえて、それを文章にするだけ。**方針に無い主張を背景から作り出さない。**

## 1. 決めたこと（2026-09-03）

1. **コンセプトは科目ごと。** 提案書は1教材＝1科目で1枚なので、コンセプトも1枚に1つ。
   **作ったうえで、載せるかどうかは教室長が決める**（全科目に付ける必要はない）。
2. **志望校は扱わない。** データを持っていないし、取りにいかない。
3. **成績と面談記録はAIに渡してよい。**
4. **強い推薦文にしない。** 背景を踏まえて方針を文章にするだけ。

## 2. ★ いまの提案書には、コンセプトを置く場所が無い

コードを読んだ結果（`src/components/proposals/ProposalEditor.tsx`, `src/types/database.ts:3969-4045`）:

| 列 | テーブル | 状態 |
| --- | --- | --- |
| `theme` | `seasonal_proposals` | **保護者に見える唯一の自由記述**。ただし「英検3級対策」のような一言ラベル用途 |
| `notes` | `seasonal_proposals` | 入力欄のラベルに**「印刷には出ません」と明記**された内部メモ |
| `reason` | `seasonal_proposal_units` | **DBに列があるのに入力UIが無く、常に空文字で保存されている**（死んだ列） |

さらに申込フォームは **単元リストすら出していない**
（`src/types/koushu-apply.ts:61` に「テーマ。単元リストは出さない（決定47）」とコメント）。
保護者が見るのは **科目・テーマ・コマ数・金額** だけ。

→ **`seasonal_proposals` にコンセプト用の列を1つ足す**ところから。
`reason`（単元ごと）は使わない。コンセプトは科目単位であって単元単位ではない。

## 3. 材料（すべて既存のデータ）

### 生の言葉があるもの（コンセプトの芯になる）

| 材料 | テーブル/列 | 読み出す関数 |
| --- | --- | --- |
| 面談記録 | `student_interviews.content` | `getStudentInterviews`（`src/lib/api/interviews.ts:51`） |
| 授業報告書の講評 | `class_reports.review_comment` | `getApprovedReportsByStudent`（`src/lib/api/class-reports.ts:535`） |
| 進行表の引継ぎ | `student_progress.handover`, `progress_sessions.handover` | `getStudentProgress`（`src/lib/api/progress.ts:501`） |
| 教材ごとの方針 | `student_textbook_settings.approach`, `homework_style` | `getStudentTextbookSettings`（`progress.ts:378`） |

### 数字で裏づけるもの

| 材料 | テーブル/列 | 読み出す関数 |
| --- | --- | --- |
| 成績（定期テスト・通知表・模試） | `assessments` ＋ `assessment_scores` | `listAssessments`（`src/lib/api/assessments.ts:105`） |
| 目標と結果 | `student_textbook_exams.target_score` / `result_score` | `getStudentTextbookExams`（`progress.ts:427`） |
| 宿題・確認テストの定着 | `class_reports.homework_completion_pct` / `homework_correct_pct` / `check_test_score` | 同上 |
| 行動目標 | `action_goals.title` ＋ 達成カウンタ | `getActionGoals`（`src/lib/api/action-goals.ts:16`） |

### 現状と履歴

| 材料 | テーブル/列 | 読み出す関数 |
| --- | --- | --- |
| 学校進度との差 | `student_progress.school_progress_date` | `getStudentProgress` |
| 週回数・受講科目 | `schedule_regular_patterns` | `getRegularPatterns`（`src/lib/api/schedule.ts:475`） |
| 前回の講習実績 | `koushu_enrollments.koma_count`、提案コマ vs 申込コマ | `getKoushuEnrollmentsByStudent`（`src/lib/api/seasonalCourses.ts:340`）、`groupStudentKoushu`（`src/lib/studentKoushuSummary.ts:55`） |

### 無いもの（諦める／代替する）

- **志望校・受験学年の列は無い**（2026-09-03 決定: 取らない）。
- **入塾日の列が無い**。`students.created_at` を代理にするしかない。
- **生徒の出欠を集計する関数が無い**。`schedule_entries.status` を都度集計する必要がある
  （`src/lib/api/attendance.ts` は講師の勤怠であって生徒の出欠ではない）。
- **前回講習の「成果」を紐づける列が無い**。`assessments` の時系列と講習期間を突き合わせる。

## 4. AIに守らせること（プロンプトに固定）

- **★主役は教室長の方針。** 背景はその裏づけに必要な分だけ使う。**方針に無い主張を作らない。**
- 数字は背景に書かれているものだけ。丸めない・足さない。
- **★売り込まない。**「ぜひ」「必ず」「今しかありません」「このままでは」は使わない。
- 受けなかった場合の不安をあおらない。結果を約束しない。
- 金額・お得さ・他の生徒との比較に触れない。
- 面談で聞いた話に触れるときは言い切らず「お話しいただいたとおり」の形にする。
- 3〜4文、120〜180字。です・ます調。
- 最後は「この科目で何をやるか」が分かる形で終える。

## 5. 画面

- 提案書の編集画面（科目1枚）に、方針の箇条書き欄と「コンセプトにする」ボタンを置く。
- 背景は**システムが集めて表示**する（教室長が探しに行かない）。
- 出てきた文は**編集できる**。載せないという判断もできる。
- 保護者側は、テーマの下にコンセプトが1段落入る。

## 6. 残っていること

- コンセプトを保存する列の追加（`seasonal_proposals`）。
- 印刷版（`ProposalPrintView.tsx`）と申込フォーム（`ApplyProposalLine`）への表示追加。
- 背景を集める関数（上記を1回で引く）。
- 公開前に `docs/legal/privacy-policy.md` 第5条へ Anthropic を追記（全AI機能で共通）。
