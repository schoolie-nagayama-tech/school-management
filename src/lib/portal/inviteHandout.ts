/**
 * 保護者ポータルの招待を紙で配るための配布シート（A4縦1枚）を組み立てる。
 *
 * ★ アプリ内で window.print() せず、別ウィンドウに完結したHTMLを書き出す理由:
 *   招待セクションは生徒詳細モーダルの中にある。アプリ側で印刷すると、
 *   モーダルの外側（ヘッダー・一覧・他のパネル）まで用紙に乗るため、
 *   それを @media print で1つずつ消して回ることになる。対象が増えるたびに
 *   崩れる作りになるので、印刷用の紙面だけを持つ独立したページを開く。
 *
 * ★ 有効期限を必ず紙面に出すこと:
 *   受諾URLは7日で切れる。期限が書いていない紙を渡すと、保護者が後日開いて
 *   「開けない」と問い合わせる。紙の側に期限を印字して防ぐ。
 */

export interface InviteHandoutInput {
  /** 生徒名（誰に渡す紙かの識別） */
  studentName: string;
  /** 受諾URL（QRと同じ内容。QRが読めない端末のために文字でも載せる） */
  url: string;
  /** QRコードの PNG data URL */
  qrDataUrl: string;
  /** 有効期限。'YYYY/M/D' などの表示済み文字列 */
  expiresLabel: string;
  /** 教室名。空なら見出しに出さない */
  schoolName?: string;
  /** 招待の種別。保護者向けか本人向けかで宛名と本文が変わる */
  inviteType: 'guardian' | 'student';
}

/** HTMLに素で差し込む値をエスケープする（生徒名・教室名は自由入力のため必須）。 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 配布シートの完結したHTMLを返す。
 * 外部ファイルを読まない（CSSも画像もインライン）ので、別ウィンドウに書き出すだけで印刷できる。
 */
export function buildInviteHandoutHtml(input: InviteHandoutInput): string {
  const forGuardian = input.inviteType === 'guardian';
  const audience = forGuardian ? '保護者の皆さまへ' : '生徒本人へ';
  const student = escapeHtml(input.studentName);
  const school = input.schoolName ? escapeHtml(input.schoolName) : '';
  const url = escapeHtml(input.url);
  const expires = escapeHtml(input.expiresLabel);

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>マイページのご案内 - ${student}</title>
<style>
  @page { size: A4 portrait; margin: 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif;
    color: #1a1a1a;
    line-height: 1.8;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet { max-width: 640px; margin: 0 auto; padding: 24px 8px; }
  .school { font-size: 12px; color: #555; }
  h1 { font-size: 22px; margin: 4px 0 2px; letter-spacing: .02em; }
  .audience { font-size: 13px; color: #555; margin-bottom: 18px; }
  .to { border: 1px solid #ccc; border-radius: 6px; padding: 10px 14px; margin-bottom: 20px; font-size: 14px; }
  .to b { font-size: 17px; }
  .lead { font-size: 13.5px; margin-bottom: 18px; }
  .qr-area { display: flex; gap: 20px; align-items: center; border: 2px solid #1e3a5f; border-radius: 8px; padding: 16px 18px; }
  .qr-area img { width: 168px; height: 168px; display: block; }
  .qr-side { flex: 1; min-width: 0; }
  .qr-side .label { font-size: 12px; font-weight: 700; color: #1e3a5f; margin-bottom: 4px; }
  .url { font-size: 10.5px; word-break: break-all; background: #f4f6f8; border: 1px solid #dde3ea; border-radius: 4px; padding: 8px 10px; font-family: ui-monospace, Menlo, Consolas, monospace; }
  .expire { margin-top: 10px; font-size: 12.5px; font-weight: 700; color: #b03a2e; }
  h2 { font-size: 14px; margin: 22px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #ddd; }
  ol { margin: 0; padding-left: 1.3em; font-size: 13px; }
  ol li { margin-bottom: 5px; }
  .note { margin-top: 16px; font-size: 11.5px; color: #555; border-top: 1px dashed #ccc; padding-top: 10px; }
  .foot { margin-top: 18px; font-size: 11px; color: #777; text-align: right; }
</style>
</head>
<body>
  <div class="sheet">
    ${school ? `<div class="school">${school}</div>` : ''}
    <h1>マイページのご案内</h1>
    <div class="audience">${audience}</div>

    <div class="to"><b>${student}</b> さん${forGuardian ? ' の保護者さま' : ''}</div>

    <p class="lead">
      授業の報告・時間割・欠席のご連絡などをスマートフォンから確認・送信いただけるマイページをご用意しました。
      下のQRコードを読み取って、登録をお願いします。
    </p>

    <div class="qr-area">
      <img src="${input.qrDataUrl}" alt="登録用QRコード">
      <div class="qr-side">
        <div class="label">QRコードが読み取れない場合は、次のURLを直接ご入力ください</div>
        <div class="url">${url}</div>
        <div class="expire">有効期限: ${expires} まで</div>
      </div>
    </div>

    <h2>登録の手順</h2>
    <ol>
      <li>QRコードを読み取る（またはURLを開く）</li>
      <li>「LINEではじめる」を選ぶと、LINEでお知らせを受け取れます</li>
      <li>LINEを使わない場合は、メールアドレスとパスワードでご登録ください</li>
      <li>続柄（保護者／その他）を選び、登録を完了してください</li>
    </ol>

    <div class="note">
      このQRコード・URLは ${student} さん専用です。他の方には共有しないでください。<br>
      有効期限が切れた場合は、教室までお知らせください。新しいご案内をお渡しします。
    </div>

    <div class="foot">${school ? school + '　' : ''}お問い合わせは教室までお願いします</div>
  </div>
</body>
</html>`;
}
