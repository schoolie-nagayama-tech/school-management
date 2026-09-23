/**
 * 高校の年度ごとの数字（high_school_stats.metric）の項目キー。
 * ------------------------------------------------------------------
 * ★キーはここで閉じる。DBの CHECK にしていないのは、項目を足すたびにマイグレーションが
 *   要るのを避けるため。その代わり、取込スクリプト（scripts/import-high-school-facts.mjs）が
 *   このファイルを読んでキーを検査する。自由記述にすると表記の揺れで集計から黙って漏れる。
 *
 * ★fiscal_year が「何の年度か」は項目で決まる（year の欄）。学校の経営計画の「R6実績」は
 *   入試年度と1年ずれることがある（日野で確認）ので、取込の時点でここの意味に揃える。
 *
 * ★このファイルは Node の .mjs から直接 import される（Node 24 の型の読み飛ばし）。
 *   他の .ts を import しない・enum を使わない（読み飛ばせない構文になる）。
 *
 * 正典: docs/high-school-profile-plan.md
 */

export type MetricYear = '入学年度' | '卒業年度' | '5月1日の年度' | '資料の年度';

export interface MetricDef {
  label: string;
  unit: '人' | '学級' | '倍' | '%' | '文';
  year: MetricYear;
  /** item（内訳）に何が入るか。空＝内訳なし */
  item: string;
}

export const METRICS = {
  // --- 規模 ---
  students: { label: '生徒数', unit: '人', year: '5月1日の年度', item: '' },
  classes: { label: '学級数', unit: '学級', year: '5月1日の年度', item: '' },
  teachers: { label: '教員数', unit: '人', year: '5月1日の年度', item: '' },

  // --- 入試（item＝選抜の区分。'一般' '推薦' '共通選抜' など資料の呼び名） ---
  exam_capacity: { label: '募集人員', unit: '人', year: '入学年度', item: '選抜区分' },
  exam_applicants: { label: '応募人員', unit: '人', year: '入学年度', item: '選抜区分' },
  exam_examinees: { label: '受検人員', unit: '人', year: '入学年度', item: '選抜区分' },
  exam_passed: { label: '合格者数', unit: '人', year: '入学年度', item: '選抜区分' },
  // ★東京は「受検倍率」＝受検人員÷募集人員、神奈川は「競争率」＝（受検者数−受検後取消者数）÷合格者数。
  //   分母が違うので都県をまたいで比べない。応募倍率（応募÷募集）とも別物。
  //   資料の倍率をそのまま入れ、note に呼び名と式を残す
  exam_ratio: { label: '倍率', unit: '倍', year: '入学年度', item: '選抜区分' },

  // --- 進学実績（★basis で延べ／現役／実進学を必ず分ける） ---
  // item＝大学名か大学群（'GMARCH' '日東駒専' '国公立' '早慶上理' '成成明武' '合計'）
  university_count: {
    label: '大学の合格・進学',
    unit: '人',
    year: '卒業年度',
    item: '大学・大学群',
  },
  // item＝'一般' '指定校推薦' '公募推薦' '総合型'。出している学校だけ
  admission_route_share: {
    label: '入試方式別の割合',
    unit: '%',
    year: '卒業年度',
    item: '入試方式',
  },
  career_decided_rate: { label: '進路決定率', unit: '%', year: '卒業年度', item: '' },

  // --- 学校生活・雰囲気 ---
  club_join_rate: { label: '部活加入率', unit: '%', year: '資料の年度', item: '' },
  // item＝'生徒:学校生活' '保護者:学校生活' のように「誰の・何の満足度か」
  satisfaction: { label: '満足度', unit: '%', year: '資料の年度', item: '対象:観点' },
  // value_text。'ブレザー。男女ともスラックス・スカートを選べる' / 'なし'
  uniform: { label: '制服', unit: '文', year: '資料の年度', item: '' },
  // value_text。頭髪・スマホ・アルバイトの規定の要約。★規定が無いことも「規定なし」と書く
  rules_summary: { label: '校則の要約', unit: '文', year: '資料の年度', item: '' },
  // value_text。item＝指定の名前（'学力向上進学重点校エントリー校' 'Tokyo GE-NET EE'）
  designation: { label: '教育委員会などの指定', unit: '文', year: '資料の年度', item: '指定名' },
} as const satisfies Record<string, MetricDef>;

export type MetricKey = keyof typeof METRICS;

export function isMetricKey(key: string): key is MetricKey {
  return Object.prototype.hasOwnProperty.call(METRICS, key);
}
