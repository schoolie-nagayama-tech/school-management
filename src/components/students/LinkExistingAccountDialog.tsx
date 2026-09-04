'use client';

import { useCallback, useEffect, useState } from 'react';
import { Search, Users, Loader2, MessageCircle, Ban, KeyRound } from 'lucide-react';
import { Modal, Button, Input } from '@/components/ui';
import { fetchWithAuth } from '@/lib/api/auth';

/**
 * 既に登録済みの保護者アカウントに、この生徒を紐づけるダイアログ（兄弟の追加登録）。
 *
 * ★ なぜ招待の往復とは別にこの導線が要るか:
 *   兄弟は「弟の招待を発行 → 保護者がログインしたまま受諾URLを開く」でも紐づく
 *   （invite/accept のモードa）。ただし保護者が2枚目のQRで新規登録を選ぶと別アカウントが増え、
 *   「弟だけ通知が来ない」という分かりにくい状態になる。教室側で確実に足せる経路を用意する。
 *
 * ★ これは「他人のアカウントにこの生徒の閲覧権を与える」操作なので、
 *   候補は自教室の生徒に紐づくアカウントだけ（APIで担保）＋実行前に確認を挟む。
 *   間違えても、生徒詳細の「解除」ですぐ外せる。
 */

interface Candidate {
  account_id: string;
  display_name: string;
  login_id: string | null;
  has_line: boolean;
  /** LINE未連携なら null（友だち状態は連携済みのときだけ意味を持つ）。 */
  line_followed: boolean | null;
  last_login_at: string | null;
  students: Array<{ student_id: string; student_name: string; grade: number | null }>;
  /** 姓が一致する生徒を見ている＝兄弟の可能性が高い（推測なので必ず確認させる）。 */
  is_sibling_candidate: boolean;
}

interface LinkExistingAccountDialogProps {
  isOpen: boolean;
  onClose: () => void;
  studentId: string;
  studentName: string;
  /** 紐づけ成功時。呼び出し元で一覧を読み直す。 */
  onLinked: () => void;
}

/** 続柄の選択肢。招待受諾フォーム（InviteAccept）と同じ2択に揃える。 */
const RELATION_OPTIONS = [
  { value: 'guardian', label: '保護者' },
  { value: 'other', label: 'その他' },
] as const;

/** 「その他」の自由入力の最大長（APIの RELATION_NOTE_MAX と揃える）。 */
const RELATION_NOTE_MAX = 20;

/** 学年の表示（1-6=小、7-9=中、10-12=高）。生徒一覧の表記に合わせる。 */
function gradeLabel(grade: number | null): string {
  if (grade == null) return '';
  if (grade <= 6) return `小${grade}`;
  if (grade <= 9) return `中${grade - 6}`;
  return `高${grade - 9}`;
}

