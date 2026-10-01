// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeRequest } from '../_shared/auth.ts'
import { escapeHtml, isValidEmail } from '../_shared/sanitize.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
const SITE_URL = Deno.env.get('SITE_URL') || 'https://school-management-eight-cyan.vercel.app/'

const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!)

// ブラウザからの invoke（ログイン中スタッフ）に備えた CORS ヘッダー。
// 401/403 を含む全レスポンスに付け、ブラウザ側でエラー内容を読めるようにする。
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

// form_responses.id は uuid。形式を先に確かめ、不正な値で DB を叩かせない。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// フォーム種別の日本語名
const FORM_TYPE_LABELS: Record<string, string> = {
  zoukoma: 'テスト対策増コマ申し込み',
  moshi: 'オープン模試申し込み',
  mogi: 'Vもぎ申し込み',
  shukaisu: '週回数変更',
  youbi: '曜日変更',
  kyozai: '教材販売',
  soudan: 'お客様相談',
}

// Vもぎは地域（東京/神奈川）で呼称が変わる
function resolveFormTypeLabel(formType: string, periodSettings?: any): string {
  if (formType === 'mogi') {
    const region = periodSettings?.region ?? 'tokyo'
    return region === 'kanagawa' ? '神奈川全県模試申し込み' : 'Vもぎ申し込み'
  }
  return FORM_TYPE_LABELS[formType] || formType
}

// 学年ラベル
const GRADE_LABELS: Record<number, string> = {
  1: '小1', 2: '小2', 3: '小3', 4: '小4', 5: '小5', 6: '小6',
  7: '中1', 8: '中2', 9: '中3',
  10: '高1', 11: '高2', 12: '高3', 13: '既卒',
}

// 送信者（スクールIE）
const EMAIL_FROM = 'スクールIE <noreply@school-ie.com>'
// 返信先が無いメールの末尾に付けるフッター。
// ★school-ie.com は受信サーバー（MX）を持たないため、noreply@ への返信は届かないうえ、
// 相手のメールサーバーが約2日再試行してから不達になる。返信先を付けられないメールだけに使う。
const EMAIL_FOOTER = '<p style="margin-top: 24px; font-size: 12px; color: #888;">送信専用です。このメールに返信いただいてもお答えできません。</p>'

// 返信先（教室メール）を付けたメールのフッター。返信が教室に届くことを伝える。
function replyableFooter(schoolName: string): string {
  return `<p style="margin-top: 24px; font-size: 12px; color: #888;">このメールにご返信いただくと、${escapeHtml(schoolName)}に届きます。</p>`
}

/**
 * 保護者・講師向けメールの返信先（教室メール）。
 * 問合せ管理の教室別設定（資料発送 → 教室別発送設定の「返信先メールアドレス」）を共用する。
 * 追客メールと同じ窓口に返信を集めるため、フォーム用に別の設定は設けない。
 * 未設定・形式不正なら undefined（返信先なし＝送信専用のまま送る）。
 */
async function getSchoolReplyTo(schoolId: string): Promise<string | undefined> {
  const { data, error } = await supabase
    .from('inquiry_school_settings')
    .select('mail_reply_to')
    .eq('school_id', schoolId)
    .maybeSingle()
  if (error) {
    // 返信先が取れなくても申込の受付メール自体は止めない
    console.error('返信先（mail_reply_to）の取得エラー:', error)
    return undefined
  }
  const replyTo = typeof data?.mail_reply_to === 'string' ? data.mail_reply_to.trim() : ''
  return isValidEmail(replyTo) ? replyTo : undefined
}

/** Resend のレート制限（2 req/秒）を超えないよう、送信間に待機する */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// メール送信（429 のときは1回だけリトライ）
async function sendEmail(to: string, subject: string, html: string, replyTo?: string) {
  const doSend = async (): Promise<Response> => {
    return await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [to],
        subject,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    })
  }

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

