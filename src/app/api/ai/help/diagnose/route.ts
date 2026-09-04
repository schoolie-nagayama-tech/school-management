import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { isSystemAdmin } from '@/lib/utils/roles';
import { callClaude, isClaudeConfigured, CLAUDE_MODELS, ClaudeError } from '@/lib/ai/claude';

export const dynamic = 'force-dynamic';

/**
 * AIヘルプの自己診断（admin 限定）。
 *
 * ★「AIが使えません」の原因を、ログを掘らずに切り分けるための入口。
 *   同じ呼び出しを条件を変えて数回試し、どこから失敗するかを見る。
 *
 *   1. 鍵があるか
 *   2. いちばん単純な呼び出し（モデルとメッセージだけ）が通るか
 *      → ここで落ちるならモデルIDか鍵の問題
 *   3. プロンプトキャッシュを付けた呼び出しが通るか
 *      → ここだけ落ちるなら cache_control が原因
 *   4. 実際に使うモデル構成（難所用の Sonnet）が通るか
 *
 * 使い方: admin でログインして GET /api/ai/help/diagnose を開く。
 * ★毎回わずかに課金される（合計でも1円未満）。常用するものではない。
 */

interface Check {
  name: string;
  ok: boolean;
  /** 失敗したときだけ。APIが返した理由の原文 */
  detail?: string;
  reason?: string;
  status?: number;
}

async function run(name: string, fn: () => Promise<unknown>): Promise<Check> {
  try {
    await fn();
    return { name, ok: true };
  } catch (e) {
    if (e instanceof ClaudeError) {
      return { name, ok: false, reason: e.reason, status: e.status, detail: e.detail };
    }
    return { name, ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  if (!isSystemAdmin(auth.role)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const configured = isClaudeConfigured();
  if (!configured) {
    return NextResponse.json({
      configured: false,
      hint: 'ANTHROPIC_API_KEY が設定されていません。Vercel の環境変数に入れて再デプロイしてください。',
      checks: [],
    });
  }

  const checks: Check[] = [];

  // 2. いちばん単純な呼び出し。ここで落ちればモデルIDか鍵
  checks.push(
    await run(`最小の呼び出し（${CLAUDE_MODELS.fast}）`, () =>
      callClaude({
        model: CLAUDE_MODELS.fast,
        system: [{ text: 'ひとことで答えてください。' }],
        userText: 'テストです。「OK」とだけ返してください。',
        maxTokens: 16,
      })
    )
  );

  // 3. プロンプトキャッシュ付き。
  //    ★本番の呼び出しは、弾かれたらキャッシュ無しで自動的に retry するので落ちない。
  //      ここは「組織でキャッシュが有効か」を素で見るための検査。ok:false でも機能は動く。
  checks.push(
    await run('プロンプトキャッシュ付き（無効でも機能は動く）', () =>
      callClaude({
        model: CLAUDE_MODELS.fast,
        system: [
          { text: 'ひとことで答えてください。' },
          // キャッシュには下限があるので、判定できるだけの長さを持たせる
          { text: 'これは検証用の長い文章です。'.repeat(400), cache: true },
        ],
        userText: 'テストです。「OK」とだけ返してください。',
        maxTokens: 16,
      })
    )
  );

  // 4. 難所用のモデル
  checks.push(
    await run(`難所用モデル（${CLAUDE_MODELS.smart}）`, () =>
      callClaude({
        model: CLAUDE_MODELS.smart,
        system: [{ text: 'ひとことで答えてください。' }],
        userText: 'テストです。「OK」とだけ返してください。',
        maxTokens: 16,
      })
    )
  );

  // キャッシュ検査の失敗は「動かない」ではないので、詰まりの判定からは外す
  const blocking = checks.filter((c) => !c.ok && !c.name.startsWith('プロンプトキャッシュ'));
  const cacheCheck = checks.find((c) => c.name.startsWith('プロンプトキャッシュ'));
  const firstFailure = blocking[0];
  return NextResponse.json({
    configured: true,
    models: CLAUDE_MODELS,
    allOk: !firstFailure,
    promptCacheAvailable: cacheCheck ? cacheCheck.ok : null,
    hint: firstFailure
      ? `「${firstFailure.name}」で失敗しました。detail にAPIが返した理由が入っています。`
      : cacheCheck && !cacheCheck.ok
        ? 'AIヘルプは動きます。プロンプトキャッシュだけ組織で無効です（コンソールで有効にすると費用と速度が改善します）。'
        : 'すべて通りました。AIヘルプは動くはずです。',
    checks,
  });
}
