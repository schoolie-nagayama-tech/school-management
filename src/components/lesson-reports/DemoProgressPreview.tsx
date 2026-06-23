'use client';

/**
 * 進行表イメージ（ダミー・見本用）
 *
 * 報告書（入力フォームのデモ／室長の完成イメージ）の下に並べて、
 * 「進行表を見ながら報告書を書く／確認する」動線を1ページで検討するためのダミー表示。
 *
 * - 教材×単元テーブル: 学校進度マーク + 指導回数(1〜3回目)
 * - 直近の授業記録フィード: 日付/講師/単元/引継ぎ
 *
 * 実データとは連動しない。機能の方向性確認用。
 * 将来は本物の進行表データを埋め込む想定（データ取得ロジックの切り出しが前提）。
 */

const W = ['日', '月', '火', '水', '木', '金', '土'];

export function DemoProgressPreview() {
  // 教材×単元テーブルのダミー行
  const units = [
    { unit: 'Unit 4 過去進行形', school: true, l1: 3, l2: 0, l3: 0, done: true },
    { unit: 'Unit 5 未来表現', school: true, l1: 2, l2: 1, l3: 0, done: true },
    { unit: 'Unit 6 現在完了形（継続）', school: true, l1: 1, l2: 0, l3: 0, done: false },
    { unit: 'Unit 6 現在完了形（経験）', school: false, l1: 0, l2: 0, l3: 0, done: false },
    { unit: 'Unit 7 不定詞', school: false, l1: 0, l2: 0, l3: 0, done: false },
  ];
  // 直近の授業記録フィードのダミー
  const feed = [
    {
      date: '2026-05-28',
      teacher: '田中 花子',
      unit: 'Unit 6 現在完了形（継続）',
      handover: '継続用法は理解できた。次回は経験用法（ever/never）へ。',
    },
    {
      date: '2026-05-21',
      teacher: '田中 花子',
      unit: 'Unit 5 未来表現（will / be going to）',
      handover: 'be going to の使い分けに少し不安。宿題で復習指示。',
    },
    {
      date: '2026-05-14',
      teacher: '佐藤 健',
      unit: 'Unit 4 過去進行形',
      handover: '定着良好。Unit 5 へ進む。',
    },
  ];

  return (
    <div className="mt-6 border-t-2 border-dashed border-info/30 pt-4">
      <div className="rounded-lg bg-info-subtle border border-info/30 px-3 py-2 text-xs text-info mb-3">
        ↓ ここから下は<strong>進行表のイメージ</strong>（ダミー）です。
        報告書と同じページに進行フィードをマージして表示する想定です。
      </div>

      {/* 教材×単元テーブル */}
      <div className="mb-5">
        <h3 className="text-sm font-bold text-text-heading mb-2">進行表：New Horizon 中2 英語</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-surface">
                <th className="text-left p-2 border border-border-subtle">単元</th>
                <th className="p-2 border border-border-subtle w-16">学校進度</th>
                <th className="p-2 border border-border-subtle w-12">1回目</th>
                <th className="p-2 border border-border-subtle w-12">2回目</th>
                <th className="p-2 border border-border-subtle w-12">3回目</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u, i) => (
                <tr key={i} className={u.done ? 'bg-success-subtle/30' : ''}>
                  <td className="p-2 border border-border-subtle">{u.unit}</td>
                  <td className="p-2 border border-border-subtle text-center">
                    {u.school && (
                      <span className="inline-block px-1.5 py-0.5 rounded-full bg-warning text-white text-[10px] font-bold">
                        済
                      </span>
                    )}
                  </td>
                  {[u.l1, u.l2, u.l3].map((n, j) => (
                    <td
                      key={j}
                      className="p-2 border border-border-subtle text-center tabular-nums"
                    >
                      {n > 0 ? (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-info text-white text-[10px] font-bold">
                          {n}
                        </span>
                      ) : (
                        <span className="text-text-faint">-</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-text-muted mt-1">
          学校進度「済」= 学校で習った単元 ／ 1〜3回目 = 塾で指導した回数
        </p>
      </div>

      {/* 直近の授業記録フィード */}
      <div>
        <h3 className="text-sm font-bold text-text-heading mb-2">直近の授業記録（進行フィード）</h3>
        <ul className="space-y-2">
          {feed.map((f, i) => {
            const d = new Date(f.date + 'T12:00:00');
            return (
              <li key={i} className="rounded-lg border border-border-subtle p-2.5 bg-white">
                <div className="flex items-center gap-2 text-xs mb-1">
                  <span className="font-semibold text-text-body tabular-nums">
                    {f.date.slice(5).replace('-', '/')}（{W[d.getDay()]}）
                  </span>
                  <span className="text-text-muted">{f.teacher} 先生</span>
                </div>
                <div className="text-sm text-text-body">{f.unit}</div>
                <div className="text-xs text-text-muted mt-0.5">
                  <span className="text-info font-semibold">引継ぎ:</span> {f.handover}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
