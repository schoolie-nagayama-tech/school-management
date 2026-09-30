// @ts-nocheck
// ============================================================
// 問合せ追客メール送信（Resend）
//
// 問合せ管理の手動メール送信用。フロントの教室長以上（manager/owner/admin）が
// supabase.functions.invoke('send-inquiry-mail', { body }) で呼ぶ（ログイン JWT が付く）。
// 保護者ポータルの通知（src/lib/mypage/notify.ts）もサーバーから service role で相乗りする。
//
// 既存の send-form-notification と異なり:
//   - 差出人の表示名を教室別に変えられる（fromName）。ドメインは検証済みの
//     school-ie.com を共用（Resend の制約上 from のドメインは固定）。
//   - reply_to に教室メールを設定し、保護者がそのまま返信できるようにする。
//   - 「送信専用です」フッターは付けない（返信してもらう前提のため）。
//   - unsubscribeUrl が渡されたときは、特定電子メール法のオプトアウト導線として
//     本文末尾にワンクリック配信停止リンクのフッターを付ける。
//
// 本文はプレーンテキスト(改行入り)で受け取り、<br> に変換して送る。
//
// ★呼び出し元の認証（_shared/auth.ts）:
//   以前は誰の呼び出しでも送っていたため、公開の anon key だけで任意の宛先・件名・本文・
//   差出人名を指定でき、教室名義のフィッシングメールを正規ドメインから送れた。
//   現在は次の2経路だけを通す。
//     - service role（Next.js サーバーの src/lib/mypage/notify.ts など）
//     - ログイン中の教室長以上（manager / owner / admin）。追客メール・テンプレートの
//       テスト送信の画面（/admin/inquiries/**）が isManagerOrAbove でガードされているため、
//       画面を使える人と同じ範囲にそろえた。講師(teacher)はこの画面を使わないので通さない。
// ============================================================
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { authorizeRequest } from '../_shared/auth.ts'
import { escapeHtml, normalizeRecipients, isValidEmail, safeHttpUrl } from '../_shared/sanitize.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

// 差出人ドメイン（Resend で検証済み）。表示名のみ教室別に差し替える。
const FROM_DOMAIN = 'noreply@school-ie.com'
const DEFAULT_FROM_NAME = 'スクールIE'

// CORS ヘッダー。本関数はブラウザから supabase.functions.invoke で呼ばれるため、
// プリフライト(OPTIONS)に応答し、全レスポンスに Access-Control-* を付与する必要がある。
// （これが無いとプリフライトが弾かれ、実際の POST が届かず送信できない）
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** Resend のレート制限（2 req/秒）対策の待機 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 入力の上限。正規の追客メール・お知らせより十分大きく、踏み台として
// 大量送信・巨大本文に使われない程度に抑える。
const MAX_RECIPIENTS = 50
const MAX_SUBJECT_LENGTH = 300
const MAX_BODY_LENGTH = 50000
const MAX_FROM_NAME_LENGTH = 100

/**
 * 差出人の表示名を From ヘッダーに入れても壊れない形にする。
 * 改行・山括弧・ダブルクォートが入ると「表示名 <別アドレス>」として解釈され、
 * 差出人アドレス自体を偽装される恐れがあるため取り除く。
 */
