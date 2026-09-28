'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InlineLoading } from '@/components/ui';
import { AlertItem } from '@/components/alerts/AlertItem';
import { useAuth } from '@/contexts/AuthContext';
import { getStudentInterviews } from '@/lib/api/interviews';
import {
  dismissAlert,
  getAlertsHeavy,
  getAlertsLight,
  invalidateAlertCache,
  mergeStudentAlerts,
} from '@/lib/api/alerts';
import { pickStudentAttentionAlerts } from '@/lib/alerts/studentAttention';
import { whenNetworkIdle } from '@/lib/utils/networkIdle';
import type { Alert, StudentAlerts } from '@/types/alerts';
import { DISMISSABLE_ALERT_TYPES } from '@/types/alerts';
import type { StudentInterview } from '@/types/database';
import { HubSection } from './HubSection';

interface AttentionSectionProps {
  studentId: string;
  /** 生徒の所属教室。アラートはこの1教室分を計算して、この生徒の分だけ抜き出す */
  schoolId: string;
}

/**
 * 気にすること（上部の左カラム）。「注意すること」と「未完了の約束」を並べる。
 *
 * 注意すること＝生徒一覧のアラート欄（AlertBoard）と同じアラートを、この生徒1人分だけ出す
 * （2026-09-28 ユーザー決定の A案: 既存の教室単位の計算を流用し、生徒1人分を抜き出す）。
 * ★絞り方（ロールで外す種別）は AlertBoard と同じ関数（alertTypesHiddenForRole）を通す。
 *   別に書くと一覧とハブで出る内容がずれる。アラート設定（種別の有効・無効・しきい値）は
 *   getAlerts* の中の計算で効いているので、ここでは何もしない。
 * ★面談更新（講師向けの良い知らせ）と未完了タスク（下の「未完了の約束」と二重）は出さない。
 *
 * 約束は面談記録に interview_type='task' として保存されている（期日の列は無い。日付は登録日）。
 * ★完了の操作はここに置かず、下の面談欄（InterviewList）に任せる。完了操作を2か所に持つと、
 *   片方で完了しても片方が古いまま残る。
 * 保護者との連絡は、生徒単位で連絡スレッドを引く関数がまだ無いので出していない。
 */
export function AttentionSection({ studentId, schoolId }: AttentionSectionProps) {
  return (
    <HubSection id="sec-attention" title="気にすること">
      {/* 1100px 以上は左右2列（左=注意すること / 右=未完了の約束）。
          上部の左カラムは基本情報（300px）を除いても横に広く、縦1列だと注意することが多い生徒で
          約束が画面の下へ押し出される。狭い画面では縦に 注意すること → 未完了の約束 の順。 */}
      <div className="grid gap-x-6 gap-y-5 min-[1100px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <AlertsBlock studentId={studentId} schoolId={schoolId} />
        <TasksBlock studentId={studentId} />
      </div>
    </HubSection>
  );
}

