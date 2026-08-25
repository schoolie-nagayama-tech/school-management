'use client';

import { useState, useEffect, useCallback, useMemo, useRef, type ComponentType } from 'react';
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
  TEACHER_ONLY_ALERT_TYPES,
} from '@/types/alerts';
import type { AlertType, AlertSeverity } from '@/types/alerts';
import { whenNetworkIdle } from '@/lib/utils/networkIdle';
import {
  groupAlertsBySeries,
  groupByStudentThenSeries,
  type StudentAlertGroup,
  type StudentSeriesRow,
} from '@/lib/alerts/grouping';

import type { AlertInitialData } from '@/lib/api/alert-server';

/** severity → 行頭ドットの色 */
function severityDotClass(s: AlertSeverity): string {
  return s === 'danger' ? 'bg-red-500' : s === 'warning' ? 'bg-orange-400' : 'bg-yellow-300';
}

/** severity → 行の枠線・背景（重いものほど濃く） */
function severityRowClass(s: AlertSeverity): string {
  return s === 'danger'
    ? 'border-red-300 bg-red-50'
    : s === 'warning'
      ? 'border-orange-200 bg-orange-50/60'
      : 'border-gray-200 bg-white';
}

/** 系列フィルターチップの共通クラス（通知フィードのチップと同じトーン） */
function chipClass(active: boolean): string {
  return `flex items-center gap-1 text-[11px] h-6 px-2 rounded transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97] whitespace-nowrap ${
    active ? 'bg-[#1e3a5f] text-white font-medium' : 'text-gray-600 hover:bg-gray-100'
  }`;
}

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

/**
 * 対応済みにしたアラートをボードからその場で取り除く（楽観更新）。
 * dismiss の一意キーはサーバー側と同じ (student_id, alert_type, alert_key) なので、
 * 同一キーの行はまとめて落とす。残りアラートが0件になった生徒はカードごと消す。
 */
function removeAlertLocally(list: StudentAlerts[], target: Alert): StudentAlerts[] {
  return list
    .map((sa) =>
      sa.student_id === target.student_id
        ? {
            ...sa,
            alerts: sa.alerts.filter(
              (a) => !(a.alert_type === target.alert_type && a.alert_key === target.alert_key)
            ),
          }
        : sa
    )
    .filter((sa) => sa.alerts.length > 0);
}

/**
 * 楽観更新のロールバック用に、アラート1件から復元用の StudentAlerts エントリを作る。
 * Alert は氏名・学年・かな・学籍番号を持っているため、mergeStudentAlerts に渡せば
 * 名簿順の正しい位置に戻せる（生徒カードごと消えていた場合も復活する）。
 */
