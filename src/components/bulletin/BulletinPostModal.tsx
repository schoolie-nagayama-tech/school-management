'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import type { BulletinPost, BulletinLabel, BulletinTargetScope } from '@/types/bulletin';
import type { School } from '@/types/database';
import { GRADE_LABELS } from '@/types/database';
import { Modal, Button, Input } from '@/components/ui';

/**
 * audience 選択肢（社内＝スタッフ / 保護者）。
 *
 * ★ '生徒'（生徒本人宛）は選べないようにしている（2026-08-07）:
 *   ポータルのアカウントは**世帯ごとに1つ**で、保護者を名義人として発行し
 *   塾生本人も同じアカウントを使う運用に確定した。つまり relation='self' の
 *   紐づけは作られない。一方、掲示板の可視判定は
 *     relation='self' → '生徒' 宛 / relation<>'self' → '保護者' 宛
 *   （20260714010000_portal_v2_chat_bulletin.sql）なので、'生徒' 宛で投稿すると
 *   **誰にも届かない**（静かに消える）。選ばせないことでその事故を防ぐ。
 *
 *   DB・RLS・型は '生徒' を引き続き受け付ける（本番デモ校に audience=['保護者','生徒']
 *   の既存データがあり、将来 生徒本人アカウントを配る可能性も残すため）。
 *   運用を変えるならここに選択肢を戻す前に、RLS の分岐を実態に合わせること。
 */
const AUDIENCE_OPTIONS: { value: string; label: string }[] = [
  { value: '社内', label: '社内（スタッフ）' },
  { value: '保護者', label: '保護者' },
];

/** 学年チップ（1..13）。 */
const GRADE_OPTIONS = Object.entries(GRADE_LABELS).map(([n, label]) => ({
  value: Number(n),
  label,
}));

/**
 * 配信先（audience）UIの表示フラグ（2026-07-16 定数導入 / 2026-08-18 環境変数化）。
 * 保護者ポータルv2はまだ一般公開前で、実在の保護者は誰もポータルに居ないため、
 * 配信先を選ばせる意味がまだ無い。既定は従来（社内のみ）の見た目＝非表示。
 * V2試用環境で配信先UIを試すときは Vercel env（またはローカル .env.local）に
 * NEXT_PUBLIC_BULLETIN_AUDIENCE_UI='true' を設定する。クライアントコンポーネント
 * なので NEXT_PUBLIC_ が必須（ビルド時に埋め込まれる。秘密情報ではない）。
 */
const AUDIENCE_UI_ENABLED = process.env.NEXT_PUBLIC_BULLETIN_AUDIENCE_UI === 'true';

const RichTextEditor = dynamic(
  () => import('@/components/ui/RichTextEditor').then((m) => m.RichTextEditor),
  {
    loading: () => (
      <div className="min-h-[200px] flex items-center justify-center text-sm text-gray-500 border rounded-lg">
        エディタを読み込み中...
      </div>
    ),
  }
);

