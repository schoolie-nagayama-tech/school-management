'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { useAuth } from '@/contexts/AuthContext';
import {
  ChevronDown,
  ChevronUp,
  Search,
  X,
  Users,
  BarChart3,
  CalendarDays,
  FileText,
  Bell,
  ClipboardCheck,
  Settings,
  GraduationCap,
  BookOpen,
  Briefcase,
  UserCog,
  Globe,
  Shield,
  HelpCircle,
  ExternalLink,
  type LucideIcon,
} from 'lucide-react';
import type { UserRole } from '@/types/database';

type RoleTag = 'admin' | 'manager' | 'teacher' | 'all';

interface FaqItem {
  question: string;
  answer: string;
  keywords?: string[];
  link?: { href: string; label: string };
  roles?: RoleTag[];
}

interface FaqCategory {
  id: string;
  title: string;
  icon: LucideIcon;
  description: string;
  items: FaqItem[];
}

const FAQ_DATA: FaqCategory[] = [
  {
    id: 'students',
    title: '生徒管理',
    icon: Users,
    description: '生徒の登録・編集・検索・一括操作',
    items: [
      {
        question: '生徒の新規登録方法',
        answer:
          '生徒一覧ページの「新規登録」ボタンをクリックし、氏名・フリガナ・学年・教室などの必要情報を入力して保存してください。在籍状況はデフォルトで「在籍」になります。',
        keywords: ['登録', '追加', '新規'],
        link: { href: '/students', label: '生徒一覧' },
        roles: ['admin', 'manager'],
      },
      {
        question: 'CSV一括インポートの手順',
        answer:
          '生徒一覧ページの「CSVインポート」ボタンからCSVファイルをアップロードできます。テンプレートをダウンロードしてフォーマットを確認してから、データを入力してください。インポート前にプレビュー画面でデータを確認できます。',
        keywords: ['CSV', 'インポート', '一括', 'テンプレート'],
        link: { href: '/students', label: '生徒一覧' },
        roles: ['admin', 'manager'],
      },
      {
        question: '退会・休会の登録方法',
        answer:
          '生徒の編集画面で在籍状況を「退会」または「休会」に変更してください。確認ダイアログが表示されます。退会・休会にすると一覧でデフォルト非表示になりますが、データは保持されます。フィルターで「退会生含む」を選択すれば再表示できます。',
        keywords: ['退会', '休会', '除籍', '退塾'],
        roles: ['admin', 'manager'],
      },
      {
        question: '学年一括更新について',
        answer:
          '年度切り替え時に、生徒一覧の「学年一括更新」機能を使って全生徒の学年を一括で進級させることができます。小6→中1、中3→高1のような学校段階をまたぐ進級にも対応しています。',
        keywords: ['学年', '進級', '年度', '一括更新'],
        link: { href: '/students', label: '生徒一覧' },
        roles: ['admin', 'manager'],
      },
      {
        question: '生徒の検索・フィルタ方法',
        answer:
          '生徒一覧ページ上部の検索バーで、名前・フリガナで検索できます。フィルター機能を使うと、学年・教室・在籍状況での絞り込みが可能です。複数の条件を組み合わせて検索できます。',
        keywords: ['検索', 'フィルタ', '絞り込み'],
        link: { href: '/students', label: '生徒一覧' },
      },
      {
        question: '生徒詳細ページの見方',
        answer:
          '生徒をクリックすると詳細ページが開きます。基本情報・成績・通塾日程・面談記録・提案書などのタブがあります。各タブで生徒の状況を総合的に確認・管理できます。',
        keywords: ['詳細', 'プロフィール', 'タブ'],
      },
    ],
  },
  {
    id: 'scores',
    title: '成績管理',
    icon: BarChart3,
    description: '定期テスト・模試・内申・グラフ表示',
    items: [
      {
        question: '定期テスト成績の入力方法',
        answer:
          '生徒詳細から「成績の詳細を確認」をクリックし、成績ページで各セルをクリックして直接入力できます。「行を追加」でテスト行を追加してください。科目ごとに点数を入力し、合計は自動計算されます。',
        keywords: ['成績', '入力', 'テスト', '定期テスト', '点数'],
        roles: ['admin', 'manager'],
      },
      {
        question: '内申点の入力と換算内申の見方',
        answer:
          '内申テーブルで各科目の評定を入力します。右端に「換算内申」列が表示され、都立（5科×1+実技4科×2＝65点満点）と神奈川（9科合計＝45点満点）を切り替えて確認できます。',
        keywords: ['内申', '換算', '評定', '通知表'],
        roles: ['admin', 'manager'],
      },
      {
        question: '模試成績の管理方法',
        answer:
          '模試セクションでは偏差値・順位・志望校判定を記録できます。「会場模試」「教室模試」の2種類に対応しています。模試結果の推移グラフで偏差値の変化を視覚的に確認できます。',
        keywords: ['模試', '偏差値', '判定', '会場模試', '教室模試'],
        roles: ['admin', 'manager'],
      },
      {
        question: '模試成績のCSVインポート',
        answer:
          '模試セクションの「CSVインポート」ボタンからCSVファイルをインポートできます。テンプレートをダウンロードしてフォーマットを確認してください。テスト名は「会場模試」または「教室模試」、試験月はYYYY-MM形式で入力します。',
        keywords: ['模試', 'CSV', 'インポート', '一括'],
        roles: ['admin', 'manager'],
      },
      {
        question: '模試成績の一括コピペ取り込み',
        answer:
          '模試セクションの「コピペ取り込み」ボタンから、Excelや他のシステムからコピーしたデータを貼り付けて一括取り込みできます。ヘッダー行を含むデータをそのまま貼り付けると、自動で列を認識します。',
        keywords: ['模試', 'コピペ', '貼り付け', '一括', 'Excel'],
        roles: ['admin', 'manager'],
      },
      {
        question: 'グラフの表示方法',
        answer:
          '成績ページで「グラフを表示」ボタンをクリックすると、定期テストの推移グラフが表示されます。科目別・合計の推移を確認できます。模試の偏差値推移グラフも別途表示可能です。',
        keywords: ['グラフ', '推移', '可視化', 'チャート'],
      },
      {
        question: 'テスト目標の設定',
        answer:
          '成績ページで各テストに対して目標点数を設定できます。目標が未設定の場合はアラートが表示されます。目標との差分を確認して指導に活用してください。',
        keywords: ['目標', 'ゴール', '目標設定'],
        roles: ['admin', 'manager'],
      },
    ],
  },
  {
    id: 'schedule',
    title: '座席表・通塾日程',
    icon: CalendarDays,
    description: '通塾パターン・座席配置・振替・スケジュール生成',
    items: [
      {
        question: '通塾日程の登録方法',
        answer:
          '生徒詳細の「通塾日程」タブ、または座席管理ページから、曜日・時間帯・担当講師を設定できます。複数の曜日パターンを登録可能です。',
        keywords: ['通塾', '曜日', '時間帯', '日程'],
        roles: ['admin', 'manager'],
      },
      {
        question: 'スケジュールの一括生成',
        answer:
          'スケジュール管理ページの「一括生成」機能で、登録済みの通塾パターンから指定期間のスケジュールを自動生成できます。祝日・休校日は自動でスキップされます。',
        keywords: ['一括生成', 'スケジュール', '自動'],
        link: { href: '/schedule', label: '座席表' },
        roles: ['admin'],
      },
      {
        question: '振替の操作方法',
        answer:
          'スケジュール一覧から対象の授業を選択し、「振替」ボタンで別の日時に変更できます。振替元は「振替済み」ステータスになります。空きコマが表示されるので選択するだけで完了します。',
        keywords: ['振替', '変更', '日程変更'],
        link: { href: '/schedule', label: '座席表' },
        roles: ['admin', 'manager'],
      },
      {
        question: '座席表の見方・使い方',
        answer:
          '座席表は日付・時間帯ごとに生徒の配置を確認できるビューです。上部メニューの座席表アイコンからアクセスします。ドラッグ＆ドロップでの座席変更や、空席の確認が可能です。管理者権限が必要です。',
        keywords: ['座席', '配置', '空席'],
        link: { href: '/schedule', label: '座席表' },
        roles: ['admin'],
      },
      {
        question: '休校日の設定',
        answer:
          '座席表の設定から休校日を登録できます。祝日・年末年始・お盆などを設定すると、スケジュール一括生成時に自動でスキップされます。',
        keywords: ['休校', '祝日', '休み', '閉校日'],
        link: { href: '/schedule/settings/closed-days', label: '休校日設定' },
        roles: ['admin'],
      },
      {
        question: 'コマ種別（出欠タイプ）の設定',
        answer:
          '管理者メニューの「コマ種別設定」から出欠のタイプ（通常・振替・補習など）をカスタマイズできます。各種別に色を設定でき、座席表で視覚的に区別できます。',
        keywords: ['コマ種別', '出欠', 'タイプ', '区分'],
        link: { href: '/admin/settings/attendance-types', label: 'コマ種別設定' },
        roles: ['admin'],
      },
    ],
  },
  {
    id: 'forms',
    title: 'フォーム・ポータル管理',
    icon: FileText,
    description: '保護者ポータル・各種フォーム・回答管理',
    items: [
      {
        question: '保護者ポータルとは',
        answer:
          '保護者がログインなしでアクセスできる専用ページです。教室ごとに固有のURLがあり、面談申し込み・模試申し込み・曜日変更・増コマ申し込みなどのフォームに回答できます。ポータル設定ページでフォームの公開/非公開を切り替えられます。',
        keywords: ['ポータル', '保護者', '公開', 'URL'],
        link: { href: '/settings/portal', label: 'ポータル設定' },
        roles: ['admin', 'manager'],
      },
      {
        question: 'フォームの種類について',
        answer:
          '6種類のフォームがあります。\n・面談希望（moshi）：保護者面談の日程調整\n・模試申し込み（mogi）：模試の受験申し込み\n・集会数報告（shukaisu）：出席状況の報告\n・相談（soudan）：各種相談の受付\n・曜日変更（youbi）：通塾曜日の変更依頼\n・増コマ（zoukoma）：テスト対策など追加授業の申し込み',
        keywords: ['フォーム', '種類', '面談', '模試', '増コマ', '曜日', '相談'],
        roles: ['admin', 'manager'],
      },
      {
        question: 'フォーム期間の設定方法',
        answer:
          '設定 > フォーム管理から各フォームの受付期間を作成できます。期間名・受付開始日・受付終了日を設定し、「公開」にすると保護者ポータルに表示されます。過去の期間は自動で非表示になります。',
        keywords: ['期間', '受付', '公開', '設定'],
        roles: ['admin', 'manager'],
      },
      {
        question: '回答の確認・紐付け方法',
        answer:
          '回答一覧ページで各期間の回答を確認できます。未紐付けの回答は生徒を選んで紐付けます。自動紐付け設定をONにすると、名前が一致する生徒に自動で紐付けされます。紐付け済みの回答は生徒詳細からも確認可能です。',
        keywords: ['回答', '紐付け', '自動', '確認'],
        link: { href: '/responses', label: '回答一覧' },
        roles: ['admin', 'manager'],
      },
      {
        question: '新着回答の通知について',
        answer:
          '生徒一覧ページの上部に「新着回答」ボードが表示されます。直近7日間の未紐付け回答が最大10件表示され、クリックすると対応する回答一覧に遷移します。講師ロールでは非表示です。',
        keywords: ['新着', '通知', '未読', 'ボード'],
        link: { href: '/students', label: '生徒一覧' },
        roles: ['admin', 'manager'],
      },
      {
        question: 'ポータルの見た目カスタマイズ',
        answer:
          '設定 > ポータル設定から、教室のロゴ画像・表示名・公開するフォームの選択が行えます。保護者に表示されるポータルページの内容をカスタマイズできます。',
        keywords: ['ポータル', 'カスタマイズ', 'ロゴ', 'デザイン'],
        link: { href: '/settings/portal', label: 'ポータル設定' },
        roles: ['admin', 'manager'],
      },
    ],
  },
  {
    id: 'alerts',
    title: 'アラート',
    icon: Bell,
    description: 'アラート種別・対応方法・期日管理',
    items: [
      {
        question: 'アラートの種類と意味',
        answer:
          '以下の6種類があります。\n・成績低下：前回比-10点以上の科目がある場合\n・成績未入力：最新テストの成績が未入力の場合\n・面談未更新：30日以上面談記録がない場合\n・申込未提出：期日を過ぎても提出がない場合\n・タスク未完了：期限切れのタスクがある場合\n・テスト目標未設定：目標が設定されていない場合',
        keywords: ['アラート', '種類', '通知', '警告'],
        roles: ['admin', 'manager'],
      },
      {
        question: '対応済みの操作方法',
        answer:
          '各アラートの「対応済み」ボタンをクリックすると、そのアラートが非表示になります。室長以上の権限が必要です。対応済みにしても、条件が再度満たされれば再表示されます。',
        keywords: ['対応済み', '既読', '消す', '解除'],
        roles: ['admin', 'manager'],
      },
      {
        question: '期日の色分けについて',
        answer:
          '期日付きアラートは段階的に色が変わります。\n・3〜2日前：黄色（注意）\n・1日前〜当日：オレンジ（警告）\n・期限切れ1〜3日：薄い赤（超過）\n・4日以上超過：濃い赤（重大超過）',
        keywords: ['期日', '色', '期限', '超過'],
        roles: ['admin', 'manager'],
      },
      {
        question: 'アラート設定のカスタマイズ',
        answer:
          '設定 > アラート設定から、各アラートの有効/無効を切り替えたり、しきい値を変更できます。例えば、成績低下の基準を-10点から-15点に変更するなどのカスタマイズが可能です。',
        keywords: ['設定', 'カスタマイズ', 'しきい値', '有効', '無効'],
        link: { href: '/settings/alerts', label: 'アラート設定' },
        roles: ['admin', 'manager'],
      },
    ],
  },
  {
    id: 'applications',
    title: '申込状況',
    icon: ClipboardCheck,
    description: '申込管理・チェックリスト・進捗追跡',
    items: [
      {
        question: '申込状況ページとは',
        answer:
          '生徒ごとの各種申込み・提出物の進捗を一覧管理できるページです。講習申込・テスト申込・書類提出など、チェックリスト形式で未完了/完了を管理できます。',
        keywords: ['申込', '提出', 'チェックリスト', '進捗'],
        link: { href: '/applications', label: '申込状況' },
        roles: ['admin', 'manager'],
      },
      {
        question: '申込項目の追加方法',
        answer:
          '申込状況ページの設定（歯車アイコン）から、新しい項目を追加できます。チェック・数値・日付の3種類のカラムタイプが選べます。項目名と期日を設定してください。',
        keywords: ['項目', '追加', 'カラム', '設定'],
        link: { href: '/applications', label: '申込状況' },
        roles: ['admin', 'manager'],
      },
      {
        question: '期日の設定とアラート連動',
        answer:
          '項目作成時または編集時に「期日」を設定できます。期日を設定すると、未完了の項目が期日3日前からアラートに表示されます。期日はアラートの色分けとも連動しています。',
        keywords: ['期日', 'アラート', '連動', '通知'],
        roles: ['admin', 'manager'],
      },
      {
        question: '埋め込み表示について',
        answer:
          '申込状況は外部サイトに埋め込み表示が可能です。/embed/applications のURLで、教室別の申込状況を別画面で表示できます。',
        keywords: ['埋め込み', 'embed', '外部', '表示'],
        roles: ['admin'],
      },
    ],
  },
  {
    id: 'courses',
    title: '講習管理',
    icon: GraduationCap,
    description: '講習作成・進捗管理・スケジュール・提案書',
    items: [
      {
        question: '講習の作成・管理方法',
        answer:
          '講習一覧ページから新しい講習を作成できます。講習名・対象学年・期間・科目などを設定します。テンプレートから作成することもできます。',
        keywords: ['講習', '作成', '新規', 'テンプレート'],
        link: { href: '/courses', label: '講習一覧' },
        roles: ['admin', 'manager'],
      },
      {
        question: '講習進捗の管理方法',
        answer:
          '講習管理 > 進捗管理ページで、講習の進行状況を管理できます。カリキュラムの消化率・生徒ごとの達成状況・未着手項目を一覧で確認できます。Googleカレンダーと連携して進捗を同期することも可能です。',
        keywords: ['進捗', '管理', '達成', 'カリキュラム'],
        link: { href: '/courses/progress', label: '講習進捗' },
        roles: ['admin', 'manager'],
      },
      {
        question: '準備スケジュールの使い方',
        answer:
          '講習管理 > 準備スケジュールで、講習開始前の準備タスクを管理できます。教材準備・時間割作成・保護者連絡などのタスクを期日付きで管理します。',
        keywords: ['準備', 'スケジュール', 'タスク', '計画'],
        link: { href: '/courses/schedule', label: '準備スケジュール' },
        roles: ['admin', 'manager'],
      },
      {
        question: '提案書の作成方法',
        answer:
          '講習管理 > 提案書で、生徒ごとの講習提案書を作成できます。受講科目・コマ数・料金の提案をまとめ、保護者に提示する資料を作成します。生徒詳細からも個別の提案書にアクセスできます。',
        keywords: ['提案書', '料金', 'コマ数', '受講'],
        link: { href: '/courses/proposals', label: '提案書' },
        roles: ['admin', 'manager'],
      },
    ],
  },
  {
    id: 'teachers',
    title: '講師管理',
    icon: UserCog,
    description: '講師情報・出勤簿・シフト・研修バッジ',
    items: [
      {
        question: '講師の登録・編集方法',
        answer:
          '講師メニュー > 講師一覧から、講師の新規登録・編集ができます。氏名・連絡先・担当科目・勤務可能曜日などを管理します。管理者またはマネージャー権限が必要です。',
        keywords: ['講師', '登録', '編集', '追加'],
        link: { href: '/admin/teachers', label: '講師一覧' },
        roles: ['admin', 'manager'],
      },
      {
        question: '出勤簿の管理方法',
        answer:
          '講師メニュー > 出勤簿管理で、講師の出勤記録を管理できます。日別・月別の出勤状況を確認し、勤怠データの集計が可能です。講師自身も自分の出勤簿を閲覧できます。',
        keywords: ['出勤', '勤怠', '出勤簿', '管理'],
        link: { href: '/admin/attendance', label: '出勤簿管理' },
      },
      {
        question: 'シフト管理（通常・季節講習）',
        answer:
          '通常シフトと季節講習シフトの2種類があります。設定画面でシフト設定を作成し、講師に共有URLを送付すると、講師が自分で希望シフトを入力できます。提出状況は管理画面で確認できます。',
        keywords: ['シフト', '通常', '季節', '希望', '提出'],
        link: { href: '/settings/seasonal-shifts', label: 'シフト設定' },
        roles: ['admin', 'manager'],
      },
      {
        question: '研修バッジの管理',
        answer:
          '講師メニュー > 研修バッジ管理で、講師の研修受講・資格取得をバッジとして管理できます。バッジの種類を作成し、講師に付与します。講師は「マイバッジ」ページで自分のバッジを確認できます。',
        keywords: ['研修', 'バッジ', '資格', '認定'],
        link: { href: '/admin/teacher-badges', label: '研修バッジ管理' },
      },
      {
        question: 'マイバッジの確認方法（講師向け）',
        answer:
          'ヘッダーのバッジアイコンから「マイバッジ」ページにアクセスできます。取得済みバッジ・研修履歴を確認できます。',
        keywords: ['マイバッジ', '講師', '確認', '取得'],
        link: { href: '/my/badges', label: 'マイバッジ' },
        roles: ['teacher'],
      },
    ],
  },
  {
    id: 'business',
    title: '業務管理',
    icon: Briefcase,
    description: '請求・教材発注・在庫・業務タスク',
    items: [
      {
        question: '請求管理の使い方',
        answer:
          '業務管理 > 請求管理で、生徒ごとの月謝・講習費用などの請求情報を管理できます。請求書の作成・確認・ステータス管理が可能です。',
        keywords: ['請求', '月謝', '費用', '料金'],
        link: { href: '/billing', label: '請求管理' },
        roles: ['admin', 'manager'],
      },
      {
        question: '教材・発注管理の使い方',
        answer:
          '業務管理 > 教材・発注管理で、教材の発注・在庫管理ができます。発注依頼の作成・承認・発注履歴の確認が可能です。発注状況はステータスで管理されます。',
        keywords: ['教材', '発注', '注文', '購入'],
        link: { href: '/ordering', label: '教材・発注管理' },
        roles: ['admin', 'manager'],
      },
      {
        question: '在庫管理の使い方',
        answer:
          '在庫管理ページで、教材やプリントの在庫数を管理できます。在庫切れが近い教材のアラートや、入出庫の履歴確認が可能です。',
        keywords: ['在庫', 'ストック', '管理', '教材'],
        link: { href: '/inventory', label: '在庫管理' },
        roles: ['admin', 'manager'],
      },
      {
        question: '業務進捗管理表（タスク管理）',
        answer:
          '業務管理 > 業務進捗管理表で、教室運営に関するタスクを管理できます。タスクの作成・担当者割り当て・期日設定・完了チェックができます。月次のルーティンタスクにも対応しています。',
        keywords: ['タスク', '業務', '進捗', 'ToDo'],
        link: { href: '/tasks', label: '業務進捗管理表' },
        roles: ['admin', 'manager'],
      },
    ],
  },
  {
    id: 'progress',
    title: '進行フィード',
    icon: BookOpen,
    description: '授業進行記録・カリキュラム管理',
    items: [
      {
        question: '進行フィードとは',
        answer:
          '各授業の進行状況をフィード形式で記録・確認できる機能です。講師が授業後に「どの教材のどこまで進んだか」を記録し、次回の引き継ぎに活用します。',
        keywords: ['進行', 'フィード', '授業', '記録'],
        link: { href: '/progress-feed', label: '進行フィード' },
      },
      {
        question: '教科書・カリキュラムの設定',
        answer:
          '設定 > 教科書管理で教科書を登録し、カリキュラムを設定できます。単元ごとの進行状況を管理することで、カリキュラムの消化率を可視化できます。',
        keywords: ['教科書', 'カリキュラム', '単元', '設定'],
        link: { href: '/settings/textbooks', label: '教科書管理' },
        roles: ['admin', 'manager'],
      },
      {
        question: '面談記録追加（Notta連携）',
        answer:
          'フォーム管理 > 面談記録追加で、Notta（音声文字起こしサービス）で記録した面談内容を生徒に紐付けできます。Webhook連携で自動取り込みも可能です。Slack通知にも対応しています。生徒管理ページの上部にもボタンがあります。',
        keywords: ['文字起こし', 'Notta', '面談', '音声', '議事録', '面談記録追加'],
        link: { href: '/transcriptions', label: '面談記録追加' },
        roles: ['admin', 'manager'],
      },
    ],
  },
  {
    id: 'portal',
    title: '保護者ポータル',
    icon: Globe,
    description: '保護者向け公開ページ・フォーム回答',
    items: [
      {
        question: 'ポータルURLの確認方法',
        answer:
          '設定 > ポータル設定でポータルのURLを確認できます。各教室に固有のURLが割り当てられています（/portal/[教室コード]）。このURLを保護者に共有してください。',
        keywords: ['URL', 'リンク', '共有', 'アクセス'],
        link: { href: '/settings/portal', label: 'ポータル設定' },
        roles: ['admin', 'manager'],
      },
      {
        question: 'ポータルに表示するフォームの設定',
        answer:
          '設定 > ポータル設定でフォームの公開/非公開を切り替えられます。受付期間内のフォームのみ表示されます。複数のフォームを同時に公開することも可能です。',
        keywords: ['公開', '非公開', '表示', 'フォーム'],
        link: { href: '/settings/portal', label: 'ポータル設定' },
        roles: ['admin', 'manager'],
      },
      {
        question: '保護者からの回答フロー',
        answer:
          '保護者がポータルでフォームに回答すると、回答一覧ページに自動で反映されます。未紐付けの回答は「新着回答」ボードにも表示されます。自動紐付けをONにしている場合は、名前一致で自動的に生徒に紐付けされます。',
        keywords: ['回答', '保護者', 'フロー', '紐付け'],
        link: { href: '/responses', label: '回答一覧' },
        roles: ['admin', 'manager'],
      },
    ],
  },
  {
    id: 'settings',
    title: '各種設定',
    icon: Settings,
    description: 'アカウント・教室・科目・連携・通知設定',
    items: [
      {
        question: 'アカウント設定',
        answer:
          '設定 > アカウント設定で、自分のプロフィール情報（表示名・メールアドレスなど）を変更できます。',
        keywords: ['アカウント', 'プロフィール', 'メール'],
        link: { href: '/settings/account', label: 'アカウント設定' },
      },
      {
        question: '教室（スクール）設定',
        answer:
          '設定 > 教室設定で、教室名・住所・連絡先・ロゴなどの情報を管理できます。複数教室を運営している場合、各教室の情報を個別に設定できます。',
        keywords: ['教室', 'スクール', '学校', '設定'],
        link: { href: '/settings/school', label: '教室設定' },
        roles: ['admin', 'manager'],
      },
      {
        question: '科目設定',
        answer:
          '設定 > 科目設定で、教室で扱う科目を管理できます。科目の追加・編集・並び替えが可能です。科目は成績管理やカリキュラムなど各機能で使用されます。',
        keywords: ['科目', '教科', '追加', '編集'],
        link: { href: '/settings/subjects', label: '科目設定' },
        roles: ['admin', 'manager'],
      },
      {
        question: 'Googleカレンダー連携',
        answer:
          '設定 > 連携設定からGoogleカレンダーとの連携が可能です。授業スケジュールをGoogleカレンダーに同期したり、講習の進捗管理と連携したりできます。OAuth認証で安全に接続します。',
        keywords: ['Google', 'カレンダー', '連携', '同期'],
        link: { href: '/settings/integrations', label: '連携設定' },
        roles: ['admin', 'manager'],
      },
      {
        question: 'プッシュ通知の設定',
        answer:
          'ヘッダー右上の設定メニューからプッシュ通知のON/OFFを切り替えられます。教室ごとに通知を設定でき、新着回答やアラートの通知をブラウザで受け取れます。',
        keywords: ['プッシュ', '通知', 'ブラウザ', 'お知らせ'],
        roles: ['admin', 'manager'],
      },
      {
        question: 'テーマ（ダークモード）の切り替え',
        answer:
          'ヘッダー右上の設定メニューでテーマを切り替えられます。ライトモード・ダークモード・システム設定に準拠の3種類から選択できます。',
        keywords: ['テーマ', 'ダークモード', '表示', '見た目'],
      },
    ],
  },
  {
    id: 'users',
    title: 'ユーザー管理・権限',
    icon: Shield,
    description: 'ユーザー登録・ロール・招待・セキュリティ',
    items: [
      {
        question: 'ユーザーの登録・招待方法',
        answer:
          '設定メニュー > ユーザー管理から、新しいユーザーを招待できます。メールアドレスとロール（権限）を設定して招待リンクを送信します。受信者はリンクからアカウントを作成できます。',
        keywords: ['ユーザー', '招待', '登録', 'アカウント'],
        link: { href: '/users', label: 'ユーザー管理' },
        roles: ['admin'],
      },
      {
        question: 'ロール（権限）の種類',
        answer:
          '3種類のロールがあります。\n・管理者（admin）：全機能にアクセス可能。ユーザー管理・セキュリティ設定など管理機能を使用できます。\n・室長（manager）：生徒管理・成績管理・フォーム管理など教室運営に必要な機能を使用できます。\n・講師（teacher）：自分の出勤簿・バッジの確認、担当生徒の情報閲覧が可能です。',
        keywords: ['ロール', '権限', '管理者', '室長', '講師'],
      },
      {
        question: 'セキュリティ設定',
        answer:
          '管理者メニュー > セキュリティ設定で、パスワードポリシー・セッションタイムアウトなどのセキュリティ設定を管理できます。管理者のみアクセス可能です。',
        keywords: ['セキュリティ', 'パスワード', 'セッション', '安全'],
        link: { href: '/admin/settings/security', label: 'セキュリティ設定' },
        roles: ['admin'],
      },
      {
        question: 'なりすまし（代理ログイン）機能',
        answer:
          '管理者はユーザー管理画面から、他のユーザーとして操作できる「なりすまし」機能を使用できます。操作中は画面上部にバナーが表示されます。トラブルシューティングや設定確認に便利です。',
        keywords: ['なりすまし', '代理', 'ログイン', 'impersonate'],
        link: { href: '/users', label: 'ユーザー管理' },
        roles: ['admin'],
      },
    ],
  },
  {
    id: 'updates',
    title: 'アップデート・その他',
    icon: HelpCircle,
    description: '更新情報・トラブルシューティング・操作ヒント',
    items: [
      {
        question: 'アップデート情報の確認方法',
        answer:
          '生徒一覧ページの上部に「アップデート情報」ボードが表示されます。新しい更新があると「NEW」バッジが付きます。「確認済み」ボタンでバッジを消せます。',
        keywords: ['アップデート', '更新', 'NEW', 'お知らせ'],
        link: { href: '/students', label: '生徒一覧' },
      },
      {
        question: 'デモ教室について',
        answer:
          'デモ用の教室が用意されています。ユーザー管理の教室タブでデモ/通常を切り替えられます。デモ教室はヘッダーの教室選択に表示されません（通常教室がない場合のみ表示）。',
        keywords: ['デモ', 'テスト', 'サンプル', '教室'],
        roles: ['admin'],
      },
      {
        question: 'データが表示されない場合',
        answer:
          '以下を確認してください。\n・ヘッダーの教室選択で正しい教室が選択されているか\n・フィルターで絞り込みがかかっていないか\n・権限のあるロールでログインしているか\n・ブラウザのキャッシュをクリアしてリロードする\nそれでも解決しない場合は管理者にお問い合わせください。',
        keywords: ['表示されない', 'エラー', '不具合', 'トラブル'],
      },
      {
        question: 'ログインできない場合',
        answer:
          'ログイン画面の「パスワードを忘れた方」リンクからパスワードリセットが可能です。メールアドレスを入力するとリセットリンクが送信されます。メールが届かない場合は、迷惑メールフォルダを確認するか管理者に連絡してください。',
        keywords: ['ログイン', 'パスワード', 'リセット', '忘れた'],
      },
      {
        question: 'オフラインモードについて',
        answer:
          'インターネット接続が切れた場合、オフラインページが表示されます。接続が復旧すると自動的に通常画面に戻ります。オフライン中のデータ入力はできません。',
        keywords: ['オフライン', '接続', 'ネット', '切れた'],
      },
    ],
  },
];