export function LinkExistingAccountDialog({
  isOpen,
  onClose,
  studentId,
  studentName,
  onLinked,
}: LinkExistingAccountDialogProps) {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [relation, setRelation] = useState<'guardian' | 'other'>('guardian');
  const [relationNote, setRelationNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const loadCandidates = useCallback(
    async (q: string) => {
      setLoading(true);
      try {
        const res = await fetchWithAuth(
          `/api/admin/students/${encodeURIComponent(studentId)}/portal-links/candidates?q=${encodeURIComponent(q)}`
        );
        const json = await res.json();
        if (!res.ok) {
          setErrorMessage(json.error ?? '候補の取得に失敗しました');
          setCandidates([]);
          return;
        }
        setErrorMessage('');
        setCandidates(json.candidates ?? []);
      } catch (e) {
        console.error('[LinkExistingAccountDialog] 候補の取得に失敗:', e);
        setErrorMessage('通信に失敗しました');
        setCandidates([]);
      } finally {
        setLoading(false);
      }
    },
    [studentId]
  );

  // 開いたときに初期候補（兄弟候補が先頭に来る）を読む。閉じたら状態を捨てる。
  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setSelected(null);
      setRelation('guardian');
      setRelationNote('');
      setErrorMessage('');
      setCandidates([]);
      return;
    }
    void loadCandidates('');
  }, [isOpen, loadCandidates]);

  // 入力から少し置いて検索する（1文字ごとに叩かない）。
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => void loadCandidates(query), 300);
    return () => clearTimeout(timer);
  }, [query, isOpen, loadCandidates]);

  const handleLink = async () => {
    if (!selected) return;
    if (relation === 'other' && !relationNote.trim()) {
      setErrorMessage('続柄を入力してください（例: 祖母）');
      return;
    }
    setSubmitting(true);
    setErrorMessage('');
    try {
      const res = await fetchWithAuth(
        `/api/admin/students/${encodeURIComponent(studentId)}/portal-links`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account_id: selected.account_id,
            relation,
            ...(relation === 'other' ? { relation_note: relationNote.trim() } : {}),
          }),
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMessage(json.error ?? '紐づけに失敗しました');
        return;
      }
      onLinked();
      onClose();
    } catch (e) {
      console.error('[LinkExistingAccountDialog] 紐づけに失敗:', e);
      setErrorMessage('通信に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  /** LINEの状態バッジ。連携なし → ID・PWのみ、連携ありでブロック → ブロック中。 */
  const lineBadge = (c: Candidate) => {
    if (!c.has_line) {
      return (
        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-info-subtle px-1.5 py-0.5 text-[10px] font-medium text-info">
          <KeyRound className="h-3 w-3" />
          ID・PWのみ
        </span>
      );
    }
    if (c.line_followed === false) {
      return (
        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-danger-subtle px-1.5 py-0.5 text-[10px] font-medium text-danger">
          <Ban className="h-3 w-3" />
          ブロック中
        </span>
      );
    }
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded bg-success-subtle px-1.5 py-0.5 text-[10px] font-medium text-success">
        <MessageCircle className="h-3 w-3" />
        LINE連携
      </span>
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="登録済みの保護者から選ぶ" size="lg">
      <div className="space-y-4">
        <p className="text-sm text-text-muted">
          <span className="font-medium text-text-heading">{studentName}</span>{' '}
          さんを、すでにポータルを使っている保護者のアカウントに紐づけます。招待の発行は不要です。
        </p>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="保護者名・お子さまの名前で検索"
            className="pl-9"
          />
        </div>

        {/* 候補リスト。兄弟候補（姓の一致）が先頭に並ぶ。 */}
        <div className="max-h-72 space-y-1.5 overflow-y-auto">
          {loading ? (
            <p className="py-6 text-center text-xs text-text-faint">読み込み中...</p>
          ) : candidates.length === 0 ? (
            <p className="py-6 text-center text-xs text-text-muted">
              候補がありません。自教室の生徒に紐づいているアカウントだけが候補になります。
            </p>
          ) : (
            candidates.map((c) => {
              const isSelected = selected?.account_id === c.account_id;
              return (
                <button
                  key={c.account_id}
                  type="button"
                  onClick={() => setSelected(c)}
                  className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    isSelected
                      ? 'border-primary bg-primary-subtle'
                      : 'border-border bg-surface-raised hover:bg-surface-hover'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-text-heading">{c.display_name}</span>
                    {lineBadge(c)}
                    {c.is_sibling_candidate && (
                      <span className="shrink-0 rounded bg-ink-subtle px-1.5 py-0.5 text-[10px] font-medium text-ink">
                        兄弟候補
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
                    <Users className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                      {c.students
                        .map((s) => `${s.student_name}（${gradeLabel(s.grade)}）`)
                        .join('・')}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* 続柄。紐づけ行ごとに持つので、兄弟ごとに違う続柄でも問題ない。 */}
        {selected && (
          <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
            <p className="text-xs font-medium text-text-body">
              「{selected.display_name}」から見た {studentName} さんとの関係
            </p>
            <div className="flex gap-1.5">
              {RELATION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setRelation(opt.value)}
                  className={`rounded border px-3 py-1 text-xs transition-colors ${
                    relation === opt.value
                      ? 'border-primary bg-primary-subtle font-medium text-primary'
                      : 'border-border text-text-body hover:bg-surface-hover'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {relation === 'other' && (
              <Input
                value={relationNote}
                onChange={(e) => setRelationNote(e.target.value.slice(0, RELATION_NOTE_MAX))}
                placeholder="続柄を入力（例: 祖母）"
              />
            )}
            <p className="text-[11px] text-text-muted">
              紐づけると、この保護者は {studentName}{' '}
              さんの授業報告書・予定・成績を見られるようになります。
              間違えた場合は「解除」ですぐ外せます。
            </p>
          </div>
        )}

        {errorMessage && <p className="text-xs text-danger">{errorMessage}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            キャンセル
          </Button>
          <Button type="button" onClick={handleLink} disabled={!selected || submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'このアカウントに紐づける'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
