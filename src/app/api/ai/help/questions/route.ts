import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { isSystemAdmin } from '@/lib/utils/roles';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';

export const dynamic = 'force-dynamic';

/**
 * 答えられなかった質問の一覧（admin 限定）。
 *
 * ★これがAIヘルプの運用の要。ここを見てFAQ本文を書き足せば、次から答えられるようになる。
 *   AIを賢くするのではなく、FAQを育てるための画面（docs/ai-help-plan.md §4）。
 *
 * 同じ質問は文面で畳んで回数を出す。何度も聞かれているものから書けばよい。
 */

export interface HelpQuestionRow {
  question: string;
  role: string;
  pagePath: string | null;
  /** 同じ文面で聞かれた回数 */
  count: number;
  /** いちばん新しく聞かれた日時 */
  lastAskedAt: string;
}

/** 読み取り上限。PostgREST の1000行上限に自分で当てないよう明示する */
const SCAN_LIMIT = 1000;

export async function GET(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  if (!isSystemAdmin(auth.role)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  try {
    const supabase = getPortalServiceClient();
    // 答えられなかった質問と、「立たなかった」と言われた質問の両方を拾う。
    // どちらも「FAQに足りないもの」を指しているので、書き足す材料としては同じ。
    const { data, error } = await supabase
      .from('help_questions')
      .select('question, role, page_path, created_at, unanswered, helpful')
      .or('unanswered.eq.true,helpful.eq.false')
      .order('created_at', { ascending: false })
      .limit(SCAN_LIMIT);

    if (error) {
      // テーブル未作成（マイグレーション未適用）でも画面を壊さない
      console.error('[ai/help/questions] 取得に失敗', error.message);
      return NextResponse.json({ rows: [], available: false });
    }

    // 同じ文面をまとめて回数にする
    const byQuestion = new Map<string, HelpQuestionRow>();
    for (const r of data ?? []) {
      const question = (r.question as string) ?? '';
      const hit = byQuestion.get(question);
      if (hit) {
        hit.count += 1;
        continue;
      }
      byQuestion.set(question, {
        question,
        role: (r.role as string) ?? '',
        pagePath: (r.page_path as string | null) ?? null,
        count: 1,
        // 新しい順で読んでいるので、最初に見つかったものが最新
        lastAskedAt: r.created_at as string,
      });
    }

    // 回数の多い順 → 新しい順。何度も聞かれているものから書けばよい
    const rows = Array.from(byQuestion.values()).sort(
      (a, b) => b.count - a.count || b.lastAskedAt.localeCompare(a.lastAskedAt)
    );

    return NextResponse.json({ rows, available: true });
  } catch (e) {
    console.error('[ai/help/questions] 取得に失敗', e);
    return NextResponse.json({ rows: [], available: false });
  }
}
