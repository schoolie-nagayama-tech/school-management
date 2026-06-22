/**
 * 外部システム自動入力の「宣言的 actions」共通土台。
 *
 * NEST は対象サイトに依存しない actions のリストを生成し、/api/automation/queue に保存する。
 * 対象サイト上のローダー・ブックマークレットが /api/automation/pull で取得し、
 * 「name属性で要素を探して set / check する」だけの汎用処理で充填する。
 *
 * この actions 形式は将来ブラウザ拡張(content script)へ移行する際もそのまま再利用できる。
 * サーバー(queueルートの検証)・クライアント(各ダイアログのpayload生成)両方から import される。
 */

/** 1アクション: フォーム要素1つに対する操作。 */
export type AutomationAction =
  | { type: 'set'; name: string; value: string } // テキスト/セレクト等に値を入れる
  | { type: 'check'; name: string } // チェックボックスをON
  | { type: 'uncheck'; name: string }; // チェックボックスをOFF

/** 流し込み1件分のペイロード。 */
export interface AutomationPayload {
  /** 表示用ラベル（例「浅井遼介 / 2026夏期講習」）。ローダーのalertに出す。 */
  label?: string;
  actions: AutomationAction[];
}

/** actions の最大件数（暴走・肥大防止）。スクールIE夏期=78、取次=多くても百数十程度。 */
export const MAX_ACTIONS = 2000;

/** queue ルートでの検証に使う型ガード。untrusted な入力を弾く。 */
export function isValidAutomationPayload(x: unknown): x is AutomationPayload {
  if (!x || typeof x !== 'object') return false;
  const p = x as Record<string, unknown>;
  if (p.label != null && typeof p.label !== 'string') return false;
  if (!Array.isArray(p.actions)) return false;
  if (p.actions.length === 0 || p.actions.length > MAX_ACTIONS) return false;
  return p.actions.every((a) => {
    if (!a || typeof a !== 'object') return false;
    const act = a as Record<string, unknown>;
    if (typeof act.name !== 'string' || !act.name) return false;
    if (act.type === 'check' || act.type === 'uncheck') return true;
    if (act.type === 'set') return typeof act.value === 'string';
    return false;
  });
}

// ============================================================
// 各機能の actions 生成ヘルパー
// ============================================================

/** チェックボックス name 群 → check アクション（スクールIE座席表など）。 */
export function buildCheckActions(names: string[]): AutomationAction[] {
  return names.map((name) => ({ type: 'check', name }));
}

/** name→value のマップ → set アクション（取次フォームの顧客情報・明細など）。空値はスキップ。 */
export function buildSetActions(fields: Record<string, string | null | undefined>): AutomationAction[] {
  const actions: AutomationAction[] = [];
  for (const [name, value] of Object.entries(fields)) {
    if (value == null || value === '') continue;
    actions.push({ type: 'set', name, value });
  }
  return actions;
}

// ============================================================
// ローダー・ブックマークレット生成
// ============================================================

/**
 * 対象サイトで実行する静的ローダー・ブックマークレット（トークン埋め込み・1回だけ導入）。
 * NESTの /api/automation/pull?token=... を fetch して actions を取得・実行する。
 * 取得後 NEST 側で保留ジョブはクリアされる。登録/送信・reCAPTCHAは人間が行う。
 *
 * @param origin NESTのオリジン（window.location.origin）
 * @param token  発行済みトークン
 */
export function buildLoaderBookmarklet(origin: string, token: string): string {
  const url = `${origin}/api/automation/pull?token=${encodeURIComponent(token)}`;
  // 改行・コメントを含めず1行の javascript: URL にすること。
  const code = `(async()=>{try{const r=await fetch(${JSON.stringify(url)},{cache:'no-store'});if(!r.ok){alert('NEST: データ取得に失敗しました ('+r.status+')');return;}const d=await r.json();const p=d&&d.payload;if(!p||!p.actions||!p.actions.length){alert('NEST: 流し込むデータがありません。先にNESTで「流し込む」を押してください。');return;}const docs=[document];for(let i=0;i<window.frames.length;i++){try{if(window.frames[i].document)docs.push(window.frames[i].document);}catch(e){}}const find=function(n){for(var j=0;j<docs.length;j++){var e=docs[j].getElementsByName(n)[0];if(e)return e;}return null;};let ok=0,miss=0;p.actions.forEach(function(a){var el=find(a.name);if(!el){miss++;return;}if(a.type==='check'||a.type==='uncheck'){var w=a.type==='check';if(el.checked!==w){el.checked=w;el.dispatchEvent(new Event('change',{bubbles:true}));}ok++;}else if(a.type==='set'){el.value=(a.value==null?'':a.value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));ok++;}});alert('NEST: '+(p.label||'')+'\\n'+ok+'件を入力しました'+(miss?'（'+miss+'件は該当要素が見つからず）':'')+'。\\n内容を確認して登録/送信してください。');}catch(e){alert('NEST入力失敗: '+((e&&e.message)||e));}})();`;
  return `javascript:${code}`;
}
