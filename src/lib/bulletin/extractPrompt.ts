/**
 * 掲示板の投稿からタスクを抽出するプロンプト。
 *
 * 正典: docs/bulletin-ai-assist.html
 *
 * ★AIがやるのは「13種のカタログから選ぶ」ことだけ。種別を自由に作らせない。
 *   カタログを閉じることで、AIが余計なタスクをでっち上げる余地をなくしている。
 *   （社内投稿65件での検証では、タスクの無い33件すべてで空を返し、誤検知0だった）
 *
 * ★DBに痕跡が残る操作だけを対象にする。心構え・物理作業・情報共有は対象外。
 *   「がんばりましょう」「教室を掃除してください」「模試の日程を共有します」は
 *   タスクにならない。ここを緩めると、済の判定ができないタスクが増えて仕組みが壊れる。
 */

import { TASK_KINDS, TASK_KIND_LABELS, TASK_SCOPES, TASK_SCOPE_LABELS } from './taskCatalog';

/** 種別の一覧を「値 = 日本語ラベル（何をしたら済か）」の形で並べる */
function kindCatalog(): string {
  const hints: Record<(typeof TASK_KINDS)[number], string> = {
    report_card_entry: '通知表の内申をNESTに入力する',
    test_result_entry: '定期テストや模試の結果をNESTに転記する',
    goal_setting: '生徒の目標をNESTに設定する',
    progress_entry: '進行表に指導内容を入力する',
    shift_submit: '講師が自分のシフトを提出する',
    shift_check: '講師が確定したシフトを確認する',
    timesheet_entry: '講師が出勤簿を入力する',
    material_handout_check: '教材を配布したチェックを付ける',
    owned_material_check: '生徒の所持教材を確認して登録する',
    test_prep_proposal: 'テスト対策の提案を作成する',
    application_check: '申込状況にチェックを付ける',
    report_deadline: '授業報告書を期限までに提出する',
    report_title_format: '報告書のタイトルを決められた形式で書く',
  };
  return TASK_KINDS.map((k) => `- ${k} … ${TASK_KIND_LABELS[k]}（${hints[k]}）`).join('\n');
}

function scopeCatalog(): string {
  const hints: Record<(typeof TASK_SCOPES)[number], string> = {
    all_students: '教室の在籍生徒すべて',
    assigned_students: 'その講師が担当している生徒だけ',
    grade: '中3だけ、など学年で絞る',
    specific_students: '投稿で名前が挙がった生徒だけ',
    teacher_self: 'シフト提出・出勤簿など、生徒に紐づかないもの',
  };
  return TASK_SCOPES.map((s) => `- ${s} … ${TASK_SCOPE_LABELS[s]}（${hints[s]}）`).join('\n');
}

/** 抽出のシステムプロンプト。中身は毎回同じなのでキャッシュに載せる */
export function extractSystemPrompt(): string {
  return [
    'あなたは学習塾の教室長です。連絡掲示板の投稿を読み、講師にやってもらう作業を取り出してください。',
    '',
    '★あなたの仕事は「下の一覧から選ぶ」ことだけです。一覧に無い種別を作らないでください。',
    '',
    '【種別（この中からだけ選ぶ）】',
    kindCatalog(),
    '',
    '【誰に出すか】',
    scopeCatalog(),
    '',
    '【期限の型】',
    '- date … 日付が決まっている。due_date に YYYY-MM-DD で入れる',
    '- every … 授業のたびに発生する（報告書の提出、進行表の入力など）',
    '- none … 期限が書かれていない',
    '',
    '守ること:',
    '- ★NESTに記録が残る作業だけを取る。心構え・物理的な作業・ただの情報共有は取らない。',
    '  例: 「がんばりましょう」「教室を掃除してください」「模試の日程を共有します」→ 取らない。',
    '- ★依頼になっていないものは取らない。資料を「読んでください」「参考にしてください」は作業ではない。',
    '- ★迷ったら取らない。無理に埋めるより、空で返すほうが良い。',
    '- 1つの投稿から複数の作業が出ることがある（例: 通知表を回収し、内申を入力し、チェックを付ける）。',
    '  ただしNESTに記録が残らないもの（回収そのもの）は取らない。',
    '- 相対的な期限（「今週中」「月末まで」）は、渡された今日の日付から実際の日付に直す。',
    '- 対象の学年が書かれていれば target_grades に数字で入れる（小1=1 … 中1=7・中2=8・中3=9 … 高3=12）。',
    '  学年の指定が無ければ空の配列。',
    '',
    '出力はJSONだけ。前置きは書かない:',
    '{"tasks":[{"kind":"report_card_entry","scope":"all_students","target_grades":[7,8,9],"due_type":"date","due_date":"2026-07-31","reason":"投稿のどこからそう読んだか"}]}',
    '',
    '作業が1つも無ければ {"tasks":[]} を返す。',
  ].join('\n');
}

/** 抽出のユーザー側。投稿の本文と、相対的な期限を解決するための今日の日付 */
export function extractUserText(params: {
  title: string;
  content: string;
  today: string; // YYYY-MM-DD
}): string {
  return [
    `【今日の日付】${params.today}`,
    '',
    '【掲示板の投稿】',
    `件名: ${params.title}`,
    '本文:',
    params.content,
  ].join('\n');
}
