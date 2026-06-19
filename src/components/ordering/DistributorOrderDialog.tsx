'use client';

import { useEffect, useMemo, useState } from 'react';
import { Truck, X, Copy, Check, ExternalLink, Loader2, ChevronDown, ChevronRight, Bookmark } from 'lucide-react';
import { buildDistributorOrderRows, type DistributorOrderRow } from '@/lib/api/ordering';
import type { MaterialOrderWithDetails } from '@/types/database';

/**
 * 取次サイト（日本教材出版 https://www.nihonkyouzai.jp/order）への発注支援ダイアログ。
 *
 * 取次フォームは reCAPTCHA ＋ Concrete5 の CSRF トークン付きのため、サーバーからの直接 POST は不可。
 * そのため「ブラウザ上で動くブックマークレットがフォームを自動入力 → reCAPTCHA 通過と送信だけ人間が行う」
 * という構成を採る。本ダイアログの役割は:
 *   1. 未確認の発注を取次フォームの6列（版元・教材名・教科・準拠・学年・部数）に集約・編集する
 *   2. 顧客情報（NESTに無い住所/TEL等）を一度だけ入力し localStorage に保存する
 *   3. それらを1つの JSON にまとめてクリップボードへコピーする
 * ブックマークレット（静的・1回だけ導入）がそのクリップボードを読んでフォームに流し込む。
 */

const ORDER_URL = 'https://www.nihonkyouzai.jp/order';
const MAX_ROWS = 19; // 取次フォームの注文行は最大19行
const CUSTOMER_STORAGE_KEY = 'nest:distributorCustomer';

/** 取次フォームの都道府県 select の選択肢（value=表示名）。 */
const PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
  '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
  '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
  '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];

/** 顧客情報（取次フォームの宛先欄）。NESTに無い項目が多いので一度入力したら localStorage に保存して再利用する。 */
interface CustomerInfo {
  form_name: string; // 担当者名
  form_syozoku: string; // 塾名・教室名
  form_zip: string; // 郵便番号
  form_prefectures: string; // 都道府県
  form_city: string; // 市町村
  form_building: string; // マンション名等
  form_tel: string; // TEL
  form_fax: string; // FAX
  form_email: string; // メールアドレス
  form_message: string; // 備考
}

const EMPTY_CUSTOMER: CustomerInfo = {
  form_name: '', form_syozoku: '', form_zip: '', form_prefectures: '', form_city: '',
  form_building: '', form_tel: '', form_fax: '', form_email: '', form_message: '',
};

/**
 * 取次ページで実行する自動入力ブックマークレット（静的・1回だけブックマークバーに登録する）。
 * クリップボードの JSON（NEST が「発注データをコピー」で書き込む）を読み、name 属性でフォームを埋める。
 * プレーンなHTMLフォームのため value 代入＋input/changeイベント発火で十分。reCAPTCHA と送信は触らない。
 */
const BOOKMARKLET = `javascript:(async()=>{try{const t=await navigator.clipboard.readText();const d=JSON.parse(t);if(!d||!d._nest_order){alert('NESTの発注データがクリップボードにありません。先にNESTで「発注データをコピー」を押してください。');return;}const set=(n,v)=>{const e=document.getElementsByName(n)[0];if(!e||v==null||v==='')return;e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};const c=d.customer||{};for(const k in c)set(k,c[k]);(d.rows||[]).slice(0,19).forEach((r,i)=>{const n=i+1;set('form_hanmoto'+n,r.hanmoto);set('form_kyuozaimei'+n,r.kyuozaimei);set('form_kyouka'+n,r.kyouka);set('form_junkyo'+n,r.junkyo);set('form_gakunen'+n,r.gakunen);set('form_busuu'+n,r.busuu);});alert('NEST: '+Math.min((d.rows||[]).length,19)+'件を入力しました。reCAPTCHAにチェックして送信してください。');}catch(e){alert('NEST入力失敗: '+((e&&e.message)||e)+'\\nブラウザにクリップボードの読み取りを許可してください。');}})();`;