// 申込詳細をHTMLに変換（periodSettings は模試などフォーム種別ごとの設定を渡す場合に使用）
function formatResponseDetails(formType: string, responseData: any, periodSettings?: any): string {
  let details = ''

  switch (formType) {
    case 'zoukoma':
      if (responseData.subjects) {
        details += '<p><strong>科目別コマ数:</strong></p><ul>'
        for (const [subject, count] of Object.entries(responseData.subjects)) {
          if (count && Number(count) > 0) {
            details += `<li>${escapeHtml(subject)}: ${escapeHtml(count)}コマ</li>`
          }
        }
        details += '</ul>'
      }
      if (responseData.total_koma) {
        details += `<p><strong>合計:</strong> ${escapeHtml(responseData.total_koma)}コマ</p>`
      }
      if (responseData.total_fee) {
        details += `<p><strong>金額:</strong> ${escapeHtml(responseData.total_fee.toLocaleString())}円</p>`
      }
      if (responseData.selected_slots?.length > 0) {
        details += '<p><strong>希望日程:</strong></p><ul>'
        for (const slot of responseData.selected_slots) {
          details += `<li>${escapeHtml(slot.label)}</li>`
        }
        details += '</ul>'
      }
      if (responseData.note) {
        details += `<p><strong>備考:</strong> ${escapeHtml(responseData.note)}</p>`
      }
      break

    case 'mogi':
      if (responseData.selections?.length > 0) {
        details += '<p><strong>選択した日程・会場:</strong></p><ul>'
        // 会場別の上履き持参要否を periodSettings.dates から参照
        const venueById: Record<string, any> = {}
        if (periodSettings?.dates) {
          for (const d of periodSettings.dates) {
            for (const v of d.venues ?? []) {
              venueById[v.id] = v
            }
          }
        }
        for (const sel of responseData.selections) {
          const typeLabel = sel.exam_type_label ? `[${escapeHtml(sel.exam_type_label)}] ` : ''
          const venue = venueById[sel.venue_id]
          const uwabaki = venue?.requires_uwabaki
            ? `<br><span style="font-size:12px;color:#9a3412;font-weight:600;">※この会場は上履きが必要です。</span>`
            : ''
          details += `<li>${typeLabel}${escapeHtml(sel.date_label)} - ${escapeHtml(sel.venue_label)}${uwabaki}</li>`
        }
        details += '</ul>'
      }
      if (responseData.note) {
        details += `<p><strong>備考:</strong> ${escapeHtml(responseData.note)}</p>`
      }
      break

    case 'moshi':
      if (responseData.exam_type === 'regular') {
        details += `<p><strong>受験方法:</strong> 本試験受験</p>`
        // 複数日程の期間では回答が選んだ日程を持つ。持たない場合（単一日程・旧回答）は期間設定にフォールバック
        const examDateLabel =
          responseData.selected_exam_date_label || periodSettings?.exam_date_label
        const examTime = responseData.selected_exam_date_label
          ? responseData.selected_exam_time
          : periodSettings?.exam_time
        if (examDateLabel) {
          details += `<p><strong>本試験日:</strong> ${escapeHtml(examDateLabel)}</p>`
        }
        if (examTime) {
          details += `<p><strong>時間:</strong> ${escapeHtml(examTime)}</p>`
        }
      } else if (responseData.exam_type === 'furikae') {
        details += `<p><strong>受験方法:</strong> 振替受験</p>`
        if (responseData.furikae_date_label) {
          details += `<p><strong>振替希望日:</strong> ${escapeHtml(responseData.furikae_date_label)}</p>`
        }
        if (responseData.furikae_time) {
          details += `<p><strong>希望時間:</strong> ${escapeHtml(responseData.furikae_time)}</p>`
        }
      }
      if (responseData.note) {
        details += `<p><strong>備考:</strong> ${escapeHtml(responseData.note)}</p>`
      }
      break

    case 'shukaisu':
      if (responseData.change_from_label) {
        details += `<p><strong>変更開始時期:</strong> ${escapeHtml(responseData.change_from_label)}</p>`
      }
      if (responseData.current?.weekly_count !== undefined) {
        details += `<p><strong>現在の週回数:</strong> ${escapeHtml(responseData.current.weekly_count)}回</p>`
      }
      if (responseData.current?.slots?.length > 0) {
        details += '<p><strong>現在のコマ:</strong></p><ul>'
        for (const slot of responseData.current.slots) {
          details += `<li>${escapeHtml(slot.day)} ${escapeHtml(slot.period_label)} ${escapeHtml(slot.subject)}</li>`
        }
        details += '</ul>'
      }
      if (responseData.requested?.weekly_count !== undefined) {
        details += `<p><strong>変更後の週回数:</strong> ${escapeHtml(responseData.requested.weekly_count)}回</p>`
      }
      if (responseData.requested?.slots?.length > 0) {
        details += '<p><strong>希望コマ:</strong></p><ul>'
        for (const slot of responseData.requested.slots) {
          details += `<li>${escapeHtml(slot.day)} ${escapeHtml(slot.period_label)} ${escapeHtml(slot.subject)}</li>`
        }
        details += '</ul>'
      }
      if (responseData.note) {
        details += `<p><strong>備考:</strong> ${escapeHtml(responseData.note)}</p>`
      }
      break

    case 'youbi':
      if (responseData.change_from_label) {
        details += `<p><strong>変更開始時期:</strong> ${escapeHtml(responseData.change_from_label)}</p>`
      }
      if (responseData.current) {
        const cur = responseData.current
        details += `<p><strong>現在の曜日・時間:</strong> ${escapeHtml(cur.day)} ${escapeHtml(cur.period_label)} ${escapeHtml(cur.subject)}</p>`
      }
      if (responseData.request1) {
        const r1 = responseData.request1
        details += `<p><strong>第1希望:</strong> ${escapeHtml(r1.day)} ${escapeHtml(r1.period_label)} ${escapeHtml(r1.subject)}</p>`
      }
      if (responseData.request2) {
        const r2 = responseData.request2
        details += `<p><strong>第2希望:</strong> ${escapeHtml(r2.day)} ${escapeHtml(r2.period_label)} ${escapeHtml(r2.subject)}</p>`
      }
      if (responseData.note) {
        details += `<p><strong>備考:</strong> ${escapeHtml(responseData.note)}</p>`
      }
      break

    case 'kyozai':
      if (responseData.items?.length > 0) {
        details += '<p><strong>選択した教材:</strong></p><ul>'
        for (const item of responseData.items) {
          details += `<li>${escapeHtml(item.name)} - ${escapeHtml(item.price?.toLocaleString())}円</li>`
        }
        details += '</ul>'
      }
      if (responseData.total_price) {
        details += `<p><strong>合計金額:</strong> ${escapeHtml(responseData.total_price.toLocaleString())}円</p>`
      }
      if (responseData.note) {
        details += `<p><strong>備考:</strong> ${escapeHtml(responseData.note)}</p>`
      }
      break

    case 'soudan':
      if (responseData.categories?.length > 0) {
        details += `<p><strong>相談区分:</strong> ${escapeHtml(responseData.categories.join('、'))}</p>`
      }
      if (responseData.content) {
        details += `<p><strong>相談内容:</strong></p><p style="white-space: pre-wrap;">${escapeHtml(responseData.content)}</p>`
      }
      if (responseData.phone) {
        details += `<p><strong>電話番号:</strong> ${escapeHtml(responseData.phone)}</p>`
      }
      break

    default:
      details += `<pre>${escapeHtml(JSON.stringify(responseData, null, 2))}</pre>`
  }

  return details
}

