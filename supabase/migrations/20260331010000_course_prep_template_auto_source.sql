-- デフォルトテンプレートに auto_source と column_group を追加
-- 通常週回数 → auto_source='regular_weekly'
-- 講習期間通常回数 → auto_source='course_sessions'
UPDATE course_prep_templates
SET template_data = '[
  {"name":"通常週回数","column_type":"number","sort_order":0,"column_group":"基本","auto_source":"regular_weekly"},
  {"name":"講習期間通常回数","column_type":"number","sort_order":1,"column_group":"基本","auto_source":"course_sessions"},
  {"name":"学年末テ対","column_type":"check","sort_order":2,"column_group":"面談"},
  {"name":"面談申込・面談日決定","column_type":"check","sort_order":3,"column_group":"面談"},
  {"name":"面談申込未提出者へ電話","column_type":"check","sort_order":4,"column_group":"面談"},
  {"name":"面談資料準備","column_type":"check","sort_order":5,"column_group":"面談"},
  {"name":"生徒面談実施","column_type":"check","sort_order":6,"column_group":"面談"},
  {"name":"父母面談実施","column_type":"check","sort_order":7,"column_group":"面談"},
  {"name":"即決","column_type":"check","sort_order":8,"column_group":"面談"},
  {"name":"増コマ回数決定日","column_type":"date","sort_order":9,"column_group":"増コマ"},
  {"name":"面談欠席者対応","column_type":"check","sort_order":10,"column_group":"面談"},
  {"name":"提示増コマ回数","column_type":"number","sort_order":11,"column_group":"増コマ"},
  {"name":"増コマ回数決定","column_type":"number","sort_order":12,"column_group":"増コマ"},
  {"name":"映像申込","column_type":"check","sort_order":13,"column_group":"事務"},
  {"name":"日程表回収","column_type":"check","sort_order":14,"column_group":"事務"},
  {"name":"教材発注","column_type":"check","sort_order":15,"column_group":"事務"},
  {"name":"講習費売上計上","column_type":"check","sort_order":16,"column_group":"事務"},
  {"name":"座席表入力","column_type":"check","sort_order":17,"column_group":"事務"},
  {"name":"提示コマ(英語)","column_type":"number","sort_order":18,"column_group":"教科別"},
  {"name":"提示コマ(数学)","column_type":"number","sort_order":19,"column_group":"教科別"},
  {"name":"提示コマ(国語)","column_type":"number","sort_order":20,"column_group":"教科別"},
  {"name":"提示コマ(理科)","column_type":"number","sort_order":21,"column_group":"教科別"},
  {"name":"提示コマ(社会)","column_type":"number","sort_order":22,"column_group":"教科別"},
  {"name":"提示総コマ合計","column_type":"number","sort_order":23,"column_group":"教科別"}
]'::jsonb
WHERE name = '標準進捗管理項目'
  AND template_type = 'progress'
  AND is_default = true;

-- 春期スケジュールテンプレート (Excelの「白紙」シート参照)
INSERT INTO course_prep_templates (template_type, season, name, is_default, template_data) VALUES
('schedule', 'spring', '春期講習準備スケジュール', true, '[
  {"major_category":"目標/スケジュール","name":"社内目標/スケジュール確認","description":"春期講習の社内目標とスケジュールの確認","sort_order":0},
  {"major_category":"受験結果","name":"受験結果回収","description":"","sort_order":1},
  {"major_category":"受験結果","name":"受験結果掲示","description":"","sort_order":2},
  {"major_category":"学年末試験関連","name":"対策提案配布","description":"","sort_order":3},
  {"major_category":"学年末試験関連","name":"対策授業","description":"","sort_order":4},
  {"major_category":"学年末試験関連","name":"対策勉強会","description":"","sort_order":5},
  {"major_category":"学年末試験関連","name":"学年末テスト","description":"","sort_order":6},
  {"major_category":"新年度カウンセリング関連","name":"お知らせ発送","description":"月謝案内と同封","sort_order":7},
  {"major_category":"新年度カウンセリング関連","name":"進路希望調査","description":"新中3・新高3対象","sort_order":8},
  {"major_category":"新年度カウンセリング関連","name":"申込書回収","description":"全員参加","sort_order":9},
  {"major_category":"新年度カウンセリング関連","name":"未提出者電話","description":"","sort_order":10},
  {"major_category":"新年度カウンセリング関連","name":"生徒面談資料","description":"個別プラン表入力＆印刷","sort_order":11},
  {"major_category":"新年度カウンセリング関連","name":"生徒面談実施","description":"目標の明確化","sort_order":12},
  {"major_category":"新年度カウンセリング関連","name":"保護者面談資料準備","description":"封筒準備、プラン製本、申込書印刷","sort_order":13},
  {"major_category":"新年度カウンセリング関連","name":"保護者面談実施","description":"","sort_order":14},
  {"major_category":"新年度カウンセリング関連","name":"申込書受付締切","description":"面談日から1週間","sort_order":15},
  {"major_category":"新年度カウンセリング関連","name":"日程表受付締切","description":"","sort_order":16},
  {"major_category":"業務・教務関連","name":"座席・日程調整","description":"システム入力","sort_order":17},
  {"major_category":"業務・教務関連","name":"プラン・回数調整","description":"申込回数にプランを調整","sort_order":18},
  {"major_category":"業務・教務関連","name":"生徒日程表開示","description":"","sort_order":19},
  {"major_category":"業務・教務関連","name":"教材発注","description":"在塾生分","sort_order":20},
  {"major_category":"講師関連","name":"シフト作成・調整","description":"帰省・旅行予定を把握","sort_order":21},
  {"major_category":"講師関連","name":"研修内容作成","description":"","sort_order":22},
  {"major_category":"講師関連","name":"講師研修実施","description":"","sort_order":23},
  {"major_category":"販売促進関連","name":"チラシ配布","description":"","sort_order":24},
  {"major_category":"販売促進関連","name":"DM発送","description":"","sort_order":25},
  {"major_category":"販売促進関連","name":"体験授業実施","description":"","sort_order":26}
]'::jsonb)
ON CONFLICT DO NOTHING;

