/**
 * 生徒ハブのセクション一覧（目次と並び順の正典）。
 *
 * 並びはモック（public/student-hub-mock.html）どおり。第1段で中身があるものだけを載せる
 * （教材・請求・履歴は第2段。docs/student-hub-plan.md §3）。
 * ★目次・ページ本文・スクロール追従の3か所がこの配列を見るので、足すときはここだけ直す。
 */
export const HUB_SECTIONS = [
  { id: 'sec-status', label: '今の状態' },
  { id: 'sec-basic', label: '基本情報' },
  { id: 'sec-attention', label: '気にすること' },
  { id: 'sec-schedule', label: '通塾日程' },
  { id: 'sec-forms', label: '申込状況' },
  { id: 'sec-scores', label: '成績' },
  { id: 'sec-targets', label: '志望校' },
  { id: 'sec-progress', label: '進行表' },
  { id: 'sec-lessons', label: '授業の様子' },
  { id: 'sec-discipline', label: '宿題・遅刻・出欠' },
  { id: 'sec-interview', label: '面談' },
  { id: 'sec-koushu', label: '講習' },
  { id: 'sec-parent', label: '保護者' },
  { id: 'sec-proposals', label: '提案書' },
] as const;

export type HubSectionId = (typeof HUB_SECTIONS)[number]['id'];

/**
 * 固定ヘッダーの高さの目安（px）。目次から飛んだとき見出しがヘッダーの下に隠れないよう、
 * 各セクションの scroll-margin-top とスクロール追従の判定線に使う。
 * ヘッダーは3行（パンくず・氏名・目次）で約113px。少し余白を足してある。
 */
export const HUB_HEADER_OFFSET = 124;