// 模試申込用：対象模試の案内ブロック（フォームの全内容＝どの模試か・実施日時・案内文）をHTMLで返す
function formatMoshiContextBlock(periodTitle: string, periodSettings: any): string {
  if (!periodTitle && !periodSettings) return ''
  const parts: string[] = []
  if (periodTitle) {
    parts.push(`<p><strong>対象の模試:</strong> ${escapeHtml(periodTitle)}</p>`)
  }
  // 複数日程が設定されていれば全日程を列挙。旧データは単一の exam_date_label にフォールバック
  const examDates = (periodSettings?.exam_dates ?? []).filter((d: any) => d?.label)
  if (examDates.length > 0) {
    const items = examDates
      .map((d: any) => `<li>${escapeHtml(d.label)}${d.time ? ` ${escapeHtml(d.time)}` : ''}</li>`)
      .join('')
    parts.push(`<p><strong>試験日:</strong></p><ul>${items}</ul>`)
  } else if (periodSettings?.exam_date_label) {
    parts.push(`<p><strong>試験日:</strong> ${escapeHtml(periodSettings.exam_date_label)}</p>`)
    if (periodSettings?.exam_time) {
      parts.push(`<p><strong>時間:</strong> ${escapeHtml(periodSettings.exam_time)}</p>`)
    }
  }
  if (periodSettings?.description) {
    parts.push(
      '<p style="margin-top: 12px;"><strong>■ 案内文</strong></p>' +
      `<div style="white-space: pre-wrap; background: #fff; padding: 12px; border-radius: 4px; border: 1px solid #e5e7eb; font-size: 13px; color: #374151;">${escapeHtml(periodSettings.description)}</div>`
    )
  }
  return parts.length ? parts.join('') : ''
}

