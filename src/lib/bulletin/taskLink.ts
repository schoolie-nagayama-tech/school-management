/**
 * タスクの種別ごとに「どこを開けば作業できるか」を返す。
 *
 * 正典: docs/bulletin-ai-assist.html
 *
 * ★13種すべてに入力UIは作らない。カードから作業できる場所へリンクするだけにする。
 *   内申入力用に9科の入力欄をカードに作ることはできるが、同じことを13種ぶんやるのは現実的でなく、
 *   種別が増えるたびにUIを足す作りになってしまう。リンクなら種別が増えても1行で済む。
 *
 * ★リンク先は「開いた瞬間に作業が始められる場所」まで含める。
 *   「生徒管理を開いてください」で止めると、生徒を探す→タブを選ぶ→学期を選ぶ、で終わる。
 *   生徒が決まっている種別は必ず生徒IDまで含めること。
 */

import type { TaskKind } from './taskCatalog';

export interface TaskLink {
  href: string;
  /** ボタンに出す文字。「何をしに行くか」が分かる言い方にする */
  label: string;
}

interface LinkContext {
  /** 生徒に紐づくタスクのときだけ入る */
  studentId?: string | null;
  /** いま開いているコマ。報告書まわりのタスクで使う */
  scheduleEntryId?: string | null;
}

/**
 * 種別 → リンク。作業できる場所が分からない種別は null を返し、
 * ★カードにはボタンを出さない（押しても何も始まらないボタンを置かない）。
 */
export function taskLink(kind: TaskKind, ctx: LinkContext = {}): TaskLink | null {
  const sid = ctx.studentId ?? null;
  const eid = ctx.scheduleEntryId ?? null;

  switch (kind) {
    // 生徒の成績ページ。内申もテスト結果もここ
    case 'report_card_entry':
      return sid ? { href: `/students/${sid}/scores`, label: '成績ページを開く' } : null;
    case 'test_result_entry':
      return sid ? { href: `/students/${sid}/scores`, label: '成績ページを開く' } : null;

    // 進行表
    case 'goal_setting':
      return sid ? { href: `/students/${sid}/progress`, label: '進行表を開く' } : null;
    case 'progress_entry':
      return sid ? { href: `/students/${sid}/progress`, label: '進行表を開く' } : null;

    // 所持教材は進行表の教材まわりで扱う
    case 'owned_material_check':
      return sid ? { href: `/students/${sid}/progress`, label: '所持教材を開く' } : null;

    // 報告書。いま開いているコマがあればそのコマへ
    case 'report_deadline':
    case 'report_title_format':
      return eid
        ? { href: `/lesson-reports/${eid}`, label: '報告書を開く' }
        : { href: '/lesson-reports/pending', label: '未提出の報告書を開く' };

    // 講師自身のもの
    case 'shift_submit':
    case 'shift_check':
      return { href: '/my-schedule', label: 'シフトを開く' };
    case 'timesheet_entry':
      return { href: '/my-schedule', label: '出勤簿を開く' };

    // 教室長がやるもの
    case 'application_check':
      return { href: '/applications', label: '申込状況を開く' };
    case 'test_prep_proposal':
      return { href: '/test-prep-proposals', label: 'テスト対策提案を開く' };
    case 'material_handout_check':
      return { href: '/ordering', label: '教材・発注管理を開く' };
  }
}

/**
 * カードに出す1行。★やることだけを書く。理由も依頼元も書かない。
 *
 * 生徒名は呼び名をそのまま使う（推測して補わない）。
 */
export function taskActionText(kind: TaskKind, studentName?: string | null): string {
  const who = studentName ? `${studentName}さんの` : '';

  switch (kind) {
    case 'report_card_entry':
      return `${who}1学期の内申を入力`;
    case 'test_result_entry':
      return `${who}テスト結果を入力`;
    case 'goal_setting':
      return `${who}目標を設定`;
    case 'progress_entry':
      return `${who}進行表を入力`;
    case 'owned_material_check':
      return `${who}所持教材を確認`;
    case 'material_handout_check':
      return `${who}教材の配布をチェック`;
    case 'test_prep_proposal':
      return `${who}テスト対策を提案`;
    case 'application_check':
      return `${who}申込状況にチェック`;
    case 'report_deadline':
      return '報告書を提出';
    case 'report_title_format':
      return '報告書のタイトルを直す';
    case 'shift_submit':
      return 'シフトを提出';
    case 'shift_check':
      return 'シフトを確認';
    case 'timesheet_entry':
      return '出勤簿を入力';
  }
}
