// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const SITE_URL = Deno.env.get('SITE_URL') || 'https://school-management-eight-cyan.vercel.app/'

const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!)

// フォーム種別の日本語名
const FORM_TYPE_LABELS: Record<string, string> = {
  zoukoma: '増コマ申込',
  moshi: '模試申込',
  mogi: 'Vもぎ申込',
  shukaisu: '週回数変更',
  youbi: '曜日変更',
  kyozai: '教材販売',
  soudan: 'お客様相談',
}

// 学年ラベル
const GRADE_LABELS: Record<number, string> = {
  1: '小1', 2: '小2', 3: '小3', 4: '小4', 5: '小5', 6: '小6',
  7: '中1', 8: '中2', 9: '中3',
  10: '高1', 11: '高2', 12: '高3', 13: '既卒',
}

// 送信者（スクールIE）
const EMAIL_FROM = 'スクールIE <noreply@school-ie.com>'
// 全メールの末尾に付ける共通フッター
const EMAIL_FOOTER = '<p style="margin-top: 24px; font-size: 12px; color: #888;">送信専用です。このメールに返信いただいてもお答えできません。</p>'

/** Resend のレート制限（2 req/秒）を超えないよう、送信間に待機する */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// メール送信（429 のときは1回だけリトライ）
async function sendEmail(to: string, subject: string, html: string) {
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
            details += `<li>${subject}: ${count}コマ</li>`
          }
        }
        details += '</ul>'
      }
      if (responseData.total_koma) {
        details += `<p><strong>合計:</strong> ${responseData.total_koma}コマ</p>`
      }
      if (responseData.total_fee) {
        details += `<p><strong>金額:</strong> ${responseData.total_fee.toLocaleString()}円</p>`
      }
      if (responseData.selected_slots?.length > 0) {
        details += '<p><strong>希望日程:</strong></p><ul>'
        for (const slot of responseData.selected_slots) {
          details += `<li>${slot.label}</li>`
        }
        details += '</ul>'
      }
      if (responseData.note) {
        details += `<p><strong>備考:</strong> ${responseData.note}</p>`
      }
      break

    case 'mogi':
      if (responseData.selections?.length > 0) {
        details += '<p><strong>選択した日程・会場:</strong></p><ul>'
        // 会場別の持参物を探すため periodSettings.dates から bring_items を取得
        const venueById: Record<string, any> = {}
        if (periodSettings?.dates) {
          for (const d of periodSettings.dates) {
            for (const v of d.venues ?? []) {
              venueById[v.id] = v
            }
          }
        }
        for (const sel of responseData.selections) {
          const typeLabel = sel.exam_type_label ? `[${sel.exam_type_label}] ` : ''
          const venue = venueById[sel.venue_id]
          const bring = venue?.bring_items ? `<br><span style="font-size:12px;color:#9a3412;">持参物: ${venue.bring_items}</span>` : ''
          details += `<li>${typeLabel}${sel.date_label} - ${sel.venue_label}${bring}</li>`
        }
        details += '</ul>'
      }
      if (responseData.note) {
        details += `<p><strong>備考:</strong> ${responseData.note}</p>`
      }
      break

    case 'moshi':
      if (responseData.exam_type === 'regular') {
        details += `<p><strong>受験方法:</strong> 本試験受験</p>`
        if (periodSettings?.exam_date_label) {
          details += `<p><strong>本試験日:</strong> ${periodSettings.exam_date_label}</p>`
        }
        if (periodSettings?.exam_time) {
          details += `<p><strong>時間:</strong> ${periodSettings.exam_time}</p>`
        }
      } else if (responseData.exam_type === 'furikae') {
        details += `<p><strong>受験方法:</strong> 振替受験</p>`
        if (responseData.furikae_date_label) {
          details += `<p><strong>振替希望日:</strong> ${responseData.furikae_date_label}</p>`
        }
        if (responseData.furikae_time) {
          details += `<p><strong>希望時間:</strong> ${responseData.furikae_time}</p>`
        }
      }
      if (responseData.note) {
        details += `<p><strong>備考:</strong> ${responseData.note}</p>`
      }
      break

    case 'shukaisu':
      if (responseData.change_from_label) {
        details += `<p><strong>変更開始時期:</strong> ${responseData.change_from_label}</p>`
      }
      if (responseData.current?.weekly_count !== undefined) {
        details += `<p><strong>現在の週回数:</strong> ${responseData.current.weekly_count}回</p>`
      }
      if (responseData.current?.slots?.length > 0) {
        details += '<p><strong>現在のコマ:</strong></p><ul>'
        for (const slot of responseData.current.slots) {
          details += `<li>${slot.day} ${slot.period_label} ${slot.subject}</li>`
        }
        details += '</ul>'
      }
      if (responseData.requested?.weekly_count !== undefined) {
        details += `<p><strong>変更後の週回数:</strong> ${responseData.requested.weekly_count}回</p>`
      }
      if (responseData.requested?.slots?.length > 0) {
        details += '<p><strong>希望コマ:</strong></p><ul>'
        for (const slot of responseData.requested.slots) {
          details += `<li>${slot.day} ${slot.period_label} ${slot.subject}</li>`
        }
        details += '</ul>'
      }
      if (responseData.note) {
        details += `<p><strong>備考:</strong> ${responseData.note}</p>`
      }
      break

    case 'youbi':
      if (responseData.change_from_label) {
        details += `<p><strong>変更開始時期:</strong> ${responseData.change_from_label}</p>`
      }
      if (responseData.current) {
        const cur = responseData.current
        details += `<p><strong>現在の曜日・時間:</strong> ${cur.day} ${cur.period_label} ${cur.subject}</p>`
      }
      if (responseData.request1) {
        const r1 = responseData.request1
        details += `<p><strong>第1希望:</strong> ${r1.day} ${r1.period_label} ${r1.subject}</p>`
      }
      if (responseData.request2) {
        const r2 = responseData.request2
        details += `<p><strong>第2希望:</strong> ${r2.day} ${r2.period_label} ${r2.subject}</p>`
      }
      if (responseData.note) {
        details += `<p><strong>備考:</strong> ${responseData.note}</p>`
      }
      break

    case 'kyozai':
      if (responseData.items?.length > 0) {
        details += '<p><strong>選択した教材:</strong></p><ul>'
        for (const item of responseData.items) {
          details += `<li>${item.name} - ${item.price?.toLocaleString()}円</li>`
        }
        details += '</ul>'
      }
      if (responseData.total_price) {
        details += `<p><strong>合計金額:</strong> ${responseData.total_price.toLocaleString()}円</p>`
      }
      if (responseData.note) {
        details += `<p><strong>備考:</strong> ${responseData.note}</p>`
      }
      break

    case 'soudan':
      if (responseData.categories?.length > 0) {
        details += `<p><strong>相談区分:</strong> ${responseData.categories.join('、')}</p>`
      }
      if (responseData.content) {
        details += `<p><strong>相談内容:</strong></p><p style="white-space: pre-wrap;">${responseData.content}</p>`
      }
      if (responseData.phone) {
        details += `<p><strong>電話番号:</strong> ${responseData.phone}</p>`
      }
      break

    default:
      details += `<pre>${JSON.stringify(responseData, null, 2)}</pre>`
  }

  return details
}