// 申込者向けメール作成
function createApplicantEmail(
  schoolName: string,
  formType: string,
  studentName: string,
  grade: number,
  responseData: any,
  createdAt: string,
  periodTitle?: string,
  periodSettings?: any,
  footer: string = EMAIL_FOOTER
): { subject: string; html: string } {
  const formTypeLabel = resolveFormTypeLabel(formType, periodSettings)
  const gradeLabel = GRADE_LABELS[grade] || `${grade}年`
  const dateStr = new Date(createdAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })

  const subject = `【${schoolName}】${formTypeLabel}のお申し込みを受け付けました`

  // HTML に差し込む値はすべてエスケープ済みの変数を使う（件名はテキストなので素のまま）。
  // 生徒名などは保護者フォーム（未ログイン）から入る値で、タグを仕込まれうるため。
  const hStudentName = escapeHtml(studentName)
  const hFormTypeLabel = escapeHtml(formTypeLabel)
  const hGradeLabel = escapeHtml(gradeLabel)
  const hDateStr = escapeHtml(dateStr)
  const hSchoolName = escapeHtml(schoolName)

  // 曜日変更・週回数変更・テスト対策のみ「日程が決まりましたらGrowから確認」を表示
  const showGrowLine = ['shukaisu', 'youbi'].includes(formType)

  // 模試申込の場合は「対象の模試」と案内文を冒頭に表示
  const moshiContextBlock =
    formType === 'moshi' && (periodTitle || periodSettings)
      ? `<div style="background: #eff6ff; padding: 16px; border-radius: 8px; margin-bottom: 16px; border: 1px solid #bfdbfe;">
          <h3 style="margin-top: 0; color: #1e40af;">申し込まれた模試の内容</h3>
          ${formatMoshiContextBlock(periodTitle || '', periodSettings)}
        </div>`
      : ''

  // Vもぎ/全県模試: 申込後の流れ
  let mogiNextStepsBlock = ''
  if (formType === 'mogi') {
    const region = periodSettings?.region ?? 'tokyo'
    let stepsHtml = ''
    let contactHtml = ''
    if (region === 'tokyo') {
      // 東京版（進研Vもぎ）: 進学研究会のWeb受験票、会場抽選、直通連絡先
      stepsHtml = `
          <li><strong>会場の確定:</strong> 定員に達し次第、抽選で会場が決まります。抽選に漏れた場合は、進学研究会が近隣の別会場に割り振ります。</li>
          <li><strong>受験票のお受け取り:</strong> 会場確定後、進研Vもぎのマイページから会場を確認し、受験票を印刷して会場にお持ちください。</li>
          <li><strong>成績表のお渡し:</strong> 採点結果の成績表は後日、教室でお渡しします。</li>
      `
      contactHtml = `
        <div style="margin-top: 14px; padding-top: 12px; border-top: 1px dashed #fed7aa;">
          <p style="margin: 0 0 4px; font-weight: 600; color: #9a3412;">進学研究会（進研Vもぎ 直通）</p>
          <p style="margin: 0; font-size: 15px; color: #1f2937;">TEL: <strong>03-3952-4171</strong></p>
          <p style="margin: 6px 0 0; font-size: 12px; color: #6b7280; line-height: 1.6;">
            月〜金（祝を除く）9:30〜18:00 ／ 試験日前日 13:00〜16:00 ／ 試験当日 7:00〜13:00<br>
            ※会場校へのもぎに関してのお問合せはできません。
          </p>
        </div>
      `
    } else {
      // 神奈川版（全県模試）: マイページから受験票確認、成績は教室
      stepsHtml = `
          <li><strong>受験票のお受け取り:</strong> マイページからご確認ください。</li>
          <li><strong>成績表のお渡し:</strong> 採点結果の成績表は後日、教室でお渡しします。</li>
      `
      contactHtml = ''
    }
    mogiNextStepsBlock = `
      <div style="background: #fff7ed; padding: 16px; border-radius: 8px; margin: 20px 0; border: 1px solid #fed7aa;">
        <h3 style="margin-top: 0; color: #9a3412;">お申し込み後の流れ</h3>
        <ol style="padding-left: 20px; color: #333; line-height: 1.7;">
${stepsHtml}
        </ol>
        <p style="font-size: 12px; color: #9a3412; margin-bottom: 0;">
          ※ 申込後のキャンセル・返金はできません。
        </p>
        ${contactHtml}
      </div>
    `
  }

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #ff8e3c;">お申し込み受付完了</h2>
      <p>${hStudentName} 様</p>
      <p>以下の内容でお申し込みを受け付けました。</p>
      ${moshiContextBlock}
      <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin-top: 0;">申込内容</h3>
        <p><strong>種別:</strong> ${hFormTypeLabel}</p>
        <p><strong>申込日時:</strong> ${hDateStr}</p>
        <p><strong>生徒名:</strong> ${hStudentName}</p>
        <p><strong>学年:</strong> ${hGradeLabel}</p>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 15px 0;">
        <h3>フォームのご記入内容</h3>
        <p style="color: #555; margin-bottom: 12px;">お申し込み時にご記入いただいた内容は以下のとおりです。</p>
        ${formatResponseDetails(formType, responseData, (formType === 'moshi' || formType === 'mogi') ? periodSettings : undefined)}
      </div>
      ${mogiNextStepsBlock}
      ${formType !== 'mogi' ? '<p>ご不明点がございましたら、教室までお問い合わせください。</p>' : ''}
      ${showGrowLine ? '<p>日程が決まりましたらGrowから確認してください。</p>' : ''}
      <p style="margin-top: 30px; color: #666;">${hSchoolName}</p>
      ${footer}
    </div>
  `

  return { subject, html }
}

// 教室長向けメール作成
function createManagerEmail(
  formType: string,
  studentName: string,
  grade: number,
  email: string,
  responseData: any,
  createdAt: string,
  formPeriod: string,
  periodTitle?: string,
  periodSettings?: any
): { subject: string; html: string } {
  const formTypeLabel = resolveFormTypeLabel(formType, periodSettings)
  const gradeLabel = GRADE_LABELS[grade] || `${grade}年`
  const dateStr = new Date(createdAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })

  const subject = `【新規申込】${formTypeLabel}がありました`

  // HTML に差し込む値はエスケープ済みの変数を使う（createApplicantEmail と同じ理由）
  const hStudentName = escapeHtml(studentName)
  const hFormTypeLabel = escapeHtml(formTypeLabel)
  const hGradeLabel = escapeHtml(gradeLabel)
  const hDateStr = escapeHtml(dateStr)
  const hEmail = escapeHtml(email || '未設定')
  // 管理画面リンクはパス部分を URL エンコードしてから属性値としてエスケープする
  const hManageUrl = escapeHtml(
    `${SITE_URL}/forms/responses/${encodeURIComponent(String(formType ?? ''))}/${encodeURIComponent(String(formPeriod ?? ''))}`
  )

  const moshiContextBlock =
    formType === 'moshi' && (periodTitle || periodSettings)
      ? `<div style="background: #eff6ff; padding: 16px; border-radius: 8px; margin-bottom: 16px; border: 1px solid #bfdbfe;">
          <h3 style="margin-top: 0; color: #1e40af;">対象の模試</h3>
          ${formatMoshiContextBlock(periodTitle || '', periodSettings)}
        </div>`
      : ''

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #ff8e3c;">新しい申込がありました</h2>
      ${moshiContextBlock}
      <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin-top: 0;">申込情報</h3>
        <p><strong>種別:</strong> ${hFormTypeLabel}</p>
        <p><strong>申込日時:</strong> ${hDateStr}</p>
        <p><strong>生徒名:</strong> ${hStudentName}</p>
        <p><strong>学年:</strong> ${hGradeLabel}</p>
        <p><strong>メールアドレス:</strong> ${hEmail}</p>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 15px 0;">
        <h3>フォームの記入内容</h3>
        ${formatResponseDetails(formType, responseData, (formType === 'moshi' || formType === 'mogi') ? periodSettings : undefined)}
      </div>
      <p>
        <a href="${hManageUrl}"
           style="display: inline-block; background: #ff8e3c; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
          管理画面で確認
        </a>
      </p>
      ${EMAIL_FOOTER}
    </div>
  `

  return { subject, html }
}

