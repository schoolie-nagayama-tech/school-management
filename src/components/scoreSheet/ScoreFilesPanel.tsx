'use client';

/**
 * 成績表の欄：PDF を入れる／読み取った中身を確かめる／検算が合わない領域の○×を直す。
 * 正典: docs/score-sheet-plan-draft.md §7
 *
 * ★検算が合わない領域は、人が○×を直して「確かめた」を押すまで下書きに使わない（mockSheet.pickWrongItems）。
 */

import { useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronUp, FileUp, Loader2 } from 'lucide-react';
import { checkArea } from '@/lib/scoreSheet/mockSheet';
import type { MockResult, MockSheet, PcsReading, ScoreSubject } from '@/lib/scoreSheet/types';
import { SCORE_SUBJECT_LABEL } from '@/lib/scoreSheet/types';

export interface ScoreFileEntry {
  id: string;
  name: string;
  status: 'reading' | 'ok' | 'error';
  kind?: 'pcs' | 'mock';
  pcs?: PcsReading;
  mock?: MockSheet;
  /** 帳票の氏名が選んでいる生徒と違う（止めはしないが目立たせる） */
  nameMismatch?: boolean;
  message?: string;
}

const RESULT_LABEL: Record<string, string> = {
  o: '○',
  x: '×',
  x_to_double: '×→◎',
  x_to_star: '×→★',
};
const resultText = (r: MockResult) => (typeof r === 'number' ? `${r}点` : RESULT_LABEL[r]);
const NEXT_RESULT: Record<string, MockResult> = {
  o: 'x',
  x: 'o',
  x_to_double: 'o',
  x_to_star: 'o',
};

