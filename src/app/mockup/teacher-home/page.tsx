/* eslint-disable @next/next/no-head-element */
// 講師ホーム UI 提案モック — 生徒が画面を覗く可能性を考慮し、勤怠系の個人数字は含めない。
// ルート: /mockup/teacher-home
// 破棄するにはこのフォルダごと削除。

export default function TeacherHomeMockup() {
  return (
    <>
      <style>{css}</style>

      {/* ───── 赤ヘッダー (既存そのまま) ───── */}
      <header className="th-head">
        <div className="th-head-inner">
          <div className="th-brand">NEST</div>
          <nav className="th-nav">
            <a className="on">生徒管理</a>
            <a>申込状況</a>
            <a>出勤簿</a>
            <a>マイトロフィー</a>
          </nav>
          <div className="th-head-right">
            <span className="th-school">デフォルト</span>
            <span className="th-me">
              <b>齋藤一</b>
              <span className="th-role">講師</span>
            </span>
            <button className="th-logout">ログアウト</button>
          </div>
        </div>
        <div className="th-banner">📢 連絡掲示板に未読が 2 件あります</div>
      </header>

      <main className="th-main">
        <div className="th-modebadge">👁 閲覧専用モード</div>

        {/* ① 連絡掲示板 — 最上部に昇格 */}
        <section className="th-card bulletin">
          <div className="th-card-head">
            <h2 className="th-card-title">
              <span className="th-ic">📣</span> 連絡掲示板
              <span className="th-count">未読 2</span>
            </h2>
            <button className="th-link-btn">すべて見る ›</button>
          </div>

          <article className="th-bul unread pinned">
            <div className="th-bul-meta">
              <span className="pin">📌</span>
              <span className="tag tag-imp">重要</span>
              <span className="th-bul-school">デフォルト教室</span>
            </div>
            <h3 className="th-bul-title">PCS の回収について</h3>
            <p className="th-bul-body">回収しろ</p>
            <div className="th-bul-foot">
              <span className="th-bul-date">1/22 · 不明</span>
              <button className="th-bul-read">✓ 見ました</button>
            </div>
          </article>

          <article className="th-bul unread">
            <div className="th-bul-meta">
              <span className="th-bul-school">デフォルト教室</span>
            </div>
            <h3 className="th-bul-title">テスト対策をしてください</h3>
            <p className="th-bul-body">ああああああああああああああああああああああああああああああああ</p>
            <div className="th-bul-foot">
              <span className="th-bul-date">2/2 · 不明</span>
              <button className="th-bul-read">✓ 見ました</button>
            </div>
          </article>
        </section>

        {/* ② 2 カラム: アラート + あなたの歩み */}
        <div className="th-split">
          {/* 左: アラート */}
          <section className="th-card">
            <div className="th-card-head">
              <h2 className="th-card-title">
                <span className="th-ic">⚠</span> アラート
                <span className="th-count">16</span>
              </h2>
            </div>
            <div className="th-alert-groups">
              <AlertGroup
                name="山田 健太"
                grade="小1"
                items={[
                  { type: 'app', label: '申込未提出', text: 'PCS回収 (期日超過 72日: 2/1)' },
                  { type: 'task', label: 'タスク', text: '2/28: 前回の確認 昨日の授業を見学し、テスト結果を踏まえた情報共有が必要と判断された 学校に行けていな…' },
                  { type: 'task', label: 'タスク', text: '3/18: 宿題確認' },
                ]}
              />
              <AlertGroup
                name="髙橋 健太"
                grade="小6"
                items={[{ type: 'goal', label: '目標未設定', text: 'フォレスタ: 1学期中間 (3/28、56日経過)' }]}
              />
              <AlertGroup
                name="鈴木 花子"
                grade="中2"
                items={[{ type: 'goal', label: '目標未設定', text: 'ウイニングフィニッシュ: 1学期期末 (1/31、73日経過)' }]}
              />
              <AlertGroup
                name="佐藤 一郎"
                grade="中3"
                items={[
                  { type: 'interview', label: '面談未更新', text: '81日経過' },
                  { type: 'goal', label: '目標未設定', text: 'フォレスタ: 1学期中間 (2/17、56日経過)' },
                ]}
              />
            </div>
          </section>

          {/* 右: あなたの歩み (バッジを色と演出で) */}
          <section className="th-card">
            <div className="th-card-head">
              <h2 className="th-card-title">
                <span className="th-ic">✦</span> あなたの歩み
              </h2>
              <button className="th-link-btn">マイトロフィー ›</button>
            </div>

            {/* 最近獲得したもの (演出: 淡い光 + 新着ドット) */}
            <div className="th-journey-recent">
              <div className="th-journey-lbl">最近</div>
              <div className="th-badges-row">
                <Badge cat="A" rank="gold" fresh />
                <Badge cat="B" rank="silver" fresh />
                <Badge cat="A" rank="bronze" />
              </div>
            </div>

            {/* 3カテゴリ (名前なし、色だけで表現) */}
            <div className="th-journey-cats">
              <CategoryRing cat="A" filled={7} total={12} />
              <CategoryRing cat="B" filled={4} total={10} />
              <CategoryRing cat="C" filled={2} total={8} />
            </div>
            <p className="th-journey-hint">
              新しいトロフィーが増えました。詳しくは マイトロフィー から。
            </p>
          </section>
        </div>

        {/* ③ 生徒名簿 — 変更なし */}
        <section className="th-card th-roster">
          <div className="th-tabs">
            <a className="on">生徒名簿</a>
            <a>内申集計</a>
            <a>テスト点数集計</a>
            <a>模試結果集計</a>
          </div>

          <div className="th-roster-tools">
            <input className="th-search" placeholder="氏名・フリガナ・コードで検索…" />
            <select className="th-select"><option>全学年</option></select>
          </div>

          <table className="th-tbl">
            <thead>
              <tr>
                <th>氏名</th><th>フリガナ</th><th>学年</th><th>学校名</th><th>通塾日程</th><th>状況</th><th className="right">操作</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((r) => (
                <tr key={r.name}>
                  <td className="bold">{r.name}</td>
                  <td>{r.kana}</td>
                  <td>{r.grade}</td>
                  <td>{r.school}</td>
                  <td className="sched">
                    {r.sched.map((s, i) => (<span key={i} className="sched-seg"><span className="sched-d">{s.d}</span><span className="sched-s">{s.s}</span></span>))}
                    <span className="sched-w">週{r.weeks}回</span>
                  </td>
                  <td><span className="status-pill">在籍中</span></td>
                  <td className="right actions">
                    <button>成績</button>
                    <button>面談</button>
                    <button>進行表</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </>
  );
}

function AlertGroup({ name, grade, items }: { name: string; grade: string; items: { type: string; label: string; text: string }[] }) {
  return (
    <div className="th-alert-group">
      <div className="th-alert-student"><b>{name}</b><span className="th-alert-grade">({grade})</span></div>
      {items.map((it, i) => (
        <div key={i} className={'th-alert-item th-alert-' + it.type}>
          <span className="th-alert-lbl">{it.label}</span>
          <span className="th-alert-text">{it.text}</span>
        </div>
      ))}
    </div>
  );
}

function Badge({ cat, rank, fresh }: { cat: 'A' | 'B' | 'C'; rank: 'gold' | 'silver' | 'bronze' | 'platinum'; fresh?: boolean }) {
  return (
    <span className={`th-bg th-bg-${cat} th-rank-${rank} ${fresh ? 'fresh' : ''}`}>
      {fresh && <span className="th-bg-fresh" aria-label="新着" />}
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
        <path d="M12 3l2.4 5.6L20 9.5l-4.3 3.7L17 19l-5-3-5 3 1.3-5.8L4 9.5l5.6-.9z" fill="currentColor" />
      </svg>
    </span>
  );
}

function CategoryRing({ cat, filled, total }: { cat: 'A' | 'B' | 'C'; filled: number; total: number }) {
  const pct = (filled / total) * 100;
  const circumference = 2 * Math.PI * 22;
  return (
    <div className={`th-ring th-ring-${cat}`}>
      <svg width="60" height="60" viewBox="0 0 60 60">
        <circle cx="30" cy="30" r="22" className="th-ring-track" strokeWidth="5" fill="none" />
        <circle
          cx="30" cy="30" r="22"
          className="th-ring-fg"
          strokeWidth="5"
          fill="none"
          strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
          strokeLinecap="round"
          transform="rotate(-90 30 30)"
        />
        <text x="30" y="34" textAnchor="middle" className="th-ring-n">{filled}<tspan className="th-ring-t">/{total}</tspan></text>
      </svg>
    </div>
  );
}

const roster = [
  { name: '山田 健太', kana: 'ヤマダ ケンタ', grade: '小1', school: '中央小学校', sched: [{d:'月',s:'理科'},{d:'月',s:'算数'},{d:'月',s:'社会'},{d:'火',s:'社会'},{d:'火',s:'理科'}], weeks: 11 },
  { name: '髙橋 健太', kana: 'タカハシ ケンタ', grade: '小6', school: '中央小学校', sched: [{d:'火',s:'算数'},{d:'水',s:'国語'},{d:'水',s:'理/社'},{d:'金',s:'社会'}], weeks: 4 },
  { name: '山田 太郎', kana: 'ヤマダ タロウ', grade: '中1', school: '第一中学校', sched: [{d:'月',s:'数学'}], weeks: 1 },
  { name: '鈴木 花子', kana: 'スズキ ハナコ', grade: '中2', school: '第一中学校', sched: [{d:'火',s:'数学'},{d:'金',s:'理科'}], weeks: 2 },
  { name: '佐藤 一郎', kana: 'サトウ イチロウ', grade: '中3', school: '第二中学校', sched: [{d:'月',s:'英語'},{d:'木',s:'数学'}], weeks: 2 },
];

const css = `
.th-root {
  --bg: oklch(98.5% 0.003 25);
  --surface: oklch(96.5% 0.004 25);
  --surface-2: oklch(93.5% 0.005 25);
  --stroke: oklch(91% 0.006 25);
  --muted: oklch(55% 0.01 25);
  --ink: oklch(22% 0.012 25);
  --ink-2: oklch(38% 0.012 25);
  --primary: oklch(56% 0.19 27);
  --primary-subtle: oklch(95% 0.04 27);
  --amber: oklch(82% 0.13 80);

  /* バッジ3カテゴリ (カテゴリ名は見せず色で表現) */
  --catA: oklch(62% 0.18 35);     /* 朱 */
  --catA-subtle: oklch(95% 0.04 35);
  --catB: oklch(58% 0.14 220);    /* 群青 */
  --catB-subtle: oklch(95% 0.03 220);
  --catC: oklch(60% 0.14 150);    /* 翠 */
  --catC-subtle: oklch(95% 0.03 150);

  /* ランク (色の明度で) */
  --rank-gold: oklch(78% 0.15 85);
  --rank-silver: oklch(76% 0.02 270);
  --rank-bronze: oklch(62% 0.11 50);
  --rank-platinum: oklch(88% 0.04 240);

  font-family: var(--font-zen), 'Zen Kaku Gothic New', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: var(--ink);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
}
.mono { font-family: var(--font-mono), 'JetBrains Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }

/* ── ヘッダー (既存の赤を踏襲) ── */
.th-head { background: #d32f2f; color: white; box-shadow: 0 1px 0 rgba(0,0,0,.05); position: sticky; top: 0; z-index: 10; }
.th-head-inner { max-width: 1280px; margin: 0 auto; display: flex; align-items: center; gap: 24px; padding: 10px 24px; }
.th-brand { font-weight: 800; font-size: 1.25rem; letter-spacing: .04em; }
.th-nav { display: flex; gap: 4px; flex: 1; }
.th-nav a { padding: 6px 14px; border-radius: 999px; font-size: .875rem; color: rgba(255,255,255,.85); cursor: pointer; }
.th-nav a.on { background: white; color: var(--primary); font-weight: 600; }
.th-head-right { display: flex; align-items: center; gap: 12px; font-size: .8125rem; }
.th-school { background: rgba(255,255,255,.15); padding: 4px 10px; border-radius: 6px; }
.th-me { display: inline-flex; align-items: baseline; gap: 6px; }
.th-me b { font-weight: 600; }
.th-role { font-size: .6875rem; opacity: .8; }
.th-logout { background: rgba(255,255,255,.12); color: white; border: 1px solid rgba(255,255,255,.25); padding: 4px 10px; border-radius: 6px; cursor: pointer; font-family: inherit; font-size: .75rem; }
.th-banner { background: var(--amber); color: var(--ink); text-align: center; padding: 6px 12px; font-size: .8125rem; font-weight: 500; }

/* ── メイン ── */
.th-main { max-width: 1280px; margin: 0 auto; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
.th-modebadge { align-self: flex-start; background: color-mix(in oklab, var(--catB) 12%, transparent); color: oklch(40% 0.14 220); padding: 6px 12px; border-radius: 999px; font-size: .8125rem; font-weight: 500; }

.th-card { background: var(--bg); border: 1px solid var(--stroke); border-radius: 12px; padding: 20px 22px; }
.th-card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.th-card-title { font-size: 1rem; font-weight: 600; display: inline-flex; align-items: center; gap: 8px; margin: 0; }
.th-ic { font-size: 1.125rem; }
.th-count { margin-left: 4px; background: var(--primary); color: white; border-radius: 999px; font-size: .6875rem; padding: 1px 8px; font-family: var(--font-mono), monospace; font-weight: 600; }
.th-link-btn { background: transparent; border: none; color: var(--ink-2); font-size: .8125rem; cursor: pointer; font-family: inherit; }
.th-link-btn:hover { color: var(--ink); }

/* ── 連絡掲示板 (最上部強調) ── */
.bulletin { background: linear-gradient(180deg, var(--primary-subtle) 0%, var(--bg) 120px); border-color: color-mix(in oklab, var(--primary) 15%, var(--stroke)); }
.th-bul { border-top: 1px solid var(--stroke); padding: 14px 0; display: grid; gap: 6px; position: relative; }
.th-bul:first-of-type { border-top: none; padding-top: 4px; }
.th-bul.unread::before { content: ''; position: absolute; left: -12px; top: 20px; width: 6px; height: 6px; border-radius: 50%; background: var(--primary); }
.th-bul-meta { display: flex; gap: 8px; align-items: center; font-size: .75rem; color: var(--muted); }
.pin { color: var(--primary); }
.tag { font-size: .6875rem; padding: 2px 8px; border-radius: 4px; font-weight: 500; font-family: var(--font-mono), monospace; }
.tag-imp { background: var(--primary); color: white; }
.th-bul-school { margin-left: auto; color: var(--muted); font-size: .6875rem; }
.th-bul-title { font-size: .9375rem; font-weight: 600; margin: 0; color: var(--ink); }
.th-bul.unread .th-bul-title { font-weight: 700; }
.th-bul-body { margin: 0; color: var(--ink-2); font-size: .8125rem; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; }
.th-bul-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 2px; }
.th-bul-date { font-size: .75rem; color: var(--muted); font-family: var(--font-mono), monospace; }
.th-bul-read { background: var(--surface); border: 1px solid var(--stroke); padding: 4px 10px; border-radius: 6px; font-size: .75rem; cursor: pointer; font-family: inherit; color: var(--ink-2); }
.th-bul-read:hover { background: var(--surface-2); color: var(--ink); }

/* ── 2カラム ── */
.th-split { display: grid; grid-template-columns: 1.5fr 1fr; gap: 16px; align-items: start; }
@media (max-width: 900px) { .th-split { grid-template-columns: 1fr; } }

/* ── アラート ── */
.th-alert-groups { display: flex; flex-direction: column; gap: 14px; }
.th-alert-group { border: 1px solid var(--stroke); border-radius: 10px; padding: 10px 12px; }
.th-alert-student { font-size: .875rem; margin-bottom: 8px; }
.th-alert-grade { color: var(--muted); font-size: .8125rem; margin-left: 6px; }
.th-alert-item { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-radius: 6px; font-size: .8125rem; margin-bottom: 4px; }
.th-alert-item:last-child { margin-bottom: 0; }
.th-alert-lbl { font-size: .6875rem; padding: 2px 8px; border-radius: 4px; font-weight: 500; font-family: var(--font-mono), monospace; flex-shrink: 0; }
.th-alert-text { color: var(--ink-2); line-height: 1.4; }
.th-alert-app .th-alert-lbl { background: var(--primary-subtle); color: var(--primary); }
.th-alert-app { background: color-mix(in oklab, var(--primary) 5%, transparent); }
.th-alert-task .th-alert-lbl { background: var(--catB-subtle); color: oklch(40% 0.14 220); }
.th-alert-task { background: color-mix(in oklab, var(--catB) 4%, transparent); }
.th-alert-goal .th-alert-lbl { background: var(--primary-subtle); color: var(--primary); }
.th-alert-goal { background: color-mix(in oklab, var(--primary) 4%, transparent); }
.th-alert-interview .th-alert-lbl { background: oklch(95% 0.05 80); color: oklch(42% 0.15 60); }
.th-alert-interview { background: color-mix(in oklab, var(--amber) 8%, transparent); }

/* ── あなたの歩み (バッジ) ── */
.th-journey-recent { display: flex; align-items: center; gap: 14px; padding: 14px; background: linear-gradient(135deg, color-mix(in oklab, var(--amber) 8%, transparent), transparent); border-radius: 10px; margin-bottom: 14px; position: relative; overflow: hidden; }
.th-journey-recent::before { content: ''; position: absolute; top: -30px; right: -30px; width: 120px; height: 120px; border-radius: 50%; background: radial-gradient(circle, color-mix(in oklab, var(--amber) 18%, transparent) 0%, transparent 70%); pointer-events: none; }
.th-journey-lbl { font-size: .6875rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); font-family: var(--font-mono), monospace; }
.th-badges-row { display: flex; gap: 10px; }
.th-bg { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; position: relative; box-shadow: inset 0 0 0 2px rgba(255,255,255,.4); }
.th-bg-A { background: linear-gradient(135deg, var(--catA) 0%, oklch(70% 0.15 35) 100%); color: white; }
.th-bg-B { background: linear-gradient(135deg, var(--catB) 0%, oklch(66% 0.12 220) 100%); color: white; }
.th-bg-C { background: linear-gradient(135deg, var(--catC) 0%, oklch(68% 0.12 150) 100%); color: white; }
.th-rank-gold { outline: 2px solid var(--rank-gold); outline-offset: 2px; }
.th-rank-silver { outline: 2px solid var(--rank-silver); outline-offset: 2px; }
.th-rank-bronze { outline: 2px solid var(--rank-bronze); outline-offset: 2px; }
.th-rank-platinum { outline: 2px solid var(--rank-platinum); outline-offset: 2px; }
.fresh { animation: th-fresh 2.4s ease-out infinite; }
@keyframes th-fresh { 0%, 100% { box-shadow: inset 0 0 0 2px rgba(255,255,255,.4), 0 0 0 0 color-mix(in oklab, var(--amber) 40%, transparent); } 50% { box-shadow: inset 0 0 0 2px rgba(255,255,255,.4), 0 0 0 6px color-mix(in oklab, var(--amber) 0%, transparent); } }
.th-bg-fresh { position: absolute; top: -3px; right: -3px; width: 10px; height: 10px; border-radius: 50%; background: var(--primary); border: 2px solid var(--bg); }

.th-journey-cats { display: flex; justify-content: space-around; padding: 8px 0 4px; }
.th-ring { display: flex; flex-direction: column; align-items: center; }
.th-ring-track { stroke: var(--surface-2); }
.th-ring-A .th-ring-fg { stroke: var(--catA); }
.th-ring-B .th-ring-fg { stroke: var(--catB); }
.th-ring-C .th-ring-fg { stroke: var(--catC); }
.th-ring-n { font-size: 14px; font-weight: 600; fill: var(--ink); font-family: var(--font-mono), monospace; }
.th-ring-t { font-size: 9px; fill: var(--muted); }
.th-journey-hint { margin: 14px 0 0; font-size: .75rem; color: var(--muted); text-align: center; line-height: 1.5; }

/* ── 名簿 ── */
.th-roster { padding: 0; overflow: hidden; }
.th-tabs { display: flex; gap: 0; padding: 0 22px; border-bottom: 1px solid var(--stroke); }
.th-tabs a { padding: 14px 16px; font-size: .875rem; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.th-tabs a.on { color: var(--ink); font-weight: 600; border-bottom-color: var(--ink); }
.th-roster-tools { display: flex; gap: 10px; padding: 14px 22px; align-items: center; }
.th-search { flex: 1; max-width: 340px; padding: 8px 12px 8px 32px; border: 1px solid var(--stroke); border-radius: 8px; background: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2'><circle cx='11' cy='11' r='7'/><line x1='21' y1='21' x2='16.65' y2='16.65'/></svg>") no-repeat 10px center var(--bg); font-family: inherit; font-size: .875rem; }
.th-select { padding: 8px 10px; border: 1px solid var(--stroke); border-radius: 8px; background: var(--bg); font-family: inherit; font-size: .875rem; }

.th-tbl { width: 100%; border-collapse: collapse; font-size: .875rem; }
.th-tbl th { text-align: left; font-weight: 500; color: var(--muted); padding: 10px 22px; background: var(--surface); border-top: 1px solid var(--stroke); border-bottom: 1px solid var(--stroke); font-size: .75rem; letter-spacing: .04em; }
.th-tbl th.right { text-align: right; }
.th-tbl td { padding: 14px 22px; border-bottom: 1px solid var(--stroke); vertical-align: middle; }
.th-tbl td.right { text-align: right; }
.th-tbl td.bold { font-weight: 600; }
.th-tbl tr:hover td { background: var(--surface); }
.sched { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; }
.sched-seg { display: inline-flex; gap: 2px; font-size: .8125rem; }
.sched-d { color: var(--primary); font-weight: 500; }
.sched-s { color: var(--ink-2); }
.sched-w { margin-left: 6px; font-size: .75rem; color: var(--muted); background: var(--surface); padding: 1px 8px; border-radius: 4px; }
.status-pill { background: var(--catB-subtle); color: oklch(40% 0.14 220); padding: 3px 10px; border-radius: 999px; font-size: .75rem; font-weight: 500; }
.actions { display: flex; gap: 4px; justify-content: flex-end; }
.actions button { background: transparent; border: 1px solid var(--stroke); color: var(--ink-2); padding: 4px 10px; border-radius: 6px; font-size: .75rem; cursor: pointer; font-family: inherit; }
.actions button:hover { background: var(--surface); color: var(--ink); }
`;
