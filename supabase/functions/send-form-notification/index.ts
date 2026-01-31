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

// メール送信
async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: 'school-ie <noreply@school-ie.com>',
      to: [to],
      subject,
      html,
    }),
  })

  if (!res.ok) {
    const error = await res.text()
    throw new Error(`メール送信失敗: ${error}`)
  }

  return res.json()
}

// 申込詳細をHTMLに変換
function formatResponseDetails(formType: string, responseData: any): string {
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
        for (const sel of responseData.selections) {
          details += `<li>${sel.date_label} - ${sel.venue_label}</li>`
        }
        details += '</ul>'
      }
      if (responseData.note) {
        details += `<p><strong>備考:</strong> ${responseData.note}</p>`
      }
      break

    case 'moshi':
      if (responseData.selections?.length > 0) {
        details += '<p><strong>選択した模試:</strong></p><ul>'
        for (const sel of responseData.selections) {
          details += `<li>${sel.exam_label} - ${sel.date_label} - ${sel.venue_label}</li>`
        }
        details += '</ul>'
      }
      if (responseData.note) {
        details += `<p><strong>備考:</strong> ${responseData.note}</p>`
      }
      break

    case 'shukaisu':
      if (responseData.current_count !== undefined) {
        details += `<p><strong>現在の週回数:</strong> ${responseData.current_count}回</p>`
      }
      if (responseData.new_count !== undefined) {
        details += `<p><strong>変更後の週回数:</strong> ${responseData.new_count}回</p>`
      }
      if (responseData.reason) {
        details += `<p><strong>変更理由:</strong> ${responseData.reason}</p>`
      }
      if (responseData.note) {
        details += `<p><strong>備考:</strong> ${responseData.note}</p>`
      }
      break

    case 'youbi':
      if (responseData.current_days) {
        details += `<p><strong>現在の曜日:</strong> ${responseData.current_days}</p>`
      }
      if (responseData.new_days) {
        details += `<p><strong>変更後の曜日:</strong> ${responseData.new_days}</p>`
      }
      if (responseData.reason) {
        details += `<p><strong>変更理由:</strong> ${responseData.reason}</p>`
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
      if (responseData.category) {
        details += `<p><strong>相談カテゴリ:</strong> ${responseData.category}</p>`
      }
      if (responseData.content) {
        details += `<p><strong>相談内容:</strong></p><p style="white-space: pre-wrap;">${responseData.content}</p>`
      }
      break

    default:
      details += `<pre>${JSON.stringify(responseData, null, 2)}</pre>`
  }

  return details
}

// 申込者向けメール作成
function createApplicantEmail(
  schoolName: string,
  formType: string,
  studentName: string,
  grade: number,
  responseData: any,
  createdAt: string
): { subject: string; html: string } {
  const formTypeLabel = FORM_TYPE_LABELS[formType] || formType
  const gradeLabel = GRADE_LABELS[grade] || `${grade}年`
  const dateStr = new Date(createdAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })

  const subject = `【${schoolName}】${formTypeLabel}のお申し込みを受け付けました`

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #ff8e3c;">お申し込み受付完了</h2>
      <p>${studentName} 様</p>
      <p>以下の内容でお申し込みを受け付けました。</p>
      <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin-top: 0;">申込内容</h3>
        <p><strong>種別:</strong> ${formTypeLabel}</p>
        <p><strong>申込日時:</strong> ${dateStr}</p>
        <p><strong>生徒名:</strong> ${studentName}</p>
        <p><strong>学年:</strong> ${gradeLabel}</p>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 15px 0;">
        <h3>詳細</h3>
        ${formatResponseDetails(formType, responseData)}
      </div>
      <p>ご不明点がございましたら、教室までお問い合わせください。</p>
      <p style="margin-top: 30px; color: #666;">${schoolName}</p>
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
  formPeriod: string
): { subject: string; html: string } {
  const formTypeLabel = FORM_TYPE_LABELS[formType] || formType
  const gradeLabel = GRADE_LABELS[grade] || `${grade}年`
  const dateStr = new Date(createdAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })

  const subject = `【新規申込】${formTypeLabel}がありました`

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #ff8e3c;">新しい申込がありました</h2>
      <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin-top: 0;">申込情報</h3>
        <p><strong>種別:</strong> ${formTypeLabel}</p>
        <p><strong>申込日時:</strong> ${dateStr}</p>
        <p><strong>生徒名:</strong> ${studentName}</p>
        <p><strong>学年:</strong> ${gradeLabel}</p>
        <p><strong>メールアドレス:</strong> ${email || '未設定'}</p>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 15px 0;">
        <h3>詳細</h3>
        ${formatResponseDetails(formType, responseData)}
      </div>
      <p>
        <a href="${SITE_URL}/forms/responses/${formType}/${formPeriod}" 
           style="display: inline-block; background: #ff8e3c; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
          管理画面で確認
        </a>
      </p>
    </div>
  `

  return { subject, html }
}

serve(async (req) => {
  try {
    const { record } = await req.json()

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
      .select('name, notification_email')
      .eq('id', school_id)
      .single()

    if (schoolError || !school) {
      throw new Error(`教室情報の取得に失敗: ${schoolError?.message}`)
    }

    // 申込者にメール送信
    if (email) {
      const applicantMail = createApplicantEmail(
        school.name,
        form_type,
        student_name,
        grade,
        response_data,
        created_at
      )
      await sendEmail(email, applicantMail.subject, applicantMail.html)
      console.log(`申込者メール送信完了: ${email}`)
    }

    // 教室長にメール送信
    if (school.notification_email) {
      const managerMail = createManagerEmail(
        form_type,
        student_name,
        grade,
        email,
        response_data,
        created_at,
        form_period
      )
      await sendEmail(school.notification_email, managerMail.subject, managerMail.html)
      console.log(`教室長メール送信完了: ${school.notification_email}`)
    } else {
      console.warn(`教室 ${school.name} に通知先メールが設定されていません`)
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('メール送信エラー:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})