// ===== シフト提出メール処理 =====
async function handleSeasonalShiftNotification(type: string, submissionId: string) {
  const { data: submission, error: submissionError } = await supabase
    .from('seasonal_shift_submissions')
    .select('id, teacher_name, teacher_email, submitted_at, notes, setting_id, school_id, edit_token')
    .eq('id', submissionId)
    .single()

  if (submissionError || !submission) {
    console.error('提出データ取得エラー:', submissionError)
    throw new Error('Submission not found')
  }

  const { data: setting, error: settingError } = await supabase
    .from('seasonal_shift_settings')
    .select('id, name')
    .eq('id', submission.setting_id)
    .single()

  if (settingError || !setting) {
    throw new Error('シフト設定の取得に失敗')
  }

  const { data: school, error: schoolError } = await supabase
    .from('schools')
    .select('name, notification_email, notification_emails')
    .eq('id', submission.school_id)
    .single()

  if (schoolError || !school) {
    throw new Error('教室情報の取得に失敗')
  }

  const { data: slotsData } = await supabase
    .from('seasonal_shift_submission_slots')
    .select('shift_date, time_slot')
    .eq('submission_id', submissionId)
    .eq('available', true)
    .order('shift_date', { ascending: true })
    .order('time_slot', { ascending: true })

  const submissionSlots = slotsData ?? []
  const availableSlots = submissionSlots.length

  // 出勤可能日時を日付ごとにまとめて表示用テキストにする
  const dayNames = ['日', '月', '火', '水', '木', '金', '土']
  const slotsByDate: Record<string, string[]> = {}
  for (const row of submissionSlots) {
    const d = row.shift_date
    if (!slotsByDate[d]) slotsByDate[d] = []
    slotsByDate[d].push(row.time_slot)
  }
  const slotsListHtml = Object.keys(slotsByDate)
    .sort()
    .map((dateStr) => {
      const d = new Date(dateStr + 'T12:00:00')
      const dateLabel = `${d.getMonth() + 1}/${d.getDate()}(${dayNames[d.getDay()]})`
      const times = escapeHtml(slotsByDate[dateStr].join('、'))
      return `<tr><td style="padding: 4px 8px; border-bottom: 1px solid #eee;">${dateLabel}</td><td style="padding: 4px 8px; border-bottom: 1px solid #eee;">${times}</td></tr>`
    })
    .join('')
  const slotsTableHtml =
    slotsListHtml &&
    `<p><strong>■ 出勤可能日時</strong></p>
     <table style="border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 14px;">
       <thead><tr><th style="text-align: left; padding: 6px 8px; background: #eee;">日付</th><th style="text-align: left; padding: 6px 8px; background: #eee;">時間帯</th></tr></thead>
       <tbody>${slotsListHtml}</tbody>
     </table>`

  const schoolName = school.name || '教室'
  const settingName = setting.name
  const teacherName = submission.teacher_name
  const teacherEmail = submission.teacher_email ?? ''
  const submittedAt = new Date(submission.submitted_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
  // HTML 用のエスケープ済み値。講師名・備考は未ログインの提出フォームから入るため、
  // タグを仕込まれても教室ドメインのメールに HTML として載らないようにする。
  // 件名（テキスト）と宛先には素の値を使う。
  const hSchoolName = escapeHtml(schoolName)
  const hSettingName = escapeHtml(settingName)
  const hTeacherName = escapeHtml(teacherName)
  const hTeacherEmail = escapeHtml(teacherEmail)
  const hSubmittedAt = escapeHtml(submittedAt)
  const hNotes = escapeHtml(submission.notes)
  // 講師向けメール（提出完了・修正のお願い）は返信が教室に届くようにする。
  // 教室向けの提出通知は教室内の連絡なので返信先を付けない（送信専用のまま）。
  const replyTo = await getSchoolReplyTo(submission.school_id)
  const teacherFooter = replyTo ? replyableFooter(schoolName) : EMAIL_FOOTER

  if (type === 'submitted') {
    if (teacherEmail) {
      const teacherSubject = `【${schoolName}】シフト提出完了のお知らせ`
      const teacherHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #d32f2f;">シフト提出を受け付けました</h2>
          <p>${hTeacherName} 様</p>
          <p>シフトのご提出ありがとうございます。<br>以下の内容で受け付けました。</p>
          <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>■ 講習期間：</strong>${hSettingName}</p>
            <p><strong>■ 提出日時：</strong>${hSubmittedAt}</p>
            <p><strong>■ 出勤可能コマ数：</strong>${availableSlots}コマ</p>
            ${slotsTableHtml || ''}
            ${submission.notes ? `<p style="margin-top: 12px;"><strong>■ 備考</strong></p><p style="white-space: pre-wrap;">${hNotes}</p>` : ''}
          </div>
          <p>内容に修正が必要な場合は、教室までご連絡ください。</p>
          <p style="margin-top: 30px; color: #666;">${hSchoolName}</p>
          ${teacherFooter}
        </div>
      `
      await sendEmail(teacherEmail, teacherSubject, teacherHtml, replyTo)
      console.log('講師への提出完了メール送信完了:', teacherEmail)
      await delay(1000)
    }

    // 通知先メールアドレス一覧（notification_emails 配列を優先、なければ旧フィールドでフォールバック）
    const shiftRecipients: string[] =
      school.notification_emails && school.notification_emails.length > 0
        ? school.notification_emails
        : school.notification_email ? [school.notification_email] : []

    if (shiftRecipients.length === 0) {
      console.warn(`教室 ${schoolName} に通知先メールが設定されていません`)
    }

    for (const recipient of shiftRecipients) {
      if (!recipient) continue
      const submissionsUrl = `${SITE_URL.replace(/\/$/, '')}/settings/seasonal-shifts/${submission.setting_id}/submissions`
      const adminSubject = `【シフト提出】${teacherName}さんが提出しました`
      const adminHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #d32f2f;">新しいシフト提出がありました</h2>
          <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>■ 講習期間：</strong>${hSettingName}</p>
            <p><strong>■ 講師名：</strong>${hTeacherName}</p>
            <p><strong>■ メールアドレス：</strong>${hTeacherEmail}</p>
            <p><strong>■ 提出日時：</strong>${hSubmittedAt}</p>
            <p><strong>■ 出勤可能コマ数：</strong>${availableSlots}コマ</p>
          </div>
          <p><a href="${escapeHtml(submissionsUrl)}" style="display: inline-block; background: #1e3a5f; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">提出一覧を確認</a></p>
          <p style="margin-top: 30px; color: #666;">${hSchoolName}</p>
          ${EMAIL_FOOTER}
        </div>
      `
      await sendEmail(recipient, adminSubject, adminHtml)
      console.log('管理者への通知メール送信完了:', recipient)
      await delay(1000)
    }
  } else if (type === 'allow_edit') {
    const editToken = submission.edit_token
    if (!editToken) {
      throw new Error('修正用トークンが取得できません')
    }
    if (!teacherEmail || !teacherEmail.trim()) {
      throw new Error('講師メールアドレスが登録されていないため、メールを送信できません')
    }
    const editUrl = `${SITE_URL.replace(/\/$/, '')}/seasonal-shift/${submission.setting_id}/edit/${editToken}`
    if (teacherEmail) {
      const subject = `【${schoolName}】シフト修正のお願い`
      const html = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #d32f2f;">シフトの修正について</h2>
          <p>${hTeacherName} 様</p>
          <p>${hSettingName} のシフト内容を修正する必要があるため、下記URLより修正をお願いします。</p>
          <p><a href="${escapeHtml(editUrl)}" style="display: inline-block; background: #1e3a5f; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">シフト修正フォームを開く</a></p>
          <p style="word-break: break-all; font-size: 12px; color: #666;">${escapeHtml(editUrl)}</p>
          <p>※このURLは修正完了後、無効になります。</p>
          <p style="margin-top: 30px; color: #666;">${hSchoolName}</p>
          ${teacherFooter}
        </div>
      `
      await sendEmail(teacherEmail, subject, html, replyTo)
      console.log('修正許可メール送信完了:', teacherEmail)
    }
  } else {
    throw new Error(`不明な type: ${type}`)
  }
}

// ===== 通常シフト提出メール処理 =====
async function handleRegularShiftNotification(type: string, submissionId: string) {
  const { data: submission, error: submissionError } = await supabase
    .from('regular_shift_submissions')
    .select('id, teacher_name, teacher_email, submitted_at, notes, setting_id, school_id, edit_token')
    .eq('id', submissionId)
    .single()

  if (submissionError || !submission) {
    console.error('通常シフト提出データ取得エラー:', submissionError)
    throw new Error('Submission not found')
  }

  const { data: setting, error: settingError } = await supabase
    .from('regular_shift_settings')
    .select('id, name')
    .eq('id', submission.setting_id)
    .single()

  if (settingError || !setting) {
    throw new Error('通常シフト設定の取得に失敗')
  }

  const { data: school, error: schoolError } = await supabase
    .from('schools')
    .select('name, notification_email, notification_emails')
    .eq('id', submission.school_id)
    .single()

  if (schoolError || !school) {
    throw new Error('教室情報の取得に失敗')
  }

  // 出勤可能スロットを取得
  const { data: slotsData } = await supabase
    .from('regular_shift_submission_slots')
    .select('day_of_week, time_slot')
    .eq('submission_id', submissionId)
    .eq('available', true)
    .order('day_of_week', { ascending: true })
    .order('time_slot', { ascending: true })

  const submissionSlots = slotsData ?? []
  const availableSlots = submissionSlots.length

  // 曜日ごとにスロットをまとめる
  const dayNames = ['日', '月', '火', '水', '木', '金', '土']
  const slotsByDay: Record<number, string[]> = {}
  for (const row of submissionSlots) {
    const d = row.day_of_week
    if (!slotsByDay[d]) slotsByDay[d] = []
    slotsByDay[d].push(row.time_slot)
  }
  const slotsListHtml = Object.keys(slotsByDay)
    .map(Number)
    .sort((a, b) => a - b)
    .map((dow) => {
      const dayLabel = `${dayNames[dow]}曜日`
      const times = escapeHtml(slotsByDay[dow].join('、'))
      return `<tr><td style="padding: 4px 8px; border-bottom: 1px solid #eee;">${dayLabel}</td><td style="padding: 4px 8px; border-bottom: 1px solid #eee;">${times}</td></tr>`
    })
    .join('')
  const slotsTableHtml =
    slotsListHtml &&
    `<p><strong>■ 出勤可能曜日・時間</strong></p>
     <table style="border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 14px;">
       <thead><tr><th style="text-align: left; padding: 6px 8px; background: #eee;">曜日</th><th style="text-align: left; padding: 6px 8px; background: #eee;">時間帯</th></tr></thead>
       <tbody>${slotsListHtml}</tbody>
     </table>`

  const schoolName = school.name || '教室'
  const settingName = setting.name
  const teacherName = submission.teacher_name
  const teacherEmail = submission.teacher_email ?? ''
  const submittedAt = new Date(submission.submitted_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
  // HTML 用のエスケープ済み値。講師名・備考は未ログインの提出フォームから入るため、
  // タグを仕込まれても教室ドメインのメールに HTML として載らないようにする。
  // 件名（テキスト）と宛先には素の値を使う。
  const hSchoolName = escapeHtml(schoolName)
  const hSettingName = escapeHtml(settingName)
  const hTeacherName = escapeHtml(teacherName)
  const hTeacherEmail = escapeHtml(teacherEmail)
  const hSubmittedAt = escapeHtml(submittedAt)
  const hNotes = escapeHtml(submission.notes)
  // 講師向けメール（提出完了・修正のお願い）は返信が教室に届くようにする。
  // 教室向けの提出通知は教室内の連絡なので返信先を付けない（送信専用のまま）。
  const replyTo = await getSchoolReplyTo(submission.school_id)
  const teacherFooter = replyTo ? replyableFooter(schoolName) : EMAIL_FOOTER

  if (type === 'submitted') {
    // 講師への確認メール
    if (teacherEmail) {
      const teacherSubject = `【${schoolName}】通常シフト提出完了のお知らせ`
      const teacherHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1e3a5f;">通常シフトの提出を受け付けました</h2>
          <p>${hTeacherName} 様</p>
          <p>通常シフトのご提出ありがとうございます。<br>以下の内容で受け付けました。</p>
          <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>■ シフト名：</strong>${hSettingName}</p>
            <p><strong>■ 提出日時：</strong>${hSubmittedAt}</p>
            <p><strong>■ 出勤可能コマ数：</strong>${availableSlots}コマ</p>
            ${slotsTableHtml || ''}
            ${submission.notes ? `<p style="margin-top: 12px;"><strong>■ 備考</strong></p><p style="white-space: pre-wrap;">${hNotes}</p>` : ''}
          </div>
          <p>内容に修正が必要な場合は、教室までご連絡ください。</p>
          <p style="margin-top: 30px; color: #666;">${hSchoolName}</p>
          ${teacherFooter}
        </div>
      `
      await sendEmail(teacherEmail, teacherSubject, teacherHtml, replyTo)
      console.log('通常シフト：講師への提出完了メール送信完了:', teacherEmail)
      await delay(1000)
    }

    // 教室への通知メール
    const shiftRecipients: string[] =
      school.notification_emails && school.notification_emails.length > 0
        ? school.notification_emails
        : school.notification_email ? [school.notification_email] : []

    if (shiftRecipients.length === 0) {
      console.warn(`教室 ${schoolName} に通知先メールが設定されていません`)
    }

    for (const recipient of shiftRecipients) {
      if (!recipient) continue
      const submissionsUrl = `${SITE_URL.replace(/\/$/, '')}/settings/regular-shifts/${submission.setting_id}/submissions`
      const adminSubject = `【通常シフト提出】${teacherName}さんが提出しました`
      const adminHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1e3a5f;">新しい通常シフト提出がありました</h2>
          <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>■ シフト名：</strong>${hSettingName}</p>
            <p><strong>■ 講師名：</strong>${hTeacherName}</p>
            <p><strong>■ メールアドレス：</strong>${hTeacherEmail}</p>
            <p><strong>■ 提出日時：</strong>${hSubmittedAt}</p>
            <p><strong>■ 出勤可能コマ数：</strong>${availableSlots}コマ</p>
            ${slotsTableHtml || ''}
          </div>
          <p><a href="${escapeHtml(submissionsUrl)}" style="display: inline-block; background: #1e3a5f; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">提出一覧を確認</a></p>
          <p style="margin-top: 30px; color: #666;">${hSchoolName}</p>
          ${EMAIL_FOOTER}
        </div>
      `
      await sendEmail(recipient, adminSubject, adminHtml)
      console.log('通常シフト：管理者への通知メール送信完了:', recipient)
      await delay(1000)
    }
  } else if (type === 'allow_edit') {
    const editToken = submission.edit_token
    if (!editToken) {
      throw new Error('修正用トークンが取得できません')
    }
    if (!teacherEmail || !teacherEmail.trim()) {
      throw new Error('講師メールアドレスが登録されていないため、メールを送信できません')
    }
    const editUrl = `${SITE_URL.replace(/\/$/, '')}/regular-shift/${submission.setting_id}/edit/${editToken}`
    const subject = `【${schoolName}】通常シフト修正のお願い`
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1e3a5f;">通常シフトの修正について</h2>
        <p>${hTeacherName} 様</p>
        <p>${hSettingName} の通常シフト内容を修正する必要があるため、下記URLより修正をお願いします。</p>
        <p><a href="${escapeHtml(editUrl)}" style="display: inline-block; background: #1e3a5f; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">シフト修正フォームを開く</a></p>
        <p style="word-break: break-all; font-size: 12px; color: #666;">${escapeHtml(editUrl)}</p>
        <p>※このURLは修正完了後、無効になります。</p>
        <p style="margin-top: 30px; color: #666;">${hSchoolName}</p>
        ${teacherFooter}
      </div>
    `
    await sendEmail(teacherEmail, subject, html, replyTo)
    console.log('通常シフト：修正許可メール送信完了:', teacherEmail)
  } else {
    throw new Error(`不明な type: ${type}`)
  }
}

serve(async (req) => {
  // CORS プリフライト。ブラウザ（ZoukomaEnrollmentFormModal → createFormResponse）からも
  // invoke されるため応答する。以前は OPTIONS を処理しておらずブラウザからの呼び出しは
  // プリフライトで落ちていた（申込メール自体は DB トリガー経由で届いていた）。
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders })
  }

  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), { status, headers: jsonHeaders })

  try {
    // ★呼び出し元の認証（_shared/auth.ts）。以前は誰の呼び出しでも、本文の record を
    // 信じてその内容（宛先 email・生徒名・備考…）でメールを組み立てていたため、公開の
    // anon key だけで任意の宛先へ任意の HTML を教室ドメインから送れた。
    // 通すのは service role（DB トリガー / Next.js サーバールート）と、ログイン中の
    // スタッフ（講師以上。増コマ申込の代理入力画面から呼ばれる）だけ。
    const auth = await authorizeRequest(req, 'teacher', corsHeaders)
    if (!auth.ok) return auth.response
    const isService = auth.kind === 'service'

    const body = (await req.json()) ?? {}

    // シフト提出通知はサーバールート（service role）からしか呼ばれない。
    // ユーザー JWT で任意の submissionId を指定されると、修正依頼メール（allow_edit）などを
    // 他教室の講師へ勝手に送れてしまうため、service role 以外は拒否する。
    if (
      (body.notificationType === 'regular-shift' || body.notificationType === 'seasonal-shift') &&
      !isService
    ) {
      return json({ error: 'この通知はサーバーからのみ送信できます' }, 403)
    }

    // 通常シフト提出通知の場合
    if (body.notificationType === 'regular-shift') {
      const { type, submissionId } = body
      if (!type || !submissionId) {
        return json({ error: 'type と submissionId が必要です' }, 400)
      }
      await handleRegularShiftNotification(type, submissionId)
      return json({ success: true })
    }

    // シフト提出通知の場合
    if (body.notificationType === 'seasonal-shift') {
      const { type, submissionId } = body
      if (!type || !submissionId) {
        return json({ error: 'type と submissionId が必要です' }, 400)
      }
      await handleSeasonalShiftNotification(type, submissionId)
      return json({ success: true })
    }

    // 既存のフォーム通知処理（増コマ申込、模試申込など）
    // DB トリガー: { type, table, schema, record, old_record }（Database Webhook と同形）
    // サーバールート / ブラウザ: { record }
    const bodyRecord = body.record
    const responseId = bodyRecord?.id ?? body.recordId
    // id が無いと二重送信防止（notification_sent_at）が効かず、同じ内容を何度でも
    // 送れてしまうため、id 無しの呼び出しは受け付けない（正規の呼び出し元は必ず id を持つ）。
    if (!responseId || typeof responseId !== 'string' || !UUID_RE.test(responseId)) {
      return json({ error: 'record.id が必要です' }, 400)
    }

    let record = bodyRecord
    if (!isService) {
      // ユーザー JWT の呼び出しでは本文の record を一切信用しない。
      // まず本人の権限（RLS: 教室スコープ）でその行が見えるかを確かめ、見えれば
      // service role で DB から取り直した内容だけを使う。
      if (!SUPABASE_ANON_KEY) {
        console.error('SUPABASE_ANON_KEY が未設定のため、ユーザー権限での確認ができません')
        return json({ error: '認証設定が不正です' }, 500)
      }
      const userClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${auth.token}` } },
      })
      const { data: visible, error: visibleError } = await userClient
        .from('form_responses')
        .select('id')
        .eq('id', responseId)
        .maybeSingle()
      if (visibleError) {
        console.error('form_responses 参照権限の確認エラー:', visibleError)
        return json({ error: '申込データの確認に失敗しました' }, 500)
      }
      if (!visible) {
        return json({ error: '申込データが見つかりません' }, 404)
      }
    }

    // ユーザー JWT の呼び出し、または id だけ渡された呼び出しでは DB の内容を正とする。
    // service role からの record 付き呼び出し（DB トリガー・サーバールート）は従来どおり
    // 本文の record を使う（トリガーの NEW をそのまま送っており、信頼できる経路のため）。
    if (!isService || !bodyRecord) {
      const { data: fresh, error: freshError } = await supabase
        .from('form_responses')
        .select('*')
        .eq('id', responseId)
        .single()
      if (freshError || !fresh) {
        console.error('form_responses 再取得エラー:', freshError)
        return json({ error: '申込データが見つかりません' }, 404)
      }
      record = fresh
    }

    // 二重送信防止：同じ form_response で既に送信済みならメールを送らない。
    // 「未送信なら送信済みにする」を1本の UPDATE で行うので、DB トリガーとブラウザ・
    // サーバーからの呼び出しが同時に来ても送るのは1回だけになる。
    // 存在しない id もここで「更新0件」になり、送信されない。
    {
      const { data: updated, error: updateError } = await supabase
        .from('form_responses')
        .update({ notification_sent_at: new Date().toISOString() })
        .eq('id', responseId)
        .is('notification_sent_at', null)
        .select('id')
        .maybeSingle()

      if (updateError) {
        console.error('notification_sent_at 更新エラー:', updateError)
        throw new Error(`送信済みフラグの更新に失敗: ${updateError.message}`)
      }
      if (!updated) {
        console.log('申込通知は既に送信済みのためスキップ:', responseId)
        return json({ success: true, skipped: true })
      }
    }

    const {
      school_id,
      form_type,
      form_period,
      student_name,
      grade,
      email,
      response_data,
      created_at,
    } = record

    // 教室情報を取得
    const { data: school, error: schoolError } = await supabase
      .from('schools')
      .select('name, notification_email, notification_emails')
      .eq('id', school_id)
      .single()

    if (schoolError || !school) {
      throw new Error(`教室情報の取得に失敗: ${schoolError?.message}`)
    }

    // フォーム期間（対象の模試タイトル・案内文など）を取得（模試申込などでメールにフォーム全内容を含めるため）
    let periodTitle: string | undefined
    let periodSettings: any
    const { data: periodRow } = await supabase
      .from('form_periods')
      .select('title, settings')
      .eq('school_id', school_id)
      .eq('form_type', form_type)
      .eq('period_key', form_period)
      .maybeSingle()
    if (periodRow) {
      periodTitle = periodRow.title
      periodSettings = periodRow.settings ?? undefined
    }

    // 申込者（保護者）向けメールは、返信が教室メールに届くようにする。
    // 教室向けの申込通知は教室内の連絡なので返信先を付けない（送信専用のまま）。
    const replyTo = await getSchoolReplyTo(school_id)

    // 申込者にメール送信
    if (email) {
      const applicantMail = createApplicantEmail(
        school.name,
        form_type,
        student_name,
        grade,
        response_data,
        created_at,
        periodTitle,
        periodSettings,
        replyTo ? replyableFooter(school.name) : EMAIL_FOOTER
      )
      await sendEmail(email, applicantMail.subject, applicantMail.html, replyTo)
      console.log(`申込者メール送信完了: ${email}`)
      await delay(1000)
    }

    // 通知先メールアドレス一覧（notification_emails 配列を優先、なければ旧フィールドでフォールバック）
    const notificationRecipients: string[] =
      school.notification_emails && school.notification_emails.length > 0
        ? school.notification_emails
        : school.notification_email ? [school.notification_email] : []

    if (notificationRecipients.length === 0) {
      console.warn(`教室 ${school.name} に通知先メールが設定されていません`)
    }

    // 通知先全員にメール送信（申込者と同じアドレスは除く）
    for (const recipient of notificationRecipients) {
      if (!recipient || recipient === email) continue
      const managerMail = createManagerEmail(
        form_type,
        student_name,
        grade,
        email,
        response_data,
        created_at,
        form_period,
        periodTitle,
        periodSettings
      )
      await sendEmail(recipient, managerMail.subject, managerMail.html)
      console.log(`通知メール送信完了: ${recipient}`)
      await delay(1000)
    }

    return json({ success: true })
  } catch (error) {
    console.error('メール送信エラー:', error)
    return json({ error: (error as Error).message }, 500)
  }
})
