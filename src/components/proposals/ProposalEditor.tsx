'use client';

/**
 * ProposalEditor — 保護者向け講習提案書の作成・編集・印刷
 *
 * URL: /students/[studentId]/proposals/[proposalId]
 *   proposalId = "new" のとき新規作成（?stbId=xxx&season=summer が必要）
 *
 * 機能:
 *   - テーマ入力
 *   - テキスト全単元を表示 → 講習対象を選択
 *   - 対象単元ごとのコマ数・理由
 *   - 印刷プレビュー (print CSS 対応)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Minus,
  Plus,
  Printer,
  Save,
} from 'lucide-react';
import { AdminLayout } from '@/components/layouts';
import { useToast } from '@/hooks/useToast';
import { ToastContainer } from '@/components/ui';
import {
  getProposal,
  getTextbookUnitsWithProgress,
  upsertProposal,
} from '@/lib/api/proposals';
import { supabase } from '@/lib/supabase';
import type {
  CurriculumItem,
  SeasonalProposalWithDetails,
  SeasonType,
  StudentProgress,
} from '@/types/database';
import { SEASON_LABELS } from '@/types/database';

interface UnitDraft {
  curriculum_item_id: number;
  koma_count: number;
  reason: string;
  selected: boolean;
}

export default function ProposalEditor() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toasts, addToast, removeToast } = useToast();

  const studentId = params?.studentId as string;
  const proposalId = params?.proposalId as string;
  const isNew = proposalId === 'new';

  // クエリパラメータ（新規時）
  const qStbId = searchParams?.get('stbId') ?? '';
  const qSeason = (searchParams?.get('season') ?? 'summer') as SeasonType;
  const qYear = Number(searchParams?.get('year') ?? new Date().getFullYear());

  // 状態
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [proposal, setProposal] = useState<SeasonalProposalWithDetails | null>(null);
  const [studentTextbookId, setStudentTextbookId] = useState(qStbId);
  const [season, setSeason] = useState<SeasonType>(qSeason);
  const [year, setYear] = useState(qYear);
  const [theme, setTheme] = useState('');
  const [notes, setNotes] = useState('');

  // 全単元 + 進捗
  const [allItems, setAllItems] = useState<CurriculumItem[]>([]);
  const [progressMap, setProgressMap] = useState<Map<number, StudentProgress>>(new Map());
  const [unitDrafts, setUnitDrafts] = useState<Map<number, UnitDraft>>(new Map());

  // 生徒・テキスト情報
  const [studentName, setStudentName] = useState('');
  const [textbookName, setTextbookName] = useState('');
  const [textbookId, setTextbookId] = useState<number>(0);

  // 表示モード
  const [previewMode, setPreviewMode] = useState(false);

  // ── 初期読み込み ──
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      let stbId = studentTextbookId;
      let tbId = textbookId;

      if (!isNew && proposalId) {
        // 既存提案書を読み込み
        const data = await getProposal(proposalId);
        if (!data) {
          addToast('提案書が見つかりません', 'error');
          return;
        }
        setProposal(data);
        stbId = data.student_textbook_id;
        setStudentTextbookId(stbId);
        setSeason(data.season);
        setYear(data.year);
        setTheme(data.theme);
        setNotes(data.notes ?? '');
        tbId = data.student_textbook?.textbook?.id ?? 0;
        setTextbookId(tbId);
        setStudentName(
          data.student_textbook?.student
            ? `${data.student_textbook.student.last_name} ${data.student_textbook.student.first_name}`
            : ''
        );
        setTextbookName(data.student_textbook?.textbook?.name ?? '');
      } else if (stbId) {
        // 新規: student_textbook の情報を取得
        const { data: stb } = await supabase
          .from('student_textbooks')
          .select('*, textbook:textbooks(*), student:students(*)')
          .eq('id', stbId)
          .single();

        if (stb) {
          const st = stb as Record<string, unknown>;
          const student = st.student as { last_name: string; first_name: string } | null;
          const textbook = st.textbook as { id: number; name: string } | null;
          setStudentName(student ? `${student.last_name} ${student.first_name}` : '');
          setTextbookName(textbook?.name ?? '');
          tbId = textbook?.id ?? 0;
          setTextbookId(tbId);
        }
      }

      if (!stbId || !tbId) {
        setLoading(false);
        return;
      }

      // 全単元 + 進捗
      const { items, progressMap: pm } = await getTextbookUnitsWithProgress(stbId, tbId);
      setAllItems(items);
      setProgressMap(pm);

      // unitDrafts 初期化
      const drafts = new Map<number, UnitDraft>();
      for (const item of items) {
        drafts.set(item.id, {
          curriculum_item_id: item.id,
          koma_count: 1,
          reason: '',
          selected: false,
        });
      }

      // 既存提案の単元を反映
      if (!isNew && proposal) {
        for (const u of proposal.units) {
          const d = drafts.get(u.curriculum_item_id);
          if (d) {
            d.selected = true;
            d.koma_count = u.koma_count;
            d.reason = u.reason;
          }
        }
      }

      // 新規の場合、既に proposal_count > 0 の単元を自動選択
      if (isNew) {
        pm.forEach((prog, ciId) => {
          if (prog.proposal_count > 0) {
            const d = drafts.get(ciId);
            if (d) {
              d.selected = true;
              d.koma_count = prog.proposal_count;
            }
          }
        });
      }

      setUnitDrafts(drafts);
    } catch (e) {
      console.error(e);
      addToast('データの読み込みに失敗しました', 'error');
    } finally {
      setLoading(false);
    }
  }, [proposalId, isNew, studentTextbookId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── 単元操作 ──
  const toggleUnit = (ciId: number) => {
    setUnitDrafts((prev) => {
      const next = new Map(prev);
      const d = next.get(ciId);
      if (d) next.set(ciId, { ...d, selected: !d.selected });
      return next;
    });
  };

  const updateUnit = (ciId: number, patch: Partial<UnitDraft>) => {
    setUnitDrafts((prev) => {
      const next = new Map(prev);
      const d = next.get(ciId);
      if (d) next.set(ciId, { ...d, ...patch });
      return next;
    });
  };

  // ── 集計 ──
  const selectedUnits = useMemo(() => {
    return Array.from(unitDrafts.values()).filter((d) => d.selected);
  }, [unitDrafts]);

  const totalKoma = useMemo(() => {
    return selectedUnits.reduce((a, b) => a + b.koma_count, 0);
  }, [selectedUnits]);

  // ── 保存 ──
  const handleSave = async () => {
    if (!studentTextbookId) return;
    setSaving(true);
    try {
      const result = await upsertProposal({
        id: isNew ? undefined : proposalId,
        studentTextbookId,
        season,
        year,
        theme,
        notes: notes || null,
        units: selectedUnits.map((u) => ({
          curriculum_item_id: u.curriculum_item_id,
          koma_count: u.koma_count,
          reason: u.reason,
        })),
      });

      addToast('保存しました', 'success');

      if (isNew) {
        router.replace(`/students/${studentId}/proposals/${result.id}`);
      } else {
        setProposal(result);
      }
    } catch (e) {
      console.error(e);
      addToast('保存に失敗しました', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── 進捗判定ヘルパー ──
  const _isDone = (ciId: number): boolean => {
    const p = progressMap.get(ciId);
    if (!p) return false;
    return false;
  };

  const hasLessons = (ciId: number): boolean => {
    const p = progressMap.get(ciId);
    return !!p;
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="p-8 text-sm text-gray-400">読み込み中...</div>
      </AdminLayout>
    );
  }

  const seasonLabel = SEASON_LABELS[season] ?? season;

  // ════════════════════════════════════════
  // プレビューモード（印刷用）
  // ════════════════════════════════════════
  if (previewMode) {
    return (
      <AdminLayout>
        <div className="max-w-2xl mx-auto">
          <div className="mb-4 flex gap-2 print:hidden">
            <button
              onClick={() => setPreviewMode(false)}
              className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
            >
              <ArrowLeft className="w-4 h-4 inline mr-1" />
              編集に戻る
            </button>
            <button
              onClick={() => window.print()}
              className="px-3 py-1.5 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2c4f7c]"
            >
              <Printer className="w-4 h-4 inline mr-1" />
              印刷
            </button>
          </div>

          <ProposalPrintView
            studentName={studentName}
            textbookName={textbookName}
            seasonLabel={seasonLabel}
            year={year}
            theme={theme}
            allItems={allItems}
            selectedUnits={selectedUnits}
            progressMap={progressMap}
            totalKoma={totalKoma}
          />
        </div>
        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </AdminLayout>
    );
  }

  // ════════════════════════════════════════
  // 編集モード
  // ════════════════════════════════════════
  return (
    <AdminLayout>
      <div className="max-w-3xl mx-auto">
        {/* ヘッダー */}
        <div className="mb-6">
          <Link
            href={`/students/${studentId}/progress`}
            className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1 mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            進行表に戻る
          </Link>
          <h1 className="text-lg font-bold text-gray-900">
            {isNew ? '講習提案書を作成' : '講習提案書を編集'}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {studentName} / {textbookName} / {year}年 {seasonLabel}講習
          </p>
        </div>

        <div className="space-y-5">
          {/* テーマ */}
          <section className="p-4 bg-white rounded-xl border border-gray-200">
            <label className="text-sm font-bold text-gray-900 block mb-2">
              講習テーマ
            </label>
            <input
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
              placeholder="例: 英検3級対策 / 1年生の総復習 / 2学期の先取り"
            />
          </section>

          {/* 単元選択 */}
          <section className="p-4 bg-white rounded-xl border border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-gray-900">対象単元を選択</h2>
              <div className="text-sm text-[#1e3a5f] font-bold">
                {selectedUnits.length}単元 / {totalKoma}コマ
              </div>
            </div>

            <div className="space-y-1">
              {allItems.map((item) => {
                const draft = unitDrafts.get(item.id);
                if (!draft) return null;
                const done = hasLessons(item.id);

                return (
                  <UnitRow
                    key={item.id}
                    item={item}
                    draft={draft}
                    done={done}
                    onToggle={() => toggleUnit(item.id)}
                    onUpdate={(patch) => updateUnit(item.id, patch)}
                  />
                );
              })}
            </div>
          </section>

          {/* メモ */}
          <section className="p-4 bg-white rounded-xl border border-gray-200">
            <label className="text-sm font-bold text-gray-900 block mb-2">
              備考（内部メモ・印刷には出ません）
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f] resize-none"
              placeholder="内部メモ"
            />
          </section>

          {/* アクション */}
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !theme.trim()}
              className="flex-1 px-4 py-2.5 bg-[#1e3a5f] text-white rounded-xl text-sm font-medium hover:bg-[#2c4f7c] disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <Save className="w-4 h-4" />
              {saving ? '保存中...' : '保存'}
            </button>
            <button
              onClick={() => setPreviewMode(true)}
              className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 border border-gray-200 flex items-center gap-1.5"
            >
              <Printer className="w-4 h-4" />
              プレビュー
            </button>
          </div>
        </div>
      </div>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}