function sanitizeFromName(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_FROM_NAME
  const cleaned = value.replace(/[\r\n<>"\\]/g, '').trim().slice(0, MAX_FROM_NAME_LENGTH)
  return cleaned || DEFAULT_FROM_NAME
}

/**
 * 配信停止フッター（特定電子メール法のオプトアウト導線）。
 * unsubscribeUrl が渡されたときだけ本文末尾に追記する。
 * 「問合せ元に送っている旨」＋「ワンクリック配信停止リンク」を明示する。
 */
function unsubscribeFooterHtml(unsubscribeUrl?: string): string {
  if (!unsubscribeUrl) return ''
  // http(s) であることは呼び出し側（serve 内）で検証済み。ここでは属性値として escape する。
  const url = escapeHtml(unsubscribeUrl)
  return (
    `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.6;color:#9ca3af;">` +
    `※このメールは、スクールIEへお問い合わせ・資料請求をいただいた方にお送りしています。<br>` +
    `今後このようなメールの配信を希望されない場合は、下記からお手続きください。<br>` +
    `<a href="${url}" style="color:#6b7280;text-decoration:underline;">配信を停止する</a>` +
    `</div>`
  )
}

/** プレーンテキストの本文を最小限の HTML に変換する（改行→<br>、HTMLエスケープ） */
function textToHtml(text: string, unsubscribeUrl?: string): string {
  const escaped = escapeHtml(text).replace(/\n/g, '<br>')
  return (
    `<div style="font-size:14px;line-height:1.7;color:#222;white-space:normal;">${escaped}</div>` +
    unsubscribeFooterHtml(unsubscribeUrl)
  )
}

// メール1通送信（429 のときは1回だけリトライ）
async function sendEmail(params: {
  to: string[]
  subject: string
  html: string
  fromName: string
  replyTo?: string
}) {
  const from = `${params.fromName} <${FROM_DOMAIN}>`
  const payload: Record<string, unknown> = {
    from,
    to: params.to,
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
  // CORS プリフライト（ブラウザが POST 前に送る OPTIONS）に応答する
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders })
  }

  // 以降の全レスポンスに付ける共通ヘッダー
  const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

  const badRequest = (message: string) =>
    new Response(JSON.stringify({ error: message }), { status: 400, headers: jsonHeaders })

  try {
    // 本文を読む前に呼び出し元を確かめる（未認証の呼び出しで何も処理させない）
    const auth = await authorizeRequest(req, 'manager', corsHeaders)
    if (!auth.ok) return auth.response

    const body = await req.json()
    const { to, subject, body: mailBody, fromName, replyTo, unsubscribeUrl } = body ?? {}

    // 必須項目の検証
    if (!to || !subject || !mailBody) {
      return badRequest('to / subject / body が必要です')
    }
    if (typeof subject !== 'string' || typeof mailBody !== 'string') {
      return badRequest('subject / body は文字列で指定してください')
    }
    // 件名に改行が入るとヘッダーの行が割れるため、空白に置き換える
    const safeSubject = subject.replace(/[\r\n]+/g, ' ').trim()
    if (!safeSubject || safeSubject.length > MAX_SUBJECT_LENGTH) {
      return badRequest(`件名は1〜${MAX_SUBJECT_LENGTH}文字で指定してください`)
    }
    if (mailBody.length > MAX_BODY_LENGTH) {
      return badRequest(`本文は${MAX_BODY_LENGTH}文字以内で指定してください`)
    }

    const recipients = normalizeRecipients(to, MAX_RECIPIENTS)
    if (!recipients) {
      return badRequest(`宛先のメールアドレスが不正です（最大${MAX_RECIPIENTS}件）`)
    }

    let safeReplyTo: string | undefined
    if (replyTo) {
      const trimmed = typeof replyTo === 'string' ? replyTo.trim() : replyTo
      if (!isValidEmail(trimmed)) {
        return badRequest('返信先メールアドレスの形式が不正です')
      }
      safeReplyTo = trimmed
    }

    // 配信停止リンクは href に入るため、javascript: などを通さないよう http(s) に限る。
    // 不正なら黙ってフッターを落とさず 400 にする（オプトアウト導線の欠落に気付けるように）。
    let safeUnsubscribeUrl: string | undefined
    if (unsubscribeUrl) {
      const checked = safeHttpUrl(unsubscribeUrl)
      if (!checked) {
        return badRequest('配信停止URLが不正です')
      }
      safeUnsubscribeUrl = checked
    }

    const result = await sendEmail({
      to: recipients,
      subject: safeSubject,
      html: textToHtml(mailBody, safeUnsubscribeUrl),
      fromName: sanitizeFromName(fromName),
      replyTo: safeReplyTo,
    })

    return new Response(JSON.stringify({ success: true, id: result?.id ?? null }), {
      status: 200,
      headers: jsonHeaders,
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: jsonHeaders,
    })
  }
})
