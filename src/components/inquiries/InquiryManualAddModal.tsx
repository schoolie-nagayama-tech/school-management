'use client';

/**
 * 電話・直来など、本部HPに元データが無い問合せを
 * まっさらから手入力して登録するモーダル。
 *
 * バリデーション条件:
 *  - 教室・受付日 は必須
 *  - 電話 または メールアドレス のどちらか必須
 *  - 保護者氏名 または 生徒氏名 のどちらか必須
 */

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { createInquiry } from '@/lib/api/inquiries';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import type { Inquiry } from '@/types/database';

// ============================================================
// 選択肢定数
// ============================================================

/** 学年選択肢（空＝未選択可） */
const GRADE_OPTIONS = [
  '小1',
  '小2',
  '小3',
  '小4',
  '小5',
  '小6',
  '中1',
  '中2',
  '中3',
  '高1',
  '高2',
  '高3',
  '既卒',
] as const;

/** 媒体選択肢 */
const MEDIA_OPTIONS = [
  '電話',
  '直来',
  '友人紹介',
  '兄弟姉妹',
  'チラシ',
  '看板・外パンフ',
  '本部HP',
  '塾ナビ',
  '塾シル',
  '塾選',
  'Ameba塾探し',
  'その他',
] as const;

/** 申込内容選択肢 */
const REQUEST_TYPE_OPTIONS = [
  '資料請求',
  '無料体験授業',
  '学習相談・教室見学',
  '講習',
  'その他',
] as const;

/** 性別選択肢 */
const GENDER_OPTIONS = [
  { value: '不明', label: '不明' },
  { value: '男', label: '男' },
  { value: '女', label: '女' },
] as const;

// ============================================================
// フォーム状態型
// ============================================================

interface FormState {
  schoolId: string;
  inquiredAt: string; // YYYY-MM-DD
  guardianName: string;
  guardianNameKana: string;
  studentName: string;
  studentNameKana: string;
  grade: string; // 空 = 未選択
  gender: string;
  phone: string;
  email: string;
  media: string;
  requestType: string;
  initialMessage: string;
}

/** 今日の日付を YYYY-MM-DD 形式で返す（JST） */
function todayJst(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

// ============================================================
// Props
// ============================================================

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** 教室選択肢一覧 */
  schools: { id: string; name: string }[];
  /** 初期選択する教室ID（"all" 以外の選択中教室） */
  defaultSchoolId?: string;
  /** 登録成功後に呼ばれるコールバック */
  onCreated: (inquiry: Inquiry) => void;
}

// ============================================================
// コンポーネント
// ============================================================

