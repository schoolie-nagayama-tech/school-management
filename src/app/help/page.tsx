'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface FaqItem {
  question: string;
  answer: string;
}

interface FaqCategory {
  title: string;
  items: FaqItem[];
}

const FAQ_DATA: FaqCategory[] = [
  {
    title: '生徒管理',
    items: [
      {
        question: '生徒の新規登録方法',
        answer:
          '生徒一覧ページの「新規登録」ボタンをクリックし、氏名・フリガナ・学年などの必要情報を入力して保存してください。',
      },
      {
        question: 'CSV一括インポートの手順',
        answer:
          '生徒一覧ページの「CSVインポート」ボタンからCSVファイルをアップロードできます。テンプレートをダウンロードしてフォーマットを確認してから、データを入力してください。',
      },
      {
        question: '退会の登録方法',
        answer:
          '生徒の編集画面で在籍状況を「退会」に変更してください。確認ダイアログが表示されます。退会すると一覧で非表示になりますが、データは保持されます。',
      },
      {
        question: '学年一括更新について',
        answer:
          '年度切り替え時に、生徒一覧の「学年一括更新」機能を使って全生徒の学年を一括で進級させることができます。',
      },
    ],
  },
  {
    title: '成績管理',
    items: [
      {
        question: '成績の入力方法',
        answer:
          '生徒詳細から「成績の詳細を確認」をクリックし、成績ページで各セルをクリックして直接入力できます。「行を追加」でテスト行を追加してください。',
      },
      {
        question: '換算内申の見方',
        answer:
          '内申テーブルの右端に「換算内申」列が表示されます。都立（5科×1+実技4科×2＝65点満点）と神奈川（9科合計＝45点満点）を切り替えて確認できます。',
      },
      {
        question: 'グラフの表示方法',
        answer:
          '成績ページで「グラフを表示」ボタンをクリックすると、定期テストの推移グラフが表示されます。模試の偏差値推移グラフも別途表示可能です。',
      },
      {
        question: '模試成績のCSVインポート',
        answer:
          '模試セクションの「CSVインポート」ボタンからCSVファイルをインポートできます。テンプレートをダウンロードしてフォーマットを確認してください。テスト名は「会場模試」または「教室模試」、試験月はYYYY-MM形式で入力します。',
      },
    ],
  },
  {
    title: '座席表・通塾日程',
    items: [
      {
        question: '通塾日程の登録方法',
        answer:
          '生徒詳細の「通塾日程」タブ、または座席管理ページから、曜日・時間帯・担当講師を設定できます。',
      },
      {
        question: 'スケジュールの一括生成',
        answer:
          'スケジュール管理ページの「一括生成」機能で、登録済みの通塾パターンから指定期間のスケジュールを自動生成できます。',
      },
      {
        question: '振替の操作方法',
        answer:
          'スケジュール一覧から対象の授業を選択し、「振替」ボタンで別の日時に変更できます。振替元は「振替済み」ステータスになります。',
      },
    ],
  },
  {
    title: 'フォーム管理',
    items: [
      {
        question: '増コマ申込の設定方法',
        answer:
          'フォーム管理ページで「増コマ申込」フォームを作成し、期間と対象学年を設定して公開します。保護者はポータルから回答できます。',
      },
      {
        question: '回答の紐付け方法',
        answer:
          'フォーム回答一覧で、未紐付けの回答を選択し、対応する生徒を選んで紐付けます。自動紐づけ設定をONにすると、名前が一致する生徒に自動で紐付けされます。',
      },
    ],
  },
  {
    title: 'アラート',
    items: [
      {
        question: 'アラートの種類と意味',
        answer:
          '成績低下（前回比-10点以上）、成績未入力、面談未更新（30日以上）、申込未提出（期日超過）、タスク未完了、テスト目標未設定の6種類があります。',
      },
      {
        question: '対応済みの操作方法',
        answer:
          '各アラートの「対応済み」ボタンをクリックすると、そのアラートが非表示になります。室長以上の権限が必要です。',
      },
      {
        question: '期日の色分けについて',
        answer:
          '期日付きアラートは段階的に色が変わります。3〜2日前は黄色、1日前〜当日はオレンジ、期限切れ1〜3日は薄い赤、4日以上超過は濃い赤で表示されます。',
      },
    ],
  },
  {
    title: '申込状況',
    items: [
      {
        question: '申込項目の追加方法',
        answer:
          '申込状況ページの設定（歯車アイコン）から、新しい項目を追加できます。チェック・数値・日付の3種類のカラムタイプが選べます。',
      },
      {
        question: '期日の設定方法',
        answer:
          '項目作成時または編集時に「期日」を設定できます。期日を設定すると、未完了の項目が期日3日前からアラートに表示されます。',
      },
    ],
  },
  {
    title: 'アップデート情報',
    items: [
      {
        question: 'アップデート情報はどこで確認できますか？',
        answer:
          '生徒一覧ページの上部に「アップデート情報」ボードが表示されます。新しい更新があると「NEW」バッジが付きます。「確認済み」ボタンでバッジを消せます。',
      },
      {
        question: '更新内容の追加方法（管理者向け）',
        answer:
          'src/lib/data/releaseNotes.ts ファイルの RELEASE_NOTES 配列に新しいエントリを追加してください。version, date, title, items を記入するとアップデート情報ボードに自動で表示されます。',
      },
    ],
  },
];

function FaqAccordion({ category }: { category: FaqCategory }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
      <div className="px-4 py-3 bg-[var(--surface)] border-b border-gray-200">
        <h2 className="text-base font-semibold text-[var(--headline)]">{category.title}</h2>
      </div>
      <div className="divide-y divide-gray-100">
        {category.items.map((item, index) => (
          <div key={index}>
            <button
              onClick={() => setOpenIndex(openIndex === index ? null : index)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
            >
              <span className="text-sm font-medium text-[#1f2937]">{item.question}</span>
              {openIndex === index ? (
                <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
              )}
            </button>
            {openIndex === index && (
              <div className="px-4 pb-3">
                <p className="text-sm text-[#4b5563] leading-relaxed whitespace-pre-wrap">{item.answer}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HelpPage() {
  return (
    <AdminLayout headerTitle="ヘルプ">
      <div className="space-y-6">
        {/* ヘッダー */}
        <div className="flex items-center justify-between">
          <div>
            <Link
              href="/students"
              className="text-sm text-[var(--paragraph)] hover:text-[#3b82f6] mb-2 inline-block"
            >
              ← 生徒一覧に戻る
            </Link>
            <h1 className="text-2xl font-bold text-[var(--headline)]">ヘルプ</h1>
          </div>
        </div>
        <p className="text-sm text-[var(--paragraph)]">
          操作方法やよくある質問をカテゴリ別にまとめています。
        </p>
        <div className="space-y-4">
          {FAQ_DATA.map((category) => (
            <FaqAccordion key={category.title} category={category} />
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}