// ─── 単元行 ───

function UnitRow({
  item,
  draft,
  done,
  onToggle,
  onUpdate,
}: {
  item: CurriculumItem;
  draft: UnitDraft;
  done: boolean;
  onToggle: () => void;
  onUpdate: (patch: Partial<UnitDraft>) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`rounded-lg border transition-colors ${
        draft.selected
          ? 'border-[#1e3a5f]/30 bg-[#1e3a5f]/[0.03]'
          : 'border-gray-100 bg-white'
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        {/* チェックボックス */}
        <button
          onClick={onToggle}
          className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
            draft.selected
              ? 'bg-[#1e3a5f] border-[#1e3a5f] text-white'
              : 'border-gray-300 hover:border-gray-400'
          }`}
        >
          {draft.selected && <Check className="w-3 h-3" />}
        </button>

        {/* 単元名 */}
        <div className="flex-1 min-w-0">
          <span
            className={`text-sm ${
              done
                ? 'text-gray-400 line-through'
                : draft.selected
                  ? 'font-medium text-gray-900'
                  : 'text-gray-600'
            }`}
          >
            {item.title}
          </span>
          {done && (
            <span className="ml-1.5 text-[10px] text-gray-400">指導済</span>
          )}
        </div>

        {/* コマ数（選択時のみ） */}
        {draft.selected && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onUpdate({ koma_count: Math.max(1, draft.koma_count - 1) })}
              className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100"
            >
              <Minus className="w-3 h-3" />
            </button>
            <span className="w-8 text-center text-sm font-bold text-[#1e3a5f]">
              {draft.koma_count}
            </span>
            <button
              onClick={() => onUpdate({ koma_count: draft.koma_count + 1 })}
              className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100"
            >
              <Plus className="w-3 h-3" />
            </button>
            <span className="text-xs text-gray-400 ml-0.5">コマ</span>
          </div>
        )}

        {/* 展開ボタン（選択時のみ） */}
        {draft.selected && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        )}
      </div>

      {/* 理由入力（展開時） */}
      {draft.selected && expanded && (
        <div className="px-3 pb-2.5 pt-0">
          <input
            value={draft.reason}
            onChange={(e) => onUpdate({ reason: e.target.value })}
            className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:ring-1 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
            placeholder="この単元を講習で扱う理由（保護者に表示されます）"
          />
        </div>
      )}
    </div>
  );
}

