import Link from 'next/link';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowLeft } from 'lucide-react';

/**
 * 法務文書（プライバシーポリシー・利用規約）の共通表示。
 *
 * サーバーコンポーネントのまま描画する（'use client' を付けない）。
 * react-markdown はそれなりの重さがあり、保護者は 375px のスマホで一度読むだけ
 * なので、クライアントバンドルに載せる価値がない。
 *
 * ★ remark-gfm が必須:
 *   プライバシーポリシー第5条（委託先一覧）・第7条（外部送信）は表組みで、
 *   標準マークダウンでは表が解釈されず生のパイプ文字が並ぶ。
 *
 * Tailwind の typography プラグインは入っていないため、要素ごとに明示的に
 * クラスを当てる。色は既存のデザイントークン（text-heading / text-body /
 * text-muted / border）に寄せ、ダークモードも自動で追従させる。
 */
interface LegalDocumentViewProps {
  /** 本文（loadLegalMarkdown で付録を落としたもの）。 */
  markdown: string;
  /** 相互リンク先（プライバシーポリシー↔利用規約）。 */
  otherDocument: { href: string; title: string };
}

/**
 * 表は横スクロールできるコンテナに包む。
 * 375px 幅では3〜4列の表は必ずはみ出す。ページ全体を横スクロールさせると
 * 本文まで読みにくくなるので、表だけをスクロールさせる。
 */
const markdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="mb-4 text-xl font-bold leading-snug text-text-heading">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="mb-3 mt-8 text-base font-bold leading-snug text-text-heading">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="mb-2 mt-6 text-sm font-bold text-text-heading">{children}</h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-4 text-sm leading-relaxed text-text-body">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-4 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-text-body">
      {children}
    </ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-text-body">
      {children}
    </ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-bold text-text-heading">{children}</strong>
  ),
  hr: () => <hr className="my-6 border-t border-border" />,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a
      href={href}
      className="text-info underline underline-offset-2"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    // 表だけを横スクロールさせる（ページ本体は横スクロールさせない）。
    <div className="mb-4 -mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[32rem] border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-surface-hover">{children}</thead>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border border-border px-2 py-1.5 text-left align-top font-bold text-text-heading">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border border-border px-2 py-1.5 align-top leading-relaxed text-text-body">
      {children}
    </td>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="mb-4 border-l-2 border-border pl-3 text-sm text-text-muted">
      {children}
    </blockquote>
  ),
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="rounded bg-surface-hover px-1 py-0.5 font-mono text-xs">{children}</code>
  ),
};

export function LegalDocumentView({ markdown, otherDocument }: LegalDocumentViewProps) {
  return (
    <div className="min-h-screen bg-surface text-text-body">
      {/* 読みやすい幅に制限。max-w-2xl でも 375px では画面幅いっぱいになる。 */}
      <div className="mx-auto w-full max-w-2xl px-4 py-8">
        <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {markdown}
        </Markdown>

        {/* 相互リンクとマイページへの戻り導線。登録前（未ログイン）でも押せる。 */}
        <div className="mt-10 flex flex-col gap-3 border-t border-border pt-6 text-sm">
          <Link
            href={otherDocument.href}
            className="text-info underline underline-offset-2"
            prefetch={false}
          >
            {otherDocument.title}を読む
          </Link>
          <Link
            href="/mypage"
            className="inline-flex items-center gap-1.5 text-text-muted"
            prefetch={false}
          >
            <ArrowLeft className="h-4 w-4" />
            マイページへ戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