const CUSTOMER_FIELDS: { key: keyof CustomerInfo; label: string; required?: boolean; type?: string }[] = [
  { key: 'form_name', label: '担当者名', required: true },
  { key: 'form_syozoku', label: '塾名・教室名', required: true },
  { key: 'form_zip', label: '郵便番号', required: true },
  { key: 'form_city', label: '市町村（例: 千葉市中央区○-○-○）', required: true },
  { key: 'form_building', label: 'マンション名等' },
  { key: 'form_tel', label: 'TEL', required: true, type: 'tel' },
  { key: 'form_fax', label: 'FAX', type: 'tel' },
  { key: 'form_email', label: 'メールアドレス', required: true, type: 'email' },
];

export function DistributorOrderDialog({
  orders,
  defaultSchoolName,
  defaultEmail,
  onClose,
}: {
  orders: MaterialOrderWithDetails[];
  defaultSchoolName?: string;
  defaultEmail?: string | null;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<DistributorOrderRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [customer, setCustomer] = useState<CustomerInfo>(EMPTY_CUSTOMER);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [bookmarkletCopied, setBookmarkletCopied] = useState(false);

  // 未確認の発注 → 取次行に集約（教材ごとに部数合算）
  useEffect(() => {
    let cancelled = false;
    setLoadingRows(true);
    buildDistributorOrderRows(orders)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((e) => { console.error('取次行の生成に失敗:', e); if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoadingRows(false); });
    return () => { cancelled = true; };
  }, [orders]);

  // 顧客情報: localStorage を優先、無ければ選択中の校舎名/メールで初期化
  useEffect(() => {
    let saved: Partial<CustomerInfo> = {};
    try {
      const raw = localStorage.getItem(CUSTOMER_STORAGE_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch { /* 破損時は無視 */ }
    const next: CustomerInfo = { ...EMPTY_CUSTOMER, ...saved };
    if (!next.form_syozoku && defaultSchoolName) next.form_syozoku = defaultSchoolName;
    if (!next.form_email && defaultEmail) next.form_email = defaultEmail;
    setCustomer(next);
    // 必須項目が埋まっていなければ顧客情報セクションを開いて入力を促す
    const incomplete = !next.form_name || !next.form_zip || !next.form_prefectures || !next.form_city || !next.form_tel || !next.form_email;
    setCustomerOpen(incomplete);
  }, [defaultSchoolName, defaultEmail]);

  const updateCustomer = (key: keyof CustomerInfo, value: string) => {
    setCustomer((prev) => {
      const next = { ...prev, [key]: value };
      try { localStorage.setItem(CUSTOMER_STORAGE_KEY, JSON.stringify(next)); } catch { /* 容量超過等は無視 */ }
      return next;
    });
    setCopied(false);
  };

  const updateRow = (i: number, key: keyof DistributorOrderRow, value: string) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
    setCopied(false);
  };

  const overflow = rows.length > MAX_ROWS;
  const sentRows = useMemo(() => rows.slice(0, MAX_ROWS), [rows]);

  const handleCopy = async () => {
    const payload = { _nest_order: true, customer, rows: sentRows };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload));
      setCopied(true);
    } catch (e) {
      console.error('コピーに失敗:', e);
      alert('クリップボードへのコピーに失敗しました。ブラウザの権限を確認してください。');
    }
  };

  const handleCopyBookmarklet = async () => {
    try {
      await navigator.clipboard.writeText(BOOKMARKLET);
      setBookmarkletCopied(true);
      setTimeout(() => setBookmarkletCopied(false), 2000);
    } catch (e) {
      console.error('コピーに失敗:', e);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-surface-raised rounded-2xl shadow-xl border border-border-default overflow-hidden animate-[popover-enter_150ms_cubic-bezier(0.23,1,0.32,1)]">
        {/* ヘッダー */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
          <Truck className="w-4 h-4 text-info" />
          <h2 className="text-sm font-bold text-text-heading">取次サイトへ発注（日本教材出版）</h2>
          <button
            onClick={onClose}
            className="ml-auto p-1 text-text-faint hover:text-text-body rounded hover:bg-surface-hover transition-colors"
            aria-label="閉じる"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 max-h-[64vh] overflow-y-auto space-y-4">
          {/* 注文明細 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[11px] font-bold text-text-muted">
                注文明細（未確認の発注を教材ごとに合算）
              </div>
              <div className="text-[11px] text-text-faint">{sentRows.length}件</div>
            </div>

            {loadingRows ? (
              <div className="flex items-center gap-2 text-sm text-text-muted py-6 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> 明細を集計中…
              </div>
            ) : rows.length === 0 ? (
              <div className="text-sm text-text-muted py-4 text-center">未確認の発注がありません。</div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border-subtle">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface-sunken text-text-muted">
                      <th className="text-left font-medium px-2 py-1.5">版元</th>
                      <th className="text-left font-medium px-2 py-1.5">教材名</th>
                      <th className="text-left font-medium px-2 py-1.5">教科</th>
                      <th className="text-left font-medium px-2 py-1.5">準拠</th>
                      <th className="text-left font-medium px-2 py-1.5">学年</th>
                      <th className="text-left font-medium px-2 py-1.5 w-14">部数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sentRows.map((r, i) => (
                      <tr key={i} className="border-t border-border-subtle">
                        <RowCell value={r.hanmoto} onChange={(v) => updateRow(i, 'hanmoto', v)} placeholder="（任意）" />
                        <RowCell value={r.kyuozaimei} onChange={(v) => updateRow(i, 'kyuozaimei', v)} />
                        <RowCell value={r.kyouka} onChange={(v) => updateRow(i, 'kyouka', v)} />
                        <RowCell value={r.junkyo} onChange={(v) => updateRow(i, 'junkyo', v)} />
                        <RowCell value={r.gakunen} onChange={(v) => updateRow(i, 'gakunen', v)} />
                        <RowCell value={r.busuu} onChange={(v) => updateRow(i, 'busuu', v)} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {overflow && (
              <p className="text-[11px] text-danger mt-1">
                取次フォームは最大{MAX_ROWS}行です。{rows.length - MAX_ROWS}件は今回送信されません（残りは再度この操作で発注してください）。
              </p>
            )}
            <p className="text-[11px] text-text-faint mt-1">
              「準拠」は教科書準拠先（東京書籍等）を自動で入れています。「版元」はNESTに項目が無いため空です（教材名で判別できる場合が多い）。必要なら各行に直接入力してください。
            </p>
            <p className="text-[11px] text-text-faint mt-0.5">
              ※ フォレスタは別の発注先のため、この注文には含まれません。
            </p>
          </div>

          {/* 顧客情報 */}
          <div className="rounded-lg border border-border-subtle">
            <button
              onClick={() => setCustomerOpen((v) => !v)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover transition-colors rounded-lg"
            >
              {customerOpen ? <ChevronDown className="w-4 h-4 text-text-faint" /> : <ChevronRight className="w-4 h-4 text-text-faint" />}
              <span className="text-[11px] font-bold text-text-muted">送り先・担当者情報（初回のみ入力、以後この端末に保存）</span>
            </button>
            {customerOpen && (
              <div className="px-3 pb-3 grid grid-cols-2 gap-2">
                {CUSTOMER_FIELDS.slice(0, 2).map((f) => (
                  <Field key={f.key} field={f} value={customer[f.key]} onChange={(v) => updateCustomer(f.key, v)} className="col-span-2" />
                ))}
                <Field field={CUSTOMER_FIELDS[2]} value={customer.form_zip} onChange={(v) => updateCustomer('form_zip', v)} />
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-text-muted">都道府県<span className="text-danger">*</span></span>
                  <select
                    value={customer.form_prefectures}
                    onChange={(e) => updateCustomer('form_prefectures', e.target.value)}
                    className="text-xs border border-border-default rounded-md px-2 py-1.5 bg-surface-raised focus:ring-1 focus:ring-info/30"
                  >
                    <option value="">選択してください</option>
                    {PREFECTURES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                {CUSTOMER_FIELDS.slice(3).map((f) => (
                  <Field key={f.key} field={f} value={customer[f.key]} onChange={(v) => updateCustomer(f.key, v)} className={f.key === 'form_city' || f.key === 'form_building' ? 'col-span-2' : ''} />
                ))}
                <label className="flex flex-col gap-0.5 col-span-2">
                  <span className="text-[10px] text-text-muted">備考（希望納期など）</span>
                  <input
                    type="text"
                    value={customer.form_message}
                    onChange={(e) => updateCustomer('form_message', e.target.value)}
                    className="text-xs border border-border-default rounded-md px-2 py-1.5 bg-surface-raised focus:ring-1 focus:ring-info/30"
                  />
                </label>
              </div>
            )}
          </div>

          {/* ブックマークレット導入（初回のみ） */}
          <details className="rounded-lg border border-border-subtle">
            <summary className="px-3 py-2 text-[11px] font-bold text-text-muted cursor-pointer hover:bg-surface-hover rounded-lg">
              初回設定: 自動入力ブックマークレットを導入する
            </summary>
            <div className="px-3 pb-3 space-y-2 text-[11px] text-text-body">
              <ol className="list-decimal list-inside space-y-1 text-text-muted">
                <li>下のリンクをブラウザのブックマークバーに<strong>ドラッグ&amp;ドロップ</strong>して登録</li>
                <li>以後は取次ページで そのブックマークをクリックするだけで自動入力されます</li>
              </ol>
              {/* ドラッグ登録用リンク（問合せ管理のブックマークレットと同方式）。
                  javascript: URL のため通常クリックは preventDefault で無効化し、ドラッグ登録専用にする。 */}
              {/* eslint-disable-next-line react/jsx-no-target-blank */}
              <a
                href={BOOKMARKLET}
                onClick={(e) => e.preventDefault()}
                draggable
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-info text-white text-[11px] font-medium rounded-md cursor-grab active:cursor-grabbing select-none hover:brightness-95 transition-[filter] duration-150"
              >
                <Bookmark className="w-3.5 h-3.5" />
                取次に流し込む
              </a>
              <p className="text-[10px] text-text-faint">
                ※ このリンクはクリックしても動きません。ブックマークバーにドラッグして登録してください。
              </p>
              <div className="pt-1">
                <button
                  onClick={handleCopyBookmarklet}
                  className="inline-flex items-center gap-1.5 text-[10px] text-text-muted hover:text-text-body transition-colors"
                >
                  {bookmarkletCopied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                  {bookmarkletCopied ? 'コピーしました' : 'または、コードをコピーして手動登録'}
                </button>
              </div>
            </div>
          </details>
        </div>

        {/* フッター: 手順 + アクション */}
        <div className="px-4 py-3 border-t border-border-subtle space-y-2">
          <p className="text-[11px] text-text-faint">
            ①「発注データをコピー」→ ②「発注ページを開く」→ ③ 導入済みブックマークをクリックで自動入力 → ④ reCAPTCHA通過・送信は手動
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text-body rounded-lg hover:bg-surface-hover transition-colors"
            >
              閉じる
            </button>
            <div className="flex-1" />
            <button
              onClick={handleCopy}
              disabled={loadingRows || rows.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold border border-border-default rounded-lg hover:bg-surface-hover transition-colors disabled:opacity-50"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'コピー済み' : '発注データをコピー'}
            </button>
            <a
              href={ORDER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold bg-info text-white rounded-lg hover:brightness-95 active:scale-[0.97] transition-[filter,transform] duration-150"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              発注ページを開く
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 明細テーブルのセル（インライン編集）。 */
function RowCell({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <td className="px-1 py-1">
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-xs border border-transparent hover:border-border-subtle focus:border-info/40 rounded px-1.5 py-1 bg-transparent focus:bg-surface-raised focus:ring-1 focus:ring-info/20 outline-none"
      />
    </td>
  );
}

/** 顧客情報の1項目。 */
function Field({
  field,
  value,
  onChange,
  className,
}: {
  field: { key: keyof CustomerInfo; label: string; required?: boolean; type?: string };
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-0.5 ${className ?? ''}`}>
      <span className="text-[10px] text-text-muted">
        {field.label}
        {field.required && <span className="text-danger">*</span>}
      </span>
      <input
        type={field.type ?? 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-xs border border-border-default rounded-md px-2 py-1.5 bg-surface-raised focus:ring-1 focus:ring-info/30"
      />
    </label>
  );
}
