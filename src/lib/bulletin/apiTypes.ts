/**
 * 掲示板AIアシストのAPIが返す形。
 *
 * ★APIと画面の両方がここを見る。片方だけ直して静かにズレるのを防ぐため、
 *   ルート側にも画面側にも同じ interface を書かない。
 *
 * 正典: docs/bulletin-ai-assist.html
 */

import type { TaskKind, TaskScope } from './taskCatalog';

/** 進捗ボードの1行（GET /api/ai/bulletin/progress） */
export interface BulletinTaskView {
  taskId: string;
  kind: TaskKind;
  kindLabel: string;
  scope: TaskScope;
  scopeLabel: string;
  dueType: string;
  dueDate: string | null;
  /** 判定を実装していない種別。画面は数字を出さず「まだ数えられません」と書く */
  unsupported: boolean;
  total: number;
  done: number;
  notYet: number;
  excluded: number;
  teachers: { teacherId: string | null; total: number; done: number; notYet: number }[];
  /** 自動チェックの対象列。未設定なら自動チェックはしない */
  applicationItemId: string | null;
  /** 今回のアクセスで新しく自動チェックを付けた件数 */
  autoChecked: number;
  /**
   * 依頼が指す回（assessments.name_code）。未選択なら null。
   * ★AIに推測させない。定期テストはこれが決まるまで数えない。
   */
  targetPeriod: string | null;
  /** その種別は「どの回か」を選ぶ必要があるか。画面が選択欄を出すかの判断に使う */
  needsPeriod: boolean;
  /**
   * まだ済んでいない生徒の名前（先頭だけ）。
   * ★教室長が動く先は「誰がまだか」であって達成率ではないので、数字と一緒に名前を返す。
   */
  notYetNames: string[];
  /** このタスクを生んだ掲示板投稿。新しい順。再掲されていれば2件以上になる */
  sources: { title: string; postedAt: string | null }[];
  /** タスクが作られた時刻。画面はこれを見て「いま追加」を出す */
  createdAt: string;
}

export interface BulletinProgressResponse {
  tasks: BulletinTaskView[];
  /** 数えた時刻。★閲覧時にその場で数えるので、いつの数字かを必ず添える */
  measuredAt: string;
}

/** 授業中ポップアップの答え（POST /api/ai/bulletin/popup） */
export interface BulletinPopupResponse {
  show: boolean;
  taskId: string | null;
  kindLabel: string | null;
  /** AIが書いた一言。カードでは補足として小さく添える */
  message: string;
  /** カードに出す1行。★講師が読むのはこちら */
  actionText: string;
  /** 作業できる場所。null なら行き先が決められない種別なので、ボタンを出さない */
  href: string | null;
  linkLabel: string | null;
  skipReason: string | null;
}
