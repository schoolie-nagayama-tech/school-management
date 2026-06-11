// @ts-nocheck
// ============================================================
// 問合せ追客メール送信（Resend）
//
// 問合せ管理の手動メール送信専用。フロントの管理者(admin/owner)が
// supabase.functions.invoke('send-inquiry-mail', { body }) で呼ぶ。
//
// 既存の send-form-notification と異なり:
//   - 差出人の表示名を教室別に変えられる（fromName）。ドメインは検証済みの
//     school-ie.com を共用（Resend の制約上 from のドメインは固定）。
//   - reply_to に教室メールを設定し、保護者がそのまま返信できるようにする。
//   - 「送信専用です」フッターは付けない（返信してもらう前提のため）。
//
// 本文はプレーンテキスト(改行入り)で受け取り、<br> に変換して送る。
// ============================================================
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

// 差出人ドメイン（Resend で検証済み）。表示名のみ教室別に差し替える。
const FROM_DOMAIN = 'noreply@school-ie.com'
const DEFAULT_FROM_NAME = 'スクールIE'

/** Resend のレート制限（2 req/秒）対策の待機 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** プレーンテキストの本文を最小限の HTML に変換する（改行→<br>、HTMLエスケープ） */
function textToHtml(text: string): string {
  const escaped = String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return `<div style="font-size:14px;line-height:1.7;color:#222;white-space:normal;">${escaped.replace(/\n/g, '<br>')}</div>`
}

// メール1通送信（429 のときは1回だけリトライ）
async function sendEmail(params: {
  to: string
  subject: string
  html: string
  fromName: string
  replyTo?: string
}) {
  const from = `${params.fromName} <${FROM_DOMAIN}>`
  const payload: Record<string, unknown> = {
    from,
    to: [params.to],
    subject: params.subject,
    html: params.html,
  }
  // 返信先（教室メール）が指定されていれば設定
  if (params.replyTo) {
    payload.reply_to = params.replyTo
  }

  const doSend = (): Promise<Response> =>
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify(payload),
    })

  let res = await doSend()
  if (res.status === 429) {
    await delay(1100)
    res = await doSend()
  }
  if (!res.ok) {
    const error = await res.text()
    throw new Error(`メール送信失敗: ${error}`)
  }
  return res.json()
}

serve(async (req) => {
  try {
    const body = await req.json()
    const { to, subject, body: mailBody, fromName, replyTo } = body ?? {}

    // 必須項目の検証
    if (!to || !subject || !mailBody) {
      return new Response(
        JSON.stringify({ error: 'to / subject / body が必要です' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const result = await sendEmail({
      to,
      subject,
      html: textToHtml(mailBody),
      fromName: fromName || DEFAULT_FROM_NAME,
      replyTo: replyTo || undefined,
    })

    return new Response(JSON.stringify({ success: true, id: result?.id ?? null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
