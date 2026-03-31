-- 冬期講習スケジュールテンプレート (Excelの「標準」シート参照)
INSERT INTO course_prep_templates (template_type, season, name, is_default, template_data) VALUES
('schedule', 'winter', '冬期講習準備スケジュール', true, '[
  {"major_category":"冬期講習期間","name":"冬期講習","description":"受験生：12月1日～入試前日、一般生：12月1日～1月10日","sort_order":0},
  {"major_category":"プラン作成","name":"PCS実施","description":"","sort_order":1},
  {"major_category":"プラン作成","name":"PCS回収","description":"回収からSKS入力まで","sort_order":2},
  {"major_category":"プラン作成","name":"ETS実施","description":"","sort_order":3},
  {"major_category":"プラン作成","name":"冬期講習プラン作成","description":"中3は3科提案、小～中2は2科＋必要科目、高校生は受講科目と入試必要科目","sort_order":4},
  {"major_category":"冬期面談","name":"お知らせ発送","description":"月謝案内と同封","sort_order":5},
  {"major_category":"冬期面談","name":"進路希望調査","description":"中3・高3対象","sort_order":6},
  {"major_category":"冬期面談","name":"申込書回収","description":"全員参加","sort_order":7},
  {"major_category":"冬期面談","name":"未提出者電話","description":"","sort_order":8},
  {"major_category":"冬期面談","name":"生徒面談資料","description":"個別プラン表入力＆印刷、高校入試資料印刷","sort_order":9},
  {"major_category":"冬期面談","name":"生徒面談実施","description":"目標の明確化、入試までのスケジュール","sort_order":10},
  {"major_category":"冬期面談","name":"保護者面談資料準備","description":"封筒準備、プラン製本、申込書・日程表印刷、お土産ツール封入","sort_order":11},
  {"major_category":"冬期面談","name":"保護者面談実施","description":"","sort_order":12},
  {"major_category":"冬期面談","name":"申込書受付締切","description":"面談日から1週間","sort_order":13},
  {"major_category":"冬期面談","name":"日程表受付締切","description":"面談日から1週間","sort_order":14},
  {"major_category":"業務・教務関連","name":"座席・日程調整","description":"システム入力","sort_order":15},
  {"major_category":"業務・教務関連","name":"帳票準備","description":"生徒ファイル内容差し替え、方針書・対応履歴等加筆","sort_order":16},
  {"major_category":"業務・教務関連","name":"生徒日程表開示","description":"12月分を開示、1月分は12月20日、2月分は1月20日","sort_order":17},
  {"major_category":"業務・教務関連","name":"教材発注","description":"在塾生分","sort_order":18},
  {"major_category":"講師関連","name":"シフト作成・調整","description":"帰省・旅行予定を把握","sort_order":19},
  {"major_category":"講師関連","name":"講師研修","description":"全員出席","sort_order":20},
  {"major_category":"中間テスト","name":"対策提案配布","description":"","sort_order":21},
  {"major_category":"中間テスト","name":"対策授業","description":"","sort_order":22},
  {"major_category":"中間テスト","name":"対策勉強会","description":"","sort_order":23},
  {"major_category":"中間テスト","name":"中間テスト","description":"","sort_order":24},
  {"major_category":"期末テスト","name":"対策提案配布","description":"","sort_order":25},
  {"major_category":"期末テスト","name":"対策授業","description":"","sort_order":26},
  {"major_category":"期末テスト","name":"対策勉強会","description":"","sort_order":27},
  {"major_category":"期末テスト","name":"期末テスト","description":"","sort_order":28}
]'::jsonb)
ON CONFLICT DO NOTHING;
