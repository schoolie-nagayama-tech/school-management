'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Input, Select } from '@/components/ui';
import { fetchClassPeriodsLive, type ClassPeriodItem } from '@/lib/api/class-periods';
import { ToastContainer } from '@/components/ui/Toast';
import {
  PortalFormHeader,
  PortalFormSection,
  PortalFormActions,
  PortalCompletionView,
  PortalErrorBanner,
  PortalPreviewBanner,
  usePortalFormDraft,
} from '@/components/forms/shared';
import type { School } from '@/types/database';
import { validateStudentName } from '@/lib/utils/validation';
import type { YoubiPeriod, YoubiResponseData, YoubiSlot } from '@/types/forms/youbi';
import { submitYoubiResponse } from '@/lib/api/youbi';
import { getSubjects } from '@/lib/api/subjects';
import { YOUBI_GRADE_NAME_TO_NUMBER, YOUBI_GRADE_NUMBER_TO_NAME } from '@/types/forms/youbi';
import { useToast } from '@/hooks/useToast';

/** 代理申込で選ばせる在籍生徒。講師UIのタイピングを増やさないため一覧から選ぶ。 */
export interface YoubiProxyStudent {
  id: string;
  last_name: string;
  first_name: string;
  grade: number | null;
}

/**
 * 代理申込モード。保護者用フォームと同じ中身をそのまま使い、
 * 入口と記録だけを変える（別フォームを作ると設定変更のたびに片方が古くなる）。
 */
export interface YoubiProxyMode {
  /** 選べる在籍生徒（選択中の教室のもの） */
  students: YoubiProxyStudent[];
  /** バナーに出す申込者の表示名（ログイン中の教室長） */
  submitterLabel: string;
  /** 送信できたときに呼ばれる（完了画面ではなくモーダルを閉じて一覧を更新する） */
  onSubmitted: () => void;
  /** キャンセル */
  onCancel: () => void;
}

interface YoubiFormProps {
  school: School;
  period: YoubiPeriod;
  isPreview?: boolean;
  /** 渡すと代理申込になる（保護者からの申込では渡さない） */
  proxy?: YoubiProxyMode;
}

const GRADES = ['小1', '小2', '小3', '小4', '小5', '小6', '中1', '中2', '中3', '高1', '高2', '高3'];

function gradeToCategory(gradeLabel: string): 'elementary' | 'middle' | 'high' | null {
  if (!gradeLabel) return null;
  if (gradeLabel.startsWith('小')) return 'elementary';
  if (gradeLabel.startsWith('中')) return 'middle';
  if (gradeLabel.startsWith('高')) return 'high';
  return null;
}

