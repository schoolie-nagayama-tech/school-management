'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AlertItem, SENSITIVE_ALERT_ICONS, MASKED_ALERT_LABEL_OVERRIDES } from './AlertItem';
import {
  getAlertsLight,
  getAlertsHeavy,
  mergeStudentAlerts,
  invalidateAlertCache,
} from '@/lib/api/alerts';
import type { StudentAlerts, Alert } from '@/types/alerts';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterData } from '@/contexts/MasterDataContext';
import { useToast } from '@/hooks/useToast';
import { GRADE_LABELS } from '@/types/database';
import { ChevronDown, ChevronUp, Info, AlertTriangle, X } from 'lucide-react';
import { InlineLoading } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { dismissAlert } from '@/lib/api/alerts';
import {
  ALERT_TYPE_LABELS,
  ALERT_TYPE_COLORS,
  DISMISSABLE_ALERT_TYPES,
  SENSITIVE_ALERT_TYPES,
  TEACHER_HIDDEN_ALERT_TYPES,
} from '@/types/alerts';
import type { AlertType } from '@/types/alerts';
import { whenNetworkIdle } from '@/lib/utils/networkIdle';

import type { AlertInitialData } from '@/lib/api/alert-server';

interface AlertBoardProps {
  className?: string;
  /**
   * サーバーコンポーネントで事前取得した初期データ（Phase3: SSRストリーミング）。
   * 渡された場合は初回のクライアント fetch をスキップし、ハイドレーション後の
   * 「fetchが始まるまでの空白」を無くす。Light アラートのみ事前取得済みで、
   * Heavy アラートは引き続きクライアント側で whenNetworkIdle() 後に遅延取得される。
   * 教室切替・対応済み操作などの再取得は従来通り。
   * 未指定なら従来どおりマウント時にクライアントで取得する（既存呼び出しと完全互換）。
   */
  initialData?: AlertInitialData;
}