export function InquiryManualAddModal({
  isOpen,
  onClose,
  schools,
  defaultSchoolId,
  onCreated,
}: Props) {
  // ---- フォーム初期値 ----
  const initialForm = (): FormState => ({
    schoolId: defaultSchoolId ?? schools[0]?.id ?? '',
    inquiredAt: todayJst(),
    guardianName: '',
    guardianNameKana: '',
    studentName: '',
    studentNameKana: '',
    grade: '',
    gender: '不明',
    phone: '',
    email: '',
    media: '電話',
    requestType: '学習相談・教室見学',
    initialMessage: '',
  });

  const [form, setForm] = useState<FormState>(initialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // バリデーションエラーメッセージ（null = エラーなし）
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // モーダルが開くたびにフォームをリセットする
  useEffect(() => {
    if (isOpen) {
      setForm(initialForm());
      setValidationErrors([]);
    }
    // initialForm は安定参照にしないため依存配列から除外
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, defaultSchoolId, schools]);

  // ---- 入力ハンドラ（汎用） ----
  const handleChange = (field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    // 入力があったらエラーをクリア
    if (validationErrors.length > 0) setValidationErrors([]);
  };

  // ---- バリデーション ----
  const validate = (): string[] => {
    const errors: string[] = [];
    if (!form.schoolId) errors.push('教室を選択してください');
    if (!form.inquiredAt) errors.push('受付日を入力してください');
    if (!form.phone && !form.email)
      errors.push('電話番号またはメールアドレスのどちらかを入力してください');
    if (!form.guardianName && !form.studentName)
      errors.push('保護者氏名または生徒氏名のどちらかを入力してください');
    return errors;
  };

  // ---- 送信処理 ----
  const handleSubmit = async () => {
    const errors = validate();
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setIsSubmitting(true);
    try {
      // 受付日を JST 0:00:00 の ISO 文字列に変換して保存
      const inquiredAtIso = `${form.inquiredAt}T00:00:00+09:00`;

      const created = await createInquiry({
        school_id: form.schoolId,
        inquired_at: inquiredAtIso,
        status: 'in_progress',
        guardian_name: form.guardianName || null,
        guardian_name_kana: form.guardianNameKana || null,
        student_name: form.studentName || null,
        student_name_kana: form.studentNameKana || null,
        grade: form.grade || null,
        gender: form.gender || null,
        phone: form.phone || null,
        email: form.email || null,
        media: form.media || null,
        // channel: 手入力の場合は媒体と同一（導線=手入力自体）
        channel: form.media || null,
        request_type: form.requestType || null,
        initial_message: form.initialMessage || null,
      });

      toast.success('問合せを追加しました');
      onCreated(created);
      onClose();
    } catch (err) {
      toast.error(getUserErrorMessage(err, '追加に失敗しました'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // ============================================================
  // 共通スタイル（既存ページと揃える）
  // ============================================================

  const labelCls = 'block text-xs font-medium text-text-heading mb-1';
  const inputCls =
    'w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-gray-400';
  const selectCls = inputCls;

  // ============================================================
  // 描画
  // ============================================================

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="問合せを手入力で追加" size="lg">
      <div className="space-y-5">
        {/* ---- バリデーションエラー ---- */}
        {validationErrors.length > 0 && (
          <div className="p-3 bg-danger/10 border border-danger/40 rounded-lg">
            <ul className="space-y-0.5">
              {validationErrors.map((msg, i) => (
                <li key={i} className="text-sm text-danger">
                  {msg}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ---- 教室・受付日 ---- */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>
              教室 <span className="text-danger">*</span>
            </label>
            <select
              value={form.schoolId}
              onChange={(e) => handleChange('schoolId', e.target.value)}
              className={selectCls}
            >
              {schools.length === 0 && <option value="">（教室が見つかりません）</option>}
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>
              受付日 <span className="text-danger">*</span>
            </label>
            <input
              type="date"
              value={form.inquiredAt}
              onChange={(e) => handleChange('inquiredAt', e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        {/* ---- 保護者氏名 ---- */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>保護者氏名</label>
            <input
              type="text"
              value={form.guardianName}
              onChange={(e) => handleChange('guardianName', e.target.value)}
              placeholder="例: 山田 花子"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>保護者氏名カナ</label>
            <input
              type="text"
              value={form.guardianNameKana}
              onChange={(e) => handleChange('guardianNameKana', e.target.value)}
              placeholder="例: ヤマダ ハナコ"
              className={inputCls}
            />
          </div>
        </div>

        {/* ---- 生徒氏名 ---- */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>生徒氏名</label>
            <input
              type="text"
              value={form.studentName}
              onChange={(e) => handleChange('studentName', e.target.value)}
              placeholder="例: 山田 太郎"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>生徒氏名カナ</label>
            <input
              type="text"
              value={form.studentNameKana}
              onChange={(e) => handleChange('studentNameKana', e.target.value)}
              placeholder="例: ヤマダ タロウ"
              className={inputCls}
            />
          </div>
        </div>

        {/* ---- 学年・性別 ---- */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>学年</label>
            <select
              value={form.grade}
              onChange={(e) => handleChange('grade', e.target.value)}
              className={selectCls}
            >
              <option value="">未選択</option>
              {GRADE_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>性別</label>
            <select
              value={form.gender}
              onChange={(e) => handleChange('gender', e.target.value)}
              className={selectCls}
            >
              {GENDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ---- 連絡先（電話・メール） ---- */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>
              電話 <span className="text-text-muted text-xs">（電話かメールどちらか必須）</span>
            </label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => handleChange('phone', e.target.value)}
              placeholder="例: 090-1234-5678"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>メールアドレス</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => handleChange('email', e.target.value)}
              placeholder="例: yamada@example.com"
              className={inputCls}
            />
          </div>
        </div>

        {/* ---- 媒体・申込内容 ---- */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>媒体</label>
            <select
              value={form.media}
              onChange={(e) => handleChange('media', e.target.value)}
              className={selectCls}
            >
              {MEDIA_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>申込内容</label>
            <select
              value={form.requestType}
              onChange={(e) => handleChange('requestType', e.target.value)}
              className={selectCls}
            >
              {REQUEST_TYPE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ---- ご質問・ご要望 ---- */}
        <div>
          <label className={labelCls}>ご質問・ご要望</label>
          <textarea
            value={form.initialMessage}
            onChange={(e) => handleChange('initialMessage', e.target.value)}
            placeholder="電話でのヒアリング内容・備考など"
            rows={3}
            className={`${inputCls} resize-none`}
          />
        </div>

        {/* ---- アクション ---- */}
        <div className="flex items-center justify-end gap-3 pt-1 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
          >
            キャンセル
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            isLoading={isSubmitting}
          >
            {isSubmitting ? '追加中...' : '追加する'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