// ─── 印刷プレビュー ───

function ProposalPrintView({
  studentName,
  textbookName,
  seasonLabel,
  year,
  theme,
  allItems,
  selectedUnits,
  progressMap,
  totalKoma,
}: {
  studentName: string;
  textbookName: string;
  seasonLabel: string;
  year: number;
  theme: string;
  allItems: CurriculumItem[];
  selectedUnits: UnitDraft[];
  progressMap: Map<number, StudentProgress>;
  totalKoma: number;
}) {
  const selectedIds = new Set(selectedUnits.map((u) => u.curriculum_item_id));
  const unitMap = new Map(selectedUnits.map((u) => [u.curriculum_item_id, u]));
  const doneCount = allItems.filter((item) => progressMap.has(item.id)).length;

  return (
    <div className="space-y-5 print:space-y-4">
      {/* ヘッダー */}
      <div className="p-5 bg-[#1e3a5f] text-white rounded-2xl print:rounded-none print:bg-white print:text-black print:border-b-2 print:border-[#1e3a5f]">
        <div className="text-lg font-bold">{year}年 {seasonLabel}講習のご提案</div>
        <div className="text-sm mt-1 opacity-90 print:opacity-100">
          {studentName} さま / {textbookName}
        </div>
      </div>

      {/* テーマ */}
      {theme && (
        <section className="p-4 bg-white rounded-xl border border-gray-200 print:border-gray-300">
          <h2 className="text-sm font-bold text-gray-900 mb-1">講習テーマ</h2>
          <p className="text-sm text-gray-800">{theme}</p>
        </section>
      )}

      {/* 進捗 */}
      <section className="p-4 bg-white rounded-xl border border-gray-200 print:border-gray-300">
        <h2 className="text-sm font-bold text-gray-900 mb-2">現在の進捗</h2>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden print:border print:border-gray-300">
            <div
              className="h-full bg-[#1e3a5f] rounded-full print:bg-gray-800"
              style={{ width: `${(doneCount / allItems.length) * 100}%` }}
            />
          </div>
          <span className="text-sm font-bold text-gray-800 shrink-0">
            {doneCount}
            <span className="text-xs font-normal text-gray-500">/{allItems.length}単元</span>
          </span>
        </div>
      </section>

      {/* 全単元一覧 */}
      <section className="p-4 bg-white rounded-xl border border-gray-200 print:border-gray-300">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-900">テキスト全単元と講習対象</h2>
          <span className="text-sm font-bold text-[#1e3a5f] print:text-gray-900">
            講習 {totalKoma}コマ / {selectedUnits.length}単元
          </span>
        </div>
        <table className="w-full text-xs">
          <thead className="border-b border-gray-200">
            <tr>
              <th className="py-2 text-left font-semibold text-gray-500">単元</th>
              <th className="py-2 text-center w-14 font-semibold text-gray-500">状況</th>
              <th className="py-2 text-center w-12 font-semibold text-gray-500">コマ</th>
              <th className="py-2 text-left font-semibold text-gray-500">講習で扱う理由</th>
            </tr>
          </thead>
          <tbody>
            {allItems.map((item) => {
              const isTarget = selectedIds.has(item.id);
              const isDone = progressMap.has(item.id);
              const unit = unitMap.get(item.id);

              return (
                <tr
                  key={item.id}
                  className={
                    isTarget
                      ? 'bg-[#1e3a5f]/5 border-b border-[#1e3a5f]/10 print:bg-gray-50'
                      : 'border-b border-gray-50'
                  }
                >
                  <td
                    className={`py-2 ${
                      isTarget
                        ? 'font-bold text-[#1e3a5f] print:text-gray-900'
                        : isDone
                          ? 'text-gray-400 line-through'
                          : 'text-gray-600'
                    }`}
                  >
                    {item.title}
                  </td>
                  <td className="py-2 text-center">
                    {isDone ? (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-400">
                        <Check className="w-3 h-3" />済
                      </span>
                    ) : isTarget ? (
                      <span className="px-1.5 py-0.5 bg-[#1e3a5f] text-white text-[10px] font-bold rounded print:bg-gray-800">
                        講習
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-300">--</span>
                    )}
                  </td>
                  <td className="py-2 text-center font-bold text-[#1e3a5f] print:text-gray-900">
                    {isTarget ? unit?.koma_count : ''}
                  </td>
                  <td className={`py-2 ${isTarget ? 'text-gray-700' : 'text-gray-300'}`}>
                    {isTarget ? unit?.reason : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* まとめ */}
      <section className="p-4 bg-gray-50 rounded-xl border border-gray-200 print:border-gray-300">
        <div className="flex items-center gap-3">
          <div className="text-sm text-gray-500">講習内容:</div>
          <div className="text-sm font-bold text-[#1e3a5f] print:text-gray-900">
            {selectedUnits.length}単元 / {totalKoma}コマ
          </div>
        </div>
      </section>
    </div>
  );
}