-- 夏期スケジュールテンプレート更新 (Excelの「標準」シート参照)
UPDATE course_prep_templates
SET template_data = '[
  {"major_category":"夏期講習","name":"夏期講習期間","description":"","sort_order":0},
  {"major_category":"プラン作成","name":"PCS実施","description":"中学生はEMの2科、小学生はMJ","sort_order":1},
  {"major_category":"プラン作成","name":"PCS回収","description":"回収からSKS入力まで","sort_order":2},
  {"major_category":"プラン作成","name":"夏期講習プラン作成","description":"中3は3科提案、小～中2は2科＋必要科目","sort_order":3},
  {"major_category":"夏期面談","name":"お知らせ発送","description":"月謝案内と同封","sort_order":4},
  {"major_category":"夏期面談","name":"進路希望調査","description":"中3・高3対象","sort_order":5},
  {"major_category":"夏期面談","name":"申込書回収","description":"全員参加","sort_order":6},
  {"major_category":"夏期面談","name":"未提出者電話","description":"","sort_order":7},
  {"major_category":"夏期面談","name":"生徒面談資料","description":"個別プラン表入力＆印刷","sort_order":8},
  {"major_category":"夏期面談","name":"生徒面談実施","description":"目標の明確化","sort_order":9},
  {"major_category":"夏期面談","name":"保護者面談資料準備","description":"封筒準備、プラン製本、申込書印刷","sort_order":10},
  {"major_category":"夏期面談","name":"保護者面談実施","description":"","sort_order":11},
  {"major_category":"夏期面談","name":"申込書受付締切","description":"面談日から1週間","sort_order":12},
  {"major_category":"夏期面談","name":"日程表受付締切","description":"","sort_order":13},
  {"major_category":"業務・教務関連","name":"座席・日程調整","description":"システム入力","sort_order":14},
  {"major_category":"業務・教務関連","name":"プラン・回数調整","description":"申込回数にプランを調整","sort_order":15},
  {"major_category":"業務・教務関連","name":"生徒日程表開示","description":"","sort_order":16},
  {"major_category":"業務・教務関連","name":"教材発注","description":"在塾生分","sort_order":17},
  {"major_category":"講師シフト","name":"シフト作成・調整","description":"帰省・旅行予定を把握","sort_order":18},
  {"major_category":"講師シフト","name":"研修内容作成","description":"","sort_order":19},
  {"major_category":"講師シフト","name":"講師研修実施","description":"","sort_order":20},
  {"major_category":"期末テスト","name":"対策提案配布","description":"","sort_order":21},
  {"major_category":"期末テスト","name":"対策授業","description":"","sort_order":22},
  {"major_category":"期末テスト","name":"対策勉強会","description":"","sort_order":23},
  {"major_category":"期末テスト","name":"期末テスト","description":"","sort_order":24}
]'::jsonb
WHERE name = '夏期講習準備スケジュール'
  AND template_type = 'schedule'
  AND is_default = true;
