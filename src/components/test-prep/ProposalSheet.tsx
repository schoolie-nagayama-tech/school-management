'use client';

/**
 * テスト対策提案書の紙面（保護者向け）。
 *
 * 公開ページ `/test-prep/[token]` とモック `/test-prep/mock` の両方から使う。
 * 以前は同じマークアップが2ファイルに複製されていて、片方だけ直ると見た目がずれていた。
 *
 * 見た目の方針は保護者ポータルのフォームに揃えている（保護者は100%スマホで開く）:
 *  - 大きな白カード1枚に全部を詰めず、意味の単位で白カードを分ける
 *  - ヘッダーは赤ベタの帯ではなくエディトリアル（見出し＋赤の短い罫）
 *  - 表は table-fixed + colgroup。単元名は折り返す（以前は横スクロールしていた）
 *  - 注記は小さく。長文の案内は要点だけに絞る
 *
 * 印刷はA4縦1枚が前提。科目カードは印刷時3段組にし、`print:` 修飾で全体を圧縮する。
 */
import { ArrowRight } from 'lucide-react';

export const ASSESSMENT_STYLES: Record<string, string> = {
  '◎': 'text-blue-600 font-bold',
  '○': 'text-green-600 font-bold',
  '△': 'text-yellow-600 font-bold',
  '×': 'text-red-600 font-bold',
};

export interface ProposalSheetUnit {
  id: string;
  name: string;
  assessment: string | null;
  koma: number;
  /** 同じ group_id の単元はコマ数セルを結合して1つにまとめる */
  groupId: string | null;
}

export interface ProposalSheetSubject {
  id: string;
  name: string;
  targetScore: number | null;
  units: ProposalSheetUnit[];
}

export interface ProposalSheetData {
  schoolName: string;
  title: string;
  /** 保護者向けなので姓のみ（呼び出し側で丸めてから渡すこと） */
  teacherName: string;
  studentName: string;
  studentGrade: string;
  examName: string;
  notes: string | null;
  subjects: ProposalSheetSubject[];
  /** 自己評価マーク → 説明ラベル */
  assessmentLabels: Record<string, string>;
}

interface ProposalSheetProps {
  data: ProposalSheetData;
  /** 印刷時のQRコードに載せるURL。無ければQR欄ごと出さない */
  printUrl?: string | null;
  /** 申込導線の有無で案内文の言い回しを変える */
  hasApplyLink?: boolean;
}

