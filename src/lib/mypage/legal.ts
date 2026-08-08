import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { getPortalServiceClient } from './serviceClient';

/**
 * 法務文書（プライバシーポリシー・利用規約）の現在版と、同意ログの読み書き。
 *
 * 文面の実体は docs/legal/*.md（PR #50 で作成）。DBに文面を持たず
 * リポジトリのマークダウンを唯一の正典にしているのは、改定履歴が git に残り
 * 「いつ何を変えたか」を後から追えるようにするため。
 */

/** 同意ログに記録する文書キー。マイグレーションの check 制約と一致させること。 */
export type LegalDocumentKey = 'privacy_policy' | 'terms_of_service';

/**
 * 各文書の現在版と表示情報。
 *
 * ★ version を上げると、その文書に「新しい版での同意」が無い全アカウントが
 *   hasCurrentConsent() で false になり、次回マイページを開いたときに
 *   /mypage/consent へ誘導されて再同意を求められる。
 *   つまりここの1文字の変更が全保護者への再同意要求になる。文言の誤字修正など
 *   実質的な変更でないときは版を据え置くこと（利用規約 第13条・プライバシー
 *   ポリシー 第13条の「重要な影響のある変更のときに再同意」に合わせる）。
 *
 * version は docs/legal/*.md 末尾の「版番号」と一致させること。
 */
export const LEGAL_DOCUMENTS = {
  privacy_policy: {
    version: 'v1.0',
    title: 'プライバシーポリシー',
    href: '/privacy',
    file: 'privacy-policy.md',
  },
  terms_of_service: {
    version: 'v1.0',
    title: '利用規約',
    href: '/terms',
    file: 'terms-of-service.md',
  },
} as const satisfies Record<
  LegalDocumentKey,
  { version: string; title: string; href: string; file: string }
>;

/** 同意が必要な文書キーの一覧（両方そろって初めて「同意済み」）。 */
export const LEGAL_DOCUMENT_KEYS = Object.keys(LEGAL_DOCUMENTS) as LegalDocumentKey[];

/**
 * 付録セクションの見出し。ここ以降を切り落とす目印。
 * docs/legal/*.md の該当行は `## 付録：公開前に確定が必要な項目一覧`。
 */
const APPENDIX_HEADING_PREFIX = '## 付録';

/**
 * docs/legal/*.md を読み、公開用の本文を返す。
 *
 * ★ 「## 付録」以降を必ず削除する理由:
 *   あの節は「運営会社名を記入したか」「Sentry は有効か」といった**社内向けの
 *   公開前チェックリスト**であって、規約の一部ではない。マークダウン末尾に
 *   「このセクションは公開時に削除してください」と書かれているとおり、保護者に
 *   見せてはいけない。ファイル側の削除忘れに依存せず、描画側で機械的に落とす。
 *
 * ファイル読み込みは呼び出し元のページを force-static にしてビルド時に解決する
 * （Vercel の実行時ファイルシステムに依存させない）。
 */
export function loadLegalMarkdown(key: LegalDocumentKey): string {
  const filePath = path.join(process.cwd(), 'docs', 'legal', LEGAL_DOCUMENTS[key].file);
  const raw = fs.readFileSync(filePath, 'utf8');

  const lines = raw.split('\n');
  const appendixIndex = lines.findIndex((line) => line.startsWith(APPENDIX_HEADING_PREFIX));
  const body = appendixIndex === -1 ? lines : lines.slice(0, appendixIndex);

  // 付録の直前に区切り線（---）が残ると本文の末尾が間延びするので落とす。
  while (body.length > 0) {
    const last = body[body.length - 1].trim();
    if (last === '' || last === '---') {
      body.pop();
      continue;
    }
    break;
  }

  return body.join('\n').trimEnd() + '\n';
}

/**
 * 現在版への同意を記録する（両文書ぶん2行）。service role で書く。
 *
 * 同じ版に何度同意しても行を積む（履歴を消さない）。判定は「最新版の行が
 * 1つでもあるか」なので重複行があっても正しく動く。
 *
 * @throws insert に失敗したら Error を投げる。呼び出し元は握りつぶさないこと
 *   （同意ログは「同意を取った」ことの唯一の証跡なので、記録できないまま
 *    受諾を成功扱いにすると証跡なしの利用者が生まれる）。
 */
export async function recordConsent(accountId: string): Promise<void> {
  const supabase = getPortalServiceClient();
  const rows = LEGAL_DOCUMENT_KEYS.map((key) => ({
    account_id: accountId,
    document: key,
    version: LEGAL_DOCUMENTS[key].version,
  }));

  const { error } = await supabase.from('portal_consents').insert(rows);
  if (error) {
    throw new Error(`同意ログの記録に失敗しました: ${error.message}`);
  }
}

/**
 * 両文書とも現在版に同意済みかを判定する。1つでも欠けていれば false。
 *
 * 版を上げた直後は全員が false になり、/mypage で /mypage/consent へ誘導される。
 * 読み取りに失敗したときも false（＝再同意を求める）にする。同意済みか不明な
 * まま通すより、もう一度同意してもらうほうが安全側に倒れるため。
 */
export async function hasCurrentConsent(accountId: string): Promise<boolean> {
  const supabase = getPortalServiceClient();
  const { data, error } = await supabase
    .from('portal_consents')
    .select('document, version')
    .eq('account_id', accountId);

  if (error) {
    console.error('[mypage/legal] 同意ログの取得に失敗:', error.message);
    return false;
  }

  const rows = (data ?? []) as Array<{ document: string; version: string }>;
  return LEGAL_DOCUMENT_KEYS.every((key) =>
    rows.some((row) => row.document === key && row.version === LEGAL_DOCUMENTS[key].version)
  );
}