/** date input(YYYY-MM-DD, ローカル) → ISO timestamp。開始は 00:00:00、終了は 23:59:59。 */
function dateToTimestamp(dateStr: string, boundary: 'start' | 'end'): string | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T${boundary === 'start' ? '00:00:00' : '23:59:59'}`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** ISO timestamp → date input(YYYY-MM-DD, ローカル) */
function timestampToDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface BulletinPostModalProps {
  isOpen: boolean;
  onClose: () => void;
  post?: BulletinPost | null;
  /**
   * 編集対象がまとめカード（複数教室への同報）の場合の、全教室分の投稿ID。
   * 指定時は編集内容（タイトル・本文・リンク・ピン留め）を全教室分へ反映する。
   * ラベルは教室ごとに異なるため代表（post.id）の教室のみ更新する。
   */
  groupPostIds?: string[];
  labels: BulletinLabel[];
  schoolId: string;
  /** 複数教室時に投稿先を選択するための教室一覧 */
  schoolIds?: string[];
  schools?: School[];
  /** 新規投稿時の投稿先（複数選択可） */
  selectedSchoolIds?: string[];
  onSelectedSchoolIdsChange?: (ids: string[]) => void;
  /**
   * 保存後。新規投稿でできた投稿IDを渡す（編集では空）。
   * ★掲示板側がこれを使って依頼の読み取りを走らせる。読み取りをモーダルの中でやらないのは、
   *   AIの往復ぶん保存が遅くなり、失敗したときに投稿そのものが失敗したように見えるため。
   */
  onSaved: (createdPostIds: string[]) => void;
}

export function BulletinPostModal({
  isOpen,
  onClose,
  post,
  groupPostIds,
  labels,
  schoolId,
  schoolIds,
  schools = [],
  selectedSchoolIds = [],
  onSelectedSchoolIdsChange,
  onSaved,
}: BulletinPostModalProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [labelId, setLabelId] = useState<string | null>(null);
  const [isPinned, setIsPinned] = useState(false);
  // 公開期間（任意）。空欄なら開始=即時 / 終了=無期限。
  const [publishStartDate, setPublishStartDate] = useState('');
  const [publishEndDate, setPublishEndDate] = useState('');
  // 保護者ポータルv2(Stage2): 配信先 audience／届ける範囲。既定は社内のみ（従来動作）。
  const [audience, setAudience] = useState<string[]>(['社内']);
  const [targetScope, setTargetScope] = useState<BulletinTargetScope>('all');
  const [targetGrades, setTargetGrades] = useState<number[]>([]);
  const [targetStudentIds, setTargetStudentIds] = useState<string[]>([]);
  // 個別配信の生徒検索用。
  const [studentQuery, setStudentQuery] = useState('');
  const [studentOptions, setStudentOptions] = useState<
    { id: string; last_name: string; first_name: string; grade: number | null }[]
  >([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // 保護者/生徒に配信するか（audience に社内以外を含むか）。
  const deliversToPortal = audience.some((a) => a === '保護者' || a === '生徒');

  const availableSchools = schools.filter((s) => schoolIds?.includes(s.id)) ?? [];
  const allSelected =
    availableSchools.length > 0 && selectedSchoolIds.length >= availableSchools.length;

  useEffect(() => {
    if (post) {
      setTitle(post.title);
      setContent(post.content);
      setLinkUrl(post.link_url ?? '');
      setLabelId(post.label_id);
      setIsPinned(post.is_pinned);
      setPublishStartDate(timestampToDate(post.publish_start_at));
      setPublishEndDate(timestampToDate(post.publish_end_at));
      setAudience(post.audience && post.audience.length > 0 ? post.audience : ['社内']);
      setTargetScope(post.target_scope ?? 'all');
      setTargetGrades(post.target_grade ?? []);
      // 個別対象は編集時に別途ロードするのは重いので、ここでは触らない（未指定なら維持）。
      setTargetStudentIds([]);
    } else {
      setTitle('');
      setContent('');
      setLinkUrl('');
      setLabelId(null);
      setIsPinned(false);
      setPublishStartDate('');
      setPublishEndDate('');
      setAudience(['社内']);
      setTargetScope('all');
      setTargetGrades([]);
      setTargetStudentIds([]);
    }
    setStudentQuery('');
  }, [post, isOpen]);

  // 個別配信を選んだら、対象校の生徒を読み込む（検索用）。
  useEffect(() => {
    if (!deliversToPortal || targetScope !== 'individual') return;
    const loadSchoolId = post?.school_id ?? selectedSchoolIds[0] ?? schoolId;
    if (!loadSchoolId) return;
    let cancelled = false;
    (async () => {
      try {
        const { getStudents } = await import('@/lib/api/students');
        const list = await getStudents(undefined, [loadSchoolId], undefined, {
          includeTest: false,
        });
        if (!cancelled) {
          setStudentOptions(
            list.map((s) => ({
              id: s.id,
              last_name: s.last_name,
              first_name: s.first_name,
              grade: s.grade ?? null,
            }))
          );
        }
      } catch {
        if (!cancelled) setStudentOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deliversToPortal, targetScope, post?.school_id, selectedSchoolIds, schoolId]);

  const isContentEmpty = (html: string) => {
    const text = html.replace(/<[^>]*>/g, '').trim();
    return text.length === 0;
  };

  const normalizeLinkUrl = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  };

  const isInvalidLinkUrl = (() => {
    const trimmed = linkUrl.trim();
    if (!trimmed) return false;
    try {
      const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
      return !(url.hostname && url.hostname.includes('.'));
    } catch {
      return true;
    }
  })();

  // 公開終了日が開始日より前は不正
  const isInvalidPeriod = !!(
    publishStartDate &&
    publishEndDate &&
    publishEndDate < publishStartDate
  );

  const handleSubmit = async () => {
    if (!title.trim() || isContentEmpty(content) || isInvalidPeriod) {
      return;
    }

    const targetSchoolIds = post
      ? [post.school_id]
      : selectedSchoolIds.length > 0
        ? selectedSchoolIds
        : [schoolId];
    if (targetSchoolIds.length === 0) {
      setErrorMessage('投稿先の教室を1つ以上選択してください');
      return;
    }

    setIsSubmitting(true);
    try {
      const { createBulletinPost, updateBulletinPost } = await import('@/lib/api/bulletin');
      const { supabase } = await import('@/lib/supabase');

      const {
        data: { user },
      } = await supabase.auth.getUser();
      const userId = user?.id;

      /** 新規に作った投稿のID。掲示板側が依頼の読み取りに使う */
      const createdPostIds: string[] = [];

      const normalizedLink = normalizeLinkUrl(linkUrl);
      const publishStartAt = dateToTimestamp(publishStartDate, 'start');
      const publishEndAt = dateToTimestamp(publishEndDate, 'end');
      // 配信先の共通フィールド。
      // AUDIENCE_UI_ENABLED=false の間はUIから配信先を変更できないため、新規投稿は常に社内のみで送る
      // （社内のみ＝deliversToPortal=false のときの既定値と同じ）。
      const audienceFields = AUDIENCE_UI_ENABLED
        ? {
            audience,
            target_scope: deliversToPortal ? targetScope : ('all' as BulletinTargetScope),
            target_grade: deliversToPortal && targetScope === 'grade' ? targetGrades : null,
            target_student_ids:
              deliversToPortal && targetScope === 'individual' ? targetStudentIds : [],
          }
        : {
            audience: ['社内'],
            target_scope: 'all' as BulletinTargetScope,
            target_grade: null,
            target_student_ids: [] as string[],
          };

      if (post) {
        // 代表の教室はラベルも含めて更新する。
        // AUDIENCE_UI_ENABLED=false のときは audience 系キーを一切送らない
        // （updateBulletinPostは未指定キーを更新しない＝既存の配信先設定を維持する。
        //  本番デモ校には audience=['保護者','生徒'] のお知らせが既にあり、
        //  ここで ['社内'] を送ると黙って上書き・ポータルから消えてしまうため）。
        await updateBulletinPost(
          post.id,
          {
            title: title.trim(),
            content: content,
            link_url: normalizedLink,
            label_id: labelId,
            is_pinned: isPinned,
            publish_start_at: publishStartAt,
            publish_end_at: publishEndAt,
            ...(AUDIENCE_UI_ENABLED ? audienceFields : {}),
          },
          userId
        );
        // まとめカードの編集は、他教室分にも内容を反映する（ラベルは各教室のを維持）
        // 個別対象(target_student_ids)は代表校の生徒なので他校には配らない。
        const siblingIds = (groupPostIds ?? []).filter((id) => id !== post.id);
        for (const sid of siblingIds) {
          await updateBulletinPost(
            sid,
            {
              title: title.trim(),
              content: content,
              link_url: normalizedLink,
              is_pinned: isPinned,
              publish_start_at: publishStartAt,
              publish_end_at: publishEndAt,
              ...(AUDIENCE_UI_ENABLED
                ? {
                    audience,
                    target_scope: audienceFields.target_scope,
                    target_grade: audienceFields.target_grade,
                  }
                : {}),
            },
            userId
          );
        }
      } else {
        const payload = {
          title: title.trim(),
          content,
          link_url: normalizedLink,
          label_id: targetSchoolIds.length === 1 ? labelId : null,
          is_pinned: isPinned,
          publish_start_at: publishStartAt,
          publish_end_at: publishEndAt,
          ...audienceFields,
        };
        for (const sid of targetSchoolIds) {
          const created = await createBulletinPost(sid, payload, userId);
          if (created?.id) createdPostIds.push(created.id);
        }
      }

      onSaved(createdPostIds);
      onClose();
    } catch (error) {
      console.error('Error saving post:', error);
      setErrorMessage('保存に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  const showSchoolSelector =
    !post && schoolIds && schoolIds.length > 1 && availableSchools.length > 0;

  const toggleSchool = (id: string) => {
    if (selectedSchoolIds.includes(id)) {
      onSelectedSchoolIdsChange?.(selectedSchoolIds.filter((s) => s !== id));
    } else {
      onSelectedSchoolIdsChange?.([...selectedSchoolIds, id]);
    }
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      onSelectedSchoolIdsChange?.([]);
    } else {
      onSelectedSchoolIdsChange?.(availableSchools.map((s) => s.id));
    }
  };

  return (
    // 連絡は長文になりがちなので、入力欄を広く取れるよう横幅を lg に広げる
    // （本文エディタ自体も右下ハンドルで縦に伸ばせる）。
    <Modal isOpen={isOpen} onClose={onClose} title={post ? '投稿を編集' : '新規投稿'} size="lg">
      <div className="space-y-4">
        {errorMessage && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {errorMessage}
          </div>
        )}
        {showSchoolSelector && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-[#1f2937]">投稿先の教室</label>
              <button
                type="button"
                onClick={toggleSelectAll}
                className="text-xs text-[#1e3a5f] hover:underline"
              >
                {allSelected ? 'すべて解除' : 'すべて選択'}
              </button>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2 bg-white">
              {availableSchools.map((s) => (
                <label
                  key={s.id}
                  className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded px-2 py-1.5"
                >
                  <input
                    type="checkbox"
                    checked={selectedSchoolIds.includes(s.id)}
                    onChange={() => toggleSchool(s.id)}
                    className="w-4 h-4 rounded border-gray-300 text-[#1e3a5f] focus:ring-[#1e3a5f]"
                  />
                  <span className="text-sm text-[#1f2937]">
                    {s.code === 'DEFAULT' ? 'デフォルト' : s.name}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-1">
            タイトル <span className="text-[#ef4444]">*</span>
          </label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="タイトルを入力"
            className="w-full"
          />
        </div>

        {(!showSchoolSelector || selectedSchoolIds.length <= 1) && (
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-1">ラベル</label>
            <select
              value={labelId || ''}
              onChange={(e) => setLabelId(e.target.value || null)}
              className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:ring-2 focus:ring-[#3b82f6] focus:border-[#3b82f6]"
            >
              <option value="">ラベルなし</option>
              {labels.map((label) => (
                <option key={label.id} value={label.id}>
                  {label.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {showSchoolSelector && selectedSchoolIds.length > 1 && (
          <p className="text-xs text-gray-500">複数教室への投稿のため、ラベルは付きません。</p>
        )}

        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-1">
            本文 <span className="text-[#ef4444]">*</span>
          </label>
          <RichTextEditor
            key={post?.id ?? 'new'}
            value={content}
            onChange={setContent}
            placeholder="本文を入力（太字・見出しなどが使えます）"
            minHeight="280px"
            resizable
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-1">
            リンク URL（任意）
          </label>
          <Input
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://example.com"
            className="w-full"
          />
          {isInvalidLinkUrl && (
            <p className="mt-1 text-xs text-[#ef4444]">URL の形式が正しくありません</p>
          )}
        </div>

        {/* 公開期間（任意）。期間外は講師に表示されず未読にも数えない（データは残る）。 */}
        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-1">公開期間（任意）</label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={publishStartDate}
              onChange={(e) => setPublishStartDate(e.target.value)}
              aria-label="公開開始日"
              className="px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#1f2937] focus:ring-2 focus:ring-[#3b82f6] focus:border-[#3b82f6]"
            />
            <span className="text-sm text-gray-400">〜</span>
            <input
              type="date"
              value={publishEndDate}
              min={publishStartDate || undefined}
              onChange={(e) => setPublishEndDate(e.target.value)}
              aria-label="公開終了日"
              className="px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#1f2937] focus:ring-2 focus:ring-[#3b82f6] focus:border-[#3b82f6]"
            />
            {(publishStartDate || publishEndDate) && (
              <button
                type="button"
                onClick={() => {
                  setPublishStartDate('');
                  setPublishEndDate('');
                }}
                className="text-xs text-gray-500 hover:text-gray-700 underline"
              >
                クリア
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            未入力なら常時公開。期間を過ぎた連絡は講師には表示されなくなります（データは残るので管理者は引き続き確認できます）。
          </p>
          {isInvalidPeriod && (
            <p className="mt-1 text-xs text-[#ef4444]">終了日は開始日以降にしてください</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="isPinned"
            checked={isPinned}
            onChange={(e) => setIsPinned(e.target.checked)}
            className="w-4 h-4"
          />
          <label htmlFor="isPinned" className="text-sm text-[#1f2937]">
            ピン留めする
          </label>
        </div>

        {/*
          配信先（audience）と届ける範囲（保護者ポータルv2 Stage2）。
          AUDIENCE_UI_ENABLED=false の間は非表示（Stage2以前と同じ見た目に戻す）。
          JSXは削除せずフラグで丸ごと出し分ける（将来ポータルを保護者に開放するときに復活させる）。
        */}
        {AUDIENCE_UI_ENABLED && (
          <div className="rounded-lg border border-[#e5e7eb] p-3">
            <label className="mb-2 block text-sm font-medium text-[#1f2937]">配信先</label>
            <div className="flex flex-wrap gap-2">
              {AUDIENCE_OPTIONS.map((opt) => {
                const checked = audience.includes(opt.value);
                return (
                  <label
                    key={opt.value}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${
                      checked
                        ? 'border-[#1e3a5f] bg-[#1e3a5f]/10 text-[#1f2937]'
                        : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setAudience((prev) =>
                          prev.includes(opt.value)
                            ? prev.filter((a) => a !== opt.value)
                            : [...prev, opt.value]
                        )
                      }
                      className="h-4 w-4"
                    />
                    {opt.label}
                  </label>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-gray-500">
              既定は「社内」のみ（従来どおりスタッフだけに表示）。保護者・生徒に出すときだけ選択します。
            </p>

            {deliversToPortal && (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <label className="mb-2 block text-sm font-medium text-[#1f2937]">届ける範囲</label>
                <div className="mb-2 flex gap-2">
                  {(
                    [
                      { key: 'all', label: '全体' },
                      { key: 'grade', label: '学年' },
                      { key: 'individual', label: '個別' },
                    ] as { key: BulletinTargetScope; label: string }[]
                  ).map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setTargetScope(s.key)}
                      className={`flex-1 rounded-lg border px-3 py-1.5 text-sm ${
                        targetScope === s.key
                          ? 'border-[#1e3a5f] bg-[#1e3a5f]/10 font-medium text-[#1f2937]'
                          : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>

                {targetScope === 'grade' && (
                  <div className="flex flex-wrap gap-1.5">
                    {GRADE_OPTIONS.map((g) => {
                      const on = targetGrades.includes(g.value);
                      return (
                        <button
                          key={g.value}
                          type="button"
                          onClick={() =>
                            setTargetGrades((prev) =>
                              prev.includes(g.value)
                                ? prev.filter((v) => v !== g.value)
                                : [...prev, g.value]
                            )
                          }
                          className={`rounded-full border px-2.5 py-1 text-xs ${
                            on
                              ? 'border-[#1e3a5f] bg-[#1e3a5f]/10 text-[#1f2937]'
                              : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                          }`}
                        >
                          {g.label}
                        </button>
                      );
                    })}
                  </div>
                )}

                {targetScope === 'individual' && (
                  <div>
                    <Input
                      value={studentQuery}
                      onChange={(e) => setStudentQuery(e.target.value)}
                      placeholder="生徒名で検索"
                      className="mb-2 w-full"
                    />
                    <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2">
                      {studentOptions
                        .filter((s) =>
                          studentQuery
                            ? `${s.last_name}${s.first_name}`.includes(studentQuery)
                            : true
                        )
                        .slice(0, 50)
                        .map((s) => (
                          <label
                            key={s.id}
                            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-gray-50"
                          >
                            <input
                              type="checkbox"
                              checked={targetStudentIds.includes(s.id)}
                              onChange={() =>
                                setTargetStudentIds((prev) =>
                                  prev.includes(s.id)
                                    ? prev.filter((id) => id !== s.id)
                                    : [...prev, s.id]
                                )
                              }
                              className="h-4 w-4"
                            />
                            <span className="text-sm text-[#1f2937]">
                              {s.last_name} {s.first_name}
                              {s.grade != null && (
                                <span className="ml-1 text-xs text-gray-400">
                                  {GRADE_LABELS[s.grade] ?? s.grade}
                                </span>
                              )}
                            </span>
                          </label>
                        ))}
                      {studentOptions.length === 0 && (
                        <p className="px-2 py-1 text-xs text-gray-400">生徒を読み込み中…</p>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      選択中: {targetStudentIds.length} 名
                    </p>
                  </div>
                )}

                {/* 対象人数プレビュー（学年） */}
                {targetScope === 'grade' && targetGrades.length > 0 && (
                  <p className="mt-2 text-xs text-gray-500">
                    対象学年: {targetGrades.map((g) => GRADE_LABELS[g] ?? g).join('・')}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} variant="ghost">
            キャンセル
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              !title.trim() ||
              isContentEmpty(content) ||
              isInvalidLinkUrl ||
              isInvalidPeriod ||
              isSubmitting ||
              (!post && showSchoolSelector && selectedSchoolIds.length === 0)
            }
          >
            {isSubmitting ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
