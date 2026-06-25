'use client';

import { useState } from 'react';

/**
 * 学年の選択肢（小1〜高3＋既卒）
 */
const GRADE_OPTIONS = [
  { value: '', label: '学年を選択してください' },
  { value: '小1', label: '小学1年生' },
  { value: '小2', label: '小学2年生' },
  { value: '小3', label: '小学3年生' },
  { value: '小4', label: '小学4年生' },
  { value: '小5', label: '小学5年生' },
  { value: '小6', label: '小学6年生' },
  { value: '中1', label: '中学1年生' },
  { value: '中2', label: '中学2年生' },
  { value: '中3', label: '中学3年生' },
  { value: '高1', label: '高校1年生' },
  { value: '高2', label: '高校2年生' },
  { value: '高3', label: '高校3年生' },
  { value: '既卒', label: '既卒（浪人）' },
];

/**
 * ご希望の選択肢
 */
const REQUEST_TYPE_OPTIONS = [
  { value: '', label: 'ご希望を選択してください' },
  { value: '資料請求', label: '資料請求' },
  { value: '無料体験授業', label: '無料体験授業' },
  { value: '学習相談・教室見学', label: '学習相談・教室見学' },
  { value: 'その他', label: 'その他' },
];

interface InquiryFormProps {
  schoolCode: string;
  schoolName: string;
  src: string;
}

type FormState = 'idle' | 'submitting' | 'done' | 'error';

/**
 * 公開問合せフォーム（Client Component）。
 * スパム対策:
 *   - ハニーポット: _hp という hidden input を含める（値が入ったらサーバー側で破棄）
 *   - 連打防止: 送信中は submit ボタンを disabled にする
 */