const SCHOOL_COLORS = [
  { bg: 'bg-sky-100', text: 'text-sky-700', border: 'border-sky-200' },
  { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200' },
  { bg: 'bg-violet-100', text: 'text-violet-700', border: 'border-violet-200' },
  { bg: 'bg-rose-100', text: 'text-rose-700', border: 'border-rose-200' },
  { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-200' },
  { bg: 'bg-teal-100', text: 'text-teal-700', border: 'border-teal-200' },
  { bg: 'bg-fuchsia-100', text: 'text-fuchsia-700', border: 'border-fuchsia-200' },
  { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200' },
] as const;

export function AlertBoard({ className = '', initialData }: AlertBoardProps) {
  const { getSelectedSchoolIds, selectedSchoolId, profile } = useAuth();
  const { schools } = useMasterData();
  const { success, error: toastError } = useToast();
  // 初期データがあれば SSR 事前取得済みの Light アラートをそのまま表示する
  const [studentAlerts, setStudentAlerts] = useState<StudentAlerts[]>(
    initialData?.studentAlerts ?? []
  );
  // 初期データがあれば最初からローディング非表示（即時に内容を出す）
  const [isLoading, setIsLoading] = useState(!initialData);
  const [isExpanded, setIsExpanded] = useState(true);
  const [showInfoPopup, setShowInfoPopup] = useState(false);
  /** Heavy アラート（成績・テスト）の取得状態 */
  const [heavyLoadState, setHeavyLoadState] = useState<'idle' | 'loading' | 'done' | 'error'>(
    'idle'
  );
  // 遅延発火する Heavy 取得が「古い教室選択」のまま resolve してマージされるのを防ぐトークン。
  // fetchAlerts 呼び出しごとに加算し、deferred 実行・resolve 時に一致を確認する。
  const heavyRunRef = useRef(0);
  // 初期データ（SSR事前取得）を消費したかどうか。マウント直後の1回だけ fetch をスキップするためのフラグ。
  // Heavy アラートは引き続き whenNetworkIdle() 後にクライアントで取得されるため、
  // このスキップは Light fetch のみに効く（Heavy のタイミング制御は fetchAlerts 内で行う）。
  const skipInitialFetchRef = useRef<boolean>(!!initialData);

  // 対応済み操作はmanager以上のみ
  const canDismiss =
    profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';
  // 講師画面：生徒に見える可能性があるためネガティブ情報をマスク
  const isTeacher = profile?.role === 'teacher';

  // アラートタイプの説明
  const alertTypeDescriptions: Record<string, string> = {
    score_drop: '前回と比較して10点以上低下した科目',
    score_missing: '最新の成績で未入力の科目がある',
    interview_overdue: '最後の面談から30日以上経過している',
    application_overdue: '期日が過ぎている申込項目がある',
    interview_task: '未完了の面談タスクがある',
    exam_overdue: 'テスト日を過ぎたが目標点・行動目標が未設定',
    homework_not_done:
      '宿題未実施の累積回数がしきい値を超えている（対応済み後、回数が増えると再表示）',
    tardy: '遅刻の累積回数がしきい値を超えている（対応済み後、回数が増えると再表示）',
    course_prep_overdue: '講習準備の期日が近い、または超過',
  };

  // 講師画面でアイコン併記＋具体メッセージを伏せる際の補足説明
  const teacherMaskDescriptions: Partial<Record<AlertType, string>> = {
    score_drop: '成績が下がった科目（点数は非表示）',
    homework_not_done: '宿題未実施が複数回ある生徒（回数は非表示）',
    tardy: '遅刻が複数回ある生徒（回数は非表示）',
    interview_overdue: '面談から日数が経過した生徒（具体日数は非表示）',
  };

  const fetchAlerts = useCallback(
    async (skipCache = false) => {
      setIsLoading(true);
      setHeavyLoadState('idle');
      const runToken = ++heavyRunRef.current;
      try {
        const schoolIds = getSelectedSchoolIds();
        if (schoolIds.length === 0) {
          setStudentAlerts([]);
          setHeavyLoadState('idle');
          setIsLoading(false);
          return;
        }
        if (skipCache) invalidateAlertCache(schoolIds);
        // Phase 2: Light を先に表示し、Heavy は裏で取得
        const lightAlerts = await getAlertsLight(schoolIds, { skipCache });
        setStudentAlerts(lightAlerts);
        setIsLoading(false);

        // Heavy（成績・テスト系: assessments→textbooks→exams→assessment_scores の重い連鎖）は
        // 初期ロードの「DBリクエスト殺到」を増幅する。critical な Light 表示を優先するため、
        // ブラウザがアイドルになってから取得する。発火・resolve 時に runToken を照合し、
        // 教室切替などで古くなった結果はマージしない。
        const startHeavy = () => {
          if (runToken !== heavyRunRef.current) return; // 既に新しい取得が始まっている
          setHeavyLoadState('loading');
          getAlertsHeavy(schoolIds, { skipCache })
            .then((heavyAlerts) => {
              if (runToken !== heavyRunRef.current) return; // resolve 時点で陳腐化
              setStudentAlerts((prev) => mergeStudentAlerts(prev, heavyAlerts));
              setHeavyLoadState('done');
            })
            .catch((err) => {
              if (runToken !== heavyRunRef.current) return;
              console.error('Error fetching heavy alerts:', err);
              setHeavyLoadState('error');
              toastError('成績・テスト関連のアラートの取得に失敗しました');
            });
        };
        // クリティカル取得の群れが捌けてから Heavy を開始（ピーク同時実行数を下げる）
        void whenNetworkIdle().then(startHeavy);
      } catch (error) {
        console.error('Error fetching alerts:', error);
        toastError('アラートの取得に失敗しました');
        setHeavyLoadState('idle');
        setIsLoading(false);
      }
    },
    [getSelectedSchoolIds, toastError]
  );

  // Heavy アラート（成績・テスト系）だけを遅延取得してマージする。
  // SSR で Light を初期表示済みのとき（initialData あり）に、Light の初回取得はスキップしつつ
  // Heavy だけは従来どおりクライアントで whenNetworkIdle 後に取得するために使う。
  // fetchAlerts 内の startHeavy と同じトークン照合・マージ規則。
  const loadHeavyAlerts = useCallback(() => {
    const schoolIds = getSelectedSchoolIds();
    if (schoolIds.length === 0) return;
    const runToken = ++heavyRunRef.current;
    const startHeavy = () => {
      if (runToken !== heavyRunRef.current) return;
      setHeavyLoadState('loading');
      getAlertsHeavy(schoolIds, {})
        .then((heavyAlerts) => {
          if (runToken !== heavyRunRef.current) return;
          setStudentAlerts((prev) => mergeStudentAlerts(prev, heavyAlerts));
          setHeavyLoadState('done');
        })
        .catch((err) => {
          if (runToken !== heavyRunRef.current) return;
          console.error('Error fetching heavy alerts:', err);
          setHeavyLoadState('error');
          toastError('成績・テスト関連のアラートの取得に失敗しました');
        });
    };
    void whenNetworkIdle().then(startHeavy);
  }, [getSelectedSchoolIds, toastError]);

  const HEAVY_ALERT_TYPES = ['score_drop', 'score_missing', 'exam_overdue'] as const;

  /** Heavy アラートのみ再取得（成績・テスト関連） */
  const retryHeavyAlerts = useCallback(async () => {
    const schoolIds = getSelectedSchoolIds();
    if (schoolIds.length === 0) return;
    setHeavyLoadState('loading');
    invalidateAlertCache(schoolIds);
    try {
      const heavyAlerts = await getAlertsHeavy(schoolIds, { skipCache: true });
      setStudentAlerts((prev) => {
        const withoutHeavy = prev
          .map((sa) => ({
            ...sa,
            alerts: sa.alerts.filter(
              (a) => !(HEAVY_ALERT_TYPES as readonly string[]).includes(a.alert_type)
            ),
          }))
          .filter((sa) => sa.alerts.length > 0);
        return mergeStudentAlerts(withoutHeavy, heavyAlerts);
      });
      setHeavyLoadState('done');
    } catch (err) {
      console.error('Error retrying heavy alerts:', err);
      setHeavyLoadState('error');
      toastError('成績・テスト関連のアラートの取得に失敗しました');
    }
  }, [getSelectedSchoolIds, toastError]);

  useEffect(() => {
    // SSR で初期データを受け取っている場合（initialData あり）、マウント直後の1回だけ
    // Light 取得をスキップする（サーバー事前取得の Light アラートをそのまま表示）。
    // ただし Heavy アラート（成績・テスト系）は SSR 対象外で初期データに含まれないため、
    // Light をスキップしても Heavy だけは従来どおりクライアントで遅延取得してマージする。
    // 教室切替などで fetchAlerts が変わった2回目以降は通常通り Light+Heavy を取得する。
    if (skipInitialFetchRef.current) {
      skipInitialFetchRef.current = false;
      loadHeavyAlerts();
      return;
    }
    fetchAlerts();
  }, [fetchAlerts, loadHeavyAlerts]);

  const handleDismiss = useCallback(
    async (alert: Alert) => {
      if (!canDismiss) return;
      if (!DISMISSABLE_ALERT_TYPES.has(alert.alert_type)) return;

      try {
        const schoolIds = getSelectedSchoolIds();
        if (schoolIds.length === 0) {
          toastError('教室が選択されていません');
          return;
        }

        // 生徒のschool_idを取得
        const { data: student, error: studentError } = await supabase
          .from('students')
          .select('school_id')
          .eq('id', alert.student_id)
          .maybeSingle();

        if (studentError || !student) {
          toastError('生徒情報が見つかりません');
          return;
        }

        await dismissAlert(
          student.school_id,
          alert.student_id,
          alert.alert_type,
          alert.alert_key,
          profile?.id,
          undefined
        );

        success('対応済みにしました');
        // アラートを再取得（キャッシュをスキップ）
        await fetchAlerts(true);
      } catch (error) {
        console.error('Error dismissing alert:', error);
        toastError('対応済みの記録に失敗しました');
      }
    },
    [canDismiss, getSelectedSchoolIds, profile?.id, success, toastError, fetchAlerts]
  );

  // 講師には講習関連など担当外のアラートを表示しない（行ごと除外）。
  // 取得・dismiss は raw な studentAlerts を使い、表示系のみこの絞り込みビューを参照する。
  const visibleStudentAlerts = useMemo(() => {
    if (!isTeacher) return studentAlerts;
    return studentAlerts
      .map((sa) => ({
        ...sa,
        alerts: sa.alerts.filter((a) => !TEACHER_HIDDEN_ALERT_TYPES.has(a.alert_type)),
      }))
      .filter((sa) => sa.alerts.length > 0);
  }, [studentAlerts, isTeacher]);

  const totalAlerts = useMemo(
    () => visibleStudentAlerts.reduce((sum, sa) => sum + sa.alerts.length, 0),
    [visibleStudentAlerts]
  );

  const isMultiSchool = selectedSchoolId === 'all';

  const schoolNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of schools) map[s.id] = s.name;
    return map;
  }, [schools]);

  const schoolColorMap = useMemo(() => {
    const ids = Array.from(
      new Set(visibleStudentAlerts.map((sa) => sa.school_id).filter(Boolean) as string[])
    );
    const map: Record<string, (typeof SCHOOL_COLORS)[number]> = {};
    ids.forEach((id, i) => {
      map[id] = SCHOOL_COLORS[i % SCHOOL_COLORS.length];
    });
    return map;
  }, [visibleStudentAlerts]);

  // 教室別にグルーピング（マルチ校時のみ）
  const alertsBySchool = useMemo(() => {
    if (!isMultiSchool) return null;
    const map = new Map<string, { name: string; alerts: StudentAlerts[]; count: number }>();
    for (const sa of visibleStudentAlerts) {
      const sid = sa.school_id || 'unknown';
      if (!map.has(sid)) {
        map.set(sid, { name: schoolNameMap[sid] || '不明', alerts: [], count: 0 });
      }
      const entry = map.get(sid)!;
      entry.alerts.push(sa);
      entry.count += sa.alerts.length;
    }
    return Array.from(map.entries()).sort((a, b) => b[1].count - a[1].count);
  }, [isMultiSchool, visibleStudentAlerts, schoolNameMap]);

  if (isLoading) {
    return (
      <div className={`bg-[#f8f8f8] rounded-xl border border-gray-200 p-4 ${className}`}>
        <InlineLoading label="アラートを読み込み中..." />
      </div>
    );
  }

  if (totalAlerts === 0) {
    return (
      <div className={`bg-[#f8f8f8] rounded-xl border border-gray-200 p-4 ${className}`}>
        <div className="text-center text-sm text-gray-500">対応が必要な項目はありません</div>
      </div>
    );
  }

  return (
    <div className={`bg-[#f8f8f8] rounded-xl border border-gray-200 overflow-hidden ${className}`}>
      {/* ヘッダー */}
      <div className="flex items-center justify-between p-4 bg-[#ffebee] border-b border-[#ffcdd2]">
        <div className="flex items-center gap-2 flex-wrap">
          <AlertTriangle className="w-5 h-5 text-[#d32f2f]" />
          <span className="font-bold text-[#1a1a1a]">アラート（{totalAlerts}件）</span>
          {isMultiSchool && alertsBySchool && (
            <div className="flex items-center gap-1">
              {alertsBySchool.map(([sid, group]) => {
                const color = schoolColorMap[sid];
                return (
                  <span
                    key={sid}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${color?.bg || 'bg-gray-100'} ${color?.text || 'text-gray-700'}`}
                  >
                    {group.name} {group.count}
                  </span>
                );
              })}
            </div>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowInfoPopup(!showInfoPopup);
            }}
            className="text-gray-500 hover:text-gray-700 transition-colors duration-150"
            title="アラート内容の説明"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-gray-400 hover:text-gray-600 transition-colors duration-150"
        >
          {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
      </div>

      {/* アラート内容説明ポップアップ */}
      {showInfoPopup && (
        <div className="relative">
          <div className="absolute top-2 left-4 z-10 bg-white border border-gray-200 rounded-xl shadow-xl p-4 min-w-[300px] dropdown-menu">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-[#1a1a1a]">アラート内容一覧</h3>
              <button
                onClick={() => setShowInfoPopup(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors duration-150"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2">
              {Object.entries(ALERT_TYPE_LABELS).map(([type, label]) => {
                const alertType = type as AlertType;
                // 講師には非表示のアラートタイプ（講習関連など）は説明一覧からも除外
                if (isTeacher && TEACHER_HIDDEN_ALERT_TYPES.has(alertType)) return null;
                const isSensitiveType = SENSITIVE_ALERT_TYPES.has(alertType);
                const Icon = isTeacher && isSensitiveType ? SENSITIVE_ALERT_ICONS[alertType] : null;
                const displayLabel =
                  isTeacher && isSensitiveType
                    ? MASKED_ALERT_LABEL_OVERRIDES[alertType] || label
                    : label;
                const desc =
                  isTeacher && isSensitiveType
                    ? teacherMaskDescriptions[alertType] || alertTypeDescriptions[type]
                    : alertTypeDescriptions[type];
                return (
                  <div key={type} className="flex items-start gap-2">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded ${ALERT_TYPE_COLORS[alertType]}`}
                    >
                      {Icon && <Icon className="w-3 h-3" />}
                      {displayLabel}
                    </span>
                    <span className="text-sm text-[#4b5563] flex-1">{desc}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400 leading-relaxed">
              {isTeacher
                ? '個人情報保護のため、生徒名は学年＋姓のみ、具体的な点数や回数は非表示にしています。'
                : '成績低下・宿題未実施・遅刻は「対応済み」で消去。その他は実績入力で自動的に消えます。'}
            </div>
          </div>
        </div>
      )}

      {/* Heavy アラート取得失敗時のバナー */}
      {heavyLoadState === 'error' && (
        <div className="mx-4 mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between gap-3">
          <span className="text-sm text-amber-800">
            成績・テスト関連のアラートを読み込めませんでした
          </span>
          <button
            type="button"
            onClick={retryHeavyAlerts}
            className="px-3 py-1.5 text-sm font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-md transition-colors duration-150"
          >
            再読み込み
          </button>
        </div>
      )}

      {/* Heavy アラート読み込み中表示 */}
      {heavyLoadState === 'loading' && (
        <div className="mx-4 mt-2 py-2">
          <InlineLoading label="成績・テスト関連のアラートを読み込み中..." />
        </div>
      )}

      {/* アラート一覧 */}
      {isExpanded && (
        <div className="p-3 space-y-2 max-h-[640px] overflow-y-auto">
          {isMultiSchool && alertsBySchool
            ? alertsBySchool.map(([schoolId, group]) => {
                const color = schoolColorMap[schoolId];
                return (
                  <div key={schoolId}>
                    <div
                      className={`flex items-center gap-2 px-2 py-1.5 mb-1.5 rounded-lg ${color?.bg || 'bg-gray-100'}`}
                    >
                      <span className={`text-xs font-bold ${color?.text || 'text-gray-700'}`}>
                        {group.name}
                      </span>
                      <span className="text-[10px] text-gray-500">{group.count}件</span>
                    </div>
                    <div className="space-y-1.5 mb-3">
                      {group.alerts.map((studentAlert) => (
                        <StudentAlertCard
                          key={studentAlert.student_id}
                          studentAlert={studentAlert}
                          handleDismiss={handleDismiss}
                          canDismiss={canDismiss}
                          masked={isTeacher}
                        />
                      ))}
                    </div>
                  </div>
                );
              })
            : visibleStudentAlerts.map((studentAlert) => (
                <StudentAlertCard
                  key={studentAlert.student_id}
                  studentAlert={studentAlert}
                  handleDismiss={handleDismiss}
                  canDismiss={canDismiss}
                  masked={isTeacher}
                />
              ))}
        </div>
      )}
    </div>
  );
}

function StudentAlertCard({
  studentAlert,
  handleDismiss,
  canDismiss,
  masked = false,
}: {
  studentAlert: StudentAlerts;
  handleDismiss: (alert: Alert) => void;
  canDismiss: boolean;
  /** 講師画面：姓＋学年のみ表示、ネガティブ情報マスク */
  masked?: boolean;
}) {
  // 講師画面では学年＋姓のみ（"田中 太郎" → "田中"）
  const displayName = masked
    ? `${GRADE_LABELS[studentAlert.grade] || studentAlert.grade} ${studentAlert.student_name.split(/\s+/)[0]}`
    : studentAlert.student_name;

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden bg-white">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border-b border-gray-200">
        <span className="font-semibold text-sm text-[#1a1a1a]">{displayName}</span>
        {!masked && (
          <span className="text-xs text-gray-500">
            ({GRADE_LABELS[studentAlert.grade] || studentAlert.grade})
          </span>
        )}
      </div>
      <div className="p-2 space-y-1">
        {studentAlert.alerts.map((alert) => (
          <AlertItem
            key={alert.id}
            alert={alert}
            onDismiss={handleDismiss}
            canDismiss={canDismiss}
            masked={masked}
          />
        ))}
      </div>
    </div>
  );
}