export function ScoreFilesPanel({
  files,
  confirmedAreas,
  onAddFiles,
  onFlipResult,
  onConfirmArea,
}: {
  files: ScoreFileEntry[];
  confirmedAreas: Record<ScoreSubject, Set<string>>;
  onAddFiles: (files: File[]) => void;
  onFlipResult: (
    fileId: string,
    subject: ScoreSubject,
    area: string,
    itemIndex: number,
    next: MockResult
  ) => void;
  onConfirmArea: (subject: ScoreSubject, area: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const pick = (list: FileList | null) => {
    const pdfs = Array.from(list ?? []).filter(
      (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
    );
    if (pdfs.length > 0) onAddFiles(pdfs);
  };

  return (
    <section className="p-4 bg-surface-raised rounded-xl border border-border space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-bold text-text-heading">成績表</h2>
        <span className="text-[11px] text-text-faint">押すと読み取った中身を確かめられます</span>
      </div>

      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((f) => {
            const isOpen = open === f.id;
            return (
              <li key={f.id} className="rounded-lg border border-border-subtle overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : f.id)}
                  aria-expanded={isOpen}
                  disabled={f.status !== 'ok'}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left bg-surface-raised hover:bg-surface-hover disabled:hover:bg-surface-raised transition-[background-color] duration-150"
                >
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-text-on-primary ${
                      f.kind === 'pcs' ? 'bg-purple-600' : 'bg-teal-700'
                    }`}
                  >
                    {f.kind === 'pcs'
                      ? 'PCS'
                      : f.mock?.docType === 'vmogi_tokyo'
                        ? 'Vもぎ'
                        : f.kind === 'mock'
                          ? '進研'
                          : 'PDF'}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-text-heading truncate">
                      {f.name}
                    </span>
                    <span className="block text-[11px] text-text-muted">{fileSubtitle(f)}</span>
                  </span>
                  <span className="shrink-0 text-xs font-bold">
                    {fileStatus(f, confirmedAreas)}
                  </span>
                  {f.status === 'ok' &&
                    (isOpen ? (
                      <ChevronUp className="w-4 h-4 text-text-faint" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-text-faint" />
                    ))}
                </button>
                {f.nameMismatch && (
                  <p className="px-3 pb-2 text-[11px] font-bold text-danger flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    帳票の氏名が、選んでいる生徒と違います。別の生徒の帳票でないか確かめてください
                  </p>
                )}
                {isOpen && f.pcs && <PcsDetail r={f.pcs} />}
                {isOpen && f.mock && (
                  <MockDetail
                    fileId={f.id}
                    sheet={f.mock}
                    confirmedAreas={confirmedAreas}
                    onFlipResult={onFlipResult}
                    onConfirmArea={onConfirmArea}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          pick(e.dataTransfer.files);
        }}
        className={`rounded-lg border-2 border-dashed px-3 py-4 text-center text-xs text-text-muted transition-[border-color,background-color] duration-150 ${
          dragOver ? 'border-accent-ink bg-accent-ink-subtle' : 'border-border'
        }`}
      >
        <p>PCS の結果帳票・進研テスト・Vもぎの個人帳票（PDF）をここにドラッグ</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-ink text-text-on-primary rounded-md hover:brightness-[0.85] transition-[filter] duration-150"
        >
          <FileUp className="w-3 h-3" />
          ファイルを選ぶ
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = '';
          }}
        />
        <p className="mt-2 text-[11px] text-text-faint">
          PCS は画面の中で読み取ります（どこにも送りません）。模試は1・2ページ目の画像だけを AI
          に送って読み取ります
        </p>
      </div>
    </section>
  );
}

function fileSubtitle(f: ScoreFileEntry): string {
  if (f.status === 'reading') return '読み取っています…';
  if (f.status === 'error') return f.message ?? '読み取れませんでした';
  if (f.pcs) {
    return `${SCORE_SUBJECT_LABEL[f.pcs.subject]}・${f.pcs.examLabel ?? '回不明'}（文字から読み取り・AIなし）`;
  }
  if (f.mock) return `${f.mock.examLabel ?? ''}（画像を AI で読み取り → 領域の得点率で検算）`;
  return '';
}

function fileStatus(f: ScoreFileEntry, confirmed: Record<ScoreSubject, Set<string>>) {
  if (f.status === 'reading') return <Loader2 className="w-4 h-4 animate-spin text-text-muted" />;
  if (f.status === 'error') return <span className="text-danger">読み取れず</span>;
  if (f.pcs) {
    const n = f.pcs.units.filter((u) => u.now).length;
    return <span className="text-success">印 {n}件</span>;
  }
  if (f.mock) {
    let ok = 0;
    let total = 0;
    let bad = 0;
    (['math', 'eng'] as ScoreSubject[]).forEach((s) =>
      (f.mock!.subjects[s] ?? []).forEach((a) => {
        const c = checkArea(a);
        if (c.status === 'partial') return;
        total += 1;
        if (c.status === 'ok' || confirmed[s].has(a.name)) ok += 1;
        else bad += 1;
      })
    );
    return bad > 0 ? (
      <span className="text-danger">検算 {bad}領域 不一致</span>
    ) : (
      <span className="text-success">
        検算 {ok}/{total}領域 一致
      </span>
    );
  }
  return null;
}

function PcsDetail({ r }: { r: PcsReading }) {
  return (
    <div className="border-t border-border-subtle bg-surface-hover/40 px-3 py-2 space-y-2 text-xs">
      {(['×', '△', '●'] as const).map((m) => {
        const list = r.units.filter((u) => u.now === m);
        return (
          <div key={m}>
            <p
              className={`font-bold ${m === '×' ? 'text-danger' : m === '△' ? 'text-warning' : 'text-success'}`}
            >
              {m} {list.length}件
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {list.map((u) => (
                <span
                  key={`${u.group}｜${u.unit}`}
                  className="rounded border border-border bg-surface-raised px-1.5"
                >
                  {u.unit}
                </span>
              ))}
            </div>
          </div>
        );
      })}
      <p className="text-text-faint">印の無い単元は「出題なし」です。</p>
      {r.orphanMarks > 0 && (
        <p className="text-danger">
          単元に当てられなかった印が {r.orphanMarks}{' '}
          件あります（帳票の様式が変わったかもしれません）
        </p>
      )}
    </div>
  );
}

function MockDetail({
  fileId,
  sheet,
  confirmedAreas,
  onFlipResult,
  onConfirmArea,
}: {
  fileId: string;
  sheet: MockSheet;
  confirmedAreas: Record<ScoreSubject, Set<string>>;
  onFlipResult: (
    fileId: string,
    subject: ScoreSubject,
    area: string,
    itemIndex: number,
    next: MockResult
  ) => void;
  onConfirmArea: (subject: ScoreSubject, area: string) => void;
}) {
  return (
    <div className="border-t border-border-subtle bg-surface-hover/40 px-3 py-2 space-y-3 text-xs">
      <p className="text-text-body">
        偏差値 数学 {sheet.ss.math ?? '―'}・英語 {sheet.ss.eng ?? '―'}
        {sheet.firstChoice && (
          <>
            ／第1志望 {sheet.firstChoice.name}（合格基準の偏差値{' '}
            {sheet.firstChoice.baseSs ?? '読めず'}）
          </>
        )}
      </p>
      {(['math', 'eng'] as ScoreSubject[]).map((s) =>
        (sheet.subjects[s] ?? []).map((a) => {
          const c = checkArea(a);
          const confirmed = confirmedAreas[s].has(a.name);
          const mismatch = c.status === 'mismatch' && !confirmed;
          return (
            <div
              key={`${s}-${a.name}`}
              className={`rounded border ${mismatch ? 'border-danger' : 'border-border-subtle'} bg-surface-raised`}
            >
              <div className="flex items-center justify-between gap-2 px-2 py-1">
                <span className="font-bold text-text-heading">
                  {SCORE_SUBJECT_LABEL[s]}／{a.name}
                </span>
                <span
                  className={
                    mismatch
                      ? 'text-danger font-bold'
                      : c.status === 'partial'
                        ? 'text-warning'
                        : 'text-success'
                  }
                >
                  {c.status === 'partial'
                    ? '部分点：検算の対象外'
                    : c.status === 'ok'
                      ? `検算一致（${c.counted}%）`
                      : confirmed
                        ? '人が確かめた'
                        : `不一致：帳票 ${c.printed}%・数え直し ${c.counted}%`}
                </span>
              </div>
              {(mismatch || c.status === 'partial' || a.items.some((i) => i.result !== 'o')) && (
                <ul className="border-t border-border-subtle">
                  {a.items.map((it, idx) => {
                    if (!mismatch && it.result === 'o') return null;
                    return (
                      <li key={`${it.q}-${idx}`} className="flex items-center gap-2 px-2 py-0.5">
                        <span className="w-16 shrink-0 text-text-muted tabular-nums">{it.q}</span>
                        <span className="flex-1 min-w-0 truncate">{it.content}</span>
                        <span className="w-14 shrink-0 text-right tabular-nums text-text-faint">
                          {it.rate != null
                            ? `${it.rate}%`
                            : it.avg != null
                              ? `平均${it.avg}点`
                              : ''}
                        </span>
                        {mismatch && typeof it.result !== 'number' ? (
                          <button
                            type="button"
                            onClick={() =>
                              onFlipResult(fileId, s, a.name, idx, NEXT_RESULT[it.result as string])
                            }
                            className="w-12 shrink-0 rounded border border-border px-1 font-bold hover:bg-surface-hover"
                            title="押すと○と×を入れ替えます"
                          >
                            {resultText(it.result)}
                          </button>
                        ) : (
                          <span
                            className={`w-12 shrink-0 text-center font-bold ${it.result === 'o' ? 'text-success' : 'text-danger'}`}
                          >
                            {resultText(it.result)}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {mismatch && (
                <div className="border-t border-border-subtle px-2 py-1.5 flex items-center gap-2 flex-wrap">
                  <span className="text-text-muted">
                    帳票と見比べて○×を直してから押してください。押すまで下書きに使いません
                  </span>
                  <button
                    type="button"
                    onClick={() => onConfirmArea(s, a.name)}
                    className="inline-flex items-center gap-1 rounded-md bg-ink px-2 py-0.5 font-medium text-text-on-primary"
                  >
                    <Check className="w-3 h-3" />
                    確かめた
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}
      <p className="text-text-faint">
        作図・証明・英作文は部分点です。本人の得点が平均点より低いものを×として扱います（ここだけは人が確かめてください）。
      </p>
    </div>
  );
}