export default function InquiryForm({ schoolCode, schoolName, src }: InquiryFormProps) {
  const [formState, setFormState] = useState<FormState>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  // フォーム入力値
  const [guardianName, setGuardianName] = useState('');
  const [guardianKana, setGuardianKana] = useState('');
  const [studentName, setStudentName] = useState('');
  const [grade, setGrade] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [requestType, setRequestType] = useState('');
  const [message, setMessage] = useState('');

  // ---- クライアント側バリデーション ----
  function validate(): string | null {
    if (!guardianName.trim()) return '保護者氏名を入力してください';
    if (!phone.trim() && !email.trim())
      return '電話番号またはメールアドレスのいずれかを入力してください';
    return null;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const validationError = validate();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setFormState('submitting');
    setErrorMessage('');

    // ハニーポット値を formData から取得（ブラウザのオートフィルに乗らないよう name は意味のなさそうな名前にする）
    const formEl = e.currentTarget;
    const hpValue = (formEl.elements.namedItem('_hp') as HTMLInputElement | null)?.value ?? '';

    try {
      const res = await fetch('/api/inquiry-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schoolCode,
          guardianName,
          guardianKana,
          studentName,
          grade,
          phone,
          email,
          requestType,
          message,
          src,
          _hp: hpValue,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? '送信に失敗しました');
      }

      setFormState('done');
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : '送信に失敗しました。もう一度お試しください。';
      setErrorMessage(msg);
      setFormState('error');
    }
  }

  // ---- 送信完了画面 ----
  if (formState === 'done') {
    return (
      // 送信完了カード: stagger-item で軽くフェードイン
      <div className="stagger-item bg-white rounded-2xl border border-[#e5e7eb] p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-7 h-7 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-[#1a1a1a] mb-2">お問い合わせありがとうございます</h2>
        <p className="text-sm text-[#6b7280] leading-relaxed">
          担当者よりご連絡いたします。
          <br />
          しばらくお待ちください。
        </p>
        <p className="mt-4 text-xs text-[#9ca3af]">{schoolName}</p>
      </div>
    );
  }

  // ---- フォーム ----
  const isSubmitting = formState === 'submitting';

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {/* ハニーポット — display:none では bot に見破られやすいので opacity+position で隠す */}
      <div
        style={{ opacity: 0, position: 'absolute', left: '-9999px', height: 0, overflow: 'hidden' }}
        aria-hidden="true"
      >
        <label htmlFor="_hp">お名前（入力不要）</label>
        <input type="text" id="_hp" name="_hp" tabIndex={-1} autoComplete="off" />
      </div>

      {/* エラーメッセージ */}
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <p className="text-sm text-red-700">{errorMessage}</p>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-[#e5e7eb] p-5 space-y-4">
        {/* 保護者氏名（必須） */}
        <div>
          <label className="block text-sm font-medium text-[#374151] mb-1.5">
            保護者氏名
            <span className="ml-1.5 text-xs font-normal text-white bg-red-500 rounded px-1.5 py-0.5">
              必須
            </span>
          </label>
          <input
            type="text"
            value={guardianName}
            onChange={(e) => setGuardianName(e.target.value)}
            placeholder="山田 花子"
            maxLength={100}
            required
            className="w-full px-4 py-3 border border-[#d1d5db] rounded-xl text-sm text-[#1a1a1a] placeholder:text-[#9ca3af] focus:outline-none focus:ring-2 focus:ring-[#1a1a1a] focus:border-transparent transition-shadow"
          />
        </div>

        {/* 保護者氏名カナ */}
        <div>
          <label className="block text-sm font-medium text-[#374151] mb-1.5">
            保護者氏名（カナ）
          </label>
          <input
            type="text"
            value={guardianKana}
            onChange={(e) => setGuardianKana(e.target.value)}
            placeholder="ヤマダ ハナコ"
            maxLength={100}
            className="w-full px-4 py-3 border border-[#d1d5db] rounded-xl text-sm text-[#1a1a1a] placeholder:text-[#9ca3af] focus:outline-none focus:ring-2 focus:ring-[#1a1a1a] focus:border-transparent transition-shadow"
          />
        </div>

        {/* 生徒氏名 */}
        <div>
          <label className="block text-sm font-medium text-[#374151] mb-1.5">お子様の氏名</label>
          <input
            type="text"
            value={studentName}
            onChange={(e) => setStudentName(e.target.value)}
            placeholder="山田 太郎"
            maxLength={100}
            className="w-full px-4 py-3 border border-[#d1d5db] rounded-xl text-sm text-[#1a1a1a] placeholder:text-[#9ca3af] focus:outline-none focus:ring-2 focus:ring-[#1a1a1a] focus:border-transparent transition-shadow"
          />
        </div>

        {/* 学年 */}
        <div>
          <label className="block text-sm font-medium text-[#374151] mb-1.5">学年</label>
          <select
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            className="w-full px-4 py-3 border border-[#d1d5db] rounded-xl text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#1a1a1a] focus:border-transparent transition-shadow bg-white"
          >
            {GRADE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[#e5e7eb] p-5 space-y-4">
        {/* 電話番号 */}
        <div>
          <label className="block text-sm font-medium text-[#374151] mb-1.5">
            電話番号
            <span className="ml-1.5 text-xs font-normal text-[#6b7280]">
              ※電話かメール、どちらか必須
            </span>
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="090-1234-5678"
            maxLength={20}
            className="w-full px-4 py-3 border border-[#d1d5db] rounded-xl text-sm text-[#1a1a1a] placeholder:text-[#9ca3af] focus:outline-none focus:ring-2 focus:ring-[#1a1a1a] focus:border-transparent transition-shadow"
          />
        </div>

        {/* メールアドレス */}
        <div>
          <label className="block text-sm font-medium text-[#374151] mb-1.5">メールアドレス</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="example@email.com"
            maxLength={200}
            className="w-full px-4 py-3 border border-[#d1d5db] rounded-xl text-sm text-[#1a1a1a] placeholder:text-[#9ca3af] focus:outline-none focus:ring-2 focus:ring-[#1a1a1a] focus:border-transparent transition-shadow"
          />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[#e5e7eb] p-5 space-y-4">
        {/* ご希望 */}
        <div>
          <label className="block text-sm font-medium text-[#374151] mb-1.5">ご希望</label>
          <select
            value={requestType}
            onChange={(e) => setRequestType(e.target.value)}
            className="w-full px-4 py-3 border border-[#d1d5db] rounded-xl text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#1a1a1a] focus:border-transparent transition-shadow bg-white"
          >
            {REQUEST_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* ご質問ご要望 */}
        <div>
          <label className="block text-sm font-medium text-[#374151] mb-1.5">ご質問・ご要望</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="ご自由にご記入ください"
            maxLength={2000}
            rows={4}
            className="w-full px-4 py-3 border border-[#d1d5db] rounded-xl text-sm text-[#1a1a1a] placeholder:text-[#9ca3af] focus:outline-none focus:ring-2 focus:ring-[#1a1a1a] focus:border-transparent transition-shadow resize-none"
          />
          <p className="text-right text-xs text-[#9ca3af] mt-1">{message.length}/2000</p>
        </div>
      </div>

      {/* 送信ボタン */}
      <button
        type="submit"
        disabled={isSubmitting}
        className={`w-full py-4 rounded-xl text-base font-bold transition-[transform,background-color,opacity] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] ${
          isSubmitting
            ? 'bg-[#9ca3af] text-white cursor-not-allowed'
            : 'bg-[#1a1a1a] text-white hover:bg-[#374151] active:scale-[0.97]'
        }`}
      >
        {isSubmitting ? '送信中...' : '送信する'}
      </button>

      <p className="text-center text-xs text-[#9ca3af] pb-2">送信後、担当者よりご連絡いたします</p>
    </form>
  );
}