// 模試申込用：対象模試の案内ブロック（フォームの全内容＝どの模試か・実施日時・案内文）をHTMLで返す
function formatMoshiContextBlock(periodTitle: string, periodSettings: any): string {
  if (!periodTitle && !periodSettings) return ''
  const parts: string[] = []
  if (periodTitle) {
    parts.push(`<p><strong>対象の模試:</strong> ${periodTitle}</p>`)
  }
  if (periodSettings?.exam_date_label) {
    parts.push(`<p><strong>試験日:</strong> ${periodSettings.exam_date_label}</p>`)
  }
  if (periodSettings?.exam_time) {
    parts.push(`<p><strong>時間:</strong> ${periodSettings.exam_time}</p>`)
  }
  if (periodSettings?.description) {
    parts.push(
      '<p style="margin-top: 12px;"><strong>■ 案内文</strong></p>' +
      `<div style="white-space: pre-wrap; background: #fff; padding: 12px; border-radius: 4px; border: 1px solid #e5e7eb; font-size: 13px; color: #374151;">${escapeHtml(periodSettings.description)}</div>`
    )
  }
  return parts.length ? parts.join('') : ''
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
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
  periodSettings?: any
): { subject: string; html: string } {
  const formTypeLabel = FORM_TYPE_LABELS[formType] || formType
  const gradeLabel = GRADE_LABELS[grade] || `${grade}年`
  const dateStr = new Date(createdAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })

  const subject = `【${schoolName}】${formTypeLabel}のお申し込みを受け付けました`

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
    const tokyoLotteryNote =
      region === 'tokyo'
        ? `<li><strong>会場の確定:</strong> 定員に達し次第、抽選で会場が決まります。抽選に漏れた場合は、進学研究会が近隣の別会場に割り振ります。</li>`
        : ''
    mogiNextStepsBlock = `
      <div style="background: #fff7ed; padding: 16px; border-radius: 8px; margin: 20px 0; border: 1px solid #fed7aa;">
        <h3 style="margin-top: 0; color: #9a3412;">お申し込み後の流れ</h3>
        <ol style="padding-left: 20px; color: #333; line-height: 1.7;">
          ${tokyoLotteryNote}
          <li><strong>受験票のお渡し:</strong> 受験日が近づきましたら、教室から受験票をお渡しします。</li>
          <li><strong>当日の持参物:</strong> 上記の申込内容に記載の持参物をご持参ください（会場ごとに異なる場合があります）。</li>
          <li><strong>結果のお知らせ:</strong> 採点結果は後日教室からお渡しします。</li>
        </ol>
        <p style="font-size: 12px; color: #9a3412; margin-bottom: 0;">
          ※ 申込後のキャンセル・返金はできません。やむを得ない事情がある場合は教室までご相談ください。
        </p>
      </div>
    `
  }

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #ff8e3c;">お申し込み受付完了</h2>
      <p>${studentName} 様</p>
      <p>以下の内容でお申し込みを受け付けました。</p>
      ${moshiContextBlock}
      <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin-top: 0;">申込内容</h3>
        <p><strong>種別:</strong> ${formTypeLabel}</p>
        <p><strong>申込日時:</strong> ${dateStr}</p>
        <p><strong>生徒名:</strong> ${studentName}</p>
        <p><strong>学年:</strong> ${gradeLabel}</p>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 15px 0;">
        <h3>フォームのご記入内容</h3>
        <p style="color: #555; margin-bottom: 12px;">お申し込み時にご記入いただいた内容は以下のとおりです。</p>
        ${formatResponseDetails(formType, responseData, (formType === 'moshi' || formType === 'mogi') ? periodSettings : undefined)}
      </div>
      ${mogiNextStepsBlock}
      <p>ご不明点がございましたら、教室までお問い合わせください。</p>
      ${showGrowLine ? '<p>日程が決まりましたらGrowから確認してください。</p>' : ''}
      <p style="margin-top: 30px; color: #666;">${schoolName}</p>
      ${EMAIL_FOOTER}
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
  const formTypeLabel = FORM_TYPE_LABELS[formType] || formType
  const gradeLabel = GRADE_LABELS[grade] || `${grade}年`
  const dateStr = new Date(createdAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })

  const subject = `【新規申込】${formTypeLabel}がありました`

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
        <p><strong>種別:</strong> ${formTypeLabel}</p>
        <p><strong>申込日時:</strong> ${dateStr}</p>
        <p><strong>生徒名:</strong> ${studentName}</p>
        <p><strong>学年:</strong> ${gradeLabel}</p>
        <p><strong>メールアドレス:</strong> ${email || '未設定'}</p>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 15px 0;">
        <h3>フォームの記入内容</h3>
        ${formatResponseDetails(formType, responseData, (formType === 'moshi' || formType === 'mogi') ? periodSettings : undefined)}
      </div>
      <p>
        <a href="${SITE_URL}/forms/responses/${formType}/${formPeriod}"
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
      const times = slotsByDate[dateStr].join('、')
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

  if (type === 'submitted') {
    if (teacherEmail) {
      const teacherSubject = `【${schoolName}】シフト提出完了のお知らせ`
      const teacherHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #d32f2f;">シフト提出を受け付けました</h2>
          <p>${teacherName} 様</p>
          <p>シフトのご提出ありがとうございます。<br>以下の内容で受け付けました。</p>
          <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>■ 講習期間：</strong>${settingName}</p>
            <p><strong>■ 提出日時：</strong>${submittedAt}</p>
            <p><strong>■ 出勤可能コマ数：</strong>${availableSlots}コマ</p>
            ${slotsTableHtml || ''}
            ${submission.notes ? `<p style="margin-top: 12px;"><strong>■ 備考</strong></p><p style="white-space: pre-wrap;">${submission.notes}</p>` : ''}
          </div>
          <p>内容に修正が必要な場合は、教室までご連絡ください。</p>
          <p style="margin-top: 30px; color: #666;">${schoolName}</p>
          ${EMAIL_FOOTER}
        </div>
      `
      await sendEmail(teacherEmail, teacherSubject, teacherHtml)
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
            <p><strong>■ 講習期間：</strong>${settingName}</p>
            <p><strong>■ 講師名：</strong>${teacherName}</p>
            <p><strong>■ メールアドレス：</strong>${teacherEmail}</p>
            <p><strong>■ 提出日時：</strong>${submittedAt}</p>
            <p><strong>■ 出勤可能コマ数：</strong>${availableSlots}コマ</p>
          </div>
          <p><a href="${submissionsUrl}" style="display: inline-block; background: #1e3a5f; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">提出一覧を確認</a></p>
          <p style="margin-top: 30px; color: #666;">${schoolName}</p>
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
          <p>${teacherName} 様</p>
          <p>${settingName} のシフト内容を修正する必要があるため、下記URLより修正をお願いします。</p>
          <p><a href="${editUrl}" style="display: inline-block; background: #1e3a5f; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">シフト修正フォームを開く</a></p>
          <p style="word-break: break-all; font-size: 12px; color: #666;">${editUrl}</p>
          <p>※このURLは修正完了後、無効になります。</p>
          <p style="margin-top: 30px; color: #666;">${schoolName}</p>
          ${EMAIL_FOOTER}
        </div>
      `
      await sendEmail(teacherEmail, subject, html)
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
      const times = slotsByDay[dow].join('、')
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

  if (type === 'submitted') {
    // 講師への確認メール
    if (teacherEmail) {
      const teacherSubject = `【${schoolName}】通常シフト提出完了のお知らせ`
      const teacherHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1e3a5f;">通常シフトの提出を受け付けました</h2>
          <p>${teacherName} 様</p>
          <p>通常シフトのご提出ありがとうございます。<br>以下の内容で受け付けました。</p>
          <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>■ シフト名：</strong>${settingName}</p>
            <p><strong>■ 提出日時：</strong>${submittedAt}</p>
            <p><strong>■ 出勤可能コマ数：</strong>${availableSlots}コマ</p>
            ${slotsTableHtml || ''}
            ${submission.notes ? `<p style="margin-top: 12px;"><strong>■ 備考</strong></p><p style="white-space: pre-wrap;">${submission.notes}</p>` : ''}
          </div>
          <p>内容に修正が必要な場合は、教室までご連絡ください。</p>
          <p style="margin-top: 30px; color: #666;">${schoolName}</p>
          ${EMAIL_FOOTER}
        </div>
      `
      await sendEmail(teacherEmail, teacherSubject, teacherHtml)
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
            <p><strong>■ シフト名：</strong>${settingName}</p>
            <p><strong>■ 講師名：</strong>${teacherName}</p>
            <p><strong>■ メールアドレス：</strong>${teacherEmail}</p>
            <p><strong>■ 提出日時：</strong>${submittedAt}</p>
            <p><strong>■ 出勤可能コマ数：</strong>${availableSlots}コマ</p>
            ${slotsTableHtml || ''}
          </div>
          <p><a href="${submissionsUrl}" style="display: inline-block; background: #1e3a5f; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">提出一覧を確認</a></p>
          <p style="margin-top: 30px; color: #666;">${schoolName}</p>
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
        <p>${teacherName} 様</p>
        <p>${settingName} の通常シフト内容を修正する必要があるため、下記URLより修正をお願いします。</p>
        <p><a href="${editUrl}" style="display: inline-block; background: #1e3a5f; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">シフト修正フォームを開く</a></p>
        <p style="word-break: break-all; font-size: 12px; color: #666;">${editUrl}</p>
        <p>※このURLは修正完了後、無効になります。</p>
        <p style="margin-top: 30px; color: #666;">${schoolName}</p>
        ${EMAIL_FOOTER}
      </div>
    `
    await sendEmail(teacherEmail, subject, html)
    console.log('通常シフト：修正許可メール送信完了:', teacherEmail)
  } else {
    throw new Error(`不明な type: ${type}`)
  }
}

serve(async (req) => {
  try {
    const body = await req.json()

    // 通常シフト提出通知の場合
    if (body.notificationType === 'regular-shift') {
      const { type, submissionId } = body
      if (!type || !submissionId) {
        return new Response(
          JSON.stringify({ error: 'type と submissionId が必要です' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }
      await handleRegularShiftNotification(type, submissionId)
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // シフト提出通知の場合
    if (body.notificationType === 'seasonal-shift') {
      const { type, submissionId } = body
      if (!type || !submissionId) {
        return new Response(
          JSON.stringify({ error: 'type と submissionId が必要です' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }
      await handleSeasonalShiftNotification(type, submissionId)
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // 既存のフォーム通知処理（増コマ申込、模試申込など）
    const { record } = body
    const responseId = record?.id

    // 二重送信防止：同じ form_response で既に送信済みならメールを送らない
    if (responseId) {
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
        return new Response(JSON.stringify({ success: true, skipped: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
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
        periodSettings
      )
      await sendEmail(email, applicantMail.subject, applicantMail.html)
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

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('メール送信エラー:', error)
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