export function ProposalSheet({ data, printUrl, hasApplyLink = true }: ProposalSheetProps) {
  const totalKoma = data.subjects.reduce(
    (sum, s) => sum + s.units.reduce((us, u) => us + u.koma, 0),
    0
  );

  return (
    <div className="space-y-4 print:space-y-2">
      {/* ヘッダー。赤ベタの帯は白黒印刷で真っ黒に潰れるので、画面・印刷とも
          「赤の短い罫」だけで見出しを立てる（ポータルのフォームと同じ作り） */}
      <header className="pt-1 print:pt-0">
        {data.schoolName && (
          <p className="text-[11px] font-semibold tracking-[0.18em] text-red-600 mb-1.5 print:mb-0.5 print:text-[9px] print:tracking-normal print:text-gray-500">
            {data.schoolName}
          </p>
        )}
        <h1 className="text-[24px] font-bold text-[#1a1a1a] leading-tight tracking-tight print:text-[17px]">
          {data.title}
        </h1>
        <div className="mt-2.5 h-[2px] w-10 bg-red-600 rounded-full print:mt-1 print:w-8" />
        {data.teacherName && (
          <p className="mt-2 text-xs text-[#6b7280] print:mt-1 print:text-[10px]">
            担当: {data.teacherName}
          </p>
        )}
      </header>

      {/* 生徒と提案コマ数 */}
      <section className="bg-white rounded-2xl border border-[#e5e7eb] p-4 print:rounded-none print:border-0 print:border-b print:border-gray-300 print:p-0 print:pb-1.5">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] text-[#9ca3af] print:text-[9px]">生徒名</p>
            <p className="text-lg font-bold text-[#1a1a1a] truncate print:text-[14px]">
              {data.studentName}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5 print:mt-0.5 print:gap-1">
              <span className="px-2 py-0.5 rounded-full bg-[#f3f4f6] text-[11px] text-[#4b5563] print:text-[9px] print:px-1.5 print:py-0">
                {data.studentGrade}
              </span>
              {data.examName && (
                <span className="px-2 py-0.5 rounded-full bg-[#f3f4f6] text-[11px] text-[#4b5563] print:text-[9px] print:px-1.5 print:py-0">
                  {data.examName}
                </span>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[11px] text-[#9ca3af] print:text-[9px]">提案コマ数</p>
            <p className="text-[26px] font-bold text-red-600 leading-none print:text-[18px] print:text-gray-900">
              {totalKoma}
              <span className="text-sm font-normal text-[#6b7280] ml-1 print:text-[10px]">
                コマ
              </span>
            </p>
          </div>
        </div>
      </section>

      {/* 保護者向けの案内。紙で渡されても目的が伝わるように残すが、スマホで
          12行の壁になっていたので要点だけに絞っている */}
      <section className="bg-white rounded-2xl border border-[#e5e7eb] p-4 print:rounded-none print:border print:border-gray-300 print:p-2">
        <h2 className="text-[13px] font-bold text-[#1a1a1a] mb-1.5 print:text-[11px] print:mb-0.5">
          保護者の皆様へ
        </h2>
        <p className="text-[13px] text-[#4b5563] leading-relaxed print:text-[10px] print:leading-snug">
          次回の定期テストに向けて、担当講師がお子様の到達状況をもとに作成した対策プランです。
          科目・単元ごとに、目標点の達成に必要と考えられるコマ数の目安をまとめています。
          {hasApplyLink
            ? '追加の対策コマ（増コマ）のお申し込みは、下部のフォーム（印刷の場合はQRコード）から承ります。'
            : '追加の対策コマ（増コマ）をご希望の場合は、教室までお申し付けください。'}
        </p>
      </section>

      {/* 担当講師からのメッセージ */}
      {data.notes && (
        <section className="bg-white rounded-2xl border border-[#e5e7eb] p-4 print:rounded-none print:border print:border-gray-300 print:p-2">
          <h2 className="text-[13px] font-bold text-[#1a1a1a] mb-1.5 print:text-[11px] print:mb-0.5">
            担当講師より
          </h2>
          <p className="text-[13px] text-[#4b5563] leading-relaxed whitespace-pre-line print:text-[10px] print:leading-snug">
            {data.notes}
          </p>
        </section>
      )}

      {/* 科目ごとの対策プラン */}
      <section className="space-y-2.5 print:space-y-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1 print:px-0 print:mb-1">
          <h2 className="text-[13px] font-bold text-[#1a1a1a] print:text-[11px]">
            科目ごとの対策プラン
          </h2>
          {/* 凡例。以前は折り返しで「よくで／きる」と割れていたので、
              各項目を nowrap にして塊ごとに折り返させる */}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-[#6b7280] print:text-[9px] print:gap-x-2">
            <span className="text-[#9ca3af] whitespace-nowrap">自己評価</span>
            {Object.entries(data.assessmentLabels).map(([mark, label]) => (
              <span key={mark} className="inline-flex items-center gap-1 whitespace-nowrap">
                <span className={ASSESSMENT_STYLES[mark]}>{mark}</span>
                {label}
              </span>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 print:grid-cols-3 print:gap-1.5">
          {data.subjects.map((subject) => (
            <SubjectCard key={subject.id} subject={subject} />
          ))}
        </div>
      </section>

      {/* 印刷用QRコード（画面では出さない） */}
      {printUrl && (
        <div className="hidden print:block border-t border-dashed border-gray-300 pt-2 break-inside-avoid">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- 外部QR生成サービスの画像。next/image の最適化対象にしない */}
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(printUrl)}`}
              alt="お申し込みページのQRコード"
              className="w-20 h-20 shrink-0"
            />
            <div className="min-w-0">
              <p className="font-bold text-gray-900 text-[10px]">
                提案内容の確認・増コマのお申し込み
              </p>
              <p className="text-[9px] text-gray-600 mt-0.5 leading-snug">
                スマートフォンでQRコードを読み取るか、以下のURLからお申し込みください。
              </p>
              <p className="text-[9px] text-gray-700 mt-0.5 font-mono break-all">{printUrl}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 同じ group_id の単元をまとめ、コマ数セルを rowSpan で結合するための行データを作る */
function buildGroupedRows(units: ProposalSheetUnit[]) {
  const rows: Array<{
    unit: ProposalSheetUnit;
    isGroupStart: boolean;
    isGroupMember: boolean;
    groupSize: number;
  }> = [];
  const list = units || [];
  let i = 0;
  while (i < list.length) {
    const u = list[i];
    if (u.groupId) {
      const gid = u.groupId;
      const start = i;
      while (i < list.length && list[i].groupId === gid) i++;
      const size = i - start;
      for (let j = start; j < i; j++) {
        rows.push({
          unit: list[j],
          isGroupStart: j === start,
          isGroupMember: true,
          groupSize: size,
        });
      }
    } else {
      rows.push({ unit: u, isGroupStart: false, isGroupMember: false, groupSize: 1 });
      i++;
    }
  }
  return rows;
}

function SubjectCard({ subject }: { subject: ProposalSheetSubject }) {
  const totalKoma = subject.units.reduce((sum, u) => sum + u.koma, 0);
  const rows = buildGroupedRows(subject.units);

  return (
    <div className="bg-white rounded-2xl border border-[#e5e7eb] overflow-hidden print:rounded print:break-inside-avoid">
      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-[#1f2937] text-white print:px-2 print:py-1">
        <span className="font-bold text-sm print:text-[11px]">{subject.name}</span>
        {subject.targetScore != null && (
          <span className="text-[11px] text-gray-300 shrink-0 print:text-[9.5px]">
            目標 <span className="text-yellow-300 font-bold">{subject.targetScore}</span>点
          </span>
        )}
      </div>
      {/* table-fixed + colgroup で単元名を折り返す。以前は自動レイアウトで
          長い単元名が表を押し広げ、スマホで横スクロールが出ていた */}
      <table className="w-full table-fixed text-[13px] print:text-[9.5px]">
        <colgroup>
          <col />
          <col className="w-9 print:w-8" />
          <col className="w-12 print:w-9" />
        </colgroup>
        <thead>
          <tr className="bg-[#f9fafb] text-[#9ca3af] text-[11px] print:text-[9px]">
            <th className="text-left px-3 py-1.5 font-medium print:px-1.5 print:py-0.5">単元</th>
            <th className="text-center px-1 py-1.5 font-medium whitespace-nowrap print:py-0.5">
              評価
            </th>
            <th className="text-center px-1 py-1.5 font-medium whitespace-nowrap print:py-0.5">
              コマ
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.unit.id}
              className={`border-t border-[#f3f4f6] ${row.isGroupMember ? 'bg-blue-50/40' : ''}`}
            >
              <td className="px-3 py-2 text-[#4b5563] break-words leading-snug print:px-1.5 print:py-0.5">
                {row.unit.name}
              </td>
              <td className="text-center align-middle">
                {row.unit.assessment && (
                  <span className={ASSESSMENT_STYLES[row.unit.assessment] || ''}>
                    {row.unit.assessment}
                  </span>
                )}
              </td>
              {row.isGroupMember ? (
                row.isGroupStart ? (
                  <td
                    className="text-center align-middle font-semibold text-[#1f2937] bg-blue-50/60"
                    rowSpan={row.groupSize}
                  >
                    {row.unit.koma}
                  </td>
                ) : null
              ) : (
                <td className="text-center align-middle font-semibold text-[#1f2937]">
                  {row.unit.koma}
                </td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-[#e5e7eb] bg-[#f9fafb] text-[12px] print:text-[9.5px]">
            <td className="px-3 py-1.5 font-medium text-[#6b7280] print:px-1.5 print:py-0.5">
              合計
            </td>
            <td />
            <td className="text-center font-bold text-red-600 print:text-gray-900">{totalKoma}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

interface ProposalApplyCardProps {
  /** 科目別のコマ数（申込フォームへ引き継ぐ内訳の表示にも使う） */
  subjectKoma: Array<{ name: string; koma: number }>;
  applyUrl: string;
}

/**
 * 増コマ申込への導線カード（印刷時は非表示）。
 * 「申し込む」だと、この場で申込確定するように見えてしまうため、
 * 文言・矢印アイコン・補足テキストで「フォームに移動する」ことを明示する。
 */
export function ProposalApplyCard({ subjectKoma, applyUrl }: ProposalApplyCardProps) {
  return (
    <section className="bg-white rounded-2xl border border-[#e5e7eb] p-4 print:hidden">
      <h2 className="text-[15px] font-bold text-[#1a1a1a] tracking-tight">増コマのお申し込み</h2>
      <p className="text-xs text-[#6b7280] mt-1">上記の提案内容をもとにお申し込みいただけます。</p>

      {subjectKoma.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {subjectKoma.map((sk) => (
            <span
              key={sk.name}
              className="px-2.5 py-1 bg-[#f3f4f6] rounded-lg text-[11px] text-[#4b5563]"
            >
              {sk.name} <span className="font-bold text-[#1f2937]">{sk.koma}</span>コマ
            </span>
          ))}
        </div>
      )}

      <a
        href={applyUrl}
        className="mt-4 flex w-full items-center justify-center gap-1.5 py-3 bg-red-600 text-white font-semibold rounded-lg text-sm hover:bg-red-700 active:scale-[0.97] transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
      >
        増コマ申込フォームへ進む
        <ArrowRight className="w-4 h-4" />
      </a>
      <p className="text-[11px] text-[#6b7280] mt-2 text-center leading-relaxed">
        ボタンを押すとフォームに移動します。日時の選択・送信はフォーム上で行います。
      </p>
    </section>
  );
}