/** 注意すること（生徒一覧のアラートの、この生徒の分） */
function AlertsBlock({ studentId, schoolId }: AttentionSectionProps) {
  const { profile } = useAuth();
  // AlertBoard と同じ判定（対応済みは教室長以上だけ・講師はマスク）。
  // ハブは教室長以上しか開けないが、条件をここだけ変えると一覧とハブで挙動がずれるので揃えておく。
  const canDismiss =
    profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';
  const isTeacher = profile?.role === 'teacher';

  // Light（面談未更新・申込未提出・日程変更未反映など）が来るまでは null
  const [studentAlerts, setStudentAlerts] = useState<StudentAlerts[] | null>(null);
  const [lightState, setLightState] = useState<'waiting' | 'done' | 'error'>('waiting');
  // Heavy（成績・目標・宿題・遅刻・講習準備）の取得状態
  const [heavyState, setHeavyState] = useState<'waiting' | 'done' | 'error'>('waiting');
  const [dismissFailed, setDismissFailed] = useState(false);
  // 生徒・教室が変わったあとに古い取得が返ってきても混ぜないためのトークン（AlertBoard と同じ型）
  const runRef = useRef(0);
  const dismissingRef = useRef<Set<string>>(new Set());

  const loadHeavy = useCallback(
    (runToken: number, skipCache: boolean) => {
      setHeavyState('waiting');
      // ★教室は生徒の所属1つだけにする（選択中の教室が「すべて」や複数でも）。
      //   1教室のほうが軽く、選択中の教室が1つのとき（大半）は生徒一覧の AlertBoard と同じ
      //   キャッシュキー（教室IDの並べ替え連結）になる。一覧で Heavy を取り終えてから15秒以内に
      //   開けば、この取得はキャッシュから即返る。
      getAlertsHeavy([schoolId], { skipCache })
        .then((heavy) => {
          if (runToken !== runRef.current) return;
          setStudentAlerts((prev) => mergeStudentAlerts(prev ?? [], heavy));
          setHeavyState('done');
        })
        .catch((err) => {
          if (runToken !== runRef.current) return;
          console.error('Error fetching heavy alerts for hub:', err);
          setHeavyState('error');
        });
    },
    [schoolId]
  );

  useEffect(() => {
    const runToken = ++runRef.current;
    setStudentAlerts(null);
    setLightState('waiting');
    setHeavyState('waiting');
    setDismissFailed(false);

    // Light を先に出す。★一覧の Light はサーバーで先取り（キャッシュに書かない）なので、
    //   Light はここで改めて取ることが多い。軽いので問題にならない。
    getAlertsLight([schoolId])
      .then((light) => {
        if (runToken !== runRef.current) return;
        setStudentAlerts((prev) => mergeStudentAlerts(light, prev ?? []));
        setLightState('done');
      })
      .catch((err) => {
        if (runToken !== runRef.current) return;
        console.error('Error fetching light alerts for hub:', err);
        setLightState('error');
      });

    // Heavy は生徒管理ページと同じく、ページ上部の取得の群れが捌けてから始める
    // （同時リクエストで接続プールを飽和させないため。whenNetworkIdle の冒頭コメント参照）
    // 生徒・教室の切替は次の実行が runRef を進めるので、古い結果はトークン照合で捨てられる。
    // アンマウントだけはトークンが進まないので、待っている Heavy を始めないよう別に止める。
    let disposed = false;
    void whenNetworkIdle().then(() => {
      if (disposed || runToken !== runRef.current) return;
      loadHeavy(runToken, false);
    });

    return () => {
      disposed = true;
    };
  }, [schoolId, loadHeavy]);

  const retryHeavy = useCallback(() => {
    loadHeavy(runRef.current, true);
  }, [loadHeavy]);

  /**
   * 対応済み。AlertBoard と同じく押した行をその場で消す楽観更新にし、失敗したら戻す。
   * 同じ (alert_type, alert_key) の行はサーバー側でまとめて消えるので、ここでも揃えて消す。
   * ★データから取り除くのではなく「消したキー」を覚えて表示で外す。対応済みを押したあとに
   *   押す前に始まっていた Heavy の取得が返ってきても、消した行が生き返らないようにするため。
   */
  const [dismissedKeys, setDismissedKeys] = useState<ReadonlySet<string>>(new Set());
  const handleDismiss = useCallback(
    async (alert: Alert) => {
      if (!canDismiss) return;
      if (!DISMISSABLE_ALERT_TYPES.has(alert.alert_type)) return;
      if (dismissingRef.current.has(alert.id)) return;
      dismissingRef.current.add(alert.id);
      setDismissFailed(false);

      const key = dismissKey(alert);
      setDismissedKeys((prev) => new Set(prev).add(key));

      try {
        // dismiss は生徒の所属校で記録する（AlertBoard と同じ）。アラートは生成時に school_id を持つ
        await dismissAlert(
          alert.school_id ?? schoolId,
          alert.student_id,
          alert.alert_type,
          alert.alert_key,
          profile?.id,
          undefined
        );
        // この教室を含むキャッシュを全部捨てる（生徒一覧へ戻ったとき消した行が残らないように）
        invalidateAlertCache([schoolId]);
      } catch (error) {
        console.error('Error dismissing alert from hub:', error);
        setDismissedKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        // ★トーストではなくその場に出す（ハブのページにはトーストの表示先が無い）
        setDismissFailed(true);
      } finally {
        dismissingRef.current.delete(alert.id);
      }
    },
    [canDismiss, schoolId, profile?.id]
  );

  const alerts = useMemo(
    () =>
      studentAlerts
        ? pickStudentAttentionAlerts(studentAlerts, studentId, isTeacher).filter(
            (a) => !dismissedKeys.has(dismissKey(a))
          )
        : null,
    [studentAlerts, studentId, isTeacher, dismissedKeys]
  );

  // 「ありません」と言い切れるのは Light・Heavy の両方が読めたときだけ。
  // 片方でも失敗・待ちなら、その旨を出す（黙って空にしない）。
  const allLoaded = lightState === 'done' && heavyState === 'done';

  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-sm font-bold text-text-heading">注意すること</h3>
      {alerts && alerts.length > 0 && (
        <div className="mb-2 flex flex-col gap-1">
          {alerts.map((a) => (
            <AlertItem
              key={a.id}
              alert={a}
              masked={isTeacher}
              canDismiss={canDismiss}
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      )}
      {lightState === 'error' && (
        <p className="mb-1 text-[13px] text-danger">注意することを読み込めませんでした</p>
      )}
      {lightState === 'waiting' && <InlineLoading label="読み込み中…" />}
      {/* Heavy を待つ間は、後から行が増える理由が分かるように1行出す */}
      {lightState !== 'waiting' && heavyState === 'waiting' && (
        <InlineLoading label="成績・宿題・遅刻などの注意を確認中…" />
      )}
      {heavyState === 'error' && (
        <p className="mb-1 text-[13px] text-danger">
          成績・宿題・遅刻などの注意を読み込めませんでした
          <button type="button" onClick={retryHeavy} className="ml-2 text-primary hover:underline">
            再読み込み
          </button>
        </p>
      )}
      {allLoaded && alerts !== null && alerts.length === 0 && (
        <p className="text-[13px] text-text-muted">注意することはありません</p>
      )}
      {dismissFailed && <p className="text-[13px] text-danger">対応済みの記録に失敗しました</p>}
      <p className="mb-0 mt-2 text-xs text-text-muted">
        生徒一覧のアラートと同じものです。文言を押すと、入力する画面へ移ります。
      </p>
    </div>
  );
}

/** 対応済みの一意キー（サーバー側の dismiss と同じく、生徒×種別×キー） */
function dismissKey(a: Alert): string {
  return `${a.student_id}:${a.alert_type}:${a.alert_key}`;
}

/** 未完了の約束（面談記録の task のうち未完了のもの） */
function TasksBlock({ studentId }: { studentId: string }) {
  const [tasks, setTasks] = useState<StudentInterview[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getStudentInterviews(studentId)
      .then((rows) => {
        if (cancelled) return;
        setTasks(rows.filter((r) => r.interview_type === 'task' && !r.is_completed));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-sm font-bold text-text-heading">未完了の約束</h3>
      {failed ? (
        <p className="text-[13px] text-danger">約束の取得に失敗しました</p>
      ) : tasks === null ? (
        <InlineLoading label="読み込み中…" />
      ) : tasks.length === 0 ? (
        <p className="text-[13px] text-text-muted">未完了の約束はありません</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {tasks.map((t) => (
            <li
              key={t.id}
              className="flex items-baseline gap-2 border-b border-border-subtle py-1.5 text-[13px] last:border-0"
            >
              <span className="min-w-0 flex-1 text-text-body [overflow-wrap:anywhere]">
                {t.title || t.content}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-text-faint">
                {t.interview_date}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mb-0 mt-2 text-xs text-text-muted">
        約束の追加・完了は下の
        <a href="#sec-interview" className="mx-0.5 text-primary hover:underline">
          面談
        </a>
        欄から行います。
      </p>
    </div>
  );
}
