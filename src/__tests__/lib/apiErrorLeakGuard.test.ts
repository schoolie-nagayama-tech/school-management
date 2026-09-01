import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * API ルートが内部エラー文言をクライアントに返していないことを機械的に見張るテスト。
 *
 * ★なぜ lint ルールでなくテストなのか:
 *   `NextResponse.json({ error: e.message })` を no-restricted-syntax の AST セレクタで
 *   狙い撃つのは書けるが脆く、正当なケース（利用者に伝える意味のあるバリデーション文言）
 *   まで巻き込みやすい。ここでは対象を API ルートに限定し、違反箇所をファイル名と行番号で
 *   示す方が実用的だと判断した。
 *
 * ★何が問題だったか:
 *   Supabase の生のエラーをそのまま返すと、DB のカラム名・制約名といった内部構造が
 *   一般利用者に見える（情報漏洩）。しかも利用者には意味不明で役に立たない。
 *   2026-08 時点で44箇所あり、うち35箇所が courses/prep/route.ts に集中していた。
 *   詳細は Sentry 側で見て、クライアントには固定文言＋eventId を返す方針に統一した。
 *
 * 新しく違反を足したくなったら、まず `apiErrorResponse()`（src/lib/api-error.ts）を使えないか
 * 検討すること。どうしても例外が必要なら ALLOWLIST に理由付きで足す。
 */

const API_DIR = join(process.cwd(), 'src', 'app', 'api');

/**
 * 例外的に許可するファイル。
 * 「利用者に伝える意味があり、かつ内部構造を漏らさない」と確認できたものだけ、理由付きで足す。
 */
const ALLOWLIST: Record<string, string> = {
  // NODE_ENV !== 'development' では常に 404 を返す開発専用ルート。本番の利用者には到達しないうえ、
  // 生メッセージがローカルで詰まったときの唯一の手がかりになるため許可する。
  'src/app/api/dev/login/route.ts': '開発専用ルート（本番では常に404）',
};

/**
 * レスポンスに内部エラー文言を載せている行を探す。
 *
 * `error: e.message` のような直接参照だけでなく、`` error: `...${e?.message}` `` のような
 * テンプレートリテラル埋め込みも拾えるように、「同じ行に `error:`/`detail:` と `.message` が
 * 両方ある」を条件にしている（当初は識別子直参照だけを見ており、テンプレートリテラル経由の
 * 漏洩を見逃していた）。多少広めだが、API ルートに限定しているので誤検知は実質起きない。
 */
function isLeakLine(line: string): boolean {
  return /\b(error|detail):/.test(line) && /\.message\b/.test(line);
}

function collectRouteFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collectRouteFiles(full));
    } else if (entry === 'route.ts') {
      found.push(full);
    }
  }
  return found;
}

describe('APIルートの内部エラー文言の漏洩ガード', () => {
  it('クライアントに <error>.message をそのまま返しているルートが無い', () => {
    const violations: string[] = [];

    for (const file of collectRouteFiles(API_DIR)) {
      const relative = file.slice(process.cwd().length + 1).replace(/\\/g, '/');
      if (ALLOWLIST[relative]) continue;

      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (isLeakLine(line)) {
          violations.push(`${relative}:${i + 1}  ${line.trim()}`);
        }
      });
    }

    expect(
      violations,
      `内部エラー文言をクライアントに返している箇所があります。` +
        `src/lib/api-error.ts の apiErrorResponse() を使ってください。\n` +
        violations.join('\n')
    ).toEqual([]);
  });

  it('走査対象のルートを実際に見つけられている（正規表現の空振り検知）', () => {
    // ルートが1つも拾えていないのに「違反ゼロ」で通ってしまう事故を防ぐ
    expect(collectRouteFiles(API_DIR).length).toBeGreaterThan(50);
  });
});