function toRestoreEntry(alert: Alert): StudentAlerts {
  return {
    student_id: alert.student_id,
    student_name: alert.student_name,
    grade: alert.grade,
    school_id: alert.school_id,
    last_name_kana: alert.last_name_kana,
    first_name_kana: alert.first_name_kana,
    student_code: alert.student_code,
    alerts: [alert],
  };
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
  // 系列（alert_type）フィルター。'all' は全系列表示。
  const [seriesFilter, setSeriesFilter] = useState<AlertType | 'all'>('all');
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
  // 対応済み処理が進行中のアラートID（連打による二重記録を防ぐ）
  const dismissingRef = useRef<Set<string>>(new Set());

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
    interview_recent: '面談記録が最近更新された生徒（7日間表示）',
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

  /**
   * 対応済み操作。押した行だけをその場で消す楽観更新にしている。
   *
   * 以前は dismiss のたびに fetchAlerts(true) で全件再取得していたが、
   * isLoading が立つとボード全体が1行のローディング表示に置き換わって高さが潰れ、
   * 再描画後にスクロール位置が飛ぶ（＝1件押すたびに読み込み待ち＋下までスクロールし直し）。
   * サーバー側の dismiss は「そのキーのアラートを消す」だけの決定的な操作なので、
   * ローカルで同じ結果を作れば再取得は不要。キャッシュだけ捨てておき、
   * 次回のページ表示・教室切替で最新状態を取り直す。
   * 書き込みに失敗したら消した行を元の位置（名簿順）へ戻す。
   */
  const handleDismiss = useCallback(
    async (alert: Alert) => {
      if (!canDismiss) return;
      if (!DISMISSABLE_ALERT_TYPES.has(alert.alert_type)) return;
      // 連打による二重 INSERT を防ぐ（行は即消えるが、展開行などで同キーが並ぶ場合の保険）
      if (dismissingRef.current.has(alert.id)) return;

      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) {
        toastError('教室が選択されていません');
        return;
      }

      dismissingRef.current.add(alert.id);
      // 楽観更新：まず表示から消す（レイアウトが潰れないのでスクロール位置は動かない）
      setStudentAlerts((prev) => removeAlertLocally(prev, alert));

      try {
        // dismiss は生徒の所属校で記録する。アラートは生成時に school_id を持つので
        // 通常は追加のラウンドトリップ不要。欠けているときだけ students を引く。
        let schoolId = alert.school_id;
        if (!schoolId) {
          const { data: student, error: studentError } = await supabase
            .from('students')
            .select('school_id')
            .eq('id', alert.student_id)
            .maybeSingle();
          if (studentError || !student) throw new Error('生徒情報が見つかりません');
          schoolId = student.school_id;
        }

        await dismissAlert(
          schoolId,
          alert.student_id,
          alert.alert_type,
          alert.alert_key,
          profile?.id,
          undefined
        );

        // 表示は更新済み。次回取得で最新を読むようキャッシュのみ無効化する
        invalidateAlertCache(schoolIds);
        success('対応済みにしました');
      } catch (error) {
        console.error('Error dismissing alert:', error);
        // ロールバック：消した行を名簿順の正しい位置へ戻す
        setStudentAlerts((prev) => mergeStudentAlerts(prev, [toRestoreEntry(alert)]));
        toastError('対応済みの記録に失敗しました');
      } finally {
        dismissingRef.current.delete(alert.id);
      }
    },
    [canDismiss, getSelectedSchoolIds, profile?.id, success, toastError]
  );

  // 講師には講習関連など担当外のアラートを表示しない（行ごと除外）。
  // 逆に「面談更新」は講師にのみ表示するポジティブ通知のため、非講師（教室長以上）では除外する。
  // 取得・dismiss は raw な studentAlerts を使い、表示系のみこの絞り込みビューを参照する。
  const visibleStudentAlerts = useMemo(() => {
    const hiddenTypes = isTeacher ? TEACHER_HIDDEN_ALERT_TYPES : TEACHER_ONLY_ALERT_TYPES;
    return studentAlerts
      .map((sa) => ({
        ...sa,
        alerts: sa.alerts.filter((a) => !hiddenTypes.has(a.alert_type)),
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

  // 系列（alert_type）ごとに再編したセクション。チップの並び順・件数と、
  // 単一校表示時の本体描画に使う（severity の高い系列が先頭）。
  const globalSections = useMemo(
    () => groupAlertsBySeries(visibleStudentAlerts),
    [visibleStudentAlerts]
  );

  // 選択中の系列フィルターが、再取得や対応済みで消えた場合は 'all' に戻す
  useEffect(() => {
    if (seriesFilter === 'all') return;
    if (!globalSections.some((sec) => sec.alert_type === seriesFilter)) {
      setSeriesFilter('all');
    }
  }, [globalSections, seriesFilter]);

  // 講師画面ではネガティブ系のラベルを婉曲化しアイコンを併記する
  const typeDisplay = useCallback(
    (type: AlertType) => {
      const sensitive = isTeacher && SENSITIVE_ALERT_TYPES.has(type);
      const label = sensitive
        ? MASKED_ALERT_LABEL_OVERRIDES[type] || ALERT_TYPE_LABELS[type]
        : ALERT_TYPE_LABELS[type];
      const Icon = sensitive ? (SENSITIVE_ALERT_ICONS[type] ?? null) : null;
      return { label, Icon };
    },
    [isTeacher]
  );

  // 生徒（人）ごとのカード群を描画（単一校 / マルチ校の各教室内で共通利用）。
  // 各カード内は同一系列を1行に集約。系列フィルターで行を絞り込む。
  const renderStudentCards = (students: StudentAlerts[]) => {
    const groups = groupByStudentThenSeries(students);
    const visibleGroups = groups.filter((g) =>
      g.rows.some((r) => seriesFilter === 'all' || r.alert_type === seriesFilter)
    );
    if (visibleGroups.length === 0) return null;
    return (
      <div className="space-y-1.5">
        {visibleGroups.map((group) => (
          <StudentAlertCardView
            key={group.student_id}
            group={group}
            seriesFilter={seriesFilter}
            masked={isTeacher}
            canDismiss={canDismiss}
            onDismiss={handleDismiss}
            typeDisplay={typeDisplay}
          />
        ))}
      </div>
    );
  };

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
                // 逆に講師にのみ表示するアラートタイプ（面談更新）は非講師の説明一覧からは除外
                if (!isTeacher && TEACHER_ONLY_ALERT_TYPES.has(alertType)) return null;
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

      {/* 系列フィルターチップ（通知フィードと同じ操作感で系列ごとに絞り込む） */}
      {isExpanded && globalSections.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 px-3 pt-3">
          <button
            onClick={() => setSeriesFilter('all')}
            className={chipClass(seriesFilter === 'all')}
          >
            すべて
            <ChipCount active={seriesFilter === 'all'} count={totalAlerts} />
          </button>
          {globalSections.map((sec) => {
            const { label, Icon } = typeDisplay(sec.alert_type);
            const active = seriesFilter === sec.alert_type;
            return (
              <button
                key={sec.alert_type}
                onClick={() => setSeriesFilter(active ? 'all' : sec.alert_type)}
                className={chipClass(active)}
              >
                {Icon && <Icon className="w-3 h-3" />}
                {label}
                <ChipCount active={active} count={sec.studentCount} />
              </button>
            );
          })}
        </div>
      )}

      {/* アラート一覧（生徒＝人ごとにカード。各カード内は同系列を1行に集約） */}
      {isExpanded && (
        <div className="p-3 space-y-3 max-h-[640px] overflow-y-auto">
          {isMultiSchool && alertsBySchool
            ? alertsBySchool.map(([schoolId, group]) => {
                const color = schoolColorMap[schoolId];
                const body = renderStudentCards(group.alerts);
                if (!body) return null; // フィルターでこの教室に該当が無ければ教室見出しごと省く
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
                    {body}
                  </div>
                );
              })
            : renderStudentCards(visibleStudentAlerts)}
        </div>
      )}
    </div>
  );
}

/** チップの件数バッジ */
function ChipCount({ active, count }: { active: boolean; count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className={`min-w-[16px] h-4 flex items-center justify-center rounded-full text-[10px] font-bold leading-none px-1 ${
        active ? 'bg-white/25 text-white' : 'bg-gray-200 text-gray-600'
      }`}
    >
      {count}
    </span>
  );
}

/** 生徒（人）ごとのカード。見出し（氏名＋学年）＋系列行を並べる */
function StudentAlertCardView({
  group,
  seriesFilter,
  masked,
  canDismiss,
  onDismiss,
  typeDisplay,
}: {
  group: StudentAlertGroup;
  seriesFilter: AlertType | 'all';
  masked: boolean;
  canDismiss: boolean;
  onDismiss: (alert: Alert) => void;
  typeDisplay: (type: AlertType) => {
    label: string;
    Icon: ComponentType<{ className?: string }> | null;
  };
}) {
  const rows = group.rows.filter((r) => seriesFilter === 'all' || r.alert_type === seriesFilter);
  if (rows.length === 0) return null;

  // 講師画面では学年＋姓のみ（"田中 太郎" → "田中"）
  const displayName = masked
    ? `${GRADE_LABELS[group.grade] || group.grade} ${group.student_name.split(/\s+/)[0]}`
    : group.student_name;

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden bg-white">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border-b border-gray-200">
        {/* 生徒の最大 severity を色ドットで示す */}
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${severityDotClass(group.severity)}`}
          aria-hidden
        />
        <span
          className={`text-sm text-[#1a1a1a] ${group.severity === 'danger' ? 'font-bold' : 'font-semibold'}`}
        >
          {displayName}
        </span>
        {!masked && (
          <span className="text-xs text-gray-500">
            ({GRADE_LABELS[group.grade] || group.grade})
          </span>
        )}
      </div>
      <div className="p-2 space-y-1">
        {rows.map((row) => (
          <StudentSeriesRowView
            key={row.alert_type}
            row={row}
            masked={masked}
            canDismiss={canDismiss}
            onDismiss={onDismiss}
            typeDisplay={typeDisplay}
          />
        ))}
      </div>
    </div>
  );
}

/** 生徒カード内の1系列＝1行。1件はそのまま、複数件は系列ラベル＋件数で畳んで展開表示 */
function StudentSeriesRowView({
  row,
  masked,
  canDismiss,
  onDismiss,
  typeDisplay,
}: {
  row: StudentSeriesRow;
  masked: boolean;
  canDismiss: boolean;
  onDismiss: (alert: Alert) => void;
  typeDisplay: (type: AlertType) => {
    label: string;
    Icon: ComponentType<{ className?: string }> | null;
  };
}) {
  const [expanded, setExpanded] = useState(false);

  // 1件だけなら従来どおり系列ラベル付きの行として表示（AlertItem がラベル・マスク・対応済みを内包）
  if (row.alerts.length === 1) {
    return (
      <AlertItem
        alert={row.alerts[0]}
        masked={masked}
        canDismiss={canDismiss}
        onDismiss={onDismiss}
      />
    );
  }

  // 複数件は「系列ラベル ＋ N件」に集約し、クリックで個別展開
  const { label, Icon } = typeDisplay(row.alert_type);
  return (
    <div className={`rounded-lg border ${severityRowClass(row.severity)}`}>
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 transition-colors duration-150 hover:bg-black/[0.03]"
      >
        <span
          className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${ALERT_TYPE_COLORS[row.alert_type]}`}
        >
          {Icon && <Icon className="w-3 h-3" />}
          {label}
        </span>
        <span className="text-xs text-gray-600">{row.alerts.length}件</span>
        {/* アイコンの差し替えではなく回転で開閉を示す（AppHeaderのナビドロップダウンと同じパターン） */}
        <ChevronDown
          className={`ml-auto h-3 w-3 shrink-0 text-gray-500 transition-transform duration-150 ease-out ${
            expanded ? 'rotate-180' : ''
          }`}
          aria-hidden
        />
      </button>
      {expanded && (
        <div className="space-y-1 border-t border-gray-200/70 px-2 py-1.5">
          {row.alerts.map((alert) => (
            <AlertItem
              key={alert.id}
              alert={alert}
              masked={masked}
              canDismiss={canDismiss}
              onDismiss={onDismiss}
              hideLabel
            />
          ))}
        </div>
      )}
    </div>
  );
}