export function YoubiForm({ school, period, isPreview, proxy }: YoubiFormProps) {
  const isProxy = !!proxy;
  const { toasts, removeToast, success, error } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // 基本情報
  const [studentName, setStudentName] = useState('');
  const [selectedGrade, setSelectedGrade] = useState<string>('');
  const [email, setEmail] = useState('');
  // 代理申込で選んだ在籍生徒。選んだ時点で紐付けまで済ませる（名前一致の推測に頼らない）。
  const [proxyStudentId, setProxyStudentId] = useState('');

  // 現状
  const [current, setCurrent] = useState<YoubiSlot>({
    day: '',
    period: '',
    period_label: '',
    subject: '',
  });

  // 第1希望
  const [request1, setRequest1] = useState<YoubiSlot>({
    day: '',
    period: '',
    period_label: '',
    subject: '',
  });

  // 第2希望
  const [request2, setRequest2] = useState<YoubiSlot>({
    day: '',
    period: '',
    period_label: '',
    subject: '',
  });

  // 変更希望日・備考
  const [changeFrom, setChangeFrom] = useState('');
  const [note, setNote] = useState('');

  // 学年に応じた科目オプション（共通科目を小学/中学/高校で自動参照）
  // value は "科目名|||duration" 形式（同名科目の誤判定防止）
  const [subjectOptionsForGrade, setSubjectOptionsForGrade] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [isLoadingSubjects, setIsLoadingSubjects] = useState(false);

  // バリデーションエラー
  const [errors, setErrors] = useState<Record<string, string>>({});

  // 設定を取得
  const settings = period.settings;

  // 時限はコマ時間マスタ(schedule_time_slots)をライブ参照する。
  // 取得できない場合のみ期間設定のスナップショット(available_periods)にフォールバック。
  const [masterPeriods, setMasterPeriods] = useState<ClassPeriodItem[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchClassPeriodsLive(school.id).then((p) => {
      if (!cancelled) setMasterPeriods(p);
    });
    return () => {
      cancelled = true;
    };
  }, [school.id]);

  // 1・2限（昼の時間帯）はフォームでは対象外のため除外
  const periodOptions = useMemo(() => {
    const base =
      masterPeriods && masterPeriods.length > 0 ? masterPeriods : settings.available_periods;
    return base.filter((p) => p.code !== '1' && p.code !== '2');
  }, [masterPeriods, settings.available_periods]);

  // ドラフト自動保存
  const { clearDraft } = usePortalFormDraft({
    storageKey: `youbi:${school.id}:${period.period_key}`,
    enabled: !isPreview && !isProxy,
    value: { studentName, selectedGrade, email, current, request1, request2, changeFrom, note },
    onRestore: (d) => {
      if (d.studentName) setStudentName(d.studentName);
      if (d.selectedGrade) setSelectedGrade(d.selectedGrade);
      if (d.email) setEmail(d.email);
      if (d.current) setCurrent(d.current);
      if (d.request1) setRequest1(d.request1);
      if (d.request2) setRequest2(d.request2);
      if (d.changeFrom) setChangeFrom(d.changeFrom);
      if (d.note) setNote(d.note);
    },
  });

  // 学年変更時に共通科目を取得（科目設定＝subjects テーブルを常に参照し自動更新）
  useEffect(() => {
    const category = gradeToCategory(selectedGrade);
    if (!category) {
      setSubjectOptionsForGrade([]);
      return;
    }
    setIsLoadingSubjects(true);
    getSubjects(category)
      .then((subjects) => {
        // 小5以上（学年番号5以上）は45分科目を非表示
        const gradeNum = YOUBI_GRADE_NAME_TO_NUMBER[selectedGrade] ?? 0;
        const isGrade5Plus = gradeNum >= 5;
        const displaySubjects = isGrade5Plus
          ? subjects.filter((s) => (s.duration_minutes ?? 90) !== 45)
          : subjects;
        // value に duration を埋め込む → 同名科目が複数あっても正しいdurationを保持
        const options = displaySubjects.map((s) => {
          const dur = s.duration_minutes ?? 90;
          return {
            value: `${s.name}|||${dur}`,
            label: dur === 45 ? `${s.name}（45分）` : s.name,
          };
        });
        setSubjectOptionsForGrade(options);
      })
      .catch(() => {
        setSubjectOptionsForGrade([]);
      })
      .finally(() => setIsLoadingSubjects(false));
  }, [selectedGrade]);

  // 学年を変えたらスロットの科目をクリア
  const prevGradeRef = useRef<string>('');
  useEffect(() => {
    if (prevGradeRef.current !== selectedGrade && selectedGrade) {
      setCurrent((prev) => ({ ...prev, subject: '' }));
      setRequest1((prev) => ({ ...prev, subject: '' }));
      setRequest2((prev) => ({ ...prev, subject: '' }));
      prevGradeRef.current = selectedGrade;
    }
    if (!selectedGrade) prevGradeRef.current = '';
  }, [selectedGrade]);

  const getPeriodLabel = (code: string): string => {
    const base =
      masterPeriods && masterPeriods.length > 0 ? masterPeriods : settings.available_periods;
    return base.find((p) => p.code === code)?.label || code;
  };

  // 学年を数値に変換
  const gradeToNumber = (gradeStr: string): number => {
    return YOUBI_GRADE_NAME_TO_NUMBER[gradeStr] || 0;
  };

  // 日付ラベルを生成
  const formatDateLabel = (dateStr: string): string => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const dow = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
    return `${month}月${day}日（${dow}）〜`;
  };

  // "科目名|||duration" 形式のoption valueをパースするヘルパー
  const parseSubjectOptionValue = (encoded: string): { name: string; duration: number } => {
    const sepIdx = encoded.lastIndexOf('|||');
    if (sepIdx !== -1) {
      return {
        name: encoded.slice(0, sepIdx),
        duration: parseInt(encoded.slice(sepIdx + 3)) || 90,
      };
    }
    return { name: encoded, duration: 90 };
  };

  // スロットの更新
  const updateSlot = (
    slot: YoubiSlot,
    setSlot: (s: YoubiSlot) => void,
    field: keyof YoubiSlot,
    value: string
  ) => {
    const updated = { ...slot, [field]: value };
    // periodが変更されたらperiod_labelも更新
    if (field === 'period') {
      updated.period_label = getPeriodLabel(value);
    }
    // subjectが変更されたら "名前|||duration" をパースして分離
    if (field === 'subject') {
      const { name, duration } = parseSubjectOptionValue(value);
      updated.subject = name;
      updated.duration_minutes = name ? duration : undefined;
    }
    setSlot(updated);
  };

  // スロットのバリデーション
  const validateSlot = (slot: YoubiSlot, label: string): boolean => {
    if (!slot.day) {
      error(`${label}の曜日を選択してください`);
      return false;
    }
    if (!slot.period) {
      error(`${label}の時限を選択してください`);
      return false;
    }
    if (!slot.subject) {
      error(`${label}の科目を選択してください`);
      return false;
    }
    return true;
  };

  // バリデーション
  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (isProxy) {
      // 代理は在籍生徒から選ぶので、名前・学年は選択結果から入る。
      // メールは保護者へ通知しないため取らない。
      if (!proxyStudentId) {
        newErrors.studentName = '生徒を選択してください';
      }
    } else {
      const nameError = validateStudentName(studentName);
      if (nameError) {
        newErrors.studentName = nameError;
      }

      if (!selectedGrade) {
        newErrors.grade = '学年を選択してください';
      }

      if (!email.trim()) {
        newErrors.email = 'メールアドレスを入力してください';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        newErrors.email = '正しいメールアドレスを入力してください';
      }
    }

    if (!validateSlot(current, '現在の通塾情報')) {
      return false;
    }

    if (!validateSlot(request1, '第1希望')) {
      return false;
    }

    if (!validateSlot(request2, '第2希望')) {
      return false;
    }

    if (!changeFrom) {
      newErrors.changeFrom = '変更希望日を入力してください';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // フォーム送信
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    if (isPreview) {
      setErrorMessage('プレビューモードでは送信できません。');
      return;
    }
    if (!validate()) {
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);

    try {
      const responseData: YoubiResponseData = {
        current: {
          ...current,
          period_label: current.period_label || getPeriodLabel(current.period),
        },
        request1: {
          ...request1,
          period_label: request1.period_label || getPeriodLabel(request1.period),
        },
        request2: {
          ...request2,
          period_label: request2.period_label || getPeriodLabel(request2.period),
        },
        change_from: changeFrom,
        change_from_label: formatDateLabel(changeFrom),
        note: note.trim() || undefined,
      };

      await submitYoubiResponse(
        {
          school_id: school.id,
          period_key: period.period_key,
          student_name: studentName.trim(),
          grade: gradeToNumber(selectedGrade),
          email: email.trim(),
          response_data: responseData,
        },
        isProxy ? { linkedStudentId: proxyStudentId || null } : undefined
      );

      clearDraft();
      if (proxy) {
        // 代理は教室長の作業なので完了画面は出さず、呼び出し元（回答一覧）に戻す。
        success('代理で申し込みました');
        proxy.onSubmitted();
        return;
      }
      setIsSubmitted(true);
      success('申請を受け付けました');
    } catch (err) {
      console.error('Failed to submit:', err);
      error(err instanceof Error ? err.message : '送信に失敗しました。もう一度お試しください。');
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  // 送信完了画面
  if (isSubmitted) {
    return (
      <>
        <ToastContainer toasts={toasts} onRemove={removeToast} />
        <PortalCompletionView
          schoolCode={school.code ?? ''}
          title="申請を受け付けました"
          completionMessage={settings.completion_message}
        />
      </>
    );
  }

  // スロット入力UI（共通）
  const renderSlotInput = (
    slot: YoubiSlot,
    setSlot: (s: YoubiSlot) => void,
    label: string,
    highlight?: string,
    required?: boolean
  ) => (
    <div className={`p-4 rounded-lg border ${highlight || 'border-gray-200 bg-gray-50'}`}>
      <p className="text-sm font-medium text-[#1f2937] mb-3">
        {label}
        {required && <span className="text-[color:var(--primary)] ml-1">*</span>}
      </p>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-xs text-[#4b5563]/60 mb-1">曜日</label>
          <Select
            value={slot.day}
            onChange={(e) => updateSlot(slot, setSlot, 'day', e.target.value)}
            options={[
              { value: '', label: '選択' },
              ...settings.available_days.map((d) => ({ value: d, label: d })),
            ]}
            className="text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-[#4b5563]/60 mb-1">時限</label>
          <Select
            value={slot.period}
            onChange={(e) => updateSlot(slot, setSlot, 'period', e.target.value)}
            options={[
              { value: '', label: '選択' },
              ...periodOptions.map((p) => ({
                value: p.code,
                label: p.label,
              })),
            ]}
            className="text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-[#4b5563]/60 mb-1">科目</label>
          <Select
            value={slot.subject ? `${slot.subject}|||${slot.duration_minutes ?? 90}` : ''}
            onChange={(e) => updateSlot(slot, setSlot, 'subject', e.target.value)}
            options={[
              {
                value: '',
                label: selectedGrade
                  ? isLoadingSubjects
                    ? '読み込み中...'
                    : '科目'
                  : '学年を選んでください',
              },
              ...subjectOptionsForGrade,
            ]}
            className="text-sm"
          />
          {slot.subject && slot.duration_minutes === 45 && (
            <span className="mt-1 inline-block text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
              45分授業
            </span>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      {!isProxy && (
        <PortalFormHeader
          eyebrow="曜日変更 申込"
          title={period.title || '曜日変更'}
          description={settings.description}
        />
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {isPreview && <PortalPreviewBanner />}
        {/* 誰の操作として残るのかを、送信する前に見えるところへ出す */}
        {proxy && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-[13px] leading-relaxed text-amber-800">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              保護者の代わりに申し込みます。
              <span className="font-medium">{proxy.submitterLabel}</span>
              が出したものとして記録され、一覧に「代理」と表示されます。保護者への受付メールは送りません。
            </span>
          </div>
        )}
        {errorMessage && <PortalErrorBanner message={errorMessage} />}

        <PortalFormSection title="基本情報">
          <div className="space-y-3">
            {isProxy ? (
              // 代理は在籍生徒から選ぶ。名前を手で打たせない（打ち間違いは紐付かない回答になる）。
              <div>
                <label className="block text-sm font-medium mb-1 text-[#1f2937]">
                  生徒 <span className="text-[color:var(--primary)]">*</span>
                </label>
                <Select
                  value={proxyStudentId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setProxyStudentId(id);
                    const student = proxy?.students.find((s) => s.id === id);
                    setStudentName(student ? `${student.last_name} ${student.first_name}` : '');
                    setSelectedGrade(
                      student?.grade != null
                        ? (YOUBI_GRADE_NUMBER_TO_NAME[student.grade] ?? '')
                        : ''
                    );
                  }}
                  options={[
                    { value: '', label: '選択してください' },
                    ...(proxy?.students ?? []).map((s) => ({
                      value: s.id,
                      label:
                        `${s.grade != null ? (YOUBI_GRADE_NUMBER_TO_NAME[s.grade] ?? '') : ''} ${s.last_name} ${s.first_name}`.trim(),
                    })),
                  ]}
                  className={errors.studentName ? 'border-[color:var(--primary)]' : ''}
                />
                {errors.studentName ? (
                  <p className="text-[color:var(--primary)] text-xs mt-1">{errors.studentName}</p>
                ) : (
                  <p className="text-xs text-[#4b5563] mt-1">
                    選ぶと学年が入り、回答と生徒の紐付けも済みます
                  </p>
                )}
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium mb-1 text-[#1f2937]">
                  生徒名 <span className="text-[color:var(--primary)]">*</span>
                </label>
                <Input
                  type="text"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  placeholder="例：山田 太郎"
                  className={errors.studentName ? 'border-[color:var(--primary)]' : ''}
                />
                {errors.studentName && (
                  <p className="text-[color:var(--primary)] text-xs mt-1">{errors.studentName}</p>
                )}
              </div>
            )}
            {/* 学年・メールは代理では出さない。学年は選んだ生徒から入り、
                メールは保護者へ通知しないので取る意味がない（空欄が並ぶだけになる）。 */}
            {!isProxy && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1 text-[#1f2937]">
                    学年 <span className="text-[color:var(--primary)]">*</span>
                  </label>
                  <Select
                    value={selectedGrade}
                    onChange={(e) => setSelectedGrade(e.target.value)}
                    options={[
                      { value: '', label: '選択してください' },
                      ...GRADES.map((g) => ({ value: g, label: g })),
                    ]}
                    className={errors.grade ? 'border-[color:var(--primary)]' : ''}
                  />
                  {errors.grade && (
                    <p className="text-[color:var(--primary)] text-xs mt-1">{errors.grade}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-[#1f2937]">
                    メールアドレス <span className="text-[color:var(--primary)]">*</span>
                  </label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="example@email.com"
                    className={errors.email ? 'border-[color:var(--primary)]' : ''}
                  />
                  {errors.email && (
                    <p className="text-[color:var(--primary)] text-xs mt-1">{errors.email}</p>
                  )}
                </div>
              </>
            )}
          </div>
        </PortalFormSection>

        <PortalFormSection title="現在の通塾情報">
          {renderSlotInput(current, setCurrent, '現在通っている曜日・時間・科目')}
        </PortalFormSection>

        <PortalFormSection title="変更希望">
          <div className="space-y-3">
            {renderSlotInput(
              request1,
              setRequest1,
              '第1希望',
              'border-[color:var(--primary)] bg-[color:var(--primary-subtle)]'
            )}
            {renderSlotInput(request2, setRequest2, '第2希望', 'border-gray-300 bg-white', true)}
          </div>
        </PortalFormSection>

        <PortalFormSection title="変更希望日">
          <div>
            <label className="block text-sm font-medium mb-1 text-[#1f2937]">
              いつから変更を希望しますか？
            </label>
            <Input
              type="date"
              value={changeFrom}
              onChange={(e) => setChangeFrom(e.target.value)}
              className={errors.changeFrom ? 'border-[color:var(--primary)]' : ''}
            />
            {changeFrom && (
              <p className="text-sm text-[#4b5563] mt-1">→ {formatDateLabel(changeFrom)}</p>
            )}
            {errors.changeFrom && (
              <p className="text-[color:var(--primary)] text-xs mt-1">{errors.changeFrom}</p>
            )}
          </div>
        </PortalFormSection>

        <PortalFormSection title="備考">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="ご要望等あればご記入ください"
            rows={3}
            className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 resize-y text-sm focus:ring-2 focus:ring-[color:var(--primary)] focus:border-[color:var(--primary)]"
          />
        </PortalFormSection>

        <PortalFormActions
          isSubmitting={isSubmitting}
          submitLabel={isProxy ? '代理で申し込む' : '申請する'}
          onReset={proxy ? proxy.onCancel : undefined}
          resetLabel={proxy ? 'キャンセル' : undefined}
        />
      </form>
    </div>
  );
}
