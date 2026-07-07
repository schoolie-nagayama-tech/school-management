/**
 * ステップメールの「本日の送信候補」を算出する純関数モジュール。
 * DB・副作用なし。テスト容易性のため独立したファイルに切り出している。
 */

import type { Inquiry, InquiryMailTemplate, InquiryMailLog } from '@/types/database';

/** 送信候補の1エントリ */
export interface MailCandidate {
  inquiry: Inquiry;
  template: InquiryMailTemplate;
  /** 問合せ受付日(inquired_at)から now までの経過日数（floor） */
  daysSince: number;
}

/**
 * ステップメール送信候補を算出する純関数。
 *
 * 候補に含める条件（全て満たすこと）:
 *  1. ステータスが 'in_progress' または 'unreachable'
 *  2. trial_at・interview_at がいずれも null（体験・面談設定済みは対象外）
 *  3. email が存在し、かつ 'なし' ではない（実質的な連絡先チェック）
 *  3b. 配信停止(email_opt_out)されていない
 *  4. テンプレートが is_active かつ trigger_days が null でない
 *  5. テンプレートの school_id が null（全教室共通）または inquiry.school_id と一致
 *  6. daysSince >= trigger_days かつ daysSince <= trigger_days + 13
 *     （13 日バッファ: 古すぎる候補で画面が溢れるのを防ぐ）
 *  7. 同じ inquiry_id × template_id の送信記録（status='sent'）が存在しない
 *
 * 並び順: inquired_at 昇順 → trigger_days 昇順
 * （古い問合せ・早いステップを優先して確認できるようにする）
 *
 * @param inquiries   問合せ一覧（取得済み）
 * @param templates   テンプレート一覧（取得済み）
 * @param logs        送信ログ一覧（取得済み）
 * @param now         基準日時（テスト時に差し込み可能にするため引数で受ける）
 */
export function computeMailCandidates(
  inquiries: Inquiry[],
  templates: InquiryMailTemplate[],
  logs: InquiryMailLog[],
  now: Date
): MailCandidate[] {
  // 送信済み判定セット: `${inquiry_id}::${template_id}` → 高速ルックアップ
  const sentSet = new Set<string>(
    logs
      .filter((l) => l.status === 'sent' && l.template_id !== null)
      .map((l) => `${l.inquiry_id}::${l.template_id}`)
  );

  // アクティブかつ trigger_days を持つテンプレートに絞る
  const activeTemplates = templates.filter((t) => t.is_active && t.trigger_days !== null);

  const candidates: MailCandidate[] = [];

  for (const inquiry of inquiries) {
    // 条件1: ステータスチェック
    if (inquiry.status !== 'in_progress' && inquiry.status !== 'unreachable') continue;

    // 条件2: 体験・面談未設定チェック
    if (inquiry.trial_at !== null || inquiry.interview_at !== null) continue;

    // 条件3: メールアドレスチェック
    const email = inquiry.email;
    if (!email || email.trim() === '' || email === 'なし') continue;

    // 条件3b: 配信停止された宛先は候補から除外（オプトアウトの尊重）
    if (inquiry.email_opt_out) continue;

    // 経過日数を計算（ミリ秒 → 日数。小数を切り捨て）
    const daysSince = Math.floor(
      (now.getTime() - new Date(inquiry.inquired_at).getTime()) / 86_400_000
    );

    for (const template of activeTemplates) {
      // trigger_days は上でフィルタ済みだが TypeScript の null チェックのため再確認
      const triggerDays = template.trigger_days as number;

      // 条件5: テンプレートの school_id が null(共通) または inquiry.school_id と一致
      if (template.school_id !== null && template.school_id !== inquiry.school_id) continue;

      // 条件6: daysSince の範囲チェック（[trigger_days, trigger_days+13] の閉区間）
      if (daysSince < triggerDays || daysSince > triggerDays + 13) continue;

      // 条件7: 既送チェック（inquiry × template の組み合わせで status='sent' が無いこと）
      if (sentSet.has(`${inquiry.id}::${template.id}`)) continue;

      candidates.push({ inquiry, template, daysSince });
    }
  }

  // 並び順: inquired_at 昇順 → trigger_days 昇順
  candidates.sort((a, b) => {
    const dateA = new Date(a.inquiry.inquired_at).getTime();
    const dateB = new Date(b.inquiry.inquired_at).getTime();
    if (dateA !== dateB) return dateA - dateB;
    return (a.template.trigger_days as number) - (b.template.trigger_days as number);
  });

  return candidates;
}