const ROLE_LABELS: Record<RoleTag, string> = {
  all: 'すべて',
  admin: '管理者',
  manager: '室長',
  teacher: '講師',
};

function mapUserRoleToTag(role: UserRole | undefined): RoleTag {
  if (!role) return 'all';
  if (role === 'admin' || role === 'owner') return 'admin';
  if (role === 'manager') return 'manager';
  if (role === 'teacher') return 'teacher';
  return 'all';
}

function itemMatchesRole(item: FaqItem, roleFilter: RoleTag): boolean {
  if (roleFilter === 'all') return true;
  if (!item.roles) return true;
  return item.roles.includes(roleFilter);
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const terms = query.trim().split(/\s+/).filter(Boolean);
  const pattern = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const regex = new RegExp(`(${pattern})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="bg-yellow-200 dark:bg-yellow-700/60 text-inherit rounded-sm px-0.5">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

function FaqAccordion({
  category,
  searchQuery,
  defaultOpen,
}: {
  category: FaqCategory;
  searchQuery: string;
  defaultOpen: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [openItems, setOpenItems] = useState<Set<number>>(
    () => new Set(defaultOpen ? category.items.map((_, i) => i) : [])
  );

  useEffect(() => {
    if (defaultOpen) {
      setIsOpen(true);
      setOpenItems(new Set(category.items.map((_, i) => i)));
    }
  }, [defaultOpen, category.items]);

  const toggleItem = (index: number) => {
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const Icon = category.icon;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 bg-[var(--surface)] border-b border-gray-200 dark:border-gray-700 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
      >
        <Icon className="w-5 h-5 text-[var(--primary)] shrink-0" />
        <div className="flex-1 text-left">
          <h2 className="text-base font-semibold text-[var(--headline)]">{category.title}</h2>
          <p className="text-xs text-[var(--paragraph)] mt-0.5">{category.description}</p>
        </div>
        <span className="text-xs text-gray-400 mr-2">{category.items.length}件</span>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
        )}
      </button>
      {isOpen && (
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          {category.items.map((item, index) => (
            <div key={index}>
              <button
                onClick={() => toggleItem(index)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors duration-150"
              >
                <span className="text-sm font-medium text-text-heading pr-2">
                  {highlightText(item.question, searchQuery)}
                </span>
                {openItems.has(index) ? (
                  <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                )}
              </button>
              {openItems.has(index) && (
                <div className="px-4 pb-3">
                  <p className="text-sm text-text-body leading-relaxed whitespace-pre-wrap">
                    {highlightText(item.answer, searchQuery)}
                  </p>
                  {item.link && (
                    <Link
                      href={item.link.href}
                      className="inline-flex items-center gap-1 mt-2 text-xs text-[var(--primary)] hover:underline"
                    >
                      {item.link.label}
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function HelpPage() {
  const { profile } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<RoleTag>('all');
  const [showMyRoleOnly, setShowMyRoleOnly] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const myRole = mapUserRoleToTag(profile?.role as UserRole | undefined);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        setSearchQuery('');
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const matchesSearch = useCallback(
    (item: FaqItem): boolean => {
      if (!searchQuery.trim()) return true;
      const terms = searchQuery.trim().toLowerCase().split(/\s+/);
      const target = `${item.question} ${item.answer} ${(item.keywords || []).join(' ')}`.toLowerCase();
      return terms.every((term) => target.includes(term));
    },
    [searchQuery]
  );

  const activeRoleFilter = showMyRoleOnly ? myRole : roleFilter;

  const filteredData = useMemo(() => {
    return FAQ_DATA.map((category) => ({
      ...category,
      items: category.items
        .filter(matchesSearch)
        .filter((item) => itemMatchesRole(item, activeRoleFilter)),
    }))
      .filter((category) => category.items.length > 0)
      .filter((category) => !selectedCategory || category.id === selectedCategory);
  }, [searchQuery, selectedCategory, activeRoleFilter, matchesSearch]);

  const totalResults = filteredData.reduce((sum, cat) => sum + cat.items.length, 0);
  const totalAll = FAQ_DATA.reduce((sum, cat) => sum + cat.items.length, 0);
  const isSearching = searchQuery.trim().length > 0;

  return (
    <AdminLayout headerTitle="ヘルプ">
      <div className="space-y-6">
        <div>
          <Link
            href="/students"
            className="text-sm text-[var(--paragraph)] hover:text-info mb-2 inline-block transition-colors duration-150"
          >
            ← 生徒一覧に戻る
          </Link>
          <h1 className="text-2xl font-bold text-[var(--headline)]">ヘルプ</h1>
          <p className="text-sm text-[var(--paragraph)] mt-1">
            操作方法やよくある質問をカテゴリ別にまとめています。全{totalAll}件
          </p>
        </div>

        {/* 検索 */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="キーワードで検索... (Ctrl+K)"
            className="w-full pl-10 pr-10 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-[var(--headline)] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent transition-shadow"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                searchInputRef.current?.focus();
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* ロールフィルタ */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-[var(--paragraph)] font-medium">表示対象：</span>
          {myRole !== 'all' && (
            <button
              onClick={() => {
                setShowMyRoleOnly(!showMyRoleOnly);
                if (!showMyRoleOnly) setRoleFilter('all');
              }}
              className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                showMyRoleOnly
                  ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                  : 'bg-white dark:bg-gray-800 text-[var(--paragraph)] border-gray-300 dark:border-gray-600 hover:border-[var(--primary)] hover:text-[var(--primary)]'
              }`}
            >
              自分のロール（{ROLE_LABELS[myRole]}）
            </button>
          )}
          {(['all', 'admin', 'manager', 'teacher'] as RoleTag[]).map((role) => (
            <button
              key={role}
              onClick={() => {
                setRoleFilter(role);
                setShowMyRoleOnly(false);
              }}
              className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                !showMyRoleOnly && roleFilter === role
                  ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                  : 'bg-white dark:bg-gray-800 text-[var(--paragraph)] border-gray-300 dark:border-gray-600 hover:border-[var(--primary)] hover:text-[var(--primary)]'
              }`}
            >
              {ROLE_LABELS[role]}
            </button>
          ))}
        </div>

        {/* カテゴリフィルタ */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
              !selectedCategory
                ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                : 'bg-white dark:bg-gray-800 text-[var(--paragraph)] border-gray-300 dark:border-gray-600 hover:border-[var(--primary)] hover:text-[var(--primary)]'
            }`}
          >
            すべて
          </button>
          {FAQ_DATA.map((cat) => {
            const Icon = cat.icon;
            const count = cat.items
              .filter(matchesSearch)
              .filter((item) => itemMatchesRole(item, activeRoleFilter)).length;
            if (count === 0) return null;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
                className={`px-3 py-1.5 text-xs rounded-full border transition-colors flex items-center gap-1.5 ${
                  selectedCategory === cat.id
                    ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                    : 'bg-white dark:bg-gray-800 text-[var(--paragraph)] border-gray-300 dark:border-gray-600 hover:border-[var(--primary)] hover:text-[var(--primary)]'
                }`}
              >
                <Icon className="w-3 h-3" />
                {cat.title}
                <span className="opacity-70">({count})</span>
              </button>
            );
          })}
        </div>

        {/* 検索結果情報 */}
        {(isSearching || activeRoleFilter !== 'all') && (
          <p className="text-sm text-[var(--paragraph)]">
            {isSearching && <>「{searchQuery}」の</>}
            {activeRoleFilter !== 'all' && <>{ROLE_LABELS[activeRoleFilter]}向けの</>}
            検索結果：{totalResults}件
            {totalResults === 0 && '  — キーワードやフィルタを変えてお試しください。'}
          </p>
        )}

        {/* FAQ一覧 */}
        <div className="space-y-4">
          {filteredData.length > 0 ? (
            filteredData.map((category) => (
              <FaqAccordion
                key={category.id}
                category={category}
                searchQuery={searchQuery}
                defaultOpen={isSearching}
              />
            ))
          ) : (
            <div className="text-center py-12">
              <Search className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-[var(--paragraph)]">
                該当するヘルプ項目が見つかりませんでした。
              </p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory(null);
                  setRoleFilter('all');
                  setShowMyRoleOnly(false);
                }}
                className="mt-2 text-sm text-[var(--primary)] hover:underline"
              >
                フィルターをリセット
              </button>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
