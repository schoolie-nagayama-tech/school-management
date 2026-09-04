/**
 * 授業中ポップアップを「出すか」「何と書くか」をAIに決めさせるプロンプト。
 *
 * 正典: docs/bulletin-ai-assist.html §3
 *
 * ★判断の基準を人が決め切れないので、材料を渡して委ねる。
 *   「演習の合間かどうか」「遅刻して来たばかりか」を条件式で書き切るのは無理がある。
 *
 * ★既定は出さない側に倒す。誤爆のほうが見逃しより有害。
 *   授業中に的外れなカードが出ると、講師は以後それを読まなくなる。
 *   見逃しは次の授業で拾えるが、信用は戻らない。
 */

/** AIに渡す材料 */
export interface PopupContext {
  /** 経過（分）と授業時間（分） */
  elapsedMinutes: number;
  totalMinutes: number;
  /** 1/3 か 2/3 か */
  checkpointLabel: string;
  /** 残っているタスク（日本語のラベル） */
  taskLabel: string;
  /** そのタスクが生徒に聞けば済むものか、相談が要るものか */
  taskNature: string;
  /** 期限までの日数。null なら期限なし */
  daysUntilDue: number | null;
  /** 生徒の今日の様子（遅刻・宿題未実施など）。無ければ空 */
  studentToday: string;
  /** 講師が進行表をどこまで触っているか */
  progressState: string;
  /** 今日この講師に出した回数 */
  shownToday: number;
}

export function popupSystemPrompt(): string {
  return [
    'あなたは学習塾の教室長です。授業中の講師に、事務作業のお願いを出すかどうかを決めます。',
    '',
    '答えは3つのうちどれか:',
    '- show … いま出す',
    '- wait … まだ待つ（次の見直しでまた判断する）',
    '- skip … 今日は見送る',
    '',
    '★迷ったら wait か skip にしてください。出さない側に倒します。',
    '  授業中に的外れなカードが出ると、講師は以後それを読まなくなります。',
    '  見逃しは次の授業で拾えますが、一度失った信用は戻りません。',
    '',
    '出す（show）を選ぶ目安:',
    '- 演習や小テストの最中など、講師の手が空いていそうなとき。',
    '- 生徒本人に聞けば終わる作業で、生徒がまだ教室にいるとき。',
    '- 期限が近く、この授業を逃すと次の機会が遠いとき。',
    '',
    '出さない目安:',
    '- 授業が始まったばかり、遅刻して来た直後など、生徒への声かけを優先すべきとき。',
    '- 講師が進行表を触っている最中で、手が塞がっているとき。',
    '- 今日すでに出しているとき。',
    '',
    '文面の作法:',
    '- 1〜2文、60字まで。授業中に読むものなので短く。',
    '- ★成績の数値そのものは書かない。生徒に画面が見えています。',
    '- 生徒の名前は、渡された呼び名をそのまま使う。推測して補わない。',
    '- 指示口調にしない。「お願いします」くらいの温度で。',
    '',
    '出力はJSONだけ。前置きは書かない:',
    '{"action":"show","message":"演習の合間に、1学期の通知表を確認して入力をお願いします。","reason":"なぜそう判断したか（教室長が読む）"}',
    '',
    'wait と skip のときは message を空文字にしてください。',
  ].join('\n');
}

export function popupUserText(ctx: PopupContext): string {
  const lines = [
    `【経過】${ctx.elapsedMinutes}分 / ${ctx.totalMinutes}分（${ctx.checkpointLabel}）`,
    `【残っているタスク】${ctx.taskLabel}`,
    `【タスクの性質】${ctx.taskNature}`,
    `【期限】${ctx.daysUntilDue == null ? '期限なし' : `あと${ctx.daysUntilDue}日`}`,
    `【今日すでに出した回数】${ctx.shownToday}回`,
  ];
  if (ctx.studentToday) lines.push(`【生徒の今日の様子】${ctx.studentToday}`);
  if (ctx.progressState) lines.push(`【進行表の入力状況】${ctx.progressState}`);
  return lines.join('\n');
}

/** AIの答え。想定外の値は呼び出し側で wait に倒す */
export type PopupAction = 'show' | 'wait' | 'skip';

export interface PopupDecision {
  action: PopupAction;
  message: string;
  reason: string;
}

const ACTIONS: ReadonlySet<string> = new Set<PopupAction>(['show', 'wait', 'skip']);

/** 文面の上限。授業中に読むものなので長いと意味がない */
const MAX_MESSAGE = 120;

/**
 * AIの生の出力を、使ってよい形にする。
 *
 * ★読めない・知らない答えは wait に倒す。show に倒さないのは、
 *   壊れた出力で授業中にカードを出すのがいちばん避けたい事故だから。
 */
export function parsePopupDecision(raw: unknown): PopupDecision {
  const fallback: PopupDecision = { action: 'wait', message: '', reason: '' };
  if (!raw || typeof raw !== 'object') return fallback;

  const r = raw as Record<string, unknown>;
  const action =
    typeof r.action === 'string' && ACTIONS.has(r.action) ? (r.action as PopupAction) : 'wait';
  const message = typeof r.message === 'string' ? r.message.trim().slice(0, MAX_MESSAGE) : '';
  const reason = typeof r.reason === 'string' ? r.reason.trim().slice(0, 200) : '';

  // 出すと言いながら文面が無いのは出せない
  if (action === 'show' && message === '') return { action: 'wait', message: '', reason };

  return { action, message: action === 'show' ? message : '', reason };
}
