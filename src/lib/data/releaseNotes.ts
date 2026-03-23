export interface ReleaseNote {
  version: string;
  date: string;
  title: string;
  items: string[];
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: 'v5.1',
    date: '2026-03-23',
    title: '機能改善アップデート',
    items: [
      'アラート表示のスクロール対応＆コンパクト化',
      '成績グラフの日本語化・直線表示',
      '換算内申の自動計算（都立・神奈川対応）',
      '退会登録の確認フロー改善',
      'アラート期日の3日前表示＆段階色分け',
      '新着申込の一括確認に確認ダイアログ追加',
      'リリースノート機能の追加',
    ],
  },
];
